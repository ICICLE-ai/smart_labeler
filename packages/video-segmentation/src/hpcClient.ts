// ---------------------------------------------------------------------------
// Saving exports to an HPC system via Tapis.
//
// This goes straight to Tapis rather than through the smart-labeler backend's
// /save-file route: that route reads the body as text and names every file
// `ann-<timestamp>.json`, so it can neither carry an MP4 nor let the user
// choose a filename. Tapis' own files endpoint takes multipart uploads, which
// covers both artifacts and reports progress.
// ---------------------------------------------------------------------------
import { getTapisBaseUrl } from "./sam3VideoClient";

export class HpcSaveError extends Error {
   status?: number;
   constructor(message: string, status?: number) {
      super(message);
      this.name = "HpcSaveError";
      this.status = status;
   }
}

/** Strips leading/trailing slashes so a path can be joined without producing `//`. */
function trimSlashes(path: string): string {
   return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

/** Tapis wants each path segment encoded, but the separators left alone. */
function encodeTapisPath(path: string): string {
   return trimSlashes(path).split("/").map(encodeURIComponent).join("/");
}

function describeFailure(status: number, body: string, system: string, dir: string): string {
   const detail = body?.trim() ? ` Server said: ${body.trim().slice(0, 300)}` : "";
   switch (status) {
      case 401:
         return `Your session is no longer valid, so nothing was saved. Sign in again and retry.${detail}`;
      case 403:
         return `You do not have permission to write to ${dir || "/"} on ${system}. ` +
            `Pick a folder you own, or ask the system's owner for write access.${detail}`;
      case 404:
         return `That folder does not exist on ${system}: ${dir || "/"}.${detail}`;
      case 507:
         return `There is not enough space left on ${system} to save this file.${detail}`;
      default:
         return `Could not save to ${system} (HTTP ${status}).${detail}`;
   }
}

/**
 * Uploads one file to `{dir}/{filename}` on a Tapis system.
 *
 * @param onProgress Fraction uploaded, 0–1. An annotated MP4 of a long video is
 *   large enough that a silent wait reads as a hang.
 */
export function saveToHpc(
   {
      system,
      dir,
      filename,
      body,
      token,
   }: {
      system: string;
      dir: string;
      filename: string;
      body: Blob;
      token: string;
   },
   onProgress?: (fraction: number) => void,
   signal?: AbortSignal,
): Promise<void> {
   return new Promise((resolve, reject) => {
      if (!system) { reject(new HpcSaveError("Choose a system to save to.")); return; }
      if (!filename.trim()) { reject(new HpcSaveError("Enter a filename.")); return; }

      const cleanDir = trimSlashes(dir);
      const target = `${trimSlashes(filename)}`;
      const url = `${getTapisBaseUrl()}/v3/files/ops/${system}/${cleanDir ? `${cleanDir}/` : ""}${target}`;

      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("X-Tapis-Token", token ?? "");

      xhr.upload.onprogress = (e) => {
         if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
         if (xhr.status >= 200 && xhr.status < 300) resolve();
         else reject(new HpcSaveError(describeFailure(xhr.status, xhr.responseText, system, cleanDir), xhr.status));
      };
      xhr.onerror = () => reject(new HpcSaveError(
         `Could not reach Tapis at ${getTapisBaseUrl()} to save the file. Check your network connection.`,
      ));
      xhr.onabort = () => reject(new HpcSaveError("Save cancelled"));
      if (signal) {
         if (signal.aborted) { xhr.abort(); return; }
         signal.addEventListener("abort", () => xhr.abort());
      }

      const form = new FormData();
      form.append("file", body, target);
      xhr.send(form);
   });
}

/**
 * Reads a file off an HPC system so it can be handed to the video service.
 *
 * The video service only accepts a multipart upload, and it has no access to
 * Tapis, so a video already sitting on HPC has to travel through the browser:
 * down from Tapis, then up to the service. Progress is streamed rather than
 * awaited as one blob, because these are videos and a silent several-hundred-MB
 * download reads as a hang.
 */
export async function fetchHpcFile(
   { system, path, token }: { system: string; path: string; token: string },
   onProgress?: (fraction: number, bytes: number) => void,
   signal?: AbortSignal,
): Promise<Blob> {
   const url = `${getTapisBaseUrl()}/v3/files/content/${system}/${encodeTapisPath(path)}`;
   let response: Response;
   try {
      response = await fetch(url, { headers: { "X-Tapis-Token": token ?? "" }, signal });
   } catch (e) {
      if (signal?.aborted) throw e;
      throw new HpcSaveError(`Could not reach Tapis at ${getTapisBaseUrl()} to read ${path}.`);
   }
   if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new HpcSaveError(describeReadFailure(response.status, body, system, path), response.status);
   }

   const total = Number(response.headers.get("content-length") ?? 0);
   // Without a body stream (or a length to measure against) there is nothing to
   // report progress from; fall back to a plain blob read.
   if (!response.body || !total) {
      const blob = await response.blob();
      onProgress?.(1, blob.size);
      return blob;
   }

   const reader = response.body.getReader();
   const parts: BlobPart[] = [];
   let received = 0;
   for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
         parts.push(value as unknown as BlobPart);
         received += value.byteLength;
         onProgress?.(Math.min(received / total, 1), received);
      }
   }
   return new Blob(parts, { type: response.headers.get("content-type") ?? "video/mp4" });
}

function describeReadFailure(status: number, body: string, system: string, path: string): string {
   const detail = body?.trim() ? ` Server said: ${body.trim().slice(0, 300)}` : "";
   switch (status) {
      case 401:
         return `Your session is no longer valid. Sign in again and retry.${detail}`;
      case 403:
         return `You do not have permission to read ${path} on ${system}.${detail}`;
      case 404:
         return `No such file on ${system}: ${path}.${detail}`;
      default:
         return `Could not read ${path} from ${system} (HTTP ${status}).${detail}`;
   }
}
