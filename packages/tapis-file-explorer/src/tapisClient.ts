// ---------------------------------------------------------------------------
// Self-contained Tapis client used by FileExplorer / FileExplorerWrapper.
// Configure once at app startup (before rendering) with `configureTapisFileExplorer`.
// ---------------------------------------------------------------------------

export interface TapisSystemOption {
   value: string;
   label: string;
}

export interface TapisFileExplorerConfig {
   /** Base URL of the backend that proxies TIFF to JPEG conversion (`/get-img/:pipeId/:system`). */
   apiBaseUrl?: string;
   /** Base URL of the Tapis v3 API (e.g. `https://tacc.tapis.io`). */
   tapisBaseUrl?: string;
   /** Systems shown in the "System" dropdown. */
   allowedSystems?: TapisSystemOption[];
   /** Pre-selected system when the caller doesn't specify one. */
   defaultSystem?: string;
}

let _apiBaseUrl = "http://127.0.0.1:11112";
let _tapisBaseUrl = "https://icicleai.tapis.io";
export let allowed_systems: TapisSystemOption[] = [
   { value: "pitzer-tapis", label: "Pitzer (OSC)" },
   { value: "expanse-tapis", label: "Expanse (SDSC)" },
];
export let DEFAULT_SYSTEM = "pitzer-tapis";

/** Call once at app startup to point this package at your Tapis deployment. */
export function configureTapisFileExplorer(cfg: TapisFileExplorerConfig): void {
   if (cfg.apiBaseUrl) _apiBaseUrl = cfg.apiBaseUrl;
   if (cfg.tapisBaseUrl) _tapisBaseUrl = cfg.tapisBaseUrl;
   if (cfg.allowedSystems) allowed_systems = cfg.allowedSystems;
   if (cfg.defaultSystem) DEFAULT_SYSTEM = cfg.defaultSystem;
}

// Strips PowerPoint/rich-text artefacts (odd Unicode whitespace) that
// silently break URL encoding when pasted into a path field.
const WIDE_SPACE_CHARS = "            　";
const ZERO_WIDTH_CHARS = "​‌‍﻿‎‏  ";
const WIDE_SPACE_RE = new RegExp(`[${WIDE_SPACE_CHARS}]`, "g");
const ZERO_WIDTH_RE = new RegExp(`[${ZERO_WIDTH_CHARS}]`, "g");

export const sanitizePath = (path: string): string =>
   path
      .trim()
      .replace(WIDE_SPACE_RE, " ")
      .replace(ZERO_WIDTH_RE, "")
      .replace(/[\r\n\t]+/g, "");

// Encode a file-system path for use in a Tapis URL: strip the leading slash and
// percent-encode each segment individually so path separators stay intact.
const encodeTapisPath = (path: string): string =>
   path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");

const TAPIS_IMAGE_EXTS = new Set([
   ".jpeg",
   ".jpg",
   ".png",
   ".tif",
   ".tiff",
   ".gif",
   ".bmp",
   ".webp",
]);

/**
 * Fetches an image at a Tapis path and returns an object URL. TIFFs are
 * routed through `apiBaseUrl` for server-side conversion to JPEG; every
 * other format is fetched directly from Tapis (CORS must be open on your
 * Tapis tenant for this to work from the browser).
 */
export const getImage = async (
   path: string,
   pipeId: string,
   system: string,
   token: string,
   signal?: AbortSignal,
): Promise<string> => {
   const lower = path.toLowerCase();
   const isTiff = lower.endsWith(".tif") || lower.endsWith(".tiff");

   if (isTiff) {
      const encodedPath = encodeURIComponent(path);
      const response = await fetch(
         `${_apiBaseUrl}/get-img/${pipeId}/${system}?filePath=${encodedPath}`,
         { headers: { "Tapis-Token": token }, signal },
      );
      const blob = await response.blob();
      return URL.createObjectURL(blob);
   }

   const url = `${_tapisBaseUrl}/v3/files/content/${system}/${encodeTapisPath(path)}`;
   const response = await fetch(url, {
      headers: { "X-Tapis-Token": token },
      signal,
   });
   if (!response.ok) throw new Error(`Tapis image fetch failed: ${response.status}`);
   const blob = await response.blob();
   return URL.createObjectURL(blob);
};

/**
 * Lists subdirectories and image files at a Tapis path directly from the
 * browser. Non-image files are omitted (use `getTapisDirListing` for a
 * generic listing).
 */
export const getDirContentsFromTapis = async (
   dirPath: string,
   system: string,
   token: string,
): Promise<{ dirs: Array<{ name: string; path: string }>; imgs: string[] }> => {
   const url = `${_tapisBaseUrl}/v3/files/ops/${system}/${encodeTapisPath(dirPath)}?offset=0&limit=1000`;
   const response = await fetch(url, { headers: { "X-Tapis-Token": token } });
   if (!response.ok) return { dirs: [], imgs: [] };
   const results: Array<{ name: string; path: string; type: string }> =
      (await response.json()).result ?? [];
   const cleanDir = dirPath.replace(/^\/+/, "").replace(/\/+$/, "");
   const dirs: Array<{ name: string; path: string }> = [];
   const imgs: string[] = [];
   for (const item of results) {
      if (
         item.type === "dir" &&
         item.path.replace(/^\/+/, "").replace(/\/+$/, "") !== cleanDir
      ) {
         dirs.push({ name: item.name, path: item.path });
      } else if (item.type === "file") {
         const ext = `.${item.name.toLowerCase().split(".").pop() ?? ""}`;
         if (TAPIS_IMAGE_EXTS.has(ext)) imgs.push(item.path);
      }
   }
   return { dirs, imgs };
};

/**
 * Generic Tapis directory listing: returns ALL subdirectories and files at a
 * path (not filtered to images). Backs the directory-picker modal.
 */
export const getTapisDirListing = async (
   dirPath: string,
   system: string,
   token: string,
): Promise<{
   dirs: Array<{ name: string; path: string }>;
   files: Array<{ name: string; path: string }>;
}> => {
   const url = `${_tapisBaseUrl}/v3/files/ops/${system}/${encodeTapisPath(dirPath)}?offset=0&limit=1000`;
   const response = await fetch(url, { headers: { "X-Tapis-Token": token } });
   if (!response.ok) throw new Error(`Tapis listing failed: ${response.status}`);
   const results: Array<{ name: string; path: string; type: string }> =
      (await response.json()).result ?? [];
   const cleanDir = dirPath.replace(/^\/+/, "").replace(/\/+$/, "");
   const dirs: Array<{ name: string; path: string }> = [];
   const files: Array<{ name: string; path: string }> = [];
   for (const item of results) {
      const norm = item.path.replace(/^\/+/, "").replace(/\/+$/, "");
      // Tapis lists the queried directory itself as an entry — skip it.
      if (item.type === "dir" && norm !== cleanDir) {
         dirs.push({ name: item.name, path: item.path });
      } else if (item.type === "file") {
         files.push({ name: item.name, path: item.path });
      }
   }
   return { dirs, files };
};
