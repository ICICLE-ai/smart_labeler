# @icicle-ai/image-annotator

The complete image annotation workspace — file explorer, canvas, and
details panel wired together with annotator-config persistence and
COCO/default JSON import/export, for both bounding-box detection and
polygon segmentation. Extracted from the Smart Labeler client's
`annotation.image-annotator.$id.tsx` route.

This is a **composed** package: it depends on
[`@icicle-ai/image-annotation-canvas`](../image-annotation-canvas),
[`@icicle-ai/annotation-details`](../annotation-details), and
[`@icicle-ai/tapis-file-explorer`](../tapis-file-explorer) as real
dependencies rather than duplicating their logic. It adds everything the
original route did that wasn't in any of those three packages: the `Tools`
toolbar (save/save-as/download/upload/next-step), the annotator-config
backend calls, and the detection/segmentation JSON import/export/merge
logic (COCO and a simpler default format, both directions, with folder-scoped
merge-on-save so annotations for folders you never opened this session
aren't dropped).

## Why this package exists

The four packages above are each independently usable, but this route was
never "just" a thin composition of them — about 500 lines of the original
were orchestration: annotator-config CRUD, auto-loading saved annotations on
mount, re-applying them as subfolders are discovered, and format-preserving
save/import for two annotation shapes in two file formats. Reimplementing
that in every app that wants this UI is real, error-prone work. This package
ships that orchestration once so you don't have to.

## What changed from the original route

- It's a route (`clientLoader`, `useLoaderData`) turned into a plain
  component — `pipeid` is now a prop instead of pulled from a Remix loader.
  Your app's own route file stays a thin wrapper that renders `<ImageAnnotator pipeid={...} />`.
- `react-cookie` is gone — `tapisToken` is a prop.
- The "Next Step" button's hardcoded navigation
  (`/object-detection/build-class-supports/:id`) became an `onNextStep?`
  callback prop. Omit it and the button doesn't render.
- Annotator-config / pipeline-metadata / save-file calls go through
  `configureImageAnnotator({ apiBaseUrl })` instead of a module-level app
  config — same pattern as the other packages, but note this one still talks
  to **your backend**, not Tapis/Patra directly: annotator-config and
  pipeline type are concepts that only exist in that backend's database, so
  there's no "direct" upstream to call instead.

## Install

```bash
npm install @icicle-ai/image-annotator @icicle-ai/image-annotation-canvas @icicle-ai/annotation-details @icicle-ai/tapis-file-explorer react react-dom @mui/material @mui/icons-material @mantine/core formik react-zoom-pan-pinch
```

Peer dependencies: `react` ^18, `react-dom` ^18, `@mui/material` ^5–^7,
`@mui/icons-material` ^5–^7, `@mantine/core` ^7, `formik` ^2,
`react-zoom-pan-pinch` ^3 — the full peer set of all three dependency
packages combined, since this package is what actually renders them.

## Configure once, at app startup

```ts
import { configureImageAnnotator } from "@icicle-ai/image-annotator";
import { configureTapisFileExplorer } from "@icicle-ai/tapis-file-explorer";

configureImageAnnotator({
   apiBaseUrl: "https://labeler-api.example.com", // your smart-labeler backend
});

configureTapisFileExplorer({
   apiBaseUrl: "https://labeler-api.example.com",
   tapisBaseUrl: "https://your-tenant.tapis.io",
});
```

Both packages need `apiBaseUrl` — they call different routes on the same
backend, so if you're pointed at one deployment, configure both.

## Quick start

```tsx
import { ImageAnnotator } from "@icicle-ai/image-annotator";
import { useNavigate, useParams } from "react-router-dom"; // or your router of choice

function AnnotatorRoute() {
   const { pipelineId } = useParams();
   const navigate = useNavigate();

   return (
      <ImageAnnotator
         pipeid={pipelineId!}
         tapisToken={/* wherever your app keeps the current session token */ ""}
         sam3Endpoint="https://your-sam3-service.example.com"
         onNextStep={() => navigate(`/pipelines/${pipelineId}/next-step`)}
      />
   );
}
```

`pipelineType` (detection vs. segmentation) isn't a prop — it's fetched
automatically from your backend's `/pipe/:pipeid` endpoint, same as the
original route.

## API

| Export | What it is |
|---|---|
| `ImageAnnotator` | The full workspace component |
| `Tools` | The toolbar, exported standalone if you want to build your own layout |
| `AnnotationFileFormatSwitch` | The COCO/default format toggle used inside Tools' dialogs |
| `configureImageAnnotator` | One-time setup: your backend's base URL |
| `fetchAnnotatorConfigs`, `fetchPipeline`, `fetchIsAdmin`, `createAnnotatorConfig`, `updateAnnotatorConfig`, `fetchAnnotationFileText`, `saveAnnotationFile` | The underlying backend client calls |
| `FileAnnotations`, `exportToCoco`, `exportToDefaultJson`, `importFromCocoJsonUtil`, `importFromDefaultJsonUtil`, `mergeDetectionForSave`, `detectionJsonToRelMap`, `toRelativeFilename`, `joinUnderDir`, `downloadFile` | Detection (bounding-box) JSON I/O, if you want to build your own save/load flow |
| `SegmentationFileAnnotations`, `exportSegmentationJson`, `exportSegmentationToCoco`, `importSegmentationJson`, `importSegmentationFromCoco`, `mergeSegmentationForSave`, `segJsonToRelMap` | The segmentation (polygon mask) equivalents |

## Local development (inside this monorepo)

```bash
cd packages/image-annotator
npm run build      # tsup -> dist/ (ESM + CJS + .d.ts)
npm run typecheck
npm run dev        # tsup --watch
```

Since this package depends on the other three via the npm workspace, make
sure they're built first (`npm run build` from `packages/` builds all five
in one shot).

## Publishing

```bash
npm run build
npm publish --access public
```

Rename the package (drop/replace the `@icicle-ai` scope in `package.json`,
and update the `@icicle-ai/*` entries in `dependencies` to match) first if
you're publishing under a different npm org.
