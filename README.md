# Smart Labeler

A 7-step HPC-backed pipeline for few-shot object detection — from interactive image annotation through class support generation, proposal visualization, and Tapis-powered job execution — built to work across any research domain. Also includes a dedicated **Semantic Segmentation** pipeline for polygon and pixel-mask annotation with SAM3-assisted labeling.

### License

[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Tags:** AI4CI, CI4AI, Software

## References

- [Tapis v3 — HPC job execution framework](https://tapis-project.org)
- [Patra Model Registry — ICICLE AI model catalog](https://patra.pods.icicleai.tapis.io/)
- [SAHI — Slicing Aided Hyper Inference for small-object detection](https://github.com/obss/sahi)
- [COCO JSON format specification](https://cocodataset.org/#format-data)

## Acknowledgements

*National Science Foundation (NSF) funded AI institute for Intelligent Cyberinfrastructure with Computational Learning in the Environment (ICICLE) (OAC 2112606)*

## Issue reporting

Please open an issue at [github.com/OSU-SAI-Lab/smart-labeler/issues](https://github.com/OSU-SAI-Lab/smart-labeler/issues) with a description of the problem, steps to reproduce, and any relevant logs from the Tapis job status bar.

---

# Object Detection

## Tutorials

### Running Your First Detection Pipeline

A complete walkthrough from raw images to labeled detections in 7 steps.

#### Prerequisites

- Access to a Tapis-connected HPC system (Pitzer, Expanse, Ascend, or Cardinal)
- A Tapis account with a valid Slurm account to charge
- A directory of images on a Tapis filesystem
- (Optional) A Hugging Face token for gated models such as SAM3 or BioClip

#### Getting Started

Navigate to the home page and click **Get Started** or **Dashboard**.

![Home Page](./doc/images2/home_page_sl.png)

From the dashboard you can create a new pipeline or resume an existing one.

![Dashboard](./doc/images2/dashboard_sl.png)

Click **Create New Pipeline**, enter a pipeline name, select the job type (*Object Detection*), and provide a Slurm account. Click **Create New Job**.

![Create New Pipeline](./doc/images2/dashboard_new_pipeline_sl.png)

![Create New Pipeline Form](./doc/images2/dashboard_create_new_sl.png)

In order to upload data from your system to HPC click on upload button.

![Upload Files](./doc/images2/upload_files.png)

#### Step 1 — Annotate Images

Open **Step 1 — Image Annotator** from the pipeline navigation bar.

![Annotator Interface](./doc/images/annotator/Annotator-initial.png)

In the **File Explorer** panel, select a compute system and enter the path to your image directory. Click **Get Images**.

![File Explorer](./doc/images/annotator/File-explorer.png)

Click any image thumbnail to open it in the canvas. Draw bounding boxes by clicking and dragging on the canvas, then assign a label to each box.

![Annotation Canvas](./doc/images/annotator/annotator.png)

To use SAM3 assisted annotation, select **Single Click** mode, enter a label, then click an object in the image to auto-generate a box.

![SAM3 Single Click](./doc/images/annotator/SAM3-single-click.png)

Or use **Text Prompt** mode to run prediction over the whole image from a comma-separated label list.

![SAM3 Text Prompt](./doc/images/annotator/SAM3-text-prompt.png)

When finished, click **Save Annotations** and choose a remote Tapis path to store the COCO JSON file.

#### Step 2 — Generate Class Supports

Open **Step 2 — Generate Class Supports**.

![Generate Class Supports](./doc/images/class_supports/generate_class_support.png)

Enter a job name, select Proposer and Embedder models from the Patra catalog, and set crop/patch sizes (e.g. `[2048, 1024, 512]`). Click **Submit** and monitor job progress in the pipeline status bar.

#### Step 3 — Optimize Patch Size

Open **Step 3 — Optimize Patch Size** once the Step 2 job finishes. Use the File Explorer to navigate your images. Click each result file in the right panel to compare ground-truth vs. predicted boxes for each crop size.

![Optimize Patch Size](./doc/images/class_supports/optimize_patch_size.png)

Check the **IoU Graph** to identify which patch size produces the highest scores.

![IoU Graph](./doc/images/class_supports/optimize_patch_size_graph.png)

Note the optimal patch size and proceed to the next step.

#### Step 4 — Configure Detection Job

Open **Step 4 — Configure Detection Job**. Enter a configuration name, provide a query image path or directory, select models and thresholds, and optionally enable SAHI tiling. Click **Submit** to queue the detection job.

![Configure Detection Job](./doc/images/proposals/configure_detection_job.png)

![Configure Detection Job — Advanced](./doc/images/proposals/configure_detection_job_2.png)

![Configure Detection Job — HPC configuration](./doc/images2/proposal_config_3.png)

#### Step 5 — Visualize Proposals

Open **Step 5 — Visualize Proposals** once the detection job completes. Select a proposal file from the right panel. Drag the objectness threshold slider to filter boxes in real time.

![Visualize Proposals](./doc/images/proposals/visualize_proposals.png)

Use the **Objectness Score Graph** to find a natural cutoff point.

![Objectness Score Graph](./doc/images/proposals/visualize_proposals_graph.png)

Click **Save** to store the threshold for use in classification.

#### Step 6 — Configure Classification Job

Open **Step 6 — Configure Classification Job**. Add one or more Proposal → Class Support tensor mappings using the **Add Mapping** button. Set a similarity threshold and click **Submit**.

![Configure Classification Job](./doc/images/classification/configure_classification_job.png)

#### Step 7 — Review Results

Open **Step 7 — Object Classification**. Select a result file from the right panel and navigate images using the File Explorer. Drag the similarity threshold slider to filter results in real time. Click **Download** to export as COCO JSON or pipeline-native JSON.

![Classification Results](./doc/images/classification/visualize_classifications.png)

---

## How-To Guides

### How to Import Existing Annotations

1. In the **Image Annotator** (Step 1), click **Import Annotations**.
2. Choose **Browse** to upload a local file, or enter a remote Tapis filesystem path.
3. Select the file format (**COCO JSON** or **Default JSON**) using the Format Switch.

![Import Annotations](./doc/images/annotator/import_annotations.png)

### How to Save and Download Annotations

Click **Save Annotations** to write to a remote Tapis path, or **Download** to export to your local machine.

![Save Annotations](./doc/images/annotator/save_annotations.png)

![Download Annotations](./doc/images/annotator/download_annotations.png)

Both options support **COCO JSON** and **Default JSON** formats via the Format Switch.

### How to Resume a Pipeline

From the **Dashboard**, use the search or filter controls to locate your pipeline. Click **Goto** to re-enter at the last completed step.

![Existing Pipelines](./doc/images2/dashboard_existing_pipeline_sl.png)

![Search and Select Pipeline](./doc/images/create-select-job.png)

### How to Check Job Status and Logs

The **pipeline status bar** appears at the top of every step. Right-click any step chip to open the context menu.

![Status Bar](./doc/images/status_bar/status_bar.png)

![Status Bar Options](./doc/images/status_bar/status_bar_options.png)

- Select **Get Status** to poll the Tapis job and view status, condition, and last message.

![Get Status Modal](./doc/images/status_bar/status_bar_get_status.png)

- Select **Get Tapis Logs** to fetch and display `tapisjob.out` from the HPC run.

![Application Logs](./doc/images/status_bar/status_bar_application_logs.png)

### How to Use SAHI Tiling for Small Objects

Enable SAHI when your images are large and objects are small (e.g., aerial imagery, microscopy).

1. In **Step 2** or **Step 4**, toggle the **SAHI** switch.
2. Set a **Tile Size** (pixels) — a good starting point is `960`.
3. Set an **Overlap Ratio** (e.g. `0.25`) so adjacent tiles share context.
4. Submit as normal. Inference runs on each tile and results are merged with NMS.

### How to Set Up Hugging Face Access

Some models used by Smart Labeler (SAM3, DINOv3) are gated on Hugging Face and require an account, approved access, and a personal token. Complete all four steps in order.

#### Step 1 — Create a Hugging Face Account

Go to [huggingface.co](https://huggingface.co) and click **Sign Up**. Enter your email, choose a username and password, and verify your email address. Complete your profile (name, organization if applicable).

> **Tip:** Use a professional or institutional email address — it improves your chances of approval for gated models. If you already have an account, skip to Step 2.

#### Step 2 — Request Access to SAM3 and DINOv3

SAM3 and DINOv3 are gated models hosted by Meta. You must agree to their usage terms before you can use them. Approval for one model does **not** grant access to the other — request each separately.

**SAM3**

1. Open the SAM3 model page: [huggingface.co/facebook/sam3](https://huggingface.co/facebook/sam3)
2. Click **Request Access** and fill in your details (first name, last name, date of birth, country, affiliation, job title).
3. Accept the Meta Privacy Policy terms and click **Submit**.
4. You will see a confirmation that your request is pending review.
5. Once approved, the model page shows: *"Gated model — You have been granted access to this model."*

**DINOv3**

1. Open the DINOv3 model page: [huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m](https://huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m)
2. Repeat the same access request process as for SAM3.

> **Tip:** You will receive an email when approved. Check your spam folder if you don't see it after 24 hours.

#### Step 3 — Generate a Hugging Face Access Token

Once your access requests are approved, generate an API token so Smart Labeler can authenticate model downloads on your behalf.

1. Navigate to your token settings: [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
2. Click **+ Create new token**.
3. Set the **Token Type** to **Read** and give it a descriptive name (e.g., `ICICLE-TapisAccess`).
4. Click **Create token** and copy the value immediately — it is only shown once.

> **Warning:** Treat your token like a password. Do not share it or commit it to a repository. If you lose it, revoke it and generate a new one from the same settings page.

#### Step 4 — Add the Token in ICICLE / Tapis

With your token ready, add it to your ICICLE/Tapis credentials so it can be injected securely into HPC jobs.

1. Log in to your ICICLE/Tapis account.
2. Navigate to the **Settings** section indicated by 3 dots on the dashboard.
![Settings](./doc/images2/hf/dashboard_settings.png)
3. Click on Access Key.
4. Paste your token and save.
5. Click on Revoke token to permanently delete the token.
![Add or revoke token](./doc/images2/hf/add_or_revoke_hf.png)

---

### How to Use a Gated Hugging Face Model

Some models (e.g. DinoV3, certain SAM variants) require a Hugging Face token.

![Add token](./doc/images2/hf/gated_model_support.png)

1. When selecting a model in the Patra catalog, a prompt appears asking for your HF token.
2. Enter the token — it is stored securely in **Tapis Vault** and never exposed in logs.
3. On subsequent submissions the token is retrieved automatically from Vault and injected as `HF_TOKEN`.
4. Click **How to create one** to know how to create a Hugging Face token.
5. Click on the Request access link to be redirected to the exact model link.

### How to Export Results

1. In **Step 7**, click the **Download** icon in the results panel.
2. Choose **COCO JSON** for compatibility with tools like CVAT, Roboflow, or MMDetection.
3. Choose **Default JSON** for re-importing into a Smart Labeler pipeline.
4. Optionally save directly to a remote Tapis path instead of a local download.

---

## Explanation

### Pipeline Architecture

Smart Labeler is structured as a linear 7-step pipeline where each step produces outputs consumed by the next. The pipeline state is persisted in a PostgreSQL database and files are stored on Tapis-connected HPC filesystems, so work is never lost between sessions.

```
Step 1: Annotate          → ground-truth bounding boxes (COCO JSON)
Step 2: Class Supports    → embedding tensors per object class (.npz)
Step 3: Patch Optimizer   → optimal crop size for the dataset
Step 4: Detection Config  → detection job configuration snapshot
Step 5: Proposals         → raw object proposals + optimal objectness threshold
Step 6: Classification    → maps proposals to class supports, submits job
Step 7: Results           → final labeled detections, ready to export
```

### Few-Shot Detection Approach

Rather than fine-tuning a model from scratch, Smart Labeler uses a **few-shot, embedding-based** approach:

1. **Class supports** are embedding vectors extracted from annotated examples of each object class.
2. A **proposer model** (e.g., SAM3, OWLv2) generates candidate bounding boxes across the query images.
3. An **embedder model** (e.g., DINOv3, BioClip) embeds each proposal crop.
4. Proposals are **matched against class supports** by cosine similarity — no per-dataset retraining required.

This makes the pipeline domain-agnostic: the same workflow applies to wildlife camera traps, satellite imagery, microscopy slides, or any other image dataset.

### Tapis Integration

All compute-intensive steps run as **Tapis v3 batch jobs** on HPC clusters. Smart Labeler handles:

- Job definition and submission via the Tapis API
- Real-time status polling surfaced in the pipeline status bar
- Secure credential injection (Hugging Face tokens via Tapis Vault)
- File I/O through the Tapis Files API, keeping all data on the user's allocated storage

### SAM3 Inference Service

SAM3 (Segment Anything Model 3) runs as an **external microservice** separate from the HPC jobs. It is called synchronously during interactive annotation in Step 1. Two modes are supported:

- **Single Click** — user clicks a point on an object; SAM3 returns a bounding box.
- **Text Prompt** — user provides class names; SAM3 runs open-vocabulary detection across the full image.

Both modes optionally apply **SAHI tiling**, which partitions the image into overlapping crops before inference and merges the results — significantly improving recall for small or dense objects.

### Patra Model Registry

Proposer and embedder models are selected from the live **ICICLE AI Patra** model catalog. This means new models can be added to the catalog without any changes to Smart Labeler itself. Full model cards are accessible in-app via the info icon next to each model entry.

---

---

# Semantic Segmentation

A streamlined, HPC-backed pipeline dedicated exclusively to semantic and instance image segmentation using interactive masking tools and Tapis job execution.

## Quick Start

1. **Access the Application:** Navigate to the landing portal and select **Get Started**.
2. **Create a Segmentation Pipeline:** Enter a unique pipeline name, assign an authorized Slurm account, and initialize your workspace.
3. **Upload Dataset:** Transfer raw image directories from local environments to the cluster filesystem.
4. **Segment Images:** Utilize the interactive canvas to generate pixel-perfect masks or flag assets for manual review.
5. **Monitor & Export:** Track batch processing jobs over the Tapis framework and export masks to standard multi-class formats.

## Tutorials

### Running Your First Segmentation Pipeline

A complete walkthrough from raw images to labeled masks in 2 steps.

#### Prerequisites

- Access to a Tapis-connected HPC system (Pitzer, Expanse, Ascend, or Cardinal)
- A Tapis account with a valid Slurm account to charge
- A directory of images on a Tapis filesystem
- (Optional) A Hugging Face token for gated models such as SAM3

#### Getting Started

Navigate to the home page and click **Get Started** or **Dashboard**.

![Home Page](./doc/images_segmentation/home_segmentation.png)

From the dashboard you can create a new segmentation pipeline or resume an existing one. Existing pipelines are listed with their unique ID and an **Open Pipeline** button. If no pipelines exist yet, a **New Pipeline** button appears in the center of the page.

![Dashboard — Existing Pipeline](./doc/images_segmentation/dash_example_pipeline.png)

![Dashboard — Empty](./doc/images_segmentation/Dashboard_seg.png)

To upload images from your local machine to a Tapis storage system before starting, click **Upload Data** in the top-right corner of the dashboard.

![Upload Data](./doc/images_segmentation/upload_data_seg.png)

Click **+ New Pipeline** to open the creation modal. Provide a **Pipeline Name** and a **SLURM Account** (required). An optional **Description** field is also available. Click **Create & Open** to initialize the workspace.

![New Pipeline Modal](./doc/images_segmentation/new_pipeline_seg.png)

#### Step 1 — Project Setup & Data Upload

##### Remote Data Staging

If your images are not already on the cluster, upload them before launching the segmentation canvas. Click **Upload Data** from the dashboard to open the upload modal. Select a **Target System** (e.g. Pitzer (OSC)) and provide an absolute **Destination Path** on that system. Drag and drop files into the drop zone or use **Select Files** / **Select Directory** to browse locally, then click **Upload**.

![Upload Data to Tapis](./doc/images_segmentation/upload_data_seg.png)

##### Blank Pipeline & File Explorer

After creating a new pipeline, the **Image Annotator** canvas opens in a blank state. Click **Open File Explorer** (or the **File Explorer** tab on the left edge) to open the slide-out panel.

![Blank Pipeline](./doc/images_segmentation/image_annotator_blank6.png)

In the File Explorer, select a **System** from the dropdown and enter the full path to your source image directory in the **Source Image Directory** field. Click **Get Images** to load image previews. Click any filename in the list to open that image in the annotation canvas.

![File Explorer](./doc/images_segmentation/file_explorer7.png)

#### Step 2 — Interactive Image Segmentation

##### The Segmentation Workspace

The annotation canvas shifts away from traditional bounding-box layouts into a dedicated polygon and pixel-masking workflow. The interface provides several controls:

- **Toolbar Core Utilities** — icons at the top of the canvas for download, upload (import), save, and refresh.
- **Confidence Thresholding** — a slider on the right panel adjusts mask visibility and retention levels dynamically based on model-assisted proposals.
- **Review Flagging** — masks requiring secondary verification can be tagged with a **Needs Review** status. Custom flag names can also be added.
- **Dynamic Mask Listing** — the right panel keeps an active tally of polygon masks applied to the current image, grouped by label, with per-mask point counts, bounding boxes, and confidence scores.
- **Filter by Label / Flag** — click any label or flag chip in the right panel to filter the displayed masks.

The canvas toolbar (left to right): zoom in, zoom out, reset view, **Smart Click** (SAM3-assisted masking), bounding box draw mode, polygon draw mode, image mode, outline width selector, and clear all.

![Segmentation Workspace — Masks Applied](./doc/images_segmentation/image_annotator_blank6.png)

##### Drawing Masks Manually

1. Lock the canvas view using the lock icon (or the polygon draw mode button).
2. Click on the canvas to place polygon points around an object.
3. Click the first point (shown in green) to close the polygon and create the mask.
4. Assign or confirm a label for the mask in the right panel.

##### SAM3 Segmentation-Assisted Annotation

Click the **Smart Click** tool (magic wand icon) in the toolbar to open the SAM3 configuration panel. Two modes are available:

**Single Click mode** — enter a label, then click on any object in the image. SAM3 auto-generates a segmentation mask for that object.

**Text Prompt mode** — enter one or more comma-separated class labels (e.g. `cow, giraffe`). SAM3 runs open-vocabulary detection across the full image and returns masks for all matching objects.

Both modes expose the following settings:

- **Enable SAHI** — toggles Slicing Aided Hyper Inference, which divides the image into overlapping tiles before running inference. Significantly improves detection of small or densely packed objects in large images.
- **Crop Size (patch_size)** — tile size in pixels when SAHI is enabled (e.g. `640`). Smaller values catch finer details; larger values are faster.
- **Detection Confidence** — minimum confidence score (0–1) a detection must reach to be kept. Raise to reduce false positives; lower to catch more candidates.
- **Mask Precision** — controls how closely the mask contour follows object boundaries (0–1). Higher values produce finer, more detailed outlines; lower values give smoother, simplified shapes.

Click **Enter** to run inference, or **Exit** to close without running.

##### Finishing Up

When annotation is complete, click the **Save** icon in the toolbar. A **Save Annotations** modal opens where you select a cluster (e.g. `pitzer-tapis`), enter a remote **File Path** for the output JSON, and toggle between **COCO JSON** and **Default JSON** formats. A live format preview is shown before saving. Click **Save** to write the file to the Tapis filesystem.

To export to your local machine instead, click the **Download** icon and select **COCO JSON** or **Default JSON**.

To load an existing annotation file, click the **Import** (upload) icon. Choose a cluster and either browse for a local file or enter a remote path. Toggle the format switch to match the file format (**COCO JSON** or **Default JSON**) and click **Upload**.

## How-To Guides

### How to Create a Segmentation Pipeline

1. From the **Dashboard**, click **+ New Pipeline**.
2. Enter a **Pipeline Name** and a valid **SLURM Account**.
3. Optionally add a **Description**.
4. Click **Create & Open** — the Image Annotator canvas opens immediately.

### How to Upload Images to the Cluster

1. From the **Dashboard**, click **Upload Data**.
2. Select a **Target System** from the dropdown (e.g. Pitzer (OSC)).
3. Enter or browse to an absolute **Destination Path** on that system.
4. Drag and drop files into the upload zone, or click **Select Files** / **Select Directory**.
5. Click **Upload** to transfer.

### How to Use Smart Click (SAM3-Assisted Masking)

1. Open an image in the annotation canvas.
2. Click the **Smart Click** tool (magic wand / wand-with-sparkle icon) in the toolbar.
3. Select **Single Click** mode and enter a label, then click on an object to generate its mask automatically.
4. Optionally enable **SAHI** and adjust **Crop Size** for better coverage of small objects in large images.
5. Click **Enter** to apply.

### How to Use Text Prompt Annotation

1. Open an image in the annotation canvas.
2. Click the **Smart Click** tool and switch mode to **Text Prompt**.
3. Enter a comma-separated list of class names (e.g. `zebra, giraffe`).
4. Optionally enable **SAHI** for improved small-object recall.
5. Click **Enter** — SAM3 generates masks for all detected instances of those classes.

### How to Flag Masks for Review

1. In the right panel, locate the mask in the **Masks** list.
2. Click the flag icon next to a mask entry to mark it as **Needs Review**.
3. Use the **Filter by Flag** section at the top of the right panel to show only flagged masks.
4. Add custom flag names using the **New flag name...** field and the **+** button.

### How to Filter Masks by Label or Flag

- Click any label chip in the **Filter by Label** section to show only masks of that class.
- Click any flag chip in the **Filter by Flag** section to show only masks with that flag.
- Clicking an active chip again deselects it and shows all masks.

### How to Remove Low-Confidence Masks

1. Adjust the **Confidence** slider in the right panel to the desired threshold.
2. Click **Remove masks below score: X.XX** to permanently delete all masks under that threshold.

### How to Save Annotations to the Cluster

1. Click the **Save** (floppy disk) icon in the toolbar.
2. Select a cluster system from the dropdown.
3. Enter the full remote **File Path** (e.g. `/path/to/save/annotations.json`).
4. Toggle **COCO JSON** on or off to select the output format.
5. Click **Save**.

### How to Import Existing Annotations

1. Click the **Import** (upload arrow) icon in the toolbar.
2. Select the cluster from the dropdown or click **Browse File** to upload from your local machine.
3. Enter the remote path in **Or Enter File Path** if the file is already on the cluster.
4. Toggle the format switch to match your file (**COCO JSON** or **Default JSON**).
5. Click **Upload**.

### How to Download Annotations Locally

Click the **Download** icon in the toolbar and select **COCO JSON** or **Default JSON**. The file is saved directly to your local machine.

### How to Resume a Segmentation Pipeline

From the **Dashboard**, find the pipeline by name or ID using the search bar. Click **Open Pipeline** on the pipeline card to return to the Image Annotator at the current state.

## Explanation

### Segmentation Pipeline Architecture

The Semantic Segmentation pipeline is a focused 2-step workflow optimized for mask-based annotation. Pipeline state is persisted in a PostgreSQL database and output files are stored on Tapis-connected HPC filesystems.

```
Step 1: Project Setup & Data Upload  → images staged to Tapis filesystem
Step 2: Interactive Image Segmentation → polygon/pixel masks (COCO JSON or Default JSON)
```

### Annotation Approach

The segmentation workflow uses **polygon masking** rather than bounding boxes, producing pixel-level boundaries for each object instance. Masks can be:

- **Drawn manually** by placing polygon points on the canvas.
- **Auto-generated** using SAM3 in Single Click or Text Prompt mode, with optional SAHI tiling for large images or small objects.

Each mask records point coordinates, bounding box, confidence score, and label. The right panel dynamically lists all masks with per-mask metadata and inline controls for editing, flagging, and deletion.

### Output Formats

Two export formats are supported throughout the pipeline:

- **COCO JSON** — standard format compatible with annotation tools (CVAT, Roboflow) and training frameworks (MMDetection, Detectron2).
- **Default JSON** — tool-native format for round-tripping annotations back into Smart Labeler.

### SAM3 and SAHI

SAM3 (Segment Anything Model 3) runs as an external microservice called synchronously from the annotation canvas. SAHI (Slicing Aided Hyper Inference) partitions large images into overlapping tiles before inference, then merges results — significantly improving recall for small or densely packed objects.

### Tapis Integration

The segmentation pipeline leverages the Tapis Files API for all remote file I/O, keeping image data and annotation outputs on the user's allocated HPC storage. The Upload Data modal on the dashboard provides a direct path to stage local data to any Tapis-connected system before annotation begins.
