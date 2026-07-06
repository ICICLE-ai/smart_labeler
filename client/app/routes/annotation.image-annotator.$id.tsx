import { useEffect, useRef, useState } from "react";
import { FileExplorer } from "../components/FileExplorer/FileExplorer";
import {
   ImageCanvas,
   detectionEngine,
   segmentationEngine,
   type Annotation,
   type SegmentationAnnotation,
   type CanvasEngine,
} from "../components/ImageAnnotation/canvas/ImageCanvas";
import { AnnotationDetails, type DetailsVariant } from "../components/ImageAnnotation/AnnotationDetails/AnnotationDetails";
import { CircularProgress, Drawer, Grid, Box, Button, LinearProgress, Typography } from "@mui/material";
import Tools from "../components/ImageAnnotation/utils/Tools";
import {
   downloadFile,
   exportToCoco,
   exportToDefaultJson,
   FileAnnotations,
   importFromCocoJsonUtil,
   importFromDefaultJsonUtil,
} from "../components/ImageAnnotation/utils/utils";
import { fetchFile, saveFile, SubmitData, fetchAndReturnData } from "~/utils/utils";
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

// ── Adapter helpers ──
// Utils functions (exportToCoco, importFromCocoJsonUtil, etc.) use Map<number, FileAnnotations>.
// Our annotation maps are keyed by file path string so keys survive folder navigation.

function pathMapToIndexMap(pathMap: Map<string, FileAnnotations>, files: string[]): Map<number, FileAnnotations> {
   const indexMap = new Map<number, FileAnnotations>();
   files.forEach((f, idx) => {
      const fa = pathMap.get(f);
      if (fa) indexMap.set(idx, fa);
   });
   return indexMap;
}

function indexMapToPathMap(indexMap: Map<number, FileAnnotations>, files: string[]): Map<string, FileAnnotations> {
   const pathMap = new Map<string, FileAnnotations>();
   indexMap.forEach((fa, idx) => {
      if (files[idx]) pathMap.set(files[idx], fa);
   });
   return pathMap;
}

// ── Segmentation JSON helpers ──

// Convert a full Tapis path to a filename relative to srcImgDir.
// Falls back to just the basename if the directory prefix doesn't match.
function toRelativeFilename(fullPath: string, srcImgDir: string): string {
   const normDir = srcImgDir.replace(/^\/+/, "").replace(/\/+$/, "");
   const normPath = fullPath.replace(/^\/+/, "");
   if (normDir && normPath.startsWith(normDir + "/")) return normPath.slice(normDir.length + 1);
   const lastSlash = fullPath.lastIndexOf("/");
   return lastSlash >= 0 ? fullPath.slice(lastSlash + 1) : fullPath;
}

function exportSegmentationJson(
   fileToMasksMap: Map<string, SegmentationFileAnnotations>,
   files: string[],
   srcImgDir: string = ""
): object {
   const fileEntries = files.map((filePath) => {
      const fa = fileToMasksMap.get(filePath);
      return {
         filename: toRelativeFilename(filePath, srcImgDir),
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

function exportSegmentationToCoco(
   fileToMasksMap: Map<string, SegmentationFileAnnotations>,
   files: string[],
   srcImgDir: string = ""
): object {
   const categoryMap = new Map<string, number>();
   let categoryId = 1;
   let annotationId = 1;
   const images: any[] = [];
   const annotations: any[] = [];

   files.forEach((filePath, imageIndex) => {
      const fa = fileToMasksMap.get(filePath);
      if (!fa || fa.masks.length === 0) return;

      images.push({
         id: imageIndex,
         file_name: toRelativeFilename(filePath, srcImgDir),
         width: fa.width,
         height: fa.height,
      });

      fa.masks.forEach((mask) => {
         if (!categoryMap.has(mask.label)) categoryMap.set(mask.label, categoryId++);
         const catId = categoryMap.get(mask.label)!;

         // COCO polygon: flattened [x1, y1, x2, y2, ...]
         const segmentation = [mask.points.flatMap((p) => [p.x, p.y])];

         // Bounding box from polygon extent
         const xs = mask.points.map((p) => p.x);
         const ys = mask.points.map((p) => p.y);
         const minX = Math.min(...xs), minY = Math.min(...ys);
         const maxX = Math.max(...xs), maxY = Math.max(...ys);

         // Shoelace area
         let area = 0;
         for (let i = 0; i < mask.points.length; i++) {
            const j = (i + 1) % mask.points.length;
            area += mask.points[i].x * mask.points[j].y - mask.points[j].x * mask.points[i].y;
         }
         area = Math.abs(area) / 2;

         annotations.push({
            id: annotationId++,
            image_id: imageIndex,
            category_id: catId,
            segmentation,
            area,
            bbox: [minX, minY, maxX - minX, maxY - minY],
            iscrowd: 0,
            ...(mask.score !== undefined ? { score: mask.score } : {}),
            ...(mask.flag ? { flag: mask.flag } : {}),
         });
      });
   });

   const categories = Array.from(categoryMap.entries()).map(([name, id]) => ({ id, name }));
   return { info: { version: "1.0", type: "segmentation" }, images, annotations, categories };
}

function importSegmentationJson(
   json: any,
   files: string[]
): Map<string, SegmentationFileAnnotations> {
   const map = new Map<string, SegmentationFileAnnotations>();
   if (!json?.files) return map;
   (json.files as any[]).forEach((entry) => {
      // Match by exact full path or by the relative filename stored in the JSON
      const matchedPath = files.find((f) => f === entry.filename || f.endsWith("/" + entry.filename));
      if (!matchedPath) return;
      map.set(matchedPath, {
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

function importSegmentationFromCoco(
   json: any,
   files: string[]
): Map<string, SegmentationFileAnnotations> {
   const map = new Map<string, SegmentationFileAnnotations>();
   if (!json?.images || !json?.annotations) return map;

   // Build lookup: basename → full file path
   const nameToPath = new Map<string, string>();
   files.forEach((f) => {
      nameToPath.set(f.split("/").at(-1) ?? f, f);
      nameToPath.set(f, f);
   });

   // imageId → full path + size
   const imageIdToPath = new Map<number, string>();
   const imageIdToSize = new Map<number, { width: number; height: number }>();
   (json.images as any[]).forEach((img) => {
      const basename = img.file_name.split("/").at(-1) ?? img.file_name;
      const matched = nameToPath.get(basename) ?? nameToPath.get(img.file_name);
      if (matched) {
         imageIdToPath.set(img.id, matched);
         imageIdToSize.set(img.id, { width: img.width ?? 0, height: img.height ?? 0 });
      }
   });

   // categoryId → label
   const catIdToLabel = new Map<number, string>();
   (json.categories as any[] ?? []).forEach((cat) => catIdToLabel.set(cat.id, cat.name));

   (json.annotations as any[]).forEach((ann) => {
      const filePath = imageIdToPath.get(ann.image_id);
      if (!filePath) return;
      const size = imageIdToSize.get(ann.image_id) ?? { width: 0, height: 0 };
      const label = catIdToLabel.get(ann.category_id) ?? "mask";

      // Convert flattened COCO polygon [x1, y1, x2, y2, ...] → {x, y}[]
      const seg: number[] = ann.segmentation?.[0] ?? [];
      const points: { x: number; y: number }[] = [];
      for (let i = 0; i + 1 < seg.length; i += 2) points.push({ x: seg[i], y: seg[i + 1] });
      if (points.length < 3) return;

      const mask: SegmentationAnnotation = {
         id: ann.id?.toString() ?? Date.now().toString(),
         label,
         points,
         ...(ann.score !== undefined ? { score: ann.score } : {}),
         ...(ann.flag ? { flag: ann.flag } : {}),
      };

      const existing = map.get(filePath);
      if (existing) {
         existing.masks.push(mask);
      } else {
         map.set(filePath, { name: filePath, ...size, masks: [mask] });
      }
   });

   return map;
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
   [TYPE.SEGMENTATION]: { engine: segmentationEngine, detailsVariant: "segmentation" },
};

const DETECTION_CONFIG: ModeConfig = { engine: detectionEngine, detailsVariant: "detection" };

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
   // selectedFilePath is the stable annotation key — a file path string
   const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
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
   // Stores the parsed annotation JSON after auto-load so we can apply it to
   // files that arrive later (subfolder navigation grows the file list after
   // the one-shot auto-load has already run).
   const pendingAnnotationDataRef = useRef<{ json: any; isCoco: boolean; isSegmentation: boolean } | null>(null);

   // ── Detection-specific state ──
   const [boundingBoxes, setBoundingBoxes] = useState<Annotation[]>([]);
   const [selectedBoxId, setSelectedBoxId] = useState<string | undefined>();
   const [selectedBoxIds, setSelectedBoxIds] = useState<string[]>([]);
   const [fileToAnnotationsMap, setFileToAnnotationsMap] = useState<Map<string, FileAnnotations>>(new Map());

   // ── Segmentation-specific state ──
   const [segmentationMasks, setSegmentationMasks] = useState<SegmentationAnnotation[]>([]);
   const [selectedMaskId, setSelectedMaskId] = useState<string | undefined>();
   const [selectedMaskIds, setSelectedMaskIds] = useState<string[]>([]);
   const [fileToMasksMap, setFileToMasksMap] = useState<Map<string, SegmentationFileAnnotations>>(new Map());

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
            let parsed: any;
            try { parsed = JSON.parse(text); } catch { return; }
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
         .catch((e) => console.error("Failed to auto-load annotations:", e))
         .finally(() => setIsAnnotationsLoading(false));
   }, [files, annotatorConfig, isSegmentation]);

   // Re-apply stored annotations whenever the file list grows (subfolder navigation).
   // Only fills entries not already present — never overwrites live user edits.
   useEffect(() => {
      const data = pendingAnnotationDataRef.current;
      if (!data || files.length === 0) return;
      if (data.isSegmentation) {
         const importedMap = data.isCoco
            ? importSegmentationFromCoco(data.json, files)
            : importSegmentationJson(data.json, files);
         setFileToMasksMap((prev) => {
            const newEntries = [...importedMap.entries()].filter(([k]) => !prev.has(k));
            if (newEntries.length === 0) return prev;
            const merged = new Map(prev);
            newEntries.forEach(([k, v]) => merged.set(k, v));
            return merged;
         });
      } else {
         const importedIndexMap = data.isCoco
            ? importFromCocoJsonUtil(data.json, files)
            : importFromDefaultJsonUtil(data.json, files);
         const importedPathMap = indexMapToPathMap(importedIndexMap, files);
         setFileToAnnotationsMap((prev) => {
            const newEntries = [...importedPathMap.entries()].filter(([k]) => !prev.has(k));
            if (newEntries.length === 0) return prev;
            const merged = new Map(prev);
            newEntries.forEach(([k, v]) => merged.set(k, v));
            return merged;
         });
      }
   }, [files]);

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
      if (!selectedFilePath) return;
      if (isSegmentation) {
         const fa = fileToMasksMap.get(selectedFilePath);
         setSegmentationMasks([...(fa?.masks ?? [])]);
      } else {
         const fa = fileToAnnotationsMap.get(selectedFilePath);
         setBoundingBoxes([...(fa?.annotations ?? [])]);
      }
   }, [selectedFilePath]); // fires immediately on navigation, not after image load

   const handleFileSelect = (file: Blob | null, filePath: string) => {
      const prevPath = selectedFilePath;

      // Persist annotations for the departing file immediately so rapid arrow-key
      // navigation never shows stale annotations for the wrong file.
      if (prevPath !== null && prevPath !== filePath) {
         if (isSegmentation) {
            setFileToMasksMap((prev) => {
               const updated = new Map(prev);
               const fa = updated.get(prevPath) ?? { name: prevPath, width: 0, height: 0, masks: [] };
               updated.set(prevPath, { ...fa, masks: segmentationMasks });
               return updated;
            });
         } else {
            setFileToAnnotationsMap((prev) => {
               const updated = new Map(prev);
               const fa = updated.get(prevPath) ?? { name: prevPath, width: 0, height: 0, annotations: [] };
               updated.set(prevPath, { ...fa, annotations: boundingBoxes });
               return updated;
            });
         }
      }

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
      setBoundingBoxes((prev) => prev.map((box) => (box.id === id ? { ...box, ...updates } : box)));
   };

   const updateDetectionMapForCurrentFile = () => {
      const updated = new Map(fileToAnnotationsMap);
      if (selectedFilePath !== null) {
         const fa = updated.get(selectedFilePath) ?? { name: selectedFilePath, width: 0, height: 0, annotations: [] };
         updated.set(selectedFilePath, { ...fa, annotations: boundingBoxes });
      }
      setFileToAnnotationsMap(updated);
      return updated;
   };

   const generateDetectionJson = (coco: boolean, save: boolean, dir: string, sys: string) => {
      const updatedMap = updateDetectionMapForCurrentFile();
      // Utils expect Map<number, FileAnnotations> keyed by index in the files array
      const indexMap = pathMapToIndexMap(updatedMap, files);
      const json = coco ? exportToCoco(indexMap, files, annotatorConfig?.srcImgDir ?? "") : exportToDefaultJson(indexMap, files, annotatorConfig?.srcImgDir ?? "");
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
            // Keep a copy so the re-apply effect can match newly-discovered files later.
            pendingAnnotationDataRef.current = { json: parsed, isCoco: coco, isSegmentation: false };
            // Utils return index-keyed maps — convert to path-keyed for stable storage
            const importedIndexMap = coco ? importFromCocoJsonUtil(parsed, files) : importFromDefaultJsonUtil(parsed, files);
            const importedMap = indexMapToPathMap(importedIndexMap, files);
            const currentMap = updateDetectionMapForCurrentFile();
            const merged = new Map(currentMap);
            importedMap.forEach((imported, path) => {
               const existing = merged.get(path);
               merged.set(path, existing
                  ? { ...existing, annotations: [...existing.annotations, ...imported.annotations] }
                  : imported
               );
            });
            setFileToAnnotationsMap(merged);
            const target = selectedFilePath ?? "";
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
      if (selectedFilePath !== null) {
         const fa = updated.get(selectedFilePath) ?? { name: selectedFilePath, width: 0, height: 0, masks: [] };
         updated.set(selectedFilePath, { ...fa, masks: segmentationMasks });
      }
      setFileToMasksMap(updated);
      return updated;
   };

   const generateSegmentationJson = (coco: boolean, save: boolean, dir: string, sys: string) => {
      const updatedMap = updateSegmentationMapForCurrentFile();
      const srcDir = annotatorConfig?.srcImgDir ?? "";
      const json = coco
         ? exportSegmentationToCoco(updatedMap, files, srcDir)
         : exportSegmentationJson(updatedMap, files, srcDir);
      if (save && dir) {
         if (isDemo) { alert("Demo mode: Saving is disabled."); return; }
         saveFile(`/save-file/${sys}?path=${encodeURIComponent(dir)}`, JSON.stringify(json, null, 2), cookie["tapis-token"]["access_token"]);
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
            const importedMap = isCoco ? importSegmentationFromCoco(parsed, files) : importSegmentationJson(parsed, files);
            const currentMap = updateSegmentationMapForCurrentFile();
            const merged = new Map(currentMap);
            importedMap.forEach((imported, path) => {
               const existing = merged.get(path);
               merged.set(path, existing
                  ? { ...existing, masks: [...existing.masks, ...imported.masks] }
                  : imported
               );
            });
            setFileToMasksMap(merged);
            const target = selectedFilePath ?? "";
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

   // Props fed into the single <ImageCanvas>, chosen by mode.
   const canvasProps = isSegmentation
      ? {
           annotations: segmentationMasks,
           onAddition: (added: SegmentationAnnotation[]) => setSegmentationMasks((prev) => [...prev, ...added]),
           selectedAnnotationId: selectedMaskId ?? null,
           selectedAnnotationIds: selectedMaskIds,
           onSelection: (id: string | null) => { setSelectedMaskId(id ?? undefined); setSelectedMaskIds([]); },
           onMultiSelection: (ids: string[]) => { setSelectedMaskIds(ids); if (ids.length > 0) setSelectedMaskId(undefined); },
           onUpdate: (id: string, updates: Partial<SegmentationAnnotation>) =>
              setSegmentationMasks((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m))),
           deleteAnnotations: (ids: string[]) => setSegmentationMasks((prev) => prev.filter((m) => !ids.includes(m.id))),
        }
      : {
           annotations: boundingBoxes,
           onAddition: (added: Annotation[]) => setBoundingBoxes((prev) => [...prev, ...added]),
           selectedAnnotationId: selectedBoxId ?? "",
           selectedAnnotationIds: selectedBoxIds,
           onSelection: (id: string | null) => { setSelectedBoxId(id ?? undefined); setSelectedBoxIds([]); },
           onMultiSelection: (ids: string[]) => { setSelectedBoxIds(ids); if (ids.length > 0) setSelectedBoxId(undefined); },
           onUpdate: handleBoundingBoxUpdate,
           deleteAnnotations: (ids: string[]) => setBoundingBoxes((prev) => prev.filter((x) => !ids.includes(x.id))),
        };

   // Props fed into the injected <Details> panel, chosen by mode.
   const detailsProps = isSegmentation
      ? {
           annotations: segmentationMasks,
           selectedBoxId: selectedMaskId,
           selectedBoxIds: selectedMaskIds,
           onSelectedBoxChange: (id: string) => setSelectedMaskId(id),
           onSelectedBoxIdsChange: (ids: string[]) => { setSelectedMaskIds(ids); if (ids.length > 0) setSelectedMaskId(undefined); },
           onAnnotationUpdate: (id: string, updates: Partial<SegmentationAnnotation>) =>
              setSegmentationMasks((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m))),
           deleteAnnotations: (ids: string[]) => setSegmentationMasks((prev) => prev.filter((m) => !ids.includes(m.id))),
           handleFilterAnnotations,
        }
      : {
           annotations: boundingBoxes,
           selectedBoxId,
           selectedBoxIds,
           onSelectedBoxChange: (id: string) => setSelectedBoxId(id),
           onSelectedBoxIdsChange: (ids: string[]) => { setSelectedBoxIds(ids); if (ids.length > 0) setSelectedBoxId(undefined); },
           onAnnotationUpdate: handleBoundingBoxUpdate,
           deleteAnnotations: (ids: string[]) => setBoundingBoxes((prev) => prev.filter((box) => !ids.includes(box.id))),
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
               onFileSelect={handleFileSelect}
               filesInDirectory={(newFiles, sys, isRootReset) => {
                  // Flush live edits to the map before the folder view changes so
                  // annotations are never lost if the auto-select fires before handleFileSelect.
                  if (selectedFilePath !== null) {
                     if (isSegmentation) {
                        setFileToMasksMap((prev) => {
                           const updated = new Map(prev);
                           const fa = updated.get(selectedFilePath) ?? { name: selectedFilePath, width: 0, height: 0, masks: [] };
                           updated.set(selectedFilePath, { ...fa, masks: segmentationMasks });
                           return updated;
                        });
                     } else {
                        setFileToAnnotationsMap((prev) => {
                           const updated = new Map(prev);
                           const fa = updated.get(selectedFilePath) ?? { name: selectedFilePath, width: 0, height: 0, annotations: [] };
                           updated.set(selectedFilePath, { ...fa, annotations: boundingBoxes });
                           return updated;
                        });
                     }
                  }
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
                  // Full reset: new root directory means stale annotation paths may be invalid.
                  setFileToAnnotationsMap(new Map());
                  setFileToMasksMap(new Map());
                  setBoundingBoxes([]);
                  setSegmentationMasks([]);
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
            onAnnotationSaved={(filePath, isCoco) =>
               upsertAnnotatorConfig({ annotationFilePath: filePath, fileType: isCoco ? "coco" : "default" })
            }
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

export default ImageAnnotation;

export function clientLoader({ params }: any) {
   return { pipeid: params.id };
}
clientLoader.hydrate = true;
