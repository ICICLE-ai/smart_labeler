// ---------------------------------------------------------------------------
// Typed client for the SAM3 Video Service (sam3_video_service). Every call this
// package makes to that service goes through here — nothing else should
// `fetch()` it directly. Configure once with `configureVideoSegmentation` at
// app startup, same pattern as the other @icicle-ai/* packages.
//
// The service normally runs on a GPU node reached through an SSH tunnel, so
// "not running" and "tunnel closed" are everyday failures rather than edge
// cases. Every request therefore has a timeout and every failure is turned
// into a Sam3VideoError carrying a message that names the address being used —
// a bare "Failed to fetch" in the console tells the user nothing.
// ---------------------------------------------------------------------------
import type {
   ChunksResponse,
   DatasetExportJob,
   PrepareChunkResponse,
   TrackFrameResult,
   TrackJob,
   TrackRequest,
   UploadMeta,
} from "./types";

export interface VideoSegmentationConfig {
   /** Base URL of the SAM3 Video Service, e.g. http://127.0.0.1:2129 (often behind an SSH tunnel to an HPC GPU node). */
   baseUrl?: string;
   /** Tapis base URL, used when saving exports to an HPC system. */
   tapisBaseUrl?: string;
   /**
    * Set only when `baseUrl` points at the authenticating gateway rather than
    * the SAM3 service itself.
    *
    * It must stay off for a direct connection. The service answers with
    * `Access-Control-Allow-Origin: *` and no `Access-Control-Allow-Credentials`,
    * and a browser refuses a credentialed request against a wildcard origin —
    * so sending cookies to the bare service makes every call fail CORS rather
    * than merely being unnecessary.
    */
   gatewayAuth?: boolean;
}

let _baseUrl = "http://127.0.0.1:2129";
let _tapisBaseUrl = "https://icicleai.tapis.io";
/** Held so an expired session can be renewed without the caller noticing. */
let _tapisToken = "";
/** Whether to send cookies — only valid against the gateway. See `gatewayAuth`. */
let _gatewayAuth = false;

export function usesGatewayAuth(): boolean {
   return _gatewayAuth;
}

/** Supplies the token used to (re-)establish a session with the auth gateway. */
export function setAuthToken(token: string): void {
   _tapisToken = token ?? "";
}

export function configureVideoSegmentation(cfg: VideoSegmentationConfig): void {
   if (cfg.baseUrl) _baseUrl = cfg.baseUrl.replace(/\/+$/, "");
   if (cfg.tapisBaseUrl) _tapisBaseUrl = cfg.tapisBaseUrl.replace(/\/+$/, "");
   if (cfg.gatewayAuth !== undefined) _gatewayAuth = cfg.gatewayAuth;
}

export function getVideoServiceBaseUrl(): string {
   return _baseUrl;
}

export function getTapisBaseUrl(): string {
   return _tapisBaseUrl;
}

/** Default per-request timeout. Generous enough for a cold service, short enough that a dead tunnel is reported rather than hung on. */
const DEFAULT_TIMEOUT_MS = 20_000;
/** Frame extraction for a 1000-frame chunk runs ffmpeg over the video; it is slow but bounded. */
const PREPARE_TIMEOUT_MS = 180_000;
/** Rendering the annotated MP4 happens on the first request and walks every frame. */
const RENDER_TIMEOUT_MS = 900_000;
/** A transport failure arriving later than this is treated as a proxy timeout rather than a refused or dead connection. */
const SLOW_FAILURE_MS = 25_000;

export class Sam3VideoError extends Error {
   /** HTTP status, when the request reached the service and it answered. */
   status?: number;
   /** True when the service could not be reached or did not answer in time, as opposed to answering with an error. */
   unreachable: boolean;

   constructor(message: string, opts: { status?: number; unreachable?: boolean } = {}) {
      super(message);
      this.name = "Sam3VideoError";
      this.status = opts.status;
      this.unreachable = opts.unreachable ?? false;
   }
}

/**
 * A request that never produced a response.
 *
 * `fetch` cannot tell these cases apart — a browser reports a CORS refusal as
 * an indistinguishable network failure, deliberately, so that a page learns
 * nothing about a cross-origin server it is not allowed to read. The service
 * may therefore be perfectly healthy and answering 200 while this fires, so the
 * message has to raise that possibility rather than blame the network outright.
 */
function unreachableError(
   detail: string,
   { path, elapsedMs }: { path?: string; elapsedMs?: number } = {},
): Sam3VideoError {
   const remote = !_baseUrl.includes("127.0.0.1") && !_baseUrl.includes("localhost");
   const where = path ? ` (${path.split("?")[0]})` : "";
   // A failure that arrives only after a long wait is not a refused origin or a
   // dead service — those fail at once. It is a proxy in front of the service
   // (e.g. the cluster ingress) giving up on a slow request and answering with
   // its own error page, which carries no CORS headers and so reads as a
   // network failure too.
   if (elapsedMs !== undefined && elapsedMs >= SLOW_FAILURE_MS) {
      return new Sam3VideoError(
         `The SAM3 Video Service at ${_baseUrl} stopped responding after ${Math.round(elapsedMs / 1000)}s` +
         `${where} — ${detail}.\n\n` +
         `A request that fails only after a long wait was most likely cut off by a proxy in front of the ` +
         `service (such as the cluster ingress) whose timeout is shorter than the work takes — preparing ` +
         `a chunk's frames or rendering a video can run for minutes. Retrying may succeed if the service ` +
         `finished the work in the meantime; otherwise the proxy's timeout needs raising.`,
         { unreachable: true },
      );
   }
   return new Sam3VideoError(
      `No response from the SAM3 Video Service at ${_baseUrl}${where} — ${detail}.\n\n` +
      `The browser cannot tell a service that is down from one whose answer it was not allowed ` +
      `to read, so check both:\n` +
      `• The service may be refusing this page's origin (${
         typeof window !== "undefined" ? window.location.origin : "this page"
      }). It must be listed in the service's allowed origins — a wildcard does not work ` +
      `alongside credentials. The gateway logs every origin it turns away.\n` +
      (remote
         ? `• The service may be unreachable. Check it is deployed and healthy.`
         : `• The service may not be running, or its SSH tunnel may have closed.`),
      { unreachable: true },
   );
}

/** Best-effort extraction of FastAPI's `{"detail": "..."}` error body, falling back to raw text. */
async function readErrorDetail(response: Response): Promise<string> {
   const text = await response.text().catch(() => "");
   if (!text) return `HTTP ${response.status}`;
   try {
      const body = JSON.parse(text);
      if (typeof body?.detail === "string") return body.detail;
   } catch {
      /* not JSON — fall through to raw text */
   }
   return text;
}

/**
 * Single entry point for every request to the service: applies a timeout,
 * honours a caller's abort signal, and converts transport failures into a
 * Sam3VideoError that says what to check.
 */
async function request(
   path: string,
   init: RequestInit = {},
   {
      timeoutMs = DEFAULT_TIMEOUT_MS,
      signal,
      allowReauth = true,
   }: { timeoutMs?: number; signal?: AbortSignal; allowReauth?: boolean } = {},
): Promise<Response> {
   const response = await rawRequest(path, init, { timeoutMs, signal });

   // Behind the auth gateway a 401 means the session cookie is missing or has
   // expired — on first load, or after sitting idle past the TTL. Re-establish
   // it from the Tapis token and retry once, so callers never have to think
   // about session lifetime. `allowReauth` stops /auth/session recursing.
   if (response.status === 401 && allowReauth && _gatewayAuth && _tapisToken) {
      try {
         await signIn(_tapisToken);
      } catch {
         return response;   // sign-in failed; let the caller see the original 401
      }
      return rawRequest(path, init, { timeoutMs, signal });
   }
   return response;
}

async function rawRequest(
   path: string,
   init: RequestInit = {},
   { timeoutMs = DEFAULT_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Response> {
   const controller = new AbortController();
   const startedAt = Date.now();
   let timedOut = false;
   const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
   const onCallerAbort = () => controller.abort();
   signal?.addEventListener("abort", onCallerAbort);

   try {
      // Cookies travel only when the gateway is in front; against the bare
      // service a credentialed request is refused outright by the browser,
      // because the service replies with a wildcard allowed origin.
      //
      // The token also goes on every request behind the gateway, not just at
      // sign-in. Embedded in another site — a Tapis iframe — the session cookie
      // is third-party and the browser drops it, so sign-in succeeds and every
      // request after it arrives anonymous. A header is immune to that; the
      // cookie stays for `EventSource`, which cannot send one.
      const headers = new Headers(init.headers ?? {});
      if (_gatewayAuth && _tapisToken && !headers.has("X-Tapis-Token")) {
         headers.set("X-Tapis-Token", _tapisToken);
      }
      return await fetch(`${_baseUrl}${path}`, {
         ...init,
         headers,
         credentials: _gatewayAuth ? "include" : "omit",
         signal: controller.signal,
      });
   } catch (e) {
      // A caller-initiated abort is not a service failure — hand it back as-is
      // so navigation/cancellation paths can ignore it.
      if (signal?.aborted) throw e;
      if (timedOut) throw unreachableError(`no response within ${Math.round(timeoutMs / 1000)}s`, { path });
      throw unreachableError("the request could not be completed", { path, elapsedMs: Date.now() - startedAt });
   } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onCallerAbort);
   }
}

async function asJson<T>(response: Response): Promise<T> {
   if (!response.ok) throw new Sam3VideoError(await readErrorDetail(response), { status: response.status });
   return response.json();
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
// When the service sits behind the auth gateway, a Tapis token is exchanged
// once for a session cookie, which the browser then sends on its own — including
// on the EventSource progress stream, which cannot carry custom headers.
// Deployments without the gateway (a direct SSH tunnel to a GPU node) simply
// answer 404 here, which is treated as "no sign-in needed".

let _signedInAs: string | null = null;

export function currentUser(): string | null {
   return _signedInAs;
}

/**
 * Establishes a session from a Tapis token. Safe to call repeatedly — it is
 * cheap, and re-calling refreshes a cookie that is close to expiry.
 *
 * @returns the username, or null when the service is not behind a gateway.
 */
export async function signIn(tapisToken: string): Promise<string | null> {
   _tapisToken = tapisToken ?? "";
   // Nothing to sign in to, and the attempt itself would fail CORS.
   if (!_gatewayAuth) { _signedInAs = null; return null; }
   const response = await request("/auth/session", {
      method: "POST",
      headers: { "X-Tapis-Token": tapisToken ?? "" },
   }, { timeoutMs: 15_000, allowReauth: false });

   // No gateway in front of this deployment: nothing to sign in to.
   if (response.status === 404) { _signedInAs = null; return null; }
   if (response.status === 401) {
      throw new Sam3VideoError(
         `The video service rejected your credentials: ${await readErrorDetail(response)}. Sign in again and retry.`,
         { status: 401 },
      );
   }
   if (!response.ok) throw new Sam3VideoError(await readErrorDetail(response), { status: response.status });

   const body = await response.json().catch(() => ({}));
   _signedInAs = body?.username ?? null;
   return _signedInAs;
}

export async function signOut(): Promise<void> {
   _signedInAs = null;
   await request("/auth/session", { method: "DELETE" }, { timeoutMs: 10_000 }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface ServiceHealth {
   status: string;
   sam3: {
      ready: boolean;
      mock: boolean;
      loading: boolean;
      backend: string;
      version: string;
      model_id: string;
      device: string;
      tracker_loaded?: boolean;
      video_loaded?: boolean;
   };
}

/**
 * `GET /health`. Used to tell the user up front whether the service is
 * reachable and whether it is in mock mode, instead of letting them annotate a
 * video for ten minutes and only then discover that tracking cannot run.
 */
export async function checkHealth(signal?: AbortSignal): Promise<ServiceHealth> {
   return asJson(await request("/health", {}, { timeoutMs: 8_000, signal }));
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * `POST /uploads`, multipart field `file`. Uses XHR (not fetch) so upload
 * progress can be reported — a multi-GB video can take a while, and a plain
 * fetch gives no visibility into that.
 */
export function uploadVideo(
   file: File,
   onProgress?: (fraction: number) => void,
   signal?: AbortSignal,
): Promise<UploadMeta> {
   return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${_baseUrl}/uploads`);
      // Carries the gateway's session cookie, as fetch's credentials mode does.
      // Left off for a direct connection, where it would fail CORS.
      xhr.withCredentials = _gatewayAuth;
      // And the token, for the embedded case where the cookie never arrives.
      if (_gatewayAuth && _tapisToken) xhr.setRequestHeader("X-Tapis-Token", _tapisToken);
      xhr.upload.onprogress = (e) => {
         if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
         let body: any = null;
         try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
         if (xhr.status >= 200 && xhr.status < 300 && body) {
            resolve(body as UploadMeta);
         } else {
            reject(new Sam3VideoError(
               body?.detail ?? xhr.responseText ?? `HTTP ${xhr.status}`,
               { status: xhr.status },
            ));
         }
      };
      // status 0 with no response means the request never landed — the service
      // is down or the tunnel is closed, which is not the same as a rejected upload.
      xhr.onerror = () => reject(unreachableError("the upload could not be sent"));
      xhr.onabort = () => reject(new Sam3VideoError("Upload cancelled"));
      if (signal) {
         if (signal.aborted) { xhr.abort(); return; }
         signal.addEventListener("abort", () => xhr.abort());
      }
      const form = new FormData();
      form.append("file", file);
      xhr.send(form);
   });
}

export async function getUpload(uploadId: string, signal?: AbortSignal): Promise<UploadMeta> {
   return asJson(await request(`/uploads/${uploadId}`, {}, { signal }));
}

export async function listChunks(uploadId: string, signal?: AbortSignal): Promise<ChunksResponse> {
   return asJson(await request(`/uploads/${uploadId}/chunks`, {}, { signal }));
}

export async function prepareChunk(uploadId: string, chunkIndex: number, signal?: AbortSignal): Promise<PrepareChunkResponse> {
   return asJson(
      await request(
         `/uploads/${uploadId}/chunks/prepare`,
         {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chunk_index: chunkIndex }),
         },
         { timeoutMs: PREPARE_TIMEOUT_MS, signal },
      ),
   );
}

/** `frame_idx` is the 0-based decoded-frame index the service uses throughout — never derive it from timestamp × fps. */
export function chunkFrameUrl(uploadId: string, chunkIndex: number, frameIdx: number): string {
   return `${_baseUrl}/uploads/${uploadId}/chunks/${chunkIndex}/frames/${String(frameIdx).padStart(6, "0")}.jpg`;
}

/** Single-frame fetch. Avoid for scrubbing late in long videos — it decodes from the start of the video on every uncached request. */
export function singleFrameUrl(uploadId: string, frameIdx: number): string {
   return `${_baseUrl}/uploads/${uploadId}/frames/${String(frameIdx).padStart(6, "0")}.jpg`;
}

/** Fetches a frame JPEG as an object URL the caller must revoke. */
export async function fetchFrameObjectUrl(frameUrl: string, signal?: AbortSignal): Promise<string> {
   const path = frameUrl.startsWith(_baseUrl) ? frameUrl.slice(_baseUrl.length) : frameUrl;
   const response = await request(path, {}, { signal });
   if (!response.ok) throw new Sam3VideoError(await readErrorDetail(response), { status: response.status });
   return URL.createObjectURL(await response.blob());
}

// ---------------------------------------------------------------------------
// Tracking jobs
// ---------------------------------------------------------------------------

export async function startTrack(uploadId: string, req: TrackRequest): Promise<TrackJob> {
   return asJson(
      await request(`/uploads/${uploadId}/track`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify(req),
      }),
   );
}

export async function getTrackJob(jobId: string, signal?: AbortSignal): Promise<TrackJob> {
   return asJson(await request(`/track-jobs/${jobId}`, {}, { signal }));
}

export async function cancelTrackJob(jobId: string): Promise<TrackJob> {
   return asJson(await request(`/track-jobs/${jobId}`, { method: "DELETE" }));
}

export async function getTrackFrame(
   jobId: string,
   frameIdx: number,
   includePng = false,
   signal?: AbortSignal,
): Promise<TrackFrameResult> {
   return asJson(
      await request(
         `/track-jobs/${jobId}/frames/${frameIdx}${includePng ? "?include_png=true" : ""}`,
         {},
         { signal },
      ),
   );
}

export function trackMaskPngUrl(jobId: string, frameIdx: number, objId: number): string {
   return `${_baseUrl}/track-jobs/${jobId}/masks/${frameIdx}/${objId}.png`;
}

export function trackCocoUrl(jobId: string): string {
   return `${_baseUrl}/track-jobs/${jobId}/coco`;
}

export function trackVideoUrl(jobId: string): string {
   return `${_baseUrl}/track-jobs/${jobId}/video`;
}

/** Renders (if needed) and fetches the annotated MP4. The first call after a job completes can take minutes — the service renders it synchronously. */
export async function fetchTrackVideo(jobId: string, signal?: AbortSignal): Promise<Blob> {
   const response = await request(`/track-jobs/${jobId}/video`, {}, { timeoutMs: RENDER_TIMEOUT_MS, signal });
   if (!response.ok) throw new Sam3VideoError(await readErrorDetail(response), { status: response.status });
   return response.blob();
}

export async function fetchTrackCoco(jobId: string, signal?: AbortSignal): Promise<unknown> {
   return asJson(await request(`/track-jobs/${jobId}/coco`, {}, { timeoutMs: RENDER_TIMEOUT_MS, signal }));
}

/**
 * Subscribes to `GET /track-jobs/{id}/events` (SSE), falling back to polling
 * `GET /track-jobs/{id}` when EventSource is unavailable or errors (a proxy
 * that buffers or strips SSE is common). Returns an unsubscribe function.
 *
 * `onError` fires only once the subscription has given up on both transports
 * for several consecutive attempts, so a single blip does not raise an alarm
 * while a long job is running happily.
 */
export function subscribeTrackJob(
   jobId: string,
   onUpdate: (job: TrackJob) => void,
   onError?: (err: Sam3VideoError) => void,
): () => void {
   const TERMINAL = new Set(["done", "failed", "cancelled"]);
   const MAX_CONSECUTIVE_FAILURES = 3;
   let stopped = false;
   let pollTimer: ReturnType<typeof setTimeout> | null = null;
   let failures = 0;

   const startPolling = () => {
      const poll = async () => {
         if (stopped) return;
         try {
            const job = await getTrackJob(jobId);
            if (stopped) return;
            failures = 0;
            onUpdate(job);
            if (TERMINAL.has(job.status)) return;
         } catch (e) {
            if (stopped) return;
            failures++;
            if (failures >= MAX_CONSECUTIVE_FAILURES) {
               onError?.(e instanceof Sam3VideoError ? e : unreachableError("job progress could not be read"));
               return;   // stop hammering a service that is not answering
            }
         }
         if (!stopped) pollTimer = setTimeout(poll, 1000);
      };
      poll();
   };

   if (typeof EventSource === "undefined") {
      startPolling();
      return () => { stopped = true; if (pollTimer) clearTimeout(pollTimer); };
   }

   let es: EventSource | null = null;
   try {
      // withCredentials is the whole reason the gateway authenticates by cookie:
      // EventSource cannot send an Authorization or X-Tapis-Token header.
      es = new EventSource(`${_baseUrl}/track-jobs/${jobId}/events`,
         { withCredentials: _gatewayAuth });
      es.onmessage = (ev) => {
         if (stopped) return;
         try {
            const job = JSON.parse(ev.data) as TrackJob;
            failures = 0;
            onUpdate(job);
            if (TERMINAL.has(job.status)) es?.close();
         } catch {
            /* a malformed frame is not worth tearing the stream down for */
         }
      };
      es.onerror = () => {
         if (stopped) return;
         // EventSource reports "closed by the server at end of stream" the same
         // way as "could not connect", so fall back to polling rather than
         // reporting an error: polling can tell the two apart.
         es?.close();
         es = null;
         startPolling();
      };
   } catch {
      startPolling();
   }

   return () => {
      stopped = true;
      es?.close();
      if (pollTimer) clearTimeout(pollTimer);
   };
}

// ---------------------------------------------------------------------------
// Dataset export to HPC
// ---------------------------------------------------------------------------
// Served by the auth gateway, not the video service: the transfer is hundreds
// of megabytes and must not pass through the browser, and only the gateway
// holds both the shared data volume and the caller's identity. These calls
// therefore require gateway auth to be configured.

export class DatasetExportUnavailable extends Sam3VideoError {
   constructor() {
      super(
         "Exporting a dataset to HPC needs the authenticating gateway, which this deployment is not using. " +
         "Point SAM3_VIDEO_URL at the gateway and set SAM3_VIDEO_AUTH=gateway.",
      );
      this.name = "DatasetExportUnavailable";
   }
}

export interface StartDatasetExportOptions {
   uploadId: string;
   /** Include a finished tracking job to ship its masks and COCO alongside the frames. */
   trackJobId?: string | null;
   system: string;
   destDir: string;
   filename: string;
   /** Tapis token — the gateway writes to HPC as the caller. */
   tapisToken: string;
}

export async function startDatasetExport(opts: StartDatasetExportOptions): Promise<DatasetExportJob> {
   if (!_gatewayAuth) throw new DatasetExportUnavailable();
   return asJson(
      await request("/exports", {
         method: "POST",
         headers: { "Content-Type": "application/json", "X-Tapis-Token": opts.tapisToken },
         body: JSON.stringify({
            upload_id: opts.uploadId,
            track_job_id: opts.trackJobId ?? null,
            system: opts.system,
            dest_dir: opts.destDir,
            filename: opts.filename,
         }),
      }),
   );
}

export async function getDatasetExport(exportId: string, signal?: AbortSignal): Promise<DatasetExportJob> {
   if (!_gatewayAuth) throw new DatasetExportUnavailable();
   return asJson(await request(`/exports/${exportId}`, {}, { signal }));
}

export async function cancelDatasetExport(exportId: string): Promise<DatasetExportJob> {
   if (!_gatewayAuth) throw new DatasetExportUnavailable();
   return asJson(await request(`/exports/${exportId}`, { method: "DELETE" }));
}

/**
 * Polls an export to completion. Polled rather than streamed because the export
 * outlives the page: it keeps running on the gateway whether or not anyone is
 * watching, so re-attaching by id is what matters, not a persistent connection.
 */
export function watchDatasetExport(
   exportId: string,
   onUpdate: (job: DatasetExportJob) => void,
   onError?: (err: Sam3VideoError) => void,
): () => void {
   const TERMINAL = new Set(["done", "failed", "cancelled"]);
   let stopped = false;
   let timer: ReturnType<typeof setTimeout> | null = null;
   let failures = 0;

   const poll = async () => {
      if (stopped) return;
      try {
         const job = await getDatasetExport(exportId);
         if (stopped) return;
         failures = 0;
         onUpdate(job);
         if (TERMINAL.has(job.status)) return;
      } catch (e) {
         if (stopped) return;
         if (++failures >= 3) {
            onError?.(e instanceof Sam3VideoError ? e : new Sam3VideoError(String(e)));
            return;
         }
      }
      if (!stopped) timer = setTimeout(poll, 2000);
   };
   poll();

   return () => { stopped = true; if (timer) clearTimeout(timer); };
}
