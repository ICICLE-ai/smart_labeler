import { useEffect, useRef, useState } from "react";
import {
   Alert, Box, Button, Chip, FormControl, IconButton, InputLabel, LinearProgress, MenuItem,
   Select, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import StorageIcon from "@mui/icons-material/Storage";
import CancelIcon from "@mui/icons-material/Cancel";
import { allowed_systems, DEFAULT_SYSTEM, FileSelectModalWrapper } from "@icicle-ai/tapis-file-explorer";
import {
   cancelDatasetExport, getDatasetExport, Sam3VideoError, startDatasetExport, usesGatewayAuth,
   watchDatasetExport,
} from "./sam3VideoClient";
import type { DatasetExportJob } from "./types";

export interface DatasetExportPanelProps {
   uploadId: string;
   /** A finished tracking job, whose masks and COCO ship with the frames. */
   trackJobId?: string | null;
   /** Base name for the archive. */
   stem: string;
   token: string;
   /** Remembers the running export across reloads, keyed per pipeline. */
   storageKey: string;
}

const PHASE_LABEL: Record<string, string> = {
   extracting: "Extracting frames from the video",
   archiving: "Collecting masks and building the archive",
   uploading: "Uploading to HPC",
};

const formatBytes = (bytes: number): string => {
   if (!bytes) return "0 B";
   const units = ["B", "KB", "MB", "GB"];
   const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
   return `${(bytes / 1024 ** exp).toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
};

/**
 * Starts and follows a dataset export running on the gateway.
 *
 * The work happens server-side precisely so this panel is optional: closing the
 * tab, switching pipelines or reloading does not interrupt the transfer, and the
 * export id is remembered so the progress can be picked back up.
 */
export function DatasetExportPanel({
   uploadId, trackJobId, stem, token, storageKey,
}: DatasetExportPanelProps) {
   const [system, setSystem] = useState<string>(DEFAULT_SYSTEM);
   const [destDir, setDestDir] = useState("");
   const [filename, setFilename] = useState(`${stem}_dataset.tar`);
   const [browsing, setBrowsing] = useState(false);
   const [job, setJob] = useState<DatasetExportJob | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [starting, setStarting] = useState(false);
   const unwatchRef = useRef<(() => void) | null>(null);

   const available = usesGatewayAuth();
   const active = job?.status === "queued" || job?.status === "running";

   const follow = (exportId: string) => {
      unwatchRef.current?.();
      unwatchRef.current = watchDatasetExport(
         exportId,
         setJob,
         (e) => setError(e.message),
      );
   };

   // Re-attach to an export left running by a previous visit.
   useEffect(() => {
      if (!available) return;
      let remembered: string | null = null;
      try { remembered = localStorage.getItem(storageKey); } catch { /* storage may be blocked */ }
      if (!remembered) return;
      getDatasetExport(remembered)
         .then((j) => {
            setJob(j);
            if (j.status === "queued" || j.status === "running") follow(j.export_id);
         })
         .catch(() => {
            // The gateway no longer knows this export; forget it.
            try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
         });
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [available, storageKey]);

   useEffect(() => () => { unwatchRef.current?.(); }, []);

   const start = () => {
      setError(null);
      setStarting(true);
      startDatasetExport({
         uploadId, trackJobId, system, destDir, filename: filename.trim(), tapisToken: token,
      })
         .then((j) => {
            setJob(j);
            try { localStorage.setItem(storageKey, j.export_id); } catch { /* ignore */ }
            follow(j.export_id);
         })
         .catch((e) => setError(e instanceof Sam3VideoError || e instanceof Error ? e.message : String(e)))
         .finally(() => setStarting(false));
   };

   const stop = () => {
      if (!job) return;
      cancelDatasetExport(job.export_id).then(setJob).catch((e) => setError(String(e)));
   };

   if (!available) {
      return (
         <Box sx={{ p: 2 }}>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
               <StorageIcon fontSize="small" sx={{ color: "text.secondary" }} />
               <Typography variant="subtitle2" fontWeight={700}>Frame dataset → HPC</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
               Needs the authenticating gateway, which this deployment is not using. The per-file saves above
               still work for the COCO JSON and the annotated video.
            </Typography>
         </Box>
      );
   }

   return (
      <Box sx={{ p: 2 }}>
         <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
            <StorageIcon fontSize="small" sx={{ color: "text.secondary" }} />
            <Typography variant="subtitle2" fontWeight={700}>Frame dataset → HPC</Typography>
         </Stack>
         <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            Every frame, its masks and the COCO file, written straight from the GPU service to HPC as one
            archive. Runs server-side — you can close this page.
         </Typography>

         <Stack spacing={1.5}>
            <FormControl size="small" fullWidth disabled={active}>
               <InputLabel id="ds-system">System</InputLabel>
               <Select
                  labelId="ds-system" label="System" value={system}
                  onChange={(e) => setSystem(String(e.target.value))}
               >
                  {allowed_systems.map((sys) => (
                     <MenuItem key={sys.value} value={sys.value}>{sys.label}</MenuItem>
                  ))}
               </Select>
            </FormControl>

            <Stack direction="row" spacing={1} alignItems="flex-start">
               <TextField
                  size="small" fullWidth label="Destination folder" placeholder="path/to/datasets"
                  value={destDir} onChange={(e) => setDestDir(e.target.value)} disabled={active}
               />
               <Tooltip title="Browse this system for a folder">
                  <IconButton onClick={() => setBrowsing(true)} disabled={!system || active} sx={{ mt: 0.5 }}>
                     <FolderOpenIcon />
                  </IconButton>
               </Tooltip>
            </Stack>

            <TextField
               size="small" fullWidth label="Archive name"
               value={filename} onChange={(e) => setFilename(e.target.value)} disabled={active}
               helperText="Unpack on the far side with: tar xf <file>"
            />

            <Button
               variant="contained" startIcon={<StorageIcon />} onClick={start}
               disabled={active || starting || !filename.trim()}
            >
               {active ? "Export running…" : starting ? "Starting…" : "Export dataset to HPC"}
            </Button>
         </Stack>

         {job && (
            <Box sx={{ mt: 2 }}>
               {job.status === "queued" && <Alert severity="info" sx={{ mb: 1 }}>Queued.</Alert>}
               {job.status === "running" && (
                  <>
                     <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                        <Typography variant="caption" fontWeight={600}>
                           {PHASE_LABEL[job.phase] ?? "Working"}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                           {Math.round(job.progress * 100)}%
                        </Typography>
                     </Stack>
                     <LinearProgress variant="determinate" value={Math.round(job.progress * 100)} />
                     <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                        {job.phase === "uploading"
                           ? `${formatBytes(job.bytes_sent)} of ${formatBytes(job.bytes_total)}`
                           : `${job.frames_done.toLocaleString()} / ${job.frames_total.toLocaleString()} files`}
                     </Typography>
                     <Button
                        fullWidth size="small" color="error" variant="outlined"
                        startIcon={<CancelIcon />} onClick={stop} sx={{ mt: 1 }}
                     >
                        Cancel export
                     </Button>
                  </>
               )}
               {job.status === "done" && (
                  <Alert severity="success" sx={{ mb: 1 }}>
                     <Typography variant="body2" sx={{ fontWeight: 600 }}>Dataset written</Typography>
                     <Typography variant="caption" sx={{ wordBreak: "break-all" }}>
                        {job.destination} · {formatBytes(job.bytes_total)}
                     </Typography>
                  </Alert>
               )}
               {job.status === "failed" && (
                  <Alert severity="error" sx={{ mb: 1 }}>
                     <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>Export failed</Typography>
                     <Typography variant="caption" sx={{ wordBreak: "break-word" }}>
                        {job.error ?? "The gateway did not say why."}
                     </Typography>
                  </Alert>
               )}
               {job.status === "cancelled" && <Alert severity="warning" sx={{ mb: 1 }}>Export cancelled.</Alert>}
               {!trackJobId && job.status !== "failed" && (
                  <Chip
                     size="small" variant="outlined" label="Frames only — no tracking job attached"
                     sx={{ mt: 0.5, fontSize: "0.68rem" }}
                  />
               )}
            </Box>
         )}

         {error && <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}

         {browsing && (
            <FileSelectModalWrapper
               token={token}
               systemId={system}
               path={destDir || "/"}
               selectMode={{ mode: "single", types: ["dir"] }}
               zIndex={1400}
               toggle={() => setBrowsing(false)}
               onSelect={(selectedSystem, files) => {
                  const picked = files?.[0];
                  if (picked?.path) setDestDir(picked.path);
                  if (selectedSystem) setSystem(selectedSystem);
                  setBrowsing(false);
               }}
            />
         )}
      </Box>
   );
}

export default DatasetExportPanel;
