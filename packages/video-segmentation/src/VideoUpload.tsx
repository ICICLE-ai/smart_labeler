import { useRef, useState } from "react";
import { Alert, Box, Button, LinearProgress, Stack, Typography } from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { Sam3VideoError, uploadVideo } from "./sam3VideoClient";
import type { UploadMeta } from "./types";

export interface VideoUploadProps {
   onUploaded: (meta: UploadMeta) => void;
}

/** Drag-and-drop or file-picker upload to `POST /uploads`, with progress and the service's own error text surfaced (e.g. a truncated MP4's "moov atom not found" 400). */
export function VideoUpload({ onUploaded }: VideoUploadProps) {
   const [dragOver, setDragOver] = useState(false);
   const [progress, setProgress] = useState<number | null>(null);
   const [error, setError] = useState<string | null>(null);
   const inputRef = useRef<HTMLInputElement>(null);

   const handleFile = (file: File) => {
      setError(null);
      setProgress(0);
      uploadVideo(file, setProgress)
         .then((meta) => { setProgress(null); onUploaded(meta); })
         .catch((e) => {
            setProgress(null);
            setError(e instanceof Sam3VideoError ? e.message : `Upload failed: ${e instanceof Error ? e.message : String(e)}`);
         });
   };

   return (
      <Box sx={{ p: 3, maxWidth: 520, mx: "auto", mt: 6 }}>
         <Box
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
               e.preventDefault();
               setDragOver(false);
               const file = e.dataTransfer.files?.[0];
               if (file) handleFile(file);
            }}
            onClick={() => inputRef.current?.click()}
            sx={{
               border: "2px dashed",
               borderColor: dragOver ? "primary.main" : "divider",
               borderRadius: 2,
               p: 5,
               textAlign: "center",
               cursor: "pointer",
               bgcolor: dragOver ? "action.hover" : "background.paper",
               transition: "all 0.15s",
            }}
         >
            <CloudUploadIcon sx={{ fontSize: 48, color: "action.active", mb: 1 }} />
            <Typography variant="h6">Drop a video here</Typography>
            <Typography variant="body2" color="text.secondary">or click to choose a file</Typography>
            <input
               ref={inputRef}
               type="file"
               accept="video/*"
               hidden
               onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); }}
            />
         </Box>

         {progress !== null && (
            <Stack spacing={1} sx={{ mt: 2 }}>
               <LinearProgress variant="determinate" value={Math.round(progress * 100)} />
               <Typography variant="caption" color="text.secondary" align="center">
                  Uploading… {Math.round(progress * 100)}%
               </Typography>
            </Stack>
         )}

         {error && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
               {error}
            </Alert>
         )}

         <Button variant="text" sx={{ mt: 2 }} onClick={() => inputRef.current?.click()}>
            Choose file
         </Button>
      </Box>
   );
}

export default VideoUpload;
