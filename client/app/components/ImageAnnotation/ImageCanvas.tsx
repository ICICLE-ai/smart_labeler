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
import {
   TransformComponent,
   TransformWrapper,
   type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Controls from "./controls";
import { sam3Predictions } from "~/utils/utils";
import { useCookies } from "react-cookie";
import { SAM3_MODES, getLabelColor } from "./utils";

// ---------------------------------------------------------------------------
// Canvas mode – single source of truth for which tool is active.
// To add a new mode: add a value here and register a handler in ACTION_HANDLERS.
// ---------------------------------------------------------------------------
export enum CanvasMode {
   NONE = "NONE",
   DRAWING = "DRAWING",
   BOX_EDIT = "BOX_EDIT",
   SAM3_CLICK = "SAM3_CLICK",
   SAM3_TEXT = "SAM3_TEXT",
}

// Each mode exposes three optional mouse callbacks plus a CSS cursor string.
interface CanvasActionContext {
   annotations: Annotation[];
   setAnnotations: React.Dispatch<React.SetStateAction<Annotation[]>>;
   interaction: Interaction;
   setInteraction: React.Dispatch<React.SetStateAction<Interaction>>;
   isAnnotationMode: boolean;
   setIsAnnotationMode: React.Dispatch<React.SetStateAction<boolean>>;
   setDraftRect: React.Dispatch<React.SetStateAction<Annotation | null>>;
   setLabelDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
   setLabelValue: React.Dispatch<React.SetStateAction<string>>;
   labelValue: string;
   onBoxSelection: (id: string | null) => void;
   onBoxUpdate: (id: string, updates: Partial<Annotation>) => void;
   onBoxAddition?: (annotations: Annotation[]) => void;
   sam3Payload: (x?: number, y?: number, textPrompts?: string[]) => object;
   tapisToken: string;
   getHoveredPart: (mx: number, my: number, box: Annotation) => string | null;
   // Multi-selection
   selectedBoxIds: string[];
   setSelectedBoxIds: React.Dispatch<React.SetStateAction<string[]>>;
   onBoxMultiSelection?: (ids: string[]) => void;
   isControlHeld: boolean;
   setIsSam3Loading: React.Dispatch<React.SetStateAction<boolean>>;
}

interface CanvasActionHandler {
   cursor?: string;
   onMouseDown?: (coords: { x: number; y: number }, ctx: CanvasActionContext) => void;
   onMouseMove?: (coords: { x: number; y: number }, ctx: CanvasActionContext) => void;
   onMouseUp?: (coords: { x: number; y: number }, ctx: CanvasActionContext) => void;
}

const SCROLL_STEP = 100;
const HANDLE_SIZE = 16;
const LINE_WIDTH_BIG = 4;
const LINE_WIDTH_SMALL = 2;

export interface Annotation {
   id: string;
   x: number;
   y: number;
   width: number;
   height: number;
   label: string;
   score?: number;
   iou?: number;
   flag?: string;
}

interface Interaction {
   type: InteractionType; // 'none', 'drawing', 'dragging', 'resizing'
   targetId?: string | null;
   handle?: string | null; // e.g., 'topLeft', 'bottomRight', 'body'
   startX?: number;
   startY?: number;
   offsetX?: number;
   offsetY?: number;
   currentX?: number; // For drawing
   currentY?: number; // For drawing
   startWidth?: number; // For resizing
   startHeight?: number; // For resizing
}

type InteractionType = "none" | "drawing" | "dragging" | "resizing";

// ---------------------------------------------------------------------------
// Action handlers – one object per CanvasMode.
// To add a new mode: create a handler here and register it below.
// ---------------------------------------------------------------------------

/** Free-hand bounding-box drawing */
const drawingHandler: CanvasActionHandler = {
   cursor: "crosshair",
   onMouseDown({ x, y }, ctx) {
      // Click on existing box → select it (control or command = toggle multi-select)
      for (const box of ctx.annotations) {
         if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
            ctx.setIsAnnotationMode(false);
            if (ctx.isControlHeld) {
               const next = ctx.selectedBoxIds.includes(box.id)
                  ? ctx.selectedBoxIds.filter((id) => id !== box.id)
                  : [...ctx.selectedBoxIds, box.id];
               ctx.setSelectedBoxIds(next);
               ctx.onBoxMultiSelection?.(next);
            } else {
               ctx.setSelectedBoxIds([]);
               ctx.onBoxMultiSelection?.([]);
               ctx.onBoxSelection(box.id);
            }
            return;
         }
      }
      // Click on empty area – clear multi-selection and start drawing
      ctx.setSelectedBoxIds([]);
      ctx.onBoxMultiSelection?.([]);
      ctx.setIsAnnotationMode(true);
      ctx.setInteraction({ type: "drawing", startX: x, startY: y, currentX: x, currentY: y });
   },
   onMouseMove({ x, y }, ctx) {
      if (!ctx.isAnnotationMode) return;
      ctx.setInteraction((prev) => ({ ...prev, currentX: x, currentY: y }));
   },
   onMouseUp(_coords, ctx) {
      if (!ctx.isAnnotationMode) return;
      const { startX, startY, currentX, currentY } = ctx.interaction;
      const width = Math.abs(currentX! - startX!);
      const height = Math.abs(currentY! - startY!);
      if (width < 5 || height < 5) {
         ctx.setInteraction({ type: "none", targetId: ctx.interaction.targetId });
         ctx.setDraftRect(null);
         return;
      }
      const newBox: Annotation = {
         id: Date.now().toString(),
         x: Math.min(startX!, currentX!),
         y: Math.min(startY!, currentY!),
         width,
         height,
         label: `Box ${ctx.annotations.length + 1}`,
      };
      ctx.setDraftRect(newBox);
      ctx.setLabelDialogOpen(true);
      ctx.setLabelValue("");
      ctx.setIsAnnotationMode(false);
      ctx.setInteraction({ type: "none", targetId: ctx.interaction.targetId });
   },
};

/** Drag / resize existing boxes */
const boxEditHandler: CanvasActionHandler = {
   cursor: "default",
   onMouseDown({ x, y }, ctx) {
      for (let i = ctx.annotations.length - 1; i >= 0; i--) {
         const box = ctx.annotations[i];
         const part = ctx.getHoveredPart(x, y, box);
         if (!part) continue;
         if (part === "body") {
            ctx.setInteraction({ type: "dragging", targetId: box.id, offsetX: x - box.x, offsetY: y - box.y });
         } else {
            ctx.setInteraction({
               type: "resizing",
               targetId: box.id,
               handle: part,
               startX: box.x,
               startY: box.y,
               startWidth: box.width,
               startHeight: box.height,
            });
         }
         return;
      }
      ctx.setInteraction({ type: "none", targetId: null });
   },
   onMouseMove({ x, y }, ctx) {
      if (ctx.interaction.type === "dragging") {
         ctx.setAnnotations((prev) =>
            prev.map((box) =>
               box.id === ctx.interaction.targetId
                  ? { ...box, x: x - ctx.interaction.offsetX!, y: y - ctx.interaction.offsetY! }
                  : box
            )
         );
      } else if (ctx.interaction.type === "resizing") {
         const { targetId, handle, startX, startY, startWidth, startHeight } = ctx.interaction;
         ctx.setAnnotations((prev) =>
            prev.map((box) => {
               if (box.id !== targetId) return box;
               const nb = { ...box };
               if (handle === "bottomRight") {
                  nb.width = Math.max(10, x - startX!);
                  nb.height = Math.max(10, y - startY!);
               } else if (handle === "bottomLeft") {
                  nb.width = Math.max(10, startX! + startWidth! - x);
                  nb.height = Math.max(10, y - startY!);
                  nb.x = x;
               } else if (handle === "topRight") {
                  nb.width = Math.max(10, x - startX!);
                  nb.height = Math.max(10, startY! + startHeight! - y);
                  nb.y = y;
               } else if (handle === "topLeft") {
                  nb.width = Math.max(10, startX! + startWidth! - x);
                  nb.height = Math.max(10, startY! + startHeight! - y);
                  nb.x = x;
                  nb.y = y;
               }
               return nb;
            })
         );
      }
   },
   onMouseUp(_coords, ctx) {
      if (ctx.interaction.type === "resizing" || ctx.interaction.type === "dragging") {
         ctx.onBoxUpdate(
            ctx.interaction.targetId!,
            ctx.annotations.find((b) => b.id === ctx.interaction.targetId!)!
         );
      }
      ctx.setInteraction({ type: "none", targetId: ctx.interaction.targetId });
   },
};

/** SAM3 single-click point prediction */
const sam3ClickHandler: CanvasActionHandler = {
   cursor: "crosshair",
   onMouseUp({ x, y }, ctx) {
      ctx.setIsSam3Loading(true);
      sam3Predictions(ctx.sam3Payload(Math.round(x), Math.round(y)), ctx.tapisToken)
         .then((res: any) => {
            if (!res?.bboxes?.length) {
               alert("No objects found in the clicked area.");
            } else {
               const newAnnotations: Annotation[] = res.bboxes.map((p: any) => ({
                  id: Date.now().toString(),
                  x: p.x_min,
                  y: p.y_min,
                  width: p.x_max - p.x_min,
                  height: p.y_max - p.y_min,
                  label: ctx.labelValue,
                  score: p.confidence,
               }));
               ctx.setAnnotations((prev) => [...prev, ...newAnnotations]);
               ctx.onBoxAddition?.(newAnnotations);
            }
         })
         .catch((err: any) => {
            console.error("SAM3 click prediction failed:", err);
            alert("SAM3 click prediction failed. Please try again.");
         })
         .finally(() => ctx.setIsSam3Loading(false));
   },
};

/** SAM3 text-prompt prediction – fires immediately when activated, no mouse event needed */
const sam3TextHandler: CanvasActionHandler = {
   cursor: "default",
   // Text prediction is triggered imperatively via handleSam3TextPrompt; no mouse handlers needed
};

/** Selection-only handler – allows selecting/deselecting annotations without drawing or editing */
const selectionHandler: CanvasActionHandler = {
   cursor: "default",
   onMouseDown({ x, y }, ctx) {
      // Click on existing box → select it (Shift = toggle multi-select)
      for (const box of ctx.annotations) {
         if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
            if (ctx.isControlHeld) {
               const next = ctx.selectedBoxIds.includes(box.id)
                  ? ctx.selectedBoxIds.filter((id) => id !== box.id)
                  : [...ctx.selectedBoxIds, box.id];
               ctx.setSelectedBoxIds(next);
               ctx.onBoxMultiSelection?.(next);
            } else {
               ctx.setSelectedBoxIds([]);
               ctx.onBoxMultiSelection?.([]);
               ctx.onBoxSelection(box.id);
            }
            return;
         }
      }
      // Click on empty area – clear selection
      ctx.setSelectedBoxIds([]);
      ctx.onBoxMultiSelection?.([]);
      ctx.onBoxSelection(null);
   },
};

/** Registry: CanvasMode → handler.  Add new modes here. */
const ACTION_HANDLERS: Record<CanvasMode, CanvasActionHandler> = {
   [CanvasMode.NONE]: selectionHandler,
   [CanvasMode.DRAWING]: drawingHandler,
   [CanvasMode.BOX_EDIT]: boxEditHandler,
   [CanvasMode.SAM3_CLICK]: sam3ClickHandler,
   [CanvasMode.SAM3_TEXT]: selectionHandler,
};

const ImageCanvas = (props: {
   fileName?: string;
   systemId?: string;
   pipeId?: string;
   file: any | null;
   boxes: Annotation[] | [];
   generatedBoxes?: Annotation[] | [];
   isEditable?: boolean;
   onBoxAddition?: (annotations: Annotation[]) => void;
   selectedAnnotationId: string | null;
   selectedAnnotationIds?: string[];
   onBoxSelection: (id: string | null) => void;
   onBoxMultiSelection?: (ids: string[]) => void;
   onBoxUpdate: (id: string, updates: Partial<Annotation>) => void;
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
}) => {
   // ---------------------------------------------------------------------------
   // State
   // ---------------------------------------------------------------------------
   const [activeMode, setActiveMode] = useState<CanvasMode>(CanvasMode.NONE);
   const [scale, setScale] = useState<number>(1);
   const transformContainerRef = useRef(null);
   const parentRef = useRef<HTMLDivElement>(null);
   const canvasRef = useRef<HTMLCanvasElement>(null);
   const isControlHeld = useRef<boolean>(false);
   const [annotations, setAnnotations] = useState<Annotation[]>(props.boxes);
   const [generatedAnnotations, setGeneratedAnnotations] = useState<Annotation[]>(props.generatedBoxes || []);
   const [naturalHeight, setNaturalHeight] = useState<number>(1);
   const [naturalWidth, setNaturalWidth] = useState<number>(1);
   const [trueScale, setTrueScale] = useState<number>(1);
   const [isAnnotationMode, setIsAnnotationMode] = useState<boolean>(false);

   const [image, setImage] = useState<HTMLImageElement | null>(null);
   const [displayImage, setDisplayImage] = useState<boolean | null>(true);
   const [file, setFile] = useState<any | null>(props.file);

   const [labelDialogOpen, setLabelDialogOpen] = useState<boolean>(false);
   const [draftRect, setDraftRect] = useState<Annotation | null>(null);
   const [labelValue, setLabelValue] = useState<string>("");
   const [selectedBoxId, setSelectedBoxId] = useState<string | null>(props.selectedAnnotationId);
   const [selectedBoxIds, setSelectedBoxIds] = useState<string[]>(props.selectedAnnotationIds ?? []);
   const [bulkEditOpen, setBulkEditOpen] = useState<boolean>(false);
   const [bulkLabelValue, setBulkLabelValue] = useState<string>("");
   const [initialScale, setInitialScale] = useState<number>(2.7);
   const [interaction, setInteraction] = useState<Interaction>({
      type: "none",
      targetId: null,
      handle: null,
      startX: 0,
      startY: 0,
      offsetX: 0,
      offsetY: 0,
   });
   const [editable, setEditable] = useState<boolean>(props.isEditable || false);
   const [graphEnabled, setGraphEnabled] = useState<boolean>(props.isGraphMode || false);
   const [sam3PatchSize, setSam3PatchSize] = useState<number>(0);
   const [isSam3Loading, setIsSam3Loading] = useState<boolean>(false);
   const [lineWidth, setLineWidth] = useState<number>(8);
   const [cookie] = useCookies(["tapis-token"]);

   // Derived helpers – keeps handlers decoupled from component internals
   const isCanvasActive = activeMode !== CanvasMode.NONE;

   // ---------------------------------------------------------------------------
   // Effects
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

   useEffect(() => { setSelectedBoxId(props.selectedAnnotationId); }, [props.selectedAnnotationId]);
   useEffect(() => { setSelectedBoxIds(props.selectedAnnotationIds ?? []); }, [props.selectedAnnotationIds]);
   useEffect(() => { setAnnotations(props.boxes); }, [props.boxes]);
   useEffect(() => { setGeneratedAnnotations(props.generatedBoxes || []); }, [props.generatedBoxes]);

   // Filter visible annotations when score/label filters change
   useEffect(() => {
      setAnnotations(
         props.boxes.filter((box) => {
            const passScore = box.score === undefined || (props.score !== undefined && box.score >= props.score);
            const passLabel = !props.activeLabels?.length || props.activeLabels.includes(box.label);
            const passFlag = !props.activeFlags?.length || props.activeFlags.some((f) => box.flag?.includes(f));
            return passScore && passLabel && passFlag;
         })
      );
   }, [props.score, props.activeLabels, props.activeFlags, props.boxes]);

   useEffect(() => {
      const handleResize = () => {
         setInitialScale(window.innerWidth > 1500 ? 2.7 : window.innerWidth > 1000 ? 3.5 : 4.0);
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

   // Keyboard: Delete/Backspace removes all selected boxes; Escape clears selection and resets mode
   useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
         const active = document.activeElement;
         if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active as HTMLElement)?.isContentEditable) return;

         if (e.key === "Delete") {
            const toDelete = selectedBoxIds.length > 0
               ? selectedBoxIds
               : selectedBoxId ? [selectedBoxId] : [];
            if (!toDelete.length) return;
            setAnnotations((prev) => prev.filter((b) => !toDelete.includes(b.id)));
            props.deleteAnnotations && props.deleteAnnotations(toDelete);
            setSelectedBoxIds([]);
            setSelectedBoxId(null);
            props.onBoxMultiSelection?.([]);
            props.onBoxSelection(null);
         } else if (e.key === "Escape") {
            // Reset all mode-related state
            setActiveMode(CanvasMode.NONE);
            setSelectedBoxIds([]);
            setSelectedBoxId(null);
            setIsAnnotationMode(false);
            setDraftRect(null);
            setLabelDialogOpen(false);
            setLabelValue("");
            setInteraction({ type: "none", targetId: null, handle: null, startX: 0, startY: 0, offsetX: 0, offsetY: 0 });
            setIsSam3Loading(false);
            props.onBoxMultiSelection?.([]);
            props.onBoxSelection(null);
            // Dispatch event to notify Controls component to reset all tools
            window.dispatchEvent(new Event("canvas-escape-pressed"));
         }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
   }, [selectedBoxIds, selectedBoxId]);

   // Track Control and Command key for multi-select
   useEffect(() => {
      const onDown = (e: KeyboardEvent) => { if (e.key === "Control" || e.key === "Meta") isControlHeld.current = true; };
      const onUp = (e: KeyboardEvent) => { if (e.key === "Control" || e.key === "Meta") isControlHeld.current = false; };
      window.addEventListener("keydown", onDown);
      window.addEventListener("keyup", onUp);
      return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
   }, []);

   useEffect(() => {
      const canvas = canvasRef.current;
      if (canvas && image) {
         canvas.width = image.naturalWidth;
         canvas.height = image.naturalHeight;
      }
      setInitialScale(window.innerWidth > 1500 ? 2.7 : window.innerWidth > 1000 ? 4.0 : 4.5);
      draw();
   }, [image]);

   useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !image) return;
      const canvasRect = canvas.getBoundingClientRect();
      setTrueScale(Math.min(1, Math.min(canvasRect.width / naturalWidth, canvasRect.height / naturalHeight)));
   }, [image, annotations, selectedBoxId, generatedAnnotations]);

   useEffect(() => {
      if (!graphEnabled) {
         const canvas = canvasRef.current;
         if (canvas && image) { canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; }
         draw();
      } else {
         props.handleRenderGraph?.();
         // Reset zoom/pan when entering graph mode for better fit
         if (transformContainerRef.current) {
            const instance = (transformContainerRef.current as any).instance;
            if (instance && typeof instance.resetTransform === "function") {
               instance.resetTransform();
            }
         }
      }
   }, [graphEnabled]);

   // ---------------------------------------------------------------------------
   // Helpers
   // ---------------------------------------------------------------------------
   const getCanvasCoordinates = (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left) / trueScale, y: (event.clientY - rect.top) / trueScale };
   };

   const getHoveredPart = (mouseX: number, mouseY: number, box: Annotation) => {
      const { x, y, width, height } = box;
      const handles = {
         topLeft: { x, y },
         topRight: { x: x + width, y },
         bottomLeft: { x, y: y + height },
         bottomRight: { x: x + width, y: y + height },
      };
      for (const [key, pos] of Object.entries(handles)) {
         if (mouseX >= pos.x - HANDLE_SIZE / 2 && mouseX <= pos.x + HANDLE_SIZE / 2 &&
            mouseY >= pos.y - HANDLE_SIZE / 2 && mouseY <= pos.y + HANDLE_SIZE / 2) return key;
      }
      if (mouseX >= x && mouseX <= x + width && mouseY >= y && mouseY <= y + height) return "body";
      return null;
   };

   /** Build the SAM3 API payload, keeping filename/pipe/system in one place */
   const sam3Payload = (x?: number, y?: number, textPrompts?: string[]) => ({
      image_path: props.fileName,
      image_id: props.fileName?.substring(props.fileName.lastIndexOf("/") + 1, props.fileName.lastIndexOf(".")) || "image_0",
      pipe_id: props.pipeId || "0",
      system_id: props.systemId || "pitzer-tapis",
      ...(sam3PatchSize > 0 ? { patch_size: sam3PatchSize } : {}),
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
      ...(textPrompts ? { text_prompts: textPrompts } : {}),
   });

   // ---------------------------------------------------------------------------
   // Draw
   // ---------------------------------------------------------------------------
   const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas || !image) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      annotations.forEach((box) => {
         const labelColor = getLabelColor(box.label);
         const isSingleSelected = box.id === selectedBoxId;
         const isMultiSelected = selectedBoxIds.includes(box.id);
         // Red (#e53935) = selected; label color otherwise
         const boxColor = (isSingleSelected || isMultiSelected) ? "#e53935" : labelColor;

         ctx.strokeStyle = boxColor;
         ctx.lineWidth = isMultiSelected ? lineWidth + 1 : lineWidth;
         // Dashed outline for multi-selected boxes
         if (isMultiSelected && !isSingleSelected) ctx.setLineDash([8, 4]);
         ctx.strokeRect(box.x, box.y, box.width, box.height);
         ctx.setLineDash([]);

         // Label badge
         ctx.fillStyle = boxColor;
         ctx.font = "14px Arial";
         const textWidth = ctx.measureText(box.label).width;
         ctx.fillRect(box.x, box.y - 20, textWidth + 8, 20);
         ctx.fillStyle = "white";
         ctx.fillText(box.label, box.x + 4, box.y - 5);

         // Flag indicator – small coloured dot in the top-right corner of the box
         if (box.flag) {
            const FLAG_PALETTE_DRAW = ["#f57c00", "#1976d2", "#388e3c", "#7b1fa2", "#00838f", "#ad1457", "#6d4c41"];
            let hashCode = 0;
            for (let i = 0; i < box.flag.length; i++) hashCode = (hashCode * 31 + box.flag.charCodeAt(i)) & 0xffffffff;
            const flagColor = FLAG_PALETTE_DRAW[Math.abs(hashCode) % FLAG_PALETTE_DRAW.length];
            const dotR = 7;
            const dotX = box.x + box.width - dotR - 3;
            const dotY = box.y + dotR + 3;
            ctx.beginPath();
            ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
            ctx.fillStyle = flagColor;
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.5;
            ctx.stroke();
         }

         if (interaction.targetId === box.id && interaction.type !== "drawing") {
            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = "#000000";
            ctx.lineWidth = LINE_WIDTH_SMALL;
            [
               { x: box.x, y: box.y },
               { x: box.x + box.width, y: box.y },
               { x: box.x, y: box.y + box.height },
               { x: box.x + box.width, y: box.y + box.height },
            ].forEach((h) => {
               ctx.beginPath();
               ctx.rect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
               ctx.fill();
               ctx.stroke();
            });
         }
      });

      generatedAnnotations.forEach((box) => {
         ctx.strokeStyle = "#e65100";
         ctx.lineWidth = LINE_WIDTH_BIG;
         ctx.strokeRect(box.x, box.y, box.width, box.height);
         ctx.fillStyle = "#e65100";
         ctx.font = "14px Arial";
         const textWidth = ctx.measureText(box.label).width;
         ctx.fillRect(box.x, box.y - 20, textWidth + 8, 20);
         ctx.fillStyle = "white";
         ctx.fillText(box.label, box.x + 4, box.y - 5);
      });

      if (interaction.type === "drawing") {
         ctx.strokeStyle = "rgba(255, 0, 0, 0.7)";
         ctx.lineWidth = lineWidth;
         ctx.setLineDash([5, 5]);
         const { startX, startY, currentX, currentY } = interaction;
         ctx.strokeRect(startX!, startY!, currentX! - startX!, currentY! - startY!);
         ctx.setLineDash([]);
      }
   }, [image, annotations, interaction, selectedBoxId, selectedBoxIds, generatedAnnotations, lineWidth]);

   useEffect(() => { draw(); }, [draw]);

   // ---------------------------------------------------------------------------
   // Unified mouse dispatcher – delegates to the active handler
   // ---------------------------------------------------------------------------
   const buildContext = (): CanvasActionContext => ({
      annotations,
      setAnnotations,
      interaction,
      setInteraction,
      isAnnotationMode,
      setIsAnnotationMode,
      setDraftRect,
      setLabelDialogOpen,
      setLabelValue,
      labelValue,
      onBoxSelection: props.onBoxSelection,
      onBoxUpdate: props.onBoxUpdate,
      onBoxAddition: props.onBoxAddition,
      sam3Payload,
      tapisToken: cookie["tapis-token"]?.["access_token"] ?? "",
      getHoveredPart,
      selectedBoxIds,
      setSelectedBoxIds,
      onBoxMultiSelection: props.onBoxMultiSelection,
      isControlHeld: isControlHeld.current,
      setIsSam3Loading,
   });

   const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
      ACTION_HANDLERS[activeMode]?.onMouseDown?.(getCanvasCoordinates(e), buildContext());
   };

   const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const coords = getCanvasCoordinates(e);
      // Update cursor from active handler or hover state
      if (canvas) {
         const handler = ACTION_HANDLERS[activeMode];
         if (handler?.cursor) {
            canvas.style.cursor = handler.cursor;
         } else if (activeMode === CanvasMode.BOX_EDIT && (!interaction.type || interaction.type === "none")) {
            let cursor = "default";
            for (const box of annotations) {
               const part = getHoveredPart(coords.x, coords.y, box);
               if (part) { cursor = part === "body" ? "move" : (part === "topLeft" || part === "bottomRight" ? "nwse-resize" : "nesw-resize"); break; }
            }
            canvas.style.cursor = cursor;
         }
      }
      ACTION_HANDLERS[activeMode]?.onMouseMove?.(coords, buildContext());
   };

   const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
      ACTION_HANDLERS[activeMode]?.onMouseUp?.(getCanvasCoordinates(e), buildContext());
   };

   const handleMouseLeave = (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Commit any in-progress drag/draw when cursor leaves canvas
      if (interaction.type !== "none") handleMouseUp(e);
   };

   // ---------------------------------------------------------------------------
   // SAM3 text-prompt trigger (imperative, not mouse-driven)
   // ---------------------------------------------------------------------------
   const handleSam3TextPrompt = (textPrompts: string[]) => {
      setIsSam3Loading(true);
      sam3Predictions(sam3Payload(undefined, undefined, textPrompts), cookie["tapis-token"]?.["access_token"] ?? "")
         .then((res: any) => {
            console.log("SAM3 text prediction response:", res);
            if (!res?.bboxes?.length) {
               alert("No objects found matching the text prompt.");
            } else {
               const newAnnotations: Annotation[] = res.bboxes.map((p: any, i: number) => ({
                  id: `${Date.now()}-${i}`,
                  x: p.x_min,
                  y: p.y_min,
                  width: p.x_max - p.x_min,
                  height: p.y_max - p.y_min,
                  label: p.label,
                  score: p.confidence,
               }));
               setAnnotations((prev) => [...prev, ...newAnnotations]);
               props.onBoxAddition?.(newAnnotations);
            }
         })
         .catch((err: any) => {
            console.error("SAM3 text prediction failed:", err);
            alert("SAM3 text prediction failed. Please try again.");
         })
         .finally(() => setIsSam3Loading(false));
   };

   // ---------------------------------------------------------------------------
   // Label dialog confirmation
   // ---------------------------------------------------------------------------
   const saveDialog = () => {
      if (!draftRect) return;
      const newBox = { ...draftRect, label: labelValue };
      setAnnotations((prev) => [...prev, newBox]);
      props.onBoxAddition?.([newBox]);
      setDraftRect(null);
      setLabelValue("");
      setLabelDialogOpen(false);
   };

   return (
      <>
         <Paper
            elevation={3}
            sx={{
               p: 1,
               height: "90vh",
               display: "flex",
               flexDirection: "column",
               gap: 1,
            }}
         >
            <Box
               ref={parentRef}
               sx={{
                  flex: 1,
                  border: "1px solid black",
                  position: "relative",
                  overflow: "scroll",
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
                     centerOnInit
                     initialPositionX={0}
                     initialPositionY={0}
                     wheel={{ step: SCROLL_STEP }}
                     doubleClick={{ disabled: isCanvasActive }}
                     pinch={{ disabled: isCanvasActive }}
                     panning={{ disabled: isCanvasActive }}
                     maxScale={initialScale}
                     onTransformed={(
                        ref: ReactZoomPanPinchRef,
                        state: { scale: number; positionX: number; positionY: number }
                     ) => {
                        setScale(state.scale);
                        const canvasRect = canvasRef.current!.getBoundingClientRect();
                        setTrueScale(
                           Math.min(1, Math.min(canvasRect.width / naturalWidth, canvasRect.height / naturalHeight))
                        );
                     }}
                  >
                     <Controls
                        isEditable={editable}
                        isDrawing={activeMode === CanvasMode.DRAWING}
                        isEnableBoxEdit={activeMode === CanvasMode.BOX_EDIT}
                        handleDrawingStateChange={(drawing) => {
                           if (drawing) {
                              setActiveMode(CanvasMode.DRAWING);
                           }
                        }}
                        handleEnableBoxEditChange={(edit) => {
                           if (edit) {
                              setActiveMode(CanvasMode.BOX_EDIT);
                           }
                        }}
                        isGraphEnabled={props.isGraphEnabled}
                        handleDisplayTypeSwitch={(type: string) => {
                           setGraphEnabled(type.toUpperCase() === "GRAPH");
                        }}
                        handleSAM3BoxPrediction={(mode, sam3Active, label, textPrompts, isSAHIenabled, patchSize) => {
                           if (sam3Active) {
                              if (label) setLabelValue(label);
                              if (!isSAHIenabled) {
                                 setSam3PatchSize(0);
                              } else {
                                 setSam3PatchSize(patchSize || 0);
                              }
                              if (mode === SAM3_MODES.TEXT_PROMPTS && textPrompts?.length) {
                                 setActiveMode(CanvasMode.SAM3_TEXT);
                                 handleSam3TextPrompt(textPrompts);
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
                     />
                     <TransformComponent>
                        {(graphEnabled && props.graph) ? props.graph : (
                           <canvas
                              ref={canvasRef}
                              width={parentRef.current?.clientWidth || 1}
                              height={parentRef.current?.clientHeight || 1}
                              // onMouseDown={isCanvasActive ? handleMouseDown : undefined}
                              // onMouseMove={isCanvasActive ? handleMouseMove : undefined}
                              // onMouseUp={isCanvasActive ? handleMouseUp : undefined}
                              // onMouseLeave={isCanvasActive ? handleMouseLeave : undefined}
                              onMouseDown={handleMouseDown}
                              onMouseMove={handleMouseMove}
                              onMouseUp={handleMouseUp}
                              onMouseLeave={handleMouseLeave}
                              style={{ width: "100%", display: "block", cursor: "crosshair" }}
                           />
                        )}
                     </TransformComponent>
                  </TransformWrapper>
               ) : (
                  <Box sx={{ width: "100%" }}>
                     <h2>No file selected</h2>
                     <h4 style={{ color: "rgba(0, 0, 0, 0.6)" }}>
                        Select a file to start annotating.
                     </h4>
                  </Box>
               )}
            </Box>
         </Paper>
         <Dialog
            open={labelDialogOpen}
            onClose={() => setLabelDialogOpen(false)}
            maxWidth="xs"
            fullWidth
         >
            <DialogTitle>New annotation</DialogTitle>
            <DialogContent>
               <TextField
                  variant="filled"
                  autoFocus
                  fullWidth
                  label="Label"
                  value={labelValue}
                  onChange={(e) => setLabelValue(e.target.value)}
                  placeholder={"e.g., person, cat"}
               />
            </DialogContent>
            <DialogActions>
               <Button onClick={() => setLabelDialogOpen(false)}>Cancel</Button>
               <Button variant="contained" onClick={saveDialog}>Save</Button>
            </DialogActions>
         </Dialog>

         {/* ── Bulk label edit dialog ── */}
         <Dialog open={bulkEditOpen} onClose={() => setBulkEditOpen(false)} maxWidth="xs" fullWidth>
            <DialogTitle>Edit label for {selectedBoxIds.length} selected annotation{selectedBoxIds.length !== 1 ? "s" : ""}</DialogTitle>
            <DialogContent>
               <TextField
                  variant="filled"
                  autoFocus
                  fullWidth
                  label="New label"
                  value={bulkLabelValue}
                  onChange={(e) => setBulkLabelValue(e.target.value)}
                  onKeyDown={(e) => {
                     if (e.key === "Enter") {
                        const trimmed = bulkLabelValue.trim();
                        if (!trimmed) return;
                        setAnnotations((prev) =>
                           prev.map((b) =>
                              selectedBoxIds.includes(b.id) ? { ...b, label: trimmed } : b
                           )
                        );
                        selectedBoxIds.forEach((id) => {
                           const box = annotations.find((b) => b.id === id);
                           if (box) props.onBoxUpdate(id, { ...box, label: trimmed });
                        });
                        setBulkLabelValue("");
                        setBulkEditOpen(false);
                     }
                  }}
                  placeholder="e.g., person, cat"
               />
            </DialogContent>
            <DialogActions>
               <Button onClick={() => setBulkEditOpen(false)}>Cancel</Button>
               <Button
                  variant="contained"
                  onClick={() => {
                     const trimmed = bulkLabelValue.trim();
                     if (!trimmed) return;
                     setAnnotations((prev) =>
                        prev.map((b) =>
                           selectedBoxIds.includes(b.id) ? { ...b, label: trimmed } : b
                        )
                     );
                     selectedBoxIds.forEach((id) => {
                        const box = annotations.find((b) => b.id === id);
                        if (box) props.onBoxUpdate(id, { ...box, label: trimmed });
                     });
                     setBulkLabelValue("");
                     setBulkEditOpen(false);
                  }}
               >
                  Apply
               </Button>
            </DialogActions>
         </Dialog>
      </>
   );
};

export { ImageCanvas };
