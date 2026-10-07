import type { PatraCard, PatraModelDetails } from "./types";

export interface PatraClientConfig {
   /** Base URL of the Patra backend, called directly (e.g. https://patrabackend.pods.icicleai.tapis.io). */
   patraBaseUrl?: string;
   /**
    * Route the two Patra reads through a backend of your own instead of calling
    * Patra directly. Browsers block a direct cross-origin call unless Patra
    * itself sends CORS headers, so an app that already has a backend proxying
    * these endpoints should point this at it. Set to `null` to go back to
    * calling Patra directly.
    */
   proxy?: PatraProxyConfig | null;
}

export interface PatraProxyConfig {
   /** Base URL of the proxying backend (e.g. https://labeler-api.example.com). */
   baseUrl: string;
   /** Path of the "list model cards" endpoint. Default: `/patra/list?new=true`. */
   listPath?: string;
   /** Builds the path of the "one model card" endpoint. Default: `/patra/download_mc/<uuid>?new=true`. */
   detailsPath?: (uuid: string) => string;
   /** Header the proxy expects the Tapis token in. Default: `Tapis-Token`. */
   tokenHeader?: string;
}

// Matches PATRA_BASE_NEW's default in server/flask_server.py — the same
// upstream the smart-labeler backend itself proxies to.
let _patraBaseUrl = "https://patrabackend.pods.icicleai.tapis.io";
let _proxy: PatraProxyConfig | null = null;

export function configurePatraModelSelector(cfg: PatraClientConfig): void {
   if (cfg.patraBaseUrl) _patraBaseUrl = cfg.patraBaseUrl.replace(/\/+$/, "");
   if (cfg.proxy !== undefined) {
      _proxy = cfg.proxy ? { ...cfg.proxy, baseUrl: cfg.proxy.baseUrl.replace(/\/+$/, "") } : null;
   }
}

/** Resolves a Patra read to (url, headers), honouring the configured proxy. */
function resolve(
   token: string,
   direct: string,
   viaProxy: (p: PatraProxyConfig) => string
): { url: string; headers: Record<string, string> } {
   if (_proxy) {
      return {
         url: `${_proxy.baseUrl}${viaProxy(_proxy)}`,
         headers: { [_proxy.tokenHeader ?? "Tapis-Token"]: token },
      };
   }
   return { url: `${_patraBaseUrl}${direct}`, headers: { "X-Tapis-Token": token } };
}

export async function listPatraModels(token: string): Promise<PatraCard[]> {
   const { url, headers } = resolve(token, "/modelcards", (p) => p.listPath ?? "/patra/list?new=true");
   const response = await fetch(url, { headers });
   if (!response.ok) {
      throw new Error(`Failed to fetch Patra model cards: ${response.status}`);
   }
   return (await response.json()) ?? [];
}

export async function getPatraModelDetails(uuid: string, token: string): Promise<PatraModelDetails> {
   const { url, headers } = resolve(
      token,
      `/modelcard/${encodeURIComponent(uuid)}`,
      (p) => p.detailsPath?.(uuid) ?? `/patra/download_mc/${encodeURIComponent(uuid)}?new=true`
   );
   const response = await fetch(url, { headers });
   if (!response.ok) {
      throw new Error(`Failed to fetch Patra model card "${uuid}": ${response.status}`);
   }
   return response.json();
}
