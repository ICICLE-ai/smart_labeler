// A CanvasEngine for the shared ImageCanvas that labels instead of editing:
// boxes are fixed, and a click on one hands its id to the canvas's onSelection,
// where the page applies the active class. Nothing can be drawn, moved or deleted.
import type { Annotation, CanvasEngine, Coords } from "@icicle-ai/image-annotation-canvas";

export interface TriageBox extends Annotation {
   proposalId: number;
   /** null until the reviewer labels it. */
   classId: number | null;
   /** CSS colour of the assigned class. */
   color: string;
}

const UNLABELLED = "#ffd43b";

interface TriageEngineState {
   /** Where the pointer went down, and on which box; a click is a press and release on the same box. */
   down: (Coords & { id: string }) | null;
}

/** The smallest box under the point, so a box nested in a larger one stays clickable. */
function hit(boxes: TriageBox[], { x, y }: Coords): TriageBox | undefined {
   let best: TriageBox | undefined;
   for (const b of boxes) {
      if (x < b.x || y < b.y || x > b.x + b.width || y > b.y + b.height) continue;
      if (!best || b.width * b.height < best.width * best.height) best = b;
   }
   return best;
}

export const triageEngine: CanvasEngine<TriageBox> = {
   dialogTitle: "",
   labelPlaceholder: "",

   createInitialEngineState: (): TriageEngineState => ({ down: null }),

   onMouseDown(coords, ctx) {
      const box = hit(ctx.annotations, coords);
      ctx.setEngineState({ down: box ? { ...coords, id: box.id } : null });
   },

   onMouseMove(coords, ctx) {
      ctx.setCursor(hit(ctx.annotations, coords) ? "pointer" : "grab");
   },

   onMouseUp(coords, ctx) {
      const down = (ctx.engineState as TriageEngineState).down;
      ctx.setEngineState({ down: null });
      if (!down) return;
      const box = ctx.annotations.find((b) => b.id === down.id);
      if (!box || hit(ctx.annotations, coords)?.id !== box.id) return;
      // Dragging pans the image; only a press that stayed put labels the box.
      const tolerance = Math.max(4, 0.25 * Math.min(box.width, box.height));
      if (Math.hypot(coords.x - down.x, coords.y - down.y) <= tolerance) ctx.onSelection(box.id);
   },

   onMouseLeave(_coords, ctx) {
      ctx.setEngineState({ down: null });
   },

   draw(ctx2d, { annotations, selectedId, lineWidth: chosenWidth }) {
      // Coordinates are natural image pixels and the image is shown fitted to the
      // column, so sizes follow the image: the stroke the user picked (8 by default)
      // means the same on a camera-trap frame as on a small crop.
      const side = Math.max(ctx2d.canvas.width, ctx2d.canvas.height);
      const lineWidth = Math.max(1, (chosenWidth * side) / 2000);
      const fontSize = Math.max(4, side / 55);
      ctx2d.font = `600 ${fontSize}px sans-serif`;
      ctx2d.textBaseline = "top";

      for (const box of annotations) {
         const labelled = box.classId !== null;
         const color = labelled ? box.color : UNLABELLED;

         if (labelled) {
            ctx2d.globalAlpha = 0.18;
            ctx2d.fillStyle = color;
            ctx2d.fillRect(box.x, box.y, box.width, box.height);
            ctx2d.globalAlpha = 1;
         }
         if (box.id === selectedId) {
            ctx2d.strokeStyle = "#ffffff";
            ctx2d.lineWidth = lineWidth * 2.5;
            ctx2d.strokeRect(box.x, box.y, box.width, box.height);
         }
         ctx2d.strokeStyle = color;
         ctx2d.lineWidth = lineWidth;
         ctx2d.setLineDash(labelled ? [] : [lineWidth * 2, lineWidth * 1.5]);
         ctx2d.strokeRect(box.x, box.y, box.width, box.height);
         ctx2d.setLineDash([]);

         const text = labelled ? box.label : "?";
         const pad = fontSize * 0.25;
         const tagW = ctx2d.measureText(text).width + 2 * pad;
         const tagH = fontSize + 2 * pad;
         const tagY = box.y - tagH >= 0 ? box.y - tagH : box.y;
         ctx2d.fillStyle = color;
         ctx2d.fillRect(box.x, tagY, tagW, tagH);
         ctx2d.fillStyle = labelled ? "#ffffff" : "#000000";
         ctx2d.fillText(text, box.x + pad, tagY + pad);
      }
   },

   createFromDialog: () => null,

   getCenter: (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }),
};
