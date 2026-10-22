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

/**
 * Builds a `Sam3Client` that POSTs to `{endpoint}/predict/upload`, sending the
 * image itself as multipart form data rather than a Tapis path. For images that
 * exist only in the browser or another service — such as video frames — and so
 * cannot be fetched by the SAM3 service from Tapis.
 *
 * The image is sent on every request. For point prompts the service checks its
 * embedding cache (keyed on `pipe_id` + `image_id`) first and discards the file
 * on a hit, so `image_id` must be unique per distinct image.
 */
export function createUploadSam3Client(
   endpoint: string,
   getImage: () => Promise<Blob>,
): Sam3Client {
   return {
      async predict(payload) {
         if (!endpoint) {
            throw new Error(
               "ImageCanvas: provide a `sam3Endpoint` or `sam3Client` prop to use SAM3-assisted annotation."
            );
         }
         // The image travels with the request, so these would only point the
         // service at a Tapis file that does not exist.
         const { image_path: _path, system_id: _system, ...request } = payload;
         const form = new FormData();
         form.append("request", JSON.stringify(request));
         form.append("file", await getImage(), `${String(payload.image_id ?? "image")}.jpg`);
         const response = await fetch(`${endpoint.replace(/\/+$/, "")}/predict/upload`, {
            method: "POST",
            body: form,
         });
         if (!response.ok) throw new Error("SAM3 prediction failed");
         return response.json();
      },
   };
}
