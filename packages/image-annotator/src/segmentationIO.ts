import type { SegmentationAnnotation } from "@icicle-ai/image-annotation-canvas";
import { toRelativeFilename, joinUnderDir } from "./detectionIO";

export interface SegmentationFileAnnotations {
   name: string;
   width: number;
   height: number;
   masks: SegmentationAnnotation[];
}

export function exportSegmentationJson(
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

export function exportSegmentationToCoco(
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

// Parse an exported segmentation JSON into a map keyed by each image's path
// relative to srcImgDir (folder structure preserved, no basename collisions).
export function segJsonToRelMap(json: any, isCoco: boolean): Map<string, SegmentationFileAnnotations> {
   const map = new Map<string, SegmentationFileAnnotations>();
   if (isCoco) {
      const catIdToName = new Map<number, string>();
      (json?.categories ?? []).forEach((c: any) => catIdToName.set(c.id, c.name));
      const imgIdToMeta = new Map<number, { rel: string; width: number; height: number }>();
      (json?.images ?? []).forEach((im: any) =>
         imgIdToMeta.set(im.id, { rel: im.file_name, width: im.width ?? 0, height: im.height ?? 0 }));
      (json?.annotations ?? []).forEach((a: any) => {
         const meta = imgIdToMeta.get(a.image_id);
         if (!meta) return;
         const fa = map.get(meta.rel) ?? { name: meta.rel, width: meta.width, height: meta.height, masks: [] };
         const flat: number[] = Array.isArray(a.segmentation) ? (a.segmentation[0] ?? []) : [];
         const points: { x: number; y: number }[] = [];
         for (let i = 0; i + 1 < flat.length; i += 2) points.push({ x: flat[i], y: flat[i + 1] });
         fa.masks.push({
            id: `${Date.now()}-${Math.random()}`,
            label: catIdToName.get(a.category_id) ?? "mask",
            points,
            ...(a.score !== undefined ? { score: a.score } : {}),
            ...(a.flag ? { flag: a.flag } : {}),
         });
         map.set(meta.rel, fa);
      });
   } else {
      (json?.files ?? []).forEach((entry: any) => {
         map.set(entry.filename, {
            name: entry.filename,
            width: entry.width ?? 0,
            height: entry.height ?? 0,
            masks: (entry.masks ?? []).map((m: any) => ({
               id: m.id ?? `${Date.now()}-${Math.random()}`,
               label: m.label ?? "mask",
               points: m.points ?? [],
               ...(m.score !== undefined ? { score: m.score } : {}),
               ...(m.flag ? { flag: m.flag } : {}),
            })),
         });
      });
   }
   return map;
}

// Build the segmentation export, overlaying live masks (keyed by path relative to
// srcImgDir) on top of the imported baseline so unopened folders survive the save.
export function mergeSegmentationForSave(
   liveRelMap: Map<string, SegmentationFileAnnotations>,
   baselineJson: any | null,
   baselineIsCoco: boolean,
   srcImgDir: string,
   coco: boolean,
): object {
   const complete = baselineJson
      ? segJsonToRelMap(baselineJson, baselineIsCoco)
      : new Map<string, SegmentationFileAnnotations>();
   liveRelMap.forEach((fa, rel) => complete.set(rel, fa)); // live edits win per file
   const rels = [...complete.keys()];
   const files = rels.map((r) => joinUnderDir(r, srcImgDir));
   const fullMap = new Map<string, SegmentationFileAnnotations>();
   rels.forEach((r, i) => fullMap.set(files[i], complete.get(r)!));
   return coco
      ? exportSegmentationToCoco(fullMap, files, srcImgDir)
      : exportSegmentationJson(fullMap, files, srcImgDir);
}

export function importSegmentationJson(
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

export function importSegmentationFromCoco(
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
