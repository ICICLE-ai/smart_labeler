/**
 * Minimal shape shared by both bounding-box and polygon-mask annotations.
 * Intentionally has no `x`/`y`/`width`/`height`/`points` fields — those are
 * variant-specific and irrelevant to this panel's own rendering, which only
 * needs id/label/score/flag to filter, group, and bulk-edit.
 */
export interface BaseAnnotation {
   id: string;
   label: string;
   score?: number;
   iou?: number;
   flag?: string;
}
