# @icicle-ai/tapis-file-explorer

A paginated, prefetching file/directory browser for image datasets hosted on
[Tapis](https://tapis-project.org/), plus a directory-picker modal usable
standalone in any Formik form. Extracted from the
[ICICLE Smart Labeler](https://github.com/ICICLE-ai/smart_labeler).

- Enter a Tapis system + directory, browse subfolders, page through images
- Aggressive image prefetching (current page + neighbors) with a sliding
  LRU-ish cache window, so paging and arrow-key navigation feel instant
- Arrow-key (←/→) navigation between images, directory breadcrumbs
- Optional per-file annotation badges (count + flagged) and "Annotated" /
  "Flagged" filters, driven by a `fileStats` map you supply
- A lower-level `FileExplorerWrapper` / `FileSelectModalWrapper` pair for
  building your own file/dir picker UI (single or multi-select)
- `TapisDirectoryField` — a Formik-bound text field + "Browse" button that
  opens the picker modal, for use in any Formik form
- No hidden dependency on cookies or a specific auth library — every
  component takes a plain `token: string` prop

## Install

```bash
npm install @icicle-ai/tapis-file-explorer react react-dom @mui/material @mui/icons-material @mantine/core formik
```

Peer dependencies: `react` ^18, `react-dom` ^18, `@mui/material` ^5–^7,
`@mui/icons-material` ^5–^7, `@mantine/core` ^7, `formik` ^2.

> This package intentionally does **not** depend on `@tapis/tapisui-common`
> or `reactstrap` — the original app's Formik/Tapis field wrapper pulled
> those in just for a "Browse" button; `TapisDirectoryField` here does the
> same job with only Mantine + Formik.

## Configure once, at app startup

All Tapis calls go through a small module-level client you point at your
deployment before rendering anything:

```ts
import { configureTapisFileExplorer } from "@icicle-ai/tapis-file-explorer";

configureTapisFileExplorer({
   apiBaseUrl: "https://labeler-api.example.com",   // proxies TIFF -> JPEG conversion
   tapisBaseUrl: "https://your-tenant.tapis.io",    // Tapis v3 API base
   allowedSystems: [
      { value: "my-storage-system", label: "My Storage System" },
   ],
   defaultSystem: "my-storage-system",
});
```

## Quick start — the main panel

```tsx
import { FileExplorer } from "@icicle-ai/tapis-file-explorer";

function Example({ tapisToken }: { tapisToken: string }) {
   return (
      <FileExplorer
         token={tapisToken}
         pipeid="my-pipeline-id"
         onFileSelect={(imageUrl, filePath) => {
            // imageUrl is an object URL (or null while it's still loading —
            // FileExplorer calls this twice: once immediately with null so you
            // can update UI state before the fetch resolves, once with the URL).
         }}
         filesInDirectory={(files, system, isRootReset) => {
            // Called whenever the visible directory's image list changes —
            // useful for building an index/count elsewhere in your UI.
         }}
         onDirectorySubmit={(srcImgDir, system) => {
            // Only fires if you render the directory-entry form (see below).
         }}
      />
   );
}
```

Pass `fileDir` + `parentSystem` instead of `onDirectorySubmit` to render the
browser pinned to a fixed directory, with no "change directory" form.

### Annotation badges and filters

This package does not know anything about annotations, so pass a `fileStats` map
keyed by the same file paths the panel reports through `onFileSelect` /
`filesInDirectory`. Each entry adds a count badge next to the filename (with a
flag icon when `flagged` is true), and enables the "Annotated" / "Flagged"
filter chips above the list. Files absent from the map count as unannotated.

```tsx
// Recompute whenever your annotations change — a new Map identity is what tells
// FileExplorer to re-filter.
const fileStats = useMemo(() => {
   const stats = new Map<string, FileAnnotationStat>();
   myAnnotationsByPath.forEach((anns, path) => {
      if (anns.length === 0) return;
      stats.set(path, { count: anns.length, flagged: anns.some((a) => Boolean(a.flag)) });
   });
   return stats;
}, [myAnnotationsByPath]);

<FileExplorer fileStats={fileStats} /* …the props above… */ />;
```

Filtering only narrows what the panel displays, prefetches and walks with the
arrow keys — `filesInDirectory` still reports the full directory listing, so the
paths your annotations are keyed by never change underneath you. Omit
`fileStats` and neither the badges nor the filter chips render.

## Standalone directory/file picker

```tsx
import { useState } from "react";
import { FileSelectModalWrapper, type TapisFileEntry } from "@icicle-ai/tapis-file-explorer";

function Picker({ token }: { token: string }) {
   const [open, setOpen] = useState(false);
   const [picked, setPicked] = useState<TapisFileEntry[]>([]);

   return open ? (
      <FileSelectModalWrapper
         token={token}
         systemId="my-storage-system"
         path="/"
         selectMode={{ mode: "single", types: ["dir"] }}
         toggle={() => setOpen(false)}
         onSelect={(_systemId, files) => setPicked(files)}
      />
   ) : null;
}
```

## Formik integration

```tsx
import { Formik } from "formik";
import { TapisDirectoryField } from "@icicle-ai/tapis-file-explorer";

<Formik initialValues={{ srcImgDir: "" }} onSubmit={console.log}>
   <TapisDirectoryField
      name="srcImgDir"
      label="Source Image Directory"
      systemId="my-storage-system"
      token={myAuthToken}
   />
</Formik>
```

## API

| Export | What it is |
|---|---|
| `FileExplorer` | The main paginated browser panel |
| `FileExplorerWrapper` | Lower-level Tapis directory listing UI (used inside the modal) |
| `FileSelectModalWrapper` | Modal wrapping `FileExplorerWrapper` with a Select button |
| `TapisDirectoryField` | Formik text field + Browse button, opens the modal |
| `SubmitButton` | Tiny Mantine button that calls `formik.submitForm()` |
| `FileAnnotationStat` | `{ count: number; flagged: boolean }` — one entry of the `fileStats` map |
| `configureTapisFileExplorer` | One-time setup: API base URLs, allowed systems |
| `getImage`, `getDirContentsFromTapis`, `getTapisDirListing`, `sanitizePath` | The underlying Tapis client functions, if you want to build your own UI |

## Local development (inside this monorepo)

```bash
cd packages/tapis-file-explorer
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
