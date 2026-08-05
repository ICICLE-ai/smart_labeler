# @icicle-ai/patra-model-selector

A searchable card grid for browsing and selecting [Patra](https://patra-project.github.io/)
model cards, with built-in handling for gated models — detecting them,
prompting for a Hugging Face API token, and storing it in the user's Tapis
vault. Extracted from the [ICICLE Smart Labeler](https://github.com/ICICLE-ai/smart_labeler).

Unlike the app it was extracted from, this package talks to **Patra and
Tapis directly** — it does not proxy through the smart-labeler backend.

- Fetches and renders the list of available Patra model cards
- Single- or multi-select, with an optional `filterList` to narrow results
- "View details" opens a full model card (author, metrics, license, links —
  via `PatraDetailsContent`, also exported standalone)
- Detects `is_gated` models and blocks selection until the user has a
  Hugging Face token stored in their Tapis vault, prompting for one inline
- No hidden dependency on cookies or a specific auth library — every call
  takes a plain `token` (and, where the Tapis vault requires it, a
  `username`) as an argument

## Install

```bash
npm install @icicle-ai/patra-model-selector react react-dom @mantine/core @tabler/icons-react
```

Peer dependencies: `react` ^18, `react-dom` ^18, `@mantine/core` ^7,
`@tabler/icons-react` ^3. No MUI dependency — this package is Mantine-only.

## Configure once, at app startup

Two independent upstreams, two configure calls (only needed if the defaults
below don't match your deployment):

```ts
import { configurePatraModelSelector, configureTapisVault } from "@icicle-ai/patra-model-selector";

configurePatraModelSelector({
   patraBaseUrl: "https://patrabackend.pods.icicleai.tapis.io", // default shown
});

configureTapisVault({
   tapisBaseUrl: "https://icicleai.tapis.io", // default shown
   tenant: "icicleai",                        // default shown
});
```

## Quick start

```tsx
import { useState } from "react";
import { ModelSelector } from "@icicle-ai/patra-model-selector";

function Example({ tapisToken, tapisUsername }: { tapisToken: string; tapisUsername: string }) {
   const [selected, setSelected] = useState<string[]>([]);

   return (
      <ModelSelector
         title="Select a Model"
         selectedModelIds={selected}
         onModelSelect={(id) => setSelected((prev) => [...prev, id])}
         onModelDeselect={(id) => setSelected((prev) => prev.filter((m) => m !== id))}
         filterList={[]}          // e.g. ["detection", "segmentation"] to narrow by category/name/id
         multiSelect={false}
         tapisToken={tapisToken}
         tapisUsername={tapisUsername}
      />
   );
}
```

`tapisToken` and `tapisUsername` are both optional props, but effectively
required in practice: without them, Patra fetches fail and gated-model
detection is skipped entirely (a gated model will appear selectable with no
token prompt, since the check can't run without both values).

## The gated-model flow

When a user clicks a card where `is_gated` is `true`:

1. `checkHfSecretExists(tapisToken, tapisUsername)` checks whether a token
   is already stored in the Tapis vault. If it is, selection proceeds
   immediately.
2. If not, a modal opens asking for a Hugging Face API token (showing the
   model's license/access-request link if available), and calls
   `onHfTokenRequired?.(modelId, modelName)` so you can react to it
   (analytics, a toast, etc.).
3. Submitting the modal calls `saveHfTokenToVault(hfToken, tapisToken, tapisUsername)`
   and, on success, retries the original selection.

Pass `hfGuideUrl` (a URL to a PDF or web page) to show a "How to create
one" link in that modal, opening a second modal with the guide in an
`<iframe>`. Omit it and that link simply doesn't render — this package
ships no bundled asset of its own.

## Why `tapisUsername` is required for the vault calls

Tapis vault secrets are addressed by **tenant + username**, not just a
token. The original app derived the username server-side by decoding the
token; since this package calls Tapis directly from the browser, your app
has to supply it — typically whatever your own auth/session state already
has, since you're the one who knows who's logged in.

## CORS

Calling Patra and Tapis directly from the browser only works if those
services send CORS headers for your app's origin. Tapis is known-good
(confirmed elsewhere in the source app). Patra's CORS posture depends on
your deployment — test `listPatraModels`/`getPatraModelDetails` against
your actual instance before relying on this in production.

## API

| Export | What it is |
|---|---|
| `ModelSelector` | The card grid + selection + gated-model flow |
| `PatraDetailsContent` | Standalone read-only model card detail view |
| `PatraCard`, `PatraModelDetails` | Data shapes returned by Patra |
| `configurePatraModelSelector` | One-time setup: Patra base URL |
| `listPatraModels`, `getPatraModelDetails` | The underlying Patra client calls |
| `configureTapisVault` | One-time setup: Tapis base URL, tenant |
| `checkHfSecretExists`, `saveHfTokenToVault` | The underlying Tapis vault client calls |

## Local development (inside this monorepo)

```bash
cd packages/patra-model-selector
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
