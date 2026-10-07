import type { Annotation } from "@icicle-ai/image-annotation-canvas";

export interface FileAnnotations {
   name: string;
   annotations: Annotation[];
   width: number;
   height: number;
}

// Convert a full Tapis path to a path relative to srcImgDir.
//
// When the path does not sit under srcImgDir (including when srcImgDir is unset)
// the whole path is kept. It used to fall back to the bare basename, which made
// two images that merely share a filename — train/img_001.png and
// val/img_001.png — indistinguishable in a saved file, so one overwrote the
// other. It also disagreed with normalizeRelKey, which keeps the full path in
// exactly that case, so the save and the merge baseline keyed the same image two
// different ways.
export function toRelativeFilename(fullPath: string, srcImgDir: string): string {
   const normDir = srcImgDir.replace(/^\/+/, "").replace(/\/+$/, "");
   const normPath = fullPath.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
   if (normDir && normPath.startsWith(normDir + "/")) return normPath.slice(normDir.length + 1);
   return normPath;
}

// Canonical identity for an image *as spelled inside an annotation file*.
//
// Annotation files in the wild write the same image three different ways — bare
// basename, path relative to srcImgDir, or the full path — and the merge-on-save
// baseline is keyed by whatever string the file happened to use. Without this
// normalization a re-spelled path lands under a second key, so the save writes the
// image twice and the next load reads both copies back onto one image.
// Mirrors toRelativeFilename's output for paths that do sit under srcImgDir.
export function normalizeRelKey(rawPath: string, srcImgDir: string): string {
   const normDir = srcImgDir.replace(/^\/+/, "").replace(/\/+$/, "");
   // Exports from other tools often prefix "./"; it means the same path.
   const norm = rawPath
      .replace(/^\.\//, "")
      .replace(/\/\.\//g, "/")
      .replace(/^\/+/, "")
      .replace(/\/{2,}/g, "/");
   if (normDir && norm.startsWith(normDir + "/")) return norm.slice(normDir.length + 1);
   return norm;
}

// Resolve a path written in an annotation file to an index in `files`.
//
// Matching walks from most specific to least. Basename matching is the last resort
// and is skipped when that basename repeats across folders — collapsing
// `train/img_001.jpg` and `val/img_001.jpg` onto one image is what silently piled
// both files' annotations onto one image and dropped the other's.
export function buildFileIndexResolver(files: string[], srcImgDir: string = "") {
   const fullToIdx = new Map<string, number>();
   const relToIdx = new Map<string, number>();
   const baseToIdx = new Map<string, number>();
   const ambiguousBases = new Set<string>();

   files.forEach((file, idx) => {
      if (typeof file !== "string") return;
      fullToIdx.set(file.replace(/^\/+/, ""), idx);
      const rel = toRelativeFilename(file, srcImgDir);
      if (!relToIdx.has(rel)) relToIdx.set(rel, idx);
      const base = file.substring(file.lastIndexOf("/") + 1);
      if (baseToIdx.has(base)) ambiguousBases.add(base);
      else baseToIdx.set(base, idx);
   });

   return (rawPath: string): number | undefined => {
      if (typeof rawPath !== "string" || !rawPath) return undefined;

      const stripped = rawPath.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
      const byFull = fullToIdx.get(stripped);
      if (byFull !== undefined) return byFull;

      const rel = normalizeRelKey(rawPath, srcImgDir);
      const byRel = relToIdx.get(rel);
      if (byRel !== undefined) return byRel;

      // Either side may carry extra leading folders (an export made under a
      // different root). Accept a suffix match only when exactly one file fits.
      const suffixHits: number[] = [];
      relToIdx.forEach((idx, r) => {
         if (r.endsWith("/" + rel) || rel.endsWith("/" + r)) suffixHits.push(idx);
      });
      if (suffixHits.length === 1) return suffixHits[0];
      if (suffixHits.length > 1) return undefined;

      // Basename matching is only ever appropriate for a path that names no
      // folder at all. A path like "val/img_001.png" states which folder it means;
      // matching it to "train/img_001.png" is simply wrong, and that is what put
      // one folder's annotations onto the other's image. It mattered most before
      // both folders had been opened: `files` only holds what the explorer has
      // listed so far, so the duplicate-basename guard below could not yet see a
      // duplicate, and the fallback silently took the one file it knew about.
      // Leaving it unresolved is safe — the importer re-runs as more folders load.
      if (rel.includes("/")) return undefined;

      const base = rel;
      if (ambiguousBases.has(base)) {
         console.warn(`Ambiguous annotation path "${rawPath}": "${base}" exists in multiple folders — skipped.`);
         return undefined;
      }
      return baseToIdx.get(base);
   };
}

/** An imported box together with the identity it was filed under in the JSON. */
type TaggedAnnotation = { source: string; annotation: Annotation };

function annotationKey(a: Annotation): string {
   return `${a.label}|${a.x}|${a.y}|${a.width}|${a.height}|${a.flag ?? ""}`;
}

/**
 * Collapse boxes that exist only because one image was spelled two different
 * ways in the file — the artifact of files written before the path-identity
 * fix, where both spellings now resolve to the same image.
 *
 * Boxes filed under the SAME identity are always kept, however identical they
 * look. Running one text prompt twice legitimately stacks two boxes in exactly
 * the same place, and that is the user's data, not an artifact: an earlier
 * version compared geometry alone and silently dropped such boxes the next
 * time the file was opened.
 *
 * `source` is the raw `image_path` for default JSON and the `image_id` for
 * COCO, so duplicate spellings read as distinct sources while repeated boxes
 * under one spelling do not.
 */
function dedupeAcrossPathSpellings(tagged: TaggedAnnotation[]): Annotation[] {
   // Group by source, keeping the order the sources first appeared in.
   const order: string[] = [];
   const groups = new Map<string, Annotation[]>();
   for (const { source, annotation } of tagged) {
      if (!groups.has(source)) {
         groups.set(source, []);
         order.push(source);
      }
      groups.get(source)!.push(annotation);
   }
   // One spelling means nothing here is a spelling artifact.
   if (order.length <= 1) return tagged.map((t) => t.annotation);

   const kept: Annotation[] = [];
   const keptCounts = new Map<string, number>();
   for (const source of order) {
      // Each box already kept can absorb at most one repeat from this source,
      // so a set duplicated under N spellings collapses to one copy while
      // genuinely stacked boxes survive.
      const available = new Map(keptCounts);
      const keptHere: Annotation[] = [];
      for (const a of groups.get(source)!) {
         const key = annotationKey(a);
         const left = available.get(key) ?? 0;
         if (left > 0) {
            available.set(key, left - 1);
            continue;
         }
         keptHere.push(a);
      }
      kept.push(...keptHere);
      for (const a of keptHere) {
         const key = annotationKey(a);
         keptCounts.set(key, (keptCounts.get(key) ?? 0) + 1);
      }
   }
   return kept;
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

// Reconstruct a full path from a path relative to srcImgDir. With no srcImgDir
// the relative form is already the full path, so this just restores the leading
// slash.
export const joinUnderDir = (rel: string, srcImgDir: string): string => {
   const d = srcImgDir.replace(/\/+$/, "");
   return d ? canonPath(`${d}/${rel}`) : "/" + rel.replace(/^\/+/, "");
};

// Parse an exported detection JSON back into a map keyed by each image's path
// relative to srcImgDir — the same identity the live map and the exporters use, so
// a baseline entry and a live entry for one image collapse onto one key instead of
// both being written to the saved file. Preserves folder structure, so same-named
// files in sibling folders don't collide.
//
// `files` is the live file list. Passing it is what lets a baseline path resolve to
// the file it actually refers to: the importer matches "a.jpg" to
// "<srcImgDir>/sub/a.jpg" by basename, so the baseline has to key that entry
// "sub/a.jpg" too — otherwise the user's edits land under a different key and the
// original (pre-edit, pre-delete) annotations get written back out alongside them.
export function detectionJsonToRelMap(
   json: any,
   isCoco: boolean,
   srcImgDir: string = "",
   files: string[] = [],
): Map<string, FileAnnotations> {
   const resolveFileIndex = buildFileIndexResolver(files, srcImgDir);
   // Anchor to the real file when this path points at one we know about. Paths that
   // resolve to nothing keep their own spelling — that's the unopened-folder data
   // the baseline exists to preserve.
   const keyFor = (rawPath: string): string => {
      const idx = resolveFileIndex(rawPath);
      return idx !== undefined ? toRelativeFilename(files[idx], srcImgDir) : normalizeRelKey(rawPath, srcImgDir);
   };

   const map = new Map<string, FileAnnotations>();
   if (isCoco) {
      const catIdToName = new Map<number, string>();
      (json?.categories ?? []).forEach((c: any) => catIdToName.set(c.id, c.name));
      const imgIdToMeta = new Map<number, { rel: string; width: number; height: number }>();
      (json?.images ?? []).forEach((im: any) =>
         imgIdToMeta.set(im.id, { rel: keyFor(im.file_name ?? ""), width: im.width ?? 0, height: im.height ?? 0 }));
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
         if (a.image_path === undefined) return;
         const rel = keyFor(a.image_path);
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
// unopened sibling folders survive the save. With no baselines this is
// equivalent to exporting just the live map.
/** One annotation document brought into the session, with its format. */
export type AnnotationBaseline = { json: any; isCoco: boolean };

export function mergeDetectionForSave(
   liveRelMap: Map<string, FileAnnotations>,
   baselines: AnnotationBaseline[],
   srcImgDir: string,
   coco: boolean,
   liveFiles: string[] = [],
): object {
   // Oldest first, so a later import overrides an earlier one per image while
   // images only the earlier one mentions are still carried through. Taking a
   // single baseline here is what made importing one folder's annotations drop
   // every other folder's from the saved file.
   const complete = new Map<string, FileAnnotations>();
   for (const baseline of baselines) {
      if (!baseline?.json) continue;
      detectionJsonToRelMap(baseline.json, baseline.isCoco, srcImgDir, liveFiles)
         .forEach((fa, rel) => complete.set(rel, fa));
   }
   liveRelMap.forEach((fa, rel) => complete.set(rel, fa)); // live edits win per file
   const rels = [...complete.keys()];
   const exportFiles = rels.map((r) => joinUnderDir(r, srcImgDir));
   const indexMap = new Map<number, FileAnnotations>();
   rels.forEach((r, i) => indexMap.set(i, complete.get(r)!));
   return coco
      ? exportToCoco(indexMap, exportFiles, srcImgDir)
      : exportToDefaultJson(indexMap, exportFiles, srcImgDir);
}

export function importFromCocoJsonUtil(
   cocoJson: any,
   files: string[],
   srcImgDir: string = ""
): Map<number, FileAnnotations> {
   const resolveFileIndex = buildFileIndexResolver(files, srcImgDir);

   const categoryIdToLabel = new Map<number, string>();
   if (Array.isArray(cocoJson.categories)) {
      cocoJson.categories.forEach((cat: any) => {
         categoryIdToLabel.set(cat.id, cat.name);
      });
   }

   // imageId → file index + size. Two COCO images can resolve to the same file
   // when an older file spelled one image's path two ways; dedupe below drops the
   // repeated boxes rather than stacking them.
   const imageIdToFileIndex = new Map<number, number>();
   const imageIdToSize = new Map<number, { width: number; height: number }>();
   if (Array.isArray(cocoJson.images)) {
      cocoJson.images.forEach((img: any) => {
         const fileIdx = resolveFileIndex(img.file_name);
         if (fileIdx === undefined) return;
         imageIdToFileIndex.set(img.id, fileIdx);
         imageIdToSize.set(img.id, { width: img.width ?? 0, height: img.height ?? 0 });
      });
   }

   const fileToAnnotationsMap = new Map<number, FileAnnotations>();
   // Boxes are collected per file tagged with their image_id, so two COCO
   // image entries spelling one file two ways stay distinguishable from the
   // same image legitimately carrying a box twice.
   const taggedByFile = new Map<number, TaggedAnnotation[]>();
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
            const size = imageIdToSize.get(ann.image_id) ?? { width: 0, height: 0 };
            fileToAnnotationsMap.set(fileIdx, {
               name: files[fileIdx],
               width: size.width,
               height: size.height,
               annotations: [],
            });
         }
         if (!taggedByFile.has(fileIdx)) taggedByFile.set(fileIdx, []);
         taggedByFile.get(fileIdx)!.push({ source: String(ann.image_id), annotation });
      });
   }

   fileToAnnotationsMap.forEach((fa, fileIdx) => {
      fa.annotations = dedupeAcrossPathSpellings(taggedByFile.get(fileIdx) ?? []);
   });
   return fileToAnnotationsMap;
}

export function importFromDefaultJsonUtil(
   defaultJson: any,
   files: string[],
   srcImgDir: string = ""
): Map<number, FileAnnotations> {
   const resolveFileIndex = buildFileIndexResolver(files, srcImgDir);

   const fileToAnnotationsMap = new Map<number, FileAnnotations>();
   // Tagged with the raw image_path, so two spellings of one file remain
   // distinguishable from one spelling repeating the same box.
   const taggedByFile = new Map<number, TaggedAnnotation[]>();
   if (Array.isArray(defaultJson.annotations)) {
      defaultJson.annotations.forEach((ann: any) => {
         const fileIdx = resolveFileIndex(ann.image_path);
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
         if (!taggedByFile.has(fileIdx)) taggedByFile.set(fileIdx, []);
         taggedByFile.get(fileIdx)!.push({ source: String(ann.image_path), annotation });
      });
   }

   fileToAnnotationsMap.forEach((fa, fileIdx) => {
      fa.annotations = dedupeAcrossPathSpellings(taggedByFile.get(fileIdx) ?? []);
   });
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
