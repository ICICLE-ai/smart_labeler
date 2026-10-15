// ---------------------------------------------------------------------------
// Persisting a video workspace between visits.
//
// Tracking itself runs on the GPU service and keeps going whatever the browser
// does; what lives here is the work the browser owns — which objects exist and
// the masks drawn on each keyframe — which would otherwise be lost on a reload.
//
// State is keyed per pipeline so switching pipelines and coming back restores
// that pipeline's own work. It is held in localStorage, which means it is tied
// to this browser on this machine: another device sees the pipeline as new.
// Making resume user-wide needs the upload/job ids recorded server-side against
// the pipeline instead.
// ---------------------------------------------------------------------------
import type { SegmentationAnnotation } from "@icicle-ai/image-annotation-canvas";
import type { VideoObject } from "./utils";

/** frame_idx -> obj_id -> that object's polygon mask on that frame. */
export type KeyframeMasks = Map<number, Map<number, SegmentationAnnotation>>;

export const objKeyId = (objId: number) => `obj-${objId}`;
export const objIdFromKey = (key: string) => Number(key.slice(4));

/** Maps are stored as arrays because JSON has no Map. */
export interface PersistedMask { objId: number; label: string; points: { x: number; y: number }[] }
export interface PersistedKeyframe { frameIdx: number; masks: PersistedMask[] }

export interface ResumeState {
   uploadId?: string;
   jobId?: string;
   objects?: VideoObject[];
   keyframes?: PersistedKeyframe[];
   currentFrame?: number;
}

const resumeKey = (pipeid: string) => `video-segmentation:${pipeid}`;

export function serializeKeyframes(masks: KeyframeMasks): PersistedKeyframe[] {
   return [...masks.entries()].map(([frameIdx, objMap]) => ({
      frameIdx,
      masks: [...objMap.entries()].map(([objId, ann]) => ({ objId, label: ann.label, points: ann.points })),
   }));
}

export function deserializeKeyframes(saved: PersistedKeyframe[] | undefined): KeyframeMasks {
   const out: KeyframeMasks = new Map();
   for (const entry of saved ?? []) {
      // Anything malformed is skipped rather than throwing: a corrupt entry must
      // not take the whole workspace down with it.
      if (!entry || typeof entry.frameIdx !== "number" || !Array.isArray(entry.masks)) continue;
      const objMap = new Map<number, SegmentationAnnotation>();
      for (const m of entry.masks) {
         if (!m || typeof m.objId !== "number" || !Array.isArray(m.points) || m.points.length < 3) continue;
         objMap.set(m.objId, { id: objKeyId(m.objId), label: m.label ?? `object_${m.objId}`, points: m.points });
      }
      if (objMap.size > 0) out.set(entry.frameIdx, objMap);
   }
   return out;
}

export function loadResumeState(pipeid: string): ResumeState {
   try {
      const raw = localStorage.getItem(resumeKey(pipeid));
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
   } catch {
      // Unreadable or corrupt saved state is treated as no saved state.
      return {};
   }
}

export function saveResumeState(pipeid: string, state: ResumeState): void {
   try {
      // No upload means there is no workspace worth restoring.
      if (!state.uploadId) localStorage.removeItem(resumeKey(pipeid));
      else localStorage.setItem(resumeKey(pipeid), JSON.stringify(state));
   } catch {
      // Best effort. A blocked or full localStorage costs resume-on-reload, not
      // the session in progress, so it must not interrupt anything.
   }
}
