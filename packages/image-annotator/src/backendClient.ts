// ---------------------------------------------------------------------------
// Client for the smart-labeler backend's annotator-config + file endpoints.
// Unlike the Tapis/Patra calls elsewhere in this monorepo, there is no
// "direct" upstream for these — annotator-config, pipeline metadata, and
// admin status are concepts that only exist in this backend's own database.
// Configure once at app startup with `configureImageAnnotator`.
// ---------------------------------------------------------------------------

export interface ImageAnnotatorConfig {
   /** Base URL of the smart-labeler backend (e.g. https://labeler-api.example.com). */
   apiBaseUrl?: string;
}

// Matches the smart-labeler client's own default (client/app/utils/utils.ts).
let _apiBaseUrl = "http://127.0.0.1:11112";

export function configureImageAnnotator(cfg: ImageAnnotatorConfig): void {
   if (cfg.apiBaseUrl) _apiBaseUrl = cfg.apiBaseUrl.replace(/\/+$/, "");
}

export interface AnnotatorConfig {
   id: number;
   srcImgDir: string;
   /** Tapis system holding the source IMAGES. */
   system: string;
   annotationFilePath: string;
   fileType: string;
   /**
    * Tapis system holding the annotation FILE. Distinct from `system` because the
    * save dialog lets you write annotations somewhere other than the images —
    * with one field, a file saved to one system was looked for on another and the
    * annotations silently failed to load. Blank/absent means "same as `system`".
    */
   annotationSystem?: string;
}

export interface PipelineInfo {
   is_demo?: boolean;
   type?: string;
}

/**
 * Statuses worth trying again. A cold backend answers 502/503 for the first
 * request or two, and a saturated connection pool shows up as a 500 or a thrown
 * fetch. Everything else — 401, 403, 404 — is a definite answer, and retrying it
 * only delays the real error.
 */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Retry delays in ms. Kept short: these block the first paint of the workspace. */
const RETRY_DELAYS_MS = [400, 1200];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET returning parsed JSON, or null.
 *
 * Retries transient failures. Without this, opening a pipeline against a cold
 * backend left the annotator with no configuration at all: no source directory,
 * so no images, so no annotations — and no error either, because a null config
 * is indistinguishable from a pipeline that has never been configured. Leaving
 * and re-entering the pipeline "fixed" it, which is just the backend having
 * warmed up in the meantime.
 */
async function getJson(path: string, token: string): Promise<any> {
   for (let attempt = 0; ; attempt++) {
      let response: Response | null = null;
      try {
         response = await fetch(`${_apiBaseUrl}${path}`, {
            headers: { "Tapis-Token": token ?? "" },
         });
      } catch {
         response = null;   // network-level failure; treated as transient
      }

      if (response?.ok) return response.json();

      const retriable = response === null || TRANSIENT_STATUSES.has(response.status);
      if (!retriable || attempt >= RETRY_DELAYS_MS.length) {
         if (response && !response.ok) {
            console.warn(`GET ${path} failed with ${response.status}`);
         }
         return null;
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
   }
}

export async function fetchAnnotatorConfigs(pipeid: string, token: string): Promise<AnnotatorConfig[] | null> {
   return getJson(`/annotator-configuration/${pipeid}`, token);
}

export async function fetchPipeline(pipeid: string, token: string): Promise<PipelineInfo | null> {
   return getJson(`/pipe/${pipeid}`, token);
}

export async function fetchIsAdmin(token: string): Promise<boolean> {
   const res = await getJson(`/is-admin`, token);
   return Boolean(res?.is_admin);
}

export async function createAnnotatorConfig(
   pipeid: string,
   payload: Omit<AnnotatorConfig, "id">,
   token: string
): Promise<AnnotatorConfig | null> {
   const response = await fetch(`${_apiBaseUrl}/annotator-configuration/${pipeid}`, {
      method: "POST",
      headers: { "Tapis-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
   });
   if (!response.ok) return null;
   const data = await response.json();
   return data?.id ? { id: data.id, ...payload } : null;
}

export async function updateAnnotatorConfig(
   id: number,
   updates: Partial<AnnotatorConfig>,
   token: string
): Promise<boolean> {
   const response = await fetch(`${_apiBaseUrl}/annotator-configuration/config/${id}`, {
      method: "PUT",
      headers: { "Tapis-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(updates),
   });
   return response.ok;
}

// Retries with backoff — the first hit regularly fails while the
// backend/Tapis is cold and image prefetches saturate the connection pool.
export async function fetchAnnotationFileText(
   pipeid: string,
   system: string,
   filePath: string,
   token: string,
   attempts = 3,
   initialDelayMs = 1000,
): Promise<string> {
   const url = `${_apiBaseUrl}/get_file/${pipeid}/${system}?filePath=${encodeURIComponent(filePath)}`;
   let lastError: unknown;
   for (let i = 0; i < attempts; i++) {
      let status: number | null = null;
      try {
         const response = await fetch(url, { headers: { "Tapis-Token": token } });
         if (response.ok) return response.text();
         status = response.status;
         lastError = new Error(`HTTP ${response.status}`);
      } catch (e) {
         lastError = e; // network-level failure
      }
      // A missing file or a refused one will still be missing in three seconds.
      if (status !== null && !TRANSIENT_STATUSES.has(status)) break;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, initialDelayMs * 2 ** i));
   }
   throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export interface SaveAnnotationResult {
   ok: boolean;
   /** HTTP status of the save. Absent when the request never reached the backend. */
   status?: number;
   /** Whatever explanation the backend (or Tapis behind it) gave, when there was one. */
   detail?: string;
}

/**
 * Writes the annotation file. The status is reported rather than collapsed into a
 * boolean: a 403 from Tapis (no write access to that directory) needs to be told
 * apart from a bad path or an expired session, since only the user can resolve it
 * and only if they are told which one it is.
 */
export async function saveAnnotationFile(
   system: string,
   dir: string,
   content: string,
   token: string
): Promise<SaveAnnotationResult> {
   let response: Response;
   try {
      response = await fetch(`${_apiBaseUrl}/save-file/${system}?path=${encodeURIComponent(dir)}`, {
         method: "POST",
         headers: { "Tapis-Token": token, "Content-Type": "application/json" },
         body: content,
      });
   } catch (e) {
      // Network-level failure — no status to report.
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
   }

   if (response.ok) return { ok: true, status: response.status };
   return { ok: false, status: response.status, detail: await readErrorDetail(response) };
}

/** Best-effort extraction of a human-readable reason from an error response. */
async function readErrorDetail(response: Response): Promise<string | undefined> {
   try {
      const text = await response.text();
      if (!text) return undefined;
      try {
         const body = JSON.parse(text);
         const detail = body?.message ?? body?.description ?? body?.detail ?? body?.error;
         return typeof detail === "string" ? detail : text;
      } catch {
         return text; // not JSON — hand back the raw body
      }
   } catch {
      return undefined;
   }
}
