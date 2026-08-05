import type { Sam3Client } from "./types";

/**
 * Builds a `Sam3Client` that POSTs to `{endpoint}/predict`, matching the
 * request shape the ICICLE SAM3 inference service expects. Pass this (or
 * your own `Sam3Client` implementation) to `ImageCanvas` via the
 * `sam3Client` prop, or just pass `sam3Endpoint` and let `ImageCanvas`
 * build one for you.
 */
export function createFetchSam3Client(endpoint: string): Sam3Client {
   return {
      async predict(payload, token) {
         if (!endpoint) {
            throw new Error(
               "ImageCanvas: provide a `sam3Endpoint` or `sam3Client` prop to use SAM3-assisted annotation."
            );
         }
         const response = await fetch(`${endpoint.replace(/\/+$/, "")}/predict`, {
            method: "POST",
            headers: {
               "Content-Type": "application/json",
               token: token ?? "",
            },
            body: JSON.stringify(payload),
         });
         if (!response.ok) throw new Error("SAM3 prediction failed");
         return response.json();
      },
   };
}
