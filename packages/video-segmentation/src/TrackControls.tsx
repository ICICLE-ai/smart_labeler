import { useState } from "react";
import {
   Alert, Box, Button, FormControlLabel, LinearProgress, Stack, Switch, TextField, Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import CancelIcon from "@mui/icons-material/Cancel";
import type { TrackJob } from "./types";

export interface TrackControlsProps {
   frameCount: number;
   keyframeCount: number;
   job: TrackJob | null;
   onStart: (opts: { direction: "forward" | "both"; startFrame: number | null; endFrame: number | null }) => void;
   onCancel: () => void;
   disabled?: boolean;
}

/** "Segment & track whole video" controls: optional range limiting, direction, and live job progress (status/phase/chunk/frames, fed from the SSE subscription upstream). */
export function TrackControls({ frameCount, keyframeCount, job, onStart, onCancel, disabled }: TrackControlsProps) {
   const [rangeOnly, setRangeOnly] = useState(false);
   const [startFrame, setStartFrame] = useState(0);
   const [endFrame, setEndFrame] = useState(Math.max(0, frameCount - 1));
   const [both, setBoth] = useState(true);

   const isActive = job?.status === "queued" || job?.status === "running";

   return (
      <Box sx={{ p: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
         <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Track</Typography>

         <FormControlLabel
            control={<Switch checked={rangeOnly} onChange={(e) => setRangeOnly(e.target.checked)} disabled={isActive} size="small" />}
            label="Track this range only"
         />
         {rangeOnly && (
            <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
               <TextField
                  label="Start frame" type="number" size="small"
                  value={startFrame}
                  onChange={(e) => setStartFrame(Number(e.target.value))}
                  disabled={isActive}
               />
               <TextField
                  label="End frame" type="number" size="small"
                  value={endFrame}
                  onChange={(e) => setEndFrame(Number(e.target.value))}
                  disabled={isActive}
               />
            </Stack>
         )}
         <FormControlLabel
            control={<Switch checked={both} onChange={(e) => setBoth(e.target.checked)} disabled={isActive} size="small" />}
            label={both ? "Both directions from each keyframe" : "Forward only"}
         />

         <Button
            fullWidth
            variant="contained"
            startIcon={<PlayArrowIcon />}
            disabled={disabled || isActive || keyframeCount === 0}
            onClick={() => onStart({
               direction: both ? "both" : "forward",
               startFrame: rangeOnly ? startFrame : null,
               endFrame: rangeOnly ? endFrame : null,
            })}
            sx={{ mt: 1 }}
         >
            Segment & track whole video
         </Button>
         {keyframeCount === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
               Annotate at least one keyframe first.
            </Typography>
         )}

         {job && (
            <Box sx={{ mt: 2 }}>
               {job.status === "queued" && (
                  <Alert severity="info" sx={{ mb: 1 }}>
                     Queued — the service tracks one job at a time.
                  </Alert>
               )}
               {job.status === "running" && (
                  <>
                     <Typography variant="body2" sx={{ mb: 0.5 }}>
                        {job.phase} — chunk {job.chunk + 1}/{job.chunks_total} — frame {job.frames_done}/{job.frames_total}
                     </Typography>
                     <LinearProgress variant="determinate" value={Math.round((job.progress ?? 0) * 100)} />
                  </>
               )}
               {job.status === "failed" && (
                  <Alert severity="error" sx={{ mb: 1 }}>{job.error ?? "Tracking failed."}</Alert>
               )}
               {job.status === "cancelled" && <Alert severity="warning" sx={{ mb: 1 }}>Tracking cancelled.</Alert>}
               {job.status === "done" && <Alert severity="success" sx={{ mb: 1 }}>Tracking complete.</Alert>}

               {isActive && (
                  <Button
                     fullWidth
                     color="error"
                     variant="outlined"
                     startIcon={<CancelIcon />}
                     onClick={onCancel}
                     sx={{ mt: 1 }}
                  >
                     Cancel
                  </Button>
               )}
            </Box>
         )}
      </Box>
   );
}

export default TrackControls;
