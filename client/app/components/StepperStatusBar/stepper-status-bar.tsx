import React, { useEffect, useRef, useState } from "react";
import {
   Box,
   Chip,
   IconButton,
   Tooltip,
   Typography,
   Menu,
   MenuItem,
   Alert,
   CircularProgress,
   ListItemIcon,
   ListItemText,
   Divider,
   Modal,
   Paper,
   Button,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import RemoveCircleIcon from "@mui/icons-material/RemoveCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import HomeIcon from "@mui/icons-material/Home";
import SettingsIcon from "@mui/icons-material/Settings";
import ImageIcon from "@mui/icons-material/Image";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import { Step } from "../ImageAnnotation/utils";
import { useNavigate } from "@remix-run/react";
import { usePipeline } from "~/context/PipelineContext";

interface StepperStatusBarProps {
   steps: Step[];
   currentStep: number;
   onStepClick: (stepIndex: number) => void;
   pipeId: string;
}

const statusStyles: Record<
   Step["status"],
   { color: string; bg: string; border: string }
> = {
   READY: { color: "#1565c0", bg: "#e3f2fd", border: "#90caf9" },
   IN_PROGRESS: { color: "#e6a500", bg: "#fff3e0", border: "#ffb74d" },
   COMPLETED: { color: "#2e7d32", bg: "#e8f5e9", border: "#81c784" },
   FAILED: { color: "#c62828", bg: "#ffebee", border: "#ef9a9a" },
   SKIPPED: { color: "#616161", bg: "#f5f5f5", border: "#bdbdbd" },
   CONFIGURATION: { color: "#232224", bg: "#ede7f6", border: "#b39ddb" },
   ANNOTATOR: { color: "#00695c", bg: "#e0f2f1", border: "#80cbc4" },
};

const StepItem = ({
   step,
   isSelected,
   onClick,
   onGetStatus,
   onGetTapisOut,
}: {
   step: Step;
   isSelected: boolean;
   onClick: () => void;
   onGetStatus: () => Promise<void> | void;
   onGetTapisOut: () => Promise<void> | void;
}) => {
   const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
   const [loadingStatus, setLoadingStatus] = useState(false);
   const [loadingLogs, setLoadingLogs] = useState(false);

   const iconMap: Record<Step["status"], React.ReactElement> = {
      READY: <RadioButtonUncheckedIcon sx={{ fontSize: 16 }} />,
      IN_PROGRESS: (
         <RotateRightIcon
            sx={{
               fontSize: 16,
               animation: "spin 1.2s linear infinite",
               "@keyframes spin": {
                  "0%": { transform: "rotate(0deg)" },
                  "100%": { transform: "rotate(360deg)" },
               },
            }}
         />
      ),
      COMPLETED: <CheckCircleIcon sx={{ fontSize: 16 }} />,
      FAILED: <CancelIcon sx={{ fontSize: 16 }} />,
      SKIPPED: <RemoveCircleIcon sx={{ fontSize: 16 }} />,
      CONFIGURATION: <SettingsIcon sx={{ fontSize: 16 }} />,
      ANNOTATOR: <ImageIcon sx={{ fontSize: 16 }} />,
   };


   const style = statusStyles[step.status];

   const handleMenuOpen = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      setMenuAnchor(e.currentTarget);
   };

   const handleMenuClose = (_event: {}, _reason: "backdropClick" | "escapeKeyDown") => {
      setMenuAnchor(null);
   };

   const handleGetStatus = async (e: React.MouseEvent) => {
      e.stopPropagation();
      setLoadingStatus(true);
      try {
         await onGetStatus();
      } finally {
         setLoadingStatus(false);
         handleMenuClose({}, "backdropClick");
      }
   };

   const handleGetTapisOut = async (e: React.MouseEvent) => {
      e.stopPropagation();
      setLoadingLogs(true);
      try {
         await onGetTapisOut();
      } finally {
         setLoadingLogs(false);
         handleMenuClose({}, "backdropClick");
      }
   };

   return (
      <>
         <Box
            sx={{
               position: "relative",
               display: "inline-flex",
               alignItems: "center",
            }}
         >
            <Chip
               icon={
                  <Box
                     sx={{
                        color: `${style.color} !important`,
                        display: "flex",
                        alignItems: "center",
                     }}
                  >
                     {iconMap[step.status]}
                  </Box>
               }
               label={
                  <Typography
                     sx={{
                        fontSize: "0.78rem",
                        fontWeight: isSelected ? 700 : 500,
                        whiteSpace: "nowrap",
                        color: style.color,
                        pr: 2.25, // room for the in-chip 2-dot button
                     }}
                  >
                     {step.label}
                  </Typography>
               }
               onClick={onClick}
               variant="outlined"
               sx={{
                  height: 34,
                  borderRadius: "999px",
                  borderWidth: isSelected ? 2 : 1,
                  borderStyle: "solid",
                  borderColor: isSelected ? style.color : style.border,
                  bgcolor: isSelected ? style.color : style.bg,
                  "& .MuiChip-label": { px: 1 },
                  "& .MuiChip-icon": { ml: "8px", mr: 0 },
                  "& .MuiTypography-root": {
                     color: isSelected ? "#fff" : style.color,
                  },
                  "& .MuiBox-root": {
                     color: isSelected ? "#fff !important" : `${style.color} !important`,
                  },
                  boxShadow: isSelected
                     ? `0 0 0 3px ${style.border}`
                     : "0 1px 3px rgba(0,0,0,0.12)",
                  transition: "all 0.2s ease",
                  cursor: "pointer",
                  "&:hover": {
                     bgcolor: isSelected ? style.color : style.border,
                     boxShadow: `0 2px 8px rgba(0,0,0,0.18)`,
                     transform: "translateY(-1px)",
                  },
                  flexShrink: 0,
                  pr: 0.5,
               }}
            />
            {/* 2-dot action button INSIDE chip - only show if step has a jobId */}
            {step.jobId && (
               <IconButton
                  size="small"
                  onClick={handleMenuOpen}
                  sx={{
                     position: "absolute",
                     right: 6,
                     top: "50%",
                     transform: "translateY(-50%)",
                     width: 20,
                     height: 20,
                     color: isSelected ? "#fff" : style.color,
                     opacity: 0.85,
                     borderRadius: "999px",
                     "&:hover": {
                        opacity: 1,
                        bgcolor: isSelected ? "rgba(255,255,255,0.22)" : `${style.color}18`,
                     },
                  }}
               >
                  <Box sx={{ display: "flex", flexDirection: "column", gap: "3px", alignItems: "center" }}>
                     <Box sx={{ width: 3.5, height: 3.5, borderRadius: "50%", bgcolor: "currentColor" }} />
                     <Box sx={{ width: 3.5, height: 3.5, borderRadius: "50%", bgcolor: "currentColor" }} />
                  </Box>
               </IconButton>
            )}

            <Menu
               anchorEl={menuAnchor}
               open={Boolean(menuAnchor)}
               onClose={handleMenuClose}
               anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
               transformOrigin={{ vertical: "top", horizontal: "center" }}
               PaperProps={{
                  sx: {
                     borderRadius: 2,
                     minWidth: 220,
                     boxShadow: "0 10px 24px rgba(0,0,0,0.16)",
                  },
               }}
            >
               <MenuItem onClick={handleGetStatus} disabled={loadingStatus || loadingLogs}>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                     {loadingStatus ? <CircularProgress size={16} /> : <InfoOutlinedIcon fontSize="small" />}
                  </ListItemIcon>
                  <ListItemText primary="Get Status" secondary="Fetch latest job state" />
               </MenuItem>

               <Divider />

               <MenuItem onClick={handleGetTapisOut} disabled={loadingStatus || loadingLogs}>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                     {loadingLogs ? <CircularProgress size={16} /> : <DescriptionOutlinedIcon fontSize="small" />}
                  </ListItemIcon>
                  <ListItemText primary="Get Application Logs" secondary="Download job logs (tapis.out)" />
               </MenuItem>
            </Menu>
         </Box>
      </>
   );
};

const CopyToClipboardButton = ({ content }: { content?: string }) => {
   const [label, setLabel] = useState<"idle" | "success" | "error">("idle");
   const textareaRef = useRef<HTMLTextAreaElement>(null);

   const handleCopy = async () => {
      if (content == null) return;
      const finish = (ok: boolean) => {
         setLabel(ok ? "success" : "error");
         setTimeout(() => setLabel("idle"), 2000);
      };
      // Primary: Clipboard API (requires secure context or localhost)
      if (navigator.clipboard && window.isSecureContext) {
         try {
            await navigator.clipboard.writeText(content);
            finish(true);
            return;
         } catch {
            // fall through to textarea fallback
         }
      }
      // Fallback: select the hidden textarea that lives *inside* the modal DOM
      // so MUI's focus trap doesn't interfere.
      if (textareaRef.current) {
         textareaRef.current.select();
         const ok = document.execCommand("copy");
         finish(ok);
      } else {
         finish(false);
      }
   };

   const btnColor = label === "success" ? "#4caf50" : label === "error" ? "#f44336" : "#fff";
   const borderColor = label === "success" ? "#4caf50" : label === "error" ? "#f44336" : "#666";

   return (
      <>
         {/* Hidden textarea inside the modal — required for the execCommand fallback to work
             inside MUI's focus trap. */}
         <textarea
            ref={textareaRef}
            readOnly
            value={content ?? ""}
            aria-hidden="true"
            tabIndex={-1}
            style={{
               position: "absolute",
               width: 1,
               height: 1,
               opacity: 0,
               pointerEvents: "none",
               top: 0,
               left: 0,
            }}
         />
         <Button
            variant="outlined"
            sx={{
               color: btnColor,
               borderColor,
               "&:hover": { borderColor: "#fff", bgcolor: "rgba(255,255,255,0.1)" },
               transition: "color 0.2s, border-color 0.2s",
            }}
            onClick={handleCopy}
         >
            {label === "success" ? "Copied!" : label === "error" ? "Copy failed" : "Copy to Clipboard"}
         </Button>
      </>
   );
};

// Main App component
const StepperStatusBar = ({
   steps,
   currentStep,
   onStepClick,
   pipeId,
}: StepperStatusBarProps) => {
   const navigate = useNavigate();
   
   const context = usePipeline();

   const stepsData = context.stepsData.length > 0 ? context.stepsData : steps;
   const { statusAlert, setStatusAlert, statusModal, setStatusModal, 
           logsModal, setLogsModal, fetchStatus, downloadLogs , notifyJobSubmitted} = context;

   const handleStepClick = (stepId: number) => {
      // Prevent navigation if the step is already selected
      const currentlySelected = stepsData.find((s) => s.selected);
      if (currentlySelected?.id === stepId) return;

      const step = steps.find((s) => s.id === stepId);
      const updated = stepsData.map((s) => ({ ...s, selected: s.id === stepId }));
      window.localStorage.setItem(pipeId, JSON.stringify(updated));
      navigate(step?.url + `/${pipeId}`);
   };

   return (
      <>
         {/* Status Modal */}
         <Modal
            open={!!statusModal}
            onClose={() => setStatusModal(null)}
            sx={{
               display: "flex",
               alignItems: "center",
               justifyContent: "center",
            }}
         >
            <Paper
               sx={{
                  width: "90%",
                  maxWidth: 500,
                  p: 4,
                  borderRadius: 2,
                  boxShadow: 24,
               }}
            >
               <Typography variant="h6" sx={{ mb: 3, fontWeight: 600 }}>
                  Job Status Information
               </Typography>
               
               <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mb: 4 }}>
                  {/* Status Field */}
                  <Box>
                     <Box sx={{ p: 2, bgcolor: "#f5f5f5", borderRadius: 1 }}>
                        <Typography variant="body2" sx={{ color: "#666", mb: 0.5, fontWeight: 500 }}>
                           Status
                        </Typography>
                        <Typography variant="body1" sx={{ fontWeight: 600, fontFamily: "monospace" }}>
                           {statusModal?.status || "N/A"}
                        </Typography>
                     </Box>
                  </Box>

                  {/* Condition Field */}
                  <Box>
                     <Box sx={{ p: 2, bgcolor: "#f5f5f5", borderRadius: 1 }}>
                        <Typography variant="body2" sx={{ color: "#666", mb: 0.5, fontWeight: 500 }}>
                           Condition
                        </Typography>
                        <Typography variant="body1" sx={{ fontWeight: 600, fontFamily: "monospace" }}>
                           {statusModal?.condition || "N/A"}
                        </Typography>
                     </Box>
                  </Box>

                  {/* Message Field */}
                  <Box>
                     <Box sx={{ p: 2, bgcolor: "#f5f5f5", borderRadius: 1 }}>
                        <Typography variant="body2" sx={{ color: "#666", mb: 0.5, fontWeight: 500 }}>
                           Message
                        </Typography>
                        <Typography 
                           variant="body2" 
                           sx={{ 
                              fontFamily: "monospace",
                              wordBreak: "break-word",
                              whiteSpace: "pre-wrap",
                           }}
                        >
                           {statusModal?.message || "N/A"}
                        </Typography>
                     </Box>
                  </Box>
               </Box>

               {/* Close Button */}
               <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button 
                     variant="contained" 
                     onClick={() => setStatusModal(null)}
                     sx={{ textTransform: "none" }}
                  >
                     Close
                  </Button>
               </Box>
            </Paper>
         </Modal>

         {/* Logs Modal */}
         <Modal
            open={!!logsModal}
            onClose={() => setLogsModal(null)}
            sx={{
               display: "flex",
               alignItems: "center",
               justifyContent: "center",
            }}
         >
            <Paper
               sx={{
                  width: "90%",
                  maxWidth: 800,
                  height: "80vh",
                  p: 2,
                  borderRadius: 2,
                  boxShadow: 24,
                  display: "flex",
                  flexDirection: "column",
                  bgcolor: "#000",
               }}
            >
               <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, color: "#fff" }}>
                  Application Logs (tapis.out)
               </Typography>
               
               <Box
                  sx={{
                     flex: 1,
                     bgcolor: "#000",
                     border: "1px solid #333",
                     borderRadius: 1,
                     p: 2,
                     overflowY: "auto",
                     fontFamily: "monospace",
                     fontSize: "0.85rem",
                     color: "#fff",
                     whiteSpace: "pre-wrap",
                     wordBreak: "break-word",
                  }}
               >
                  {logsModal?.content || "No logs available"}
               </Box>

               <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 2, mt: 2 }}>
                  <CopyToClipboardButton content={logsModal?.content} />
                  <Button 
                     variant="contained"
                     sx={{
                        bgcolor: "#444",
                        color: "#fff",
                        "&:hover": { bgcolor: "#555" }
                     }}
                     onClick={() => setLogsModal(null)}
                  >
                     Close
                  </Button>
               </Box>
            </Paper>
         </Modal>

         {statusAlert && (
            <Box sx={{ px: 1, pt: 0.5 }}>
               <Alert
                  severity={statusAlert.type}
                  onClose={() => setStatusAlert(null)}
                  sx={{ fontSize: "0.85rem" }}
               >
                  {statusAlert.message}
               </Alert>
            </Box>
         )}
         <Box
            sx={{
               position: "sticky",
               top: 0,
               zIndex: 1100,
               width: "100%",
               bgcolor: "background.paper",
               borderBottom: "1px solid",
               borderColor: "divider",
               boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
         >
            <Box
               sx={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  px: 1,
                  py: 0.75,
                  gap: 1,
                  minHeight: 52,
               }}
            >
               {/* Home button */}
               <Tooltip title="Dashboard" placement="bottom">
                  <IconButton
                     onClick={() => navigate("/dashboard")}
                     size="small"
                     sx={{
                        flexShrink: 0,
                        bgcolor: "action.hover",
                        borderRadius: "8px",
                        "&:hover": { bgcolor: "action.selected" },
                     }}
                  >
                     <HomeIcon fontSize="small" />
                  </IconButton>
               </Tooltip>

               {/* Divider */}
               <Box
                  sx={{
                     flexShrink: 0,
                     width: "1px",
                     height: 28,
                     bgcolor: "divider",
                  }}
               />

               {/* Scrollable steps */}
               <Box
                  sx={{
                     display: "flex",
                     flexDirection: "row",
                     alignItems: "center",
                     overflowX: "auto",
                     gap: 0.5,
                     flex: 1,
                     // Hide scrollbar on most browsers but keep functionality
                     scrollbarWidth: "none",
                     "&::-webkit-scrollbar": { display: "none" },
                  }}
               >
                  {stepsData.map((step, index) => (
                     <React.Fragment key={step.id}>
                        <StepItem
                           step={step}
                           isSelected={step.id === currentStep}
                           onClick={() => handleStepClick(step.id)}
                           onGetStatus={async () => {
                              if (step.jobId) {
                                 await fetchStatus(step.jobId, step.id);
                              } else {
                                 setStatusAlert({
                                    stepId: step.id,
                                    message: "No job ID found for this step",
                                    type: "error"
                                 });
                              }
                           }}
                           onGetTapisOut={() => downloadLogs(step.id)}
                        />
                        {index < stepsData.length - 1 && (
                           <ChevronRightIcon
                              sx={{
                                 flexShrink: 0,
                                 fontSize: 16,
                                 color: "text.disabled",
                              }}
                           />
                        )}
                     </React.Fragment>
                  ))}
               </Box>

               {/* Refresh button */}
               <Tooltip title="Refresh all steps" placement="bottom">
                  <IconButton
                     onClick={() => {
                        notifyJobSubmitted();
                     }}
                     size="small"
                     sx={{
                        flexShrink: 0,
                        bgcolor: "action.hover",
                        borderRadius: "8px",
                        "&:hover": { bgcolor: "action.selected" },
                     }}
                  >
                     <RotateRightIcon fontSize="small" />
                  </IconButton>
               </Tooltip>
            </Box>
         </Box>
      </>
   );
};

export default StepperStatusBar;

const getStoredSteps = (pipeId: string, defaultSteps: Step[]): Step[] => {
   if (typeof window === 'undefined') return defaultSteps;

   try {
      const stored = window.localStorage.getItem(pipeId);
      return stored ? JSON.parse(stored) : defaultSteps;
   } catch (e) {
      console.error('Error reading from localStorage:', e);
      return defaultSteps;
   }
};

// Add this helper function for saving steps
const saveSteps = (pipeId: string, steps: Step[]): void => {
   if (typeof window === 'undefined') return;

   try {
      window.localStorage.setItem(pipeId, JSON.stringify(steps));
   } catch (e) {
      console.error('Error saving to localStorage:', e);
   }
};