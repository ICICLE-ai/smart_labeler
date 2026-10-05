// ---------------------------------------------------------------------------
// Typed client for the SAM3 Video Service (sam3_video_service). Every call this
// package makes to that service goes through here — nothing else should
// `fetch()` it directly. Configure once with `configureVideoSegmentation` at
// app startup, same pattern as the other @icicle-ai/* packages.
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
}

let _baseUrl = "http://127.0.0.1:2129";

export function configureVideoSegmentation(cfg: VideoSegmentationConfig): void {
   if (cfg.baseUrl) _baseUrl = cfg.baseUrl.replace(/\/+$/, "");
}

export function getVideoServiceBaseUrl(): string {
   return _baseUrl;
}

export class Sam3VideoError extends Error {
   status?: number;
   constructor(message: string, status?: number) {
      super(message);
      this.name = "Sam3VideoError";
      this.status = status;
   }
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

async function asJson<T>(response: Response): Promise<T> {
   if (!response.ok) throw new Sam3VideoError(await readErrorDetail(response), response.status);
   return response.json();
}

function url(path: string): string {
   return `${_baseUrl}${path}`;
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
      xhr.open("POST", url("/uploads"));
      xhr.upload.onprogress = (e) => {
         if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
         let body: any = null;
         try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
         if (xhr.status >= 200 && xhr.status < 300 && body) {
            resolve(body as UploadMeta);
         } else {
            reject(new Sam3VideoError(body?.detail ?? xhr.responseText ?? `HTTP ${xhr.status}`, xhr.status));
         }
      };
      xhr.onerror = () => reject(new Sam3VideoError("Network error while uploading video"));
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

export async function getUpload(uploadId: string): Promise<UploadMeta> {
   return asJson(await fetch(url(`/uploads/${uploadId}`)));
}

export async function listChunks(uploadId: string): Promise<ChunksResponse> {
   return asJson(await fetch(url(`/uploads/${uploadId}/chunks`)));
}

export async function prepareChunk(uploadId: string, chunkIndex: number): Promise<PrepareChunkResponse> {
   return asJson(
      await fetch(url(`/uploads/${uploadId}/chunks/prepare`), {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ chunk_index: chunkIndex }),
      }),
   );
}

/** `frame_idx` is the 0-based decoded-frame index the service uses throughout — never derive it from timestamp × fps. */
export function chunkFrameUrl(uploadId: string, chunkIndex: number, frameIdx: number): string {
   return url(`/uploads/${uploadId}/chunks/${chunkIndex}/frames/${String(frameIdx).padStart(6, "0")}.jpg`);
}

/** Single-frame fetch. Avoid for scrubbing late in long videos — it decodes from the start of the video on every uncached request. */
export function singleFrameUrl(uploadId: string, frameIdx: number): string {
   return url(`/uploads/${uploadId}/frames/${String(frameIdx).padStart(6, "0")}.jpg`);
}

/** Fetches a frame JPEG as an object URL the caller must revoke. Used for both the chunk and single-frame endpoints — same error-reporting path either way. */
export async function fetchFrameObjectUrl(frameUrl: string, signal?: AbortSignal): Promise<string> {
   const response = await fetch(frameUrl, { signal });
   if (!response.ok) throw new Sam3VideoError(await readErrorDetail(response), response.status);
   const blob = await response.blob();
   return URL.createObjectURL(blob);
}

// ---------------------------------------------------------------------------
// Tracking jobs
// ---------------------------------------------------------------------------

export async function startTrack(uploadId: string, req: TrackRequest): Promise<TrackJob> {
   return asJson(
      await fetch(url(`/uploads/${uploadId}/track`), {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify(req),
      }),
   );
}

export async function getTrackJob(jobId: string): Promise<TrackJob> {
   return asJson(await fetch(url(`/track-jobs/${jobId}`)));
}

export async function cancelTrackJob(jobId: string): Promise<TrackJob> {
   return asJson(await fetch(url(`/track-jobs/${jobId}`), { method: "DELETE" }));
}

export async function getTrackFrame(jobId: string, frameIdx: number, includePng = false): Promise<TrackFrameResult> {
   return asJson(
      await fetch(url(`/track-jobs/${jobId}/frames/${frameIdx}${includePng ? "?include_png=true" : ""}`)),
   );
}

export function trackMaskPngUrl(jobId: string, frameIdx: number, objId: number): string {
   return url(`/track-jobs/${jobId}/masks/${frameIdx}/${objId}.png`);
}

export function trackCocoUrl(jobId: string): string {
   return url(`/track-jobs/${jobId}/coco`);
}

export function trackVideoUrl(jobId: string): string {
   return url(`/track-jobs/${jobId}/video`);
}

/** Renders (if needed) and fetches the annotated MP4 as a Blob. The first request after a job completes can take a while — the render happens synchronously on the server. */
export async function fetchTrackVideo(jobId: string, signal?: AbortSignal): Promise<Blob> {
   const response = await fetch(trackVideoUrl(jobId), { signal });
   if (!response.ok) throw new Sam3VideoError(await readErrorDetail(response), response.status);
   return response.blob();
}

export async function fetchTrackCoco(jobId: string): Promise<unknown> {
   return asJson(await fetch(trackCocoUrl(jobId)));
}

/**
 * Subscribes to `GET /track-jobs/{id}/events` (SSE). Falls back to polling
 * `GET /track-jobs/{id}` every second if EventSource throws or the browser
 * doesn't support it (e.g. no `EventSource` global, or a proxy strips SSE).
 * Returns an unsubscribe function. Terminal statuses stop the subscription
 * automatically (mirrors the server, which ends the stream the same way).
 */
export function subscribeTrackJob(
   jobId: string,
   onUpdate: (job: TrackJob) => void,
   onError?: (err: unknown) => void,
): () => void {
   const TERMINAL = new Set(["done", "failed", "cancelled"]);
   let stopped = false;
   let pollTimer: ReturnType<typeof setTimeout> | null = null;

   const startPolling = () => {
      const poll = async () => {
         if (stopped) return;
         try {
            const job = await getTrackJob(jobId);
            if (stopped) return;
            onUpdate(job);
            if (TERMINAL.has(job.status)) return;
         } catch (e) {
            if (!stopped) onError?.(e);
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
      es = new EventSource(url(`/track-jobs/${jobId}/events`));
      es.onmessage = (ev) => {
         if (stopped) return;
         try {
            const job = JSON.parse(ev.data) as TrackJob;
            onUpdate(job);
            if (TERMINAL.has(job.status)) { es?.close(); }
         } catch (e) {
            onError?.(e);
         }
      };
      es.onerror = () => {
         if (stopped) return;
         es?.close();
         es = null;
         startPolling();
      };
   } catch (e) {
      startPolling();
   }

   return () => {
      stopped = true;
      es?.close();
      if (pollTimer) clearTimeout(pollTimer);
   };
}
