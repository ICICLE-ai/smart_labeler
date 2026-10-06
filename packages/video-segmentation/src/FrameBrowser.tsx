import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
   Alert, Box, Button, Chip, CircularProgress, IconButton, MenuItem, Paper, Select, Slider, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import type { ChunkPlan } from "./types";
import { chunkFrameUrl, fetchFrameObjectUrl, prepareChunk, Sam3VideoError } from "./sam3VideoClient";

/** How many frames on either side of the current one to keep warm. */
const PREFETCH_RADIUS = 4;

/**
 * Pause after a frame settles before warming its neighbours. Stepping with the
 * arrow buttons or the keyboard arrives faster than this, so a run of steps
 * spends its bandwidth on the frames being looked at rather than on neighbours
 * of frames already left behind.
 */
const PREFETCH_IDLE_MS = 250;

/**
 * A frame image together with the frame index it belongs to.
 *
 * The pairing is the point: frame loads are async, so a consumer handed a bare
 * URL can end up drawing frame N's masks over frame N-1's pixels while a load
 * is still in flight. Consumers compare `frameIdx` against what they are
 * rendering and wait when it does not match.
 */
export interface LoadedFrame {
   frameIdx: number;
   url: string;
}

export interface FrameBrowserProps {
   uploadId: string;
   chunks: ChunkPlan[];
   currentFrame: number;
   onFrameChange: (frameIdx: number) => void;
   /** Frame indices marked as keyframes, rendered as slider marks. */
   keyframeIndices: Set<number>;
   /** The loaded frame, paired with its index. Null while nothing is ready yet. */
   onFrameReady: (frame: LoadedFrame | null) => void;
   /** Raised for failures the user needs to know about (chunk prepare / frame fetch). */
   onError?: (message: string) => void;
   disabled?: boolean;
}

/**
 * Chunk selector + frame slider over the SAM3 Video Service's chunked frame
 * endpoints. `frame_idx` throughout is the service's own decoded-frame index —
 * never derived from video time × fps, so scrubbing here always lines up with
 * what the tracker (and every other endpoint) means by the same number.
 *
 * Frames are full-size JPEGs fetched one request each, often over an SSH
 * tunnel, so the component is careful about how many it asks for: the slider
 * loads the frame it is *released* on rather than every value it passes
 * through, superseded requests are aborted, and neighbours are warmed only once
 * the frame on screen has arrived.
 */
export function FrameBrowser({
   uploadId,
   chunks,
   currentFrame,
   onFrameChange,
   keyframeIndices,
   onFrameReady,
   onError,
   disabled,
}: FrameBrowserProps) {
   const chunkForFrame = useCallback(
      (frame: number) => chunks.find((c) => frame >= c.save_start && frame <= c.save_end) ?? chunks[0],
      [chunks],
   );

   const [chunkIndex, setChunkIndex] = useState(() => chunkForFrame(currentFrame)?.chunk_index ?? 0);
   const [preparedChunks, setPreparedChunks] = useState<Set<number>>(new Set());
   const [preparing, setPreparing] = useState(false);
   const [frameLoading, setFrameLoading] = useState(false);
   const [prepareError, setPrepareError] = useState<string | null>(null);
   const [prepareAttempt, setPrepareAttempt] = useState(0);
   const [jumpValue, setJumpValue] = useState("");
   /**
    * Where the slider thumb is while the user is dragging it. Only the released
    * value is committed upward as the frame to load — dragging across fifty
    * frames otherwise fired fifty requests, each for a full-size JPEG, and the
    * frame actually wanted queued up behind all of them.
    */
   const [scrubFrame, setScrubFrame] = useState<number | null>(null);

   // frame_idx -> object URL. Persists across chunk switches; evicted outside
   // the prefetch window so long videos don't grow this unbounded.
   const cacheRef = useRef<Map<number, string>>(new Map());
   /**
    * Requests still in flight, keyed by frame. The promise is shared so a frame
    * already being prefetched when the user lands on it is awaited rather than
    * requested a second time; the controller lets superseded ones be dropped.
    */
   const inflightRef = useRef<Map<number, { controller: AbortController; promise: Promise<string> }>>(new Map());
   const loadTokenRef = useRef(0);

   const activeChunk = chunks.find((c) => c.chunk_index === chunkIndex) ?? chunks[0];
   const isPrepared = activeChunk ? preparedChunks.has(activeChunk.chunk_index) : false;

   // Revoke every cached object URL when this browser goes away or the upload changes.
   useEffect(() => {
      const cache = cacheRef.current;
      const inflight = inflightRef.current;
      return () => {
         inflight.forEach(({ controller }) => controller.abort());
         inflight.clear();
         cache.forEach((objUrl) => URL.revokeObjectURL(objUrl));
         cache.clear();
      };
   }, [uploadId]);

   // Re-sync the chunk selector when the current frame moves outside it
   // (e.g. stepping across a chunk boundary).
   useEffect(() => {
      const owner = chunkForFrame(currentFrame);
      if (owner && owner.chunk_index !== chunkIndex) setChunkIndex(owner.chunk_index);
   }, [currentFrame, chunkForFrame, chunkIndex]);

   // Prepare (extract frames for) the active chunk before browsing it.
   useEffect(() => {
      if (!activeChunk || preparedChunks.has(activeChunk.chunk_index)) return;
      let cancelled = false;
      const index = activeChunk.chunk_index;
      setPreparing(true);
      setPrepareError(null);
      prepareChunk(uploadId, index)
         .then(() => {
            if (cancelled) return;
            setPreparedChunks((prev) => new Set(prev).add(index));
         })
         .catch((e) => {
            if (cancelled) return;
            const message = e instanceof Sam3VideoError
               ? e.message
               : `Could not extract frames for chunk ${index}: ${e instanceof Error ? e.message : String(e)}`;
            setPrepareError(message);
            onError?.(message);
         })
         .finally(() => { if (!cancelled) setPreparing(false); });
      return () => { cancelled = true; };
      // `prepareAttempt` lets the retry button re-run this without clearing state.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [uploadId, activeChunk?.chunk_index, preparedChunks, prepareAttempt]);

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

   /** Drops every in-flight request except the one frame still wanted. */
   const abortInflightExcept = (keepFrame: number) => {
      inflightRef.current.forEach(({ controller }, frame) => {
         if (frame !== keepFrame) {
            controller.abort();
            inflightRef.current.delete(frame);
         }
      });
   };

   const fetchFrame = (frame: number, chunk: ChunkPlan): Promise<string> => {
      const cached = cacheRef.current.get(frame);
      if (cached) return Promise.resolve(cached);
      // Already being fetched — usually by a prefetch the user has just caught
      // up with. Share that request instead of issuing a second one.
      const existing = inflightRef.current.get(frame);
      if (existing) return existing.promise;

      const controller = new AbortController();
      const promise = fetchFrameObjectUrl(chunkFrameUrl(uploadId, chunk.chunk_index, frame), controller.signal)
         .then((objUrl) => { cacheRef.current.set(frame, objUrl); return objUrl; })
         .finally(() => { inflightRef.current.delete(frame); });
      inflightRef.current.set(frame, { controller, promise });
      return promise;
   };

   // Load the committed frame, then warm its neighbours once it has arrived.
   useEffect(() => {
      if (!activeChunk || !isPrepared) return;
      const token = ++loadTokenRef.current;
      const frame = currentFrame;
      let cancelled = false;
      let prefetchTimer: ReturnType<typeof setTimeout> | null = null;

      evictOutsideWindow(frame);
      // Whatever was being fetched for a frame we have moved off is wasted
      // bandwidth on a tunnel; drop it before asking for this one.
      abortInflightExcept(frame);

      /**
       * Warm neighbours nearest-first and one at a time. Ten parallel requests
       * for 100 KB JPEGs saturate a tunnel and slow down the very frame the
       * user is waiting for.
       */
      const warmNeighbours = async () => {
         for (let d = 1; d <= PREFETCH_RADIUS && !cancelled; d++) {
            for (const f of [frame + d, frame - d]) {
               if (cancelled || token !== loadTokenRef.current) return;
               if (f < activeChunk.save_start || f > activeChunk.save_end) continue;
               if (cacheRef.current.has(f)) continue;
               try { await fetchFrame(f, activeChunk); } catch { /* best-effort */ }
            }
         }
      };

      const scheduleWarm = () => {
         prefetchTimer = setTimeout(() => {
            if (!cancelled && token === loadTokenRef.current) void warmNeighbours();
         }, PREFETCH_IDLE_MS);
      };

      const cached = cacheRef.current.get(frame);
      if (cached) {
         onFrameReady({ frameIdx: frame, url: cached });
         setFrameLoading(false);
         scheduleWarm();
      } else {
         setFrameLoading(true);
         // Clear the displayed frame so consumers stop rendering the previous
         // one's pixels against this frame's annotations.
         onFrameReady(null);
         fetchFrame(frame, activeChunk)
            .then((objUrl) => {
               if (cancelled || token !== loadTokenRef.current) return;
               onFrameReady({ frameIdx: frame, url: objUrl });
               setFrameLoading(false);
               scheduleWarm();
            })
            .catch((e) => {
               if (cancelled || token !== loadTokenRef.current) return;
               setFrameLoading(false);
               // An aborted request means the user moved on; that is not a failure.
               if (e?.name === "AbortError" || /cancelled/i.test(e?.message ?? "")) return;
               const message = e instanceof Sam3VideoError
                  ? e.message
                  : `Could not load frame ${frame}: ${e instanceof Error ? e.message : String(e)}`;
               onError?.(message);
            });
      }

      return () => {
         cancelled = true;
         if (prefetchTimer) clearTimeout(prefetchTimer);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [currentFrame, activeChunk?.chunk_index, isPrepared]);

   const marks = useMemo(() => {
      if (!activeChunk) return [];
      return [...keyframeIndices]
         .filter((f) => f >= activeChunk.save_start && f <= activeChunk.save_end)
         .map((f) => ({ value: f }));
   }, [keyframeIndices, activeChunk]);

   if (!activeChunk) return null;

   const step = (delta: number) => {
      const next = currentFrame + delta;
      const owner = chunks.find((c) => next >= c.save_start && next <= c.save_end);
      if (owner) onFrameChange(next);
   };

   const firstFrame = chunks[0]?.save_start ?? 0;
   const lastFrame = chunks[chunks.length - 1]?.save_end ?? 0;
   const isKeyframe = keyframeIndices.has(currentFrame);
   const scrubbing = scrubFrame !== null;
   // The readout follows the thumb while dragging, so the number tracks the hand
   // even though no frame is fetched until release.
   const displayFrame = scrubFrame ?? currentFrame;

   const handleJump = () => {
      const target = Number(jumpValue);
      if (!Number.isFinite(target)) return;
      const clamped = Math.min(Math.max(Math.round(target), firstFrame), lastFrame);
      onFrameChange(clamped);
      setJumpValue("");
   };

   return (
      <Paper variant="outlined" sx={{ px: 2, py: 1.5, borderRadius: 2 }}>
         <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1, flexWrap: "wrap", rowGap: 1 }}>
            <Select
               size="small"
               value={chunkIndex}
               onChange={(e) => {
                  const idx = Number(e.target.value);
                  const target = chunks.find((c) => c.chunk_index === idx);
                  if (target) onFrameChange(target.save_start);
                  setChunkIndex(idx);
               }}
               disabled={disabled}
               sx={{ minWidth: 190 }}
            >
               {chunks.map((c) => (
                  <MenuItem key={c.chunk_index} value={c.chunk_index}>
                     Chunk {c.chunk_index + 1} of {chunks.length} · {c.save_start}–{c.save_end}
                  </MenuItem>
               ))}
            </Select>

            <Stack direction="row" alignItems="center">
               <Tooltip title="Previous frame">
                  <IconButton size="small" onClick={() => step(-1)} disabled={disabled || currentFrame <= firstFrame}>
                     <NavigateBeforeIcon />
                  </IconButton>
               </Tooltip>
               <Typography variant="body2" sx={{ minWidth: 110, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                  Frame <strong>{displayFrame}</strong> / {lastFrame}
               </Typography>
               <Tooltip title="Next frame">
                  <IconButton size="small" onClick={() => step(1)} disabled={disabled || currentFrame >= lastFrame}>
                     <NavigateNextIcon />
                  </IconButton>
               </Tooltip>
            </Stack>

            <TextField
               size="small"
               placeholder="Go to frame"
               value={jumpValue}
               onChange={(e) => setJumpValue(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") handleJump(); }}
               disabled={disabled}
               sx={{ width: 120 }}
            />

            {isKeyframe && !scrubbing && (
               <Chip
                  size="small"
                  color="primary"
                  icon={<BookmarkIcon sx={{ fontSize: "0.9rem !important" }} />}
                  label="Keyframe"
                  sx={{ height: 22, fontSize: "0.7rem", fontWeight: 700 }}
               />
            )}

            <Box sx={{ flex: 1 }} />
            {scrubbing ? (
               <Typography variant="caption" color="text.secondary">
                  Release to load frame {scrubFrame}
               </Typography>
            ) : (preparing || frameLoading) ? (
               <Stack direction="row" spacing={0.75} alignItems="center">
                  <CircularProgress size={14} />
                  <Typography variant="caption" color="text.secondary">
                     {preparing ? "Extracting this chunk's frames…" : "Loading frame…"}
                  </Typography>
               </Stack>
            ) : null}
         </Stack>

         <Slider
            value={displayFrame}
            min={activeChunk.save_start}
            max={activeChunk.save_end}
            step={1}
            marks={marks}
            // Dragging only moves the thumb; the frame is fetched once on release.
            onChange={(_, v) => setScrubFrame(v as number)}
            onChangeCommitted={(_, v) => {
               setScrubFrame(null);
               onFrameChange(v as number);
            }}
            disabled={disabled || preparing || Boolean(prepareError)}
            valueLabelDisplay="auto"
            sx={{
               // Keyframe marks need to read as bookmarks rather than tick noise.
               "& .MuiSlider-mark": { height: 10, width: 3, borderRadius: 1, bgcolor: "primary.main", opacity: 1 },
               "& .MuiSlider-markActive": { bgcolor: "primary.dark" },
            }}
         />

         {prepareError && (
            <Alert
               severity="error"
               sx={{ mt: 1 }}
               action={
                  <Button color="inherit" size="small" onClick={() => setPrepareAttempt((n) => n + 1)}>
                     Retry
                  </Button>
               }
            >
               {prepareError}
            </Alert>
         )}

         {!prepareError && (
            <Typography variant="caption" color="text.secondary">
               Frames come from the GPU service, so the numbers here are the exact indices the tracker uses.
               Marks on the slider are your keyframes. Drag the slider and release to jump — frames load on release.
            </Typography>
         )}
      </Paper>
   );
}

export default FrameBrowser;
