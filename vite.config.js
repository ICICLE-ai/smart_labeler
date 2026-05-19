import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
export default defineConfig({
   optimizeDeps: {
      include: [
         "@tapis/tapisui-common",
         "cookie",
         "express",
         "universal-cookie"
      ],
   },
   ssr: {
      noExternal: [
         "@tapis/tapisui-common",
         "@tapis/tapisui-hooks",
         "@tapis/tapisui-api",
         "react-dropzone",
         "@mui/material",
         "@mui/icons-material",
         "cookie",
         "express",
         "universal-cookie"
      ],
   },
   plugins: [
      remix({
         future: {
            v3_fetcherPersist: true,
            v3_relativeSplatPath: true,
            v3_throwAbortReason: true,
            v3_singleFetch: true,
            v3_lazyRouteDiscovery: true,
         },
      }),
      tsconfigPaths(),
   ],
});
