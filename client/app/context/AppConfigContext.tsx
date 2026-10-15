import { createContext, useContext } from "react";

export interface RuntimeEnv {
  apiBaseUrl: string;
  sam3Endpoint: string;
  /** Base URL of the SAM3 Video Service (sam3_video_service), separate from the per-image SAM3 endpoint above. Often behind an SSH tunnel to an HPC GPU node. */
  sam3VideoUrl: string;
  /**
   * "gateway" when sam3VideoUrl points at the authenticating gateway rather
   * than the service itself. Only then are cookies sent: the bare service
   * replies with a wildcard allowed origin, which a browser refuses to pair
   * with credentials, so getting this wrong fails every call with a CORS error.
   */
  sam3VideoAuth: string;
  tapisBaseUrl: string;
  allowedSystems: string | null;  // JSON string, e.g. '[{"value":"pitzer-tapis","label":"Pitzer"}]'
  embedders: string | null;       // comma-separated model names
  proposers: string | null;       // comma-separated model names
  annotatorType: string | null;   // "DETECTION" | "SEGMENTATION" | null (show all)
  docUrl: string;        // Help Doc
  demoVideoUrl: string;  // Live demo video
}

const AppConfigContext = createContext<RuntimeEnv | null>(null);

export const useAppConfig = (): RuntimeEnv => {
  const ctx = useContext(AppConfigContext);
  if (!ctx) throw new Error("useAppConfig must be used within AppConfigProvider");
  return ctx;
};

export const AppConfigProvider = AppConfigContext.Provider;
