import type { Coords, EngineContext, ExemplarBox, ExemplarPayload } from "./types";

export const MAX_SCALE = 8;

// ---------------------------------------------------------------------------
// Colour palette – one colour per unique label, assigned on first encounter.
// ---------------------------------------------------------------------------
export const LABEL_PALETTE = [
   "#1976d2", // blue
   "#388e3c", // green
   "#f57c00", // orange
   "#7b1fa2", // purple
   "#00838f", // teal
   "#558b2f", // olive
   "#6d4c41", // brown
   "#ad1457", // pink
   "#0277bd", // light-blue
   "#e65100", // deep-orange
   // Red (#c62828) is intentionally excluded – reserved for selection highlighting
];

// Shared label-color resolver – assigns a stable color per unique label string.
// Uses a module-level cache so the same label always gets the same color
// across the canvas and any other component sharing this resolver.
export const getLabelColor = (() => {
   const cache = new Map<string, string>();
   let idx = 0;
   return (label: string): string => {
      if (!cache.has(label)) cache.set(label, LABEL_PALETTE[idx++ % LABEL_PALETTE.length]);
      return cache.get(label)!;
   };
})();

export enum SAM3_MODES {
   SINGLE_CLICK = "SINGLE_CLICK",
   TEXT_PROMPTS = "TEXT_PROMPTS",
   EXEMPLAR = "EXEMPLAR",
}

/**
 * The whole-pixel box around a drawn exemplar, which is either a detection box or
 * a polygon's points. Rounded outwards so it still covers the shape, then clamped
 * because the service returns a 400 for a box past the image edge. Null when
 * nothing is left, such as a polygon whose points all sit on one line.
 */
export function toExemplarBox(
   drawn: { x: number; y: number; width: number; height: number } | Coords[],
   imageWidth: number,
   imageHeight: number,
): ExemplarBox | null {
   const corners = Array.isArray(drawn)
      ? drawn
      : [{ x: drawn.x, y: drawn.y }, { x: drawn.x + drawn.width, y: drawn.y + drawn.height }];
   if (!corners.length) return null;
   const xs = corners.map((p) => p.x);
   const ys = corners.map((p) => p.y);
   const x1 = Math.max(0, Math.floor(Math.min(...xs)));
   const y1 = Math.max(0, Math.floor(Math.min(...ys)));
   const x2 = Math.min(imageWidth, Math.ceil(Math.max(...xs)));
   const y2 = Math.min(imageHeight, Math.ceil(Math.max(...ys)));
   return x1 < x2 && y1 < y2 ? [x1, y1, x2, y2] : null;
}

/** Builds the `/predict_exemplar` body, which is the same for every engine. */
export function exemplarPayload(ctx: EngineContext<any>, box: ExemplarBox): ExemplarPayload {
   const fileName = ctx.fileName ?? "";
   return {
      image_path: fileName,
      image_id: fileName.substring(fileName.lastIndexOf("/") + 1, fileName.lastIndexOf(".")) || "image_0",
      pipe_id: ctx.pipeId || "0",
      system_id: ctx.systemId || "pitzer-tapis",
      exemplar_box: box,
      threshold: ctx.sam3Config.detectionConfidence,
      mask_threshold: ctx.sam3Config.maskPrecision,
   };
}
