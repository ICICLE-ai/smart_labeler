// ---------------------------------------------------------------------------
// Wire types for the SAM3 Video Service (sam3_video_service), matched to its
// README/schemas.py/routes.py/track_routes.py. This module owns the contract;
// nothing else in this package talks to the service directly.
// ---------------------------------------------------------------------------

export interface UploadMeta {
   upload_id: string;
   original_filename?: string;
   source_filename?: string;
   frame_count: number;
   width: number;
   height: number;
   duration?: number;
   fps?: number;
   chunk_size: number;
   overlap: number;
   status?: string;
}

export interface ChunkPlan {
   chunk_index: number;
   process_start: number;
   process_end: number;
   save_start: number;
   save_end: number;
}

export interface ChunksResponse {
   upload_id: string;
   chunks: ChunkPlan[];
}

/** `POST /uploads/{id}/chunks/prepare` response. `session_id` belongs to the
 * older single-chunk click-labeler flow and is intentionally not surfaced. */
export interface PrepareChunkResponse {
   session_id: string;
   chunk: ChunkPlan & { sample_frame: number; status: string };
   sample_frame_url: string;
}

/** One of exactly one of these three must be set — matches `MaskInput` in schemas.py. */
export interface MaskInput {
   png_b64?: string;
   rle?: { size: [number, number]; counts: string | number[] };
   /** COCO-style polygons: flat [x1, y1, x2, y2, ...] lists, in full-frame pixels. */
   polygons?: number[][];
}

export interface KeyframeObjectPrompt {
   obj_id: number;
   label?: string;
   mask: MaskInput;
}

export interface KeyframePrompt {
   frame_idx: number;
   objects: KeyframeObjectPrompt[];
}

export interface TrackRequest {
   keyframes: KeyframePrompt[];
   direction: "forward" | "both";
   start_frame?: number | null;
   end_frame?: number | null;
}

export type TrackJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface TrackJob {
   job_id: string;
   upload_id: string;
   status: TrackJobStatus;
   phase: string;
   chunk: number;
   chunks_total: number;
   frames_done: number;
   frames_total: number;
   progress: number;
   start_frame: number;
   end_frame: number;
   direction: string;
   /** obj_id (as string key) -> label */
   objects: Record<string, string>;
   error: string | null;
   created_at: number;
   finished_at: number | null;
}

export interface TrackFrameObject {
   obj_id: number;
   label: string | null;
   present: boolean;
   area: number;
   bbox: [number, number, number, number];
   rle: { size: [number, number]; counts: string };
   png_b64?: string;
}

export interface TrackFrameResult {
   job_id: string;
   frame_idx: number;
   status: TrackJobStatus;
   objects: TrackFrameObject[];
}
