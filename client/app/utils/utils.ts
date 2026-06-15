import type { RuntimeEnv } from "~/context/AppConfigContext";

// Defaults overridden at runtime by initConfig() (called from root.tsx loader data).
// Never use import.meta.env here — these values must be injectable at container
// start without a Docker rebuild.
let _baseUrl = "http://127.0.0.1:11112";
let _sam3Endpoint = "https://sam3-sailab.nrp-nautilus.io";
let _annotatorType: string | null = null;

export let allowed_systems: { value: string; label: string }[] = [
   { value: "pitzer-tapis", label: "Pitzer (OSC)" },
   { value: "expanse-tapis", label: "Expanse (SDSC)" },
   { value: "ascend-tapis", label: "Ascend (OSC)" },
   { value: "cardinal-tapis", label: "Cardinal (OSC)" },
   { value: "ascend-static", label: "Ascend Authenticated (OSC)" },
];

export let EMBEDDERS: string[] = [
   "OWLv2 Large Patch14 Ensemble",
   "DINOv3 ViT-S/16 (LVD-1689M Pretrained)",
   "BioCLIP 2 (via pybioclip)",
];

export let PROPOSERS: string[] = [
   "Segment Anything Model 3 (SAM 3)",
   "OWLv2 Large Patch14 Ensemble",
];

export const initConfig = (env: RuntimeEnv) => {
   _baseUrl = env.apiBaseUrl;
   _sam3Endpoint = env.sam3Endpoint;
   if (env.allowedSystems) allowed_systems = JSON.parse(env.allowedSystems);
   if (env.embedders) EMBEDDERS = env.embedders.split(",");
   if (env.proposers) PROPOSERS = env.proposers.split(",");
   _annotatorType = env.annotatorType ? env.annotatorType.toUpperCase() : null;
};

export const getBaseURL = () => _baseUrl;
export const getAnnotatorType = () => _annotatorType;

// Strips PowerPoint/rich-text artefacts that silently break URL encoding.
export const sanitizePath = (path: string): string =>
   path
      .trim()
      .replace(/[\u00A0\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000]/g, " ")
      .replace(/[\u200B\u200C\u200D\uFEFF\u200E\u200F\u2028\u2029]/g, "")
      .replace(/[\r\n\t]+/g, "");

export const fetchAndReturnData = async (
   url: string,
   token: string | null,
): Promise<any> => {
   const response = await fetch(`${_baseUrl}${url}`, {
      headers: {
         "Tapis-Token": token ?? "",
      },
   });
   if (!response.ok) return null;
   return response.json();
};

export function getC(cookiesH: string | null | undefined) {
   if (!cookiesH || typeof cookiesH !== "string") {
      return null;
   }

   const cookies = cookiesH.split(";");
   for (const cookie of cookies) {
      const eqIdx = cookie.indexOf("=");
      if (eqIdx === -1) continue;
      const cookieName = cookie.slice(0, eqIdx).trim();
      const cookieValue = cookie.slice(eqIdx + 1).trim();
      if (cookieName === "X-Tapis-Token") {
         console.log(cookieName);
         let jwt = decodeURIComponent(cookieValue);
         return jwt;
      } else if (cookieName === "token") {
         return decodeURIComponent(cookieValue);
      } else if (cookieName === "tapis-token") {
         console.log(cookieName);
         let jwt = JSON.parse(decodeURIComponent(cookieValue))["access_token"];
         return jwt;
      }
   }
   return null;
}

export const saveFile = async (
   url: string,
   content: string,
   token: string,
): Promise<boolean> => {
   const response = await fetch(`${_baseUrl}${url}`, {
      method: "POST",
      headers: {
         "Tapis-Token": token,
         "Content-Type": "application/json",
      },
      body: content,
   });
   return response.ok;
};

export const SubmitData = async (
   url: string,
   data: unknown,
   token: string,
   method: "POST" | "PATCH" | "PUT" = "POST",
): Promise<any> => {
   const response = await fetch(`${_baseUrl}${url}`, {
      method,
      headers: {
         "Tapis-Token": token,
         "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
   });
   if (!response.ok) return null;
   return response.json();
};

export const DeleteData = async (
   url: string,
   token: string,
): Promise<any> => {
   const response = await fetch(`${_baseUrl}${url}`, {
      method: "DELETE",
      headers: {
         "Tapis-Token": token,
         "Content-Type": "application/json",
      },
   });
   if (!response.ok) return null;
   return response.json();
};

export const SubmitFile = async (
   url: string,
   file: File,
   token: string,
): Promise<any> => {
   const formData = new FormData();
   formData.append("file", file);
   const response = await fetch(`${_baseUrl}${url}`, {
      method: "POST",
      headers: {
         "Tapis-Token": token,
      },
      body: formData,
   });
   if (!response.ok) return null;
   return response.json();
};

export const getImage = async (
   path: string,
   pipeId: string,
   system: string,
   cookie: any,
   signal?: AbortSignal,
): Promise<string> => {
   const token = cookie["tapis-token"]?.["access_token"] ?? "";
   const encodedPath = encodeURIComponent(path);
   const response = await fetch(
      `${_baseUrl}/get-img/${pipeId}/${system}?filePath=${encodedPath}`,
      {
         headers: { "Tapis-Token": token },
         signal,
      },
   );
   const blob = await response.blob();
   return URL.createObjectURL(blob);
};

export const getImages = async (
   paths: string[],
   pipeId: string,
   system: string,
   cookie: any,
   signal?: AbortSignal,
): Promise<Map<string, string>> => {
   const urlMap = new Map<string, string>();
   await Promise.all(
      paths.map(async (path) => {
         try {
            const url = await getImage(path, pipeId, system, cookie, signal);
            urlMap.set(path, url);
         } catch (e) {
            if (e instanceof Error && e.name === "AbortError") return;
            console.error(`Failed to fetch image ${path}:`, e);
         }
      }),
   );
   return urlMap;
};

export const fetchFile = async (
   url: string,
   token: string,
): Promise<Response> => {
   return fetch(`${_baseUrl}${url}`, {
      headers: { "Tapis-Token": token },
   });
};

export const getFile = async (
   url: string,
   pipeId: string,
   system: string,
   cookie: any,
): Promise<Response> => {
   const token = cookie["tapis-token"]?.["access_token"] ?? "";
   return fetchFile(
      `/get_file/${pipeId}/${system}?filePath=${encodeURIComponent(url)}`,
      token,
   );
};

export const sam3Predictions = async (
   payload: object,
   token: string,
): Promise<any> => {
   const response = await fetch(`${_sam3Endpoint}/predict`, {
      method: "POST",
      headers: {
         "Content-Type": "application/json",
         "token": token,
      },
      body: JSON.stringify(payload),
   });
   if (!response.ok) throw new Error("SAM3 prediction failed");
   return response.json();
};

export enum TYPE {
  DETECTION = "DETECTION",
  CLASSIFICATION = "CLASSIFICATION",
  SEGMENTATION = "SEGMENTATION",
}

export enum JobStatus {
  PENDING = "PENDING",
  PROCESSING_INPUTS = "PROCESSING_INPUTS",
  STAGING_INPUTS = "STAGING_INPUTS",
  STAGING_JOB = "STAGING_JOB",
  SUBMITTING_JOB = "SUBMITTING_JOB",
  QUEUED = "QUEUED",
  RUNNING = "RUNNING",
  ARCHIVING = "ARCHIVING",
  BLOCKED = "BLOCKED",
  PAUSED = "PAUSED",
  FINISHED = "FINISHED",
  CANCELLED = "CANCELLED",
  FAILED = "FAILED",
}

export const JobStatusDescriptions: Record<JobStatus, string> = {
  [JobStatus.PENDING]: "Job processing beginning",
  [JobStatus.PROCESSING_INPUTS]: "Identifying input files for staging",
  [JobStatus.STAGING_INPUTS]: "Transferring job input data to execution system",
  [JobStatus.STAGING_JOB]: "Staging runtime assets to execution system",
  [JobStatus.SUBMITTING_JOB]: "Submitting job to execution system",
  [JobStatus.QUEUED]: "Job queued to execution system queue (when jobType is BATCH)",
  [JobStatus.RUNNING]: "Job running on execution system",
  [JobStatus.ARCHIVING]: "Transferring job output to archive system",
  [JobStatus.BLOCKED]: "Job blocked",
  [JobStatus.PAUSED]: "Job processing suspended",
  [JobStatus.FINISHED]: "Job completed successfully",
  [JobStatus.CANCELLED]: "Job execution cancelled",
  [JobStatus.FAILED]: "Job failed",
};
