# @icicle-ai/image-annotation-canvas

A zoomable/pannable `<canvas>` for labeling images — bounding boxes for
object detection, or polygon masks for segmentation — with an optional
SAM3-assisted "click/text-to-annotate" workflow. Extracted from the
[ICICLE Smart Labeler](https://github.com/ICICLE-ai/smart_labeler).

- Draw, drag, resize (boxes) or place/drag vertices (polygons)
- Multi-select, bulk delete, keyboard shortcuts (Delete, Escape, Enter)
- Pluggable **engine** architecture — `detectionEngine` and `segmentationEngine`
  ship built-in; write your own to support a new annotation shape
- Optional SAM3 point-click / text-prompt assisted annotation via a pluggable
  `Sam3Client` — bring your own endpoint, or omit it entirely
- Zero hard dependency on any particular auth scheme — pass a token, don't
  wire up a cookie library

## Install

```bash
npm install @icicle-ai/image-annotation-canvas react react-dom @mui/material @mui/icons-material react-zoom-pan-pinch
```

Peer dependencies: `react` ^18, `react-dom` ^18, `@mui/material` ^5–^7,
`@mui/icons-material` ^5–^7, `react-zoom-pan-pinch` ^3.

## Quick start

```tsx
import { useState } from "react";
import { ImageCanvas, detectionEngine, type Annotation } from "@icicle-ai/image-annotation-canvas";

function Example() {
   const [annotations, setAnnotations] = useState<Annotation[]>([]);
   const [selectedId, setSelectedId] = useState<string | null>(null);

   return (
      <ImageCanvas<Annotation>
         engine={detectionEngine}
         file="/path/to/image.jpg" // any URL/data-URI/object-URL <img> can load
         annotations={annotations}
         isEditable
         selectedAnnotationId={selectedId}
         onSelection={setSelectedId}
         onAddition={(added) => setAnnotations((prev) => [...prev, ...added])}
         onUpdate={(id, updates) =>
            setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)))
         }
         deleteAnnotations={(ids) => setAnnotations((prev) => prev.filter((a) => !ids.includes(a.id)))}
         setFileSize={() => {}}
         isGraphEnabled={false}
         score={0}
      />
   );
}
```

Switch to polygon/segmentation masks by swapping the engine and the type
parameter:

```tsx
import { segmentationEngine, type SegmentationAnnotation } from "@icicle-ai/image-annotation-canvas";

<ImageCanvas<SegmentationAnnotation> engine={segmentationEngine} /* ...same props... */ />
```

## SAM3-assisted annotation

`ImageCanvas` ships a "magic wand" tool (in the built-in `Controls` bar) that
lets the user click a point or type a text prompt and get model-proposed
boxes/masks back. It's fully optional:

```tsx
<ImageCanvas
   engine={detectionEngine}
   sam3Endpoint="https://your-sam3-service.example.com" // POSTs to `${sam3Endpoint}/predict`
   tapisToken={myAuthToken}                              // forwarded as the `token` header
   // ...
/>
```

If you need custom auth headers, retries, or a different request shape,
implement `Sam3Client` yourself instead of `sam3Endpoint`:

```tsx
import type { Sam3Client } from "@icicle-ai/image-annotation-canvas";

const sam3Client: Sam3Client = {
   async predict(payload, token) {
      const res = await fetch("/api/sam3-proxy", {
         method: "POST",
         headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
         body: JSON.stringify(payload),
      });
      return res.json();
   },
};

<ImageCanvas engine={detectionEngine} sam3Client={sam3Client} /* ... */ />
```

If neither `sam3Endpoint` nor `sam3Client` is provided, every other tool
(draw/edit/select) works normally — only the SAM3 button throws a clear
error when clicked.

## Drawing gestures and pre-assigned labels

With `detectionEngine`, a bounding box can be placed two interchangeable ways:

- **Two clicks** — click one corner, then click the opposite corner. The box
  previews under the cursor in between, and the anchored corner is marked so an
  unfinished box is visible. `Enter` closes it at the previewed corner; `Escape`
  abandons it.
- **Click-drag** — press, drag, release, as before.

Which gesture happened is decided on mouse-up by how far the pointer travelled,
so there is no mode to choose. Leaving the canvas mid-gesture abandons a pending
two-click box rather than committing one at the exit point.

By default a new annotation opens a prompt asking for its label. Pass a
`defaultLabel` and that prompt is skipped — the annotation is created with that
label immediately. Pair it with `@icicle-ai/annotation-details`, whose
`onActiveDrawLabelChange` is designed to feed it.

## Bringing an annotation into view

`focusRequest={{ id, nonce }}` pans the canvas until that annotation sits in the
middle of the viewport. The zoom level is left alone. `nonce` is what triggers
the pan — pass a new one on every request, so selecting the same annotation again
after panning away recentres it:

```tsx
const [focusRequest, setFocusRequest] = useState(null);
const nonce = useRef(0);

// ...from your annotation list's onClick, not from the canvas's own onSelection:
setFocusRequest({ id: annotationId, nonce: ++nonce.current });
```

Raise it only for selections made *outside* the canvas. Recentring after a click
on the canvas would move the view out from under the user, who is already looking
at the thing they clicked.

The canvas asks the engine where an annotation is via the optional
`getCenter(annotation)` method; both bundled engines implement it (box centre for
detection, bounding-box centre for segmentation). A custom engine that omits it
simply won't recentre.

## Writing a custom engine

An engine is a plain object implementing `CanvasEngine<T>` — it owns mouse
event handling, drawing, and how a raw dialog payload becomes an annotation.
See `src/engines/detectionEngine.ts` and `src/engines/segmentationEngine.ts`
for reference implementations.

## API

| Export | What it is |
|---|---|
| `ImageCanvas` | The canvas component (generic over your annotation type) |
| `detectionEngine` | Bounding-box draw/drag/resize engine |
| `segmentationEngine` | Polygon-mask draw/drag-vertex engine |
| `createFetchSam3Client(endpoint)` | Builds a `Sam3Client` that POSTs to `{endpoint}/predict` |
| `CanvasMode` | `NONE \| DRAWING \| EDIT \| SAM3_CLICK \| SAM3_TEXT` |
| `BaseAnnotation`, `Annotation`, `SegmentationAnnotation` | Annotation shapes |
| `getLabelColor`, `LABEL_PALETTE` | Deterministic per-label color assignment |
| `ImageCanvasProps` | Props type, including `defaultLabel` and `focusRequest` |

## Local development (inside this monorepo)

```bash
cd packages/image-annotation-canvas
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
