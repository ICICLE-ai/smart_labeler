// App-specific annotator helpers.
//
// The reusable half of this module — the COCO/default-JSON import and export, the
// path-relativisation used to key annotations across nested directories, the
// colour palette, and NMS — now lives in the @icicle-ai/* packages and is
// re-exported below so existing import sites keep working. What remains here is
// genuinely specific to this app: the object-detection pipeline's step list, its
// query-image configuration shape, and the MUI charts it renders.
import type { Annotation } from "@icicle-ai/image-annotation-canvas";
import { getLabelColor } from "@icicle-ai/image-annotation-canvas";
import { exportToCoco, exportToDefaultJson, downloadFile, type FileAnnotations } from "@icicle-ai/image-annotator";
import { calculateIoU } from "@icicle-ai/annotation-details";
import { LineChart } from '@mui/x-charts/LineChart';
import React from 'react';
import { saveFile } from "~/utils/utils";

// Re-exports of the packaged helpers, kept so route-level imports of this module
// do not have to change. Prefer importing these straight from the package.
export {
   MAX_SCALE,
   SAM3_MODES,
   LABEL_PALETTE,
   getLabelColor,
} from "@icicle-ai/image-annotation-canvas";
export {
   toRelativeFilename,
   normalizeRelKey,
   buildFileIndexResolver,
   exportToCoco,
   exportToDefaultJson,
   joinUnderDir,
   detectionJsonToRelMap,
   mergeDetectionForSave,
   importFromCocoJsonUtil,
   importFromDefaultJsonUtil,
   downloadFile,
} from "@icicle-ai/image-annotator";
export type { FileAnnotations } from "@icicle-ai/image-annotator";
export { applyNMS, calculateIoU } from "@icicle-ai/annotation-details";

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

export const systems = [
   { 'label': 'pitzer-tapis', 'value': 'pitzer-tapis' },
   { 'label': 'expanse-tapis', 'value': 'expanse-tapis' },
   { 'label': 'ascend-tapis', 'value': 'ascend-tapis' },
   { 'label': 'cardinal-tapis', 'value': 'cardinal-tapis' },
];

export const DISPLAY_TYPE = ['IMAGE', 'GRAPH'];

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
