// Mirrors app/video_export.py's OBJECT_COLORS so the overlay in the browser
// matches the colors baked into the annotated MP4 the service renders.
const OBJECT_COLORS: [number, number, number][] = [
   [34, 197, 94], // green
   [59, 130, 246], // blue
   [239, 68, 68], // red
   [234, 179, 8], // yellow
   [168, 85, 247], // purple
   [6, 182, 212], // cyan
   [249, 115, 22], // orange
   [236, 72, 153], // pink
];

export function objectColorRgb(objId: number): [number, number, number] {
   return OBJECT_COLORS[(objId - 1) % OBJECT_COLORS.length];
}

export function objectColorCss(objId: number): string {
   const [r, g, b] = objectColorRgb(objId);
   return `rgb(${r}, ${g}, ${b})`;
}

export interface VideoObject {
   id: number;
   label: string;
}

/** Next unused object id — ids are small positive integers, matching the service's `obj_id`. */
export function nextObjectId(objects: VideoObject[]): number {
   return objects.reduce((max, o) => Math.max(max, o.id), 0) + 1;
}

/**
 * Elapsed time at a frame, as mm:ss.mmm.
 *
 * Derived from the frame index, never the other way round. On a
 * variable-frame-rate recording the average fps makes this an approximation, so
 * it is for the reader's orientation only — every call to the service is
 * addressed by frame index, which is exact.
 */
export function frameTimecode(frameIdx: number, fps: number | undefined): string | null {
   if (!fps || !Number.isFinite(fps) || fps <= 0) return null;
   const totalSeconds = frameIdx / fps;
   const minutes = Math.floor(totalSeconds / 60);
   const seconds = Math.floor(totalSeconds % 60);
   const millis = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
   return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

/** Saves `href` (an object URL or same-origin URL) under `filename` through a throwaway anchor. */
export function downloadHref(href: string, filename: string) {
   const a = document.createElement("a");
   a.href = href;
   a.download = filename;
   a.click();
}

/** Downloads a blob through a throwaway anchor. */
export function downloadBlob(blob: Blob, filename: string) {
   const url = URL.createObjectURL(blob);
   downloadHref(url, filename);
   setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
