import DrawSharp from "@mui/icons-material/DrawSharp";
import Refresh from "@mui/icons-material/Refresh";
import ZoomIn from "@mui/icons-material/ZoomIn";
import ZoomOut from "@mui/icons-material/ZoomOut";
import CropSquareIcon from '@mui/icons-material/CropSquare';
import SsidChartIcon from '@mui/icons-material/SsidChart';
import ImageIcon from '@mui/icons-material/Image';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { Box, Button, ButtonGroup, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, TextField, Tooltip, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useControls } from "react-zoom-pan-pinch";
import { SAM3_MODES } from "./utils";

const Controls = (props: {
   isEditable: boolean;
   isDrawing: boolean;
   handleDrawingStateChange: (isDrawing: boolean) => void;
   isEnableBoxEdit: boolean;
   handleEnableBoxEditChange: (isEnableBoxEdit: boolean) => void;
   isGraphEnabled?: boolean;
   handleDisplayTypeSwitch?: (type: string) => void;
   handleSAM3BoxPrediction?: (mode: string, sam3Prediction: boolean, labelValue?: string, textPrompts?: string[], isSAHIenabled?: boolean, patchSize?: number, detectionConfidence?: number, maskPrecision?: number) => void;
   sam3loading?: boolean;
   onResetAllControls?: () => void;
   lineWidth?: number;
   onLineWidthChange?: (width: number) => void;
}) => {
   const { zoomIn, zoomOut, resetTransform } = useControls();

   const LINE_WIDTHS = [2, 4, 8] as const;
   const currentLineWidth = props.lineWidth ?? 8;
   const handleLineWidthCycle = () => {
      const idx = LINE_WIDTHS.indexOf(currentLineWidth as 2 | 4 | 8);
      const next = LINE_WIDTHS[(idx + 1) % LINE_WIDTHS.length];
      props.onLineWidthChange?.(next);
   };
   const lineWidthLabel = currentLineWidth === 2 ? "Thin" : currentLineWidth === 4 ? "Normal" : "Thick";

   const [isDrawing, setIsDrawing] = useState(props.isDrawing);
   const [isEnableBoxEdit, setIsEnableBoxEdit] = useState(props.isEnableBoxEdit);
   const [inGraphMode, setInGraphMode] = useState(false);
   const [isSAM3, setIsSAM3] = useState(false);
   // const [inImageMode, setInImageMode] = useState(true);
   const [openDialog, setOpenDialog] = useState(false);
   const [labelValue, setLabelValue] = useState("");
   const [mode, setMode] = useState<SAM3_MODES>(SAM3_MODES.SINGLE_CLICK);
   const [textPrompts, setTextPrompts] = useState<string[]>([]);
   const [patchSize, setPatchSize] = useState<number>(640);
   const [isSAHIenabled, setIsSAHIenabled] = useState(false);
   const [detectionConfidence, setDetectionConfidence] = useState<number>(0.3);
   const [maskPrecision, setMaskPrecision] = useState<number>(0.3);

   useEffect(() => {
      props.handleDrawingStateChange(isDrawing);
   }, [isDrawing]);

   useEffect(() => {
      props.handleEnableBoxEditChange(isEnableBoxEdit);
   }, [isEnableBoxEdit]);

   useEffect(() => {
      if (props.onResetAllControls) {
         props.onResetAllControls();
      }
   }, [props.onResetAllControls]);

   const resetAllControls = () => {
      setIsDrawing(false);
      setIsEnableBoxEdit(false);
      setInGraphMode(false);
      setIsSAM3(false);
      setOpenDialog(false);
      setLabelValue("");
      setTextPrompts([]);
      setPatchSize(640);
      setDetectionConfidence(0.3);
      setMaskPrecision(0.3);
      props.handleDrawingStateChange(false);
      props.handleEnableBoxEditChange(false);
      props.handleSAM3BoxPrediction?.("", false);
   };

   // Listen for reset signal from parent
   useEffect(() => {
      const handleResetSignal = () => resetAllControls();
      window.addEventListener("canvas-escape-pressed", handleResetSignal);
      return () => window.removeEventListener("canvas-escape-pressed", handleResetSignal);
   }, []);

   return (
      <>
         <div
            style={{
               position: "sticky",
               top: 0,
               right: 0,
               zIndex: 10,
               background: "rgba(255,255,255,0.92)",
               backdropFilter: "blur(4px)",
               borderRadius: "0 0 0 8px",
               boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
               display: "flex",
               alignItems: "center",
               justifyContent: "flex-end",
               paddingLeft: "16px",
               marginLeft: "auto",
            }}
         >
         <div
            className="tools"
            style={{
               display: "flex",
               alignItems: "center",
               justifyContent: "flex-end",
            }}
         >
            <ButtonGroup variant="text">
               <Tooltip title="Zoom-in">
                  <IconButton
                     onClick={() => zoomIn()}
                     disabled={props.isDrawing}
                     color="primary"
                  >
                     <ZoomIn></ZoomIn>
                  </IconButton>
               </Tooltip>
               <Tooltip title="Zoom-out">
                  <IconButton
                     onClick={() => zoomOut()}
                     disabled={props.isDrawing}
                     color="primary"
                  >
                     <ZoomOut></ZoomOut>
                  </IconButton>
               </Tooltip>
               <Tooltip title="refresh">
                  <IconButton onClick={() => resetTransform()} color="primary">
                     <Refresh></Refresh>
                  </IconButton>
               </Tooltip>
            </ButtonGroup>
            <Divider orientation="vertical" flexItem />
            <Tooltip
               title="Draw"
               onClick={() => {
                  setIsDrawing(!isDrawing);
                  setIsEnableBoxEdit(false);
                  setIsSAM3(false);
                  props.handleSAM3BoxPrediction && props.handleSAM3BoxPrediction("", false);
               }}
            >
               <IconButton
                  disabled={!props.isEditable}
               >
                  <DrawSharp
                     sx={{
                        color: !isDrawing ? "black" : "orange",
                     }}
                  ></DrawSharp>
               </IconButton>
            </Tooltip>
            <Divider orientation="vertical" flexItem />
            <Tooltip
               title="Edit Box"
               onClick={() => {
                  setIsEnableBoxEdit(prev => !prev);
                  setIsDrawing(false);
                  setIsSAM3(false);
                  props.handleSAM3BoxPrediction && props.handleSAM3BoxPrediction("", false);
               }}
            >
               <IconButton
                  disabled={!props.isEditable}
               >
                  <CropSquareIcon
                     sx={{
                        color: !isEnableBoxEdit ? "black" : "orange",
                     }}
                  ></CropSquareIcon>
               </IconButton>
            </Tooltip>
            <Divider orientation="vertical" flexItem />
            <Tooltip
               title="Graph Mode"
               onClick={() => {
                  resetTransform();
                  setInGraphMode(true);
                  setIsDrawing(false);
                  setIsEnableBoxEdit(false);
                  props.handleDisplayTypeSwitch && props.handleDisplayTypeSwitch('GRAPH');
               }}
            >
               <IconButton
                  disabled={!props.isGraphEnabled}
               >
                  <SsidChartIcon
                     sx={{
                        color: props.isGraphEnabled ? !inGraphMode ? "black" : "orange" : "lightgrey",
                     }}
                  ></SsidChartIcon>
               </IconButton>
            </Tooltip>
            <Tooltip
               title="Image Mode"
               onClick={() => {
                  setInGraphMode(false);
                  props.handleDisplayTypeSwitch && props.handleDisplayTypeSwitch('IMAGE');
               }}
            >
               <IconButton
               >
                  <ImageIcon
                     sx={{
                        color: inGraphMode ? "black" : "orange",
                     }}
                  ></ImageIcon>
               </IconButton>
            </Tooltip>
            <Divider orientation="vertical" flexItem />
            <Tooltip title={`Box stroke: ${lineWidthLabel} (${currentLineWidth}px) – click to cycle`}>
               <IconButton onClick={handleLineWidthCycle}>
                  <Box component="span" sx={{ display: "inline-flex", flexDirection: "column", gap: "3px", alignItems: "center", justifyContent: "center", height: 24 }}>
                     {([2, 4, 8] as const).map((w) => (
                        <Box key={w} sx={{ width: 18, height: `${w / 2}px`, minHeight: `${w / 2}px`, backgroundColor: currentLineWidth >= w ? "#1976d2" : "#bdbdbd", borderRadius: 0.5 }} />
                     ))}
                  </Box>
               </IconButton>
            </Tooltip>
            <Divider orientation="vertical" flexItem />
            <Tooltip
               title="SAM3 Segmentation Assisted Annotation"
            >
               <>
                  <IconButton
                     disabled={!props.isEditable}
                     onClick={() => {
                        setOpenDialog(true);
                     }}
                  >
                     <AutoFixHighIcon
                        sx={{
                           color: !isSAM3 ? "black" : "orange",
                        }}
                     ></AutoFixHighIcon>
                  </IconButton>
               </>
            </Tooltip>
         </div>
         {props.sam3loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
               <CircularProgress size={20} />
               <Typography variant="body2" color="text.secondary" fontWeight={500}>
                  Prediction in progress...
               </Typography>
            </Box>
         )}
         </div>
         <Dialog
            open={openDialog}
            onClose={() => {
               setOpenDialog(false);
            }}
            maxWidth="xs"
            fullWidth
         >
            <DialogTitle sx={{ fontFamily: "system-ui" }}>Segmentation Assisted Annotation (SAM3)</DialogTitle>
            <DialogContent>
               <TextField
                  select
                  fullWidth
                  label="Mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as SAM3_MODES)}
                  variant="filled"
                  SelectProps={{
                     native: true,
                  }}
                  sx={{ mb: 2 }}
               >

                  <option value={SAM3_MODES.SINGLE_CLICK}>Single Click</option>
                  <option value={SAM3_MODES.TEXT_PROMPTS}>Text Prompt</option>
                  <option value={SAM3_MODES.EXEMPLAR}>Exemplar Prompt</option>
               </TextField>
                  {mode === SAM3_MODES.TEXT_PROMPTS ? (
                      <TextField
                        variant="filled"
                        autoFocus
                        fullWidth
                        value={textPrompts}
                        label="Text Prompt/s"
                        onChange={(e) => setTextPrompts(e.target.value.split(","))}
                        placeholder="Enter prompts separated by commas"
                      />
                    ) : (
                    <TextField
                      variant="filled"
                      autoFocus
                      fullWidth
                      label="Label"
                      value={labelValue}
                      onChange={(e) => setLabelValue(e.target.value)}
                      placeholder={"e.g., person, cat"}
                    />
                    )}
                  {mode === SAM3_MODES.EXEMPLAR && (
                     <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                        After clicking Enter, draw a box around one example object. The service will detect the remaining similar objects automatically.
                     </Typography>
                  )}
                  <Box sx={{ mt: 2, mb: 1 }}>
                     <Typography variant="body2" sx={{ mb: 0.5 }}>Enable SAHI</Typography>
                     <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                        SAHI (Slicing Aided Hyper Inference) divides the image into overlapping tiles before running inference. This significantly improves detection of small or densely packed objects in large images.
                     </Typography>
                     <Button
                        variant={isSAHIenabled ? "contained" : "outlined"}
                        onClick={() => setIsSAHIenabled(!isSAHIenabled)}
                        fullWidth
                     >
                        {isSAHIenabled ? "SAHI Enabled" : "SAHI Disabled"}
                     </Button>
                  </Box>
                  {isSAHIenabled && (
                     <TextField
                        variant="filled"
                        fullWidth
                        label="Crop Size (patch_size)"
                        type="number"
                        value={patchSize}
                        onChange={(e) => setPatchSize(Math.max(0, Number(e.target.value)))}
                        placeholder="Enter crop size for SAHI (e.g., 640)"
                        helperText="Tile size in pixels used to slice the image. Smaller values catch finer details; larger values are faster."
                        sx={{ mt: 1 }}
                     />
                  )}
                  <TextField
                     variant="filled"
                     fullWidth
                     label="Detection Confidence"
                     type="number"
                     value={detectionConfidence}
                     onChange={(e) => setDetectionConfidence(Math.min(1, Math.max(0, Number(e.target.value))))}
                     inputProps={{ min: 0, max: 1, step: 0.05 }}
                     helperText="Minimum confidence score (0–1) a detection must reach to be kept. Raise this to reduce false positives; lower it to catch more candidates."
                     sx={{ mt: 2 }}
                  />
                  <TextField
                     variant="filled"
                     fullWidth
                     label="Mask Precision"
                     type="number"
                     value={maskPrecision}
                     onChange={(e) => setMaskPrecision(Math.min(1, Math.max(0, Number(e.target.value))))}
                     inputProps={{ min: 0, max: 1, step: 0.05 }}
                     helperText="Controls how closely the mask contour follows object boundaries (0–1). Higher values produce finer, more detailed outlines; lower values give smoother, simplified shapes."
                     sx={{ mt: 2 }}
                  />
            </DialogContent>
            <DialogActions>
               <Button
                  onClick={() => {
                     setOpenDialog(false);
                     setIsSAM3(false);
                     props.handleSAM3BoxPrediction && props.handleSAM3BoxPrediction(mode, false, "", [], false, 640, 0.3, 0.3);
                     setLabelValue("");
                     setTextPrompts([]);
                  }}
               >
                  Exit
               </Button>
               <Button variant="contained" onClick={() => {
                  setIsSAM3(true);
                  setIsDrawing(false);
                  setIsEnableBoxEdit(false);
                  props.handleSAM3BoxPrediction && props.handleSAM3BoxPrediction(mode, true, labelValue, textPrompts, isSAHIenabled, patchSize, detectionConfidence, maskPrecision);
                  setOpenDialog(false);
               }}>
                  Enter
               </Button>
            </DialogActions>
         </Dialog>
      </>
   );
};

export default Controls;