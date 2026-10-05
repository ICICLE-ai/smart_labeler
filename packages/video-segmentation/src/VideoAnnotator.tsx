import { useEffect, useMemo, useRef, useState } from "react";
import {
   Alert, Box, Button, Grid, Stack, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import {
   ImageCanvas, segmentationEngine, type SegmentationAnnotation,
} from "@icicle-ai/image-annotation-canvas";
import {
   cancelTrackJob, fetchTrackVideo, getTrackJob, getUpload, listChunks, startTrack, subscribeTrackJob, trackCocoUrl,
} from "./sam3VideoClient";
import { ObjectPanel } from "./ObjectPanel";
import { FrameBrowser } from "./FrameBrowser";
import { TrackControls } from "./TrackControls";
import { ResultsOverlay } from "./ResultsOverlay";
import { VideoUpload } from "./VideoUpload";
import type { ChunkPlan, KeyframePrompt, TrackJob, UploadMeta } from "./types";
import type { VideoObject } from "./utils";

export interface VideoAnnotatorProps {
   /** Identifies this pipeline — used only to key the resume state in localStorage. */
   pipeid: string;
   /** Auth token forwarded to SAM3 single-click/text-prompt requests on frames. */
   tapisToken?: string;
   /** Base URL of the SAM3-compatible `/predict` endpoint, for per-frame AI segmentation (separate from the SAM3 Video Service, which only tracks). */
   sam3Endpoint?: string;
}

const objKeyId = (objId: number) => `obj-${objId}`;
const objIdFromKey = (key: string) => Number(key.slice(4));

// frame_idx -> obj_id -> the object's current polygon mask on that frame.
type KeyframeMasks = Map<number, Map<number, SegmentationAnnotation>>;

function flattenPolygon(points: { x: number; y: number }[]): number[] {
   return points.flatMap((p) => [p.x, p.y]);
}

function resumeKey(pipeid: string) {
   return `video-segmentation:${pipeid}`;
}

function loadResumeState(pipeid: string): { uploadId?: string; jobId?: string } {
   try {
      const raw = localStorage.getItem(resumeKey(pipeid));
      return raw ? JSON.parse(raw) : {};
   } catch {
      return {};
   }
}

function saveResumeState(pipeid: string, state: { uploadId?: string; jobId?: string }) {
   try { localStorage.setItem(resumeKey(pipeid), JSON.stringify(state)); } catch { /* best effort */ }
}

export function VideoAnnotator({ pipeid, tapisToken, sam3Endpoint }: VideoAnnotatorProps) {
   const [uploadMeta, setUploadMeta] = useState<UploadMeta | null>(null);
   const [chunks, setChunks] = useState<ChunkPlan[]>([]);
   const [loadingResume, setLoadingResume] = useState(true);
   const [resumeError, setResumeError] = useState<string | null>(null);

   const [currentFrame, setCurrentFrame] = useState(0);
   const [frameUrl, setFrameUrl] = useState<string | null>(null);

   const [objects, setObjects] = useState<VideoObject[]>([]);
   const [activeObjectId, setActiveObjectId] = useState<number | null>(null);
   const [keyframeMasks, setKeyframeMasks] = useState<KeyframeMasks>(new Map());

   const [job, setJob] = useState<TrackJob | null>(null);
   const [mode, setMode] = useState<"annotate" | "review">("annotate");
   const unsubscribeRef = useRef<(() => void) | null>(null);
   const [videoDownloading, setVideoDownloading] = useState(false);
   const [exportError, setExportError] = useState<string | null>(null);

   // ── Resume from a previous session ──
   useEffect(() => {
      const { uploadId, jobId } = loadResumeState(pipeid);
      if (!uploadId) { setLoadingResume(false); return; }
      Promise.all([getUpload(uploadId), listChunks(uploadId)])
         .then(([meta, chunksRes]) => {
            setUploadMeta(meta);
            setChunks(chunksRes.chunks);
            if (jobId) {
               getTrackJob(jobId).then((j) => {
                  setJob(j);
                  if (j.status === "done") setMode("review");
                  if (j.status === "queued" || j.status === "running") subscribeToJob(jobId);
               }).catch(() => { /* stale job id — ignore */ });
            }
         })
         .catch((e) => setResumeError(e instanceof Error ? e.message : String(e)))
         .finally(() => setLoadingResume(false));
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [pipeid]);

   useEffect(() => () => { unsubscribeRef.current?.(); }, []);

   const subscribeToJob = (jobId: string) => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = subscribeTrackJob(jobId, (j) => {
         setJob(j);
         if (j.status === "done") setMode("review");
      }, (e) => console.error("Track job subscription failed:", e));
   };

   const handleUploaded = (meta: UploadMeta) => {
      setUploadMeta(meta);
      setCurrentFrame(0);
      setObjects([]);
      setActiveObjectId(null);
      setKeyframeMasks(new Map());
      setJob(null);
      setMode("annotate");
      saveResumeState(pipeid, { uploadId: meta.upload_id });
      listChunks(meta.upload_id).then((res) => setChunks(res.chunks)).catch((e) => setResumeError(String(e)));
   };

   // ── Keyframe annotation (reuses the existing segmentation canvas/tools) ──
   const currentFrameMasks = keyframeMasks.get(currentFrame);
   const displayedAnnotations: SegmentationAnnotation[] = currentFrameMasks
      ? [...currentFrameMasks.values()]
      : [];

   const activeObject = objects.find((o) => o.id === activeObjectId) ?? null;

   const mutateFrame = (frame: number, fn: (objMap: Map<number, SegmentationAnnotation>) => Map<number, SegmentationAnnotation>) => {
      setKeyframeMasks((prev) => {
         const next = new Map(prev);
         const existing = next.get(frame) ?? new Map<number, SegmentationAnnotation>();
         const updated = fn(new Map(existing));
         if (updated.size === 0) next.delete(frame);
         else next.set(frame, updated);
         return next;
      });
   };

   // Whichever tool created it (manual, SAM3-click, SAM3-text), a new mask is
   // always attached to the object currently selected in the panel — object
   // identity here always comes from "select object, then annotate", not from
   // whatever label the drawing tool happened to assign.
   const handleAddition = (added: SegmentationAnnotation[]) => {
      if (!added.length) return;
      if (activeObjectId == null) { alert("Select or add an object first."); return; }
      const points = added[0].points;
      mutateFrame(currentFrame, (objMap) => {
         objMap.set(activeObjectId, { id: objKeyId(activeObjectId), label: activeObject?.label ?? `object_${activeObjectId}`, points });
         return objMap;
      });
   };

   const handleUpdate = (id: string, updates: Partial<SegmentationAnnotation>) => {
      const objId = objIdFromKey(id);
      mutateFrame(currentFrame, (objMap) => {
         const existing = objMap.get(objId);
         if (existing) objMap.set(objId, { ...existing, ...updates });
         return objMap;
      });
   };

   const handleDelete = (ids: string[]) => {
      mutateFrame(currentFrame, (objMap) => {
         ids.forEach((id) => objMap.delete(objIdFromKey(id)));
         return objMap;
      });
   };

   const maskCountByObject = useMemo(() => {
      const counts = new Map<number, number>();
      keyframeMasks.forEach((objMap) => objMap.forEach((_, objId) => counts.set(objId, (counts.get(objId) ?? 0) + 1)));
      return counts;
   }, [keyframeMasks]);

   const keyframeIndices = useMemo(() => new Set(keyframeMasks.keys()), [keyframeMasks]);

   // ── Tracking ──
   const handleStartTrack = (opts: { direction: "forward" | "both"; startFrame: number | null; endFrame: number | null }) => {
      if (!uploadMeta) return;
      const keyframes: KeyframePrompt[] = [...keyframeMasks.entries()].map(([frameIdx, objMap]) => ({
         frame_idx: frameIdx,
         objects: [...objMap.entries()].map(([objId, ann]) => ({
            obj_id: objId,
            label: objects.find((o) => o.id === objId)?.label,
            mask: { polygons: [flattenPolygon(ann.points)] },
         })),
      }));
      startTrack(uploadMeta.upload_id, {
         keyframes,
         direction: opts.direction,
         start_frame: opts.startFrame,
         end_frame: opts.endFrame,
      })
         .then((j) => {
            setJob(j);
            saveResumeState(pipeid, { uploadId: uploadMeta.upload_id, jobId: j.job_id });
            subscribeToJob(j.job_id);
         })
         .catch((e) => alert(`Could not start tracking: ${e instanceof Error ? e.message : String(e)}`));
   };

   const handleCancelTrack = () => {
      if (!job) return;
      cancelTrackJob(job.job_id).then(setJob).catch((e) => console.error("Cancel failed:", e));
   };

   // ── Export ──
   const downloadBlob = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
   };

   const handleDownloadVideo = () => {
      if (!job) return;
      setExportError(null);
      setVideoDownloading(true);
      fetchTrackVideo(job.job_id)
         .then((blob) => downloadBlob(blob, `tracked_${job.job_id.slice(0, 8)}.mp4`))
         .catch((e) => setExportError(e instanceof Error ? e.message : String(e)))
         .finally(() => setVideoDownloading(false));
   };

   if (loadingResume) return <Typography sx={{ p: 3 }}>Loading…</Typography>;

   if (!uploadMeta) {
      return (
         <Box>
            {resumeError && <Alert severity="error" sx={{ m: 2 }}>{resumeError}</Alert>}
            <VideoUpload onUploaded={handleUploaded} />
         </Box>
      );
   }

   return (
      <Grid container spacing={2} sx={{ p: 2 }}>
         <Grid size={9}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
               <Typography variant="body2" color="text.secondary">
                  {uploadMeta.original_filename ?? uploadMeta.upload_id} — {uploadMeta.frame_count} frames,
                  {" "}{uploadMeta.width}×{uploadMeta.height}
               </Typography>
               <ToggleButtonGroup
                  size="small"
                  value={mode}
                  exclusive
                  onChange={(_, v) => v && setMode(v)}
               >
                  <ToggleButton value="annotate">Annotate</ToggleButton>
                  <ToggleButton value="review" disabled={job?.status !== "done"}>Review results</ToggleButton>
               </ToggleButtonGroup>
            </Stack>

            <FrameBrowser
               uploadId={uploadMeta.upload_id}
               chunks={chunks}
               currentFrame={currentFrame}
               onFrameChange={setCurrentFrame}
               keyframeIndices={keyframeIndices}
               onFrameUrlChange={setFrameUrl}
               disabled={job?.status === "running" || job?.status === "queued"}
            />

            <Box sx={{ mt: 2 }}>
               {mode === "annotate" ? (
                  frameUrl && (
                     <ImageCanvas
                        engine={segmentationEngine}
                        annotations={displayedAnnotations}
                        onAddition={handleAddition}
                        selectedAnnotationId={activeObjectId != null ? objKeyId(activeObjectId) : null}
                        onSelection={() => { /* selection on the canvas is visual only; the object panel drives identity */ }}
                        onUpdate={handleUpdate}
                        deleteAnnotations={handleDelete}
                        file={frameUrl}
                        isEditable
                        setFileSize={() => { /* video dims are already known from upload metadata */ }}
                        isGraphEnabled={false}
                        fileName={`frame_${currentFrame}`}
                        score={0}
                        onImageLoaded={() => { /* no-op */ }}
                        defaultLabel={activeObject?.label}
                        tapisToken={tapisToken}
                        sam3Endpoint={sam3Endpoint}
                        pipeId={pipeid}
                     />
                  )
               ) : (
                  job && (
                     <>
                        <ResultsOverlay jobId={job.job_id} frameIdx={currentFrame} frameUrl={frameUrl} />
                        <Button sx={{ mt: 1 }} onClick={() => setMode("annotate")}>
                           Correct this frame
                        </Button>
                     </>
                  )
               )}
            </Box>
         </Grid>

         <Grid size={3}>
            <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
               <ObjectPanel
                  objects={objects}
                  onObjectsChange={setObjects}
                  activeObjectId={activeObjectId}
                  onActiveObjectChange={setActiveObjectId}
                  maskCountByObject={maskCountByObject}
                  disabled={job?.status === "running" || job?.status === "queued"}
               />
               <TrackControls
                  frameCount={uploadMeta.frame_count}
                  keyframeCount={keyframeMasks.size}
                  job={job}
                  onStart={handleStartTrack}
                  onCancel={handleCancelTrack}
               />
               {job?.status === "done" && (
                  <Box sx={{ p: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
                     <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Export</Typography>
                     <Stack spacing={1}>
                        <Button
                           variant="outlined"
                           startIcon={<DownloadIcon />}
                           href={trackCocoUrl(job.job_id)}
                           target="_blank"
                           rel="noreferrer"
                        >
                           COCO JSON
                        </Button>
                        <Button
                           variant="outlined"
                           startIcon={<DownloadIcon />}
                           onClick={handleDownloadVideo}
                           disabled={videoDownloading}
                        >
                           {videoDownloading ? "Rendering…" : "Annotated MP4"}
                        </Button>
                        {exportError && <Alert severity="error">{exportError}</Alert>}
                     </Stack>
                  </Box>
               )}
            </Box>
         </Grid>
      </Grid>
   );
}

export default VideoAnnotator;
