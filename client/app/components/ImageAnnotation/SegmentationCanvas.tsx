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
// Mode enum — single source of truth for which tool is active.
// ---------------------------------------------------------------------------
export enum SegmentationCanvasMode {
   NONE = "NONE",
   DRAWING = "DRAWING",     // click-by-click polygon placement
   POINT_EDIT = "POINT_EDIT", // drag individual polygon vertices
   SAM3_CLICK = "SAM3_CLICK",
   SAM3_TEXT = "SAM3_TEXT",
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SegmentationAnnotation {
   id: string;
   points: { x: number; y: number }[];
   label: string;
   score?: number;
   iou?: number;
   flag?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const HANDLE_RADIUS = 7;
const CLOSE_THRESHOLD = 14; // px – clicking within this radius of the first point closes the polygon
const LINE_WIDTH = 2.5;
const SCROLL_STEP = 100;
const FLAG_PALETTE = ["#f57c00", "#1976d2", "#388e3c", "#c62828", "#7b1fa2", "#00838f", "#ad1457", "#6d4c41"];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
function pointInPolygon(px: number, py: number, pts: { x: number; y: number }[]): boolean {
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
// Removes vertices whose perpendicular distance from the chord is < epsilon.
function _perpDist(
   p: { x: number; y: number },
   a: { x: number; y: number },
   b: { x: number; y: number }
): number {
   const dx = b.x - a.x, dy = b.y - a.y;
   if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
   const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
   return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function rdpSimplify(pts: { x: number; y: number }[], eps: number): { x: number; y: number }[] {
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
function simplifyPolygon(
   pts: { x: number; y: number }[],
   threshold = 60,
   epsilon = 1.5
): { x: number; y: number }[] {
   if (pts.length <= threshold) return pts;
   const simplified = rdpSimplify(pts, epsilon);
   return simplified.length >= 3 ? simplified : pts;
}

// Converts a SAM3 mask/bbox response object to a polygon point array.
// m.segmentation is [[x,y],[x,y],...] ordered contour points from cv2.findContours.
function extractPoints(m: any): { x: number; y: number }[] {
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
function polygonLabelAnchor(pts: { x: number; y: number }[]): { x: number; y: number } {
   const minX = Math.min(...pts.map((p) => p.x));
   const minY = Math.min(...pts.map((p) => p.y));
   return { x: minX, y: minY };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const SegmentationCanvas = (props: {
   fileName?: string;
   systemId?: string;
   pipeId?: string;
   file: any | null;
   annotations: SegmentationAnnotation[];
   generatedAnnotations?: SegmentationAnnotation[];
   isEditable?: boolean;
   onAnnotationAddition?: (annotations: SegmentationAnnotation[]) => void;
   selectedAnnotationId: string | null;
   selectedAnnotationIds?: string[];
   onAnnotationSelection: (id: string | null) => void;
   onAnnotationMultiSelection?: (ids: string[]) => void;
   onAnnotationUpdate: (id: string, updates: Partial<SegmentationAnnotation>) => void;
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
   // ── Canvas / transform refs ──
   const transformContainerRef = useRef<any>(null);
   const parentRef = useRef<HTMLDivElement>(null);
   const canvasRef = useRef<HTMLCanvasElement>(null);
   const isControlHeld = useRef(false);

   // ── Mode ──
   const [activeMode, setActiveMode] = useState<SegmentationCanvasMode>(SegmentationCanvasMode.NONE);
   const isCanvasActive = activeMode !== SegmentationCanvasMode.NONE;
   const editable = props.isEditable ?? false;

   // ── Annotation state ──
   const [annotations, setAnnotations] = useState<SegmentationAnnotation[]>(props.annotations);
   const [generatedAnnotations, setGeneratedAnnotations] = useState<SegmentationAnnotation[]>(
      props.generatedAnnotations || []
   );

   // ── Image ──
   const [naturalHeight, setNaturalHeight] = useState(1);
   const [naturalWidth, setNaturalWidth] = useState(1);
   const [trueScale, setTrueScale] = useState(1);
   const [image, setImage] = useState<HTMLImageElement | null>(null);
   const [displayImage, setDisplayImage] = useState(true);
   const [file, setFile] = useState<any>(props.file);
   const [initialScale, setInitialScale] = useState(2.7);

   // ── Polygon drawing ──
   const [draftPoints, setDraftPoints] = useState<{ x: number; y: number }[]>([]);
   const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

   // ── Label dialog (after polygon is closed) ──
   const [labelDialogOpen, setLabelDialogOpen] = useState(false);
   const [pendingPolygon, setPendingPolygon] = useState<{ x: number; y: number }[] | null>(null);
   const [labelValue, setLabelValue] = useState("");

   // ── Selection ──
   const [selectedId, setSelectedId] = useState<string | null>(props.selectedAnnotationId);
   const [selectedIds, setSelectedIds] = useState<string[]>(props.selectedAnnotationIds ?? []);

   // ── Point-edit drag ──
   const [dragState, setDragState] = useState<{ targetId: string; pointIndex: number } | null>(null);

   // ── Visual ──
   const [lineWidth, setLineWidth] = useState(8);
   const [graphEnabled, setGraphEnabled] = useState(props.isGraphMode ?? false);

   // ── SAM3 ──
   const [sam3PatchSize, setSam3PatchSize] = useState(0);
   const [sam3DetectionConfidence, setSam3DetectionConfidence] = useState(0.3);
   const [sam3MaskPrecision, setSam3MaskPrecision] = useState(0.3);
   const [isSam3Loading, setIsSam3Loading] = useState(false);

   const [cookie] = useCookies(["tapis-token"]);

   // ────────────────────────────────────────────────────────────────────────
   // Effects
   // ────────────────────────────────────────────────────────────────────────

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
   useEffect(() => { props.setFileSize({ width: naturalWidth, height: naturalHeight }); }, [naturalWidth, naturalHeight]);

   // Apply score / label / flag filters from parent
   useEffect(() => {
      setAnnotations(
         props.annotations.filter((ann) => {
            const passScore = ann.score === undefined || ann.score >= (props.score ?? 0);
            const passLabel = !props.activeLabels?.length || props.activeLabels.includes(ann.label);
            const passFlag = !props.activeFlags?.length || props.activeFlags.some((f) => ann.flag?.includes(f));
            return passScore && passLabel && passFlag;
         })
      );
   }, [props.score, props.activeLabels, props.activeFlags, props.annotations]);

   useEffect(() => {
      const canvas = canvasRef.current;
      if (canvas && image) { canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; }
      setInitialScale(window.innerWidth > 1500 ? 2.7 : window.innerWidth > 1000 ? 4.0 : 4.5);
      draw();
   }, [image]);

   useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !image) return;
      const rect = canvas.getBoundingClientRect();
      setTrueScale(rect.width / naturalWidth);
   }, [image, annotations, selectedId, generatedAnnotations]);

   useEffect(() => {
      if (!graphEnabled) {
         const canvas = canvasRef.current;
         if (canvas && image) { canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; }
         draw();
      } else {
         props.handleRenderGraph?.();
         const inst = (transformContainerRef.current as any)?.instance;
         if (inst?.resetTransform) inst.resetTransform();
      }
   }, [graphEnabled]);

   useEffect(() => {
      const handleResize = () => {
         setInitialScale(window.innerWidth > 1500 ? 2.7 : window.innerWidth > 1000 ? 3.5 : 4.0);
      };
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
   }, []);

   // Recompute trueScale whenever the canvas container is resized (e.g. drawer open/close).
   // window.resize does not fire for layout shifts caused by drawers, so a ResizeObserver
   // on the parent div is the only reliable way to catch those changes.
   useEffect(() => {
      const container = parentRef.current;
      if (!container || !image) return;
      const observer = new ResizeObserver(() => {
         const canvas = canvasRef.current;
         if (canvas) setTrueScale(canvas.getBoundingClientRect().width / naturalWidth);
      });
      observer.observe(container);
      return () => observer.disconnect();
   }, [image, naturalWidth]);

   // Keyboard: Delete/Backspace deletes selection; Escape resets all state; Enter closes polygon
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
            props.onAnnotationMultiSelection?.([]);
            props.onAnnotationSelection(null);
         } else if (e.key === "Escape") {
            setActiveMode(SegmentationCanvasMode.NONE);
            setDraftPoints([]);
            setCursorPos(null);
            setSelectedIds([]);
            setSelectedId(null);
            setDragState(null);
            setLabelDialogOpen(false);
            setLabelValue("");
            props.onAnnotationMultiSelection?.([]);
            props.onAnnotationSelection(null);
            window.dispatchEvent(new Event("canvas-escape-pressed"));
         } else if (e.key === "Enter" && activeMode === SegmentationCanvasMode.DRAWING && draftPoints.length >= 3) {
            closeDraftPolygon();
         }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
   }, [selectedIds, selectedId, activeMode, draftPoints]);

   useEffect(() => {
      const onDown = (e: KeyboardEvent) => { if (e.key === "Control" || e.key === "Meta") isControlHeld.current = true; };
      const onUp = (e: KeyboardEvent) => { if (e.key === "Control" || e.key === "Meta") isControlHeld.current = false; };
      window.addEventListener("keydown", onDown);
      window.addEventListener("keyup", onUp);
      return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
   }, []);

   // ────────────────────────────────────────────────────────────────────────
   // Helpers
   // ────────────────────────────────────────────────────────────────────────

   const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: (e.clientX - rect.left) / trueScale, y: (e.clientY - rect.top) / trueScale };
   };

   const sam3Payload = (x?: number, y?: number, textPrompts?: string[]) => ({
      image_path: props.fileName,
      image_id:
         props.fileName?.substring(props.fileName.lastIndexOf("/") + 1, props.fileName.lastIndexOf(".")) ||
         "image_0",
      pipe_id: props.pipeId || "0",
      system_id: props.systemId || "pitzer-tapis",
      segmentation: true,
      threshold: sam3DetectionConfidence,
      mask_threshold: sam3MaskPrecision,
      ...(sam3PatchSize > 0 ? { patch_size: sam3PatchSize } : {}),
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
      ...(textPrompts ? { text_prompts: textPrompts } : {}),
   });

   const closeDraftPolygon = () => {
      if (draftPoints.length < 3) return;
      setPendingPolygon([...draftPoints]);
      setDraftPoints([]);
      setCursorPos(null);
      setLabelValue("");
      setLabelDialogOpen(true);
   };

   const saveAnnotation = () => {
      if (!pendingPolygon) return;
      const newAnn: SegmentationAnnotation = {
         id: Date.now().toString(),
         points: pendingPolygon,
         label: labelValue.trim() || `Mask ${annotations.length + 1}`,
      };
      setAnnotations((prev) => [...prev, newAnn]);
      props.onAnnotationAddition?.([newAnn]);
      setPendingPolygon(null);
      setLabelValue("");
      setLabelDialogOpen(false);
   };

   // ────────────────────────────────────────────────────────────────────────
   // Draw
   // ────────────────────────────────────────────────────────────────────────

   const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas || !image) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      const inEditMode = activeMode === SegmentationCanvasMode.POINT_EDIT;

      // ── Completed annotations ──
      annotations.forEach((ann) => {
         if (ann.points.length < 2) return;
         const color = getLabelColor(ann.label);
         const isSel = ann.id === selectedId;
         const isMultiSel = selectedIds.includes(ann.id);
         const stroke = isSel || isMultiSel ? "#e53935" : color;

         // Polygon fill + stroke
         ctx.beginPath();
         ctx.moveTo(ann.points[0].x, ann.points[0].y);
         ann.points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
         ctx.closePath();
         ctx.fillStyle = `${stroke}28`;
         ctx.fill("evenodd");
         if (isMultiSel && !isSel) ctx.setLineDash([8, 4]);
         ctx.strokeStyle = stroke;
         ctx.lineWidth = isMultiSel ? lineWidth + 1 : lineWidth;
         ctx.stroke();
         ctx.setLineDash([]);

         // Label badge at bounding-box top-left
         const anchor = polygonLabelAnchor(ann.points);
         ctx.font = "14px Arial";
         const tw = ctx.measureText(ann.label).width;
         ctx.fillStyle = stroke;
         ctx.fillRect(anchor.x, anchor.y - 20, tw + 8, 20);
         ctx.fillStyle = "white";
         ctx.fillText(ann.label, anchor.x + 4, anchor.y - 6);

         // Flag dot
         if (ann.flag) {
            const fc = flagColor(ann.flag);
            const dotX = anchor.x + tw + 14, dotY = anchor.y - 14;
            ctx.beginPath();
            ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
            ctx.fillStyle = fc;
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.5;
            ctx.stroke();
         }

         // Vertex handles in edit mode or when selected
         if (inEditMode || isSel) {
            ann.points.forEach((p, i) => {
               const dragging = dragState?.targetId === ann.id && dragState?.pointIndex === i;
               ctx.beginPath();
               ctx.rect(p.x - HANDLE_RADIUS / 2, p.y - HANDLE_RADIUS / 2, HANDLE_RADIUS, HANDLE_RADIUS);
               ctx.fillStyle = dragging ? "#ffeb3b" : "white";
               ctx.fill();
               ctx.strokeStyle = stroke;
               ctx.lineWidth = 1.5;
               ctx.stroke();
            });
         }
      });

      // ── SAM3-generated annotations (orange, preview) ──
      generatedAnnotations.forEach((ann) => {
         if (ann.points.length < 2) return;
         ctx.beginPath();
         ctx.moveTo(ann.points[0].x, ann.points[0].y);
         ann.points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
         ctx.closePath();
         ctx.fillStyle = "#e6510028";
         ctx.fill("evenodd");
         ctx.strokeStyle = "#e65100";
         ctx.lineWidth = lineWidth;
         ctx.stroke();
         const anchor = polygonLabelAnchor(ann.points);
         ctx.font = "14px Arial";
         const tw = ctx.measureText(ann.label).width;
         ctx.fillStyle = "#e65100";
         ctx.fillRect(anchor.x, anchor.y - 20, tw + 8, 20);
         ctx.fillStyle = "white";
         ctx.fillText(ann.label, anchor.x + 4, anchor.y - 6);
      });

      // ── Draft polygon (in-progress drawing) ──
      if (draftPoints.length > 0) {
         ctx.beginPath();
         ctx.moveTo(draftPoints[0].x, draftPoints[0].y);
         draftPoints.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
         if (cursorPos) ctx.lineTo(cursorPos.x, cursorPos.y);
         ctx.setLineDash([6, 4]);
         ctx.strokeStyle = "rgba(255,50,50,0.85)";
         ctx.lineWidth = lineWidth;
         ctx.stroke();
         ctx.setLineDash([]);

         // Placed vertex dots
         draftPoints.forEach((p, i) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = i === 0 ? "#00c853" : "#fff";
            ctx.fill();
            ctx.strokeStyle = i === 0 ? "#00c853" : "#e53935";
            ctx.lineWidth = 2;
            ctx.stroke();
         });

         // Closing-zone ring around first point (shown once 3+ points placed)
         if (draftPoints.length >= 3) {
            ctx.beginPath();
            ctx.arc(draftPoints[0].x, draftPoints[0].y, CLOSE_THRESHOLD, 0, Math.PI * 2);
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = "rgba(0,200,83,0.7)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.setLineDash([]);
         }
      }
   }, [image, annotations, generatedAnnotations, selectedId, selectedIds, draftPoints, cursorPos, lineWidth, activeMode, dragState]);

   useEffect(() => { draw(); }, [draw]);

   // ────────────────────────────────────────────────────────────────────────
   // Mouse handlers
   // ────────────────────────────────────────────────────────────────────────

   const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = getCanvasCoordinates(e);

      if (activeMode === SegmentationCanvasMode.DRAWING) {
         // Close polygon if click lands within CLOSE_THRESHOLD of the first point
         if (draftPoints.length >= 3 && dist2(x, y, draftPoints[0].x, draftPoints[0].y) <= CLOSE_THRESHOLD ** 2) {
            closeDraftPolygon();
         } else {
            setDraftPoints((prev) => [...prev, { x, y }]);
         }
         return;
      }

      if (activeMode === SegmentationCanvasMode.POINT_EDIT) {
         for (const ann of [...annotations].reverse()) {
            for (let i = 0; i < ann.points.length; i++) {
               const p = ann.points[i];
               if (dist2(x, y, p.x, p.y) <= (HANDLE_RADIUS * 1.8) ** 2) {
                  setDragState({ targetId: ann.id, pointIndex: i });
                  return;
               }
            }
         }
         return;
      }

      if (activeMode === SegmentationCanvasMode.NONE) {
         for (const ann of [...annotations].reverse()) {
            if (ann.points.length >= 3 && pointInPolygon(x, y, ann.points)) {
               if (isControlHeld.current) {
                  const next = selectedIds.includes(ann.id)
                     ? selectedIds.filter((id) => id !== ann.id)
                     : [...selectedIds, ann.id];
                  setSelectedIds(next);
                  props.onAnnotationMultiSelection?.(next);
               } else {
                  setSelectedIds([]);
                  props.onAnnotationMultiSelection?.([]);
                  setSelectedId(ann.id);
                  props.onAnnotationSelection(ann.id);
               }
               return;
            }
         }
         setSelectedIds([]);
         setSelectedId(null);
         props.onAnnotationMultiSelection?.([]);
         props.onAnnotationSelection(null);
      }
   };

   const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = getCanvasCoordinates(e);
      const canvas = canvasRef.current;

      if (activeMode === SegmentationCanvasMode.DRAWING) {
         setCursorPos({ x, y });
         if (canvas) canvas.style.cursor = "crosshair";
         return;
      }

      if (activeMode === SegmentationCanvasMode.POINT_EDIT) {
         if (dragState) {
            setAnnotations((prev) =>
               prev.map((ann) => {
                  if (ann.id !== dragState.targetId) return ann;
                  return { ...ann, points: ann.points.map((p, i) => (i === dragState.pointIndex ? { x, y } : p)) };
               })
            );
            if (canvas) canvas.style.cursor = "grabbing";
         } else {
            let nearHandle = false;
            outer: for (const ann of annotations) {
               for (const p of ann.points) {
                  if (dist2(x, y, p.x, p.y) <= (HANDLE_RADIUS * 1.8) ** 2) { nearHandle = true; break outer; }
               }
            }
            if (canvas) canvas.style.cursor = nearHandle ? "grab" : "default";
         }
         return;
      }

      if (activeMode === SegmentationCanvasMode.SAM3_CLICK && canvas) {
         canvas.style.cursor = "crosshair";
      }
   };

   const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = getCanvasCoordinates(e);

      if (activeMode === SegmentationCanvasMode.SAM3_CLICK) {
         setIsSam3Loading(true);
         sam3Predictions(
            sam3Payload(Math.round(x), Math.round(y)),
            cookie["tapis-token"]?.["access_token"] ?? ""
         )
            .then((res: any) => {
               const srcList = res?.masks ?? res?.bboxes;
               if (!srcList?.length) { alert("No segments found in the clicked area."); return; }
               const newAnns: SegmentationAnnotation[] = srcList.map((m: any, i: number) => ({
                  id: `${Date.now()}-${i}`,
                  points: extractPoints(m),
                  label: labelValue || `Segment ${annotations.length + i + 1}`,
                  score: m.confidence,
               }));
               setAnnotations((prev) => [...prev, ...newAnns]);
               props.onAnnotationAddition?.(newAnns);
            })
            .catch((err) => { console.error("SAM3 segmentation failed:", err); alert("SAM3 failed. Please try again."); })
            .finally(() => setIsSam3Loading(false));
         return;
      }

      if (activeMode === SegmentationCanvasMode.POINT_EDIT && dragState) {
         const ann = annotations.find((a) => a.id === dragState.targetId);
         if (ann) props.onAnnotationUpdate(ann.id, ann);
         setDragState(null);
      }
   };

   const handleMouseLeave = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (activeMode === SegmentationCanvasMode.DRAWING) setCursorPos(null);
      if (activeMode === SegmentationCanvasMode.POINT_EDIT && dragState) handleMouseUp(e);
   };

   // ────────────────────────────────────────────────────────────────────────
   // SAM3 text-prompt (imperative, triggered from Controls)
   // ────────────────────────────────────────────────────────────────────────

   const handleSam3TextPrompt = (textPrompts: string[]) => {
      setIsSam3Loading(true);
      sam3Predictions(
         sam3Payload(undefined, undefined, textPrompts),
         cookie["tapis-token"]?.["access_token"] ?? ""
      )
         .then((res: any) => {
            const srcList = res?.masks ?? res?.bboxes;
            if (!srcList?.length) { alert("No segments found matching the text prompt."); return; }
            const newAnns: SegmentationAnnotation[] = srcList.map((m: any, i: number) => ({
               id: `${Date.now()}-${i}`,
               points: extractPoints(m),
               label: m.label || textPrompts[0] || `Segment ${annotations.length + i + 1}`,
               score: m.confidence,
            }));
            setAnnotations((prev) => [...prev, ...newAnns]);
            props.onAnnotationAddition?.(newAnns);
         })
         .catch((err) => { console.error("SAM3 text segmentation failed:", err); alert("SAM3 text prompt failed. Please try again."); })
         .finally(() => setIsSam3Loading(false));
   };

   // ────────────────────────────────────────────────────────────────────────
   // Render
   // ────────────────────────────────────────────────────────────────────────

   return (
      <>
         <Paper
            elevation={3}
            sx={{ p: 1, height: "90vh", display: "flex", flexDirection: "column", gap: 1 }}
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
                     onTransformed={(_ref: ReactZoomPanPinchRef, state: { scale: number }) => {
                        const canvas = canvasRef.current;
                        if (canvas) {
                           const rect = canvas.getBoundingClientRect();
                           setTrueScale(rect.width / naturalWidth);
                        }
                     }}
                  >
                     <Controls
                        isEditable={editable}
                        isDrawing={activeMode === SegmentationCanvasMode.DRAWING}
                        isEnableBoxEdit={activeMode === SegmentationCanvasMode.POINT_EDIT}
                        handleDrawingStateChange={(drawing) => {
                           if (drawing) {
                              setActiveMode(SegmentationCanvasMode.DRAWING);
                           } else {
                              setDraftPoints([]);
                              setCursorPos(null);
                              setActiveMode(SegmentationCanvasMode.NONE);
                           }
                        }}
                        handleEnableBoxEditChange={(edit) => {
                           if (edit) {
                              setActiveMode(SegmentationCanvasMode.POINT_EDIT);
                           } else {
                              setDragState(null);
                              setActiveMode(SegmentationCanvasMode.NONE);
                           }
                        }}
                        isGraphEnabled={props.isGraphEnabled}
                        handleDisplayTypeSwitch={(type: string) => {
                           setGraphEnabled(type.toUpperCase() === "GRAPH");
                        }}
                        handleSAM3BoxPrediction={(mode, sam3Active, label, textPrompts, isSAHIenabled, patchSize, detectionConfidence, maskPrecision) => {
                           if (sam3Active) {
                              if (label) setLabelValue(label);
                              setSam3PatchSize(isSAHIenabled ? (patchSize ?? 0) : 0);
                              setSam3DetectionConfidence(detectionConfidence ?? 0.3);
                              setSam3MaskPrecision(maskPrecision ?? 0.3);
                              if (mode === SAM3_MODES.TEXT_PROMPTS && textPrompts?.length) {
                                 setActiveMode(SegmentationCanvasMode.SAM3_TEXT);
                                 handleSam3TextPrompt(textPrompts);
                              } else {
                                 setActiveMode(SegmentationCanvasMode.SAM3_CLICK);
                              }
                           } else {
                              setLabelValue("");
                              setActiveMode(SegmentationCanvasMode.NONE);
                           }
                        }}
                        sam3loading={isSam3Loading}
                        lineWidth={lineWidth}
                        onLineWidthChange={(w) => setLineWidth(w)}
                     />
                     <TransformComponent>
                        {graphEnabled && props.graph ? props.graph : (
                           <canvas
                              ref={canvasRef}
                              width={naturalWidth || 1}
                              height={naturalHeight || 1}
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
                     <h4 style={{ color: "rgba(0,0,0,0.6)" }}>Select a file to start annotating.</h4>
                  </Box>
               )}
            </Box>
         </Paper>

         {/* Label dialog — shown after a polygon is closed */}
         <Dialog
            open={labelDialogOpen}
            onClose={() => { setLabelDialogOpen(false); setPendingPolygon(null); }}
            maxWidth="xs"
            fullWidth
         >
            <DialogTitle>New segmentation mask</DialogTitle>
            <DialogContent>
               <TextField
                  variant="filled"
                  autoFocus
                  fullWidth
                  label="Label"
                  value={labelValue}
                  onChange={(e) => setLabelValue(e.target.value)}
                  placeholder="e.g., car, building, person"
                  onKeyDown={(e) => { if (e.key === "Enter") saveAnnotation(); }}
               />
            </DialogContent>
            <DialogActions>
               <Button onClick={() => { setLabelDialogOpen(false); setPendingPolygon(null); }}>Cancel</Button>
               <Button variant="contained" onClick={saveAnnotation}>Save</Button>
            </DialogActions>
         </Dialog>
      </>
   );
};

export { SegmentationCanvas };
