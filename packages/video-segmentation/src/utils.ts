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
