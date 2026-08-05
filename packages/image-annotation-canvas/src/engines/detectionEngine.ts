import { getLabelColor } from "../utils";
import { CanvasMode, type Annotation, type CanvasEngine, type Coords, type EngineContext } from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const HANDLE_SIZE = 16;
const LINE_WIDTH_BIG = 4;
const LINE_WIDTH_SMALL = 2;
const FLAG_PALETTE = ["#f57c00", "#1976d2", "#388e3c", "#7b1fa2", "#00838f", "#ad1457", "#6d4c41"];

// ---------------------------------------------------------------------------
// Engine-private interaction state
// ---------------------------------------------------------------------------
interface Interaction {
   type: "none" | "drawing" | "dragging" | "resizing";
   targetId?: string | null;
   handle?: string | null;
   startX?: number;
   startY?: number;
   offsetX?: number;
   offsetY?: number;
   currentX?: number;
   currentY?: number;
   startWidth?: number;
   startHeight?: number;
}

interface DetectionEngineState {
   interaction: Interaction;
   isAnnotationMode: boolean;
}

const initialInteraction: Interaction = {
   type: "none",
   targetId: null,
   handle: null,
   startX: 0,
   startY: 0,
   offsetX: 0,
   offsetY: 0,
};

type Ctx = EngineContext<Annotation>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getHoveredPart(mouseX: number, mouseY: number, box: Annotation): string | null {
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
}

/** Build the SAM3 API payload, keeping filename/pipe/system in one place */
function sam3Payload(ctx: Ctx, x?: number, y?: number, textPrompts?: string[]) {
   const fileName = ctx.fileName;
   return {
      image_path: fileName,
      image_id: fileName?.substring(fileName.lastIndexOf("/") + 1, fileName.lastIndexOf(".")) || "image_0",
      pipe_id: ctx.pipeId || "0",
      system_id: ctx.systemId || "pitzer-tapis",
      ...(ctx.sam3Config.patchSize > 0 ? { patch_size: ctx.sam3Config.patchSize } : {}),
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
      ...(textPrompts ? { text_prompts: textPrompts } : {}),
   };
}

// ---------------------------------------------------------------------------
// Action handlers – one object per CanvasMode.
// ---------------------------------------------------------------------------
interface CanvasActionHandler {
   cursor?: string;
   onMouseDown?: (coords: Coords, ctx: Ctx) => void;
   onMouseMove?: (coords: Coords, ctx: Ctx) => void;
   onMouseUp?: (coords: Coords, ctx: Ctx) => void;
}

/** Free-hand bounding-box drawing */
const drawingHandler: CanvasActionHandler = {
   cursor: "crosshair",
   onMouseDown({ x, y }, ctx) {
      // Click on existing box → select it (control or command = toggle multi-select)
      for (const box of ctx.annotations) {
         if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
            ctx.setEngineState((s: DetectionEngineState) => ({ ...s, isAnnotationMode: false }));
            if (ctx.isControlHeld) {
               const next = ctx.selectedIds.includes(box.id)
                  ? ctx.selectedIds.filter((id) => id !== box.id)
                  : [...ctx.selectedIds, box.id];
               ctx.setSelectedIds(next);
               ctx.onMultiSelection?.(next);
            } else {
               ctx.setSelectedIds([]);
               ctx.onMultiSelection?.([]);
               ctx.onSelection(box.id);
            }
            return;
         }
      }
      // Click on empty area – clear multi-selection and start drawing
      ctx.setSelectedIds([]);
      ctx.onMultiSelection?.([]);
      ctx.setEngineState({ isAnnotationMode: true, interaction: { type: "drawing", startX: x, startY: y, currentX: x, currentY: y } });
   },
   onMouseMove({ x, y }, ctx) {
      const s = ctx.engineState as DetectionEngineState;
      if (!s.isAnnotationMode) return;
      ctx.setEngineState((prev: DetectionEngineState) => ({ ...prev, interaction: { ...prev.interaction, currentX: x, currentY: y } }));
   },
   onMouseUp(_coords, ctx) {
      const s = ctx.engineState as DetectionEngineState;
      if (!s.isAnnotationMode) return;
      const { startX, startY, currentX, currentY } = s.interaction;
      const width = Math.abs(currentX! - startX!);
      const height = Math.abs(currentY! - startY!);
      if (width < 5 || height < 5) {
         ctx.setEngineState((prev: DetectionEngineState) => ({ ...prev, isAnnotationMode: false, interaction: { type: "none", targetId: prev.interaction.targetId } }));
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
      ctx.openLabelDialog(newBox);
      ctx.setEngineState((prev: DetectionEngineState) => ({ ...prev, isAnnotationMode: false, interaction: { type: "none", targetId: prev.interaction.targetId } }));
   },
};

/** Drag / resize existing boxes */
const boxEditHandler: CanvasActionHandler = {
   cursor: undefined, // hover-computed in engine.onMouseMove
   onMouseDown({ x, y }, ctx) {
      for (let i = ctx.annotations.length - 1; i >= 0; i--) {
         const box = ctx.annotations[i];
         const part = getHoveredPart(x, y, box);
         if (!part) continue;
         if (part === "body") {
            ctx.setEngineState((s: DetectionEngineState) => ({ ...s, interaction: { type: "dragging", targetId: box.id, offsetX: x - box.x, offsetY: y - box.y } }));
         } else {
            ctx.setEngineState((s: DetectionEngineState) => ({
               ...s,
               interaction: {
                  type: "resizing",
                  targetId: box.id,
                  handle: part,
                  startX: box.x,
                  startY: box.y,
                  startWidth: box.width,
                  startHeight: box.height,
               },
            }));
         }
         return;
      }
      ctx.setEngineState((s: DetectionEngineState) => ({ ...s, interaction: { type: "none", targetId: null } }));
   },
   onMouseMove({ x, y }, ctx) {
      const interaction = (ctx.engineState as DetectionEngineState).interaction;
      if (interaction.type === "dragging") {
         ctx.setAnnotations((prev) =>
            prev.map((box) =>
               box.id === interaction.targetId
                  ? { ...box, x: x - interaction.offsetX!, y: y - interaction.offsetY! }
                  : box
            )
         );
      } else if (interaction.type === "resizing") {
         const { targetId, handle, startX, startY, startWidth, startHeight } = interaction;
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
      const interaction = (ctx.engineState as DetectionEngineState).interaction;
      if (interaction.type === "resizing" || interaction.type === "dragging") {
         const target = ctx.annotations.find((b) => b.id === interaction.targetId!);
         if (target) ctx.onUpdate(interaction.targetId!, target);
      }
      ctx.setEngineState((s: DetectionEngineState) => ({ ...s, interaction: { type: "none", targetId: s.interaction.targetId } }));
   },
};

/** SAM3 single-click point prediction */
const sam3ClickHandler: CanvasActionHandler = {
   cursor: "crosshair",
   onMouseUp({ x, y }, ctx) {
      ctx.setIsSam3Loading(true);
      ctx.sam3Client
         .predict(sam3Payload(ctx, Math.round(x), Math.round(y)), ctx.tapisToken)
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
               // No direct write into the canvas's internal state: this callback can
               // resolve after the user navigated to another image, and a direct
               // write would paint the result over whatever image is on screen.
               // onAddition stores the boxes in the originating file's map slot
               // (captured in this closure at request time); if that file is still
               // displayed, the canvas syncs back through props.
               ctx.onAddition?.(newAnnotations);
            }
         })
         .catch((err: any) => {
            console.error("SAM3 click prediction failed:", err);
            alert("SAM3 click prediction failed. Please try again.");
         })
         .finally(() => ctx.setIsSam3Loading(false));
   },
};

/** Selection-only handler – select/deselect without drawing or editing */
const selectionHandler: CanvasActionHandler = {
   cursor: "default",
   onMouseDown({ x, y }, ctx) {
      for (const box of ctx.annotations) {
         if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
            if (ctx.isControlHeld) {
               const next = ctx.selectedIds.includes(box.id)
                  ? ctx.selectedIds.filter((id) => id !== box.id)
                  : [...ctx.selectedIds, box.id];
               ctx.setSelectedIds(next);
               ctx.onMultiSelection?.(next);
            } else {
               ctx.setSelectedIds([]);
               ctx.onMultiSelection?.([]);
               ctx.onSelection(box.id);
            }
            return;
         }
      }
      ctx.setSelectedIds([]);
      ctx.onMultiSelection?.([]);
      ctx.onSelection(null);
   },
};

/** Registry: CanvasMode → handler. */
const ACTION_HANDLERS: Record<CanvasMode, CanvasActionHandler> = {
   [CanvasMode.NONE]: selectionHandler,
   [CanvasMode.DRAWING]: drawingHandler,
   [CanvasMode.EDIT]: boxEditHandler,
   [CanvasMode.SAM3_CLICK]: sam3ClickHandler,
   [CanvasMode.SAM3_TEXT]: selectionHandler,
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
export const detectionEngine: CanvasEngine<Annotation> = {
   dialogTitle: "New annotation",
   labelPlaceholder: "e.g., person, cat",

   createInitialEngineState: (): DetectionEngineState => ({
      interaction: { ...initialInteraction },
      isAnnotationMode: false,
   }),

   onMouseDown(coords, ctx) {
      ACTION_HANDLERS[ctx.activeMode]?.onMouseDown?.(coords, ctx);
   },

   onMouseMove(coords, ctx) {
      const handler = ACTION_HANDLERS[ctx.activeMode];
      const interaction = (ctx.engineState as DetectionEngineState).interaction;
      if (handler?.cursor) {
         ctx.setCursor(handler.cursor);
      } else if (ctx.activeMode === CanvasMode.EDIT && (!interaction.type || interaction.type === "none")) {
         let cursor = "default";
         for (const box of ctx.annotations) {
            const part = getHoveredPart(coords.x, coords.y, box);
            if (part) {
               cursor = part === "body" ? "move" : (part === "topLeft" || part === "bottomRight" ? "nwse-resize" : "nesw-resize");
               break;
            }
         }
         ctx.setCursor(cursor);
      }
      handler?.onMouseMove?.(coords, ctx);
   },

   onMouseUp(coords, ctx) {
      ACTION_HANDLERS[ctx.activeMode]?.onMouseUp?.(coords, ctx);
   },

   onMouseLeave(coords, ctx) {
      // Commit any in-progress drag/draw when cursor leaves canvas
      if ((ctx.engineState as DetectionEngineState).interaction.type !== "none") {
         ACTION_HANDLERS[ctx.activeMode]?.onMouseUp?.(coords, ctx);
      }
   },

   createFromDialog(pending: Annotation, label: string) {
      return { ...pending, label };
   },

   runSam3Text(textPrompts, ctx) {
      ctx.setIsSam3Loading(true);
      ctx.sam3Client
         .predict(sam3Payload(ctx, undefined, undefined, textPrompts), ctx.tapisToken)
         .then((res: any) => {
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
               // No direct write into the canvas's internal state: this callback can
               // resolve after the user navigated to another image, and a direct
               // write would paint the result over whatever image is on screen.
               // onAddition stores the boxes in the originating file's map slot
               // (captured in this closure at request time); if that file is still
               // displayed, the canvas syncs back through props.
               ctx.onAddition?.(newAnnotations);
            }
         })
         .catch((err: any) => {
            console.error("SAM3 text prediction failed:", err);
            alert("SAM3 text prediction failed. Please try again.");
         })
         .finally(() => ctx.setIsSam3Loading(false));
   },

   draw(ctx2d, state) {
      const { annotations, generatedAnnotations, selectedId, selectedIds, lineWidth } = state;
      const interaction = (state.engineState as DetectionEngineState).interaction;

      annotations.forEach((box) => {
         const labelColor = getLabelColor(box.label);
         const isSingleSelected = box.id === selectedId;
         const isMultiSelected = selectedIds.includes(box.id);
         const boxColor = (isSingleSelected || isMultiSelected) ? "#e53935" : labelColor;

         ctx2d.strokeStyle = boxColor;
         ctx2d.lineWidth = isMultiSelected ? lineWidth + 1 : lineWidth;
         if (isMultiSelected && !isSingleSelected) ctx2d.setLineDash([8, 4]);
         ctx2d.strokeRect(box.x, box.y, box.width, box.height);
         ctx2d.setLineDash([]);

         // Label badge
         ctx2d.fillStyle = boxColor;
         ctx2d.font = "14px Arial";
         const textWidth = ctx2d.measureText(box.label).width;
         ctx2d.fillRect(box.x, box.y - 20, textWidth + 8, 20);
         ctx2d.fillStyle = "white";
         ctx2d.fillText(box.label, box.x + 4, box.y - 5);

         // Flag indicator – coloured dot in the top-right corner of the box
         if (box.flag) {
            let hashCode = 0;
            for (let i = 0; i < box.flag.length; i++) hashCode = (hashCode * 31 + box.flag.charCodeAt(i)) & 0xffffffff;
            const flagCol = FLAG_PALETTE[Math.abs(hashCode) % FLAG_PALETTE.length];
            const dotR = 7;
            const dotX = box.x + box.width - dotR - 3;
            const dotY = box.y + dotR + 3;
            ctx2d.beginPath();
            ctx2d.arc(dotX, dotY, dotR, 0, Math.PI * 2);
            ctx2d.fillStyle = flagCol;
            ctx2d.fill();
            ctx2d.strokeStyle = "#ffffff";
            ctx2d.lineWidth = 1.5;
            ctx2d.stroke();
         }

         if (interaction.targetId === box.id && interaction.type !== "drawing") {
            ctx2d.fillStyle = "#ffffff";
            ctx2d.strokeStyle = "#000000";
            ctx2d.lineWidth = LINE_WIDTH_SMALL;
            [
               { x: box.x, y: box.y },
               { x: box.x + box.width, y: box.y },
               { x: box.x, y: box.y + box.height },
               { x: box.x + box.width, y: box.y + box.height },
            ].forEach((h) => {
               ctx2d.beginPath();
               ctx2d.rect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
               ctx2d.fill();
               ctx2d.stroke();
            });
         }
      });

      generatedAnnotations.forEach((box) => {
         ctx2d.strokeStyle = "#e65100";
         ctx2d.lineWidth = LINE_WIDTH_BIG;
         ctx2d.strokeRect(box.x, box.y, box.width, box.height);
         ctx2d.fillStyle = "#e65100";
         ctx2d.font = "14px Arial";
         const textWidth = ctx2d.measureText(box.label).width;
         ctx2d.fillRect(box.x, box.y - 20, textWidth + 8, 20);
         ctx2d.fillStyle = "white";
         ctx2d.fillText(box.label, box.x + 4, box.y - 5);
      });

      if (interaction.type === "drawing") {
         ctx2d.strokeStyle = "rgba(255, 0, 0, 0.7)";
         ctx2d.lineWidth = lineWidth;
         ctx2d.setLineDash([5, 5]);
         const { startX, startY, currentX, currentY } = interaction;
         ctx2d.strokeRect(startX!, startY!, currentX! - startX!, currentY! - startY!);
         ctx2d.setLineDash([]);
      }
   },
};
