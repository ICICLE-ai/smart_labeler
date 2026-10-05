import { useEffect, useRef, useState } from "react";
import { Alert, Box, Chip, Stack, Typography } from "@mui/material";
import { getTrackFrame } from "./sam3VideoClient";
import type { TrackFrameObject } from "./types";
import { objectColorCss, objectColorRgb } from "./utils";

export interface ResultsOverlayProps {
   jobId: string;
   frameIdx: number;
   /** Object URL of the plain frame (from FrameBrowser) to draw underneath the masks. */
   frameUrl: string | null;
}

const MASK_ALPHA = 170;

function loadImage(src: string): Promise<HTMLImageElement> {
   return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
   });
}

/** Tints a grayscale mask PNG (white = object) into a transparent, colored layer at the given size. */
async function tintMask(pngB64: string, rgb: [number, number, number], width: number, height: number): Promise<HTMLCanvasElement> {
   const img = await loadImage(`data:image/png;base64,${pngB64}`);
   const canvas = document.createElement("canvas");
   canvas.width = width;
   canvas.height = height;
   const ctx = canvas.getContext("2d")!;
   ctx.drawImage(img, 0, 0, width, height);
   const imageData = ctx.getImageData(0, 0, width, height);
   const data = imageData.data;
   for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 127) {
         data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = MASK_ALPHA;
      } else {
         data[i + 3] = 0;
      }
   }
   ctx.putImageData(imageData, 0, 0);
   return canvas;
}

/**
 * Overlays tracked masks on a frame, colored per object id. Separate from the
 * annotation canvas on purpose: this is a read-only review of the tracker's
 * output (PNG masks from the service), not an annotation surface.
 */
export function ResultsOverlay({ jobId, frameIdx, frameUrl }: ResultsOverlayProps) {
   const canvasRef = useRef<HTMLCanvasElement>(null);
   const [objects, setObjects] = useState<TrackFrameObject[]>([]);
   const [error, setError] = useState<string | null>(null);

   useEffect(() => {
      let cancelled = false;
      getTrackFrame(jobId, frameIdx, true)
         .then((res) => { if (!cancelled) setObjects(res.objects); })
         .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
      return () => { cancelled = true; };
   }, [jobId, frameIdx]);

   useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !frameUrl) return;
      let cancelled = false;
      loadImage(frameUrl).then(async (img) => {
         if (cancelled) return;
         canvas.width = img.naturalWidth;
         canvas.height = img.naturalHeight;
         const ctx = canvas.getContext("2d")!;
         ctx.clearRect(0, 0, canvas.width, canvas.height);
         ctx.drawImage(img, 0, 0);
         for (const obj of objects) {
            if (!obj.present || !obj.png_b64) continue;
            const tinted = await tintMask(obj.png_b64, objectColorRgb(obj.obj_id), canvas.width, canvas.height);
            if (cancelled) return;
            ctx.drawImage(tinted, 0, 0);
         }
      });
      return () => { cancelled = true; };
   }, [frameUrl, objects]);

   return (
      <Box>
         {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
         <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block", border: "1px solid black" }} />
         <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
            {objects.map((obj) => (
               <Chip
                  key={obj.obj_id}
                  size="small"
                  label={`${obj.label ?? `object_${obj.obj_id}`}${obj.present ? "" : " (not present)"}`}
                  sx={{
                     bgcolor: obj.present ? objectColorCss(obj.obj_id) : "action.disabledBackground",
                     color: obj.present ? "#fff" : "text.disabled",
                     fontWeight: 600,
                  }}
               />
            ))}
         </Stack>
         {objects.length === 0 && !error && (
            <Typography variant="caption" color="text.secondary">No tracked objects on this frame.</Typography>
         )}
      </Box>
   );
}

export default ResultsOverlay;
