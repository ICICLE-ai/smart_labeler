import { useState } from "react";
import {
   Alert, Box, Button, CircularProgress, Divider, Snackbar, Stack, Tooltip, Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import MovieIcon from "@mui/icons-material/Movie";
import DataObjectIcon from "@mui/icons-material/DataObject";
import { fetchTrackCoco, fetchTrackVideo } from "./sam3VideoClient";
import { SaveToHpcDialog } from "./SaveToHpcDialog";
import { downloadBlob } from "./utils";

export interface ExportPanelProps {
   jobId: string;
   /** Base name for exported files, usually the uploaded video's name without its extension. */
   stem: string;
   token: string;
}

type Artifact = "video" | "coco";

/**
 * Turns an export failure into something the user can act on.
 *
 * The overlay render is the fragile one: it decodes every frame and then insists
 * on one image per frame of the count recorded at upload, so a container whose
 * metadata overstates its length by a frame aborts the whole video — even though
 * the masks themselves are complete and the other exports work.
 */
function explainExportFailure(e: unknown, artifact: Artifact): string {
   const raw = e instanceof Error ? e.message : String(e);
   const missing = /Missing extracted frame (\d+)/i.exec(raw);
   if (missing && artifact === "video") {
      return (
         `The annotated video could not be assembled: the service expected a frame ${missing[1]} that this ` +
         `file does not actually contain. The video's own metadata overstates how many frames it has, which ` +
         `is common after a trim or re-encode.\n\n` +
         `Your tracking results are unaffected — the COCO JSON and the per-frame mask PNGs are complete and ` +
         `can be downloaded now. Rendering the overlay needs a fix in the GPU service's exporter, which ` +
         `currently trusts the recorded frame count instead of what it decoded.`
      );
   }
   if (/ffmpeg not found/i.test(raw)) {
      return `The GPU service has no ffmpeg available, so it cannot render video. On OSC: module load ffmpeg/6.1.1.\n\nService said: ${raw}`;
   }
   if (/No masks found/i.test(raw)) {
      return `There are no saved masks for this job yet, so there is nothing to export.\n\nService said: ${raw}`;
   }
   return raw;
}

/**
 * Download or save-to-HPC for a finished track job's two artifacts.
 *
 * Both paths fetch through the same client calls, so the MP4's server-side
 * render is covered by one spinner and one error message whether the user is
 * downloading it or sending it to HPC.
 */
export function ExportPanel({ jobId, stem, token }: ExportPanelProps) {
   const [busy, setBusy] = useState<Artifact | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [saveTarget, setSaveTarget] = useState<Artifact | null>(null);
   const [savedNotice, setSavedNotice] = useState<string | null>(null);

   const videoName = `${stem}_tracked.mp4`;
   const cocoName = `${stem}_tracked_coco.json`;

   const getVideoBlob = () => fetchTrackVideo(jobId);
   const getCocoBlob = async () => {
      const coco = await fetchTrackCoco(jobId);
      return new Blob([JSON.stringify(coco, null, 2)], { type: "application/json" });
   };

   const handleDownload = async (artifact: Artifact) => {
      setError(null);
      setBusy(artifact);
      try {
         if (artifact === "video") downloadBlob(await getVideoBlob(), videoName);
         else downloadBlob(await getCocoBlob(), cocoName);
      } catch (e) {
         setError(explainExportFailure(e, artifact));
      } finally {
         setBusy(null);
      }
   };

   return (
      <Box sx={{ p: 2 }}>
         <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>Export</Typography>
         <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            Download to this computer, or save onto an HPC system via Tapis.
         </Typography>

         <Stack spacing={1.5}>
            <Box>
               <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
                  <MovieIcon fontSize="small" sx={{ color: "text.secondary" }} />
                  <Typography variant="body2" fontWeight={600}>Annotated MP4</Typography>
               </Stack>
               <Stack direction="row" spacing={1}>
                  <Button
                     size="small"
                     variant="outlined"
                     fullWidth
                     startIcon={busy === "video" ? <CircularProgress size={14} /> : <DownloadIcon />}
                     onClick={() => handleDownload("video")}
                     disabled={busy !== null}
                  >
                     {busy === "video" ? "Rendering…" : "Download"}
                  </Button>
                  <Tooltip title="Save onto an HPC system">
                     <Button
                        size="small"
                        variant="outlined"
                        fullWidth
                        startIcon={<CloudUploadIcon />}
                        onClick={() => setSaveTarget("video")}
                        disabled={busy !== null}
                     >
                        To HPC
                     </Button>
                  </Tooltip>
               </Stack>
               <Typography variant="caption" color="text.secondary">
                  The service renders this on first request — expect a wait on long videos.
               </Typography>
            </Box>

            <Divider />

            <Box>
               <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
                  <DataObjectIcon fontSize="small" sx={{ color: "text.secondary" }} />
                  <Typography variant="body2" fontWeight={600}>COCO JSON</Typography>
               </Stack>
               <Stack direction="row" spacing={1}>
                  <Button
                     size="small"
                     variant="outlined"
                     fullWidth
                     startIcon={busy === "coco" ? <CircularProgress size={14} /> : <DownloadIcon />}
                     onClick={() => handleDownload("coco")}
                     disabled={busy !== null}
                  >
                     {busy === "coco" ? "Building…" : "Download"}
                  </Button>
                  <Tooltip title="Save onto an HPC system">
                     <Button
                        size="small"
                        variant="outlined"
                        fullWidth
                        startIcon={<CloudUploadIcon />}
                        onClick={() => setSaveTarget("coco")}
                        disabled={busy !== null}
                     >
                        To HPC
                     </Button>
                  </Tooltip>
               </Stack>
               <Typography variant="caption" color="text.secondary">
                  RLE segmentation per frame, with <code>track_id</code> = object id.
               </Typography>
            </Box>
         </Stack>

         {error && (
            <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setError(null)}>
               <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontSize: "0.82rem" }}>{error}</Typography>
            </Alert>
         )}

         {saveTarget && (
            <SaveToHpcDialog
               open
               onClose={() => setSaveTarget(null)}
               what={saveTarget === "video" ? "annotated video" : "COCO JSON"}
               defaultFilename={saveTarget === "video" ? videoName : cocoName}
               getBody={saveTarget === "video" ? getVideoBlob : getCocoBlob}
               token={token}
               onSaved={({ system, dir, filename }) => {
                  setSaveTarget(null);
                  setSavedNotice(`Saved ${filename} to ${dir ? `${dir}/` : ""}${system}`);
               }}
            />
         )}

         <Snackbar
            open={Boolean(savedNotice)}
            autoHideDuration={6_000}
            onClose={() => setSavedNotice(null)}
            message={savedNotice ?? ""}
         />
      </Box>
   );
}

export default ExportPanel;
