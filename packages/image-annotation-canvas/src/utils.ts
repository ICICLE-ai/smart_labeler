export const MAX_SCALE = 8;

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
// Uses a module-level cache so the same label always gets the same color
// across the canvas and any other component sharing this resolver.
export const getLabelColor = (() => {
   const cache = new Map<string, string>();
   let idx = 0;
   return (label: string): string => {
      if (!cache.has(label)) cache.set(label, LABEL_PALETTE[idx++ % LABEL_PALETTE.length]);
      return cache.get(label)!;
   };
})();

export enum SAM3_MODES {
   SINGLE_CLICK = "SINGLE_CLICK",
   TEXT_PROMPTS = "TEXT_PROMPTS",
}
