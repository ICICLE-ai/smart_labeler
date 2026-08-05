import type { PatraCard, PatraModelDetails } from "./types";

export interface PatraClientConfig {
   /** Base URL of the Patra backend, called directly (e.g. https://patrabackend.pods.icicleai.tapis.io). */
   patraBaseUrl?: string;
}

// Matches PATRA_BASE_NEW's default in server/flask_server.py — the same
// upstream the smart-labeler backend itself proxies to.
let _patraBaseUrl = "https://patrabackend.pods.icicleai.tapis.io";

export function configurePatraModelSelector(cfg: PatraClientConfig): void {
   if (cfg.patraBaseUrl) _patraBaseUrl = cfg.patraBaseUrl.replace(/\/+$/, "");
}

export async function listPatraModels(token: string): Promise<PatraCard[]> {
   const response = await fetch(`${_patraBaseUrl}/modelcards`, {
      headers: { "X-Tapis-Token": token },
   });
   if (!response.ok) {
      throw new Error(`Failed to fetch Patra model cards: ${response.status}`);
   }
   return (await response.json()) ?? [];
}

export async function getPatraModelDetails(uuid: string, token: string): Promise<PatraModelDetails> {
   const response = await fetch(`${_patraBaseUrl}/modelcard/${encodeURIComponent(uuid)}`, {
      headers: { "X-Tapis-Token": token },
   });
   if (!response.ok) {
      throw new Error(`Failed to fetch Patra model card "${uuid}": ${response.status}`);
   }
   return response.json();
}
