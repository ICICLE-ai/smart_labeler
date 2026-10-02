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
   CircularProgress,
   ToggleButton,
   ToggleButtonGroup,
} from "@mui/material";
import React, { useEffect, useState } from "react";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import ComputerIcon from "@mui/icons-material/Computer";
import StorageIcon from "@mui/icons-material/Storage";
import { allowed_systems, DEFAULT_SYSTEM, FileSelectModalWrapper } from "@icicle-ai/tapis-file-explorer";
import { fetchAnnotationFileText } from "./backendClient";
import { AnnotationFileFormatSwitch } from "./AnnotationFileFormatSwitch";

// Above MUI's Dialog (1300) so the folder picker is not hidden behind it.
const SAVE_BROWSER_Z_INDEX = 1400;

/** Filesystem-safe local timestamp, e.g. 20260930-142530. */
function fileTimestamp(d = new Date()): string {
   const p = (n: number) => String(n).padStart(2, "0");
   return (
      `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
      `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
   );
}

/** Name given to a file saved into a folder the user picked by browsing. */
export function defaultAnnotationFileName(isCoco: boolean, d = new Date()): string {
   return `annotation_${fileTimestamp(d)}${isCoco ? ".coco.json" : ".json"}`;
}

/**
 * Matches a name this module generated, capturing its timestamp. Only such names
 * are re-extensioned when the format toggle flips — one the user typed is left
 * exactly as they wrote it.
 */
const GENERATED_NAME_RE = /^annotation_(\d{8}-\d{6})(?:\.coco)?\.json$/;

const joinPath = (dir: string, name: string) => `${dir.replace(/\/+$/, "")}/${name}`;
const splitPath = (full: string) => {
   const i = full.lastIndexOf("/");
   return i === -1 ? { dir: "", name: full } : { dir: full.slice(0, i), name: full.slice(i + 1) };
};

// ---------------------------------------------------------------------------
// Import dialog
// ---------------------------------------------------------------------------

interface ImportModalProps {
   open: boolean;
   onClose: () => void;
   /** Auth token for the HPC file browser. */
   token: string;
   initialSystem?: string;
   initialIsCoco?: boolean;
   /** Hand back a local file the user chose. */
   onImportLocalFile: (file: File, isCoco: boolean) => void;
   /** Hand back a path on an HPC system. */
   onImportRemotePath: (path: string, system: string, isCoco: boolean) => void | Promise<void>;
}

/**
 * Walks the user through importing in the order the decisions actually depend on
 * each other: what format the file is in (so the preview can show what is
 * expected), then where it lives, and only then the details of that location.
 * The previous dialog asked for an HPC system first — before the user had said
 * whether the file was even on HPC — and buried the format choice at the bottom.
 */
const ImportModal: React.FC<ImportModalProps> = ({
   open, onClose, token, initialSystem = DEFAULT_SYSTEM, initialIsCoco = false,
   onImportLocalFile, onImportRemotePath,
}) => {
   const [isCoco, setIsCoco] = useState(initialIsCoco);
   const [source, setSource] = useState<"local" | "hpc">("local");
   const [system, setSystem] = useState<string>(initialSystem);
   const [remotePath, setRemotePath] = useState("");
   const [localFile, setLocalFile] = useState<File | null>(null);
   const [browsing, setBrowsing] = useState(false);
   const [importing, setImporting] = useState(false);

   useEffect(() => {
      if (!open) return;
      setIsCoco(initialIsCoco);
      setSource("local");
      setSystem(initialSystem || DEFAULT_SYSTEM);
      setRemotePath("");
      setLocalFile(null);
      setBrowsing(false);
      setImporting(false);
   }, [open, initialIsCoco, initialSystem]);

   const canImport = source === "local" ? Boolean(localFile) : Boolean(remotePath.trim());

   const handleImport = async () => {
      if (!canImport || importing) return;
      setImporting(true);
      try {
         if (source === "local" && localFile) onImportLocalFile(localFile, isCoco);
         else if (source === "hpc") await onImportRemotePath(remotePath.trim(), system, isCoco);
         onClose();
      } finally {
         setImporting(false);
      }
   };

   return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
         <DialogTitle>Import Annotations</DialogTitle>
         <DialogContent dividers>
            {/* Step 1 — format, with the sample document right beneath it. */}
            <StepHeading n={1} title="Choose the annotation format" />
            <Box sx={{ pl: 3.5, mb: 2.5 }}>
               <AnnotationFileFormatSwitch coco={isCoco} onChange={setIsCoco} label="" />
            </Box>

            {/* Step 2 — where the file is. */}
            <StepHeading n={2} title="Choose where the file is" />
            <Box sx={{ pl: 3.5 }}>
               <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  value={source}
                  onChange={(_e, v) => { if (v !== null) setSource(v); }}
                  sx={{ mb: 2, "& .MuiToggleButton-root": { textTransform: "none", fontWeight: 600, py: 0.75, gap: 0.75 } }}
               >
                  <ToggleButton value="local"><ComputerIcon fontSize="small" /> My computer</ToggleButton>
                  <ToggleButton value="hpc"><StorageIcon fontSize="small" /> HPC storage</ToggleButton>
               </ToggleButtonGroup>

               {source === "local" ? (
                  <Box>
                     <Button variant="outlined" component="label" startIcon={<FolderOpenIcon />} size="small">
                        Choose file…
                        <input
                           type="file"
                           hidden
                           accept=".json,application/json"
                           onChange={(e) => setLocalFile(e.target.files?.[0] ?? null)}
                        />
                     </Button>
                     <Typography
                        variant="caption"
                        sx={{ display: "block", mt: 1, color: localFile ? "success.main" : "text.secondary" }}
                     >
                        {localFile ? `Selected: ${localFile.name}` : "No file chosen yet."}
                     </Typography>
                  </Box>
               ) : (
                  <Box>
                     <Typography variant="caption" sx={{ display: "block", mb: 0.5, color: "text.secondary" }}>
                        System
                     </Typography>
                     <Select
                        value={system}
                        onChange={(e) => setSystem(e.target.value as string)}
                        fullWidth
                        size="small"
                        sx={{ mb: 2 }}
                     >
                        {allowed_systems.map((sys) => (
                           <MenuItem key={sys.value} value={sys.value}>{sys.label}</MenuItem>
                        ))}
                     </Select>

                     <Typography variant="caption" sx={{ display: "block", mb: 0.5, color: "text.secondary" }}>
                        File path
                     </Typography>
                     <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                        <TextField
                           placeholder="/path/to/annotations.json"
                           fullWidth
                           size="small"
                           value={remotePath}
                           onChange={(e) => setRemotePath(e.target.value)}
                        />
                        <Tooltip title="Browse this system for the annotation file">
                           <Button
                              onClick={() => setBrowsing(true)}
                              startIcon={<FolderOpenIcon />}
                              variant="outlined"
                              size="small"
                              disabled={!system}
                              sx={{ flexShrink: 0, whiteSpace: "nowrap", height: 40 }}
                           >
                              Browse
                           </Button>
                        </Tooltip>
                     </Box>
                  </Box>
               )}
            </Box>
         </DialogContent>
         <DialogActions>
            <Button onClick={onClose} disabled={importing}>Cancel</Button>
            <Button
               variant="contained"
               onClick={handleImport}
               disabled={!canImport || importing}
               startIcon={importing ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
               {importing ? "Importing…" : "Import"}
            </Button>
         </DialogActions>

         {browsing && (
            <FileSelectModalWrapper
               token={token}
               systemId={system}
               path={splitPath(remotePath).dir || "/"}
               selectMode={{ mode: "single", types: ["file"] }}
               zIndex={SAVE_BROWSER_Z_INDEX}
               toggle={() => setBrowsing(false)}
               onSelect={(_sys, entries) => {
                  const picked = entries?.[0]?.path;
                  if (picked) setRemotePath(picked);
                  setBrowsing(false);
               }}
            />
         )}
      </Dialog>
   );
};

/** Numbered step marker, so the dialog reads as an ordered set of decisions. */
const StepHeading: React.FC<{ n: number; title: string }> = ({ n, title }) => (
   <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1 }}>
      <Box
         sx={{
            width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
            bgcolor: "primary.main", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.72rem", fontWeight: 700,
         }}
      >
         {n}
      </Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{title}</Typography>
   </Box>
);

interface SaveModalProps {
   open: boolean;
   onClose: () => void;
   /** Resolves false when nothing was written, which keeps the dialog open. */
   onSave: (filePath: string, isCocoJson: boolean, system: string) => Promise<boolean> | boolean | void;
   initialFilePath?: string;
   initialSystem?: string;
   initialIsCoco?: boolean;
   /** Auth token for the folder browser. */
   token: string;
}

const SaveModal: React.FC<SaveModalProps> = ({
   open, onClose, onSave,
   initialFilePath = "", initialSystem = DEFAULT_SYSTEM, initialIsCoco = false, token,
}) => {
   const [filePath, setFilePath] = useState(initialFilePath);
   const [isCocoJson, setIsCocoJson] = useState(initialIsCoco);
   const [system, setSystem] = useState<string>(initialSystem);
   const [saving, setSaving] = useState(false);
   const [browsing, setBrowsing] = useState(false);

   useEffect(() => {
      if (open) {
         setFilePath(initialFilePath);
         setIsCocoJson(initialIsCoco);
         setSystem(initialSystem || DEFAULT_SYSTEM);
         setSaving(false);
         setBrowsing(false);
      }
   }, [open, initialFilePath, initialIsCoco, initialSystem]);

   // Picking a folder names the file for you; the path stays editable afterwards.
   const handleFolderPicked = (dir: string) => {
      setFilePath(joinPath(dir, defaultAnnotationFileName(isCocoJson)));
      setBrowsing(false);
   };

   // Switching format re-extensions a name we generated, but never one the user
   // typed themselves.
   const handleFormatChange = (coco: boolean) => {
      setIsCocoJson(coco);
      setFilePath((prev) => {
         const { dir, name } = splitPath(prev);
         const match = GENERATED_NAME_RE.exec(name);
         if (!match) return prev;
         // Keep the original timestamp: toggling the format twice should land back
         // on the same filename, not invent a new one each time.
         const renamed = `annotation_${match[1]}${coco ? ".coco.json" : ".json"}`;
         return dir ? joinPath(dir, renamed) : renamed;
      });
   };

   const handleSave = async () => {
      if (!filePath.trim() || saving) return;
      setSaving(true);
      try {
         // Wait for the save to actually finish so the dialog shows progress
         // instead of closing before the success/error result is known.
         const result = await onSave(filePath, isCocoJson, system);
         // Stay open when the write was refused (no permission, bad path) so the
         // user can browse somewhere else without redoing the dialog.
         if (result === false) return;
         onClose();
      } finally {
         setSaving(false);
      }
   };

   return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
         <DialogTitle>Save Annotations</DialogTitle>
         <DialogContent dividers>
            <Typography variant="caption" sx={{ display: "block", mb: 0.5, color: "text.secondary" }}>
               System
            </Typography>
            <Select
               value={system}
               onChange={(e) => setSystem(e.target.value)}
               fullWidth
               size="small"
               sx={{ mb: 2 }}
            >
               {allowed_systems.map((sys) => (
                  <MenuItem key={sys.value} value={sys.value}>
                     {sys.label}
                  </MenuItem>
               ))}
            </Select>
            <Typography variant="caption" sx={{ display: "block", mb: 0.5, color: "text.secondary" }}>
               File path
            </Typography>
            <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
               <TextField
                  autoFocus
                  type="text"
                  fullWidth
                  size="small"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="path/to/annotations.json"
               />
               <Tooltip title="Browse for a folder on this system">
                  <Button
                     onClick={() => setBrowsing(true)}
                     startIcon={<FolderOpenIcon />}
                     variant="outlined"
                     size="small"
                     disabled={!system || saving}
                     sx={{ flexShrink: 0, whiteSpace: "nowrap", height: 40 }}
                  >
                     Browse
                  </Button>
               </Tooltip>
            </Box>
            <Typography variant="caption" sx={{ display: "block", mt: 0.75, mb: 2.5, color: "text.secondary" }}>
               Pick a folder and the file is named for you, or type a full path yourself.
            </Typography>

            <Divider sx={{ mb: 2 }} />

            <AnnotationFileFormatSwitch
               coco={isCocoJson}
               onChange={handleFormatChange}
            />
         </DialogContent>
         <DialogActions>
            <Button onClick={onClose} color="primary" disabled={saving}>
               Cancel
            </Button>
            <Button
               onClick={handleSave}
               color="primary"
               disabled={!filePath.trim() || saving}
               startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
               {saving ? "Saving…" : "Save"}
            </Button>
         </DialogActions>

         {/* Folder picker. Mounted only while open, and stacked above this dialog. */}
         {browsing && (
            <FileSelectModalWrapper
               token={token}
               systemId={system}
               path={splitPath(filePath).dir || "/"}
               selectMode={{ mode: "single", types: ["dir"] }}
               zIndex={SAVE_BROWSER_Z_INDEX}
               toggle={() => setBrowsing(false)}
               onSelect={(_sys, entries) => {
                  const dir = entries?.[0]?.path;
                  if (dir) handleFolderPicked(dir);
                  else setBrowsing(false);
               }}
            />
         )}
      </Dialog>
   );
};

export interface ToolsProps {
   /**
    * Writes or downloads the COCO file. Resolve false to report that nothing was
    * written — the toolbar then leaves the Save As dialog open and does not treat
    * the path as the annotator's saved file. Anything else counts as success.
    */
   onDownloadCocoJson: (save: boolean, dir: string, system: string) => void | boolean | Promise<void | boolean>;
   /** As `onDownloadCocoJson`, for the simpler default JSON format. */
   onDownloadDefaultJson: (save: boolean, dir: string, system: string) => void | boolean | Promise<void | boolean>;
   handleCocoJsonUpload: (file: File) => void;
   handleDefaultJsonUpload: (file: File) => void;
   pipeId: string;
   /** Auth token forwarded to the backend file-fetch used by "upload by path". */
   token: string;
   filesUploaded: boolean;
   /** Reports where the file was written, including which system, so the caller can record it. */
   onAnnotationSaved?: (filePath: string, isCoco: boolean, system: string) => void;
   // Pre-populated from annotatorConfig – enables one-click Save
   annotationFilePath?: string;
   annotationSystem?: string;
   annotationIsCoco?: boolean;
   annotationSrcImgDir?: string;
   hideNextStep?: boolean;
   /** Called when "Next Step" is clicked. The button only renders if this is provided. */
   onNextStep?: () => void;
}

export const Tools: React.FC<ToolsProps> = (props) => {
   const [downloadAnchor, setDownloadAnchor] = useState<HTMLElement | null>(null);
   const [showUploadOptions, setShowUploadOptions] = useState(false);
   const [openSaveModal, setOpenSaveModal] = useState(false);
   const [pipeId, setPipeId] = useState(props.pipeId);
   const [isCoco, setIsCoco] = useState<boolean>(false);
   const [filePath, setFilePath] = useState<string>("");
   const [system, setSystem] = useState<string>(DEFAULT_SYSTEM);
   const [isSaving, setIsSaving] = useState<boolean>(false);
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

   async function handleDirectSave() {
      const path = props.annotationFilePath?.trim();
      if (!path) {
         // No known path – fall back to Save As dialog
         setOpenSaveModal(true);
         return;
      }
      if (isSaving) return;
      const savedSystem = props.annotationSystem ?? system;
      setIsSaving(true);
      try {
         const wrote = await (props.annotationIsCoco
            ? props.onDownloadCocoJson(true, path, savedSystem)
            : props.onDownloadDefaultJson(true, path, savedSystem));
         // A refused write (no permission, missing folder) must not be recorded
         // as the annotator's saved file. Offer Save As so the user can pick
         // somewhere they can actually write to.
         if (wrote === false) {
            setOpenSaveModal(true);
            return;
         }
         props.onAnnotationSaved?.(path, props.annotationIsCoco ?? false, savedSystem);
      } finally {
         setIsSaving(false);
      }
   }

   async function handleSaveModalConfirm(filePath: string, isCocoJson: boolean, system: string) {
      setDownloadAnchor(null);
      const wrote = await (isCocoJson
         ? props.onDownloadCocoJson(true, filePath, system)
         : props.onDownloadDefaultJson(true, filePath, system));
      if (wrote === false) return false;   // keeps the dialog open
      props.onAnnotationSaved?.(filePath, isCocoJson, system);
      return true;
   }

   async function handleUploadAnnotationFile(path: string, sys: string, coco: boolean) {
      let file: File | null = null;
      try {
         const text = await fetchAnnotationFileText(pipeId, sys, path, props.token);
         file = new File([text], "annotations.json", { type: "application/json" });
      } catch (error) {
         console.error("Error fetching file:", error);
         alert(
            `Could not read the annotation file:\n\n    ${path}\n    on ${sys}\n\n` +
            `Check that the path is correct and that you have access to it.`
         );
         return;
      }
      if (coco) props.handleCocoJsonUpload(file);
      else props.handleDefaultJsonUpload(file);
   }

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
                     disabled={isSaving}
                     sx={{
                        color: props.annotationFilePath ? "#69f0ae" : "rgba(255,255,255,0.85)",
                        borderRadius: 1.5,
                        "&:hover": { bgcolor: "rgba(255,255,255,0.1)", color: props.annotationFilePath ? "#69f0ae" : "white" },
                     }}
                  >
                     {isSaving ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : <SaveIcon />}
                  </IconButton>
               </Tooltip>

               {/* Save As – always opens the dialog */}
               <Tooltip title="Save As – choose a new path">
                  <IconButton
                     size="small"
                     onClick={() => setOpenSaveModal(true)}
                     disabled={isSaving}
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

               {/* Next Step — only rendered when the consumer wires up onNextStep */}
               {!props.hideNextStep && props.onNextStep && (
                  <Button
                     variant="contained"
                     color="success"
                     size="small"
                     endIcon={<ArrowForwardIcon />}
                     onClick={props.onNextStep}
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
         <ImportModal
            open={showUploadOptions}
            onClose={() => setShowUploadOptions(false)}
            token={props.token}
            initialSystem={props.annotationSystem ?? system}
            initialIsCoco={props.annotationIsCoco ?? false}
            onImportLocalFile={(file, coco) => {
               if (coco) props.handleCocoJsonUpload(file);
               else props.handleDefaultJsonUpload(file);
            }}
            onImportRemotePath={async (path, sys, coco) => {
               setSystem(sys);
               setIsCoco(coco);
               setFilePath(path);
               await handleUploadAnnotationFile(path, sys, coco);
            }}
         />

         <SaveModal
            open={openSaveModal}
            onClose={() => setOpenSaveModal(false)}
            onSave={handleSaveModalConfirm}
            initialFilePath={props.annotationFilePath ?? ""}
            initialSystem={props.annotationSystem ?? DEFAULT_SYSTEM}
            initialIsCoco={props.annotationIsCoco ?? false}
            token={props.token}
         />
      </>
   );
};

export default Tools;
