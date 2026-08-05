import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
// import { installGlobals } from "@remix-run/node/globals";

// installGlobals();

// Running multiple instances of this app on different ports (e.g. `--port 5174`
// and `--port 5175`) at the same time means multiple Vite dep-optimizers writing
// to node_modules/.vite/deps concurrently, which corrupts the cache and produces
// "file does not exist in the optimize deps directory" errors. Giving each port
// its own cache directory isolates them. No --port flag -> default cache dir.
const portArgIndex = process.argv.indexOf("--port");
const port = portArgIndex !== -1 ? process.argv[portArgIndex + 1] : undefined;

export default defineConfig({
  cacheDir: port ? `node_modules/.vite-${port}` : undefined,
  ssr: {
    noExternal: ["@tapis/tapisui-common","@tapis/tapisui-hooks","@tapis/tapisui-api","react-dropzone"],
  },
  optimizeDeps: {
  include: ["@tapis/tapisui-common","cookie","express","universal-cookie"]
},
  server: {
    host: "0.0.0.0"
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
