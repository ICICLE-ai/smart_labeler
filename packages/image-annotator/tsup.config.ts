import { defineConfig } from "tsup";

export default defineConfig({
   entry: ["src/index.ts"],
   format: ["esm", "cjs"],
   target: "es2022",
   dts: true,
   sourcemap: true,
   clean: true,
   splitting: false,
   external: [
      "react",
      "react-dom",
      "@mui/material",
      "@mui/icons-material",
      "@mantine/core",
      "formik",
      "react-zoom-pan-pinch",
      "@icicle-ai/image-annotation-canvas",
      "@icicle-ai/annotation-details",
      "@icicle-ai/tapis-file-explorer",
   ],
});
