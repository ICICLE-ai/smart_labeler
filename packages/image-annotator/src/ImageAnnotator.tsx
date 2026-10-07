import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileExplorer, type FileAnnotationStat } from "@icicle-ai/tapis-file-explorer";
import {
   ImageCanvas,
   detectionEngine,
   segmentationEngine,
   type Annotation,
   type SegmentationAnnotation,
   type CanvasEngine,
} from "@icicle-ai/image-annotation-canvas";
import { AnnotationDetails, type DetailsVariant } from "@icicle-ai/annotation-details";
import {
   CircularProgress, Drawer, Grid, Box, Button, LinearProgress, Typography,
   Dialog, DialogTitle, DialogContent, DialogActions, Chip, Alert, Divider,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { Tools } from "./Tools";
import {
   downloadFile,
   type FileAnnotations,
   importFromCocoJsonUtil,
   importFromDefaultJsonUtil,
   joinUnderDir,
   buildFileIndexResolver,
   mergeDetectionForSave,
   toRelativeFilename,
} from "./detectionIO";
import {
   type SegmentationFileAnnotations,
   mergeSegmentationForSave,
   importSegmentationJson,
   importSegmentationFromCoco,
} from "./segmentationIO";
import { humanizeServerText } from "@icicle-ai/tapis-file-explorer";
import {
   type AnnotatorConfig,
   fetchAnnotatorConfigs,
   fetchPipeline,
   fetchIsAdmin,
   createAnnotatorConfig,
   updateAnnotatorConfig,
   fetchAnnotationFileText,
   saveAnnotationFile,
   type SaveAnnotationResult,
} from "./backendClient";

/**
 * Turns a failed save into something the user can act on. The common case is a
 * 403: Tapis accepted the request but the user has no write access to that
 * directory, which no amount of retrying will fix — they need to be told to pick
 * somewhere else. Saying only "failed to save" sends people back to re-check a
 * path that was never the problem.
 */
function describeSaveFailure(result: SaveAnnotationResult, dir: string, system: string): string {
   // The backend forwards Tapis's raw error body, which is a JSON envelope around
   // a Java stack trace. Shown as-is it is unreadable; reduce it to its sentence,
   // or drop it entirely when there is nothing human in there.
   const detail = humanizeServerText(result.detail);
   const suffix = detail ? `\n\nServer said: ${detail}` : "";

   switch (result.status) {
      case 403:
         return (
            `You do not have permission to save here:\n\n` +
            `    ${dir}\n    on ${system}\n\n` +
            `Your account can read this system but cannot write to that folder. ` +
            `Use "Save As" to browse to a folder you own, or ask the system's ` +
            `owner for write access.${suffix}`
         );
      case 401:
         return (
            `Your session is no longer valid, so the annotations were not saved. ` +
            `Sign in again and retry — your work is still here in the browser.${suffix}`
         );
      case 404:
         return (
            `That folder does not exist on ${system}:\n\n    ${dir}\n\n` +
            `Check the path, or use "Save As" to browse to an existing folder.${suffix}`
         );
      case 507:
         return `There is not enough space left on ${system} to save the annotations.${suffix}`;
      default:
         return (
            `Could not save the annotations to ${dir} on ${system}` +
            (result.status ? ` (HTTP ${result.status})` : " — the server could not be reached") +
            `.${suffix}`
         );
   }
}

/** What an import produced, for the summary shown afterwards. */
interface ImportOutcome {
   ok: boolean;
   /**
    * Totals read from the FILE, not from what happened to match. An import is not
    * smaller because some of its images live in folders that are not open yet —
    * reporting zeroes there made a perfectly good file look like it had failed.
    */
   images: number;
   annotations: number;
   labels: string[];
   /** How much of the above is live on the images currently loaded. */
   appliedImages: number;
   appliedAnnotations: number;
   /** Set when nothing could be imported at all. */
   error?: string;
   /** Set when the file looks like the other format. */
   formatHint?: string;
   /** A couple of image paths as written in the file, for diagnosing a non-match. */
   samplePathsInFile?: string[];
   /** A couple of image paths the explorer has actually loaded. */
   sampleLoadedPaths?: string[];
   /**
    * Full paths of the folders holding the images that did not match. Opening
    * these in the File Explorer is the action that resolves an unmatched import,
    * and without naming them the user has no way to know which of a deep tree of
    * folders to go and open.
    */
   foldersToOpen?: string[];
}

/** First few image paths as spelled inside an annotation document. */
function samplePaths(json: any, isCoco: boolean, limit = 3): string[] {
   const raw: string[] = isCoco
      ? (json?.images ?? []).map((i: any) => i?.file_name)
      : Array.isArray(json?.files)
         ? json.files.map((f: any) => f?.filename)                  // segmentation
         : (json?.annotations ?? []).map((a: any) => a?.image_path); // detection
   return [...new Set(raw.filter((p): p is string => typeof p === "string"))].slice(0, limit);
}

/**
 * Folders the user still needs to open, derived from the entries that matched no
 * loaded image. Returned as full paths so they can be pasted straight into the
 * Source Image Directory field.
 */
function foldersAwaitingLoad(
   json: any,
   isCoco: boolean,
   files: string[],
   srcImgDir: string,
   limit = 5,
): string[] {
   const resolve = buildFileIndexResolver(files, srcImgDir);
   const folders = new Set<string>();
   for (const rel of samplePaths(json, isCoco, Number.MAX_SAFE_INTEGER)) {
      if (resolve(rel) !== undefined) continue;
      const full = joinUnderDir(rel, srcImgDir);
      const slash = full.lastIndexOf("/");
      folders.add(slash > 0 ? full.slice(0, slash) : full);
      if (folders.size >= limit) break;
   }
   return [...folders];
}

const readFileText = (file: Blob): Promise<string> =>
   new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
         const text = e.target?.result;
         typeof text === "string" ? resolve(text) : reject(new Error("file could not be read as text"));
      };
      reader.onerror = () => reject(reader.error ?? new Error("file could not be read"));
      reader.readAsText(file);
   });

/** True when the document carries COCO's distinctive top-level arrays. */
const looksLikeCoco = (json: any): boolean =>
   Array.isArray(json?.images) && Array.isArray(json?.annotations) && Array.isArray(json?.categories);

/** True when the document is the simpler flat-annotation format. */
const looksLikeDefaultJson = (json: any): boolean =>
   Array.isArray(json?.annotations) && json.annotations.some((a: any) => a?.image_path !== undefined);

/** Everything the file contains, independent of which folders happen to be open. */
function fileTotals(json: any, isCoco: boolean, isSegmentation: boolean) {
   const labels = new Set<string>();
   let images = 0;
   let annotations = 0;

   if (isCoco) {
      images = new Set((json?.images ?? []).map((i: any) => i?.file_name).filter(Boolean)).size;
      const categoryName = new Map((json?.categories ?? []).map((c: any) => [c?.id, c?.name]));
      for (const a of json?.annotations ?? []) {
         annotations++;
         const name = categoryName.get(a?.category_id);
         if (typeof name === "string") labels.add(name);
      }
   } else if (isSegmentation) {
      const entries = json?.files ?? [];
      images = new Set(entries.map((f: any) => f?.filename).filter(Boolean)).size;
      for (const f of entries) {
         for (const m of f?.masks ?? []) {
            annotations++;
            if (m?.label) labels.add(m.label);
         }
      }
   } else {
      const entries = json?.annotations ?? [];
      images = new Set(entries.map((a: any) => a?.image_path).filter(Boolean)).size;
      for (const a of entries) {
         annotations++;
         if (a?.class) labels.add(a.class);
      }
   }
   return { images, annotations, labels: [...labels].sort() };
}

/** How much of the file is live on the images currently loaded. */
function appliedTotals(
   applied: Map<string, { annotations?: Array<unknown>; masks?: Array<unknown> }>,
): { appliedImages: number; appliedAnnotations: number } {
   let appliedAnnotations = 0;
   applied.forEach((fa) => { appliedAnnotations += (fa.annotations ?? fa.masks ?? []).length; });
   return { appliedImages: applied.size, appliedAnnotations };
}

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
   // Label armed in the details panel: new annotations take it without prompting.
   const [activeDrawLabel, setActiveDrawLabel] = useState<string | null>(null);
   // Asks the canvas to pan an annotation into the middle of the view. Only raised
   // for selections made in the details panel — selecting on the canvas already
   // has the user looking at the right place, and moving the view then would be
   // disorienting. The reverse direction (canvas -> list) is handled by the
   // details panel, which scrolls its own selected row into view.
   const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
   const focusNonce = useRef(0);
   const requestCanvasFocus = (id?: string) => {
      if (id) setFocusRequest({ id, nonce: ++focusNonce.current });
   };
   const [isDemo, setIsDemo] = useState(false);
   const [isAdmin, setIsAdmin] = useState(false);
   const [isConfigLoading, setIsConfigLoading] = useState(true);
   const [isAnnotationsLoading, setIsAnnotationsLoading] = useState(false);
   const [isImageLoading, setIsImageLoading] = useState(false);
   // True between the explorer telling us which file was picked and the image
   // bytes arriving. The previous image stays on screen during that gap, so
   // without this there is nothing to say a new one is coming.
   const [isImageFetching, setIsImageFetching] = useState(false);
   // Result of the most recent import, shown until dismissed.
   const [importSummary, setImportSummary] = useState<ImportOutcome | null>(null);
   const annotationsAutoLoaded = useRef(false);
   /**
    * Set as soon as the user starts an import of their own.
    *
    * The automatic load of the configured annotation file retries with backoff, so
    * it can still be in flight several seconds after the page settles. Its
    * continuation replaces annotations per image path, so a file imported during
    * that window was silently overwritten the moment the slow fetch landed — the
    * import appeared to work and then simply undid itself.
    */
   const userImportedRef = useRef(false);
   const firstImageLoadedRef = useRef(false);
   // Stores the parsed annotation JSON after auto-load so we can apply it to
   // files that arrive later (subfolder navigation grows the file list after
   // the one-shot auto-load has already run).
   /**
    * Every annotation document brought into this session, oldest first.
    *
    * It used to be a single slot, so importing a second file threw the first
    * away. That silently destroyed data on save: the file loaded when the
    * pipeline opened is the only record of annotations for folders the user
    * never visits, and saving rebuilds the whole document from the baseline
    * plus live edits. Importing one folder's annotations therefore wiped every
    * other folder's out of the saved file.
    *
    * Later layers win per image path; live edits win over all of them.
    */
   type AnnotationLayer = { json: any; isCoco: boolean; isSegmentation: boolean };
   const pendingAnnotationDataRef = useRef<AnnotationLayer[]>([]);

   /**
    * Add a document to the stack. A re-import of the same content replaces the
    * layer it duplicates rather than stacking another copy of it, so repeatedly
    * importing one file cannot grow the stack without bound.
    */
   const pushAnnotationLayer = useCallback((layer: AnnotationLayer) => {
      const fingerprint = (l: AnnotationLayer) =>
         `${l.isCoco}|${l.isSegmentation}|${JSON.stringify(l.json)}`;
      const key = fingerprint(layer);
      const kept = pendingAnnotationDataRef.current.filter((l) => fingerprint(l) !== key);
      pendingAnnotationDataRef.current = [...kept, layer];
   }, []);

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

   // Per-file annotation summary for the explorer's badges and filters. Derived
   // from the same maps the canvas reads, so a box added or flagged right now is
   // reflected beside the filename immediately.
   const fileStats = useMemo(() => {
      const stats = new Map<string, FileAnnotationStat>();
      const record = (path: string, items: Array<{ label?: string; flag?: string }>) => {
         if (items.length === 0) return;
         stats.set(path, {
            count: items.length,
            flagged: items.some((i) => Boolean(i.flag)),
            labels: [...new Set(items.map((i) => i.label).filter(Boolean) as string[])],
            flags: [...new Set(items.map((i) => i.flag).filter(Boolean) as string[])],
         });
      };
      if (isSegmentation) {
         fileToMasksMap.forEach((fa, path) => record(path, fa.masks));
      } else {
         fileToAnnotationsMap.forEach((fa, path) => record(path, fa.annotations));
      }
      return stats;
   }, [isSegmentation, fileToAnnotationsMap, fileToMasksMap]);

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
      // Older configs have no annotationSystem; those files sit on the image system.
      const annotationSystem = annotatorConfig?.annotationSystem || annotatorConfig?.system;
      if (
         annotationsAutoLoaded.current ||
         files.length === 0 ||
         !annotatorConfig?.annotationFilePath ||
         !annotationSystem ||
         !tapisToken
      ) return;
      annotationsAutoLoaded.current = true;
      setIsAnnotationsLoading(true);
      // Retry with backoff — the first /get_file hit regularly fails while the
      // backend/Tapis is cold and image prefetches saturate the connection pool.
      fetchAnnotationFileText(pipeid, annotationSystem, annotatorConfig.annotationFilePath, tapisToken)
         .then((text) => {
            // The user imported their own file while this was in flight. Theirs wins.
            if (userImportedRef.current) {
               console.info("Skipping the configured annotation file: a file was imported manually.");
               return;
            }
            let parsed: any;
            try { parsed = JSON.parse(text); } catch { throw new Error("annotation file is not valid JSON"); }
            // The file's own shape decides the format. The stored fileType is only a
            // hint, and when the two disagreed the import bailed out silently and
            // every annotation vanished with nothing said — which is what happens
            // after saving in a new format if the config write does not land.
            const isCoco = looksLikeCoco(parsed)
               ? true
               : looksLikeDefaultJson(parsed) || (isSegmentation && Array.isArray(parsed?.files))
                  ? false
                  : annotatorConfig.fileType === "coco";
            if (!isSegmentation && isCoco !== (annotatorConfig.fileType === "coco")) {
               console.warn(
                  `Annotation file at ${annotatorConfig.annotationFilePath} is ${isCoco ? "COCO" : "default"} JSON, ` +
                  `but the pipeline has it recorded as ${annotatorConfig.fileType}. Using the file's actual format.`
               );
            }
            pushAnnotationLayer({ json: parsed, isCoco, isSegmentation });
            const file = new File([text], "annotations.json", { type: "application/json" });
            if (isSegmentation) {
               importSegmentationAnnotationsFromJson(file, false);
            } else {
               // `isCoco` above was detected from the file itself, not the stored
               // fileType, so a config that disagrees with the file no longer
               // silently discards every annotation.
               importDetectionAnnotationsFromJson(file, isCoco, false);
            }
         })
         .catch((e) => {
            console.error("Failed to auto-load annotations:", e);
            if (userImportedRef.current) return;   // the user supplied their own
            // Un-burn the one-shot flag so a later files/config change retries,
            // instead of a transient failure silently skipping the saved
            // annotations for the whole session.
            annotationsAutoLoaded.current = false;
            alert("Failed to load saved annotations. Reload the page to retry.");
         })
         .finally(() => setIsAnnotationsLoading(false));
   }, [files, annotatorConfig, isSegmentation, pipeid, tapisToken]);

   // Re-apply stored annotations whenever the file list grows (subfolder navigation).
   // Only fills entries not already present — never overwrites live user edits.
   /** Fill in annotations from one imported document for files now known. */
   const applyLayer = (data: AnnotationLayer, srcDir: string) => {
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
   };

   // Re-apply stored annotations whenever the file list grows (subfolder
   // navigation). Only fills entries not already present — never overwrites live
   // user edits. srcImgDir participates in path matching, so a config arriving
   // after the files must re-run this fill.
   useEffect(() => {
      const layers = pendingAnnotationDataRef.current;
      if (layers.length === 0 || files.length === 0) return;
      const srcDir = annotatorConfig?.srcImgDir ?? "";
      // Newest first: each layer only claims paths nothing has claimed yet, so a
      // later import still takes precedence over an earlier one, and live edits
      // (already in the map) are never overwritten by either.
      for (const data of [...layers].reverse()) applyLayer(data, srcDir);
   }, [files, annotatorConfig?.srcImgDir]);

   // ────────────────────────────────────────────────────────────────────────
   // Config upsert
   // ────────────────────────────────────────────────────────────────────────

   /**
    * Records which annotation format is in play, so the Save As dialog opens on it.
    * Only updates an existing config — importing a file is not a reason to create
    * one, and a half-populated config would confuse the auto-load on next visit.
    */
   const rememberFileType = (coco: boolean) => {
      const fileType = coco ? "coco" : "default";
      if (!annotatorConfig?.id || annotatorConfig.fileType === fileType) return;
      upsertAnnotatorConfig({ fileType });
   };

   const upsertAnnotatorConfig = async (updates: Partial<AnnotatorConfig>) => {
      if (!tapisToken || (isDemo && !isAdmin)) return;
      if (annotatorConfig?.id) {
         await updateAnnotatorConfig(annotatorConfig.id, updates, tapisToken);
         setAnnotatorConfig((prev) => prev ? { ...prev, ...updates } : null);
      } else {
         const payload = { system: "", srcImgDir: "", annotationFilePath: "", fileType: "default", annotationSystem: "", ...updates };
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
         setIsImageFetching(false);
      } else {
         // Path-only notification: the explorer has started fetching the image.
         setIsImageFetching(true);
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

   // Resolves to true when the file was actually written (or downloaded), so the
   // toolbar can tell a real save from a refused one and not repoint the
   // annotator config at a file that was never created.
   const generateDetectionJson = async (coco: boolean, save: boolean, dir: string, sys: string): Promise<boolean> => {
      const updatedMap = updateDetectionMapForCurrentFile();
      const srcDir = annotatorConfig?.srcImgDir ?? "";
      // Key live annotations by path relative to srcImgDir, then overlay them on
      // the originally-imported dataset so annotations for folders that were never
      // opened this session aren't dropped from the saved file.
      const liveRel = new Map<string, FileAnnotations>();
      updatedMap.forEach((fa, fullPath) => liveRel.set(toRelativeFilename(fullPath, srcDir), fa));
      // Every detection document seen this session, oldest first, so folders the
      // user never opened keep their annotations in the saved file.
      const baselines = pendingAnnotationDataRef.current.filter((l) => !l.isSegmentation);
      const json = mergeDetectionForSave(liveRel, baselines, srcDir, coco, files);
      if (save && dir) {
         if (isDemo) { alert("Demo mode: Saving is disabled."); return false; }
         return saveAnnotationFile(sys, dir, JSON.stringify(json, null, 2), tapisToken)
            .then((result) => {
               if (result.ok) {
                  alert(`Annotations saved successfully to ${dir}`);
                  return true;
               }
               console.error("Failed to save annotations:", result);
               alert(describeSaveFailure(result, dir, sys));
               return false;
            });
      } else {
         downloadFile(JSON.stringify(json, null, 2), coco ? "annotations.coco.json" : "annotations.json");
      }
      return true;
   };

   /**
    * @param announce  Show the result dialog. False for the automatic load that
    *   happens when a pipeline is opened — that is not something the user asked
    *   for, and popping a summary over it every time would be noise.
    */
   const importDetectionAnnotationsFromJson = async (
      file: File | Blob,
      coco: boolean,
      announce = true,
   ): Promise<void> => {
      if (!(file instanceof Blob)) return;
      // Claimed before any awaiting, so a slow automatic load already in flight
      // cannot land on top of this import.
      if (announce) userImportedRef.current = true;
      try {
         const parsed = JSON.parse(await readFileText(file));

         // Picking the wrong format in the dialog used to "succeed" and produce
         // annotations with undefined labels, which is far worse than refusing.
         if (coco && !looksLikeCoco(parsed) && looksLikeDefaultJson(parsed)) {
            if (!announce) console.error("Automatic load aborted: expected COCO, file is default JSON.");
            if (announce) setImportSummary({
               ok: false, images: 0, annotations: 0, labels: [], appliedImages: 0, appliedAnnotations: 0,
               error: "This file is not in COCO format.",
               formatHint: "It looks like the simpler Default JSON format — reopen Import and choose Default JSON.",
            });
            return;
         }
         if (!coco && !looksLikeDefaultJson(parsed) && looksLikeCoco(parsed)) {
            if (!announce) console.error("Automatic load aborted: expected default JSON, file is COCO.");
            if (announce) setImportSummary({
               ok: false, images: 0, annotations: 0, labels: [], appliedImages: 0, appliedAnnotations: 0,
               error: "This file is not in Default JSON format.",
               formatHint: "It looks like COCO — reopen Import and choose COCO JSON.",
            });
            return;
         }
         if (!Array.isArray(parsed?.annotations)) {
            if (announce) setImportSummary({
               ok: false, images: 0, annotations: 0, labels: [], appliedImages: 0, appliedAnnotations: 0,
               error: "This file has no \"annotations\" list, so there is nothing to import.",
            });
            return;
         }

         // Keep a copy so the re-apply effect can match newly-discovered files later.
         pushAnnotationLayer({ json: parsed, isCoco: coco, isSegmentation: false });
         // Remember the format so Save As opens on the one actually in use.
         // Previously only an explicit save recorded this, so a session that
         // imported COCO was still offered "Default JSON" by default.
         rememberFileType(coco);
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
         const stats = { ...fileTotals(parsed, coco, false), ...appliedTotals(importedMap) };
         if (announce) setImportSummary({
            ok: true,
            ...stats,
            // Only gathered when nothing landed, which is the only time it is shown.
            // Gathered whenever anything failed to match, not only on a total miss:
            // a partially-applied import leaves the rest just as stranded.
            ...(stats.appliedAnnotations < stats.annotations || stats.annotations === 0
               ? {
                    samplePathsInFile: samplePaths(parsed, coco),
                    sampleLoadedPaths: files.slice(0, 3),
                    foldersToOpen: foldersAwaitingLoad(parsed, coco, files, srcDir),
                 }
               : {}),
         });
      } catch (e) {
         console.error("Failed to import detection annotations:", e);
         if (announce) setImportSummary({
            ok: false, images: 0, annotations: 0, labels: [], appliedImages: 0, appliedAnnotations: 0,
            error: e instanceof SyntaxError
               ? "That file is not valid JSON, so it could not be read."
               : `The file could not be read: ${e instanceof Error ? e.message : String(e)}`,
         });
      }
   };

   // ────────────────────────────────────────────────────────────────────────
   // Segmentation helpers
   // ────────────────────────────────────────────────────────────────────────

   // The map always holds the latest masks (edits write straight into it),
   // so exporting needs no flush step.
   const updateSegmentationMapForCurrentFile = () => fileToMasksMap;

   // Resolves to true when the file was actually written (or downloaded), so the
   // toolbar can tell a real save from a refused one and not repoint the
   // annotator config at a file that was never created.
   const generateSegmentationJson = async (coco: boolean, save: boolean, dir: string, sys: string): Promise<boolean> => {
      const updatedMap = updateSegmentationMapForCurrentFile();
      const srcDir = annotatorConfig?.srcImgDir ?? "";
      // Overlay live masks on the imported baseline so masks for folders that were
      // never opened this session aren't dropped from the saved file.
      const liveRel = new Map<string, SegmentationFileAnnotations>();
      updatedMap.forEach((fa, fullPath) => liveRel.set(toRelativeFilename(fullPath, srcDir), fa));
      const baselines = pendingAnnotationDataRef.current.filter((l) => l.isSegmentation);
      const json = mergeSegmentationForSave(liveRel, baselines, srcDir, coco, files);
      if (save && dir) {
         if (isDemo) { alert("Demo mode: Saving is disabled."); return false; }
         return saveAnnotationFile(sys, dir, JSON.stringify(json, null, 2), tapisToken)
            .then((result) => {
               if (result.ok) {
                  alert(`Segmentation saved successfully to ${dir}`);
                  return true;
               }
               console.error("Failed to save segmentation:", result);
               alert(describeSaveFailure(result, dir, sys));
               return false;
            });
      } else {
         downloadFile(JSON.stringify(json, null, 2), coco ? "segmentation.coco.json" : "segmentation.json");
      }
      return true;
   };

   const importSegmentationAnnotationsFromJson = async (
      file: File | Blob,
      announce = true,
   ): Promise<void> => {
      if (!(file instanceof Blob)) return;
      // Claimed before any awaiting, so a slow automatic load already in flight
      // cannot land on top of this import.
      if (announce) userImportedRef.current = true;
      try {
         const parsed = JSON.parse(await readFileText(file));
         const isCoco = Array.isArray(parsed?.images) && Array.isArray(parsed?.annotations);
         // Masks arrive either as COCO annotations or as this app's own
         // { files: [{ masks: [...] }] } shape; anything else has nothing to read.
         if (!isCoco && !Array.isArray(parsed?.files)) {
            if (announce) setImportSummary({
               ok: false, images: 0, annotations: 0, labels: [], appliedImages: 0, appliedAnnotations: 0,
               error: "This file contains no segmentation masks, so there is nothing to import.",
            });
            return;
         }

         // Keep a copy so the re-apply effect can match newly-discovered files later.
         pushAnnotationLayer({ json: parsed, isCoco, isSegmentation: true });
         rememberFileType(isCoco);
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
         const segStats = { ...fileTotals(parsed, isCoco, true), ...appliedTotals(importedMap as any) };
         if (announce) setImportSummary({
            ok: true,
            ...segStats,
            ...(segStats.appliedAnnotations < segStats.annotations || segStats.annotations === 0
               ? {
                    samplePathsInFile: samplePaths(parsed, isCoco),
                    sampleLoadedPaths: files.slice(0, 3),
                    foldersToOpen: foldersAwaitingLoad(parsed, isCoco, files, srcDir),
                 }
               : {}),
         });
      } catch (e) {
         console.error("Failed to import segmentation annotations:", e);
         if (announce) setImportSummary({
            ok: false, images: 0, annotations: 0, labels: [], appliedImages: 0, appliedAnnotations: 0,
            error: e instanceof SyntaxError
               ? "That file is not valid JSON, so it could not be read."
               : `The file could not be read: ${e instanceof Error ? e.message : String(e)}`,
         });
      }
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
      setIsImageFetching(false);
      if (!firstImageLoadedRef.current) { firstImageLoadedRef.current = true; setIsImageLoading(false); }
   };

   /**
    * What the middle of the screen should say while nothing is drawable yet.
    * Opening a pipeline kicks off a chain — config, then the directory listing,
    * then the first image — and every step of it used to look identical to
    * "nothing selected", so the app appeared to be doing nothing for seconds.
    */
   const canvasBusyMessage: string | null = isConfigLoading
      ? "Loading your configuration…"
      : annotatorConfig?.srcImgDir && files.length === 0
         ? `Loading images from ${annotatorConfig.srcImgDir}…`
         : isAnnotationsLoading
            ? "Loading saved annotations…"
            : isImageFetching || isImageLoading
               ? "Loading image…"
               : null;

   /**
    * Draw attention to the File Explorer tab while there is nothing on the canvas.
    * It is a thin strip on the left edge and people did not realise it was the way
    * in — they would sit watching an empty workspace while their images loaded.
    * Stops as soon as the drawer is open or an image is showing.
    */
   const hintFileExplorer = !openFileExplorer && !selectedFile;

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
           onSelectedBoxChange: (id: string) => { setSelectedMaskId(id); requestCanvasFocus(id); },
           onSelectedBoxIdsChange: (ids: string[]) => { setSelectedMaskIds(ids); if (ids.length > 0) setSelectedMaskId(undefined); },
           onAnnotationUpdate: handleMaskUpdate,
           deleteAnnotations: deleteMasks,
           handleFilterAnnotations,
           activeDrawLabel,
           onActiveDrawLabelChange: setActiveDrawLabel,
           imageKey: selectedFilePath,
        }
      : {
           annotations: boundingBoxes,
           selectedBoxId,
           selectedBoxIds,
           onSelectedBoxChange: (id: string) => { setSelectedBoxId(id); requestCanvasFocus(id); },
           onSelectedBoxIdsChange: (ids: string[]) => { setSelectedBoxIds(ids); if (ids.length > 0) setSelectedBoxId(undefined); },
           onAnnotationUpdate: handleBoundingBoxUpdate,
           deleteAnnotations: deleteBoxes,
           handleFilterAnnotations,
           activeDrawLabel,
           onActiveDrawLabelChange: setActiveDrawLabel,
           imageKey: selectedFilePath,
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

               // Pulse outward from the tab so the eye is pulled to the left edge.
               // Honours the OS "reduce motion" setting, where a steady highlight
               // is used instead of a repeating animation.
               "@keyframes explorerPulse": {
                  "0%":   { boxShadow: "0 0 0 0 rgba(25,118,210,0.55)" },
                  "70%":  { boxShadow: "0 0 0 14px rgba(25,118,210,0)" },
                  "100%": { boxShadow: "0 0 0 0 rgba(25,118,210,0)" },
               },
               ...(hintFileExplorer && {
                  animation: "explorerPulse 1.9s ease-out infinite",
                  borderColor: "primary.main",
                  background: "#e8f1fc",
                  "@media (prefers-reduced-motion: reduce)": {
                     animation: "none",
                     boxShadow: "0 0 0 3px rgba(25,118,210,0.35)",
                  },
               }),
            }}
         >
            File Explorer
         </Button>

         {/* One-line nudge beside the pulsing tab, so the animation is explained
             rather than just decorative. */}
         {hintFileExplorer && (
            <Box
               sx={{
                  position: "fixed",
                  top: 126,
                  left: 34,
                  zIndex: (theme) => theme.zIndex.drawer + 1,
                  pointerEvents: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                  px: 1.25,
                  py: 0.5,
                  borderRadius: "999px",
                  bgcolor: "rgba(25,118,210,0.94)",
                  color: "#fff",
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  boxShadow: 3,
                  "@keyframes explorerHintIn": {
                     from: { opacity: 0, transform: "translateX(-6px)" },
                     to:   { opacity: 1, transform: "translateX(0)" },
                  },
                  animation: "explorerHintIn 0.35s ease-out both",
               }}
            >
               <ArrowBackIcon sx={{ fontSize: "0.9rem" }} />
               {canvasBusyMessage ? "Loading images — open to browse" : "Open the File Explorer to pick an image"}
            </Box>
         )}

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
               fileStats={fileStats}
               fileDir={annotatorConfig?.srcImgDir}
               parentSystem={annotatorConfig?.system}
               onDirectorySubmit={(!isDemo || isAdmin) ? (srcImgDir, sys) => {
                  // The per-file maps are keyed by the old root's paths, so they go.
                  // Displayed annotations are derived from them, which clears the canvas.
                  setFileToAnnotationsMap(new Map());
                  setFileToMasksMap(new Map());
                  setSelectedBoxId(undefined);
                  setSelectedMaskId(undefined);
                  setSelectedFile(null);
                  setSelectedFilePath(null);

                  // An imported annotation file is NOT discarded here. One file
                  // routinely covers several sibling folders, and pointing the
                  // explorer at the next one is exactly how a user reaches the rest
                  // of it — throwing the import away at that moment silently lost
                  // everything they had just loaded. It is re-matched against the
                  // new root by the re-apply effect below.
                  //
                  // The configured file's one-shot auto-load is only re-armed when
                  // nothing is pending, so it cannot overwrite that fresh import.
                  annotationsAutoLoaded.current = pendingAnnotationDataRef.current.length > 0;
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
            onAnnotationSaved={(filePath, isCoco, savedSystem) => {
               // Saving wrote the file from in-memory state, which is now the source
               // of truth. Mark auto-load done so this config change doesn't re-trigger
               // the auto-load effect (which would re-import and merge the just-saved
               // file back in, duplicating or dropping annotations).
               annotationsAutoLoaded.current = true;
               // The system is recorded alongside the path. Without it the file was
               // read back from whichever system the images are on, which is not
               // necessarily where it was written.
               upsertAnnotatorConfig({
                  annotationFilePath: filePath,
                  fileType: isCoco ? "coco" : "default",
                  annotationSystem: savedSystem,
               });
            }}
            annotationFilePath={annotatorConfig?.annotationFilePath}
            annotationSystem={annotatorConfig?.annotationSystem || annotatorConfig?.system}
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
            <Grid size={9} sx={{ position: "relative" }}>
               {/* Centred progress. Overlays the canvas when one is already shown
                   so switching images is visibly in progress, and fills the empty
                   column during the initial load. */}
               {canvasBusyMessage && (
                  <Box
                     sx={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 5,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 2,
                        pointerEvents: "none",
                        backgroundColor: selectedFile ? "rgba(255,255,255,0.6)" : "transparent",
                     }}
                  >
                     <CircularProgress size={52} thickness={4} />
                     <Typography variant="body1" sx={{ color: "text.secondary", fontWeight: 500, textAlign: "center", px: 2 }}>
                        {canvasBusyMessage}
                     </Typography>
                  </Box>
               )}
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
                     defaultLabel={activeDrawLabel ?? undefined}
                     focusRequest={focusRequest}
                  />
               ) : canvasBusyMessage ? (
                  // The overlay above is already showing progress; keep the column
                  // reserved so it does not collapse to zero height.
                  <Box sx={{ width: "100%", minHeight: "60vh" }} />
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

         {/* ── Import result ──
             An import used to finish in silence: the dialog closed and the user
             had to go hunting through images to tell whether anything landed. ── */}
         <Dialog
            open={Boolean(importSummary)}
            onClose={() => setImportSummary(null)}
            maxWidth="xs"
            fullWidth
         >
            <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
               {/* A file that parsed but matched nothing is not a success — saying
                   "imported" with a tick over three zeros reads as a lie. */}
               {!importSummary?.ok
                  ? <ErrorOutlineIcon color="error" />
                  : importSummary.annotations === 0
                     ? <WarningAmberIcon color="warning" />
                     : <CheckCircleOutlineIcon color="success" />}
               {!importSummary?.ok
                  ? "Import failed"
                  : importSummary.annotations === 0
                     ? "Nothing to import"
                     : isSegmentation ? "Masks imported" : "Annotations imported"}
            </DialogTitle>
            <DialogContent>
               {importSummary?.ok ? (
                  <>
                     <Box sx={{ display: "flex", gap: 1.5, mb: 2 }}>
                        {([
                           ["Images", importSummary.images],
                           [isSegmentation ? "Masks" : "Annotations", importSummary.annotations],
                           ["Labels", importSummary.labels.length],
                        ] as const).map(([caption, value]) => (
                           <Box
                              key={caption}
                              sx={{
                                 flex: 1, textAlign: "center", py: 1.25, borderRadius: 1.5,
                                 bgcolor: "action.hover", border: "1px solid", borderColor: "divider",
                              }}
                           >
                              <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.1 }}>{value}</Typography>
                              <Typography variant="caption" sx={{ color: "text.secondary" }}>{caption}</Typography>
                           </Box>
                        ))}
                     </Box>

                     {importSummary.labels.length > 0 && (
                        <>
                           <Typography variant="caption" sx={{ display: "block", mb: 0.75, color: "text.secondary", fontWeight: 700 }}>
                              Label names
                           </Typography>
                           <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1 }}>
                              {importSummary.labels.map((l) => (
                                 <Chip key={l} label={l} size="small" sx={{ fontWeight: 600 }} />
                              ))}
                           </Box>
                        </>
                     )}

                     {importSummary.foldersToOpen && importSummary.foldersToOpen.length > 0 && (
                        <Alert severity="info" sx={{ mt: 1.5 }}>
                           <Typography variant="body2" sx={{ mb: 0.75 }}>
                              Open {importSummary.foldersToOpen.length === 1 ? "this folder" : "these folders"} in
                              the File Explorer and the remaining annotations will be applied:
                           </Typography>
                           <Box sx={{ fontFamily: "monospace", fontSize: "0.7rem", lineHeight: 1.7 }}>
                              {importSummary.foldersToOpen.map((f) => (
                                 <Box key={f} sx={{ wordBreak: "break-all" }}>{f}</Box>
                              ))}
                           </Box>
                        </Alert>
                     )}

                     {importSummary.appliedAnnotations === 0 && (
                        <Alert severity={importSummary.annotations === 0 ? "warning" : "info"} sx={{ mt: 1 }}>
                           <Typography variant="body2" sx={{ mb: 1 }}>
                              {importSummary.annotations === 0
                                 ? "This file contains no annotations."
                                 : "None of them are on the images you have open yet. The paths in the " +
                                   "file are relative to the source image directory, so they have to " +
                                   "line up folder for folder with what is loaded — compare the two below."}
                           </Typography>
                           {/* Both sides of the comparison, so the mismatch can be seen
                               rather than guessed at. */}
                           <Box sx={{ fontFamily: "monospace", fontSize: "0.7rem", lineHeight: 1.6 }}>
                              <Box sx={{ fontWeight: 700 }}>Paths in the file:</Box>
                              {(importSummary.samplePathsInFile?.length
                                 ? importSummary.samplePathsInFile
                                 : ["(none found)"]
                              ).map((p) => <Box key={p} sx={{ wordBreak: "break-all" }}>{p}</Box>)}
                              <Box sx={{ fontWeight: 700, mt: 0.75 }}>Images loaded:</Box>
                              {(importSummary.sampleLoadedPaths?.length
                                 ? importSummary.sampleLoadedPaths
                                 : ["(none — open a folder containing images first)"]
                              ).map((p) => <Box key={p} sx={{ wordBreak: "break-all" }}>{p}</Box>)}
                           </Box>
                        </Alert>
                     )}

                     {importSummary.annotations > 0 && (
                        <>
                           <Divider sx={{ my: 1.5 }} />
                           <Typography variant="body2" sx={{ color: "text.secondary" }}>
                              {importSummary.appliedAnnotations === importSummary.annotations
                                 ? "All of them are on images you have open."
                                 : `${importSummary.appliedAnnotations} of ${importSummary.annotations} ` +
                                   `${importSummary.annotations === 1 ? "is" : "are"} on images you have open. ` +
                                   `The rest are held and applied automatically as you open the folders holding them — ` +
                                   `nothing is lost, and saving keeps them all.`}
                           </Typography>
                        </>
                     )}
                  </>
               ) : (
                  <>
                     <Typography variant="body2">{importSummary?.error}</Typography>
                     {importSummary?.formatHint && (
                        <Alert severity="info" sx={{ mt: 1.5 }}>{importSummary.formatHint}</Alert>
                     )}
                  </>
               )}
            </DialogContent>
            <DialogActions>
               <Button variant="contained" onClick={() => setImportSummary(null)}>Close</Button>
            </DialogActions>
         </Dialog>
      </>
   );
};

export default ImageAnnotator;
