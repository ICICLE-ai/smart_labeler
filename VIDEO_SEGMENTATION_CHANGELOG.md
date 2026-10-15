# Changelog — Video Segmentation & Tracking

All notable changes to the video segmentation & tracking service (`@icicle-ai/video-segmentation` and its integration into the Smart Labeler client) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Requests behind the auth gateway now carry the Tapis token in an `X-Tapis-Token` header on every call, not only at sign-in. When Smart Labeler is embedded in another site (e.g. a Tapis iframe) the gateway's session cookie is third-party and dropped by the browser, so sign-in succeeded but every later request arrived anonymous. Video uploads (XHR) send the header too. The cookie is still used for the `EventSource` progress stream, which cannot send custom headers.

## [0.1.0] — 2026-10-12

First release of video segmentation & tracking: upload a video, annotate a few keyframes with the existing segmentation canvas, and track every object through the whole video with the SAM3 Video Service.

### Added

#### Pipeline & navigation

- New pipeline type `VIDEO_SEGMENTATION` with its own workspace at `/video-segmentation/:id`.
- Dashboard: a segmentation deployment lists image and video pipelines side by side under **Images** / **Videos** tabs, and the **New Pipeline** modal asks *What will you annotate?* (image or video).
- `ANNOTATOR_TYPE=VIDEO_SEGMENTATION` runs an instance dedicated to video pipelines.
- `PipelineTypeGuard`: opening a pipeline in the wrong workspace (e.g. a video pipeline through the image annotator URL) shows a notice with a link to the right workspace instead of letting the user annotate output the pipeline cannot use.
- Dashboard distinguishes an expired Tapis sign-in (401/403) from other failures when pipelines cannot be listed.

#### Workspace

- Five-step guided workflow — **Upload video → Add objects → Annotate keyframes → Track → Review & export** — with a hint for the active step and a collapsible "How video tracking works here" primer.
- **Service status** check on load: reports whether the SAM3 Video Service is reachable, which address was tried, the signed-in user, and whether the service is in mock mode or still loading model weights. Actions that need the service are disabled while it is down, with a **Retry** button and tunnel/configuration hints.
- **Video upload** from this computer (drag and drop, with upload progress) or from **HPC storage** via Tapis (system + path, with a file browser). HPC videos are relayed through the browser because the GPU service accepts only multipart uploads.
- Readable upload errors for common failures: incomplete MP4 ("moov atom not found"), no video stream, service out of disk space, service unreachable.
- **Frame browser** over the service's chunked frame endpoints: chunk selector, frame slider, previous/next buttons, keyframe markers, and approximate elapsed time. Frames are addressed by decoded frame index, never timestamp, so variable-frame-rate videos stay aligned with the tracker. Only the frame the slider is released on is fetched, superseded requests are aborted, and neighbouring frames are pre-fetched once the current frame has loaded.
- **Object panel**: add, rename, and delete tracked objects, each with a stable tracker id and colour, plus per-object keyframe mask counts.
- **Keyframe annotation** reusing the image segmentation canvas: polygon tool and SAM3 single-click. Draw first, assign second — the **Assign this region** dialog asks which object (existing or new) a freshly drawn region belongs to, or discards it. Selecting an object first skips the question.
- **Tracking controls**: track both directions or forward only, optionally restrict to a frame range (with "set to current frame" shortcuts), and a single **Segment & track video** / **Track again** action. Live progress per chunk and frame, a stall warning when a running job reports no progress for a while, cancel, and clear failure messages.
- Job progress streams over Server-Sent Events, falling back to polling when SSE is buffered or stripped by a proxy. An error is reported only after several consecutive failures on both transports.
- **Results review** of tracked frames in **Overlay** or **Side by side** mode. Masks and frame are drawn only once both belong to the frame on screen, so masks never lag a frame behind while scrubbing. Correcting a frame hands it back to the annotation canvas as a new keyframe.
- **Export** of a finished job as an **Annotated MP4** or **COCO JSON**, downloaded locally or saved to an HPC system via Tapis (system, folder, filename).
- **Dataset export to HPC**: a server-side job on the auth gateway packages the extracted frames and, when a finished tracking job is attached, its masks and COCO into a `.tar` written directly to an HPC folder. Progress (extracting → archiving → uploading) survives closing the tab or reloading, and is picked back up by export id.
- **Start again** actions: **Clear results & redo**, **Clear all keyframes**, and **New video**, each behind a confirmation dialog.
- Workspace resume: objects and keyframe masks are saved per pipeline in the browser and restored on return.
- Keyboard shortcuts: **Enter** closes a polygon, **Esc** cancels the current tool, **Delete** removes the selected mask.

#### Security & service access

- Optional authenticating gateway in front of the SAM3 Video Service (`SAM3_VIDEO_AUTH=gateway`): the Tapis token is exchanged for a session cookie at `/auth/session`, which also authenticates the SSE progress stream. An expired session (401) is renewed from the Tapis token and the request retried once.
- Direct connections (e.g. an SSH tunnel to a GPU node) send no credentials, since the bare service's wildcard CORS origin rejects credentialed requests.
- Every request has a timeout (longer for chunk preparation and MP4 rendering), and transport failures are reported with the address in use and the likely causes — service down, tunnel closed, or page origin not allowed.

#### Configuration

- Client: `SAM3_VIDEO_URL`, `SAM3_VIDEO_AUTH`, `TAPIS_BASE_URL`, and `ANNOTATOR_TYPE`, documented in `client/.env.example`.
- `server/.env.example` documenting server settings, including which are not needed for video segmentation.

### Known limitations

- Workspace resume is held in the browser's `localStorage`, so it is tied to one browser on one machine. Another device sees the pipeline as new.
- The annotated MP4 is rendered on the first request after a job finishes, which can take several minutes on long videos.
- Dataset export to HPC requires the authenticating gateway; it is unavailable on a direct connection.
- The service runs one tracking job at a time.

[Unreleased]: https://github.com/ICICLE-ai/smart_labeler/compare/eec6ad6...HEAD
[0.1.0]: https://github.com/ICICLE-ai/smart_labeler/commit/eec6ad6
