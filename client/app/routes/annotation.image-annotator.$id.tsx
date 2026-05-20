import { useEffect, useRef, useState } from "react";
import { FileExplorer } from "../components/ImageAnnotation/FileExplorer";
import { ImageCanvas, type Annotation } from "../components/ImageAnnotation/ImageCanvas";
import { SegmentationCanvas, type SegmentationAnnotation } from "../components/ImageAnnotation/SegmentationCanvas";
import { AnnotationDetails } from "../components/ImageAnnotation/AnnotationDetails";
import { SegmentationAnnotationDetails } from "../components/ImageAnnotation/SegmentationAnnotationDetails";
import { CircularProgress, Drawer, IconButton, Grid, Box, Button, LinearProgress, Typography } from "@mui/material";
import Tools from "../components/ImageAnnotation/Tools";
import {
   downloadFile,
   exportToCoco,
   exportToDefaultJson,
   FileAnnotations,
   importFromCocoJsonUtil,
   importFromDefaultJsonUtil,
} from "../components/ImageAnnotation/utils";
import { fetchAndReturnData, fetchFile, saveFile, SubmitData } from "~/utils/utils";
import { useCookies } from "react-cookie";
import { useLoaderData } from "@remix-run/react";
import { TYPE } from "~/utils/utils";

// ── Segmentation-specific file annotation record ──
interface SegmentationFileAnnotations {
   name: string;
   width: number;
   height: number;
   masks: SegmentationAnnotation[];
}

interface AnnotatorConfig {
   id: number;
   srcImgDir: string;
   system: string;
   annotationFilePath: string;
   fileType: string;
}

// ── Segmentation JSON helpers ──

function exportSegmentationJson(
   fileToMasksMap: Map<number, SegmentationFileAnnotations>,
   files: string[]
): object {
   const fileEntries = files.map((filePath, idx) => {
      const fa = fileToMasksMap.get(idx);
      return {
         filename: filePath,
         width: fa?.width ?? 0,
         height: fa?.height ?? 0,
         masks: (fa?.masks ?? []).map(({ id, label, points, score, flag }) => ({
            id,
            label,
            points,
            ...(score !== undefined ? { score } : {}),
            ...(flag ? { flag } : {}),
         })),
      };
   }).filter((e) => e.masks.length > 0);
   return { version: "1.0", type: "segmentation", files: fileEntries };
}

function importSegmentationJson(
   json: any,
   files: string[]
): Map<number, SegmentationFileAnnotations> {
   const map = new Map<number, SegmentationFileAnnotations>();
   if (!json?.files) return map;
   (json.files as any[]).forEach((entry) => {
      const idx = files.findIndex((f) => f === entry.filename || f.endsWith(entry.filename));
      if (idx === -1) return;
      map.set(idx, {
         name: entry.filename,
         width: entry.width ?? 0,
         height: entry.height ?? 0,
         masks: (entry.masks ?? []).map((m: any) => ({
            id: m.id ?? Date.now().toString(),
            label: m.label ?? "mask",
            points: m.points ?? [],
            ...(m.score !== undefined ? { score: m.score } : {}),
            ...(m.flag ? { flag: m.flag } : {}),
         })),
      });
   });
   return map;
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

const ImageAnnotation = () => {
   const { pipeid } = useLoaderData<{ pipeid: string }>();

   // ── Pipeline meta ──
   const [pipelineType, setPipelineType] = useState<string | null>(null);
   const isSegmentation = pipelineType === TYPE.SEGMENTATION;

   // ── Shared state ──
   const [selectedFile, setSelectedFile] = useState<any | null>(null);
   const [files, setFiles] = useState<string[]>([]);
   const [selectedFileIndex, setSelectedFileIndex] = useState<number | null>(null);
   const [openFileExplorer, setOpenFileExplorer] = useState(false);
   const [cookie] = useCookies(["tapis-token"]);
   const [system, setSystem] = useState("");
   const [score, setScore] = useState(0.1);
   const [activeLabels, setActiveLabels] = useState<string[]>([]);
   const [activeFlags, setActiveFlags] = useState<string[]>([]);
   const [annotatorConfig, setAnnotatorConfig] = useState<AnnotatorConfig | null>(null);
   const [isDemo, setIsDemo] = useState(false);
   const [isAdmin, setIsAdmin] = useState(false);
   const [isConfigLoading, setIsConfigLoading] = useState(true);
   const [isAnnotationsLoading, setIsAnnotationsLoading] = useState(false);
   const [isImageLoading, setIsImageLoading] = useState(false);
   const annotationsAutoLoaded = useRef(false);
   const firstImageLoadedRef = useRef(false);

   // ── Detection-specific state ──
   const [boundingBoxes, setBoundingBoxes] = useState<Annotation[]>([]);
   const [selectedBoxId, setSelectedBoxId] = useState<string | undefined>();
   const [selectedBoxIds, setSelectedBoxIds] = useState<string[]>([]);
   const [fileToAnnotationsMap, setFileToAnnotationsMap] = useState<Map<number, FileAnnotations>>(new Map());

   // ── Segmentation-specific state ──
   const [segmentationMasks, setSegmentationMasks] = useState<SegmentationAnnotation[]>([]);
   const [selectedMaskId, setSelectedMaskId] = useState<string | undefined>();
   const [selectedMaskIds, setSelectedMaskIds] = useState<string[]>([]);
   const [fileToMasksMap, setFileToMasksMap] = useState<Map<number, SegmentationFileAnnotations>>(new Map());

   // ────────────────────────────────────────────────────────────────────────
   // Init: load config + pipeline type
   // ────────────────────────────────────────────────────────────────────────

   useEffect(() => {
      const token = cookie["tapis-token"]?.["access_token"];
      if (!token || !pipeid) { setIsConfigLoading(false); return; }
      setIsConfigLoading(true);
      Promise.all([
         fetchAndReturnData(`/annotator-configuration/${pipeid}`, token).catch(() => null),
         fetchAndReturnData(`/pipe/${pipeid}`, token).catch(() => null),
         fetchAndReturnData(`/is-admin`, token).catch(() => null),
      ])
         .then(([configs, pipe, adminRes]) => {
            if (configs?.length > 0) setAnnotatorConfig(configs[configs.length - 1]);
            if (pipe?.is_demo) setIsDemo(true);
            if (pipe?.type) setPipelineType(pipe.type);
            if (adminRes?.is_admin) setIsAdmin(true);
         })
         .finally(() => setIsConfigLoading(false));
   }, [pipeid]);

   // ── Auto-load annotations once files + config are ready ──
   useEffect(() => {
      const token = cookie["tapis-token"]?.["access_token"];
      if (
         annotationsAutoLoaded.current ||
         files.length === 0 ||
         !annotatorConfig?.annotationFilePath ||
         !annotatorConfig?.system ||
         !token
      ) return;
      annotationsAutoLoaded.current = true;
      setIsAnnotationsLoading(true);
      fetchFile(
         `/get_file/${pipeid}/${annotatorConfig.system}?filePath=${encodeURIComponent(annotatorConfig.annotationFilePath)}`,
         token
      )
         .then((res) => res.text())
         .then((text) => {
            const file = new File([text], "annotations.json", { type: "application/json" });
            if (isSegmentation) {
               importSegmentationAnnotationsFromJson(file);
            } else {
               importDetectionAnnotationsFromJson(file, annotatorConfig.fileType === "coco");
            }
         })
         .catch((e) => console.error("Failed to auto-load annotations:", e))
         .finally(() => setIsAnnotationsLoading(false));
   }, [files, annotatorConfig, isSegmentation]);

   // ────────────────────────────────────────────────────────────────────────
   // Config upsert
   // ────────────────────────────────────────────────────────────────────────

   const upsertAnnotatorConfig = async (updates: Partial<AnnotatorConfig>) => {
      const token = cookie["tapis-token"]?.["access_token"];
      if (!token || (isDemo && !isAdmin)) return;
      if (annotatorConfig?.id) {
         await SubmitData(`/annotator-configuration/config/${annotatorConfig.id}`, updates, token, "PUT");
         setAnnotatorConfig((prev) => prev ? { ...prev, ...updates } : null);
      } else {
         const payload = { system: "", srcImgDir: "", annotationFilePath: "", fileType: "default", ...updates };
         const res = await SubmitData(`/annotator-configuration/${pipeid}`, payload, token, "POST");
         if (res?.id) setAnnotatorConfig({ id: res.id, ...payload });
      }
   };

   // ────────────────────────────────────────────────────────────────────────
   // File selection – persists current annotations before switching
   // ────────────────────────────────────────────────────────────────────────

   useEffect(() => {
      if (!selectedFile) return;
      if (isSegmentation) {
         const fa = fileToMasksMap.get(selectedFileIndex ?? 0);
         setSegmentationMasks([...(fa?.masks ?? [])]);
      } else {
         const fa = fileToAnnotationsMap.get(selectedFileIndex ?? 0);
         setBoundingBoxes([...(fa?.annotations ?? [])]);
      }
   }, [selectedFile]); // intentionally narrow – avoids overwriting live edits on import

   const handleFileSelect = (file: Blob, index: number) => {
      if (!firstImageLoadedRef.current) setIsImageLoading(true);
      const prevIndex = selectedFileIndex;

      if (prevIndex !== null) {
         if (isSegmentation) {
            setFileToMasksMap((prev) => {
               const updated = new Map(prev);
               const fa = updated.get(prevIndex) ?? { name: files[prevIndex] ?? "", width: 0, height: 0, masks: [] };
               updated.set(prevIndex, { ...fa, masks: segmentationMasks });
               return updated;
            });
         } else {
            setFileToAnnotationsMap((prev) => {
               const updated = new Map(prev);
               const fa = updated.get(prevIndex) ?? { name: "", width: 0, height: 0, annotations: [] };
               updated.set(prevIndex, { ...fa, annotations: boundingBoxes });
               return updated;
            });
         }
      }

      setSelectedFileIndex(index);
      setSelectedFile(file);
      setSelectedBoxId(undefined);
      setSelectedMaskId(undefined);
   };

   // ────────────────────────────────────────────────────────────────────────
   // Detection helpers
   // ────────────────────────────────────────────────────────────────────────

   const handleBoundingBoxUpdate = (id: string, updates: Partial<Annotation>) => {
      setBoundingBoxes((prev) => prev.map((box) => (box.id === id ? { ...box, ...updates } : box)));
   };

   const updateDetectionMapForCurrentFile = () => {
      const updated = new Map(fileToAnnotationsMap);
      if (selectedFileIndex !== null) {
         const fa = updated.get(selectedFileIndex) ?? { name: files[selectedFileIndex] ?? "", width: 0, height: 0, annotations: [] };
         updated.set(selectedFileIndex, { ...fa, annotations: boundingBoxes });
      }
      setFileToAnnotationsMap(updated);
      return updated;
   };

   const generateDetectionJson = (coco: boolean, save: boolean, dir: string, sys: string) => {
      const updatedMap = updateDetectionMapForCurrentFile();
      const json = coco ? exportToCoco(updatedMap, files) : exportToDefaultJson(updatedMap, files);
      if (save && dir) {
         if (isDemo) { alert("Demo mode: Saving is disabled."); return; }
         saveFile(`/save-file/${sys}?path=${encodeURIComponent(dir)}`, JSON.stringify(json, null, 2), cookie["tapis-token"]["access_token"]);
      } else {
         downloadFile(JSON.stringify(json, null, 2), coco ? "annotations.coco.json" : "annotations.json");
      }
   };

   const importDetectionAnnotationsFromJson = (file: File | Blob, coco: boolean) => {
      if (!(file instanceof Blob)) return;
      const reader = new FileReader();
      reader.onload = (event) => {
         const json = event.target?.result;
         if (typeof json !== "string") return;
         try {
            const parsed = JSON.parse(json);
            const importedMap = coco ? importFromCocoJsonUtil(parsed, files) : importFromDefaultJsonUtil(parsed, files);
            const currentMap = updateDetectionMapForCurrentFile();
            const merged = new Map(currentMap);
            importedMap.forEach((imported, idx) => {
               const existing = merged.get(idx);
               merged.set(idx, existing
                  ? { ...existing, annotations: [...existing.annotations, ...imported.annotations] }
                  : imported
               );
            });
            setFileToAnnotationsMap(merged);
            const target = selectedFileIndex ?? 0;
            setBoundingBoxes([...(merged.get(target)?.annotations ?? [])]);
         } catch (e) {
            console.error("Failed to parse detection JSON:", e);
         }
      };
      reader.readAsText(file);
   };

   // ────────────────────────────────────────────────────────────────────────
   // Segmentation helpers
   // ────────────────────────────────────────────────────────────────────────

   const updateSegmentationMapForCurrentFile = () => {
      const updated = new Map(fileToMasksMap);
      if (selectedFileIndex !== null) {
         const fa = updated.get(selectedFileIndex) ?? { name: files[selectedFileIndex] ?? "", width: 0, height: 0, masks: [] };
         updated.set(selectedFileIndex, { ...fa, masks: segmentationMasks });
      }
      setFileToMasksMap(updated);
      return updated;
   };

   const generateSegmentationJson = (save: boolean, dir: string, sys: string) => {
      const updatedMap = updateSegmentationMapForCurrentFile();
      const json = exportSegmentationJson(updatedMap, files);
      if (save && dir) {
         if (isDemo) { alert("Demo mode: Saving is disabled."); return; }
         saveFile(`/save-file/${sys}?path=${encodeURIComponent(dir)}`, JSON.stringify(json, null, 2), cookie["tapis-token"]["access_token"]);
      } else {
         downloadFile(JSON.stringify(json, null, 2), "segmentation.json");
      }
   };

   const importSegmentationAnnotationsFromJson = (file: File | Blob) => {
      if (!(file instanceof Blob)) return;
      const reader = new FileReader();
      reader.onload = (event) => {
         const json = event.target?.result;
         if (typeof json !== "string") return;
         try {
            const parsed = JSON.parse(json);
            const importedMap = importSegmentationJson(parsed, files);
            const currentMap = updateSegmentationMapForCurrentFile();
            const merged = new Map(currentMap);
            importedMap.forEach((imported, idx) => {
               const existing = merged.get(idx);
               merged.set(idx, existing
                  ? { ...existing, masks: [...existing.masks, ...imported.masks] }
                  : imported
               );
            });
            setFileToMasksMap(merged);
            const target = selectedFileIndex ?? 0;
            setSegmentationMasks([...(merged.get(target)?.masks ?? [])]);
         } catch (e) {
            console.error("Failed to parse segmentation JSON:", e);
         }
      };
      reader.readAsText(file);
   };

   // ────────────────────────────────────────────────────────────────────────
   // Shared: file-size update
   // ────────────────────────────────────────────────────────────────────────

   const handleSetFileSize = (size: { width: number; height: number }) => {
      const idx = selectedFileIndex ?? 0;
      if (isSegmentation) {
         setFileToMasksMap((prev) => {
            const updated = new Map(prev);
            const fa = updated.get(idx) ?? { name: files[idx] ?? "", width: 0, height: 0, masks: [] };
            updated.set(idx, { ...fa, ...size });
            return updated;
         });
      } else {
         setFileToAnnotationsMap((prev) => {
            const updated = new Map(prev);
            const fa = updated.get(idx) ?? { name: "", width: 0, height: 0, annotations: [] };
            updated.set(idx, { ...fa, ...size });
            return updated;
         });
      }
   };

   // ────────────────────────────────────────────────────────────────────────
   // Render
   // ────────────────────────────────────────────────────────────────────────

   return (
      <>
         {/* ── File Explorer toggle button ── */}
         <Button
            onClick={() => setOpenFileExplorer((prev) => !prev)}
            sx={{
               position: "fixed",
               top: 120,
               left: openFileExplorer ? "25vw" : 0,
               zIndex: (theme) => theme.zIndex.drawer + 1,
               transition: "left 0.3s",
               background: "white",
               border: "1px solid #ccc",
               borderTopRightRadius: "6px",
               borderBottomRightRadius: "6px",
               borderTopLeftRadius: 0,
               borderBottomLeftRadius: 0,
               minWidth: 0,
               width: 24,
               padding: "10px 4px",
               boxShadow: 2,
               writingMode: "vertical-lr",
               fontSize: "0.7rem",
               fontWeight: 700,
               letterSpacing: "0.08em",
               color: "primary.main",
               textTransform: "none",
               whiteSpace: "nowrap",
               "&:hover": { background: "primary.light", borderColor: "primary.main" },
            }}
         >
            File Explorer
         </Button>

         {/* ── File Explorer drawer ── */}
         <Drawer
            anchor="left"
            open={openFileExplorer}
            onClose={() => setOpenFileExplorer(false)}
            sx={{
               width: "35vw",
               flexShrink: 0,
               "& .MuiDrawer-paper": { width: "25vw", boxSizing: "border-box", p: 2 },
            }}
            variant="persistent"
         >
            <FileExplorer
               onFileSelect={handleFileSelect}
               filesInDirectory={(newFiles, sys) => {
                  setFiles(newFiles);
                  setFileToAnnotationsMap(new Map());
                  setFileToMasksMap(new Map());
                  setBoundingBoxes([]);
                  setSegmentationMasks([]);
                  setSelectedBoxId(undefined);
                  setSelectedMaskId(undefined);
                  setSelectedFile(null);
                  setSystem(sys);
                  annotationsAutoLoaded.current = false;
               }}
               pipeid={pipeid}
               fileDir={annotatorConfig?.srcImgDir}
               parentSystem={annotatorConfig?.system}
               onDirectorySubmit={(!isDemo || isAdmin) ? (srcImgDir, sys) => upsertAnnotatorConfig({ srcImgDir, system: sys }) : undefined}
            />
         </Drawer>

         {/* ── Toolbar ── */}
         <Tools
            pipeId={pipeid}
            onDownloadCocoJson={(save, dir, sys) => isSegmentation
               ? generateSegmentationJson(save, dir, sys)
               : generateDetectionJson(true, save, dir, sys)
            }
            onDownloadDefaultJson={(save, dir, sys) => isSegmentation
               ? generateSegmentationJson(save, dir, sys)
               : generateDetectionJson(false, save, dir, sys)
            }
            handleCocoJsonUpload={(file) => isSegmentation
               ? importSegmentationAnnotationsFromJson(file)
               : importDetectionAnnotationsFromJson(file, true)
            }
            handleDefaultJsonUpload={(file) => isSegmentation
               ? importSegmentationAnnotationsFromJson(file)
               : importDetectionAnnotationsFromJson(file, false)
            }
            filesUploaded={files.length > 0}
            onAnnotationSaved={(filePath, isCoco) =>
               upsertAnnotatorConfig({ annotationFilePath: filePath, fileType: isCoco ? "coco" : "default" })
            }
            annotationFilePath={annotatorConfig?.annotationFilePath}
            annotationSystem={annotatorConfig?.system}
            annotationIsCoco={annotatorConfig?.fileType === "coco"}
            hideNextStep={isSegmentation}
         />

         {/* ── Loading indicators ── */}
         {(isConfigLoading || isAnnotationsLoading || isImageLoading) && (
            <LinearProgress variant="indeterminate" sx={{ height: 3 }} />
         )}
         {isConfigLoading && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 0.75, bgcolor: "#f3e5f5", borderBottom: "1px solid #ce93d8" }}>
               <CircularProgress size={14} thickness={5} sx={{ color: "#7b1fa2" }} />
               <Typography variant="body2" sx={{ color: "#4a148c", fontWeight: 500 }}>Loading configuration…</Typography>
            </Box>
         )}
         {isAnnotationsLoading && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 0.75, bgcolor: "#e3f2fd", borderBottom: "1px solid #90caf9" }}>
               <CircularProgress size={14} thickness={5} sx={{ color: "#1565c0" }} />
               <Typography variant="body2" sx={{ color: "#0d47a1", fontWeight: 500 }}>Loading annotations from saved file…</Typography>
            </Box>
         )}
         {isImageLoading && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 0.75, bgcolor: "#e8f5e9", borderBottom: "1px solid #a5d6a7" }}>
               <CircularProgress size={14} thickness={5} sx={{ color: "#2e7d32" }} />
               <Typography variant="body2" sx={{ color: "#1b5e20", fontWeight: 500 }}>Loading image…</Typography>
            </Box>
         )}

         {/* ── Main layout ── */}
         <Grid container spacing={2} sx={{ overflow: "hidden" }}>
            <Grid size={9}>
               {selectedFile ? (
                  isSegmentation ? (
                     <SegmentationCanvas
                        file={selectedFile}
                        annotations={segmentationMasks}
                        onAnnotationAddition={(added) => setSegmentationMasks((prev) => [...prev, ...added])}
                        selectedAnnotationId={selectedMaskId ?? null}
                        selectedAnnotationIds={selectedMaskIds}
                        onAnnotationSelection={(id) => { setSelectedMaskId(id ?? undefined); setSelectedMaskIds([]); }}
                        onAnnotationMultiSelection={(ids) => { setSelectedMaskIds(ids); if (ids.length > 0) setSelectedMaskId(undefined); }}
                        onAnnotationUpdate={(id, updates) =>
                           setSegmentationMasks((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)))
                        }
                        deleteAnnotations={(ids) => setSegmentationMasks((prev) => prev.filter((m) => !ids.includes(m.id)))}
                        isEditable={true}
                        setFileSize={handleSetFileSize}
                        isGraphEnabled={false}
                        fileName={files[selectedFileIndex ?? 0]}
                        systemId={system}
                        pipeId={pipeid}
                        score={score}
                        activeLabels={activeLabels}
                        activeFlags={activeFlags}
                        onImageLoaded={() => {
                           if (!firstImageLoadedRef.current) { firstImageLoadedRef.current = true; setIsImageLoading(false); }
                        }}
                     />
                  ) : (
                     <ImageCanvas
                        file={selectedFile}
                        boxes={boundingBoxes}
                        onBoxAddition={(annotations) => setBoundingBoxes((prev) => [...prev, ...annotations])}
                        selectedAnnotationId={selectedBoxId ?? ""}
                        selectedAnnotationIds={selectedBoxIds}
                        onBoxSelection={(id) => { setSelectedBoxId(id ?? undefined); setSelectedBoxIds([]); }}
                        onBoxMultiSelection={(ids) => { setSelectedBoxIds(ids); if (ids.length > 0) setSelectedBoxId(undefined); }}
                        onBoxUpdate={handleBoundingBoxUpdate}
                        deleteAnnotations={(ids) => setBoundingBoxes((prev) => prev.filter((x) => !ids.includes(x.id)))}
                        isEditable={true}
                        setFileSize={handleSetFileSize}
                        isGraphEnabled={false}
                        fileName={files[selectedFileIndex ?? 0]}
                        systemId={system}
                        pipeId={pipeid}
                        score={score}
                        activeLabels={activeLabels}
                        activeFlags={activeFlags}
                        onImageLoaded={() => {
                           if (!firstImageLoadedRef.current) { firstImageLoadedRef.current = true; setIsImageLoading(false); }
                        }}
                     />
                  )
               ) : isConfigLoading ? (
                  <Box sx={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", mt: 10, gap: 2 }}>
                     <CircularProgress size={48} />
                     <Typography variant="body1" color="text.secondary">Loading your configuration…</Typography>
                  </Box>
               ) : (
                  <Box sx={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
                     <h2>No file selected</h2>
                     <h4 style={{ color: "rgba(0,0,0,0.6)" }}>Select a file to start annotating.</h4>
                     <Button variant="contained" onClick={() => setOpenFileExplorer(true)}>
                        Open File Explorer
                     </Button>
                  </Box>
               )}
            </Grid>

            <Grid size={3}>
               {isSegmentation ? (
                  <SegmentationAnnotationDetails
                     annotations={segmentationMasks}
                     selectedBoxId={selectedMaskId}
                     selectedBoxIds={selectedMaskIds}
                     onSelectedBoxChange={(id) => setSelectedMaskId(id)}
                     onSelectedBoxIdsChange={(ids) => {
                        setSelectedMaskIds(ids);
                        if (ids.length > 0) setSelectedMaskId(undefined);
                     }}
                     onAnnotationUpdate={(id, updates) =>
                        setSegmentationMasks((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)))
                     }
                     deleteAnnotations={(ids) => setSegmentationMasks((prev) => prev.filter((m) => !ids.includes(m.id)))}
                     handleFilterAnnotations={(s, labels, flags) => {
                        setScore(s);
                        setActiveLabels(labels);
                        setActiveFlags(flags);
                     }}
                  />
               ) : (
                  <AnnotationDetails
                     annotations={boundingBoxes}
                     selectedBoxId={selectedBoxId}
                     selectedBoxIds={selectedBoxIds}
                     onSelectedBoxChange={(id) => setSelectedBoxId(id)}
                     onSelectedBoxIdsChange={(ids) => {
                        setSelectedBoxIds(ids);
                        if (ids.length > 0) setSelectedBoxId(undefined);
                     }}
                     onBoundingBoxUpdate={handleBoundingBoxUpdate}
                     deleteAnnotations={(ids) => setBoundingBoxes((prev) => prev.filter((box) => !ids.includes(box.id)))}
                     handleFilterAnnotations={(s, labels, flags) => {
                        setScore(s);
                        setActiveLabels(labels);
                        setActiveFlags(flags);
                     }}
                  />
               )}
            </Grid>
         </Grid>
      </>
   );
};

export default ImageAnnotation;

export function clientLoader({ params }: any) {
   return { pipeid: params.id };
}
clientLoader.hydrate = true;
