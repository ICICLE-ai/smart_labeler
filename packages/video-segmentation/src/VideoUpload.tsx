import { useRef, useState } from "react";
import {
   Alert, AlertTitle, Box, Button, LinearProgress, Paper, Stack, Tab, Tabs, TextField, Tooltip, Typography,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import StorageIcon from "@mui/icons-material/Storage";
import ComputerIcon from "@mui/icons-material/Computer";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import { allowed_systems, DEFAULT_SYSTEM, FileSelectModalWrapper } from "@icicle-ai/tapis-file-explorer";
import { FormControl, InputLabel, MenuItem, Select } from "@mui/material";
import { Sam3VideoError, uploadVideo } from "./sam3VideoClient";
import { fetchHpcFile, HpcSaveError } from "./hpcClient";
import type { UploadMeta } from "./types";

export interface VideoUploadProps {
   onUploaded: (meta: UploadMeta) => void;
   /** Tapis token, needed to read a video off an HPC system. */
   token?: string;
   /** Set while the GPU service is unreachable — uploading would only fail. */
   disabled?: boolean;
}

const VIDEO_EXTS = [".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"];

/**
 * Turns the service's upload rejection into something actionable. A truncated
 * or still-copying MP4 is the common one: ffprobe reports "moov atom not
 * found", which means nothing to most people.
 */
function explainUploadFailure(e: unknown): { title: string; body: string } {
   if (e instanceof HpcSaveError) {
      return { title: "Could not read that video from HPC", body: e.message };
   }
   if (e instanceof Sam3VideoError) {
      if (e.unreachable) {
         return { title: "Could not reach the video service", body: e.message };
      }
      const detail = e.message ?? "";
      if (/moov atom not found/i.test(detail)) {
         return {
            title: "That video file looks incomplete",
            body: "The service could not find the MP4 index (\"moov atom\"), which usually means the file is " +
               "truncated or was still being written/copied when it was picked up. Re-export or re-copy the " +
               "video in full and try again.\n\nService said: " + detail,
         };
      }
      if (/no video stream/i.test(detail)) {
         return {
            title: "No video stream in that file",
            body: "The file was readable but contains no video track. Check you picked the right file.\n\n" +
               "Service said: " + detail,
         };
      }
      if (e.status === 507) {
         return {
            title: "Out of disk space on the service",
            body: "The GPU service has no room for this upload. Its DATA_ROOT needs to point at a larger " +
               "disk.\n\nService said: " + detail,
         };
      }
      return { title: "Upload failed", body: detail };
   }
   return { title: "Upload failed", body: e instanceof Error ? e.message : String(e) };
}

/** What stage a transfer is at, since an HPC video is pulled down before being sent up. */
type Phase = { kind: "download" | "upload"; fraction: number; label: string } | null;

/**
 * Picks a video and registers it with the GPU service, from this computer or
 * from HPC storage.
 *
 * HPC videos are relayed through the browser because the GPU service takes only
 * multipart uploads and has no Tapis access of its own — so the bytes come down
 * from Tapis and go straight back up to the service.
 */
export function VideoUpload({ onUploaded, token = "", disabled }: VideoUploadProps) {
   const [source, setSource] = useState<"local" | "hpc">("local");
   const [dragOver, setDragOver] = useState(false);
   const [phase, setPhase] = useState<Phase>(null);
   const [failure, setFailure] = useState<{ title: string; body: string } | null>(null);
   const [fileName, setFileName] = useState<string | null>(null);
   const inputRef = useRef<HTMLInputElement>(null);

   // HPC picker state
   const [system, setSystem] = useState<string>(DEFAULT_SYSTEM);
   const [hpcPath, setHpcPath] = useState("");
   const [browsing, setBrowsing] = useState(false);

   const busy = phase !== null;

   const runUpload = (file: File) => {
      setPhase({ kind: "upload", fraction: 0, label: `Uploading ${file.name} to the GPU service` });
      return uploadVideo(file, (f) =>
         setPhase({ kind: "upload", fraction: f, label: `Uploading ${file.name} to the GPU service` }),
      )
         .then((meta) => { setPhase(null); onUploaded(meta); })
         .catch((e) => { setPhase(null); setFailure(explainUploadFailure(e)); });
   };

   const handleLocalFile = (file: File) => {
      setFailure(null);
      setFileName(file.name);
      void runUpload(file);
   };

   const handleHpcFile = async () => {
      const path = hpcPath.trim();
      if (!path) { setFailure({ title: "No file chosen", body: "Pick a video on the system first." }); return; }
      const name = path.split("/").filter(Boolean).at(-1) ?? "video.mp4";
      setFailure(null);
      setFileName(name);
      try {
         setPhase({ kind: "download", fraction: 0, label: `Reading ${name} from ${system}` });
         const blob = await fetchHpcFile({ system, path, token }, (fraction) =>
            setPhase({ kind: "download", fraction, label: `Reading ${name} from ${system}` }),
         );
         await runUpload(new File([blob], name, { type: blob.type || "video/mp4" }));
      } catch (e) {
         setPhase(null);
         setFailure(explainUploadFailure(e));
      }
   };

   const looksLikeVideo = VIDEO_EXTS.some((ext) => hpcPath.toLowerCase().endsWith(ext));

   return (
      <Box sx={{ maxWidth: 620, mx: "auto", mt: 2 }}>
         <Tabs
            value={source}
            onChange={(_, v) => { setSource(v); setFailure(null); }}
            sx={{ mb: 2, minHeight: 40 }}
            variant="fullWidth"
         >
            <Tab
               value="local" label="This computer" icon={<ComputerIcon fontSize="small" />}
               iconPosition="start" disabled={busy} sx={{ minHeight: 40 }}
            />
            <Tab
               value="hpc" label="HPC storage" icon={<StorageIcon fontSize="small" />}
               iconPosition="start" disabled={busy} sx={{ minHeight: 40 }}
            />
         </Tabs>

         {source === "local" ? (
            <Paper
               variant="outlined"
               onDragOver={(e) => { if (!disabled && !busy) { e.preventDefault(); setDragOver(true); } }}
               onDragLeave={() => setDragOver(false)}
               onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (disabled || busy) return;
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleLocalFile(file);
               }}
               onClick={() => { if (!disabled && !busy) inputRef.current?.click(); }}
               sx={{
                  borderStyle: "dashed",
                  borderWidth: 2,
                  borderColor: dragOver ? "primary.main" : "divider",
                  borderRadius: 3,
                  p: 5,
                  textAlign: "center",
                  cursor: disabled || busy ? "default" : "pointer",
                  bgcolor: dragOver ? "action.hover" : "background.paper",
                  opacity: disabled ? 0.6 : 1,
                  transition: "border-color 0.15s, background-color 0.15s",
                  "&:hover": disabled || busy ? undefined : { borderColor: "primary.light", bgcolor: "action.hover" },
               }}
            >
               <CloudUploadIcon sx={{ fontSize: 52, color: dragOver ? "primary.main" : "action.active", mb: 1 }} />
               <Typography variant="h6" gutterBottom>
                  {busy ? `Working on ${fileName}…` : "Drop a video here"}
               </Typography>
               <Typography variant="body2" color="text.secondary">
                  {disabled
                     ? "Unavailable while the GPU service cannot be reached."
                     : "or click to choose a file — MP4, AVI, MOV, MKV, WEBM"}
               </Typography>
               <input
                  ref={inputRef}
                  type="file"
                  accept="video/*"
                  hidden
                  onChange={(e) => {
                     const file = e.target.files?.[0];
                     if (file) handleLocalFile(file);
                     // Clear so re-picking the same file after a failure still fires onChange.
                     e.target.value = "";
                  }}
               />
            </Paper>
         ) : (
            <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
               <Stack spacing={2}>
                  <FormControl size="small" fullWidth disabled={busy}>
                     <InputLabel id="video-system-label">System</InputLabel>
                     <Select
                        labelId="video-system-label"
                        label="System"
                        value={system}
                        onChange={(e) => setSystem(String(e.target.value))}
                     >
                        {allowed_systems.map((sys) => (
                           <MenuItem key={sys.value} value={sys.value}>{sys.label}</MenuItem>
                        ))}
                     </Select>
                  </FormControl>

                  <Stack direction="row" spacing={1} alignItems="flex-start">
                     <TextField
                        size="small"
                        fullWidth
                        label="Video file path"
                        placeholder="path/to/video.mp4"
                        value={hpcPath}
                        onChange={(e) => setHpcPath(e.target.value)}
                        disabled={busy}
                        helperText={
                           hpcPath && !looksLikeVideo
                              ? "That does not look like a video file — check the extension."
                              : "Full path to the video on the chosen system."
                        }
                     />
                     <Tooltip title="Browse this system for a video">
                        <Button
                           variant="outlined"
                           onClick={() => setBrowsing(true)}
                           disabled={!system || busy}
                           sx={{ mt: 0.25, minWidth: 0, px: 1.5 }}
                        >
                           <FolderOpenIcon />
                        </Button>
                     </Tooltip>
                  </Stack>

                  <Button
                     variant="contained"
                     startIcon={<CloudUploadIcon />}
                     onClick={handleHpcFile}
                     disabled={disabled || busy || !hpcPath.trim()}
                  >
                     Use this video
                  </Button>

                  <Alert severity="info" sx={{ py: 0.5 }}>
                     The video travels via your browser — down from HPC, then up to the GPU service — so a large
                     file takes roughly twice as long as its size suggests.
                  </Alert>
               </Stack>
            </Paper>
         )}

         {phase && (
            <Stack spacing={0.75} sx={{ mt: 2 }}>
               <LinearProgress variant="determinate" value={Math.round(phase.fraction * 100)} />
               <Typography variant="caption" color="text.secondary" align="center">
                  {phase.label} — {Math.round(phase.fraction * 100)}%
                  {phase.kind === "download" ? " (step 1 of 2)" : fileName && source === "hpc" ? " (step 2 of 2)" : ""}
               </Typography>
            </Stack>
         )}

         {failure && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setFailure(null)}>
               <AlertTitle sx={{ fontWeight: 700 }}>{failure.title}</AlertTitle>
               <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{failure.body}</Typography>
            </Alert>
         )}

         <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2, textAlign: "center" }}>
            The video is registered with the GPU service, not stored on HPC. Exports can be saved to HPC afterwards.
         </Typography>

         {browsing && (
            <FileSelectModalWrapper
               token={token}
               systemId={system}
               path={hpcPath ? hpcPath.slice(0, hpcPath.lastIndexOf("/")) || "/" : "/"}
               selectMode={{ mode: "single", types: ["file"] }}
               zIndex={1400}
               toggle={() => setBrowsing(false)}
               onSelect={(selectedSystem, files) => {
                  const picked = files?.[0];
                  if (picked?.path) setHpcPath(picked.path);
                  if (selectedSystem) setSystem(selectedSystem);
                  setBrowsing(false);
               }}
            />
         )}
      </Box>
   );
}

export default VideoUpload;
