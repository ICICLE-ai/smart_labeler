# Smart Labeler — publishable packages

Five packages extracted from the Smart Labeler client app (`../client`)
into standalone, independently publishable npm packages. Each was
decoupled from the app: no `~/utils/utils` imports, no `react-cookie`, no
implicit Tapis/SAM3/Patra endpoint globals — every external dependency is
now a prop or a one-time `configure...()` call, so each package works in
any React app, not just this one.

The original components in `../client/app/components` (and the
`annotation.image-annotator.$id.tsx` route) are untouched — these are
adapted copies, not moves.

| Package | What it is |
|---|---|
| [`image-annotation-canvas`](./image-annotation-canvas) | Zoomable image canvas for bounding-box detection and polygon segmentation annotation, with pluggable SAM3-assisted labeling |
| [`annotation-details`](./annotation-details) | Filterable, editable side-panel list for annotations (label/flag filters, confidence threshold, bulk edit, NMS) |
| [`tapis-file-explorer`](./tapis-file-explorer) | Paginated, prefetching file/directory browser for Tapis-hosted image datasets, plus a Formik directory-picker field |
| [`patra-model-selector`](./patra-model-selector) | Searchable Patra model card grid with gated-model detection and a Hugging Face token vault flow — calls Patra and Tapis directly, no backend proxy |
| [`image-annotator`](./image-annotator) | The full annotation workspace — **composes** the three packages above (as real `dependencies`, not duplicated code) plus the toolbar and JSON import/export/merge logic that isn't in any of them |

Each package's README has install instructions, a quick-start snippet, and
the full public API. This file only covers the shared monorepo setup.

## Setup

```bash
cd packages
npm install       # npm workspaces — installs and links all five packages
```

## Build / typecheck everything

```bash
npm run build       # builds all five (tsup -> dist/, ESM + CJS + .d.ts)
npm run typecheck   # tsc --noEmit in all five
```

`image-annotator` depends on the other three via the workspace, so run the
full `npm run build` at least once before building it in isolation — tsup
reads their `dist/*.d.ts` for types.

Or scope to one package:

```bash
cd packages/image-annotation-canvas
npm run build
```

## Publishing

Each package is independent — publish them separately, in any order:

```bash
cd packages/image-annotation-canvas && npm run build && npm publish --access public
cd packages/annotation-details       && npm run build && npm publish --access public
cd packages/tapis-file-explorer      && npm run build && npm publish --access public
cd packages/patra-model-selector     && npm run build && npm publish --access public
cd packages/image-annotator          && npm run build && npm publish --access public
```

`image-annotator` isn't fully independent, though — it lists the other
three in `dependencies` with version `"*"` (the workspace-linked version
during local dev). Before publishing it, pin those to the actual published
versions of the other three (e.g. `"^0.1.0"`), or `npm publish` will try to
resolve `*` against the public registry and may pull a different version
than what you built and tested against.

They currently publish under the `@icicle-ai` npm scope (matching the
[ICICLE-ai](https://github.com/ICICLE-ai) GitHub org). If you don't own that
npm org, edit `"name"` in each `package.json` first — e.g. drop the scope
entirely (`"image-annotation-canvas"`) or use your own
(`"@your-org/image-annotation-canvas"`).

## Design notes: how these differ from the in-app originals

- **Auth**: the app components pulled the Tapis token out of a
  `react-cookie` cookie shaped like `{"tapis-token": {"access_token": "..."}}`.
  All three packages instead take a plain `token` / `tapisToken` string
  prop — bring your own auth however you store it.
- **Endpoints**: the app read a SAM3 endpoint and Tapis base URL from a
  module-level config set once at server startup (`initConfig`). The canvas
  package takes a `sam3Endpoint` prop (or a custom `Sam3Client`); the file
  explorer package has its own equivalent one-time
  `configureTapisFileExplorer()` call.
- **Reduced dependency surface**: the app's Formik/Tapis directory-picker
  field depended on `@tapis/tapisui-common`'s internal `FieldWrapperFormik`
  and `reactstrap`. `tapis-file-explorer`'s `TapisDirectoryField` does the
  same job with just Mantine + Formik.
- **`getLabelColor`/`LABEL_PALETTE`** appear in both `image-annotation-canvas`
  and `annotation-details`, duplicated on purpose — each package needed to
  be independently installable without requiring the other.
- **`patra-model-selector` calls Patra and Tapis directly**, not through the
  smart-labeler backend the other three packages' equivalents proxy through.
  That's a deliberate difference, not an oversight — it means its Tapis vault
  calls need a `tapisUsername` prop the others don't, since the backend used
  to derive that server-side from the token and there's no backend in the
  loop here to do it.
- **`image-annotator` is the one package here that composes the others**
  instead of standing alone. It was extracted from a Remix *route*
  (`clientLoader`, `useLoaderData`), not a component — `pipeid` became a
  prop, the hardcoded "Next Step" navigation became an `onNextStep?`
  callback, and its backend calls (annotator-config CRUD, pipeline
  metadata) go through their own `configureImageAnnotator()` because that
  data only exists in the smart-labeler backend's database — unlike Tapis
  or Patra, there's no direct upstream to call instead.
