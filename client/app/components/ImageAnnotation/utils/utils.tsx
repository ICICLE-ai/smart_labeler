import type { Annotation } from "../canvas/ImageCanvas";
import { LineChart } from '@mui/x-charts/LineChart';
import React from 'react';
import { saveFile } from "~/utils/utils";

export const MAX_SCALE = 8

export interface QueryImageConfiguration {
   id: number;
   name?: string;
   queryImagePath: string;
   objectnessThreshold: number;
   similarityThreshold: number;
   nmsIoUThreshold: number;
   method: string;
   device: string;
   outputDir: string;
   system: string;
   objectnessThresholdJobId?: string;
   detectionJobId?: string;
   object_feature_tensor_file_path?: string;
   proposer_ids?: string;
   embedder_ids?: string;
   proposer_models?: string;
   embedder_models?: string;
   is_sahi?: boolean;
   tile_size?: number;
   overlap_ratio?: number;
   batch_size?: number;
   node_count?: number;
   cores_per_node?: number;
   memory_mb?: number;
   max_minutes?: number;
}

// ---------------------------------------------------------------------------
// Colour palette – one colour per unique label, assigned on first encounter.
// ---------------------------------------------------------------------------
export const LABEL_PALETTE = [
   "#1976d2", // blue
   "#388e3c", // green
   "#f57c00", // orange
   "#7b1fa2", // purple
   "#00838f", // teal
   "#558b2f", // olive
   "#6d4c41", // brown
   "#ad1457", // pink
   "#0277bd", // light-blue
   "#e65100", // deep-orange
   // Red (#c62828) is intentionally excluded – reserved for selection highlighting
];

// Shared label-color resolver – assigns a stable color per unique label string.
// Uses a module-level cache so the same label always gets the same color across
// both ImageCanvas and AnnotationDetails.
export const getLabelColor = (() => {
   const cache = new Map<string, string>();
   let idx = 0;
   return (label: string): string => {
      if (!cache.has(label)) cache.set(label, LABEL_PALETTE[idx++ % LABEL_PALETTE.length]);
      return cache.get(label)!;
   };
})();

export const systems = [
   { 'label': 'pitzer-tapis', 'value': 'pitzer-tapis' },
   { 'label': 'expanse-tapis', 'value': 'expanse-tapis' },
   { 'label': 'ascend-tapis', 'value': 'ascend-tapis' },
   { 'label': 'cardinal-tapis', 'value': 'cardinal-tapis' },
];

export enum SAM3_MODES {
   SINGLE_CLICK = 'SINGLE_CLICK',
   TEXT_PROMPTS = 'TEXT_PROMPTS'
}

export const DISPLAY_TYPE = ['IMAGE', 'GRAPH'];

export interface FileAnnotations {
   name: string;
   annotations: Annotation[];
   width: number;
   height: number;
}

export type Step = {
   id: number;
   label: string;
   status: "READY" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "SKIPPED" | "CONFIGURATION" | "ANNOTATOR";
   url: string;
   jobId?: string;
   selected?: boolean;
};

export const steps: Step[] = [
   {
      id: 1,
      label: "Annotation",
      status: "ANNOTATOR",
      url: "/object-detection/image-annotator",
   },
   {
      id: 2,
      label: "Build Class Supports",
      status: "CONFIGURATION",
      url: "/object-detection/build-class-supports",
   },
   {
      id: 3,
      label: "Optimize Patch Size",
      status: "READY",
      url: "/object-detection/optimize-patch-size",
   },
   {
      id: 4,
      label: "Configure Detection Job",
      status: "CONFIGURATION",
      url: "/object-detection/configure-detection-job",
   },
   {
      id: 5,
      label: "Visualize Proposals",
      status: "READY",
      url: "/object-detection/detection",
   },
   {
      id: 6,
      label: "Configure Classification Job",
      status: "CONFIGURATION",
      url: "/object-detection/configure-classification",
   },
   {
      id: 7,
      label: "Object Classification",
      status: "READY",
      url: "/object-detection/classification",
   },
];

// Convert a full Tapis path to a path relative to srcImgDir.
// Falls back to the bare basename when the prefix doesn't match.
export function toRelativeFilename(fullPath: string, srcImgDir: string): string {
   const normDir = srcImgDir.replace(/^\/+/, "").replace(/\/+$/, "");
   const normPath = fullPath.replace(/^\/+/, "");
   if (normDir && normPath.startsWith(normDir + "/")) return normPath.slice(normDir.length + 1);
   const lastSlash = fullPath.lastIndexOf("/");
   return lastSlash >= 0 ? fullPath.slice(lastSlash + 1) : fullPath;
}

export function exportToCoco(
   fileToAnnotationsMap: Map<number, FileAnnotations>,
   files: string[],
   srcImgDir: string = ""
) {
   // --- 1. Initialize COCO Structure ---
   type CocoImage = {
      id: number;
      width: number;
      height: number;
      file_name: string;
   };
   type CocoCategory = { id: number; name: string };
   type CocoAnnotation = {
      id: number;
      image_id: number;
      category_id: number | undefined;
      bbox: [number, number, number, number];
      area: number;
      iscrowd: number;
      flag?: string;
   };

   const coco: {
      info: {
         year: number;
         version: string;
         date_created: string;
      };
      licenses: any[];
      images: CocoImage[];
      categories: CocoCategory[];
      annotations: CocoAnnotation[];
   } = {
      info: {
         year: new Date().getFullYear(),
         version: "1.0",
         date_created: new Date().toISOString(),
      },
      licenses: [],
      images: [],
      categories: [],
      annotations: [],
   };

   // --- 2. Create Categories ---
   const categoryMap = new Map<string, number>();
   let categoryId = 1;

   fileToAnnotationsMap.forEach((fileAnnotations) => {
      fileAnnotations.annotations.forEach((ann) => {
         if (!categoryMap.has(ann.label)) {
            categoryMap.set(ann.label, categoryId);
            coco.categories.push({
               id: categoryId,
               name: ann.label,
            });
            categoryId++;
         }
      });
   });

   // --- 3. Create Images and Annotations ---
   let annotationId = 1; // COCO annotation IDs must be unique across the whole dataset.

   fileToAnnotationsMap.forEach((fileAnnotations, imageIndex) => {
      if (imageIndex < 0) return;
      const file = files[imageIndex];
      const fileName = toRelativeFilename(file, srcImgDir);
      if (!file) {
         console.warn(`Skipping image at index ${imageIndex}: No file found.`);
         return;
      }

      // Since we don't have width/height, set to 0 or extract if available elsewhere
      coco.images.push({
         id: imageIndex,
         width: fileAnnotations.width,
         height: fileAnnotations.height,
         file_name: fileName,
      });

      fileAnnotations.annotations.forEach((ann) => {
         coco.annotations.push({
            id: annotationId++,
            image_id: imageIndex,
            category_id: categoryMap.get(ann.label),
            bbox: [ann.x, ann.y, ann.width, ann.height],
            area: ann.width * ann.height,
            iscrowd: 0,
            ...(ann.flag ? { flag: ann.flag } : {}),
         });
      });
   });

   return coco;
}

export function exportToDefaultJson(
   fileToAnnotationsMap: Map<number, FileAnnotations>,
   files: string[],
   srcImgDir: string = ""
) {
   const annotations: any[] = [];

   fileToAnnotationsMap.forEach((fileAnnotations, imageIndex) => {
      const file = files[imageIndex];
      if (!file) return;

      fileAnnotations.annotations.forEach((ann) => {
         annotations.push({
            image_path: toRelativeFilename(file, srcImgDir),
            class: ann.label,
            bounding_box: [ann.x, ann.y, ann.x + ann.width, ann.y + ann.height],
            score: ann.score,
            ...(ann.flag ? { flag: ann.flag } : {}),
         });
      });
   });

   return { annotations };
}

export function importFromCocoJsonUtil(
   cocoJson: any,
   files: string[]
): Map<number, FileAnnotations> {
   const fileNameToIndex = new Map<string, number>();
   files.forEach((file, idx) => {
      if (typeof file !== "string") return;
      fileNameToIndex.set(file.substring(file.lastIndexOf("/") + 1), idx);
   });

   // Build category id to label map
   const categoryIdToLabel = new Map<number, string>();
   if (Array.isArray(cocoJson.categories)) {
      cocoJson.categories.forEach((cat: any) => {
         categoryIdToLabel.set(cat.id, cat.name);
      });
   }

   // Build image id to file index map.
   // Try exact match first (handles bare basenames), then fall back to the
   // basename of img.file_name so relative paths like "subdir/b.jpg" still resolve.
   const imageIdToFileIndex = new Map<number, number>();
   if (Array.isArray(cocoJson.images)) {
      cocoJson.images.forEach((img: any) => {
         const basename = img.file_name.substring(img.file_name.lastIndexOf("/") + 1);
         const fileIdx = fileNameToIndex.get(img.file_name) ?? fileNameToIndex.get(basename);
         if (fileIdx !== undefined) {
            imageIdToFileIndex.set(img.id, fileIdx);
         }
      });
   }

   // Build fileToAnnotationsMap
   const fileToAnnotationsMap = new Map<number, FileAnnotations>();
   if (Array.isArray(cocoJson.annotations)) {
      cocoJson.annotations.forEach((ann: any) => {
         const fileIdx = imageIdToFileIndex.get(ann.image_id);
         if (fileIdx === undefined) return;
         const label = categoryIdToLabel.get(ann.category_id) || "unknown";
         const [x, y, width, height] = ann.bbox;
         const annotation: Annotation = {
            id: `${Date.now()}-${Math.random()}`,
            label,
            x,
            y,
            width,
            height,
            ...(ann.flag ? { flag: ann.flag } : {}),
         };
         if (!fileToAnnotationsMap.has(fileIdx)) {
            fileToAnnotationsMap.set(fileIdx, {
               name: files[fileIdx],
               width: cocoJson.images.find((img: any) => img.id === ann.image_id)?.width || 0,
               height: cocoJson.images.find((img: any) => img.id === ann.image_id)?.height || 0,
               annotations: [],
            });
         }
         fileToAnnotationsMap.get(fileIdx)!.annotations.push(annotation);
      });
   }

   return fileToAnnotationsMap;
}

export function importFromDefaultJsonUtil(
   defaultJson: any,
   files: string[]
): Map<number, FileAnnotations> {
   const fileNameToIndex = new Map<string, number>();
   files.forEach((file, idx) => {
      if (typeof file !== "string") return;
      fileNameToIndex.set(file.substring(file.lastIndexOf("/") + 1), idx);
   });

   const fileToAnnotationsMap = new Map<number, FileAnnotations>();
   if (Array.isArray(defaultJson.annotations)) {
      defaultJson.annotations.forEach((ann: any) => {
         const fileIdx = fileNameToIndex.get(
            ann.image_path.lastIndexOf("/") == -1 ? ann.image_path : ann.image_path.substring(ann.image_path.lastIndexOf("/") + 1)
         );
         if (fileIdx === undefined) return;
         const annotation: Annotation = {
            id: `${Date.now()}-${Math.random()}`,
            label: ann.class,
            x: ann.bounding_box[0],
            y: ann.bounding_box[1],
            width: ann.bounding_box[2] - ann.bounding_box[0],
            height: ann.bounding_box[3] - ann.bounding_box[1],
            score: ann.score,
            iou: ann.iou,
            ...(ann.flag ? { flag: ann.flag } : {}),
         };
         if (!fileToAnnotationsMap.has(fileIdx)) {
            fileToAnnotationsMap.set(fileIdx, {
               name: files[fileIdx],
               width: 0,
               height: 0,
               annotations: [],
            });
         }
         fileToAnnotationsMap.get(fileIdx)!.annotations.push(annotation);
      });
   }

   return fileToAnnotationsMap;
}

export const generateJson = (filesToAnnotationMap: Map<number, FileAnnotations>, filename: string, files: string[],
   system: string, cookie: any, coco: boolean = false, save: boolean = false, dir: string = "", score: number = 0.0) => {
   // Ensure the latest annotations are saved for the currently selected file
   if (!filesToAnnotationMap) return;
   filesToAnnotationMap.forEach((fileAnnotations, index) => {
      fileAnnotations.annotations = fileAnnotations.annotations.filter((ann) => {
         return ann.score === undefined || ann.score === null || ann.score >= score;
      });
   });
   const json = coco
      ? exportToCoco(filesToAnnotationMap, files)
      : exportToDefaultJson(filesToAnnotationMap, files);
   if (save && dir) {
      const encodedPath = encodeURIComponent(dir);
      saveFile(
         `/save-file/${system}?path=${encodedPath}`,
         JSON.stringify(json, null, 2),
         cookie["tapis-token"]["access_token"]
      );
      // Implement save to directory logic here
      console.log(
         `Saving ${coco ? "COCO" : "Default"} JSON to directory:`,
         dir
      );
   } else {
      downloadFile(
         JSON.stringify(json, null, 2),
         filename || `annotations_${Date.now()}.json`
      );
   }
};

export const downloadFile = async (content: string, fileName: string) => {
   // Chrome/Edge: use the File System Access API for a native Save-As dialog
   if (typeof (window as any).showSaveFilePicker === 'function') {
      try {
         const handle = await (window as any).showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
         });
         const writable = await handle.createWritable();
         await writable.write(content);
         await writable.close();
         return;
      } catch (error: any) {
         if (error.name === 'AbortError') return; // user cancelled — do not fall through
         console.warn('showSaveFilePicker failed:', error);
      }
   }

   // Fallback for Firefox / Safari: prompt the user for a filename, then download
   const userFileName = window.prompt('Save file as:', fileName);
   if (userFileName === null) return; // user cancelled
   const resolvedName = userFileName.trim() || fileName;

   const blob = new Blob([content], { type: 'application/json' });
   const url = URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = url;
   a.download = resolvedName.endsWith('.json') ? resolvedName : `${resolvedName}.json`;
   a.style.display = 'none';
   document.body.appendChild(a);
   a.click();
   document.body.removeChild(a);
   URL.revokeObjectURL(url);
};

export const isImageFile = (filename: string): boolean => {
   const imageExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".tiff",
      ".tif",
      ".gif",
      ".bmp",
      ".webp",
   ];
   return imageExtensions.some((ext) => filename.toLowerCase().endsWith(ext));
};

export const generateClassSupportGraph = (fileToClassSupportsMap: Map<string, Map<number, FileAnnotations>>, imageFileIndex: number) => {
   const chartData: {
      labels: string[];
      datasets: {
         label: string;
         data: (number | null)[];
         fill: boolean;
         borderColor: string;
         tension: number;
      }[];
   } = {
      labels: [],
      datasets: [],
   };

   if (!fileToClassSupportsMap || fileToClassSupportsMap.size === 0) {
      return chartData;
   }

   // Find the maximum number of annotations across all class supports for the given image
   let maxAnnotations = 0;
   fileToClassSupportsMap.forEach((annotationsMap) => {
      const fileAnnotations = annotationsMap.get(imageFileIndex);
      if (fileAnnotations) {
         maxAnnotations = Math.max(maxAnnotations, fileAnnotations.annotations.length);
      }
   });

   // Generate labels for the x-axis (e.g., "Annotation 1", "Annotation 2", ...)
   chartData.labels = Array.from({ length: maxAnnotations }, (_, i) => `Annotation ${i + 1}`);

   const colors = ['#4285F4', '#DB4437', '#F4B400', '#0F9D58', '#AB47BC', '#00ACC1', '#FF7043', '#7E57C2'];
   let colorIndex = 0;

   // Create a dataset for each class support file
   fileToClassSupportsMap.forEach((annotationsMap, fileName) => {
      const fileAnnotations = annotationsMap.get(imageFileIndex);
      const iouData: (number | null)[] = new Array(maxAnnotations).fill(null);

      if (fileAnnotations) {
         // Sort annotations by IoU score in descending order for a smoother-looking graph
         // const sortedAnnotations = [...fileAnnotations.annotations].sort((a, b) => (b.iou ?? 0) - (a.iou ?? 0));
         const annotations = fileAnnotations.annotations || [];
         annotations.forEach((ann, index) => {
            if (ann?.iou !== undefined) {
               iouData[index] = ann.iou;
            }
         });
      }

      chartData.datasets.push({
         label: getCropSize(fileName), // Use file name as label
         data: iouData,
         fill: false,
         borderColor: colors[colorIndex % colors.length],
         tension: 0.1,
      });
      colorIndex++;
   });

   return chartData;
};

export const getCropSize = (filePath: string) => {
   if (!filePath) return "1024";
   const file = filePath.lastIndexOf("/") === -1 ? filePath : filePath.substring(filePath.lastIndexOf("/") + 1);
   const cropSize = file.split("_")[2];
   if (!cropSize) return "1024";
   return cropSize;
};



export const generateObjectnessScoreGraph = (
   fileAnnotations: FileAnnotations | null
): React.ReactElement => {
   if (!fileAnnotations || !fileAnnotations.annotations || fileAnnotations.annotations.length === 0) {
      return (
         <div style={{
            width: '100%',
            height: 400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#666'
         }}>
            No annotations available
         </div>
      );
   }

   const annotations = [...fileAnnotations.annotations].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0)
   );

   const scores = annotations.map((ann) => ann.score ?? 0);
   const xLabels = Array.from(
      { length: annotations.length },
      (_, i) => i + 1 // Change to use index for x-axis
   );

   return (
      <LineChart
         width={1000}
         height={800}
         series={[
            {
               data: scores, // Use scores for the y-axis data
               label: 'Objectness Score',
               color: '#4285F4'
            }
         ]}
         xAxis={[{
            data: xLabels,
            label: 'Annotation Index', // Change label to reflect index
            scaleType: 'point'
         }]}
         yAxis={[{
            label: 'Objectness Score', // Change label to reflect score
            min: 0,
            max: Math.max(...scores) // Set max to the highest score
         }]}
         margin={{ left: 50, right: 50, top: 50, bottom: 50 }}
         grid={{ vertical: true, horizontal: true }}
      />
   );
};

export const generateMultipleIoUScoreGraph = (
   patchSizeTofileAnnotationsArray: Map<string, FileAnnotations | null>
): React.ReactElement => {
   if (!patchSizeTofileAnnotationsArray || patchSizeTofileAnnotationsArray.size === 0) {
      return (
         <div style={{
            width: '100%',
            height: 400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#666'
         }}>
            No annotations available
         </div>
      );
   }

   const colors = ['#4285F4', '#DB4437', '#F4B400', '#0F9D58', '#AB47BC', '#00ACC1', '#FF7043', '#7E57C2'];

   // Find the maximum number of annotations across all FileAnnotations
   let maxAnnotations = 0;
   patchSizeTofileAnnotationsArray.forEach((fileAnnotations) => {
      if (fileAnnotations && fileAnnotations.annotations) {
         maxAnnotations = Math.max(maxAnnotations, fileAnnotations.annotations.length);
      }
   });

   const xLabels = Array.from({ length: maxAnnotations }, (_, i) => i + 1);

   // Create a dataset for each FileAnnotations with patch_size as label
   const series = Array.from(patchSizeTofileAnnotationsArray.entries()).map(([patchSize, fileAnnotations], index) => {
      const iouData: (number | null)[] = new Array(maxAnnotations).fill(null);

      if (fileAnnotations && fileAnnotations.annotations) {
         fileAnnotations.annotations.forEach((ann, annotationIndex) => {
            if (ann?.iou !== undefined) {
               iouData[annotationIndex] = ann.iou;
            }
         });
      }

      return {
         data: iouData,
         label: `patch_size: ${patchSize}`,
         color: colors[index % colors.length]
      };
   });

   return (
      <LineChart
         width={1000}
         height={800}
         series={series}
         xAxis={[{
            data: xLabels,
            label: 'Annotation Index',
            scaleType: 'point'
         }]}
         yAxis={[{
            label: 'IoU Score',
            min: 0,
            max: 1
         }]}
         margin={{ left: 50, right: 50, top: 50, bottom: 50 }}
         grid={{ vertical: true, horizontal: true }}
      />
   );
};

export const calculateIoU = (box1: Annotation, box2: Annotation): number => {
   const x1_min = box1.x;
   const y1_min = box1.y;
   const x1_max = box1.x + box1.width;
   const y1_max = box1.y + box1.height;

   const x2_min = box2.x;
   const y2_min = box2.y;
   const x2_max = box2.x + box2.width;
   const y2_max = box2.y + box2.height;

   const inter_x_min = Math.max(x1_min, x2_min);
   const inter_y_min = Math.max(y1_min, y2_min);
   const inter_x_max = Math.min(x1_max, x2_max);
   const inter_y_max = Math.min(y1_max, y2_max);

   const inter_area = Math.max(0, inter_x_max - inter_x_min) * Math.max(0, inter_y_max - inter_y_min);
   const box1_area = box1.width * box1.height;
   const box2_area = box2.width * box2.height;
   const union_area = box1_area + box2_area - inter_area;

   return union_area > 0 ? inter_area / union_area : 0;
};

export const applyNMS = (boxes: Annotation[], iouThreshold: number = 0.5): string[] => {
   // Sort boxes by score descending
   const sortedBoxes = [...boxes].sort((a, b) => {
      const scoreA = a.score ?? 0;
      const scoreB = b.score ?? 0;
      return scoreB - scoreA;
   });

   const keptBoxIds = new Set<string>();
   const toRemoveIds: string[] = [];

   sortedBoxes.forEach((box) => {
      let shouldKeep = true;

      // Check if this box overlaps with any already-kept box
      for (const keptId of keptBoxIds) {
         const keptBox = boxes.find((b) => b.id === keptId);
         if (!keptBox) continue;

         const iou = calculateIoU(box, keptBox);
         if (iou > iouThreshold) {
            shouldKeep = false;
            break;
         }
      }

      if (shouldKeep) {
         keptBoxIds.add(box.id);
      } else {
         toRemoveIds.push(box.id);
      }
   });

   return toRemoveIds; // Return value can be used to trigger UI updates if needed]
};
