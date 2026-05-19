import { fetchAndReturnData, getBaseURL } from "./utils";

const HF_SECRET_NAME = "HF_TOKEN";

export const checkSecretExists = async (token: string): Promise<boolean> => {
   try {
      const res: any = await fetchAndReturnData(
         `/api/vault/secret/hftoken`,
         token
      );
      const maybeSecret =
         res?.result?.secret ??
         res?.result?.value ??
         res?.result?.data ??
         res?.secret ??
         res?.value;
      return Boolean(maybeSecret);
   } catch (e) {
      console.warn("Secret check failed or secret not found:", e);
      return false;
   }
};

export const saveHfTokenToVault = async (
   hfToken: string,
   tapisToken: string
): Promise<{ success: boolean; error?: string }> => {
   if (!hfToken.trim()) {
      return { success: false, error: "Please enter a Hugging Face token." };
   }

   try {
      const response = await fetch(`${getBaseURL()}/api/vault/secret/hftoken`, {
         method: "POST",
         headers: {
            "Content-Type": "application/json",
            "Tapis-Token": tapisToken,
         },
         body: JSON.stringify({ "data": { "HF_TOKEN": hfToken.trim() } }),
      });

      if (!response.ok) {
         const errorText = await response.text();
         return { success: false, error: errorText || "Failed to save token" };
      }

      return { success: true };
   } catch (e: any) {
      return { success: false, error: e?.message || "Failed to save Hugging Face token." };
   }
};

export const getHfSecretName = () => HF_SECRET_NAME;
