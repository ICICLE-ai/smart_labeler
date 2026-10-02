import { Box, Paper, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import React from "react";

interface AnnotationFileFormatSwitchProps {
   coco: boolean;
   onChange: (coco: boolean) => void;
   /** Hide the sample document, for places too cramped to show it. */
   hidePreview?: boolean;
   /** Shown above the control. */
   label?: string;
}

const DEFAULT_SAMPLE = `{
  "annotations": [
    {
      "image_path": "subfolder/image1.jpg",
      "class": "donkey",
      "bounding_box": [x1, y1, x2, y2],
      "score": 0.93
    }
  ]
}`;

const COCO_SAMPLE = `{
  "info":     { "year": 2026, "version": "1.0" },
  "licenses": [],
  "images": [
    { "id": 1, "file_name": "subfolder/image1.jpg",
      "width": 640, "height": 480 }
  ],
  "categories": [
    { "id": 1, "name": "donkey", "supercategory": "none" }
  ],
  "annotations": [
    { "id": 1, "image_id": 1, "category_id": 1,
      "bbox": [x, y, width, height],
      "area": 1234, "iscrowd": 0 }
  ]
}`;

/**
 * Picks between the two annotation file formats and shows what each looks like.
 *
 * Fully controlled: the selected format lives with the caller. It used to hold
 * its own copy and push it out through an effect on mount, which meant a dialog
 * that opened with COCO selected could be silently reset to Default by the
 * child's initial render.
 */
export const AnnotationFileFormatSwitch: React.FC<AnnotationFileFormatSwitchProps> = ({
   coco,
   onChange,
   hidePreview = false,
   label = "Annotation format",
}) => (
   <Box sx={{ width: "100%" }}>
      <Typography
         variant="subtitle2"
         sx={{ mb: 1, fontWeight: 700, color: "text.secondary", letterSpacing: 0.3 }}
      >
         {label}
      </Typography>

      <ToggleButtonGroup
         exclusive
         fullWidth
         size="small"
         value={coco ? "coco" : "default"}
         onChange={(_e, value) => { if (value !== null) onChange(value === "coco"); }}
         sx={{
            mb: hidePreview ? 0 : 1.5,
            "& .MuiToggleButton-root": {
               textTransform: "none",
               fontWeight: 600,
               py: 0.75,
            },
         }}
      >
         <ToggleButton value="default">Default JSON</ToggleButton>
         <ToggleButton value="coco">COCO JSON</ToggleButton>
      </ToggleButtonGroup>

      {!hidePreview && (
         <>
            <Typography variant="caption" sx={{ display: "block", mb: 0.5, color: "text.secondary" }}>
               Format preview — your file should look like this
            </Typography>
            <Paper
               variant="outlined"
               sx={{
                  bgcolor: "#1e1e2e",
                  borderColor: "#30304a",
                  borderRadius: 1.5,
                  maxHeight: 210,
                  overflow: "auto",
                  // The sample is wide; let it scroll rather than wrap into noise.
                  "&::-webkit-scrollbar": { width: 8, height: 8 },
                  "&::-webkit-scrollbar-thumb": { background: "rgba(255,255,255,0.25)", borderRadius: 4 },
               }}
            >
               <Box
                  component="pre"
                  sx={{
                     m: 0,
                     p: 1.5,
                     fontFamily: '"SF Mono", "Fira Code", Menlo, Consolas, monospace',
                     fontSize: "0.72rem",
                     lineHeight: 1.6,
                     color: "#c9d1e3",
                     whiteSpace: "pre",
                  }}
               >
                  {coco ? COCO_SAMPLE : DEFAULT_SAMPLE}
               </Box>
            </Paper>
         </>
      )}
   </Box>
);

export default AnnotationFileFormatSwitch;
