export interface TapisVaultConfig {
   /** Base URL of the Tapis tenant, called directly (e.g. https://icicleai.tapis.io). */
   tapisBaseUrl?: string;
   /** Tapis tenant id the vault secret is scoped under. */
   tenant?: string;
   /**
    * Route the vault read/write through a backend of your own instead of calling
    * Tapis directly. A proxy can derive the Tapis username server-side from the
    * token, so `tapisUsername` becomes optional when one is configured. Set to
    * `null` to go back to calling Tapis directly.
    */
   proxy?: TapisVaultProxyConfig | null;
}

export interface TapisVaultProxyConfig {
   /** Base URL of the proxying backend (e.g. https://labeler-api.example.com). */
   baseUrl: string;
   /** Path of the HF-token vault endpoint (GET reads, POST writes). Default: `/api/vault/secret/hftoken`. */
   secretPath?: string;
   /** Header the proxy expects the Tapis token in. Default: `Tapis-Token`. */
   tokenHeader?: string;
}

// Matches TAPIS_BASE_URL / TENANT's defaults in server/flask_server.py.
let _tapisBaseUrl = "https://icicleai.tapis.io";
let _tenant = "icicleai";
let _proxy: TapisVaultProxyConfig | null = null;

export function configureTapisVault(cfg: TapisVaultConfig): void {
   if (cfg.tapisBaseUrl) _tapisBaseUrl = cfg.tapisBaseUrl.replace(/\/+$/, "");
   if (cfg.tenant) _tenant = cfg.tenant;
   if (cfg.proxy !== undefined) {
      _proxy = cfg.proxy ? { ...cfg.proxy, baseUrl: cfg.proxy.baseUrl.replace(/\/+$/, "") } : null;
   }
}

// Tapis vault path segment this secret lives under — distinct from the key
// inside its secretMap. Matches the smart-labeler backend's
// /api/vault/secret/hftoken route and its VaultSecretWrite {"data": {"HF_TOKEN": ...}} body.
const HF_SECRET_NAME = "hftoken";
const HF_SECRET_KEY = "HF_TOKEN";

const proxyUrl = (p: TapisVaultProxyConfig) => `${p.baseUrl}${p.secretPath ?? "/api/vault/secret/hftoken"}`;
const proxyHeader = (p: TapisVaultProxyConfig, token: string) => ({ [p.tokenHeader ?? "Tapis-Token"]: token });

/**
 * Checks whether a Hugging Face token is already stored in the user's Tapis
 * vault. Tapis vault secrets are addressed by tenant + username, not just the
 * token — so when calling Tapis directly the caller must supply the username.
 * A configured proxy derives it server-side and the argument is ignored.
 */
export async function checkHfSecretExists(token: string, tapisUsername?: string): Promise<boolean> {
   try {
      if (_proxy) {
         const res = await fetch(proxyUrl(_proxy), { headers: proxyHeader(_proxy, token) });
         if (!res.ok) return false;
         const data = await res.json();
         // Proxies differ in how deeply they unwrap the Tapis response; accept
         // any of the shapes that carry a value.
         const maybeSecret =
            data?.result?.secretMap?.[HF_SECRET_KEY] ??
            data?.result?.secret ??
            data?.result?.value ??
            data?.result?.data ??
            data?.secret ??
            data?.value;
         return Boolean(maybeSecret);
      }

      const url = `${_tapisBaseUrl}/v3/security/vault/secret/user/${HF_SECRET_NAME}?tenant=${encodeURIComponent(_tenant)}&user=${encodeURIComponent(tapisUsername ?? "")}`;
      const res = await fetch(url, { headers: { "X-Tapis-Token": token } });
      if (!res.ok) return false;
      const data = await res.json();
      return Boolean(data?.result?.secretMap?.[HF_SECRET_KEY]);
   } catch (e) {
      console.warn("Secret check failed or secret not found:", e);
      return false;
   }
}

export async function saveHfTokenToVault(
   hfToken: string,
   tapisToken: string,
   tapisUsername?: string
): Promise<{ success: boolean; error?: string }> {
   if (!hfToken.trim()) {
      return { success: false, error: "Please enter a Hugging Face token." };
   }

   const request: { url: string; headers: Record<string, string>; body: unknown } = _proxy
      ? {
           url: proxyUrl(_proxy),
           headers: proxyHeader(_proxy, tapisToken),
           body: { data: { [HF_SECRET_KEY]: hfToken.trim() } },
        }
      : {
           url: `${_tapisBaseUrl}/v3/security/vault/secret/user/${HF_SECRET_NAME}`,
           headers: { "X-Tapis-Token": tapisToken },
           body: { tenant: _tenant, user: tapisUsername ?? "", data: { [HF_SECRET_KEY]: hfToken.trim() } },
        };

   try {
      const response = await fetch(request.url, {
         method: "POST",
         headers: { "Content-Type": "application/json", ...request.headers },
         body: JSON.stringify(request.body),
      });

      if (!response.ok) {
         const errorText = await response.text();
         return { success: false, error: errorText || "Failed to save token" };
      }

      return { success: true };
   } catch (e: any) {
      return { success: false, error: e?.message || "Failed to save Hugging Face token." };
   }
}
