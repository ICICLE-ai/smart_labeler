import type { Annotation } from "@icicle-ai/image-annotation-canvas";

export interface FileAnnotations {
   name: string;
   annotations: Annotation[];
   width: number;
   height: number;
}

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

   let annotationId = 1; // COCO annotation IDs must be unique across the whole dataset.

   fileToAnnotationsMap.forEach((fileAnnotations, imageIndex) => {
      if (imageIndex < 0) return;
      const file = files[imageIndex];
      const fileName = toRelativeFilename(file, srcImgDir);
      if (!file) {
         console.warn(`Skipping image at index ${imageIndex}: No file found.`);
         return;
      }

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

// ---------------------------------------------------------------------------
// Merge-on-save helpers
//
// When the user imports an annotation file spanning several folders but only
// visits (and thus loads into memory) some of them, saving must not drop the
// annotations for the folders that were never opened. These helpers rebuild a
// complete export by overlaying the live in-memory annotations on top of the
// originally-imported dataset (the "baseline"), keyed by each image's path
// RELATIVE to srcImgDir — the same identity the exporters write — so live edits
// win and untouched folders are preserved.
// ---------------------------------------------------------------------------

// Normalize a path to a single leading slash and no trailing/duplicate slashes.
const canonPath = (p: string): string =>
   "/" + p.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/{2,}/g, "/");

// Reconstruct a full path from a path relative to srcImgDir. When srcImgDir is
// empty the export already flattened paths to basenames, so this stays consistent.
export const joinUnderDir = (rel: string, srcImgDir: string): string => {
   const d = srcImgDir.replace(/\/+$/, "");
   return d ? canonPath(`${d}/${rel}`) : "/" + rel.replace(/^\/+/, "");
};

// Parse an exported detection JSON back into a map keyed by each image's path
// exactly as written in the JSON (relative to the export's srcImgDir). Unlike the
// index-based importers, this preserves folder structure, so same-named files in
// sibling folders don't collide.
export function detectionJsonToRelMap(json: any, isCoco: boolean): Map<string, FileAnnotations> {
   const map = new Map<string, FileAnnotations>();
   if (isCoco) {
      const catIdToName = new Map<number, string>();
      (json?.categories ?? []).forEach((c: any) => catIdToName.set(c.id, c.name));
      const imgIdToMeta = new Map<number, { rel: string; width: number; height: number }>();
      (json?.images ?? []).forEach((im: any) =>
         imgIdToMeta.set(im.id, { rel: im.file_name, width: im.width ?? 0, height: im.height ?? 0 }));
      (json?.annotations ?? []).forEach((a: any) => {
         const meta = imgIdToMeta.get(a.image_id);
         if (!meta) return;
         const fa: FileAnnotations = map.get(meta.rel) ?? { name: meta.rel, width: meta.width, height: meta.height, annotations: [] };
         const [x, y, w, h] = a.bbox ?? [0, 0, 0, 0];
         fa.annotations.push({
            id: `${Date.now()}-${Math.random()}`,
            label: catIdToName.get(a.category_id) ?? "unknown",
            x, y, width: w, height: h,
            ...(a.score !== undefined ? { score: a.score } : {}),
            ...(a.flag ? { flag: a.flag } : {}),
         });
         map.set(meta.rel, fa);
      });
   } else {
      (json?.annotations ?? []).forEach((a: any) => {
         const rel = a.image_path;
         if (rel === undefined) return;
         const fa: FileAnnotations = map.get(rel) ?? { name: rel, width: 0, height: 0, annotations: [] };
         const [x0, y0, x1, y1] = a.bounding_box ?? [0, 0, 0, 0];
         fa.annotations.push({
            id: `${Date.now()}-${Math.random()}`,
            label: a.class,
            x: x0, y: y0, width: x1 - x0, height: y1 - y0,
            ...(a.score !== undefined ? { score: a.score } : {}),
            ...(a.iou !== undefined ? { iou: a.iou } : {}),
            ...(a.flag ? { flag: a.flag } : {}),
         });
         map.set(rel, fa);
      });
   }
   return map;
}

// Build the detection export JSON, overlaying live annotations (keyed by path
// relative to srcImgDir) on top of the imported baseline so that annotations for
// unopened sibling folders survive the save. When baselineJson is null this is
// equivalent to exporting just the live map.
export function mergeDetectionForSave(
   liveRelMap: Map<string, FileAnnotations>,
   baselineJson: any | null,
   baselineIsCoco: boolean,
   srcImgDir: string,
   coco: boolean,
): object {
   const complete = baselineJson
      ? detectionJsonToRelMap(baselineJson, baselineIsCoco)
      : new Map<string, FileAnnotations>();
   liveRelMap.forEach((fa, rel) => complete.set(rel, fa)); // live edits win per file
   const rels = [...complete.keys()];
   const files = rels.map((r) => joinUnderDir(r, srcImgDir));
   const indexMap = new Map<number, FileAnnotations>();
   rels.forEach((r, i) => indexMap.set(i, complete.get(r)!));
   return coco
      ? exportToCoco(indexMap, files, srcImgDir)
      : exportToDefaultJson(indexMap, files, srcImgDir);
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

   const categoryIdToLabel = new Map<number, string>();
   if (Array.isArray(cocoJson.categories)) {
      cocoJson.categories.forEach((cat: any) => {
         categoryIdToLabel.set(cat.id, cat.name);
      });
   }

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
