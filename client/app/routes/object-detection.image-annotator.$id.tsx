import { useEffect, useRef, useState } from "react";
import { FileExplorer } from "../components/ImageAnnotation/FileExplorer";
import {
   ImageCanvas,
   type Annotation,
} from "../components/ImageAnnotation/ImageCanvas";
import { AnnotationDetails } from "../components/ImageAnnotation/AnnotationDetails";
import { CircularProgress, Drawer, IconButton, Grid, Box, Button, LinearProgress, Typography } from "@mui/material";
import Tools from "../components/ImageAnnotation/Tools";
import {
   downloadFile,
   exportToCoco,
   exportToDefaultJson,
   FileAnnotations,
   importFromCocoJsonUtil,
   importFromDefaultJsonUtil,
   steps,
} from "../components/ImageAnnotation/utils";
import { fetchAndReturnData, fetchFile, getC, saveFile, SubmitData, SubmitFile } from "~/utils/utils";
import { useCookies } from "react-cookie";
import { useLoaderData } from "@remix-run/react";

interface AnnotatorConfig {
   id: number;
   srcImgDir: string;
   system: string;
   annotationFilePath: string;
   fileType: string;
}

const ImageAnnotation = () => {
   const { pipeid } = useLoaderData<{ pipeid: string }>();
   const [selectedFile, setSelectedFile] = useState<any | null>(null);
   const [files, setFiles] = useState<string[]>([]);
   const [selectedFileIndex, setSelectedFileIndex] = useState<number | null>(
      null
   );
   const [boundingBoxes, setBoundingBoxes] = useState<Annotation[]>([]);
   const [selectedBoxId, setSelectedBoxId] = useState<string | undefined>();
   const [selectedBoxIds, setSelectedBoxIds] = useState<string[]>([]);
   const [fileToAnnotationsMap, setFileToAnnotationsMap] = useState<
      Map<number, FileAnnotations>
   >(new Map());

   const [openFileExplorer, setOpenFileExplorer] = useState<boolean>(false);
   const [cookie, setCookie] = useCookies(["tapis-token"]);
   const [system, setSystem] = useState<string>("");
   const [score, setScore] = useState<number>(0.1);
   const [activeLabels, setActiveLabels] = useState<string[]>([]);
   const [activeFlags, setActiveFlags] = useState<string[]>([]);
   const [annotatorConfig, setAnnotatorConfig] = useState<AnnotatorConfig | null>(null);
   const [isDemo, setIsDemo] = useState(false);
   const [isAdmin, setIsAdmin] = useState(false);
   const annotationsAutoLoaded = useRef(false);
   const firstImageLoadedRef = useRef(false);
   const [isConfigLoading, setIsConfigLoading] = useState(true);
   const [isAnnotationsLoading, setIsAnnotationsLoading] = useState(false);
   const [isImageLoading, setIsImageLoading] = useState(false);

   const toggleDrawer = () => {
      setOpenFileExplorer((prev) => !prev);
   };

   // Load saved annotator configuration on mount
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
            if (configs && configs.length > 0) {
               setAnnotatorConfig(configs[configs.length - 1]);
            }
            if (pipe?.is_demo) setIsDemo(true);
            if (adminRes?.is_admin) setIsAdmin(true);
         })
         .finally(() => setIsConfigLoading(false));
   }, [pipeid]);

   // Auto-load annotations once files are available and config has an annotation path
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
            importAnnotationsFromJson(file, annotatorConfig.fileType === "coco");
         })
         .catch((e) => console.error("Failed to auto-load annotations:", e))
         .finally(() => setIsAnnotationsLoading(false));
   // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [files, annotatorConfig]);

   const upsertAnnotatorConfig = async (updates: Partial<AnnotatorConfig>) => {
      const token = cookie["tapis-token"]?.["access_token"];
      if (!token || (isDemo && !isAdmin)) return;
      if (annotatorConfig?.id) {
         await SubmitData(`/annotator-configuration/config/${annotatorConfig.id}`, updates, token, "PUT");
         setAnnotatorConfig((prev) => prev ? { ...prev, ...updates } : null);
      } else {
         const payload = { system: "", srcImgDir: "", annotationFilePath: "", fileType: "default", ...updates };
         const res = await SubmitData(`/annotator-configuration/${pipeid}`, payload, token, "POST");
         if (res?.id) {
            setAnnotatorConfig({ id: res.id, ...payload });
         }
      }
   };

   useEffect(() => {
      if (selectedFile) {
         const fa =
            fileToAnnotationsMap.get(selectedFileIndex || 0) || null;
         setBoundingBoxes([...(fa?.annotations || [])]);
      }
   // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [selectedFile]);  // intentionally excludes fileToAnnotationsMap to avoid overwriting live edits on import

   const handleFileSelect = (file: Blob, index: number) => {
      if (!firstImageLoadedRef.current) {
         setIsImageLoading(true);
      }
      const currentFileIndex = selectedFileIndex;
      // Only persist annotations for a previous file. When currentFileIndex is null
      // (first selection), skipping the write prevents a stale-closure snapshot of
      // fileToAnnotationsMap from overwriting annotations that were loaded async
      // (e.g. auto-loaded annotation file arriving after the image).
      if (currentFileIndex !== null) {
         setFileToAnnotationsMap((prev) => {
            const updated = new Map(prev);
            const fa = updated.get(currentFileIndex) || { name: "", width: 0, height: 0, annotations: [] };
            updated.set(currentFileIndex, { ...fa, annotations: boundingBoxes });
            return updated;
         });
      }
      setSelectedFileIndex(index);
      setSelectedFile(file);
      setSelectedBoxId(undefined);
   };

   const handleBoundingBoxUpdate = (
      boxId: string,
      updates: Partial<Annotation>
   ) => {
      setBoundingBoxes((prev) =>
         prev.map((box) => (box.id === boxId ? { ...box, ...updates } : box))
      );
   };

   const handleBoxUpdate = (id: string, updates: Partial<Annotation>) => {
      setBoundingBoxes((prev) =>
         prev.map((box) => (box.id === id ? { ...box, ...updates } : box))
      );
   };

   const updateAnnotationsForCurrentFile = () => {
      let updatedMap = new Map(fileToAnnotationsMap);
      if (selectedFileIndex !== null) {
         const existingAnnotations = updatedMap.get(selectedFileIndex) || {
            name: files[selectedFileIndex] || "",
            width: 0,
            height: 0,
            annotations: [],
         };
         updatedMap.set(selectedFileIndex, {
            ...existingAnnotations,
            annotations: boundingBoxes,
         });
      }
      if (!files || !updatedMap) return;
      setFileToAnnotationsMap(updatedMap);
      return updatedMap;
   }

   const generateJson = (coco: boolean, save: boolean, dir: string, system: string) => {
      // Ensure the latest annotations are saved for the currently selected file
      const updatedMap = updateAnnotationsForCurrentFile();
      if (!updatedMap) return;
      const json = coco
         ? exportToCoco(updatedMap, files)
         : exportToDefaultJson(updatedMap, files);
      if (save && dir) {
         if (isDemo) {
            alert("Demo mode: Saving annotations is disabled for demo pipelines.");
            return;
         }
         const encodedPath = encodeURIComponent(dir);
         saveFile(
            `/save-file/${system}?path=${encodedPath}`,
            JSON.stringify(json, null, 2),
            cookie["tapis-token"]["access_token"]
         );
         console.log(
            `Saving ${coco ? "COCO" : "Default"} JSON to directory:`,
            dir
         );
      } else {
         downloadFile(
            JSON.stringify(json, null, 2),
            coco ? "annotations.coco.json" : "annotations.json"
         );
      }
   };

   const mergeAnnotationMaps = (
      existing: Map<number, FileAnnotations>,
      imported: Map<number, FileAnnotations>
   ): Map<number, FileAnnotations> => {
      const merged = new Map(existing);
      imported.forEach((importedFa, fileIdx) => {
         const existingFa = merged.get(fileIdx);
         if (existingFa) {
            merged.set(fileIdx, {
               ...existingFa,
               annotations: [...existingFa.annotations, ...importedFa.annotations],
            });
         } else {
            merged.set(fileIdx, importedFa);
         }
      });
      return merged;
   };

   const importAnnotationsFromJson = (file: File | Blob, coco: boolean) => {
      if (!(file instanceof Blob)) {
         console.error("Provided file is not a Blob or File.");
         return;
      }
      console.log("Importing COCO JSON from file:", (file as File).name);
      const reader = new FileReader();
      reader.onload = (event) => {
         const json = event.target?.result;
         if (typeof json === "string") {
            try {
               const parsed = JSON.parse(json);
               const importedMap = coco
                  ? importFromCocoJsonUtil(parsed, files)
                  : importFromDefaultJsonUtil(parsed, files);

               // Compute the merged map synchronously so we can derive
               // boundingBoxes from it in the same render cycle.
               const updatedMap = updateAnnotationsForCurrentFile() ?? fileToAnnotationsMap;
               const mergedMap = mergeAnnotationMaps(updatedMap, importedMap);
               setFileToAnnotationsMap(mergedMap);

               // Update live canvas. Fall back to index 0 for auto-load before a file is explicitly selected.
               const targetIndex = selectedFileIndex ?? 0;
               const mergedAnnotations = mergedMap.get(targetIndex)?.annotations ?? [];
               setBoundingBoxes([...mergedAnnotations]);

               console.log(`${coco ? "COCO" : "Default"} data imported:`, parsed);
            } catch (e) {
               console.error("Failed to parse JSON:", e);
            }
         }
      };
      reader.readAsText(file);
   };

   const handleSetFileSize = (size: { width: number; height: number }) => {
      const existingAnnotations =
         fileToAnnotationsMap.get(selectedFileIndex || 0) || {
            name: "",
            width: 0,
            height: 0,
            annotations: [],
         };
      const updatedMap = new Map(fileToAnnotationsMap);
      updatedMap.set(selectedFileIndex || 0, {
         ...existingAnnotations,
         width: size.width,
         height: size.height,
      });
      setFileToAnnotationsMap(updatedMap);
   }

   return (
      <>
         <Button
            onClick={toggleDrawer}
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
               "&:hover": {
                  background: "primary.light",
                  borderColor: "primary.main",
               },
            }}
         >
            File Explorer
         </Button>
         <Drawer
            anchor="left"
            open={openFileExplorer}
            onClose={toggleDrawer}
            sx={{
               width: "35vw",
               flexShrink: 0,
               "& .MuiDrawer-paper": {
                  width: "25vw",
                  boxSizing: "border-box",
                  p: 2,
               },
            }}
            variant="persistent"
         >
            <FileExplorer
               onFileSelect={handleFileSelect}
               filesInDirectory={(files, system) => {
                  setFiles(files);
                  setFileToAnnotationsMap(new Map());
                  setBoundingBoxes([]);
                  setSelectedBoxId(undefined);
                  setSelectedFile(null);
                  setSystem(system);
               }}
               pipeid={pipeid}
               fileDir={annotatorConfig?.srcImgDir}
               parentSystem={annotatorConfig?.system}
               onDirectorySubmit={(!isDemo || isAdmin) ? (srcImgDir, system) =>
                  upsertAnnotatorConfig({ srcImgDir, system }) : undefined
               }
            />
         </Drawer>
         <Tools
            pipeId={pipeid}
            onDownloadCocoJson={(save, dir, system) => generateJson(true, save, dir, system)}
            onDownloadDefaultJson={(save, dir, system) =>
               generateJson(false, save, dir, system)
            }
            handleCocoJsonUpload={(file: File | Blob) =>
               importAnnotationsFromJson(file, true)
            }
            handleDefaultJsonUpload={(file: File | Blob) =>
               importAnnotationsFromJson(file, false)
            }
            filesUploaded={files.length > 0}
            onAnnotationSaved={(filePath, isCoco) =>
               upsertAnnotatorConfig({
                  annotationFilePath: filePath,
                  fileType: isCoco ? "coco" : "default",
               })
            }
            annotationFilePath={annotatorConfig?.annotationFilePath}
            annotationSystem={annotatorConfig?.system}
            annotationIsCoco={annotatorConfig?.fileType === "coco"}
         />
         {/* ── Global loading bar ── */}
         {(isConfigLoading || isAnnotationsLoading || isImageLoading) && (
            <LinearProgress variant="indeterminate" sx={{ height: 3 }} />
         )}

         {/* ── Status banners ── */}
         {isConfigLoading && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 0.75, bgcolor: "#f3e5f5", borderBottom: "1px solid #ce93d8" }}>
               <CircularProgress size={14} thickness={5} sx={{ color: "#7b1fa2" }} />
               <Typography variant="body2" sx={{ color: "#4a148c", fontWeight: 500 }}>
                  Loading configuration…
               </Typography>
            </Box>
         )}
         {isAnnotationsLoading && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 0.75, bgcolor: "#e3f2fd", borderBottom: "1px solid #90caf9" }}>
               <CircularProgress size={14} thickness={5} sx={{ color: "#1565c0" }} />
               <Typography variant="body2" sx={{ color: "#0d47a1", fontWeight: 500 }}>
                  Loading annotations from saved file…
               </Typography>
            </Box>
         )}
         {isImageLoading && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 0.75, bgcolor: "#e8f5e9", borderBottom: "1px solid #a5d6a7" }}>
               <CircularProgress size={14} thickness={5} sx={{ color: "#2e7d32" }} />
               <Typography variant="body2" sx={{ color: "#1b5e20", fontWeight: 500 }}>
                  Loading image…
               </Typography>
            </Box>
         )}

         <Grid container spacing={2} sx={{ overflow: "hidden" }}>
            <Grid size={9}>
               {selectedFile ? (
                  <ImageCanvas
                     file={selectedFile}
                     boxes={boundingBoxes}
                     onBoxAddition={(annotations) =>
                        setBoundingBoxes((prev) => [...prev, ...annotations])
                     }
                     selectedAnnotationId={selectedBoxId || ""}
                     onBoxSelection={(id) => { setSelectedBoxId(id ?? undefined); setSelectedBoxIds([]); }}
                     onBoxMultiSelection={(ids) => { setSelectedBoxIds(ids); if (ids.length > 0) setSelectedBoxId(undefined); }}
                     selectedAnnotationIds={selectedBoxIds}
                     onBoxUpdate={handleBoxUpdate}
                     isEditable={true}
                     setFileSize={handleSetFileSize}
                     isGraphEnabled={false}
                     fileName={files[selectedFileIndex || 0]}
                     systemId={system}
                     pipeId={pipeid}
                     score={score}
                     activeLabels={activeLabels}
                     activeFlags={activeFlags}
                     deleteAnnotations={(ids) => {
                        setBoundingBoxes(prev => prev.filter(x=> !ids.includes(x.id)))
                     }}
                     onImageLoaded={() => {
                        if (!firstImageLoadedRef.current) {
                           firstImageLoadedRef.current = true;
                           setIsImageLoading(false);
                        }
                     }}
                  />
               ) : isConfigLoading ? (
                  <Box sx={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", mt: 10, gap: 2 }}>
                     <CircularProgress size={48} />
                     <Typography variant="body1" color="text.secondary">
                        Loading your configuration…
                     </Typography>
                  </Box>
               ) : (
                  <Box
                     sx={{
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                     }}
                  >
                     <h2>No file selected</h2>
                     <h4 style={{ color: "rgba(0, 0, 0, 0.6)" }}>
                        Select a file to start annotating.
                     </h4>
                     <Button
                        variant="contained"
                        onClick={() => setOpenFileExplorer(true)}
                     >
                        Open File Explorer
                     </Button>
                  </Box>
               )}
            </Grid>
            <Grid size={3}>
               <AnnotationDetails
                  annotations={boundingBoxes}
                  selectedBoxId={selectedBoxId}
                  selectedBoxIds={selectedBoxIds}
                  onSelectedBoxChange={(id: string | undefined) =>
                     setSelectedBoxId(id)
                  }
                  onSelectedBoxIdsChange={(ids) => {
                     setSelectedBoxIds(ids);
                     if (ids.length > 0) setSelectedBoxId(undefined);
                  }}
                  onBoundingBoxUpdate={handleBoundingBoxUpdate}
                  deleteAnnotations={(ids: string[]) => {
                     // console.log("Deleting boxes with ids:", ids);
                     const newSet = boundingBoxes.filter(
                        (box) => !ids.includes(box.id)
                     );
                     setBoundingBoxes(newSet);
                  }}
                  handleFilterAnnotations={(score: number, activeLabels: string[], activeFlags: string[]) => {
                    setScore(score);
                    setActiveLabels(activeLabels);
                    setActiveFlags(activeFlags);
                  }}
               />
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
