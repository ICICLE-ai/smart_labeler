import { useState } from "react";
import {
   Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
   IconButton, InputLabel, LinearProgress, MenuItem, Select, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import { allowed_systems, DEFAULT_SYSTEM, FileSelectModalWrapper } from "@icicle-ai/tapis-file-explorer";
import { HpcSaveError, saveToHpc } from "./hpcClient";

export interface SaveToHpcDialogProps {
   open: boolean;
   onClose: () => void;
   /** What is being saved, for the dialog's wording, e.g. "annotated video". */
   what: string;
   /** Suggested filename, pre-filled and editable. */
   defaultFilename: string;
   /**
    * Produces the bytes to save. Called only once the user confirms, because
    * for the MP4 this triggers a server-side render that can take minutes —
    * doing it when the dialog merely opens would waste it if they cancel.
    */
   getBody: () => Promise<Blob>;
   token: string;
   onSaved?: (location: { system: string; dir: string; filename: string }) => void;
}

/** Picks a system + folder on HPC (Tapis) and writes one export there. */
export function SaveToHpcDialog({
   open, onClose, what, defaultFilename, getBody, token, onSaved,
}: SaveToHpcDialogProps) {
   const [system, setSystem] = useState<string>(DEFAULT_SYSTEM);
   const [dir, setDir] = useState("");
   const [filename, setFilename] = useState(defaultFilename);
   const [browsing, setBrowsing] = useState(false);
   const [phase, setPhase] = useState<"idle" | "preparing" | "uploading">("idle");
   const [progress, setProgress] = useState(0);
   const [error, setError] = useState<string | null>(null);

   const busy = phase !== "idle";

   const handleSave = async () => {
      setError(null);
      try {
         setPhase("preparing");
         const body = await getBody();
         setPhase("uploading");
         setProgress(0);
         await saveToHpc({ system, dir, filename: filename.trim(), body, token }, setProgress);
         onSaved?.({ system, dir, filename: filename.trim() });
         setPhase("idle");
         onClose();
      } catch (e) {
         setPhase("idle");
         setError(e instanceof HpcSaveError || e instanceof Error ? e.message : String(e));
      }
   };

   return (
      <>
         <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Save {what} to HPC</DialogTitle>
            <DialogContent>
               <Stack spacing={2} sx={{ mt: 0.5 }}>
                  <FormControl size="small" fullWidth disabled={busy}>
                     <InputLabel id="hpc-system-label">System</InputLabel>
                     <Select
                        labelId="hpc-system-label"
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
                        label="Destination folder"
                        placeholder="path/to/folder"
                        helperText="Folder on the chosen system. Leave blank for your home directory."
                        value={dir}
                        onChange={(e) => setDir(e.target.value)}
                        disabled={busy}
                     />
                     <Tooltip title="Browse for a folder on this system">
                        <IconButton onClick={() => setBrowsing(true)} disabled={!system || busy} sx={{ mt: 0.5 }}>
                           <FolderOpenIcon />
                        </IconButton>
                     </Tooltip>
                  </Stack>

                  <TextField
                     size="small"
                     fullWidth
                     label="Filename"
                     value={filename}
                     onChange={(e) => setFilename(e.target.value)}
                     disabled={busy}
                  />

                  {phase === "preparing" && (
                     <Box>
                        <Typography variant="body2" sx={{ mb: 0.5 }}>
                           Preparing the file on the GPU service… this can take a few minutes for a long video.
                        </Typography>
                        <LinearProgress />
                     </Box>
                  )}
                  {phase === "uploading" && (
                     <Box>
                        <Typography variant="body2" sx={{ mb: 0.5 }}>
                           Uploading to {system}… {Math.round(progress * 100)}%
                        </Typography>
                        <LinearProgress variant="determinate" value={Math.round(progress * 100)} />
                     </Box>
                  )}
                  {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
               </Stack>
            </DialogContent>
            <DialogActions>
               <Button onClick={onClose} disabled={busy}>Cancel</Button>
               <Button variant="contained" onClick={handleSave} disabled={busy || !filename.trim()}>
                  Save
               </Button>
            </DialogActions>
         </Dialog>

         {browsing && (
            <FileSelectModalWrapper
               token={token}
               systemId={system}
               path={dir || "/"}
               selectMode={{ mode: "single", types: ["dir"] }}
               zIndex={1400}
               toggle={() => setBrowsing(false)}
               onSelect={(selectedSystem, files) => {
                  const picked = files?.[0];
                  if (picked) setDir(picked.path ?? "");
                  if (selectedSystem) setSystem(selectedSystem);
                  setBrowsing(false);
               }}
            />
         )}
      </>
   );
}

export default SaveToHpcDialog;
