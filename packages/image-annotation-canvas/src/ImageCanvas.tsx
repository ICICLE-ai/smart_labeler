import {
   Box,
   Button,
   Dialog,
   DialogActions,
   DialogContent,
   DialogTitle,
   Paper,
   TextField,
} from "@mui/material";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Controls from "./Controls";
import { MAX_SCALE, SAM3_MODES } from "./utils";
import { createFetchSam3Client } from "./sam3Client";
import {
   CanvasMode,
   type BaseAnnotation,
   type CanvasEngine,
   type EngineContext,
   type Sam3Client,
   type Sam3Config,
} from "./types";

// Re-exports for convenience so most consumers only need one import path.
export { CanvasMode } from "./types";
export type { Annotation, SegmentationAnnotation, BaseAnnotation, CanvasEngine, Sam3Client } from "./types";
export { detectionEngine } from "./engines/detectionEngine";
export { segmentationEngine } from "./engines/segmentationEngine";

const SCROLL_STEP = 100;

interface ImageCanvasProps<T extends BaseAnnotation> {
   /** Strategy that makes the canvas detection- or segmentation-aware. */
   engine: CanvasEngine<T>;
   fileName?: string;
   systemId?: string;
   pipeId?: string;
   file: any | null;
   annotations: T[] | [];
   generatedAnnotations?: T[] | [];
   isEditable?: boolean;
   onAddition?: (annotations: T[]) => void;
   selectedAnnotationId: string | null;
   selectedAnnotationIds?: string[];
   onSelection: (id: string | null) => void;
   onMultiSelection?: (ids: string[]) => void;
   onUpdate: (id: string, updates: Partial<T>) => void;
   deleteAnnotations?: (ids: string[]) => void;
   setFileSize: (size: { width: number; height: number }) => void;
   isGraphMode?: boolean;
   handleRenderGraph?: () => void;
   graph?: React.ReactElement | null;
   isGraphEnabled: boolean;
   score: number;
   activeLabels?: string[];
   activeFlags?: string[];
   onImageLoaded?: () => void;
   /** Bearer/auth token forwarded to the SAM3 prediction request. */
   tapisToken?: string;
   /** Base URL of a SAM3-compatible `/predict` endpoint. Ignored if `sam3Client` is provided. */
   sam3Endpoint?: string;
   /** Custom SAM3 prediction backend. Overrides `sam3Endpoint` when provided. */
   sam3Client?: Sam3Client;
}

function ImageCanvasInner<T extends BaseAnnotation>(props: ImageCanvasProps<T>) {
   const { engine } = props;

   // ---------------------------------------------------------------------------
   // Refs
   // ---------------------------------------------------------------------------
   const transformContainerRef = useRef(null);
   const parentRef = useRef<HTMLDivElement>(null);
   const canvasRef = useRef<HTMLCanvasElement>(null);
   const isControlHeld = useRef<boolean>(false);

   // ---------------------------------------------------------------------------
   // State
   // ---------------------------------------------------------------------------
   const [activeMode, setActiveMode] = useState<CanvasMode>(CanvasMode.NONE);
   const [annotations, setAnnotations] = useState<T[]>(props.annotations);
   const [generatedAnnotations, setGeneratedAnnotations] = useState<T[]>(props.generatedAnnotations || []);
   const [engineState, setEngineState] = useState<any>(() => engine.createInitialEngineState());

   const [naturalHeight, setNaturalHeight] = useState<number>(1);
   const [naturalWidth, setNaturalWidth] = useState<number>(1);
   const [image, setImage] = useState<HTMLImageElement | null>(null);
   const [displayImage, setDisplayImage] = useState<boolean | null>(true);
   const [file, setFile] = useState<any | null>(props.file);

   const [labelDialogOpen, setLabelDialogOpen] = useState<boolean>(false);
   const [pendingAnnotation, setPendingAnnotation] = useState<any>(null);
   const [labelValue, setLabelValue] = useState<string>("");

   const [selectedId, setSelectedId] = useState<string | null>(props.selectedAnnotationId);
   const [selectedIds, setSelectedIds] = useState<string[]>(props.selectedAnnotationIds ?? []);

   const [editable] = useState<boolean>(props.isEditable || false);
   const [graphEnabled, setGraphEnabled] = useState<boolean>(props.isGraphMode || false);
   const [sam3Config, setSam3Config] = useState<Sam3Config>({ patchSize: 0, detectionConfidence: 0.3, maskPrecision: 0.3 });
   const [isSam3Loading, setIsSam3Loading] = useState<boolean>(false);
   const [lineWidth, setLineWidth] = useState<number>(8);
   // Label badges/text default to hidden — only boxes/masks render until the user opts in.
   const [showLabels, setShowLabels] = useState<boolean>(false);

   const sam3Client = useMemo<Sam3Client>(
      () => props.sam3Client ?? createFetchSam3Client(props.sam3Endpoint ?? ""),
      [props.sam3Client, props.sam3Endpoint]
   );

   const isCanvasActive = activeMode !== CanvasMode.NONE;

   // ---------------------------------------------------------------------------
   // Effects – image loading, prop sync, filtering
   // ---------------------------------------------------------------------------
   useEffect(() => {
      if (props.file) {
         setFile(props.file);
         setDisplayImage(true);
         const img = new Image();
         img.src = props.file;
         img.onload = () => {
            setImage(img);
            setNaturalHeight(img.naturalHeight);
            setNaturalWidth(img.naturalWidth);
            props.onImageLoaded?.();
         };
         img.onerror = (e) => console.error("Failed to load image.", e);
      }
   }, [props.file]);

   useEffect(() => { setSelectedId(props.selectedAnnotationId); }, [props.selectedAnnotationId]);
   useEffect(() => { setSelectedIds(props.selectedAnnotationIds ?? []); }, [props.selectedAnnotationIds]);
   useEffect(() => { setGeneratedAnnotations(props.generatedAnnotations || []); }, [props.generatedAnnotations]);

   // Filter visible annotations when score/label/flag filters change
   useEffect(() => {
      setAnnotations(
         props.annotations.filter((ann) => {
            const passScore = ann.score === undefined || (props.score !== undefined && ann.score >= props.score);
            const passLabel = !props.activeLabels?.length || props.activeLabels.includes(ann.label);
            const passFlag = !props.activeFlags?.length || props.activeFlags.some((f) => ann.flag?.includes(f));
            return passScore && passLabel && passFlag;
         })
      );
   }, [props.score, props.activeLabels, props.activeFlags, props.annotations]);

   useEffect(() => {
      const handleResize = () => {
         if (file) {
            const img = new Image();
            img.src = file;
            img.onload = () => {
               setImage(img);
               setNaturalHeight(img.naturalHeight);
               setNaturalWidth(img.naturalWidth);
            };
         }
      };
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [window.innerWidth, window.innerHeight]);

   useEffect(() => { props.setFileSize({ width: naturalWidth, height: naturalHeight }); }, [naturalHeight, naturalWidth]);

   // Keyboard: Delete/Backspace removes selection; Escape resets; Enter → engine hook (e.g. close polygon)
   useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
         const active = document.activeElement;
         if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active as HTMLElement)?.isContentEditable) return;

         if (e.key === "Delete" || e.key === "Backspace") {
            const toDelete = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
            if (!toDelete.length) return;
            setAnnotations((prev) => prev.filter((a) => !toDelete.includes(a.id)));
            props.deleteAnnotations?.(toDelete);
            setSelectedIds([]);
            setSelectedId(null);
            props.onMultiSelection?.([]);
            props.onSelection(null);
         } else if (e.key === "Escape") {
            setActiveMode(CanvasMode.NONE);
            setSelectedIds([]);
            setSelectedId(null);
            setEngineState(engine.createInitialEngineState());
            setLabelDialogOpen(false);
            setPendingAnnotation(null);
            setLabelValue("");
            setIsSam3Loading(false);
            props.onMultiSelection?.([]);
            props.onSelection(null);
            // Notify Controls to reset all tools
            window.dispatchEvent(new Event("canvas-escape-pressed"));
         } else if (e.key === "Enter" && activeMode === CanvasMode.DRAWING) {
            engine.onDrawingEnterKey?.(buildContext());
         }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [selectedIds, selectedId, activeMode, engineState, annotations]);

   // Track Control / Command key for multi-select
   useEffect(() => {
      const onDown = (e: KeyboardEvent) => { if (e.key === "Control" || e.key === "Meta") isControlHeld.current = true; };
      const onUp = (e: KeyboardEvent) => { if (e.key === "Control" || e.key === "Meta") isControlHeld.current = false; };
      window.addEventListener("keydown", onDown);
      window.addEventListener("keyup", onUp);
      return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
   }, []);

   useEffect(() => {
      if (!graphEnabled) {
         draw();
      } else {
         props.handleRenderGraph?.();
         if (transformContainerRef.current) {
            const instance = (transformContainerRef.current as any).instance;
            if (instance && typeof instance.resetTransform === "function") instance.resetTransform();
         }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [graphEnabled]);

   // ---------------------------------------------------------------------------
   // Helpers
   // ---------------------------------------------------------------------------
   const getCanvasCoordinates = (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      // rect reflects post-CSS-transform size (incl. zoom-pan-pinch scale);
      // canvas.width/height = natural image size, so this maps screen → natural px.
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
   };

   const openLabelDialog = (pending: any) => {
      setPendingAnnotation(pending);
      setLabelValue("");
      setLabelDialogOpen(true);
   };

   const setCursor = (cursor: string) => { if (canvasRef.current) canvasRef.current.style.cursor = cursor; };

   const buildContext = (overrides?: Partial<EngineContext<T>>): EngineContext<T> => ({
      annotations,
      setAnnotations,
      generatedAnnotations,
      engineState,
      setEngineState,
      activeMode,
      selectedId,
      setSelectedId,
      selectedIds,
      setSelectedIds,
      isControlHeld: isControlHeld.current,
      onSelection: props.onSelection,
      onMultiSelection: props.onMultiSelection,
      onUpdate: props.onUpdate,
      onAddition: props.onAddition,
      labelValue,
      setLabelValue,
      openLabelDialog,
      sam3Client,
      tapisToken: props.tapisToken ?? "",
      setIsSam3Loading,
      sam3Config,
      fileName: props.fileName,
      pipeId: props.pipeId,
      systemId: props.systemId,
      setCursor,
      lineWidth,
      ...overrides,
   });

   // ---------------------------------------------------------------------------
   // Draw – shell paints the base image, engine paints the overlays
   // ---------------------------------------------------------------------------
   const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas || !image) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      engine.draw(ctx, { annotations, generatedAnnotations, selectedId, selectedIds, engineState, activeMode, lineWidth, showLabels });
   }, [engine, image, annotations, generatedAnnotations, selectedId, selectedIds, engineState, activeMode, lineWidth, showLabels]);

   useEffect(() => { draw(); }, [draw]);

   // ---------------------------------------------------------------------------
   // Mouse dispatch – delegates to the engine
   // ---------------------------------------------------------------------------
   const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => engine.onMouseDown?.(getCanvasCoordinates(e), buildContext());
   const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => engine.onMouseMove?.(getCanvasCoordinates(e), buildContext());
   const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => engine.onMouseUp?.(getCanvasCoordinates(e), buildContext());
   const handleMouseLeave = (e: React.MouseEvent<HTMLCanvasElement>) => engine.onMouseLeave?.(getCanvasCoordinates(e), buildContext());

   // ---------------------------------------------------------------------------
   // Label dialog confirmation
   // ---------------------------------------------------------------------------
   const saveDialog = () => {
      const created = engine.createFromDialog(pendingAnnotation, labelValue, annotations);
      if (created) {
         setAnnotations((prev) => [...prev, created]);
         props.onAddition?.([created]);
      }
      setPendingAnnotation(null);
      setLabelValue("");
      setLabelDialogOpen(false);
   };

   const closeDialog = () => {
      setLabelDialogOpen(false);
      setPendingAnnotation(null);
   };

   return (
      <>
         <Paper elevation={3} sx={{ p: 1, height: "90vh", display: "flex", flexDirection: "column", gap: 1 }}>
            <Box
               ref={parentRef}
               sx={{
                  flex: 1,
                  border: "1px solid black",
                  position: "relative",
                  overflow: "auto",
                  width: "100%",
                  height: "100%",
                  "&::-webkit-scrollbar": { width: "10px", height: "10px" },
                  "&::-webkit-scrollbar-track": { background: "rgba(0,0,0,0.06)", borderRadius: "4px" },
                  "&::-webkit-scrollbar-thumb": { background: "rgba(0,0,0,0.35)", borderRadius: "4px" },
                  "&::-webkit-scrollbar-corner": { background: "transparent" },
                  scrollbarWidth: "thin",
                  scrollbarColor: "rgba(0,0,0,0.35) rgba(0,0,0,0.06)",
               }}
            >
               {displayImage ? (
                  <TransformWrapper
                     ref={transformContainerRef}
                     initialPositionX={0}
                     initialPositionY={0}
                     wheel={{ step: SCROLL_STEP }}
                     doubleClick={{ disabled: true }}
                     pinch={{ disabled: isCanvasActive }}
                     panning={{ disabled: isCanvasActive }}
                     maxScale={MAX_SCALE}
                     minScale={1}
                     limitToBounds={false}
                     centerZoomedOut={true}
                  >
                     <Controls
                        isEditable={editable}
                        isDrawing={activeMode === CanvasMode.DRAWING}
                        isEnableBoxEdit={activeMode === CanvasMode.EDIT}
                        handleDrawingStateChange={(drawing) => {
                           setActiveMode(drawing ? CanvasMode.DRAWING : CanvasMode.NONE);
                           setEngineState(engine.createInitialEngineState());
                        }}
                        handleEnableBoxEditChange={(edit) => {
                           setActiveMode(edit ? CanvasMode.EDIT : CanvasMode.NONE);
                           setEngineState(engine.createInitialEngineState());
                        }}
                        isGraphEnabled={props.isGraphEnabled}
                        handleDisplayTypeSwitch={(type: string) => setGraphEnabled(type.toUpperCase() === "GRAPH")}
                        handleSAM3BoxPrediction={(mode, sam3Active, label, textPrompts, isSAHIenabled, patchSize, detectionConfidence, maskPrecision) => {
                           if (sam3Active) {
                              if (label) setLabelValue(label);
                              const cfg: Sam3Config = {
                                 patchSize: isSAHIenabled ? (patchSize ?? 0) : 0,
                                 detectionConfidence: detectionConfidence ?? 0.3,
                                 maskPrecision: maskPrecision ?? 0.3,
                              };
                              setSam3Config(cfg);
                              if (mode === SAM3_MODES.TEXT_PROMPTS && textPrompts?.length) {
                                 setActiveMode(CanvasMode.SAM3_TEXT);
                                 engine.runSam3Text?.(textPrompts, buildContext({ sam3Config: cfg, labelValue: label ?? labelValue }));
                              } else {
                                 setActiveMode(CanvasMode.SAM3_CLICK);
                              }
                           } else {
                              setLabelValue("");
                              setActiveMode(CanvasMode.NONE);
                           }
                        }}
                        sam3loading={isSam3Loading}
                        lineWidth={lineWidth}
                        onLineWidthChange={(w) => setLineWidth(w)}
                        showLabels={showLabels}
                        onShowLabelsChange={(v) => setShowLabels(v)}
                     />
                     <TransformComponent
                        wrapperStyle={{ width: "100%", height: "auto" }}
                        contentStyle={{ width: "100%", height: "auto", display: "block" }}
                     >
                        {(graphEnabled && props.graph) ? props.graph : (
                           <canvas
                              ref={canvasRef}
                              width={naturalWidth}
                              height={naturalHeight}
                              onMouseDown={handleMouseDown}
                              onMouseMove={handleMouseMove}
                              onMouseUp={handleMouseUp}
                              onMouseLeave={handleMouseLeave}
                              style={{
                                 width: "100%",
                                 height: "auto",
                                 display: "block",
                                 cursor: "crosshair",
                              }}
                           />
                        )}
                     </TransformComponent>
                  </TransformWrapper>
               ) : (
                  <Box sx={{ width: "100%" }}>
                     <h2>No file selected</h2>
                     <h4 style={{ color: "rgba(0, 0, 0, 0.6)" }}>Select a file to start annotating.</h4>
                  </Box>
               )}
            </Box>
         </Paper>

         <Dialog open={labelDialogOpen} onClose={closeDialog} maxWidth="xs" fullWidth>
            <DialogTitle>{engine.dialogTitle}</DialogTitle>
            <DialogContent>
               <TextField
                  variant="filled"
                  autoFocus
                  fullWidth
                  label="Label"
                  value={labelValue}
                  onChange={(e) => setLabelValue(e.target.value)}
                  placeholder={engine.labelPlaceholder}
                  onKeyDown={(e) => { if (e.key === "Enter") saveDialog(); }}
               />
            </DialogContent>
            <DialogActions>
               <Button onClick={closeDialog}>Cancel</Button>
               <Button variant="contained" onClick={saveDialog}>Save</Button>
            </DialogActions>
         </Dialog>
      </>
   );
}

// Generic components can't be exported as-is through some React tooling paths;
// a thin non-generic wrapper keeps the public import surface stable.
const ImageCanvas = ImageCanvasInner as <T extends BaseAnnotation>(props: ImageCanvasProps<T>) => React.ReactElement;

export { ImageCanvas };
export type { ImageCanvasProps };
