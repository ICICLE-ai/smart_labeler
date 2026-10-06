import { useEffect, useRef, useState } from "react";
import { Alert, Box, Chip, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import { getTrackFrame, Sam3VideoError } from "./sam3VideoClient";
import type { TrackFrameObject } from "./types";
import type { LoadedFrame } from "./FrameBrowser";
import { objectColorCss, objectColorRgb } from "./utils";

const MASK_ALPHA = 170;

function loadImage(src: string): Promise<HTMLImageElement> {
   return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("frame image could not be decoded"));
      img.src = src;
   });
}

/** Tints a grayscale mask PNG (white = object) into a transparent, colored layer at the given size. */
async function tintMask(
   pngB64: string,
   rgb: [number, number, number],
   width: number,
   height: number,
): Promise<HTMLCanvasElement> {
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

export interface ResultsOverlayProps {
   jobId: string;
   /** The frame the user is looking at. */
   frameIdx: number;
   /** The loaded frame image, carrying the index it belongs to. */
   frame: LoadedFrame | null;
}

/** Masks fetched for one specific frame. Kept together so they can never be drawn against another frame. */
interface FetchedMasks {
   frameIdx: number;
   objects: TrackFrameObject[];
}

/**
 * Overlays tracked masks on a frame, colored per object id.
 *
 * Both inputs arrive asynchronously and independently: the frame JPEG from the
 * frame browser's cache, the masks from the track job. Each is tagged with the
 * frame it belongs to and nothing is painted until both tags match `frameIdx`,
 * which is what keeps masks from lagging a frame behind while scrubbing.
 *
 * Read-only by design — correcting a frame hands it back to the annotation
 * canvas rather than editing here.
 */
export function ResultsOverlay({ jobId, frameIdx, frame }: ResultsOverlayProps) {
   const canvasRef = useRef<HTMLCanvasElement>(null);
   const [masks, setMasks] = useState<FetchedMasks | null>(null);
   const [error, setError] = useState<string | null>(null);
   const drawTokenRef = useRef(0);

   // Fetch this frame's masks. Tagged with the frame they were requested for.
   useEffect(() => {
      const controller = new AbortController();
      setError(null);
      getTrackFrame(jobId, frameIdx, true, controller.signal)
         .then((res) => setMasks({ frameIdx, objects: res.objects }))
         .catch((e) => {
            if (controller.signal.aborted) return;
            setError(e instanceof Sam3VideoError ? e.message : e instanceof Error ? e.message : String(e));
         });
      return () => controller.abort();
   }, [jobId, frameIdx]);

   const framePixelsReady = frame?.frameIdx === frameIdx;
   const masksReady = masks?.frameIdx === frameIdx;
   const inSync = framePixelsReady && masksReady;

   // Draw only once image and masks both belong to `frameIdx`.
   useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !inSync || !frame || !masks) return;
      const token = ++drawTokenRef.current;

      loadImage(frame.url)
         .then(async (img) => {
            if (token !== drawTokenRef.current) return;
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext("2d")!;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);

            // Tint every mask before drawing any, so a slow decode cannot leave
            // the frame showing a partial set of objects.
            const layers = await Promise.all(
               masks.objects
                  .filter((o) => o.present && o.png_b64)
                  .map((o) => tintMask(o.png_b64!, objectColorRgb(o.obj_id), canvas.width, canvas.height)),
            );
            if (token !== drawTokenRef.current) return;
            layers.forEach((layer) => ctx.drawImage(layer, 0, 0));
         })
         .catch((e) => {
            if (token === drawTokenRef.current) setError(e instanceof Error ? e.message : String(e));
         });
   }, [inSync, frame, masks]);

   const present = masks?.objects.filter((o) => o.present) ?? [];

   return (
      <Box>
         {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert>}

         <Paper variant="outlined" sx={{ position: "relative", borderRadius: 2, overflow: "hidden", bgcolor: "grey.900" }}>
            <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block" }} />
            {!inSync && (
               <Box
                  sx={{
                     position: "absolute",
                     inset: 0,
                     display: "flex",
                     flexDirection: "column",
                     alignItems: "center",
                     justifyContent: "center",
                     gap: 1.5,
                     bgcolor: "rgba(0,0,0,0.45)",
                     color: "common.white",
                  }}
               >
                  <CircularProgress size={28} sx={{ color: "common.white" }} />
                  <Typography variant="body2">
                     {framePixelsReady ? "Loading masks for this frame…" : "Loading frame…"}
                  </Typography>
               </Box>
            )}
         </Paper>

         <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap", rowGap: 1, alignItems: "center" }}>
            {masksReady && masks!.objects.length === 0 && (
               <Typography variant="body2" color="text.secondary">
                  No tracked objects on frame {frameIdx}.
               </Typography>
            )}
            {masksReady && masks!.objects.map((obj) => (
               <Chip
                  key={obj.obj_id}
                  size="small"
                  label={obj.present
                     ? `${obj.label ?? `object_${obj.obj_id}`} · ${obj.area.toLocaleString()} px`
                     : `${obj.label ?? `object_${obj.obj_id}`} · not present`}
                  sx={{
                     bgcolor: obj.present ? objectColorCss(obj.obj_id) : "action.disabledBackground",
                     color: obj.present ? "#fff" : "text.disabled",
                     fontWeight: 600,
                  }}
               />
            ))}
            {masksReady && present.length > 0 && (
               <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                  Masks shown for frame {masks!.frameIdx}
               </Typography>
            )}
         </Stack>
      </Box>
   );
}

export default ResultsOverlay;
