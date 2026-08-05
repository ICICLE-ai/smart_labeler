export interface TapisVaultConfig {
   /** Base URL of the Tapis tenant, called directly (e.g. https://icicleai.tapis.io). */
   tapisBaseUrl?: string;
   /** Tapis tenant id the vault secret is scoped under. */
   tenant?: string;
}

// Matches TAPIS_BASE_URL / TENANT's defaults in server/flask_server.py.
let _tapisBaseUrl = "https://icicleai.tapis.io";
let _tenant = "icicleai";

export function configureTapisVault(cfg: TapisVaultConfig): void {
   if (cfg.tapisBaseUrl) _tapisBaseUrl = cfg.tapisBaseUrl.replace(/\/+$/, "");
   if (cfg.tenant) _tenant = cfg.tenant;
}

// Tapis vault path segment this secret lives under — distinct from the key
// inside its secretMap. Matches the smart-labeler backend's
// /api/vault/secret/hftoken route and its VaultSecretWrite {"data": {"HF_TOKEN": ...}} body.
const HF_SECRET_NAME = "hftoken";
const HF_SECRET_KEY = "HF_TOKEN";

/**
 * Checks whether a Hugging Face token is already stored in the user's Tapis
 * vault. Tapis vault secrets are addressed by tenant + username, not just the
 * token — the smart-labeler backend used to derive the username server-side
 * from the token (`auth.get_username`); calling Tapis directly means the
 * caller must supply it.
 */
export async function checkHfSecretExists(token: string, tapisUsername: string): Promise<boolean> {
   const url = `${_tapisBaseUrl}/v3/security/vault/secret/user/${HF_SECRET_NAME}?tenant=${encodeURIComponent(_tenant)}&user=${encodeURIComponent(tapisUsername)}`;
   try {
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
   tapisUsername: string
): Promise<{ success: boolean; error?: string }> {
   if (!hfToken.trim()) {
      return { success: false, error: "Please enter a Hugging Face token." };
   }

   const url = `${_tapisBaseUrl}/v3/security/vault/secret/user/${HF_SECRET_NAME}`;
   try {
      const response = await fetch(url, {
         method: "POST",
         headers: { "Content-Type": "application/json", "X-Tapis-Token": tapisToken },
         body: JSON.stringify({ tenant: _tenant, user: tapisUsername, data: { [HF_SECRET_KEY]: hfToken.trim() } }),
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
