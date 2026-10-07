/**
 * Client entry.
 *
 * Mounts the app inside an Emotion cache that is deliberately re-created once,
 * immediately after hydration.
 *
 * Why: Remix hydrates the whole `document`, so React owns <head>. Anything in
 * there that React did not render — Vite's dev stylesheet, Mantine's
 * colour-scheme script, the server's own <style data-emotion> tags — can make
 * hydration fail, and React's recovery is to discard the document and re-render
 * it from scratch. That deletes the <style> tags Emotion injected, but not
 * Emotion's record of having injected them: `cache.inserted` still lists every
 * rule, so nothing is ever re-added. MUI components keep their generated class
 * names (css-xxxx-MuiSvgIcon-root) while the rules behind them are gone, and the
 * app renders unstyled — most obviously, icons lose `width: 1em; height: 1em`
 * and expand to their intrinsic SVG size.
 *
 * Swapping in a fresh cache after mount gives Emotion an empty `inserted` map,
 * so every mounted component re-inserts its rules into the live <head>. This is
 * cheap, and it is correct whether or not hydration actually failed.
 */

import { RemixBrowser } from "@remix-run/react";
import { startTransition, StrictMode, useCallback, useEffect, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { CacheProvider } from "@emotion/react";
import createEmotionCache from "./emotionCache";

function ClientCacheProvider({ children }: { children: React.ReactNode }) {
  const [cache, setCache] = useState(createEmotionCache);
  const reset = useCallback(() => setCache(createEmotionCache()), []);

  // Runs once, after the document has settled into whatever state hydration
  // left it in.
  useEffect(() => reset(), [reset]);

  return <CacheProvider value={cache}>{children}</CacheProvider>;
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <ClientCacheProvider>
        <RemixBrowser />
      </ClientCacheProvider>
    </StrictMode>,
  );
});
