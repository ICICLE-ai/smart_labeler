import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getImage } from "~/utils/utils";
import { joinImagePath } from "./api";

const MAX_PARALLEL_FETCHES = 6;
/** Long side of the image the labelling canvas shows; crops are still cut from the original. */
const PREVIEW_MAX_SIDE = 2048;
/** Downloaded originals kept in the browser's Cache Storage across reloads and sessions. */
const PERSISTED_IMAGES = 500;
const CACHE_NAME = "protorcd-images-v1";
/** Originals and previews held in memory; older ones are re-read from Cache Storage. */
const MEMORY_BLOBS = 120;
const MEMORY_PREVIEWS = 40;
const MEMORY_CROPS = 1500;
/** How long a decoded original stays around after its last user, so crops requested together share one decode. */
const FULL_DECODE_LINGER_MS = 500;
/** Waits before retrying a download that failed for a reason that may pass (busy server, dropped connection). */
const RETRY_DELAYS_MS = [1000, 3000, 8000];

/** A failed download, with the HTTP status when there was one. */
class ImageError extends Error {
   constructor(message: string, readonly status?: number) {
      super(message);
   }
}

/** Errors worth retrying on their own: no response, too many requests, or a server-side failure. */
const isTransient = (e: unknown) =>
   !(e instanceof ImageError) || e.status === undefined || e.status === 408 || e.status === 429 || e.status >= 500;

/** What went wrong, in words a reviewer can act on. */
function describe(e: unknown): string {
   const status = e instanceof ImageError ? e.status : undefined;
   if (status === 401) return "Tapis login expired; sign in again";
   if (status === 403) return "no permission to read the file";
   if (status === 404) return "file not found on the HPC system";
   if (status === 429) return "Tapis is rate limiting";
   if (status !== undefined && status >= 500) return `Tapis error ${status}`;
   if (e instanceof ImageError) return e.message;
   if (e instanceof DOMException && e.name === "InvalidStateError") return "the browser cannot decode this file";
   return "network error";
}

export interface Preview {
   /** Object URL of the image to show, at most PREVIEW_MAX_SIDE on its long side. */
   url: string;
   /** Preview pixels per original pixel; multiply original coordinates by it. */
   scale: number;
}

export interface Crop {
   bitmap: ImageBitmap;
   /** The proposal's box in the crop's pixels. */
   box: [number, number, number, number];
}

interface Timing {
   file: string;
   source: "memory" | "browser cache" | "network";
   bytes: number;
   /** Waiting for a free download slot. */
   queuedMs: number;
   fetchMs: number;
   decodeMs?: number;
   previewMs?: number;
}

/** Map with insertion-order eviction; reading an entry makes it the newest. */
class Lru<V> extends Map<string, V> {
   constructor(private limit: number, private onEvict?: (v: V) => void) {
      super();
   }
   touch(key: string) {
      const v = super.get(key);
      if (v !== undefined) {
         super.delete(key);
         super.set(key, v);
      }
      return v;
   }
   set(key: string, value: V) {
      super.delete(key);
      super.set(key, value);
      while (this.size > this.limit) {
         const [oldest, v] = this.entries().next().value as [string, V];
         super.delete(oldest);
         this.onEvict?.(v);
      }
      return this;
   }
}

const now = () => performance.now();

async function openCache(): Promise<Cache | null> {
   try {
      return typeof caches === "undefined" ? null : await caches.open(CACHE_NAME);
   } catch {
      return null;   // private window, blocked storage or an insecure origin
   }
}

async function trimCache(cache: Cache) {
   try {
      const keys = await cache.keys();   // oldest first
      await Promise.all(keys.slice(0, Math.max(0, keys.length - PERSISTED_IMAGES)).map((k) => cache.delete(k)));
   } catch {
      /* best effort */
   }
}

/**
 * Source images for the labelling views. Images live on the HPC system and come
 * through Tapis one file at a time, often several MB each, which is where the
 * waiting goes; everything here is about fetching each file once:
 *
 * - downloads are kept in the browser's Cache Storage, so resuming a session or
 *   reloading the page reads them from disk instead of the HPC system;
 * - a batch's images are prefetched as soon as it arrives, the one on screen first;
 * - the image view gets a downscaled copy, so the canvas repaints a few
 *   megapixels on every click instead of the full frame;
 * - crops are cut once from the original (one decode per image, shared by all
 *   its proposals) and kept, so switching views or batches redraws instantly.
 *
 * Every download is timed; run `protorcdImageStats()` in the browser console
 * for a summary.
 */
export function createImageStore(pipeId: string, system: string, imageDir: string, token: string) {
   const cachePromise = openCache();
   cachePromise.then((c) => c && trimCache(c));

   const blobs = new Lru<Promise<Blob>>(MEMORY_BLOBS);
   const previews = new Lru<Promise<Preview>>(MEMORY_PREVIEWS, (p) => p.then((v) => URL.revokeObjectURL(v.url)).catch(() => {}));
   const crops = new Lru<Promise<Crop>>(MEMORY_CROPS);
   const full = new Map<string, { bitmap: Promise<ImageBitmap>; users: number; timer?: ReturnType<typeof setTimeout> }>();
   const timings: Timing[] = [];
   const timingByFile = new Map<string, Timing>();
   /** Why each file (by name in the batch) last failed; cleared when it loads. */
   const failures = new Map<string, string>();
   // `generation` changes with every failure or retry, so views re-render to show them;
   // `retries` changes only on a retry, so views ask again for what they still lack.
   let generation = 0;
   let retries = 0;
   const listeners = new Set<() => void>();
   const changed = () => {
      generation += 1;
      listeners.forEach((l) => l());
   };
   const fail = (fileName: string, e: unknown) => {
      const reason = describe(e);
      if (failures.get(fileName) === reason) return;
      failures.set(fileName, reason);
      console.warn(`[protorcd] could not load ${fileName}: ${reason}`, e);
      changed();
   };
   const succeed = (fileName: string) => {
      if (failures.delete(fileName)) changed();
   };

   // Download slots: queued requests run in order, and an urgent one jumps the queue.
   let active = 0;
   const queue: { key: string; start: () => void }[] = [];
   const pump = () => {
      while (active < MAX_PARALLEL_FETCHES && queue.length) {
         active += 1;
         queue.shift()!.start();
      }
   };
   const slot = (key: string, urgent: boolean) =>
      new Promise<() => void>((resolve) => {
         const entry = { key, start: () => resolve(() => { active -= 1; pump(); }) };
         if (urgent) queue.unshift(entry);
         else queue.push(entry);
         pump();
      });
   const bump = (key: string) => {
      const i = queue.findIndex((q) => q.key === key);
      if (i > 0) queue.unshift(...queue.splice(i, 1));
   };

   const cacheKey = (path: string) =>
      `${location.origin}/__protorcd_image_cache/${encodeURIComponent(system)}/${path.split("/").map(encodeURIComponent).join("/")}`;

   const download = async (path: string, urgent: boolean): Promise<Blob> => {
      const queuedAt = now();
      const cache = await cachePromise;
      const hit = await cache?.match(cacheKey(path)).catch(() => undefined);
      if (hit) {
         const t0 = now();
         const blob = await hit.blob();
         record({ file: path, source: "browser cache", bytes: blob.size, queuedMs: 0, fetchMs: now() - t0 });
         return blob;
      }
      for (let attempt = 0; ; attempt++) {
         const release = await slot(path, urgent);
         const t0 = now();
         try {
            const blob = await fetchOnce(path);
            record({ file: path, source: "network", bytes: blob.size, queuedMs: t0 - queuedAt, fetchMs: now() - t0 });
            cache?.put(cacheKey(path), new Response(blob, { headers: { "Content-Type": blob.type } })).catch(() => {});
            return blob;
         } catch (e) {
            if (attempt >= RETRY_DELAYS_MS.length || !isTransient(e)) throw e;
            console.debug(`[protorcd] retrying ${path} after: ${describe(e)}`);
         } finally {
            release();
         }
         await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
   };

   const fetchOnce = async (path: string): Promise<Blob> => {
      let url: string;
      try {
         url = await getImage(path, pipeId, system, { "tapis-token": { access_token: token } });
      } catch (e) {
         const status = Number(/(\d{3})\s*$/.exec(String((e as Error)?.message))?.[1]);
         throw Number.isFinite(status) ? new ImageError(`Tapis error ${status}`, status) : e;
      }
      const blob = await (await fetch(url)).blob();
      URL.revokeObjectURL(url);
      // An error page is not an image; never keep it. (TIFFs come through the backend, which answers errors in JSON.)
      if (blob.size === 0) throw new ImageError("the file is empty");
      if (/json|text|html/.test(blob.type)) {
         const status = Number(/"status"\s*:\s*(\d{3})/.exec(await blob.text())?.[1]);
         throw new ImageError("the server returned an error instead of the image", Number.isFinite(status) ? status : 502);
      }
      return blob;
   };

   const record = (t: Timing) => {
      timings.push(t);
      timingByFile.set(t.file, t);
      console.debug(`[protorcd] ${t.source} ${(t.bytes / 1e6).toFixed(2)} MB in ${t.fetchMs.toFixed(0)} ms` +
         (t.queuedMs > 1 ? ` (queued ${t.queuedMs.toFixed(0)} ms)` : "") + ` ${t.file}`);
   };
   const note = (path: string, field: "decodeMs" | "previewMs", ms: number) => {
      const t = timingByFile.get(path);
      if (t) t[field] = (t[field] ?? 0) + ms;
   };

   /** The original file's bytes. */
   const blob = (fileName: string, urgent = false): Promise<Blob> => {
      const path = joinImagePath(imageDir, fileName);
      const known = blobs.touch(path);
      if (known) {
         if (urgent) bump(path);
         return known;
      }
      const entry = download(path, urgent);
      entry.then(
         () => succeed(fileName),
         (e) => {
            if (blobs.get(path) === entry) blobs.delete(path);   // let a later request retry
            fail(fileName, e);
         },
      );
      blobs.set(path, entry);
      return entry;
   };

   /** Runs `use` on the decoded original; requests that overlap share one decode. */
   const withOriginal = async <T,>(fileName: string, urgent: boolean, use: (bitmap: ImageBitmap) => Promise<T> | T): Promise<T> => {
      let entry = full.get(fileName);
      if (!entry) {
         const path = joinImagePath(imageDir, fileName);
         const bitmap = blob(fileName, urgent).then(async (b) => {
            const t0 = now();
            try {
               const decoded = await createImageBitmap(b);
               note(path, "decodeMs", now() - t0);
               return decoded;
            } catch (e) {
               fail(fileName, new ImageError(`the browser cannot decode this file (${b.type || "unknown type"})`));
               throw e;
            }
         });
         entry = { bitmap, users: 0 };
         full.set(fileName, entry);
         bitmap.catch(() => full.get(fileName) === entry && full.delete(fileName));
      }
      const e = entry;
      clearTimeout(e.timer);
      e.users += 1;
      try {
         return await use(await e.bitmap);
      } finally {
         e.users -= 1;
         if (e.users === 0) {
            e.timer = setTimeout(() => {
               if (e.users > 0 || full.get(fileName) !== e) return;
               full.delete(fileName);
               e.bitmap.then((b) => b.close()).catch(() => {});
            }, FULL_DECODE_LINGER_MS);
         }
      }
   };

   /** The image at display size for the labelling canvas. */
   const preview = (fileName: string, urgent = false): Promise<Preview> => {
      const known = previews.touch(fileName);
      if (known) {
         if (urgent) bump(joinImagePath(imageDir, fileName));
         return known;
      }
      const entry = withOriginal(fileName, urgent, async (bitmap) => {
         const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
         if (scale === 1) return { url: URL.createObjectURL(await blob(fileName)), scale };
         const t0 = now();
         const canvas = document.createElement("canvas");
         canvas.width = Math.round(bitmap.width * scale);
         canvas.height = Math.round(bitmap.height * scale);
         const ctx = canvas.getContext("2d")!;
         ctx.imageSmoothingQuality = "high";
         ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
         const small = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the preview"))), "image/jpeg", 0.9));
         note(joinImagePath(imageDir, fileName), "previewMs", now() - t0);
         // Use the preview's exact scale, since its sides were rounded.
         return { url: URL.createObjectURL(small), scale: canvas.width / bitmap.width };
      });
      entry.catch(() => previews.get(fileName) === entry && previews.delete(fileName));
      previews.set(fileName, entry);
      return entry;
   };

   /** One proposal's box plus `context` margin, scaled so its long side is `size`. */
   const crop = (fileName: string, bbox: number[], context: number, size: number): Promise<Crop> => {
      const key = `${fileName}|${bbox.join(",")}|${context}|${size}`;
      const known = crops.touch(key);
      if (known) return known;
      const entry = withOriginal(fileName, false, async (img) => {
         const [x, y, w, h] = bbox;
         const sx = Math.max(0, Math.floor(x - w * context));
         const sy = Math.max(0, Math.floor(y - h * context));
         const sw = Math.max(1, Math.min(img.width, Math.ceil(x + w * (1 + context))) - sx);
         const sh = Math.max(1, Math.min(img.height, Math.ceil(y + h * (1 + context))) - sy);
         const scale = size / Math.max(sw, sh);
         const bitmap = await createImageBitmap(img, sx, sy, sw, sh, {
            resizeWidth: Math.max(1, Math.round(sw * scale)),
            resizeHeight: Math.max(1, Math.round(sh * scale)),
            resizeQuality: "high",
         });
         return { bitmap, box: [(x - sx) * scale, (y - sy) * scale, w * scale, h * scale] as Crop["box"] };
      });
      entry.catch(() => crops.get(key) === entry && crops.delete(key));
      crops.set(key, entry);
      return entry;
   };

   /** Starts downloading these images in order; already known ones cost nothing. */
   const prefetch = (fileNames: string[]) => fileNames.map((f) => blob(f).then(() => true, () => false));

   /** Ask again for everything that failed: views re-request the files they still need. */
   const retryFailed = () => {
      failures.clear();
      retries += 1;
      changed();
   };

   const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
   };

   const stats = () => {
      const network = timings.filter((t) => t.source === "network");
      const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
      const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
      const summary = {
         downloads: network.length,
         fromBrowserCache: timings.length - network.length,
         totalMB: +(sum(network.map((t) => t.bytes)) / 1e6).toFixed(1),
         medianMB: +(median(network.map((t) => t.bytes)) / 1e6).toFixed(2),
         medianFetchMs: Math.round(median(network.map((t) => t.fetchMs))),
         medianQueuedMs: Math.round(median(network.map((t) => t.queuedMs))),
         medianDecodeMs: Math.round(median(timings.flatMap((t) => (t.decodeMs ? [t.decodeMs] : [])))),
         medianPreviewMs: Math.round(median(timings.flatMap((t) => (t.previewMs ? [t.previewMs] : [])))),
         mbPerSecond: +(sum(network.map((t) => t.bytes)) / 1e6 / Math.max(0.001, sum(network.map((t) => t.fetchMs)) / 1000)).toFixed(2),
         failed: failures.size,
      };
      if (failures.size) console.table([...failures].map(([file, reason]) => ({ file, reason })));
      console.table(timings.map((t) => ({ ...t, MB: +(t.bytes / 1e6).toFixed(2), fetchMs: Math.round(t.fetchMs),
         queuedMs: Math.round(t.queuedMs), decodeMs: t.decodeMs && Math.round(t.decodeMs), previewMs: t.previewMs && Math.round(t.previewMs) })));
      return summary;
   };

   const dispose = () => {
      previews.forEach((p) => p.then((v) => URL.revokeObjectURL(v.url)).catch(() => {}));
      previews.clear();
      crops.clear();
      blobs.clear();
      full.forEach((e) => e.bitmap.then((b) => b.close()).catch(() => {}));
      full.clear();
   };

   return {
      blob, preview, crop, prefetch, retryFailed, stats, dispose, subscribe,
      /** Changes whenever failures change or a retry starts. */
      generation: () => generation,
      /** Changes only when the reviewer retries; effects that load images depend on it. */
      retries: () => retries,
      /** Why a file failed to load, or undefined when it has not failed. */
      failure: (fileName: string) => failures.get(fileName),
      failures: () => new Map(failures),
   };
}

export type ImageStore = ReturnType<typeof createImageStore>;

declare global {
   interface Window {
      /** Download and decode timings of the triage page's images (see createImageStore). */
      protorcdImageStats?: () => unknown;
   }
}

/**
 * Re-renders when the store's failures change or a retry starts. Returns the retry
 * count: put it in the dependencies of an effect that loads an image, so a retry
 * asks again (only effects whose image failed need it).
 */
export function useImageRetries(store: ImageStore) {
   useSyncExternalStore(store.subscribe, store.generation, () => 0);
   return store.retries();
}

/** One image store per triage page; it lives as long as the page. */
export function useImageStore(pipeId: string, system: string, imageDir: string, token: string): ImageStore {
   const store = useMemo(() => createImageStore(pipeId, system, imageDir, token), [pipeId, system, imageDir, token]);
   useEffect(() => {
      window.protorcdImageStats = store.stats;
      return () => {
         store.dispose();
         if (window.protorcdImageStats === store.stats) delete window.protorcdImageStats;
      };
   }, [store]);
   return store;
}
