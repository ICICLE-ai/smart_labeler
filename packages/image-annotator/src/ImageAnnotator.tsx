import { useEffect, useRef, useState } from "react";
import { FileExplorer } from "@icicle-ai/tapis-file-explorer";
import {
   ImageCanvas,
   detectionEngine,
   segmentationEngine,
   type Annotation,
   type SegmentationAnnotation,
   type CanvasEngine,
} from "@icicle-ai/image-annotation-canvas";
import { AnnotationDetails, type DetailsVariant } from "@icicle-ai/annotation-details";
import { CircularProgress, Drawer, Grid, Box, Button, LinearProgress, Typography } from "@mui/material";
import { Tools } from "./Tools";
import {
   downloadFile,
   type FileAnnotations,
   importFromCocoJsonUtil,
   importFromDefaultJsonUtil,
   joinUnderDir,
   mergeDetectionForSave,
   toRelativeFilename,
} from "./detectionIO";
import {
   type SegmentationFileAnnotations,
   mergeSegmentationForSave,
   importSegmentationJson,
   importSegmentationFromCoco,
} from "./segmentationIO";
import {
   type AnnotatorConfig,
   fetchAnnotatorConfigs,
   fetchPipeline,
   fetchIsAdmin,
   createAnnotatorConfig,
   updateAnnotatorConfig,
   fetchAnnotationFileText,
   saveAnnotationFile,
} from "./backendClient";

// Pipeline "type" value that switches the whole component into segmentation
// mode. Any other value (including unset) falls back to detection.
const SEGMENTATION_TYPE = "SEGMENTATION";

// ── Adapter helpers ──
// The import utils return Map<number, FileAnnotations> keyed by index in the files
// array. Our annotation maps are keyed by file path string so keys survive folder
// navigation.

function indexMapToPathMap(indexMap: Map<number, FileAnnotations>, files: string[]): Map<string, FileAnnotations> {
   const pathMap = new Map<string, FileAnnotations>();
   indexMap.forEach((fa, idx) => {
      if (files[idx]) pathMap.set(files[idx], fa);
   });
   return pathMap;
}

// ────────────────────────────────────────────────────────────────────────────
// Mode injection map – pick the canvas engine + details-panel variant per
// pipeline type. To support a new annotation kind: add an entry here.
// ────────────────────────────────────────────────────────────────────────────
interface ModeConfig {
   engine: CanvasEngine<any>;
   detailsVariant: DetailsVariant;
}

const MODE_CONFIG: Record<string, ModeConfig> = {
   [SEGMENTATION_TYPE]: { engine: segmentationEngine, detailsVariant: "segmentation" },
};

const DETECTION_CONFIG: ModeConfig = { engine: detectionEngine, detailsVariant: "detection" };

// Stable identities for "no annotations" so the derived values don't create new
// arrays every render (ImageCanvas re-syncs when the annotations prop identity changes).
const NO_ANNOTATIONS: Annotation[] = [];
const NO_MASKS: SegmentationAnnotation[] = [];

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export interface ImageAnnotatorProps {
   /** Identifies the pipeline being annotated — used to key annotator-config and SAM3 requests. */
   pipeid: string;
   /** Auth token forwarded to the smart-labeler backend, Tapis, and SAM3 requests. */
   tapisToken: string;
   /** Called when "Next Step" is clicked. The button only renders when this is provided. */
   onNextStep?: () => void;
   /** Base URL of the SAM3-compatible `/predict` endpoint (forwarded to ImageCanvas). */
   sam3Endpoint?: string;
}

export const ImageAnnotator: React.FC<ImageAnnotatorProps> = ({ pipeid, tapisToken, onNextStep, sam3Endpoint }) => {
   // ── Pipeline meta ──
   const [pipelineType, setPipelineType] = useState<string | null>(null);
   const isSegmentation = pipelineType === SEGMENTATION_TYPE;

   // ── Shared state ──
   const [selectedFile, setSelectedFile] = useState<any | null>(null);
   const [files, setFiles] = useState<string[]>([]);
   // selectedFilePath is the stable annotation key — a file path string
   const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
   const [openFileExplorer, setOpenFileExplorer] = useState(false);
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
   // Stores the parsed annotation JSON after auto-load so we can apply it to
   // files that arrive later (subfolder navigation grows the file list after
   // the one-shot auto-load has already run).
   const pendingAnnotationDataRef = useRef<{ json: any; isCoco: boolean; isSegmentation: boolean } | null>(null);

   // ── Detection-specific state ──
   const [selectedBoxId, setSelectedBoxId] = useState<string | undefined>();
   const [selectedBoxIds, setSelectedBoxIds] = useState<string[]>([]);
   const [fileToAnnotationsMap, setFileToAnnotationsMap] = useState<Map<string, FileAnnotations>>(new Map());

   // ── Segmentation-specific state ──
   const [selectedMaskId, setSelectedMaskId] = useState<string | undefined>();
   const [selectedMaskIds, setSelectedMaskIds] = useState<string[]>([]);
   const [fileToMasksMap, setFileToMasksMap] = useState<Map<string, SegmentationFileAnnotations>>(new Map());

   // Single source of truth: displayed annotations/masks are DERIVED from the
   // per-file maps, never copied into separate state. Navigation is therefore a
   // pure key change — no persist/load hand-off that can race when setState is
   // asynchronous (the old two-copy design corrupted neighbouring files during
   // rapid arrow-key navigation).
   const boundingBoxes = selectedFilePath
      ? fileToAnnotationsMap.get(selectedFilePath)?.annotations ?? NO_ANNOTATIONS
      : NO_ANNOTATIONS;
   const segmentationMasks = selectedFilePath
      ? fileToMasksMap.get(selectedFilePath)?.masks ?? NO_MASKS
      : NO_MASKS;

   // All edits write straight into the map slot of the file they belong to.
   const mutateBoxes = (path: string | null, fn: (anns: Annotation[]) => Annotation[]) => {
      if (!path) return;
      setFileToAnnotationsMap((prev) => {
         const updated = new Map(prev);
         const fa = updated.get(path) ?? { name: path, width: 0, height: 0, annotations: [] };
         updated.set(path, { ...fa, annotations: fn(fa.annotations) });
         return updated;
      });
   };
   const mutateMasks = (path: string | null, fn: (masks: SegmentationAnnotation[]) => SegmentationAnnotation[]) => {
      if (!path) return;
      setFileToMasksMap((prev) => {
         const updated = new Map(prev);
         const fa = updated.get(path) ?? { name: path, width: 0, height: 0, masks: [] };
         updated.set(path, { ...fa, masks: fn(fa.masks) });
         return updated;
      });
   };

   // ────────────────────────────────────────────────────────────────────────
   // Init: load config + pipeline type
   // ────────────────────────────────────────────────────────────────────────

   useEffect(() => {
      if (!tapisToken || !pipeid) { setIsConfigLoading(false); return; }
      setIsConfigLoading(true);
      Promise.all([
         fetchAnnotatorConfigs(pipeid, tapisToken).catch(() => null),
         fetchPipeline(pipeid, tapisToken).catch(() => null),
         fetchIsAdmin(tapisToken).catch(() => false),
      ])
         .then(([configs, pipe, isAdminResult]) => {
            if (configs && configs.length > 0) setAnnotatorConfig(configs[configs.length - 1]);
            if (pipe?.is_demo) setIsDemo(true);
            if (pipe?.type) setPipelineType(pipe.type);
            if (isAdminResult) setIsAdmin(true);
         })
         .finally(() => setIsConfigLoading(false));
   }, [pipeid, tapisToken]);

   // ── Auto-load annotations once files + config are ready ──
   useEffect(() => {
      if (
         annotationsAutoLoaded.current ||
         files.length === 0 ||
         !annotatorConfig?.annotationFilePath ||
         !annotatorConfig?.system ||
         !tapisToken
      ) return;
      annotationsAutoLoaded.current = true;
      setIsAnnotationsLoading(true);
      // Retry with backoff — the first /get_file hit regularly fails while the
      // backend/Tapis is cold and image prefetches saturate the connection pool.
      fetchAnnotationFileText(pipeid, annotatorConfig.system, annotatorConfig.annotationFilePath, tapisToken)
         .then((text) => {
            let parsed: any;
            try { parsed = JSON.parse(text); } catch { throw new Error("annotation file is not valid JSON"); }
            const isCoco = isSegmentation
               ? (Array.isArray(parsed?.images) && Array.isArray(parsed?.annotations))
               : annotatorConfig.fileType === "coco";
            pendingAnnotationDataRef.current = { json: parsed, isCoco, isSegmentation };
            const file = new File([text], "annotations.json", { type: "application/json" });
            if (isSegmentation) {
               importSegmentationAnnotationsFromJson(file);
            } else {
               importDetectionAnnotationsFromJson(file, annotatorConfig.fileType === "coco");
            }
         })
         .catch((e) => {
            // Un-burn the one-shot flag so a later files/config change retries,
            // instead of a transient failure silently skipping the saved
            // annotations for the whole session.
            annotationsAutoLoaded.current = false;
            console.error("Failed to auto-load annotations:", e);
            alert("Failed to load saved annotations. Reload the page to retry.");
         })
         .finally(() => setIsAnnotationsLoading(false));
   }, [files, annotatorConfig, isSegmentation, pipeid, tapisToken]);

   // Re-apply stored annotations whenever the file list grows (subfolder navigation).
   // Only fills entries not already present — never overwrites live user edits.
   useEffect(() => {
      const data = pendingAnnotationDataRef.current;
      if (!data || files.length === 0) return;
      const srcDir = annotatorConfig?.srcImgDir ?? "";
      if (data.isSegmentation) {
         const importedMap = data.isCoco
            ? importSegmentationFromCoco(data.json, files, srcDir)
            : importSegmentationJson(data.json, files, srcDir);
         setFileToMasksMap((prev) => {
            const newEntries = [...importedMap.entries()].filter(([k]) => !prev.has(k));
            if (newEntries.length === 0) return prev;
            const merged = new Map(prev);
            newEntries.forEach(([k, v]) => merged.set(k, v));
            return merged;
         });
      } else {
         const importedIndexMap = data.isCoco
            ? importFromCocoJsonUtil(data.json, files, srcDir)
            : importFromDefaultJsonUtil(data.json, files, srcDir);
         const importedPathMap = indexMapToPathMap(importedIndexMap, files);
         setFileToAnnotationsMap((prev) => {
            const newEntries = [...importedPathMap.entries()].filter(([k]) => !prev.has(k));
            if (newEntries.length === 0) return prev;
            const merged = new Map(prev);
            newEntries.forEach(([k, v]) => merged.set(k, v));
            return merged;
         });
      }
      // srcImgDir participates in path matching, so a config arriving after the
      // files must re-run this fill (it only adds missing entries, never overwrites).
   }, [files, annotatorConfig?.srcImgDir]);

   // ────────────────────────────────────────────────────────────────────────
   // Config upsert
   // ────────────────────────────────────────────────────────────────────────

   const upsertAnnotatorConfig = async (updates: Partial<AnnotatorConfig>) => {
      if (!tapisToken || (isDemo && !isAdmin)) return;
      if (annotatorConfig?.id) {
         await updateAnnotatorConfig(annotatorConfig.id, updates, tapisToken);
         setAnnotatorConfig((prev) => prev ? { ...prev, ...updates } : null);
      } else {
         const payload = { system: "", srcImgDir: "", annotationFilePath: "", fileType: "default", ...updates };
         const created = await createAnnotatorConfig(pipeid, payload, tapisToken);
         if (created) setAnnotatorConfig(created);
      }
   };

   // ────────────────────────────────────────────────────────────────────────
   // File selection – persists current annotations before switching
   // ────────────────────────────────────────────────────────────────────────

   const handleFileSelect = (file: Blob | null, filePath: string) => {
      // Displayed annotations/masks are derived from the maps, so switching files
      // is a pure key change — nothing to persist or reload, nothing to race.
      setSelectedFilePath(filePath);
      setSelectedBoxId(undefined);

      if (file) {
         if (!firstImageLoadedRef.current) setIsImageLoading(true);
         setSelectedFile(file);
      }
      setSelectedMaskId(undefined);
   };

   // ────────────────────────────────────────────────────────────────────────
   // Detection helpers
   // ────────────────────────────────────────────────────────────────────────

   const handleBoundingBoxUpdate = (id: string, updates: Partial<Annotation>) => {
      mutateBoxes(selectedFilePath, (anns) =>
         anns.map((box) => (box.id === id ? { ...box, ...updates } : box))
      );
   };

   // The map always holds the latest annotations (edits write straight into it),
   // so exporting needs no flush step.
   const updateDetectionMapForCurrentFile = () => fileToAnnotationsMap;

   const generateDetectionJson = (coco: boolean, save: boolean, dir: string, sys: string) => {
      const updatedMap = updateDetectionMapForCurrentFile();
      const srcDir = annotatorConfig?.srcImgDir ?? "";
      // Key live annotations by path relative to srcImgDir, then overlay them on
      // the originally-imported dataset so annotations for folders that were never
      // opened this session aren't dropped from the saved file.
      const liveRel = new Map<string, FileAnnotations>();
      updatedMap.forEach((fa, fullPath) => liveRel.set(toRelativeFilename(fullPath, srcDir), fa));
      const baseline = pendingAnnotationDataRef.current && !pendingAnnotationDataRef.current.isSegmentation
         ? pendingAnnotationDataRef.current : null;
      const json = mergeDetectionForSave(liveRel, baseline?.json ?? null, baseline?.isCoco ?? false, srcDir, coco, files);
      if (save && dir) {
         if (isDemo) { alert("Demo mode: Saving is disabled."); return; }
         return saveAnnotationFile(sys, dir, JSON.stringify(json, null, 2), tapisToken)
            .then((ok) => {
               alert(ok
                  ? `Annotations saved successfully to ${dir}`
                  : `Failed to save annotations to ${dir}. Please check the path and try again.`);
            })
            .catch((err) => {
               console.error("Error saving annotations:", err);
               alert("Error saving annotations. Please try again.");
            });
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
            // Keep a copy so the re-apply effect can match newly-discovered files later.
            pendingAnnotationDataRef.current = { json: parsed, isCoco: coco, isSegmentation: false };
            // Utils return index-keyed maps — convert to path-keyed for stable storage
            const srcDir = annotatorConfig?.srcImgDir ?? "";
            const importedIndexMap = coco
               ? importFromCocoJsonUtil(parsed, files, srcDir)
               : importFromDefaultJsonUtil(parsed, files, srcDir);
            const importedMap = indexMapToPathMap(importedIndexMap, files);
            // Functional update: this runs long after the closure was created
            // (fetch + FileReader), so merging into `prev` — not a captured map —
            // keeps concurrent edits/size writes from being clobbered.
            setFileToAnnotationsMap((prev) => {
               const merged = new Map(prev);
               importedMap.forEach((imported, path) => {
                  const existing = merged.get(path);
                  // Replace-per-path: an imported file overwrites that file's
                  // annotations instead of appending, so re-importing the same file
                  // is idempotent. Existing metadata (width/height) is preserved.
                  merged.set(path, existing
                     ? { ...existing, annotations: imported.annotations }
                     : imported
                  );
               });
               return merged;
            });
         } catch (e) {
            console.error("Failed to parse detection JSON:", e);
         }
      };
      reader.readAsText(file);
   };

   // ────────────────────────────────────────────────────────────────────────
   // Segmentation helpers
   // ────────────────────────────────────────────────────────────────────────

   // The map always holds the latest masks (edits write straight into it),
   // so exporting needs no flush step.
   const updateSegmentationMapForCurrentFile = () => fileToMasksMap;

   const generateSegmentationJson = (coco: boolean, save: boolean, dir: string, sys: string) => {
      const updatedMap = updateSegmentationMapForCurrentFile();
      const srcDir = annotatorConfig?.srcImgDir ?? "";
      // Overlay live masks on the imported baseline so masks for folders that were
      // never opened this session aren't dropped from the saved file.
      const liveRel = new Map<string, SegmentationFileAnnotations>();
      updatedMap.forEach((fa, fullPath) => liveRel.set(toRelativeFilename(fullPath, srcDir), fa));
      const baseline = pendingAnnotationDataRef.current && pendingAnnotationDataRef.current.isSegmentation
         ? pendingAnnotationDataRef.current : null;
      const json = mergeSegmentationForSave(liveRel, baseline?.json ?? null, baseline?.isCoco ?? false, srcDir, coco, files);
      if (save && dir) {
         if (isDemo) { alert("Demo mode: Saving is disabled."); return; }
         return saveAnnotationFile(sys, dir, JSON.stringify(json, null, 2), tapisToken)
            .then((ok) => {
               alert(ok
                  ? `Segmentation saved successfully to ${dir}`
                  : `Failed to save segmentation to ${dir}. Please check the path and try again.`);
            })
            .catch((err) => {
               console.error("Error saving segmentation:", err);
               alert("Error saving segmentation. Please try again.");
            });
      } else {
         downloadFile(JSON.stringify(json, null, 2), coco ? "segmentation.coco.json" : "segmentation.json");
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
            const isCoco = Array.isArray(parsed?.images) && Array.isArray(parsed?.annotations);
            // Keep a copy so the re-apply effect can match newly-discovered files later.
            pendingAnnotationDataRef.current = { json: parsed, isCoco, isSegmentation: true };
            const srcDir = annotatorConfig?.srcImgDir ?? "";
            const importedMap = isCoco
               ? importSegmentationFromCoco(parsed, files, srcDir)
               : importSegmentationJson(parsed, files, srcDir);
            // Functional update: this runs long after the closure was created
            // (fetch + FileReader), so merging into `prev` — not a captured map —
            // keeps concurrent edits/size writes from being clobbered.
            setFileToMasksMap((prev) => {
               const merged = new Map(prev);
               importedMap.forEach((imported, path) => {
                  const existing = merged.get(path);
                  // Replace-per-path: an imported file overwrites that file's masks
                  // instead of appending, so re-importing the same file is idempotent.
                  // Existing metadata (width/height) is preserved.
                  merged.set(path, existing
                     ? { ...existing, masks: imported.masks }
                     : imported
                  );
               });
               return merged;
            });
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
      const key = selectedFilePath ?? "";
      if (isSegmentation) {
         setFileToMasksMap((prev) => {
            const updated = new Map(prev);
            const fa = updated.get(key) ?? { name: key, width: 0, height: 0, masks: [] };
            updated.set(key, { ...fa, ...size });
            return updated;
         });
      } else {
         setFileToAnnotationsMap((prev) => {
            const updated = new Map(prev);
            const fa = updated.get(key) ?? { name: key, width: 0, height: 0, annotations: [] };
            updated.set(key, { ...fa, ...size });
            return updated;
         });
      }
   };

   // ────────────────────────────────────────────────────────────────────────
   // Mode-driven wiring – engine + details panel are injected from MODE_CONFIG;
   // the annotation state each one reads/writes is selected per mode below.
   // ────────────────────────────────────────────────────────────────────────
   const activeConfig = (pipelineType && MODE_CONFIG[pipelineType]) || DETECTION_CONFIG;

   const handleImageLoaded = () => {
      if (!firstImageLoadedRef.current) { firstImageLoadedRef.current = true; setIsImageLoading(false); }
   };

   const handleFilterAnnotations = (s: number, labels: string[], flags: string[]) => {
      setScore(s);
      setActiveLabels(labels);
      setActiveFlags(flags);
   };

   const handleMaskUpdate = (id: string, updates: Partial<SegmentationAnnotation>) =>
      mutateMasks(selectedFilePath, (masks) => masks.map((m) => (m.id === id ? { ...m, ...updates } : m)));
   const deleteMasks = (ids: string[]) =>
      mutateMasks(selectedFilePath, (masks) => masks.filter((m) => !ids.includes(m.id)));
   const deleteBoxes = (ids: string[]) =>
      mutateBoxes(selectedFilePath, (anns) => anns.filter((box) => !ids.includes(box.id)));

   // Props fed into the single <ImageCanvas>, chosen by mode.
   const canvasProps = isSegmentation
      ? {
           annotations: segmentationMasks,
           onAddition: (added: SegmentationAnnotation[]) =>
              mutateMasks(selectedFilePath, (masks) => [...masks, ...added]),
           selectedAnnotationId: selectedMaskId ?? null,
           selectedAnnotationIds: selectedMaskIds,
           onSelection: (id: string | null) => { setSelectedMaskId(id ?? undefined); setSelectedMaskIds([]); },
           onMultiSelection: (ids: string[]) => { setSelectedMaskIds(ids); if (ids.length > 0) setSelectedMaskId(undefined); },
           onUpdate: handleMaskUpdate,
           deleteAnnotations: deleteMasks,
        }
      : {
           annotations: boundingBoxes,
           onAddition: (added: Annotation[]) =>
              mutateBoxes(selectedFilePath, (anns) => [...anns, ...added]),
           selectedAnnotationId: selectedBoxId ?? "",
           selectedAnnotationIds: selectedBoxIds,
           onSelection: (id: string | null) => { setSelectedBoxId(id ?? undefined); setSelectedBoxIds([]); },
           onMultiSelection: (ids: string[]) => { setSelectedBoxIds(ids); if (ids.length > 0) setSelectedBoxId(undefined); },
           onUpdate: handleBoundingBoxUpdate,
           deleteAnnotations: deleteBoxes,
        };

   // Props fed into the injected <Details> panel, chosen by mode.
   const detailsProps = isSegmentation
      ? {
           annotations: segmentationMasks,
           selectedBoxId: selectedMaskId,
           selectedBoxIds: selectedMaskIds,
           onSelectedBoxChange: (id: string) => setSelectedMaskId(id),
           onSelectedBoxIdsChange: (ids: string[]) => { setSelectedMaskIds(ids); if (ids.length > 0) setSelectedMaskId(undefined); },
           onAnnotationUpdate: handleMaskUpdate,
           deleteAnnotations: deleteMasks,
           handleFilterAnnotations,
        }
      : {
           annotations: boundingBoxes,
           selectedBoxId,
           selectedBoxIds,
           onSelectedBoxChange: (id: string) => setSelectedBoxId(id),
           onSelectedBoxIdsChange: (ids: string[]) => { setSelectedBoxIds(ids); if (ids.length > 0) setSelectedBoxId(undefined); },
           onAnnotationUpdate: handleBoundingBoxUpdate,
           deleteAnnotations: deleteBoxes,
           handleFilterAnnotations,
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
               token={tapisToken}
               onFileSelect={handleFileSelect}
               filesInDirectory={(newFiles, sys, isRootReset) => {
                  // Edits live directly in the per-file maps, so folder navigation
                  // needs no flush step.
                  if (isRootReset) {
                     setFiles(newFiles);
                  } else {
                     setFiles((prev) => {
                        const existing = new Set(prev);
                        const toAdd = newFiles.filter((f) => !existing.has(f));
                        return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
                     });
                  }
                  setSystem(sys);
               }}
               pipeid={pipeid}
               fileDir={annotatorConfig?.srcImgDir}
               parentSystem={annotatorConfig?.system}
               onDirectorySubmit={(!isDemo || isAdmin) ? (srcImgDir, sys) => {
                  // Full reset: new root directory means stale annotation paths may
                  // be invalid. Displayed annotations are derived from the maps, so
                  // clearing the maps clears the canvas.
                  setFileToAnnotationsMap(new Map());
                  setFileToMasksMap(new Map());
                  setSelectedBoxId(undefined);
                  setSelectedMaskId(undefined);
                  setSelectedFile(null);
                  setSelectedFilePath(null);
                  annotationsAutoLoaded.current = false;
                  pendingAnnotationDataRef.current = null;
                  upsertAnnotatorConfig({ srcImgDir, system: sys });
               } : undefined}
            />
         </Drawer>

         {/* ── Toolbar ── */}
         <Tools
            pipeId={pipeid}
            token={tapisToken}
            onNextStep={onNextStep}
            onDownloadCocoJson={(save, dir, sys) => isSegmentation
               ? generateSegmentationJson(true, save, dir, sys)
               : generateDetectionJson(true, save, dir, sys)
            }
            onDownloadDefaultJson={(save, dir, sys) => isSegmentation
               ? generateSegmentationJson(false, save, dir, sys)
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
            onAnnotationSaved={(filePath, isCoco) => {
               // Saving wrote the file from in-memory state, which is now the source
               // of truth. Mark auto-load done so this config change doesn't re-trigger
               // the auto-load effect (which would re-import and merge the just-saved
               // file back in, duplicating or dropping annotations).
               annotationsAutoLoaded.current = true;
               upsertAnnotatorConfig({ annotationFilePath: filePath, fileType: isCoco ? "coco" : "default" });
            }}
            annotationFilePath={annotatorConfig?.annotationFilePath}
            annotationSystem={annotatorConfig?.system}
            annotationIsCoco={annotatorConfig?.fileType === "coco"}
            annotationSrcImgDir={annotatorConfig?.srcImgDir}
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
                  <ImageCanvas
                     engine={activeConfig.engine as CanvasEngine<any>}
                     {...(canvasProps as any)}
                     file={selectedFile}
                     isEditable={true}
                     setFileSize={handleSetFileSize}
                     isGraphEnabled={false}
                     fileName={selectedFilePath ?? ""}
                     systemId={system}
                     pipeId={pipeid}
                     score={score}
                     activeLabels={activeLabels}
                     activeFlags={activeFlags}
                     onImageLoaded={handleImageLoaded}
                     tapisToken={tapisToken}
                     sam3Endpoint={sam3Endpoint}
                  />
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
               <AnnotationDetails variant={activeConfig.detailsVariant} {...(detailsProps as any)} />
            </Grid>
         </Grid>
      </>
   );
};

export default ImageAnnotator;
