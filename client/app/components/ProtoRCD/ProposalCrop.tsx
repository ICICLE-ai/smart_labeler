import { Box, Center, Loader, Text } from "@mantine/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { getImage } from "~/utils/utils";
import type { Proposal } from "./api";
import { joinImagePath } from "./api";

const MAX_PARALLEL_FETCHES = 6;

/**
 * Loads source images from the HPC system once per file and shares them across
 * every crop cut from it. A batch often holds several proposals from the same
 * image, and each image can be several MB, so fetching per crop would multiply
 * the transfer. Object URLs are released when the owning page unmounts.
 */
export function useImageLoader(pipeId: string, system: string, imageDir: string, token: string) {
   const cache = useRef(new Map<string, Promise<HTMLImageElement>>());
   const urls = useRef<string[]>([]);
   const active = useRef(0);
   const queue = useRef<(() => void)[]>([]);

   useEffect(() => {
      const owned = urls.current;
      const images = cache.current;
      return () => {
         owned.forEach((u) => URL.revokeObjectURL(u));
         images.clear();
      };
   }, []);

   const throttled = useCallback(async <T,>(task: () => Promise<T>): Promise<T> => {
      if (active.current >= MAX_PARALLEL_FETCHES) {
         await new Promise<void>((resolve) => queue.current.push(resolve));
      }
      active.current += 1;
      try {
         return await task();
      } finally {
         active.current -= 1;
         queue.current.shift()?.();
      }
   }, []);

   return useCallback(
      (fileName: string): Promise<HTMLImageElement> => {
         const path = joinImagePath(imageDir, fileName);
         let entry = cache.current.get(path);
         if (!entry) {
            entry = throttled(async () => {
               const url = await getImage(path, pipeId, system, { "tapis-token": { access_token: token } });
               urls.current.push(url);
               const img = new Image();
               img.src = url;
               await img.decode();
               return img;
            });
            entry.catch(() => cache.current.delete(path));   // let a later render retry
            cache.current.set(path, entry);
         }
         return entry;
      },
      [pipeId, system, imageDir, token, throttled],
   );
}

export type ImageLoader = ReturnType<typeof useImageLoader>;

/**
 * One proposal: its box plus some surrounding context, with the box outlined so
 * the reviewer judges exactly the region the triage decides on.
 */
export function ProposalCrop({
   proposal,
   loadImage,
   size = 168,
   context = 0.25,
}: {
   proposal: Proposal;
   loadImage: ImageLoader;
   size?: number;
   /** Extra margin on each side, as a fraction of the box size. */
   context?: number;
}) {
   const canvasRef = useRef<HTMLCanvasElement>(null);
   const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

   useEffect(() => {
      let cancelled = false;
      setStatus("loading");
      loadImage(proposal.file_name)
         .then((img) => {
            if (cancelled || !canvasRef.current) return;
            const [x, y, w, h] = proposal.bbox_xywh;
            const sx = Math.max(0, x - w * context);
            const sy = Math.max(0, y - h * context);
            const sw = Math.min(img.naturalWidth, x + w * (1 + context)) - sx;
            const sh = Math.min(img.naturalHeight, y + h * (1 + context)) - sy;
            const scale = size / Math.max(sw, sh, 1);
            const canvas = canvasRef.current;
            canvas.width = Math.max(1, Math.round(sw * scale));
            canvas.height = Math.max(1, Math.round(sh * scale));
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = "#ffd43b";
            ctx.lineWidth = 2;
            ctx.strokeRect((x - sx) * scale, (y - sy) * scale, w * scale, h * scale);
            setStatus("ready");
         })
         .catch(() => !cancelled && setStatus("error"));
      return () => {
         cancelled = true;
      };
   }, [proposal, loadImage, size, context]);

   return (
      <Box w={size} h={size} style={{ position: "relative", background: "#f1f3f5", borderRadius: 4 }}>
         <Center w={size} h={size} style={{ position: "absolute", inset: 0 }}>
            {status === "loading" && <Loader size="sm" />}
            {status === "error" && (
               <Text size="xs" c="dimmed" ta="center" px="xs">
                  Image unavailable
               </Text>
            )}
            <canvas
               ref={canvasRef}
               style={{ display: status === "ready" ? "block" : "none", maxWidth: size, maxHeight: size }}
            />
         </Center>
      </Box>
   );
}
