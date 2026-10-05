export { VideoAnnotator } from "./VideoAnnotator";
export type { VideoAnnotatorProps } from "./VideoAnnotator";

export {
   configureVideoSegmentation, getVideoServiceBaseUrl, Sam3VideoError,
   uploadVideo, getUpload, listChunks, prepareChunk, chunkFrameUrl, singleFrameUrl, fetchFrameObjectUrl,
   startTrack, getTrackJob, cancelTrackJob, getTrackFrame, trackMaskPngUrl, trackCocoUrl, trackVideoUrl,
   fetchTrackVideo, fetchTrackCoco, subscribeTrackJob,
} from "./sam3VideoClient";
export type { VideoSegmentationConfig } from "./sam3VideoClient";

export type {
   UploadMeta, ChunkPlan, ChunksResponse, PrepareChunkResponse, MaskInput, KeyframeObjectPrompt,
   KeyframePrompt, TrackRequest, TrackJobStatus, TrackJob, TrackFrameObject, TrackFrameResult,
} from "./types";

export { objectColorCss, objectColorRgb, nextObjectId } from "./utils";
export type { VideoObject } from "./utils";
