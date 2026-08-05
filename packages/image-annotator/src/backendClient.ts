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
   system: string;
   annotationFilePath: string;
   fileType: string;
}

export interface PipelineInfo {
   is_demo?: boolean;
   type?: string;
}

async function getJson(path: string, token: string): Promise<any> {
   const response = await fetch(`${_apiBaseUrl}${path}`, {
      headers: { "Tapis-Token": token ?? "" },
   });
   if (!response.ok) return null;
   return response.json();
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
      try {
         const response = await fetch(url, { headers: { "Tapis-Token": token } });
         if (response.ok) return response.text();
         lastError = new Error(`HTTP ${response.status}`);
      } catch (e) {
         lastError = e; // network-level failure
      }
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, initialDelayMs * 2 ** i));
   }
   throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function saveAnnotationFile(
   system: string,
   dir: string,
   content: string,
   token: string
): Promise<boolean> {
   const response = await fetch(`${_apiBaseUrl}/save-file/${system}?path=${encodeURIComponent(dir)}`, {
      method: "POST",
      headers: { "Tapis-Token": token, "Content-Type": "application/json" },
      body: content,
   });
   return response.ok;
}
