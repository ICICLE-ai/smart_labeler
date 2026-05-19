import { createContext, useContext } from "react";

export interface RuntimeEnv {
  apiBaseUrl: string;
  sam3Endpoint: string;
  tapisBaseUrl: string;
  allowedSystems: string | null;  // JSON string, e.g. '[{"value":"pitzer-tapis","label":"Pitzer"}]'
  embedders: string | null;       // comma-separated model names
  proposers: string | null;       // comma-separated model names
}

const AppConfigContext = createContext<RuntimeEnv | null>(null);

export const useAppConfig = (): RuntimeEnv => {
  const ctx = useContext(AppConfigContext);
  if (!ctx) throw new Error("useAppConfig must be used within AppConfigProvider");
  return ctx;
};

export const AppConfigProvider = AppConfigContext.Provider;
