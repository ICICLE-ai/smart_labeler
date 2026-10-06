import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
   Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
   Divider, Grid, Paper, Snackbar, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import VideoFileIcon from "@mui/icons-material/VideoFile";
import {
   ImageCanvas, segmentationEngine, type SegmentationAnnotation,
} from "@icicle-ai/image-annotation-canvas";
import {
   cancelTrackJob, getTrackJob, getUpload, listChunks, Sam3VideoError, startTrack, subscribeTrackJob,
} from "./sam3VideoClient";
import { ObjectPanel } from "./ObjectPanel";
import { FrameBrowser, type LoadedFrame } from "./FrameBrowser";
import { TrackControls } from "./TrackControls";
import { ResultsOverlay } from "./ResultsOverlay";
import { VideoUpload } from "./VideoUpload";
import { ExportPanel } from "./ExportPanel";
import { ServiceStatus, type ServiceState } from "./ServiceStatus";
import { WorkflowSteps } from "./WorkflowSteps";
import type { ChunkPlan, KeyframePrompt, TrackJob, UploadMeta } from "./types";
import type { VideoObject } from "./utils";
import {
   deserializeKeyframes, loadResumeState, objIdFromKey, objKeyId, saveResumeState, serializeKeyframes,
   type KeyframeMasks,
} from "./workspaceState";

export interface VideoAnnotatorProps {
   /** Identifies this pipeline — used only to key the resume state in localStorage. */
   pipeid: string;
   /** Auth token forwarded to SAM3 per-frame requests and to Tapis when saving exports to HPC. */
   tapisToken?: string;
   /** Base URL of the SAM3-compatible `/predict` endpoint, for per-frame AI segmentation (separate from the SAM3 Video Service, which only tracks). */
   sam3Endpoint?: string;
}

/** Stable empty array so the canvas does not re-sync against a fresh identity every render. */
const NO_MASKS: SegmentationAnnotation[] = [];

function flattenPolygon(points: { x: number; y: number }[]): number[] {
   return points.flatMap((p) => [p.x, p.y]);
}

/**
 * How long a running job may report no new frames before we suspect it is not
 * running at all. Generous because the first job after a service start spends
 * a minute or two loading SAM3 weights while reporting 0 frames done.
 */
const STALL_WARNING_MS = 5 * 60 * 1000;

/** Which destructive action the confirm dialog is asking about. */
type PendingReset = "results" | "keyframes" | "video" | null;

export function VideoAnnotator({ pipeid, tapisToken = "", sam3Endpoint }: VideoAnnotatorProps) {
   const [uploadMeta, setUploadMeta] = useState<UploadMeta | null>(null);
   const [chunks, setChunks] = useState<ChunkPlan[]>([]);
   const [loadingResume, setLoadingResume] = useState(true);

   const [currentFrame, setCurrentFrame] = useState(0);
   // The frame image together with the index it belongs to, so masks and pixels
   // are never drawn from different frames while a load is in flight.
   const [frame, setFrame] = useState<LoadedFrame | null>(null);

   const [objects, setObjects] = useState<VideoObject[]>([]);
   const [activeObjectId, setActiveObjectId] = useState<number | null>(null);
   const [keyframeMasks, setKeyframeMasks] = useState<KeyframeMasks>(new Map());

   const [job, setJob] = useState<TrackJob | null>(null);
   const [mode, setMode] = useState<"annotate" | "review">("annotate");
   const [serviceState, setServiceState] = useState<ServiceState>("checking");
   const [error, setError] = useState<string | null>(null);
   const [notice, setNotice] = useState<string | null>(null);
   const [pendingReset, setPendingReset] = useState<PendingReset>(null);
   const unsubscribeRef = useRef<(() => void) | null>(null);
   /** Last time the job reported something new, for spotting a job that has stopped progressing. */
   const jobProgressRef = useRef<{ signature: string; at: number }>({ signature: "", at: Date.now() });
   const [stalled, setStalled] = useState(false);
   /** Set once the restore pass has run, so the save effect cannot write over saved state with empty initial state. */
   const restoredRef = useRef(false);

   const report = useCallback((e: unknown, fallback: string) => {
      const message = e instanceof Sam3VideoError || e instanceof Error ? e.message : String(e);
      setError(message || fallback);
   }, []);

   const subscribeToJob = useCallback((jobId: string) => {
      unsubscribeRef.current?.();
      jobProgressRef.current = { signature: "", at: Date.now() };
      setStalled(false);
      unsubscribeRef.current = subscribeTrackJob(
         jobId,
         (j) => {
            // Any change in status/phase/frames counts as the job being alive.
            const signature = `${j.status}:${j.phase}:${j.frames_done}`;
            if (signature !== jobProgressRef.current.signature) {
               jobProgressRef.current = { signature, at: Date.now() };
               setStalled(false);
            }
            setJob(j);
            if (j.status === "done") setMode("review");
         },
         (e) => report(e, "Lost contact with the tracking job."),
      );
   }, [report]);

   // ── Resume a previous session ──
   useEffect(() => {
      const saved = loadResumeState(pipeid);
      const { uploadId, jobId } = saved;
      if (!uploadId) { restoredRef.current = true; setLoadingResume(false); return; }
      let cancelled = false;
      Promise.all([getUpload(uploadId), listChunks(uploadId)])
         .then(([meta, chunksRes]) => {
            if (cancelled) return;
            setUploadMeta(meta);
            setChunks(chunksRes.chunks);
            // The annotation work is restored from the browser; the job itself is
            // read back from the service, which has been running it all along.
            setObjects(saved.objects ?? []);
            setKeyframeMasks(deserializeKeyframes(saved.keyframes));
            if (saved.objects?.length) setActiveObjectId(saved.objects[0].id);
            if (typeof saved.currentFrame === "number") setCurrentFrame(saved.currentFrame);
            if (!jobId) return;
            return getTrackJob(jobId).then((j) => {
               if (cancelled) return;
               setJob(j);
               if (j.status === "done") setMode("review");
               if (j.status === "queued" || j.status === "running") subscribeToJob(jobId);
            }).catch(() => {
               // A job id the service no longer knows about (restarted, cleaned
               // up) must not block resuming the upload itself. Leaving `job`
               // null is enough — the save effect then drops the stale id.
            });
         })
         .catch((e) => {
            if (cancelled) return;
            report(e, "Could not restore your previous video session.");
         })
         .finally(() => { restoredRef.current = true; })
         .finally(() => { if (!cancelled) setLoadingResume(false); });
      return () => { cancelled = true; };
   }, [pipeid, report, subscribeToJob]);

   useEffect(() => () => { unsubscribeRef.current?.(); }, []);

   /**
    * Mirror the workspace into localStorage whenever it changes, so a reload,
    * a pipeline switch, or closing the browser all come back to the same place.
    * Debounced because dragging a polygon vertex changes state continuously.
    */
   useEffect(() => {
      if (!restoredRef.current) return;   // never write over saved state with initial empties
      const timer = setTimeout(() => {
         saveResumeState(pipeid, {
            uploadId: uploadMeta?.upload_id,
            jobId: job?.job_id,
            objects,
            keyframes: serializeKeyframes(keyframeMasks),
            currentFrame,
         });
      }, 400);
      return () => clearTimeout(timer);
   }, [pipeid, uploadMeta, job?.job_id, objects, keyframeMasks, currentFrame]);

   const handleUploaded = (meta: UploadMeta) => {
      setUploadMeta(meta);
      setCurrentFrame(0);
      setFrame(null);
      setObjects([]);
      setActiveObjectId(null);
      setKeyframeMasks(new Map());
      setJob(null);
      setMode("annotate");
      listChunks(meta.upload_id)
         .then((res) => setChunks(res.chunks))
         .catch((e) => report(e, "Could not read the video's chunk plan."));
   };

   // ── Keyframe annotation (reuses the existing segmentation canvas/tools) ──
   // Annotations are keyed to the frame actually on screen, not to the frame the
   // slider is on, so a mask can never be drawn over a different frame's pixels.
   const shownFrameIdx = frame?.frameIdx ?? null;
   const inSync = shownFrameIdx === currentFrame;

   const displayedAnnotations = useMemo(() => {
      if (shownFrameIdx === null) return NO_MASKS;
      const objMap = keyframeMasks.get(shownFrameIdx);
      return objMap ? [...objMap.values()] : NO_MASKS;
   }, [keyframeMasks, shownFrameIdx]);

   const activeObject = objects.find((o) => o.id === activeObjectId) ?? null;

   const mutateFrame = (
      frameIdx: number,
      fn: (objMap: Map<number, SegmentationAnnotation>) => Map<number, SegmentationAnnotation>,
   ) => {
      setKeyframeMasks((prev) => {
         const next = new Map(prev);
         const updated = fn(new Map(next.get(frameIdx) ?? new Map<number, SegmentationAnnotation>()));
         if (updated.size === 0) next.delete(frameIdx);
         else next.set(frameIdx, updated);
         return next;
      });
   };

   // Whichever tool created it (manual polygon, SAM3 click, SAM3 text), a new
   // mask is attached to the object selected in the panel — identity comes from
   // "select object, then annotate", not from the label a tool happened to set.
   // Writes land on the frame on screen, which is what the user drew on.
   const handleAddition = (added: SegmentationAnnotation[]) => {
      if (!added.length || shownFrameIdx === null) return;
      if (activeObjectId == null) {
         setError("Select an object in the Objects panel first — a mask has to belong to one.");
         return;
      }
      const points = added[0].points;
      mutateFrame(shownFrameIdx, (objMap) => {
         objMap.set(activeObjectId, {
            id: objKeyId(activeObjectId),
            label: activeObject?.label ?? `object_${activeObjectId}`,
            points,
         });
         return objMap;
      });
      if (added.length > 1) {
         setNotice(`Kept the first of ${added.length} masks — one mask per object per frame.`);
      }
   };

   const handleUpdate = (id: string, updates: Partial<SegmentationAnnotation>) => {
      if (shownFrameIdx === null) return;
      mutateFrame(shownFrameIdx, (objMap) => {
         const objId = objIdFromKey(id);
         const existing = objMap.get(objId);
         if (existing) objMap.set(objId, { ...existing, ...updates });
         return objMap;
      });
   };

   const handleDelete = (ids: string[]) => {
      if (shownFrameIdx === null) return;
      mutateFrame(shownFrameIdx, (objMap) => {
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

   // Deleting an object must not leave its masks behind as untracked orphans.
   const handleObjectsChange = (next: VideoObject[]) => {
      const removed = objects.filter((o) => !next.some((n) => n.id === o.id)).map((o) => o.id);
      setObjects(next);
      if (removed.length === 0) return;
      setKeyframeMasks((prev) => {
         const updated = new Map<number, Map<number, SegmentationAnnotation>>();
         prev.forEach((objMap, frameIdx) => {
            const kept = new Map(objMap);
            removed.forEach((id) => kept.delete(id));
            if (kept.size > 0) updated.set(frameIdx, kept);
         });
         return updated;
      });
   };

   // Renaming an object should relabel its existing masks too.
   useEffect(() => {
      setKeyframeMasks((prev) => {
         let changed = false;
         const updated = new Map<number, Map<number, SegmentationAnnotation>>();
         prev.forEach((objMap, frameIdx) => {
            const next = new Map(objMap);
            next.forEach((ann, objId) => {
               const label = objects.find((o) => o.id === objId)?.label;
               if (label && label !== ann.label) { next.set(objId, { ...ann, label }); changed = true; }
            });
            updated.set(frameIdx, next);
         });
         return changed ? updated : prev;
      });
   }, [objects]);

   // ── Tracking ──
   const jobActive = job?.status === "queued" || job?.status === "running";

   /**
    * Notice a job that has stopped reporting progress. The usual cause is the
    * GPU service going away mid-job — on HPC its allocation ends — which leaves
    * the persisted status at "running" forever with no worker behind it, so
    * polling would otherwise sit on a progress bar that never moves again.
    * Only "running" is watched: "queued" can legitimately wait a long time
    * behind someone else's job.
    */
   useEffect(() => {
      if (job?.status !== "running") { setStalled(false); return; }
      const id = setInterval(() => {
         if (Date.now() - jobProgressRef.current.at > STALL_WARNING_MS) setStalled(true);
      }, 30_000);
      return () => clearInterval(id);
   }, [job?.status]);

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
      setError(null);
      startTrack(uploadMeta.upload_id, {
         keyframes,
         direction: opts.direction,
         start_frame: opts.startFrame,
         end_frame: opts.endFrame,
      })
         .then((j) => {
            setJob(j);
            subscribeToJob(j.job_id);
         })
         .catch((e) => report(e, "Could not start tracking."));
   };

   const handleCancelTrack = () => {
      if (!job) return;
      cancelTrackJob(job.job_id)
         .then(setJob)
         .catch((e) => report(e, "Could not cancel the tracking job."));
   };

   // ── Clear / redo ──
   const applyReset = async (what: Exclude<PendingReset, null>) => {
      setPendingReset(null);
      setError(null);
      try {
         // A job still on the GPU has to be stopped before its results are dropped,
         // otherwise it keeps a queue slot for work nobody is waiting on.
         if (jobActive && job && (what === "results" || what === "video")) {
            await cancelTrackJob(job.job_id).catch(() => { /* already finished or gone */ });
         }
         unsubscribeRef.current?.();
         unsubscribeRef.current = null;

         if (what === "results") {
            setJob(null);
            setMode("annotate");
            setNotice("Results cleared. Adjust your keyframes and track again.");
         } else if (what === "keyframes") {
            setKeyframeMasks(new Map());
            setNotice("All keyframes cleared. Your objects were kept.");
         } else {
            setUploadMeta(null);
            setChunks([]);
            setFrame(null);
            setCurrentFrame(0);
            setObjects([]);
            setActiveObjectId(null);
            setKeyframeMasks(new Map());
            setJob(null);
            setMode("annotate");
            saveResumeState(pipeid, {});
            setNotice("Starting over — upload a video to begin.");
         }
      } catch (e) {
         report(e, "Could not clear the current results.");
      }
   };

   const resetCopy: Record<Exclude<PendingReset, null>, { title: string; body: string; confirm: string }> = {
      results: {
         title: "Clear tracking results?",
         body: "This workspace will forget this tracking job and go back to annotating, keeping your objects and keyframes so you can adjust them and run again. " +
            "Tracking is GPU work, so re-running takes as long as it did the first time. The files already produced stay on the service but will no longer be reachable from here.",
         confirm: "Clear results",
      },
      keyframes: {
         title: "Clear all keyframes?",
         body: "Every mask you have drawn on every frame will be removed. Your object list and labels are kept. This cannot be undone.",
         confirm: "Clear keyframes",
      },
      video: {
         title: "Start over with a new video?",
         body: "This clears the current video, its objects, every keyframe and any tracking results from this workspace, returning you to the upload screen. This cannot be undone.",
         confirm: "Start over",
      },
   };

   // ── Workflow position, for the stepper ──
   const activeStep = !uploadMeta ? 0
      : objects.length === 0 ? 1
         : keyframeMasks.size === 0 ? 2
            : !job || jobActive ? 3
               : 4;

   const exportStem = (uploadMeta?.original_filename ?? "video").replace(/\.[^.]+$/, "");

   if (loadingResume) {
      return (
         <Box sx={{ p: 4 }}>
            <Typography color="text.secondary">Restoring your video session…</Typography>
         </Box>
      );
   }

   if (!uploadMeta) {
      return (
         <Box sx={{ maxWidth: 900, mx: "auto", p: 3 }}>
            <WorkflowSteps activeStep={0} />
            <ServiceStatus onStateChange={setServiceState} />
            <VideoUpload onUploaded={handleUploaded} token={tapisToken} disabled={serviceState === "down"} />
            <Snackbar
               open={Boolean(error)}
               autoHideDuration={10_000}
               onClose={() => setError(null)}
               anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            >
               <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
            </Snackbar>
         </Box>
      );
   }

   return (
      <Box sx={{ p: 2, maxWidth: 1800, mx: "auto" }}>
         <WorkflowSteps activeStep={activeStep} />
         <ServiceStatus onStateChange={setServiceState} />

         <Grid container spacing={2} sx={{ mt: 0.5 }}>
            {/* ── Left: frame browser + canvas ── */}
            <Grid size={{ xs: 12, lg: 9 }}>
               <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap", rowGap: 1 }}>
                     <VideoFileIcon sx={{ color: "primary.main" }} />
                     <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" fontWeight={700} noWrap>
                           {uploadMeta.original_filename ?? uploadMeta.upload_id}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                           {uploadMeta.frame_count.toLocaleString()} frames · {uploadMeta.width}×{uploadMeta.height}
                           {uploadMeta.fps ? ` · ${uploadMeta.fps.toFixed(2)} fps` : ""} · {chunks.length} chunk{chunks.length === 1 ? "" : "s"}
                        </Typography>
                     </Box>
                     <Box sx={{ flex: 1 }} />
                     <ToggleButtonGroup
                        size="small"
                        value={mode}
                        exclusive
                        onChange={(_, v) => v && setMode(v)}
                     >
                        <ToggleButton value="annotate">
                           <EditIcon fontSize="small" sx={{ mr: 0.5 }} /> Annotate
                        </ToggleButton>
                        <Tooltip title={job?.status === "done" ? "" : "Available once tracking finishes"}>
                           <span>
                              <ToggleButton value="review" disabled={job?.status !== "done"}>
                                 <VisibilityIcon fontSize="small" sx={{ mr: 0.5 }} /> Review
                              </ToggleButton>
                           </span>
                        </Tooltip>
                     </ToggleButtonGroup>
                  </Stack>
               </Paper>

               <FrameBrowser
                  uploadId={uploadMeta.upload_id}
                  chunks={chunks}
                  currentFrame={currentFrame}
                  onFrameChange={setCurrentFrame}
                  keyframeIndices={keyframeIndices}
                  onFrameReady={setFrame}
                  onError={setError}
                  disabled={jobActive}
               />

               <Box sx={{ mt: 2 }}>
                  {mode === "annotate" ? (
                     <>
                        {activeObjectId == null && objects.length > 0 && (
                           <Alert severity="info" sx={{ mb: 1.5 }}>
                              Select an object on the right, then draw or click on the frame to annotate it.
                           </Alert>
                        )}
                        {objects.length === 0 && (
                           <Alert severity="info" sx={{ mb: 1.5 }}>
                              Add an object on the right to start annotating — every mask belongs to one tracked object.
                           </Alert>
                        )}
                        {job?.status === "done" && (
                           <Alert severity="warning" sx={{ mb: 1.5 }}>
                              You are editing keyframes after a completed run. Track again to apply these corrections,
                              or switch to Review to inspect the existing results.
                           </Alert>
                        )}
                        {activeObject && (
                           <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                              <Typography variant="caption" color="text.secondary">Annotating:</Typography>
                              <Chip size="small" label={activeObject.label} color="primary" sx={{ fontWeight: 700 }} />
                              <Typography variant="caption" color="text.secondary">
                                 on frame {currentFrame}
                              </Typography>
                           </Stack>
                        )}
                        {inSync && frame ? (
                           <ImageCanvas
                              engine={segmentationEngine}
                              annotations={displayedAnnotations}
                              onAddition={handleAddition}
                              selectedAnnotationId={activeObjectId != null ? objKeyId(activeObjectId) : null}
                              onSelection={(id) => {
                                 // Clicking a mask selects its object, keeping the
                                 // panel and the canvas talking about the same thing.
                                 if (id) setActiveObjectId(objIdFromKey(id));
                              }}
                              onUpdate={handleUpdate}
                              deleteAnnotations={handleDelete}
                              file={frame.url}
                              isEditable
                              setFileSize={() => { /* dimensions already known from the upload metadata */ }}
                              isGraphEnabled={false}
                              fileName={`frame_${frame.frameIdx}`}
                              score={0}
                              tapisToken={tapisToken}
                              sam3Endpoint={sam3Endpoint}
                              pipeId={pipeid}
                              defaultLabel={activeObject?.label}
                           />
                        ) : (
                           <Paper
                              variant="outlined"
                              sx={{
                                 height: "60vh", display: "flex", alignItems: "center", justifyContent: "center",
                                 borderRadius: 2, bgcolor: "action.hover",
                              }}
                           >
                              <Typography color="text.secondary">Loading frame {currentFrame}…</Typography>
                           </Paper>
                        )}
                     </>
                  ) : (
                     job && (
                        <>
                           <ResultsOverlay jobId={job.job_id} frameIdx={currentFrame} frame={frame} />
                           <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                              <Button
                                 variant="outlined"
                                 startIcon={<EditIcon />}
                                 onClick={() => setMode("annotate")}
                              >
                                 Correct this frame
                              </Button>
                              <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
                                 Drifted? Redraw the object here — this frame becomes another keyframe — then track again.
                              </Typography>
                           </Stack>
                        </>
                     )
                  )}
               </Box>
            </Grid>

            {/* ── Right: objects, tracking, export, reset ── */}
            <Grid size={{ xs: 12, lg: 3 }}>
               <Paper variant="outlined" sx={{ borderRadius: 2, position: "sticky", top: 16 }}>
                  <ObjectPanel
                     objects={objects}
                     onObjectsChange={handleObjectsChange}
                     activeObjectId={activeObjectId}
                     onActiveObjectChange={setActiveObjectId}
                     maskCountByObject={maskCountByObject}
                     disabled={jobActive}
                  />
                  <Divider />
                  <TrackControls
                     frameCount={uploadMeta.frame_count}
                     keyframeCount={keyframeMasks.size}
                     currentFrame={currentFrame}
                     job={job}
                     stalled={stalled}
                     onStart={handleStartTrack}
                     onCancel={handleCancelTrack}
                     disabled={serviceState === "down"}
                  />
                  {job?.status === "done" && (
                     <>
                        <Divider />
                        <ExportPanel jobId={job.job_id} stem={exportStem} token={tapisToken} />
                     </>
                  )}
                  <Divider />
                  <Box sx={{ p: 2 }}>
                     <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Start again</Typography>
                     <Stack spacing={1}>
                        <Button
                           size="small"
                           variant="outlined"
                           color="warning"
                           startIcon={<RestartAltIcon />}
                           onClick={() => setPendingReset("results")}
                           disabled={!job}
                        >
                           Clear results & redo
                        </Button>
                        <Button
                           size="small"
                           variant="outlined"
                           color="warning"
                           startIcon={<DeleteSweepIcon />}
                           onClick={() => setPendingReset("keyframes")}
                           disabled={keyframeMasks.size === 0 || jobActive}
                        >
                           Clear all keyframes
                        </Button>
                        <Button
                           size="small"
                           variant="outlined"
                           color="error"
                           startIcon={<VideoFileIcon />}
                           onClick={() => setPendingReset("video")}
                        >
                           New video
                        </Button>
                     </Stack>
                  </Box>
               </Paper>
            </Grid>
         </Grid>

         {/* ── Confirmation for destructive actions ── */}
         <Dialog open={pendingReset !== null} onClose={() => setPendingReset(null)} maxWidth="xs" fullWidth>
            {pendingReset && (
               <>
                  <DialogTitle>{resetCopy[pendingReset].title}</DialogTitle>
                  <DialogContent>
                     <DialogContentText sx={{ fontSize: "0.9rem" }}>
                        {resetCopy[pendingReset].body}
                     </DialogContentText>
                  </DialogContent>
                  <DialogActions>
                     <Button onClick={() => setPendingReset(null)}>Cancel</Button>
                     <Button
                        variant="contained"
                        color={pendingReset === "video" ? "error" : "warning"}
                        onClick={() => applyReset(pendingReset)}
                     >
                        {resetCopy[pendingReset].confirm}
                     </Button>
                  </DialogActions>
               </>
            )}
         </Dialog>

         <Snackbar
            open={Boolean(error)}
            autoHideDuration={10_000}
            onClose={() => setError(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
         >
            <Alert severity="error" onClose={() => setError(null)} sx={{ maxWidth: 640 }}>{error}</Alert>
         </Snackbar>
         <Snackbar
            open={Boolean(notice)}
            autoHideDuration={5_000}
            onClose={() => setNotice(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            message={notice ?? ""}
         />
      </Box>
   );
}

export default VideoAnnotator;
