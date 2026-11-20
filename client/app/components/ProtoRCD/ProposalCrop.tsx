import { Box, Center, Loader, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { Proposal } from "./api";
import { useImageRetries, type ImageStore } from "./imageStore";

/**
 * One proposal: its box plus some surrounding context, with the box outlined so
 * the reviewer judges exactly the region the triage decides on.
 */
export function ProposalCrop({
   proposal,
   images,
   size = 168,
   context = 0.25,
}: {
   proposal: Proposal;
   images: ImageStore;
   size?: number;
   /** Extra margin on each side, as a fraction of the box size. */
   context?: number;
}) {
   const canvasRef = useRef<HTMLCanvasElement>(null);
   const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
   const [attempt, setAttempt] = useState(0);
   const retries = useImageRetries(images);

   // A retry asks again only if this crop failed.
   useEffect(() => {
      if (status === "error") setAttempt((a) => a + 1);
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [retries]);

   useEffect(() => {
      let cancelled = false;
      setStatus("loading");
      images.crop(proposal.file_name, proposal.bbox_xywh, context, size)
         .then(({ bitmap, box }) => {
            if (cancelled || !canvasRef.current) return;
            const canvas = canvasRef.current;
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(bitmap, 0, 0);
            ctx.strokeStyle = "#ffd43b";
            ctx.lineWidth = 2;
            ctx.strokeRect(...box);
            setStatus("ready");
         })
         .catch(() => !cancelled && setStatus("error"));
      return () => {
         cancelled = true;
      };
   }, [proposal, images, size, context, attempt]);

   return (
      <Box w={size} h={size} style={{ position: "relative", background: "#f1f3f5", borderRadius: 4 }}>
         <Center w={size} h={size} style={{ position: "absolute", inset: 0 }}>
            {status === "loading" && <Loader size="sm" />}
            {status === "error" && (
               <Text size="xs" c="dimmed" ta="center" px="xs">
                  Image unavailable
                  {images.failure(proposal.file_name) && <><br />{images.failure(proposal.file_name)}</>}
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
