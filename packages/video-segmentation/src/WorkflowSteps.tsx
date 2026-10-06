import { useState } from "react";
import {
   Box, Collapse, IconButton, Link, Paper, Step, StepLabel, Stepper, Typography,
} from "@mui/material";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";

export const WORKFLOW_STEPS = [
   "Upload video",
   "Add objects",
   "Annotate keyframes",
   "Track",
   "Review & export",
] as const;

/** Short instruction shown under the stepper for whichever step is active. */
const STEP_HINTS: Record<number, string> = {
   0: "Drop in a video. It is decoded on the GPU service, which reports its frame count and size.",
   1: "Add one object per thing you want tracked, and give each a label. Objects keep the same id across every keyframe.",
   2: "Select an object, scrub to a frame where it is clearly visible, then draw it with the polygon tool or click it with SAM3. Annotate a few spread-out frames for better tracking.",
   3: "Tracking runs on the GPU, one job at a time, and follows every object forward and backward from its keyframes.",
   4: "Scrub to check the masks. If one drifted, correct that frame and track again — the new keyframe re-anchors the object.",
};

export interface WorkflowStepsProps {
   activeStep: number;
}

/** Numbered workflow with a hint for the current step, plus a collapsible primer. */
export function WorkflowSteps({ activeStep }: WorkflowStepsProps) {
   const [helpOpen, setHelpOpen] = useState(false);

   return (
      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
         <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
            <Stepper activeStep={activeStep} alternativeLabel sx={{ flex: 1 }}>
               {WORKFLOW_STEPS.map((label) => (
                  <Step key={label}>
                     <StepLabel sx={{ "& .MuiStepLabel-label": { fontSize: "0.78rem" } }}>{label}</StepLabel>
                  </Step>
               ))}
            </Stepper>
            <IconButton
               size="small"
               onClick={() => setHelpOpen((v) => !v)}
               aria-label={helpOpen ? "Hide help" : "Show help"}
            >
               {helpOpen ? <ExpandLessIcon fontSize="small" /> : <HelpOutlineIcon fontSize="small" />}
            </IconButton>
         </Box>

         <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: "center" }}>
            {STEP_HINTS[activeStep] ?? ""}
         </Typography>

         <Collapse in={helpOpen}>
            <Box sx={{ mt: 2, pt: 2, borderTop: "1px solid", borderColor: "divider" }}>
               <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.75 }}>
                  How video tracking works here
               </Typography>
               <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: "0.85rem", lineHeight: 1.8, color: "text.secondary" }}>
                  <li>
                     You annotate a <strong>few keyframes</strong>, not every frame. The GPU service propagates each
                     object's mask through the rest of the video.
                  </li>
                  <li>
                     Frames are numbered by <strong>decoded frame index</strong>, straight from the service — not by
                     timestamp. That is why frames are fetched rather than played in a video element: a
                     variable-frame-rate recording would otherwise drift out of alignment with the tracker.
                  </li>
                  <li>
                     Long videos are split into <strong>chunks</strong> of about a thousand frames. Opening a chunk
                     extracts its frames on the service first, which is why the slider pauses briefly on a new chunk.
                  </li>
                  <li>
                     An object can first appear on any keyframe; it is tracked <strong>backward</strong> from there
                     too, so you do not need to find its first frame.
                  </li>
                  <li>
                     Re-tracking starts a <strong>new job</strong> and supersedes the previous results. Use
                     <strong> Clear results</strong> to discard them and rebuild your keyframes from scratch.
                  </li>
               </Box>
               <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                  Keyboard: <strong>Enter</strong> closes a polygon, <strong>Esc</strong> cancels the current tool,{" "}
                  <strong>Delete</strong> removes the selected mask.
               </Typography>
            </Box>
         </Collapse>
      </Paper>
   );
}

export default WorkflowSteps;
