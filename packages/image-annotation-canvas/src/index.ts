export { ImageCanvas } from "./ImageCanvas";
export type { ImageCanvasProps } from "./ImageCanvas";

export { detectionEngine } from "./engines/detectionEngine";
export { segmentationEngine } from "./engines/segmentationEngine";

export { createFetchSam3Client } from "./sam3Client";
export { getLabelColor, LABEL_PALETTE, MAX_SCALE, SAM3_MODES } from "./utils";

export { CanvasMode } from "./types";
export type {
   BaseAnnotation,
   Annotation,
   SegmentationAnnotation,
   Coords,
   Sam3Config,
   Sam3Client,
   EngineContext,
   DrawState,
   CanvasEngine,
} from "./types";
