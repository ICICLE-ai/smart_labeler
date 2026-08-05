# @icicle-ai/annotation-details

A filterable, editable side-panel for a list of image annotations — filter
by label/flag, threshold by confidence, bulk-edit or bulk-delete a
selection, and (for bounding boxes) run Non-Maximum Suppression. Designed to
sit next to [`@icicle-ai/image-annotation-canvas`](../image-annotation-canvas)
but has no dependency on it — it only needs `{ id, label, score?, flag? }`.

Extracted from the [ICICLE Smart Labeler](https://github.com/ICICLE-ai/smart_labeler).

## Install

```bash
npm install @icicle-ai/annotation-details react react-dom @mui/material @mui/icons-material
```

Peer dependencies: `react` ^18, `react-dom` ^18, `@mui/material` ^5–^7,
`@mui/icons-material` ^5–^7.

## Quick start

```tsx
import { useState } from "react";
import { AnnotationDetails, type BaseAnnotation } from "@icicle-ai/annotation-details";

interface Box extends BaseAnnotation {
   x: number; y: number; width: number; height: number;
}

function Example() {
   const [annotations, setAnnotations] = useState<Box[]>([/* ... */]);
   const [selectedId, setSelectedId] = useState<string>();

   return (
      <AnnotationDetails
         variant="detection" // or "segmentation" — hides NMS, relabels copy for masks
         annotations={annotations}
         selectedBoxId={selectedId}
         onSelectedBoxChange={setSelectedId}
         onAnnotationUpdate={(id, updates) =>
            setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)))
         }
         deleteAnnotations={(ids) =>
            setAnnotations((prev) => prev.filter((a) => !ids.includes(a.id)))
         }
         handleFilterAnnotations={(minScore, activeLabels, activeFlags) => {
            // Called whenever the confidence slider or label/flag chips change —
            // wire this into whatever drives your canvas's visible annotation set.
         }}
      />
   );
}
```

## What it renders

- **Label chips** — click to filter the list (and, via `handleFilterAnnotations`,
  your canvas) to one or more labels.
- **Flag chips** — a small built-in taxonomy (starts with "Needs Review"),
  extensible at runtime by typing a new flag name.
- **Confidence slider** — filters by `score`, plus a one-click "remove
  everything below this threshold" action.
- **NMS button** (`variant="detection"` only) — removes overlapping boxes
  above an IoU threshold, keeping the highest-scoring one. Requires
  `x`/`y`/`width`/`height` on your annotation objects even though
  `BaseAnnotation` itself doesn't declare them (segmentation masks don't
  have a rectangular NMS concept, so the button is hidden for that variant).
- **Grouped, multi-select list** — grouped by label; ctrl/cmd-click for
  multi-select, then bulk-relabel or bulk-delete.

## API

| Export | What it is |
|---|---|
| `AnnotationDetails` | The panel component |
| `DetailsVariant` | `"detection" \| "segmentation"` |
| `BaseAnnotation` | `{ id, label, score?, iou?, flag? }` |
| `getLabelColor`, `LABEL_PALETTE` | Deterministic per-label color assignment (same palette as the canvas package, kept independent on purpose) |
| `applyNMS`, `calculateIoU`, `NMSBox` | Standalone NMS helpers if you want to run suppression outside the panel |

## Local development (inside this monorepo)

```bash
cd packages/annotation-details
npm run build      # tsup -> dist/ (ESM + CJS + .d.ts)
npm run typecheck
npm run dev        # tsup --watch
```

## Publishing

```bash
npm run build
npm publish --access public
```

Rename the package (drop/replace the `@icicle-ai` scope in `package.json`)
first if you're publishing under a different npm org.
