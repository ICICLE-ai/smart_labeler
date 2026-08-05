import type { Dispatch, SetStateAction } from "react";

// ---------------------------------------------------------------------------
// Canvas mode – unified single source of truth shared by every engine.
// Detection and segmentation map their own tools onto this common vocabulary:
//   DRAWING → box-draw (detection) / polygon-place (segmentation)
//   EDIT    → box drag+resize (detection) / vertex drag (segmentation)
// ---------------------------------------------------------------------------
export enum CanvasMode {
   NONE = "NONE",
   DRAWING = "DRAWING",
   EDIT = "EDIT",
   SAM3_CLICK = "SAM3_CLICK",
   SAM3_TEXT = "SAM3_TEXT",
}

// ---------------------------------------------------------------------------
// Annotation types
// ---------------------------------------------------------------------------
export interface BaseAnnotation {
   id: string;
   label: string;
   score?: number;
   iou?: number;
   flag?: string;
}

/** Detection bounding box */
export interface Annotation extends BaseAnnotation {
   x: number;
   y: number;
   width: number;
   height: number;
}

/** Segmentation polygon mask */
export interface SegmentationAnnotation extends BaseAnnotation {
   points: { x: number; y: number }[];
}

export interface Coords {
   x: number;
   y: number;
}

export interface Sam3Config {
   patchSize: number;
   detectionConfidence: number;
   maskPrecision: number;
}

/**
 * Pluggable prediction backend for SAM3-assisted annotation. Consumers
 * provide either a `sam3Endpoint` (via `createFetchSam3Client`) or a fully
 * custom implementation (e.g. to add retries, auth headers, or route through
 * their own backend proxy).
 */
export interface Sam3Client {
   predict: (payload: Record<string, unknown>, token: string) => Promise<any>;
}

// ---------------------------------------------------------------------------
// EngineContext – everything the generic shell exposes to an engine.
// `engineState` is an engine-private interaction blob whose shape each engine
// defines via createInitialEngineState().
// ---------------------------------------------------------------------------
export interface EngineContext<T extends BaseAnnotation> {
   // Working annotation set (already filtered by score/label/flag)
   annotations: T[];
   setAnnotations: Dispatch<SetStateAction<T[]>>;
   generatedAnnotations: T[];

   // Engine-private interaction state
   engineState: any;
   setEngineState: Dispatch<SetStateAction<any>>;

   activeMode: CanvasMode;

   // Selection
   selectedId: string | null;
   setSelectedId: Dispatch<SetStateAction<string | null>>;
   selectedIds: string[];
   setSelectedIds: Dispatch<SetStateAction<string[]>>;
   isControlHeld: boolean;

   // Parent callbacks
   onSelection: (id: string | null) => void;
   onMultiSelection?: (ids: string[]) => void;
   onUpdate: (id: string, updates: Partial<T>) => void;
   onAddition?: (annotations: T[]) => void;

   // Label dialog – engine stores a "pending" payload and the shell later
   // turns it into an annotation via engine.createFromDialog().
   labelValue: string;
   setLabelValue: (v: string) => void;
   openLabelDialog: (pending: any) => void;

   // SAM3
   sam3Client: Sam3Client;
   tapisToken: string;
   setIsSam3Loading: Dispatch<SetStateAction<boolean>>;
   sam3Config: Sam3Config;
   fileName?: string;
   pipeId?: string;
   systemId?: string;

   // Visual helpers
   setCursor: (cursor: string) => void;
   lineWidth: number;
}

export interface DrawState<T extends BaseAnnotation> {
   annotations: T[];
   generatedAnnotations: T[];
   selectedId: string | null;
   selectedIds: string[];
   engineState: any;
   activeMode: CanvasMode;
   lineWidth: number;
}

// ---------------------------------------------------------------------------
// CanvasEngine – the injected strategy that makes ImageCanvas detection- or
// segmentation-aware.  To add a new annotation kind, implement this interface.
// ---------------------------------------------------------------------------
export interface CanvasEngine<T extends BaseAnnotation> {
   /** Fresh engine-private interaction state (reset on mode change / Escape). */
   createInitialEngineState: () => any;

   onMouseDown?: (coords: Coords, ctx: EngineContext<T>) => void;
   onMouseMove?: (coords: Coords, ctx: EngineContext<T>) => void;
   onMouseUp?: (coords: Coords, ctx: EngineContext<T>) => void;
   onMouseLeave?: (coords: Coords, ctx: EngineContext<T>) => void;

   /** Draw annotations/overlays. The shell has already drawn the base image. */
   draw: (ctx2d: CanvasRenderingContext2D, state: DrawState<T>) => void;

   /** Build a new annotation from the label-dialog payload + entered label. */
   createFromDialog: (pending: any, label: string, annotations: T[]) => T | null;

   /** SAM3 text-prompt prediction (imperative, no mouse event). */
   runSam3Text?: (textPrompts: string[], ctx: EngineContext<T>) => void;

   /** Enter key while in DRAWING mode (e.g. close a polygon). */
   onDrawingEnterKey?: (ctx: EngineContext<T>) => void;

   dialogTitle: string;
   labelPlaceholder: string;
}
