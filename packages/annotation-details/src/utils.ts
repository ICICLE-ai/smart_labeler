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
// Uses a module-level cache so the same label always gets the same color.
export const getLabelColor = (() => {
   const cache = new Map<string, string>();
   let idx = 0;
   return (label: string): string => {
      if (!cache.has(label)) cache.set(label, LABEL_PALETTE[idx++ % LABEL_PALETTE.length]);
      return cache.get(label)!;
   };
})();

// ---------------------------------------------------------------------------
// Non-Maximum Suppression – for bounding-box annotations only. Callers pass
// boxes with x/y/width/height alongside the base annotation fields.
// ---------------------------------------------------------------------------
export interface NMSBox {
   id: string;
   score?: number;
   x: number;
   y: number;
   width: number;
   height: number;
}

export const calculateIoU = (box1: NMSBox, box2: NMSBox): number => {
   const x1_min = box1.x;
   const y1_min = box1.y;
   const x1_max = box1.x + box1.width;
   const y1_max = box1.y + box1.height;

   const x2_min = box2.x;
   const y2_min = box2.y;
   const x2_max = box2.x + box2.width;
   const y2_max = box2.y + box2.height;

   const inter_x_min = Math.max(x1_min, x2_min);
   const inter_y_min = Math.max(y1_min, y2_min);
   const inter_x_max = Math.min(x1_max, x2_max);
   const inter_y_max = Math.min(y1_max, y2_max);

   const inter_area = Math.max(0, inter_x_max - inter_x_min) * Math.max(0, inter_y_max - inter_y_min);
   const box1_area = box1.width * box1.height;
   const box2_area = box2.width * box2.height;
   const union_area = box1_area + box2_area - inter_area;

   return union_area > 0 ? inter_area / union_area : 0;
};

/** Returns the ids of boxes that should be removed to satisfy the IoU threshold. */
export const applyNMS = (boxes: NMSBox[], iouThreshold: number = 0.5): string[] => {
   // Sort boxes by score descending
   const sortedBoxes = [...boxes].sort((a, b) => {
      const scoreA = a.score ?? 0;
      const scoreB = b.score ?? 0;
      return scoreB - scoreA;
   });

   const keptBoxIds = new Set<string>();
   const toRemoveIds: string[] = [];

   sortedBoxes.forEach((box) => {
      let shouldKeep = true;

      // Check if this box overlaps with any already-kept box
      for (const keptId of keptBoxIds) {
         const keptBox = boxes.find((b) => b.id === keptId);
         if (!keptBox) continue;

         const iou = calculateIoU(box, keptBox);
         if (iou > iouThreshold) {
            shouldKeep = false;
            break;
         }
      }

      if (shouldKeep) {
         keptBoxIds.add(box.id);
      } else {
         toRemoveIds.push(box.id);
      }
   });

   return toRemoveIds;
};
