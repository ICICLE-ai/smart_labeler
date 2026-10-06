import { useState } from "react";
import {
   Alert, Box, Button, Chip, FormControlLabel, LinearProgress, Stack, Switch, TextField, Tooltip, Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import CancelIcon from "@mui/icons-material/Cancel";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import type { TrackJob } from "./types";

export interface TrackControlsProps {
   frameCount: number;
   keyframeCount: number;
   /** The frame on screen, offered as a one-click value for the range fields. */
   currentFrame: number;
   job: TrackJob | null;
   /** Set when a running job has reported no new frames for several minutes. */
   stalled?: boolean;
   onStart: (opts: { direction: "forward" | "both"; startFrame: number | null; endFrame: number | null }) => void;
   onCancel: () => void;
   /** Set while the GPU service is unreachable. */
   disabled?: boolean;
}

/** "Segment & track whole video" controls: optional range limiting, direction, and live job progress fed from the SSE subscription upstream. */
export function TrackControls({
   frameCount, keyframeCount, currentFrame, job, stalled, onStart, onCancel, disabled,
}: TrackControlsProps) {
   const [rangeOnly, setRangeOnly] = useState(false);
   const [startFrame, setStartFrame] = useState(0);
   const [endFrame, setEndFrame] = useState(Math.max(0, frameCount - 1));
   const [both, setBoth] = useState(true);

   const isActive = job?.status === "queued" || job?.status === "running";
   const lastFrame = Math.max(0, frameCount - 1);

   const rangeError = rangeOnly
      ? startFrame < 0 || endFrame > lastFrame
         ? `Frames must be between 0 and ${lastFrame}.`
         : startFrame > endFrame
            ? "Start frame must not be after the end frame."
            : null
      : null;

   const blockedReason = disabled
      ? "The GPU service cannot be reached right now."
      : keyframeCount === 0
         ? "Annotate at least one keyframe first."
         : rangeError;

   return (
      <Box sx={{ p: 2 }}>
         <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" fontWeight={700}>Track</Typography>
            <Chip
               size="small"
               variant="outlined"
               label={`${keyframeCount} keyframe${keyframeCount === 1 ? "" : "s"}`}
               color={keyframeCount > 0 ? "primary" : "default"}
               sx={{ height: 20, fontSize: "0.68rem", fontWeight: 700 }}
            />
         </Stack>

         <FormControlLabel
            sx={{ display: "flex", ml: 0 }}
            control={
               <Switch
                  checked={both}
                  onChange={(e) => setBoth(e.target.checked)}
                  disabled={isActive}
                  size="small"
               />
            }
            label={
               <Typography variant="body2">
                  {both ? "Track both directions" : "Track forward only"}
               </Typography>
            }
         />
         <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            {both
               ? "Each object is followed forward and backward from its first keyframe."
               : "Objects are followed forward from their first keyframe only."}
         </Typography>

         <FormControlLabel
            sx={{ display: "flex", ml: 0 }}
            control={
               <Switch
                  checked={rangeOnly}
                  onChange={(e) => setRangeOnly(e.target.checked)}
                  disabled={isActive}
                  size="small"
               />
            }
            label={<Typography variant="body2">Track a frame range only</Typography>}
         />
         {rangeOnly && (
            <Box sx={{ mt: 1, mb: 1 }}>
               <Stack direction="row" spacing={1}>
                  <TextField
                     label="Start" type="number" size="small" fullWidth
                     value={startFrame}
                     onChange={(e) => setStartFrame(Number(e.target.value))}
                     disabled={isActive}
                     inputProps={{ min: 0, max: lastFrame }}
                  />
                  <TextField
                     label="End" type="number" size="small" fullWidth
                     value={endFrame}
                     onChange={(e) => setEndFrame(Number(e.target.value))}
                     disabled={isActive}
                     inputProps={{ min: 0, max: lastFrame }}
                  />
               </Stack>
               {/* Scrubbing to a boundary and clicking it in beats reading the
                   number off the slider and retyping it. */}
               <Stack direction="row" spacing={1} sx={{ mt: 0.75 }}>
                  <Tooltip title={`Set start to the frame on screen (${currentFrame})`}>
                     <Button
                        size="small" variant="text" fullWidth
                        startIcon={<MyLocationIcon sx={{ fontSize: "0.9rem !important" }} />}
                        onClick={() => setStartFrame(currentFrame)}
                        disabled={isActive}
                        sx={{ fontSize: "0.7rem" }}
                     >
                        Start = {currentFrame}
                     </Button>
                  </Tooltip>
                  <Tooltip title={`Set end to the frame on screen (${currentFrame})`}>
                     <Button
                        size="small" variant="text" fullWidth
                        startIcon={<MyLocationIcon sx={{ fontSize: "0.9rem !important" }} />}
                        onClick={() => setEndFrame(currentFrame)}
                        disabled={isActive}
                        sx={{ fontSize: "0.7rem" }}
                     >
                        End = {currentFrame}
                     </Button>
                  </Tooltip>
               </Stack>
            </Box>
         )}
         {rangeError && <Alert severity="warning" sx={{ mb: 1 }}>{rangeError}</Alert>}

         <Tooltip title={blockedReason ?? ""}>
            <span>
               <Button
                  fullWidth
                  variant="contained"
                  startIcon={<PlayArrowIcon />}
                  disabled={Boolean(blockedReason) || isActive}
                  onClick={() => onStart({
                     direction: both ? "both" : "forward",
                     startFrame: rangeOnly ? startFrame : null,
                     endFrame: rangeOnly ? endFrame : null,
                  })}
                  sx={{ mt: 0.5 }}
               >
                  {job && !isActive ? "Track again" : "Segment & track video"}
               </Button>
            </span>
         </Tooltip>
         {blockedReason && !isActive && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
               {blockedReason}
            </Typography>
         )}

         {job && (
            <Box sx={{ mt: 2 }}>
               {job.status === "queued" && (
                  <Alert severity="info" sx={{ mb: 1 }}>
                     Queued — the service runs one tracking job at a time. It will start automatically.
                  </Alert>
               )}
               {job.status === "running" && (
                  <>
                     <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                        <Typography variant="caption" fontWeight={600} sx={{ textTransform: "capitalize" }}>
                           {job.phase || "tracking"} pass
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                           {Math.round((job.progress ?? 0) * 100)}%
                        </Typography>
                     </Stack>
                     <LinearProgress variant="determinate" value={Math.round((job.progress ?? 0) * 100)} />
                     <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                        Chunk {job.chunk + 1} of {job.chunks_total} · frame{" "}
                        {job.frames_done.toLocaleString()} / {job.frames_total.toLocaleString()}
                     </Typography>
                  </>
               )}
               {isActive && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                     Tracking runs on the GPU service, so it keeps going if you switch pipelines or close
                     the browser. Reopen this pipeline to pick the progress back up.
                  </Typography>
               )}
               {stalled && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                     <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>No progress for a while</Typography>
                     <Typography variant="caption">
                        This job says it is running but has not reported a new frame in several minutes. If the GPU
                        service restarted — on HPC its allocation may have ended — the job is no longer actually
                        running. Check the service, then clear the results and track again.
                     </Typography>
                  </Alert>
               )}
               {job.status === "failed" && (
                  <Alert severity="error" sx={{ mb: 1 }}>
                     <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>Tracking failed</Typography>
                     <Typography variant="caption" sx={{ wordBreak: "break-word" }}>
                        {job.error ?? "The service did not say why."}
                     </Typography>
                  </Alert>
               )}
               {job.status === "cancelled" && <Alert severity="warning" sx={{ mb: 1 }}>Tracking was cancelled.</Alert>}
               {job.status === "done" && (
                  <Alert severity="success" sx={{ mb: 1 }}>
                     Tracked {job.frames_total.toLocaleString()} frames. Switch to Review to check the masks.
                  </Alert>
               )}

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
