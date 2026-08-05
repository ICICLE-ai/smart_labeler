import { getLabelColor } from "../utils";
import { CanvasMode, type CanvasEngine, type Coords, type EngineContext, type SegmentationAnnotation } from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const HANDLE_RADIUS = 7;
const CLOSE_THRESHOLD = 14; // px – clicking within this radius of the first point closes the polygon
const FLAG_PALETTE = ["#f57c00", "#1976d2", "#388e3c", "#c62828", "#7b1fa2", "#00838f", "#ad1457", "#6d4c41"];

type Pt = { x: number; y: number };
type Ctx = EngineContext<SegmentationAnnotation>;

interface SegmentationEngineState {
   draftPoints: Pt[];
   cursorPos: Pt | null;
   dragState: { targetId: string; pointIndex: number } | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
function pointInPolygon(px: number, py: number, pts: Pt[]): boolean {
   let inside = false;
   for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
         inside = !inside;
   }
   return inside;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
   return (ax - bx) ** 2 + (ay - by) ** 2;
}

function flagColor(flag: string): string {
   let h = 0;
   for (let i = 0; i < flag.length; i++) h = (h * 31 + flag.charCodeAt(i)) & 0xffffffff;
   return FLAG_PALETTE[Math.abs(h) % FLAG_PALETTE.length];
}

// Ramer–Douglas–Peucker polygon simplification.
function _perpDist(p: Pt, a: Pt, b: Pt): number {
   const dx = b.x - a.x, dy = b.y - a.y;
   if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
   const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
   return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function rdpSimplify(pts: Pt[], eps: number): Pt[] {
   if (pts.length <= 2) return pts;
   let maxD = 0, maxI = 0;
   for (let i = 1; i < pts.length - 1; i++) {
      const d = _perpDist(pts[i], pts[0], pts[pts.length - 1]);
      if (d > maxD) { maxD = d; maxI = i; }
   }
   if (maxD > eps) {
      const l = rdpSimplify(pts.slice(0, maxI + 1), eps);
      const r = rdpSimplify(pts.slice(maxI), eps);
      return [...l.slice(0, -1), ...r];
   }
   return [pts[0], pts[pts.length - 1]];
}

// Simplify a polygon when it has more than `threshold` vertices.
// epsilon=1.5 px is conservative — preserves shape while cutting 250-pt SAM3
// masks down to ~30–60 pts, which eliminates self-intersection transparency loss.
function simplifyPolygon(pts: Pt[], threshold = 60, epsilon = 1.5): Pt[] {
   if (pts.length <= threshold) return pts;
   const simplified = rdpSimplify(pts, epsilon);
   return simplified.length >= 3 ? simplified : pts;
}

// Converts a SAM3 mask/bbox response object to a polygon point array.
function extractPoints(m: any): Pt[] {
   // m.segmentation: ordered contour from server (cv2.findContours output)
   if (m.segmentation) {
      const seg = m.segmentation;
      if (Array.isArray(seg) && seg.length >= 3 && Array.isArray(seg[0]) && seg[0].length === 2) {
         const pts = (seg as number[][]).map((p) => ({ x: p[0], y: p[1] }));
         return simplifyPolygon(pts);
      }
   }
   // m.points: already {x,y} contour objects
   if (Array.isArray(m.points) && m.points.length >= 3) return simplifyPolygon(m.points);
   // Bounding-box fallback
   return [
      { x: m.x_min, y: m.y_min },
      { x: m.x_max, y: m.y_min },
      { x: m.x_max, y: m.y_max },
      { x: m.x_min, y: m.y_max },
   ];
}

// Returns the top-left corner of the polygon bounding box (label anchor).
function polygonLabelAnchor(pts: Pt[]): Pt {
   const minX = Math.min(...pts.map((p) => p.x));
   const minY = Math.min(...pts.map((p) => p.y));
   return { x: minX, y: minY };
}

function sam3Payload(ctx: Ctx, x?: number, y?: number, textPrompts?: string[]) {
   const fileName = ctx.fileName;
   return {
      image_path: fileName,
      image_id: fileName?.substring(fileName.lastIndexOf("/") + 1, fileName.lastIndexOf(".")) || "image_0",
      pipe_id: ctx.pipeId || "0",
      system_id: ctx.systemId || "pitzer-tapis",
      segmentation: true,
      threshold: ctx.sam3Config.detectionConfidence,
      mask_threshold: ctx.sam3Config.maskPrecision,
      ...(ctx.sam3Config.patchSize > 0 ? { patch_size: ctx.sam3Config.patchSize } : {}),
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
      ...(textPrompts ? { text_prompts: textPrompts } : {}),
   };
}

function closeDraftPolygon(ctx: Ctx) {
   const pts = (ctx.engineState as SegmentationEngineState).draftPoints;
   if (pts.length < 3) return;
   ctx.openLabelDialog([...pts]);
   ctx.setEngineState((s: SegmentationEngineState) => ({ ...s, draftPoints: [], cursorPos: null }));
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
export const segmentationEngine: CanvasEngine<SegmentationAnnotation> = {
   dialogTitle: "New segmentation mask",
   labelPlaceholder: "e.g., car, building, person",

   createInitialEngineState: (): SegmentationEngineState => ({
      draftPoints: [],
      cursorPos: null,
      dragState: null,
   }),

   onMouseDown(coords, ctx) {
      const { x, y } = coords;
      const s = ctx.engineState as SegmentationEngineState;

      if (ctx.activeMode === CanvasMode.DRAWING) {
         // Close polygon if click lands within CLOSE_THRESHOLD of the first point
         if (s.draftPoints.length >= 3 && dist2(x, y, s.draftPoints[0].x, s.draftPoints[0].y) <= CLOSE_THRESHOLD ** 2) {
            closeDraftPolygon(ctx);
         } else {
            ctx.setEngineState((prev: SegmentationEngineState) => ({ ...prev, draftPoints: [...prev.draftPoints, { x, y }] }));
         }
         return;
      }

      if (ctx.activeMode === CanvasMode.EDIT) {
         for (const ann of [...ctx.annotations].reverse()) {
            for (let i = 0; i < ann.points.length; i++) {
               const p = ann.points[i];
               if (dist2(x, y, p.x, p.y) <= (HANDLE_RADIUS * 1.8) ** 2) {
                  ctx.setEngineState((prev: SegmentationEngineState) => ({ ...prev, dragState: { targetId: ann.id, pointIndex: i } }));
                  return;
               }
            }
         }
         return;
      }

      if (ctx.activeMode === CanvasMode.NONE) {
         for (const ann of [...ctx.annotations].reverse()) {
            if (ann.points.length >= 3 && pointInPolygon(x, y, ann.points)) {
               if (ctx.isControlHeld) {
                  const next = ctx.selectedIds.includes(ann.id)
                     ? ctx.selectedIds.filter((id) => id !== ann.id)
                     : [...ctx.selectedIds, ann.id];
                  ctx.setSelectedIds(next);
                  ctx.onMultiSelection?.(next);
               } else {
                  ctx.setSelectedIds([]);
                  ctx.onMultiSelection?.([]);
                  ctx.onSelection(ann.id);
               }
               return;
            }
         }
         ctx.setSelectedIds([]);
         ctx.onMultiSelection?.([]);
         ctx.onSelection(null);
      }
   },

   onMouseMove(coords, ctx) {
      const { x, y } = coords;
      const s = ctx.engineState as SegmentationEngineState;

      if (ctx.activeMode === CanvasMode.DRAWING) {
         ctx.setEngineState((prev: SegmentationEngineState) => ({ ...prev, cursorPos: { x, y } }));
         ctx.setCursor("crosshair");
         return;
      }

      if (ctx.activeMode === CanvasMode.EDIT) {
         if (s.dragState) {
            const dragState = s.dragState;
            ctx.setAnnotations((prev) =>
               prev.map((ann) =>
                  ann.id !== dragState.targetId
                     ? ann
                     : { ...ann, points: ann.points.map((p, i) => (i === dragState.pointIndex ? { x, y } : p)) }
               )
            );
            ctx.setCursor("grabbing");
         } else {
            let nearHandle = false;
            outer: for (const ann of ctx.annotations) {
               for (const p of ann.points) {
                  if (dist2(x, y, p.x, p.y) <= (HANDLE_RADIUS * 1.8) ** 2) { nearHandle = true; break outer; }
               }
            }
            ctx.setCursor(nearHandle ? "grab" : "default");
         }
         return;
      }

      if (ctx.activeMode === CanvasMode.SAM3_CLICK) {
         ctx.setCursor("crosshair");
      }
   },

   onMouseUp(coords, ctx) {
      const { x, y } = coords;
      const s = ctx.engineState as SegmentationEngineState;

      if (ctx.activeMode === CanvasMode.SAM3_CLICK) {
         ctx.setIsSam3Loading(true);
         ctx.sam3Client
            .predict(sam3Payload(ctx, Math.round(x), Math.round(y)), ctx.tapisToken)
            .then((res: any) => {
               const srcList = res?.masks ?? res?.bboxes;
               if (!srcList?.length) { alert("No segments found in the clicked area."); return; }
               const newAnns: SegmentationAnnotation[] = srcList.map((m: any, i: number) => ({
                  id: `${Date.now()}-${i}`,
                  points: extractPoints(m),
                  label: ctx.labelValue || `Segment ${ctx.annotations.length + i + 1}`,
                  score: m.confidence,
               }));
               // No direct write into the canvas's internal state: this callback can
               // resolve after the user navigated to another image, and a direct
               // write would paint the result over whatever image is on screen.
               // onAddition stores the masks in the originating file's map slot
               // (captured in this closure at request time); if that file is still
               // displayed, the canvas syncs back through props.
               ctx.onAddition?.(newAnns);
            })
            .catch((err) => { console.error("SAM3 segmentation failed:", err); alert("SAM3 failed. Please try again."); })
            .finally(() => ctx.setIsSam3Loading(false));
         return;
      }

      if (ctx.activeMode === CanvasMode.EDIT && s.dragState) {
         const ann = ctx.annotations.find((a) => a.id === s.dragState!.targetId);
         if (ann) ctx.onUpdate(ann.id, ann);
         ctx.setEngineState((prev: SegmentationEngineState) => ({ ...prev, dragState: null }));
      }
   },

   onMouseLeave(coords, ctx) {
      const s = ctx.engineState as SegmentationEngineState;
      if (ctx.activeMode === CanvasMode.DRAWING) {
         ctx.setEngineState((prev: SegmentationEngineState) => ({ ...prev, cursorPos: null }));
      }
      if (ctx.activeMode === CanvasMode.EDIT && s.dragState) {
         this.onMouseUp!(coords, ctx);
      }
   },

   onDrawingEnterKey(ctx) {
      if ((ctx.engineState as SegmentationEngineState).draftPoints.length >= 3) closeDraftPolygon(ctx);
   },

   createFromDialog(pending: Pt[], label: string, annotations) {
      if (!pending) return null;
      return {
         id: Date.now().toString(),
         points: pending,
         label: label.trim() || `Mask ${annotations.length + 1}`,
      };
   },

   runSam3Text(textPrompts, ctx) {
      ctx.setIsSam3Loading(true);
      ctx.sam3Client
         .predict(sam3Payload(ctx, undefined, undefined, textPrompts), ctx.tapisToken)
         .then((res: any) => {
            const srcList = res?.masks ?? res?.bboxes;
            if (!srcList?.length) { alert("No segments found matching the text prompt."); return; }
            const newAnns: SegmentationAnnotation[] = srcList.map((m: any, i: number) => ({
               id: `${Date.now()}-${i}`,
               points: extractPoints(m),
               label: m.label || textPrompts[0] || `Segment ${ctx.annotations.length + i + 1}`,
               score: m.confidence,
            }));
            ctx.setAnnotations((prev) => [...prev, ...newAnns]);
            ctx.onAddition?.(newAnns);
         })
         .catch((err) => { console.error("SAM3 text segmentation failed:", err); alert("SAM3 text prompt failed. Please try again."); })
         .finally(() => ctx.setIsSam3Loading(false));
   },

   draw(ctx2d, state) {
      const { annotations, generatedAnnotations, selectedId, selectedIds, lineWidth, activeMode, showLabels } = state;
      const { draftPoints, cursorPos, dragState } = state.engineState as SegmentationEngineState;
      const inEditMode = activeMode === CanvasMode.EDIT;

      // ── Completed annotations ──
      annotations.forEach((ann) => {
         if (ann.points.length < 2) return;
         const color = getLabelColor(ann.label);
         const isSel = ann.id === selectedId;
         const isMultiSel = selectedIds.includes(ann.id);
         const stroke = isSel || isMultiSel ? "#e53935" : color;

         // Polygon fill + stroke
         ctx2d.beginPath();
         ctx2d.moveTo(ann.points[0].x, ann.points[0].y);
         ann.points.slice(1).forEach((p) => ctx2d.lineTo(p.x, p.y));
         ctx2d.closePath();
         ctx2d.fillStyle = `${stroke}28`;
         ctx2d.fill("evenodd");
         if (isMultiSel && !isSel) ctx2d.setLineDash([8, 4]);
         ctx2d.strokeStyle = stroke;
         ctx2d.lineWidth = isMultiSel ? lineWidth + 1 : lineWidth;
         ctx2d.stroke();
         ctx2d.setLineDash([]);

         // Label badge at bounding-box top-left — bbox/width always computed
         // (the flag dot below is positioned relative to them regardless of showLabels)
         const anchor = polygonLabelAnchor(ann.points);
         ctx2d.font = "14px Arial";
         const tw = ctx2d.measureText(ann.label).width;
         if (showLabels) {
            ctx2d.fillStyle = stroke;
            ctx2d.fillRect(anchor.x, anchor.y - 20, tw + 8, 20);
            ctx2d.fillStyle = "white";
            ctx2d.fillText(ann.label, anchor.x + 4, anchor.y - 6);
         }

         // Flag dot
         if (ann.flag) {
            const fc = flagColor(ann.flag);
            const dotX = anchor.x + tw + 14, dotY = anchor.y - 14;
            ctx2d.beginPath();
            ctx2d.arc(dotX, dotY, 6, 0, Math.PI * 2);
            ctx2d.fillStyle = fc;
            ctx2d.fill();
            ctx2d.strokeStyle = "#ffffff";
            ctx2d.lineWidth = 1.5;
            ctx2d.stroke();
         }

         // Vertex handles in edit mode or when selected
         if (inEditMode || isSel) {
            ann.points.forEach((p, i) => {
               const dragging = dragState?.targetId === ann.id && dragState?.pointIndex === i;
               ctx2d.beginPath();
               ctx2d.rect(p.x - HANDLE_RADIUS / 2, p.y - HANDLE_RADIUS / 2, HANDLE_RADIUS, HANDLE_RADIUS);
               ctx2d.fillStyle = dragging ? "#ffeb3b" : "white";
               ctx2d.fill();
               ctx2d.strokeStyle = stroke;
               ctx2d.lineWidth = 1.5;
               ctx2d.stroke();
            });
         }
      });

      // ── SAM3-generated annotations (orange, preview) ──
      generatedAnnotations.forEach((ann) => {
         if (ann.points.length < 2) return;
         ctx2d.beginPath();
         ctx2d.moveTo(ann.points[0].x, ann.points[0].y);
         ann.points.slice(1).forEach((p) => ctx2d.lineTo(p.x, p.y));
         ctx2d.closePath();
         ctx2d.fillStyle = "#e6510028";
         ctx2d.fill("evenodd");
         ctx2d.strokeStyle = "#e65100";
         ctx2d.lineWidth = lineWidth;
         ctx2d.stroke();
         if (showLabels) {
            const anchor = polygonLabelAnchor(ann.points);
            ctx2d.font = "14px Arial";
            const tw = ctx2d.measureText(ann.label).width;
            ctx2d.fillStyle = "#e65100";
            ctx2d.fillRect(anchor.x, anchor.y - 20, tw + 8, 20);
            ctx2d.fillStyle = "white";
            ctx2d.fillText(ann.label, anchor.x + 4, anchor.y - 6);
         }
      });

      // ── Draft polygon (in-progress drawing) ──
      if (draftPoints.length > 0) {
         ctx2d.beginPath();
         ctx2d.moveTo(draftPoints[0].x, draftPoints[0].y);
         draftPoints.slice(1).forEach((p) => ctx2d.lineTo(p.x, p.y));
         if (cursorPos) ctx2d.lineTo(cursorPos.x, cursorPos.y);
         ctx2d.setLineDash([6, 4]);
         ctx2d.strokeStyle = "rgba(255,50,50,0.85)";
         ctx2d.lineWidth = lineWidth;
         ctx2d.stroke();
         ctx2d.setLineDash([]);

         // Placed vertex dots
         draftPoints.forEach((p, i) => {
            ctx2d.beginPath();
            ctx2d.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx2d.fillStyle = i === 0 ? "#00c853" : "#fff";
            ctx2d.fill();
            ctx2d.strokeStyle = i === 0 ? "#00c853" : "#e53935";
            ctx2d.lineWidth = 2;
            ctx2d.stroke();
         });

         // Closing-zone ring around first point (shown once 3+ points placed)
         if (draftPoints.length >= 3) {
            ctx2d.beginPath();
            ctx2d.arc(draftPoints[0].x, draftPoints[0].y, CLOSE_THRESHOLD, 0, Math.PI * 2);
            ctx2d.setLineDash([3, 3]);
            ctx2d.strokeStyle = "rgba(0,200,83,0.7)";
            ctx2d.lineWidth = 1.5;
            ctx2d.stroke();
            ctx2d.setLineDash([]);
         }
      }
   },
};
