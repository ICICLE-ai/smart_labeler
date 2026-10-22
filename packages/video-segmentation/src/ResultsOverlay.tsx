import { useEffect, useRef, useState } from "react";
import {
   Alert, Box, Button, Chip, CircularProgress, Paper, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import LayersIcon from "@mui/icons-material/Layers";
import CompareIcon from "@mui/icons-material/Compare";
import DownloadIcon from "@mui/icons-material/Download";
import { getTrackFrame, Sam3VideoError } from "./sam3VideoClient";
import type { TrackFrameObject } from "./types";
import type { LoadedFrame } from "./FrameBrowser";
import { downloadBlob, downloadHref, objectColorCss, objectColorRgb } from "./utils";

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

/**
 * The frame with every present object's mask composited on top, at the frame's
 * native resolution. Every mask is tinted before any is drawn, so the result
 * never holds a partial set of objects.
 */
async function composeFrame(frameUrl: string, objects: TrackFrameObject[]): Promise<HTMLCanvasElement> {
   const img = await loadImage(frameUrl);
   const canvas = document.createElement("canvas");
   canvas.width = img.naturalWidth;
   canvas.height = img.naturalHeight;
   const ctx = canvas.getContext("2d")!;
   ctx.drawImage(img, 0, 0);
   const layers = await Promise.all(
      objects
         .filter((o) => o.present && o.png_b64)
         .map((o) => tintMask(o.png_b64!, objectColorRgb(o.obj_id), canvas.width, canvas.height)),
   );
   layers.forEach((layer) => ctx.drawImage(layer, 0, 0));
   return canvas;
}

export interface ResultsOverlayProps {
   jobId: string;
   /** The frame the user is looking at. */
   frameIdx: number;
   /** The loaded frame image, carrying the index it belongs to. */
   frame: LoadedFrame | null;
   /** Base name for downloaded frames, usually the uploaded video's name without its extension. */
   stem?: string;
}

/** Masks fetched for one specific frame. Kept together so they can never be drawn against another frame. */
interface FetchedMasks {
   frameIdx: number;
   objects: TrackFrameObject[];
}

type View = "overlay" | "split";

/**
 * Review of a tracked frame, either with the masks composited on top or beside
 * the untouched frame for comparison.
 *
 * Both inputs arrive asynchronously and independently: the frame JPEG from the
 * frame browser's cache, the masks from the track job. Each is tagged with the
 * frame it belongs to and nothing is painted until both tags match `frameIdx`,
 * which is what keeps masks from lagging a frame behind while scrubbing.
 *
 * Read-only by design — correcting a frame hands it back to the annotation
 * canvas rather than editing here.
 */
export function ResultsOverlay({ jobId, frameIdx, frame, stem = "video" }: ResultsOverlayProps) {
   const canvasRef = useRef<HTMLCanvasElement>(null);
   const [masks, setMasks] = useState<FetchedMasks | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [view, setView] = useState<View>("overlay");
   const drawTokenRef = useRef(0);
   const [savingMasked, setSavingMasked] = useState(false);

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

   // Draw only once image and masks both belong to `frameIdx`. `view` is a
   // dependency because switching it remounts the canvas.
   useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !inSync || !frame || !masks) return;
      const token = ++drawTokenRef.current;

      composeFrame(frame.url, masks.objects)
         .then((composed) => {
            if (token !== drawTokenRef.current) return;
            canvas.width = composed.width;
            canvas.height = composed.height;
            canvas.getContext("2d")!.drawImage(composed, 0, 0);
         })
         .catch((e) => {
            if (token === drawTokenRef.current) setError(e instanceof Error ? e.message : String(e));
         });
   }, [inSync, frame, masks, view]);

   const present = masks?.objects.filter((o) => o.present) ?? [];

   const downloadOriginal = () => {
      if (!framePixelsReady || !frame) return;
      downloadHref(frame.url, `${stem}_frame_${frameIdx}.jpg`);
   };

   // Composed afresh rather than read off the on-screen canvas, which may still
   // be mid-draw or hold a previous frame while scrubbing.
   const downloadMasked = async () => {
      if (!inSync || !frame || !masks) return;
      setSavingMasked(true);
      try {
         const composed = await composeFrame(frame.url, masks.objects);
         const blob = await new Promise<Blob | null>((resolve) => composed.toBlob(resolve, "image/png"));
         if (!blob) throw new Error("The annotated frame could not be encoded.");
         downloadBlob(blob, `${stem}_frame_${masks.frameIdx}_masks.png`);
      } catch (e) {
         setError(e instanceof Error ? e.message : String(e));
      } finally {
         setSavingMasked(false);
      }
   };

   /** Covers whichever panes are on screen while the two halves catch up. */
   const busyOverlay = !inSync && (
      <Box
         sx={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 1.5,
            bgcolor: "rgba(0,0,0,0.45)", color: "common.white",
         }}
      >
         <CircularProgress size={28} sx={{ color: "common.white" }} />
         <Typography variant="body2">
            {framePixelsReady ? "Loading masks for this frame…" : "Loading frame…"}
         </Typography>
      </Box>
   );

   const paneLabel = (text: string, muted = false) => (
      <Typography
         variant="caption"
         sx={{
            display: "block", mb: 0.5, fontWeight: 700, letterSpacing: "0.06em",
            textTransform: "uppercase", color: muted ? "text.secondary" : "primary.main",
         }}
      >
         {text}
      </Typography>
   );

   return (
      <Box>
         {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert>}

         <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, flexWrap: "wrap", rowGap: 1 }}>
            <Typography variant="caption" color="text.secondary">
               Frame {frameIdx}
               {present.length > 0 && ` · ${present.length} object${present.length === 1 ? "" : "s"} tracked`}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Download this frame as extracted from the video, without masks">
               <span>
                  <Button size="small" variant="outlined" startIcon={<DownloadIcon />}
                     onClick={downloadOriginal} disabled={!framePixelsReady}>
                     Original
                  </Button>
               </span>
            </Tooltip>
            <Tooltip title="Download this frame with the tracked masks drawn on it (PNG)">
               <span>
                  <Button size="small" variant="outlined"
                     startIcon={savingMasked ? <CircularProgress size={14} /> : <DownloadIcon />}
                     onClick={downloadMasked} disabled={!inSync || savingMasked}>
                     With masks
                  </Button>
               </span>
            </Tooltip>
            <ToggleButtonGroup
               size="small"
               value={view}
               exclusive
               onChange={(_, v: View | null) => v && setView(v)}
            >
               <ToggleButton value="overlay">
                  <LayersIcon fontSize="small" sx={{ mr: 0.5 }} /> Overlay
               </ToggleButton>
               <ToggleButton value="split">
                  <CompareIcon fontSize="small" sx={{ mr: 0.5 }} /> Side by side
               </ToggleButton>
            </ToggleButtonGroup>
         </Stack>

         {view === "overlay" ? (
            <Paper variant="outlined" sx={{ position: "relative", borderRadius: 2, overflow: "hidden", bgcolor: "grey.900" }}>
               <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block" }} />
               {busyOverlay}
            </Paper>
         ) : (
            // Equal columns so the two frames are the same scale and a drifted
            // mask can be judged against the pixels it is supposed to cover.
            // Stacks on a narrow screen rather than shrinking both to nothing.
            <Box
               sx={{
                  display: "grid",
                  gap: 1.5,
                  gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                  alignItems: "start",
               }}
            >
               <Box sx={{ minWidth: 0 }}>
                  {paneLabel("Original", true)}
                  <Paper variant="outlined" sx={{ position: "relative", borderRadius: 2, overflow: "hidden", bgcolor: "grey.900" }}>
                     {/* A plain <img> rather than a second canvas: nothing is
                         composited here, so there is nothing to draw. */}
                     {framePixelsReady && frame ? (
                        <Box component="img" src={frame.url} alt={`Frame ${frameIdx}, unannotated`}
                           sx={{ width: "100%", height: "auto", display: "block" }} />
                     ) : (
                        <Box sx={{ width: "100%", aspectRatio: "16 / 9" }} />
                     )}
                     {busyOverlay}
                  </Paper>
               </Box>
               <Box sx={{ minWidth: 0 }}>
                  {paneLabel("Tracked")}
                  <Paper variant="outlined" sx={{ position: "relative", borderRadius: 2, overflow: "hidden", bgcolor: "grey.900" }}>
                     <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block" }} />
                     {busyOverlay}
                  </Paper>
               </Box>
            </Box>
         )}

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
         </Stack>
      </Box>
   );
}

export default ResultsOverlay;
