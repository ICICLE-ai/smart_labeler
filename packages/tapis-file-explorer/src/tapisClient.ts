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

// ---------------------------------------------------------------------------
// Error reporting
// ---------------------------------------------------------------------------

/** A Tapis call that failed, carrying enough to explain itself to a user. */
export class TapisError extends Error {
   readonly status?: number;
   readonly path: string;
   readonly system: string;
   /** Raw server text, kept for the console — not for the user. */
   readonly raw?: string;

   constructor(opts: { status?: number; system: string; path: string; raw?: string; action: string }) {
      super(describeTapisFailure(opts));
      this.name = "TapisError";
      this.status = opts.status;
      this.system = opts.system;
      this.path = opts.path;
      this.raw = opts.raw;
   }
}

/**
 * Turns a Tapis failure into a sentence a user can act on.
 *
 * Tapis error bodies are JSON envelopes wrapping Java stack traces and internal
 * URLs. Showing those raw tells the user nothing they can use, so the status is
 * mapped to plain language and the server's own text is reduced to a short,
 * readable trailer (or dropped when it is only machinery).
 */
export function describeTapisFailure(opts: {
   status?: number;
   system: string;
   path: string;
   raw?: string;
   action: string;
}): string {
   const { status, system, path, action } = opts;
   const where = `${path || "/"}\n    on ${system}`;
   const detail = humanizeServerText(opts.raw);
   const trailer = detail ? `\n\nServer said: ${detail}` : "";

   switch (status) {
      case 400:
         return `That path is not valid on ${system}:\n\n    ${where}${trailer}`;
      case 401:
         return `Your session has expired, so ${action} failed. Sign in again and retry.${trailer}`;
      case 403:
         return `You do not have permission to ${action} here:\n\n    ${where}\n\n` +
            `Your account can sign in to ${system} but is not allowed to read this ` +
            `location. Pick a folder you own, or ask the system's owner for access.${trailer}`;
      case 404:
         return `This folder or file does not exist on ${system}:\n\n    ${where}\n\n` +
            `Check the spelling, or use Browse to pick an existing location.${trailer}`;
      case 500:
      case 502:
      case 503:
      case 504:
         return `${system} is not responding right now, so ${action} failed. ` +
            `This is usually temporary — wait a moment and try again.${trailer}`;
      default:
         if (status === undefined) {
            return `Could not reach ${system} to ${action}. Check your network connection ` +
               `and try again.${trailer}`;
         }
         return `Could not ${action} on ${system} (error ${status}):\n\n    ${where}${trailer}`;
   }
}

/**
 * Extracts the readable part of a server error body. Returns undefined when
 * there is nothing worth showing — an empty body, an HTML error page, or a
 * stack trace.
 */
export function humanizeServerText(raw?: string): string | undefined {
   if (!raw) return undefined;
   let text = raw.trim();
   if (!text) return undefined;

   // An HTML error page carries nothing a user needs.
   if (/^\s*<(!doctype|html)/i.test(text)) return undefined;

   // Tapis nests its errors: the outer JSON's `message` contains a client
   // exception whose text contains another JSON body with the message that
   // actually names the problem. Peel until there is nothing left to peel.
   for (let depth = 0; depth < 5; depth++) {
      const picked = pickMessage(text);
      if (picked === undefined || picked === text) break;
      text = picked;
   }

   // Drop Java/Python stack traces and everything after them.
   text = text.split(/\n\s*at\s|\nTraceback/)[0];
   text = text.replace(/\s+/g, " ").trim();
   // Package-qualified exception names.
   text = text.replace(/(?:[a-z0-9]+\.)+[A-Z]\w*(?:Exception|Error):\s*/g, "");
   // Leading machine codes such as FILES_CLIENT_ERROR or APPS_UNAUTH.
   text = text.replace(/^(?:[A-Z][A-Z0-9]*_[A-Z0-9_]+\s+)+/, "");
   // Leftover protocol noise.
   text = text.replace(/\bstatus=\d{3}\b[,;]?\s*/g, "").trim();
   text = text.replace(/^[-–:,\s]+/, "").trim();

   if (!text || text.length < 3) return undefined;
   // A bare code or a bare exception class name, with no prose after it,
   // explains nothing to a user.
   if (/^[A-Z][A-Z0-9_]*$/.test(text)) return undefined;
   if (/^(?:[a-z0-9]+\.)+[A-Z]\w*(?:Exception|Error)$/.test(text)) return undefined;
   return text.length > 300 ? `${text.slice(0, 297)}…` : text;
}

/**
 * Pulls the message out of `text`, whether the whole string is a JSON envelope
 * or merely contains one (`... body={"message": "..."}`). Returns undefined when
 * there is no envelope left.
 */
function pickMessage(text: string): string | undefined {
   const fields = ["message", "description", "detail", "error"] as const;
   const takeFrom = (obj: any): string | undefined => {
      if (typeof obj === "string") return obj;
      if (!obj || typeof obj !== "object") return undefined;
      for (const f of fields) {
         const v = obj[f];
         if (typeof v === "string" && v.trim()) return v.trim();
      }
      return undefined;
   };

   const trimmed = text.trim();
   if (trimmed.startsWith("{")) {
      try {
         return takeFrom(JSON.parse(trimmed));
      } catch {
         /* fall through to the embedded search */
      }
   }

   // Embedded object: scan from each "{" and take the first that parses, so a
   // brace inside a message cannot derail it.
   for (let i = trimmed.indexOf("{"); i !== -1; i = trimmed.indexOf("{", i + 1)) {
      for (let j = trimmed.lastIndexOf("}"); j > i; j = trimmed.lastIndexOf("}", j - 1)) {
         try {
            const picked = takeFrom(JSON.parse(trimmed.slice(i, j + 1)));
            if (picked) return picked;
         } catch {
            /* try a shorter span */
         }
      }
   }
   return undefined;
}

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
   let response: Response;
   try {
      response = await fetch(url, { headers: { "X-Tapis-Token": token } });
   } catch (e) {
      throw new TapisError({ system, path: dirPath, action: "list this folder", raw: String(e) });
   }
   // Previously this returned an empty listing on failure, which the UI showed as
   // "no files here" — indistinguishable from an empty folder, and silent about a
   // permission problem or a typo. Failures are now reported.
   if (!response.ok) {
      throw new TapisError({
         status: response.status,
         system,
         path: dirPath,
         action: "list this folder",
         raw: await response.text().catch(() => undefined),
      });
   }
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
   if (!response.ok) {
      throw new TapisError({
         status: response.status,
         system,
         path: dirPath,
         action: "list this folder",
         raw: await response.text().catch(() => undefined),
      });
   }
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
