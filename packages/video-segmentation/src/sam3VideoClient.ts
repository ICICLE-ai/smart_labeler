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
}

let _baseUrl = "http://127.0.0.1:2129";
let _tapisBaseUrl = "https://icicleai.tapis.io";

export function configureVideoSegmentation(cfg: VideoSegmentationConfig): void {
   if (cfg.baseUrl) _baseUrl = cfg.baseUrl.replace(/\/+$/, "");
   if (cfg.tapisBaseUrl) _tapisBaseUrl = cfg.tapisBaseUrl.replace(/\/+$/, "");
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

function unreachableError(detail: string): Sam3VideoError {
   return new Sam3VideoError(
      `Could not reach the SAM3 Video Service at ${_baseUrl} — ${detail}. ` +
      `Check that the service is running, and if it is on an HPC GPU node, that your SSH tunnel is still open.`,
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
   { timeoutMs = DEFAULT_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Response> {
   const controller = new AbortController();
   let timedOut = false;
   const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
   const onCallerAbort = () => controller.abort();
   signal?.addEventListener("abort", onCallerAbort);

   try {
      return await fetch(`${_baseUrl}${path}`, { ...init, signal: controller.signal });
   } catch (e) {
      // A caller-initiated abort is not a service failure — hand it back as-is
      // so navigation/cancellation paths can ignore it.
      if (signal?.aborted) throw e;
      if (timedOut) throw unreachableError(`no response within ${Math.round(timeoutMs / 1000)}s`);
      throw unreachableError("the request could not be completed");
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
      es = new EventSource(`${_baseUrl}/track-jobs/${jobId}/events`);
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
