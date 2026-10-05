import { useEffect, useMemo, useRef, useState } from "react";
import { Box, CircularProgress, MenuItem, Select, Slider, Stack, Typography } from "@mui/material";
import type { ChunkPlan } from "./types";
import { chunkFrameUrl, fetchFrameObjectUrl, prepareChunk } from "./sam3VideoClient";

/** How many frames on either side of the current one to keep warm. */
const PREFETCH_RADIUS = 5;

export interface FrameBrowserProps {
   uploadId: string;
   chunks: ChunkPlan[];
   currentFrame: number;
   onFrameChange: (frameIdx: number) => void;
   /** Frame indices marked as keyframes, rendered as slider marks. */
   keyframeIndices: Set<number>;
   /** The object URL of the frame currently ready to display (null while loading). */
   onFrameUrlChange: (url: string | null) => void;
   disabled?: boolean;
}

/**
 * Chunk selector + frame slider over the SAM3 Video Service's chunked frame
 * endpoints. `frame_idx` throughout is the service's own decoded-frame index —
 * never derived from video time × fps, so scrubbing here always lines up with
 * what the tracker (and every other endpoint) means by the same number.
 */
export function FrameBrowser({
   uploadId,
   chunks,
   currentFrame,
   onFrameChange,
   keyframeIndices,
   onFrameUrlChange,
   disabled,
}: FrameBrowserProps) {
   const chunkForFrame = (frame: number) =>
      chunks.find((c) => frame >= c.save_start && frame <= c.save_end) ?? chunks[0];

   const [chunkIndex, setChunkIndex] = useState(() => chunkForFrame(currentFrame)?.chunk_index ?? 0);
   const [preparedChunks, setPreparedChunks] = useState<Set<number>>(new Set());
   const [preparing, setPreparing] = useState(false);
   const [frameLoading, setFrameLoading] = useState(false);

   // frame_idx -> object URL. Persists across chunk switches; evicted outside
   // the prefetch window so long videos don't grow this unbounded.
   const cacheRef = useRef<Map<number, string>>(new Map());
   const inflightRef = useRef<Set<number>>(new Set());
   const loadTokenRef = useRef(0);

   const activeChunk = chunks.find((c) => c.chunk_index === chunkIndex) ?? chunks[0];

   // Re-sync the chunk selector when the current frame moves outside it
   // (e.g. arrow-key navigation crossing a chunk boundary).
   useEffect(() => {
      const owner = chunkForFrame(currentFrame);
      if (owner && owner.chunk_index !== chunkIndex) setChunkIndex(owner.chunk_index);
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [currentFrame]);

   // Prepare (extract frames for) the active chunk before browsing it.
   useEffect(() => {
      if (!activeChunk || preparedChunks.has(activeChunk.chunk_index)) return;
      let cancelled = false;
      setPreparing(true);
      prepareChunk(uploadId, activeChunk.chunk_index)
         .then(() => {
            if (cancelled) return;
            setPreparedChunks((prev) => new Set(prev).add(activeChunk.chunk_index));
         })
         .catch((e) => console.error("Failed to prepare chunk:", e))
         .finally(() => { if (!cancelled) setPreparing(false); });
      return () => { cancelled = true; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [uploadId, activeChunk?.chunk_index, preparedChunks]);

   const evictOutsideWindow = (center: number) => {
      const lo = center - PREFETCH_RADIUS * 3;
      const hi = center + PREFETCH_RADIUS * 3;
      for (const [frame, objUrl] of cacheRef.current.entries()) {
         if (frame < lo || frame > hi) {
            URL.revokeObjectURL(objUrl);
            cacheRef.current.delete(frame);
         }
      }
   };

   const fetchFrame = (frame: number, chunk: ChunkPlan): Promise<string> | null => {
      if (cacheRef.current.has(frame)) return Promise.resolve(cacheRef.current.get(frame)!);
      if (inflightRef.current.has(frame)) return null;
      inflightRef.current.add(frame);
      return fetchFrameObjectUrl(chunkFrameUrl(uploadId, chunk.chunk_index, frame))
         .then((objUrl) => { cacheRef.current.set(frame, objUrl); return objUrl; })
         .finally(() => inflightRef.current.delete(frame));
   };

   // Load the current frame (from cache if warm) and prefetch its neighbours.
   useEffect(() => {
      if (!activeChunk || !preparedChunks.has(activeChunk.chunk_index)) return;
      const token = ++loadTokenRef.current;
      evictOutsideWindow(currentFrame);

      const cached = cacheRef.current.get(currentFrame);
      if (cached) {
         onFrameUrlChange(cached);
      } else {
         setFrameLoading(true);
         onFrameUrlChange(null);
         fetchFrame(currentFrame, activeChunk)?.then((objUrl) => {
            if (token === loadTokenRef.current) { onFrameUrlChange(objUrl); setFrameLoading(false); }
         }).catch((e) => {
            if (token === loadTokenRef.current) { console.error("Failed to load frame:", e); setFrameLoading(false); }
         });
      }

      // Prefetch neighbours quietly — failures here aren't user-facing.
      for (let d = 1; d <= PREFETCH_RADIUS; d++) {
         for (const f of [currentFrame + d, currentFrame - d]) {
            if (f < activeChunk.save_start || f > activeChunk.save_end) continue;
            fetchFrame(f, activeChunk)?.catch(() => { /* best-effort */ });
         }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [currentFrame, activeChunk?.chunk_index, preparedChunks]);

   const marks = useMemo(() => {
      if (!activeChunk) return [];
      return [...keyframeIndices]
         .filter((f) => f >= activeChunk.save_start && f <= activeChunk.save_end)
         .map((f) => ({ value: f }));
   }, [keyframeIndices, activeChunk]);

   if (!activeChunk) return null;

   return (
      <Box sx={{ px: 1 }}>
         <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
            <Select
               size="small"
               value={chunkIndex}
               onChange={(e) => {
                  const idx = Number(e.target.value);
                  setChunkIndex(idx);
                  const target = chunks.find((c) => c.chunk_index === idx);
                  if (target) onFrameChange(target.save_start);
               }}
               disabled={disabled}
            >
               {chunks.map((c) => (
                  <MenuItem key={c.chunk_index} value={c.chunk_index}>
                     Chunk {c.chunk_index} ({c.save_start}–{c.save_end})
                  </MenuItem>
               ))}
            </Select>
            <Typography variant="body2" sx={{ minWidth: 90 }}>
               Frame {currentFrame}
            </Typography>
            {(preparing || frameLoading) && <CircularProgress size={16} />}
         </Stack>
         <Slider
            value={currentFrame}
            min={activeChunk.save_start}
            max={activeChunk.save_end}
            step={1}
            marks={marks}
            onChange={(_, v) => onFrameChange(v as number)}
            disabled={disabled || preparing}
            valueLabelDisplay="auto"
         />
      </Box>
   );
}

export default FrameBrowser;
