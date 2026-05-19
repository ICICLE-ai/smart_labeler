import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
// import { installGlobals } from "@remix-run/node/globals";

// installGlobals();

export default defineConfig({
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
