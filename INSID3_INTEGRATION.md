# INSID3 integration

Smart Labeler supports INSID3 in two browser workflows:

1. **Segmentation canvas** — the image currently open in Smart Labeler is the
   target. The user uploads a reference image and a same-sized binary reference
   mask. Returned INSID3 polygons are added as editable segmentation masks.
2. **INSID3 Lab (`/insid3`)** — the user uploads a reference image, reference
   mask, and target image from the local computer. The page renders the result
   over the target and offers JSON and PNG-mask downloads.

The INSID3 repository also serves a lightweight standalone page at `/demo`.

## Request flow

```text
Smart Labeler browser
        │  Tapis-Token + multipart files
        ▼
Smart Labeler Flask API /insid3/similar-objects
        │  private X-INSID3-Key + multipart files
        ▼
INSID3 FastAPI /v1/similar-objects (one worker per GPU)
        │
        ▼
polygons + boxes + optional PNG mask
```

The browser never receives `INSID3_API_KEY`. The GPU service should normally be
private and reachable only from the Smart Labeler backend.

## Local setup

### 1. Start INSID3

Start the new inference-service repository. Its default port is `2128`:

```bash
cd /home/chowdhury.207/INSID3-inference-service
export INSID3_API_KEY='replace-with-a-long-random-value'
conda env create -f environment.yml
conda activate insid3-service
python main.py
```

Wait until the model is ready:

```bash
curl http://127.0.0.1:2128/health/ready
```

The service serializes access to its model state. Do not run multiple
application workers on one GPU.

### 2. Use the standalone manual page immediately

From a local computer, create an SSH tunnel:

```bash
ssh -N -L 18001:127.0.0.1:2128 \
  chowdhury.207@u181.asc.ohio-state.edu
```

Open:

```text
http://127.0.0.1:18001/demo
```

Browser file choosers operate on the local computer. Select a reference image,
a same-sized binary mask, and a target image. Enter the API key in the page when
the service was started with `INSID3_API_KEY`.

### 3. Configure the Smart Labeler backend

The Flask process needs:

```bash
export INSID3_ENDPOINT='http://127.0.0.1:2128'
export INSID3_API_KEY='replace-with-a-long-random-value'
export INSID3_TIMEOUT_SECONDS='300'
```

`INSID3_API_KEY` must exactly match the value used to start FastAPI. Restart
Flask after changing these variables.

### 4. Rebuild and start the Smart Labeler frontend

The new Remix route and toolbar control require a frontend rebuild:

```bash
cd /home/chowdhury.207/smart_labeler/client
npm ci
npm run build
npm start
```

Set `API_BASE_URL` to the Flask URL before starting Remix, following the
existing Smart Labeler deployment configuration.

The repository-wide `npm run typecheck` currently reports unrelated legacy
errors in Storybook, Mantine date wrappers, and File Explorer components. The
production Remix build is the current deployment gate and succeeds with the
INSID3 integration.

Open the normal Smart Labeler frontend and select **INSID3 Lab** in the header,
or navigate directly to:

```text
http://SMART_LABELER_HOST/insid3
```

## Segmentation canvas workflow

1. Open a segmentation pipeline.
2. Select the target image in File Explorer.
3. Click the globe/search INSID3 icon in the canvas toolbar.
4. Upload the reference image and reference mask.
5. Enter the object label and optional component limits.
6. Click **Find Similar Objects**.
7. Review the green polygon masks in the canvas and edit/delete them normally.
8. Save the segmentation JSON or COCO JSON.

INSID3 masks are tagged with `source: "INSID3"` in Smart Labeler's native JSON
and shown with an INSID3 chip in the mask list. INSID3 does not return a
calibrated confidence score, so these annotations are not assigned a synthetic
confidence.

## Manual INSID3 Lab workflow

1. Log in to Smart Labeler.
2. Open **INSID3 Lab**.
3. Upload the reference image, reference mask, and target image.
4. Enter a label.
5. Click **Find Similar Objects**.
6. Inspect the polygon and box overlay.
7. Download `insid3-result.json` and/or `insid3-mask.png`.

The reference mask must have the same width and height as the reference image.
The target may have different dimensions.

## Kubernetes

The following manifests are provided:

- `k8s/insid3-deployment.yaml` — private one-replica GPU deployment, Redis
  cache, model PVC, and ClusterIP service. It mirrors the deployment contract
  from `/home/chowdhury.207/INSID3-inference-service` and creates no public
  INSID3 ingress.
- `k8s/deployment.yaml` — combined Smart Labeler deployment configured with
  `INSID3_ENDPOINT=http://insid3-service`.
- `k8s/server-deployment.yaml` — server-only deployment with the same proxy
  configuration.

The add-on manifest uses the image published by the inference-service
repository. To build and publish a different tag instead:

```bash
cd /home/chowdhury.207/INSID3-inference-service
docker build -t REGISTRY/insid3-inference-service:TAG .
docker push REGISTRY/insid3-inference-service:TAG
```

Then update the `image` field in `k8s/insid3-deployment.yaml`.

Before applying `k8s/insid3-deployment.yaml`:

1. Confirm or pin the INSID3 image tag.
2. Populate the created `insid3-models` PVC with the gated DINOv3 checkpoint,
   or create `insid3-secrets` with an authorized `INSID3_CHECKPOINT_URL`.
3. Optionally set `INSID3_API_KEY` in `insid3-secrets`; both services read this
   one shared secret.
4. Confirm that the cluster has an NVIDIA A10 GPU node and device plugin, or
   adjust the manifest's node affinity for the available GPU.

Apply the private model service before Smart Labeler:

```bash
kubectl apply -f k8s/insid3-deployment.yaml -n YOUR_NAMESPACE
kubectl apply -f k8s/deployment.yaml -n YOUR_NAMESPACE
```

Use `k8s/server-deployment.yaml` instead of `k8s/deployment.yaml` when the
frontend and backend are deployed separately.

No public INSID3 ingress is required. Only Smart Labeler's frontend and Flask
backend need public routes.

## Validation

Check the direct service:

```bash
curl http://127.0.0.1:2128/health/ready
```

Check the proxy with a valid Tapis token:

```bash
curl -H "Tapis-Token: $TAPIS_TOKEN" \
  http://127.0.0.1:11112/insid3/health
```

Then validate `/insid3` with a reference image, a same-sized binary reference
mask, and a target image. A successful cross-image request reports
`mode: "cross-image"` and returns editable object polygons.
