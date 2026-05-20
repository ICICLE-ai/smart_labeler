// import { Download, Upload } from "@mui/icons-material";
import FileDownloadTwoToneIcon from "@mui/icons-material/FileDownloadTwoTone";
import FileUploadTwoToneIcon from "@mui/icons-material/FileUploadTwoTone";
import SaveIcon from "@mui/icons-material/Save";
import SaveAsIcon from "@mui/icons-material/SaveAs";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import DataObjectIcon from "@mui/icons-material/DataObject";
import ArticleIcon from "@mui/icons-material/Article";
import {
   AppBar,
   Box,
   Toolbar,
   IconButton,
   Typography,
   Button,
   Dialog,
   DialogActions,
   FormControl,
   DialogTitle,
   DialogContent,
   TextField,
   Select,
   MenuItem,
   Tooltip,
   Menu,
   ListItemIcon,
   ListItemText,
   Divider,
} from "@mui/material";
import { useNavigate } from "@remix-run/react";
import React, { useEffect, useState } from "react";
import { fetchFile } from "~/utils/utils";
import { useCookies } from "react-cookie";
import AnnotationFileFormatSwitch from "./AnnotationFileFormatSwitch";
import { systems } from "./utils";

interface SaveModalProps {
   open: boolean;
   onClose: () => void;
   onSave: (filePath: string, isCocoJson: boolean, system: string) => void;
   initialFilePath?: string;
   initialSystem?: string;
   initialIsCoco?: boolean;
}

const SaveModal: React.FC<SaveModalProps> = ({
   open, onClose, onSave,
   initialFilePath = "", initialSystem = "pitzer-tapis", initialIsCoco = false,
}) => {
   const [filePath, setFilePath] = useState(initialFilePath);
   const [isCocoJson, setIsCocoJson] = useState(initialIsCoco);
   const [system, setSystem] = useState<string>(initialSystem);

   // Sync with parent values whenever the modal is (re)opened
   useEffect(() => {
      if (open) {
         setFilePath(initialFilePath);
         setIsCocoJson(initialIsCoco);
         setSystem(initialSystem || "pitzer-tapis");
      }
   }, [open, initialFilePath, initialIsCoco, initialSystem]);

   const handleSave = () => {
      if (!filePath.trim()) return;
      onSave(filePath, isCocoJson, system);
      onClose();
   };

   return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
         <DialogTitle>Save Annotations</DialogTitle>
         <DialogContent>
            <Select
               value={system}
               onChange={(e) => setSystem(e.target.value)}
               fullWidth
               sx={{ mb: 2 }}
            >
               {systems.map((sys) => (
                  <MenuItem key={sys.value} value={sys.value}>
                     {sys.label}
                  </MenuItem>
               ))}
            </Select>
            <TextField
               autoFocus
               margin="dense"
               label="File Path"
               type="text"
               fullWidth
               value={filePath}
               onChange={(e) => setFilePath(e.target.value)}
               placeholder="/path/to/save/annotations.json"
               sx={{ mb: 2 }}
            />
            <FormControl component="fieldset" sx={{ width: "100%" }}>
               <AnnotationFileFormatSwitch
                  coco={isCocoJson}
                  onChange={setIsCocoJson}
               />
            </FormControl>
         </DialogContent>
         <DialogActions>
            <Button onClick={onClose} color="primary">
               Cancel
            </Button>
            <Button
               onClick={handleSave}
               color="primary"
               disabled={!filePath.trim()}
            >
               Save
            </Button>
         </DialogActions>
      </Dialog>
   );
};

const Tools = (props: {
   onDownloadCocoJson: (save: boolean, dir: string, system: string) => void;
   onDownloadDefaultJson: (save: boolean, dir: string, system: string) => void;
   handleCocoJsonUpload: (file: File) => void;
   handleDefaultJsonUpload: (file: File) => void;
   pipeId: string;
   filesUploaded: boolean;
   onAnnotationSaved?: (filePath: string, isCoco: boolean) => void;
   // Pre-populated from annotatorConfig – enables one-click Save
   annotationFilePath?: string;
   annotationSystem?: string;
   annotationIsCoco?: boolean;
   hideNextStep?: boolean;
}) => {
   const navigate = useNavigate();
   const [downloadAnchor, setDownloadAnchor] = useState<HTMLElement | null>(null);
   const [showUploadOptions, setShowUploadOptions] = useState(false);
   const [openSaveModal, setOpenSaveModal] = useState(false);
   const [pipeId, setPipeId] = useState(props.pipeId);
   const [isCoco, setIsCoco] = useState<boolean>(false);
   const [filePath, setFilePath] = useState<string>("");
   const [system, setSystem] = useState<string>("pitzer-tapis");
   const [cookie, setCookie] = useCookies(["tapis-token"]);
   const [fileUploaded, setFileUploaded] = useState<boolean>(
      props.filesUploaded
   );

   useEffect(() => {
      setPipeId(props.pipeId);
   }, [props.pipeId]);

   useEffect(() => {
      setFileUploaded(props.filesUploaded);
   }, [props.filesUploaded]);

   function handleDownloadCocoJson(): void {
      props.onDownloadCocoJson(false, "", system);
      setDownloadAnchor(null);
   }

   function handleDownloadDefaultJson(): void {
      props.onDownloadDefaultJson(false, "", system);
      setDownloadAnchor(null);
   }

   function handleDirectSave() {
      const path = props.annotationFilePath?.trim();
      if (!path) {
         // No known path – fall back to Save As dialog
         setOpenSaveModal(true);
         return;
      }
      const savedSystem = props.annotationSystem ?? system;
      if (props.annotationIsCoco) {
         props.onDownloadCocoJson(true, path, savedSystem);
      } else {
         props.onDownloadDefaultJson(true, path, savedSystem);
      }
      props.onAnnotationSaved?.(path, props.annotationIsCoco ?? false);
   }

   function handleSaveModalConfirm(filePath: string, isCocoJson: boolean, system: string) {
      if (isCocoJson) {
         props.onDownloadCocoJson(true, filePath, system);
      } else {
         props.onDownloadDefaultJson(true, filePath, system);
      }
      props.onAnnotationSaved?.(filePath, isCocoJson);
      setDownloadAnchor(null);
   }

   async function handleUploadAnnotationFile() {
      let file: File | null = null;
      try {
         const res = await getFile(filePath);
         const text = await res.text();
         file = new File([text], "annotations.json", {
            type: "application/json",
         });
      } catch (error) {
         console.error("Error fetching file:", error);
         return;
      }
      if (isCoco) {
         props.handleCocoJsonUpload(file);
      } else {
         props.handleDefaultJsonUpload(file);
      }
   }

   const getFile = async (filePath: string) => {
      return await fetchFile(
         `/get_file/${pipeId}/${system}?filePath=${encodeURIComponent(
            filePath
         )}`,
         cookie["tapis-token"]["access_token"]
      );
   };

   return (
      <>
         <AppBar
            position="static"
            elevation={2}
            sx={{ bgcolor: "grey.900", backgroundImage: "none" }}
         >
            <Toolbar sx={{ minHeight: 52, gap: 0.5, px: 2 }}>
               {/* Title */}
               <Typography
                  variant="subtitle1"
                  fontWeight={700}
                  noWrap
                  sx={{ letterSpacing: "0.04em", color: "white", mr: 1.5, flexShrink: 0 }}
               >
                  Image Annotator
               </Typography>

               <Divider
                  orientation="vertical"
                  flexItem
                  sx={{ borderColor: "rgba(255,255,255,0.2)", mx: 1 }}
               />

               {/* Download */}
               <Tooltip title="Download annotations">
                  <IconButton
                     size="small"
                     onClick={(e) => setDownloadAnchor(e.currentTarget)}
                     sx={{
                        color: "rgba(255,255,255,0.85)",
                        borderRadius: 1.5,
                        "&:hover": { bgcolor: "rgba(255,255,255,0.1)", color: "white" },
                     }}
                  >
                     <FileDownloadTwoToneIcon />
                  </IconButton>
               </Tooltip>
               <Menu
                  anchorEl={downloadAnchor}
                  open={Boolean(downloadAnchor)}
                  onClose={() => setDownloadAnchor(null)}
                  slotProps={{
                     paper: {
                        elevation: 6,
                        sx: { minWidth: 200, mt: 0.5, borderRadius: 2 },
                     },
                  }}
               >
                  <MenuItem onClick={handleDownloadCocoJson} dense>
                     <ListItemIcon>
                        <DataObjectIcon fontSize="small" color="primary" />
                     </ListItemIcon>
                     <ListItemText primary="COCO JSON" />
                  </MenuItem>
                  <MenuItem onClick={handleDownloadDefaultJson} dense>
                     <ListItemIcon>
                        <ArticleIcon fontSize="small" color="primary" />
                     </ListItemIcon>
                     <ListItemText primary="Default JSON" />
                  </MenuItem>
               </Menu>

               {/* Upload */}
               <Tooltip
                  title={
                     fileUploaded
                        ? "Import annotations"
                        : "Select image files first before importing"
                  }
               >
                  <span>
                     <IconButton
                        size="small"
                        disabled={!fileUploaded}
                        onClick={() => setShowUploadOptions(true)}
                        sx={{
                           color: "rgba(255,255,255,0.85)",
                           borderRadius: 1.5,
                           "&:hover": { bgcolor: "rgba(255,255,255,0.1)", color: "white" },
                           "&.Mui-disabled": { color: "rgba(255,255,255,0.3)" },
                        }}
                     >
                        <FileUploadTwoToneIcon />
                     </IconButton>
                  </span>
               </Tooltip>

               {/* Save – direct if path already known, else opens modal */}
               <Tooltip
                  title={
                     props.annotationFilePath
                        ? `Save to: ${props.annotationFilePath}`
                        : "Save annotations (choose path)"
                  }
               >
                  <IconButton
                     size="small"
                     onClick={handleDirectSave}
                     sx={{
                        color: props.annotationFilePath ? "#69f0ae" : "rgba(255,255,255,0.85)",
                        borderRadius: 1.5,
                        "&:hover": { bgcolor: "rgba(255,255,255,0.1)", color: props.annotationFilePath ? "#69f0ae" : "white" },
                     }}
                  >
                     <SaveIcon />
                  </IconButton>
               </Tooltip>

               {/* Save As – always opens the dialog */}
               <Tooltip title="Save As – choose a new path">
                  <IconButton
                     size="small"
                     onClick={() => setOpenSaveModal(true)}
                     sx={{
                        color: "rgba(255,255,255,0.85)",
                        borderRadius: 1.5,
                        "&:hover": { bgcolor: "rgba(255,255,255,0.1)", color: "white" },
                     }}
                  >
                     <SaveAsIcon />
                  </IconButton>
               </Tooltip>

               {/* Spacer */}
               <Box sx={{ flex: 1 }} />

               {/* Next Step — hidden for pipeline types where annotation is the final step */}
               {!props.hideNextStep && (
                  <Button
                     variant="contained"
                     color="success"
                     size="small"
                     endIcon={<ArrowForwardIcon />}
                     onClick={() =>
                        navigate(`/object-detection/build-class-supports/${pipeId}`)
                     }
                     sx={{
                        fontWeight: 700,
                        borderRadius: "999px",
                        px: 2,
                        textTransform: "none",
                        boxShadow: "none",
                        "&:hover": { boxShadow: "none" },
                     }}
                  >
                     Next Step
                  </Button>
               )}
            </Toolbar>
         </AppBar>

         {/* Upload Dialog */}
         <Dialog
            open={showUploadOptions}
            onClose={() => setShowUploadOptions(false)}
            maxWidth="sm"
            fullWidth
         >
            <DialogTitle>Import Annotations</DialogTitle>
            <DialogContent>
               <Select
                  value={system}
                  onChange={(e) => setSystem(e.target.value as string)}
                  fullWidth
                  size="small"
                  sx={{ mb: 2, mt: 0.5 }}
               >
                  {systems.map((sys) => (
                     <MenuItem key={sys.value} value={sys.value}>
                        {sys.label}
                     </MenuItem>
                  ))}
               </Select>
               <FormControl fullWidth sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                     Upload File
                  </Typography>
                  <Button
                     variant="outlined"
                     component="label"
                     size="small"
                     sx={{ alignSelf: "flex-start" }}
                  >
                     Browse File
                     <input
                        type="file"
                        hidden
                        accept=".json,application/json"
                        onChange={(e) => {
                           const file = e.target.files?.[0];
                           setShowUploadOptions(false);
                           if (file) {
                              if (isCoco) {
                                 props.handleCocoJsonUpload(file);
                              } else {
                                 props.handleDefaultJsonUpload(file);
                              }
                           }
                        }}
                     />
                  </Button>
               </FormControl>
               <FormControl fullWidth sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                     Or Enter File Path
                  </Typography>
                  <TextField
                     placeholder="/path/to/annotations.json"
                     fullWidth
                     variant="outlined"
                     size="small"
                     onChange={(e) => setFilePath(e.target.value)}
                  />
               </FormControl>
               <AnnotationFileFormatSwitch coco={isCoco} onChange={setIsCoco} />
            </DialogContent>
            <DialogActions>
               <Button onClick={() => setShowUploadOptions(false)}>Cancel</Button>
               <Button
                  variant="contained"
                  onClick={() => {
                     setShowUploadOptions(false);
                     if (filePath.trim()) {
                        handleUploadAnnotationFile();
                     }
                  }}
               >
                  Upload
               </Button>
            </DialogActions>
         </Dialog>

         <SaveModal
            open={openSaveModal}
            onClose={() => setOpenSaveModal(false)}
            onSave={handleSaveModalConfirm}
            initialFilePath={props.annotationFilePath ?? ""}
            initialSystem={props.annotationSystem ?? "pitzer-tapis"}
            initialIsCoco={props.annotationIsCoco ?? false}
         />
      </>
   );
};

export default Tools;
