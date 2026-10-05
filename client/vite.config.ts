import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";
// import { installGlobals } from "@remix-run/node/globals";

// installGlobals();

// Running multiple instances of this app on different ports (e.g. `--port 5174`
// and `--port 5175`) at the same time means multiple Vite dep-optimizers writing
// to node_modules/.vite/deps concurrently, which corrupts the cache and produces
// "file does not exist in the optimize deps directory" errors. Giving each port
// its own cache directory isolates them. No --port flag -> default cache dir.
const portArgIndex = process.argv.indexOf("--port");
const port = portArgIndex !== -1 ? process.argv[portArgIndex + 1] : undefined;

// The reusable UI lives in ../packages as internal workspace libraries. They are
// aliased to their TypeScript *sources* rather than their built `dist/` output so
// there is no build step to forget and no chance of the app running against a
// stale bundle. Their peer deps (react, @mui/*, @mantine/*, formik,
// react-zoom-pan-pinch) resolve from this app's own node_modules.
const pkg = (name: string) =>
  fileURLToPath(new URL(`../packages/${name}/src/index.ts`, import.meta.url));

const ICICLE_PACKAGES = [
  "image-annotation-canvas",
  "annotation-details",
  "tapis-file-explorer",
  "image-annotator",
  "patra-model-selector",
  "video-segmentation",
];

// Peer dependencies shared between this app and the aliased packages. Because the
// package sources live under ../packages, Node resolution would find that
// workspace's own copies in packages/node_modules (installed there only so the
// libraries can be built standalone) and the app would end up with two Reacts and
// two MUIs — which breaks hooks, context and emotion at runtime. Deduping pins
// every one of them to this app's node_modules.
const DEDUPE = [
  "react",
  "react-dom",
  "@emotion/react",
  "@emotion/styled",
  "@mui/material",
  "@mui/system",
  "@mui/styled-engine",
  "@mui/icons-material",
  "@mantine/core",
  "@mantine/hooks",
  "@tabler/icons-react",
  "formik",
  "react-zoom-pan-pinch",
];

export default defineConfig({
  cacheDir: port ? `node_modules/.vite-${port}` : undefined,
  resolve: {
    alias: ICICLE_PACKAGES.map((name) => ({
      find: `@icicle-ai/${name}`,
      replacement: pkg(name),
    })),
    dedupe: DEDUPE,
  },
  ssr: {
    noExternal: ["@tapis/tapisui-common","@tapis/tapisui-hooks","@tapis/tapisui-api","react-dropzone"],
  },
  optimizeDeps: {
    // The aliased ../packages sources are outside this app's root, so Vite does not
    // crawl them when it first scans for dependencies. Anything they import would
    // then be discovered only once a route actually renders, triggering a mid-session
    // re-optimization and a reload — during which the page can briefly hold two
    // copies of React ("Invalid hook call"). Listing the packages' peers up front
    // means the first optimize pass already covers them.
    include: [
      "@tapis/tapisui-common", "cookie", "express", "universal-cookie",
      ...DEDUPE,
      "react-dom/client",
      "react/jsx-runtime",
    ],
  },
  server: {
    host: "0.0.0.0",
    // Sources are aliased in from ../packages, which sits outside this app's root.
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
  plugins: [
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
      },
    }),
    tsconfigPaths(),
  ],
});
