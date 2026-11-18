import os

from db import *
from utils import (
    get_gpu_queue,
    get_cpu_queue,
    get_app_config,
    apply_hf_token,
    submit_tapis_job,
    build_embedder_string,
    build_proposer_string,
)

SMART_LABELER_CLASS_SUPPORT_IMAGE = os.getenv("SMART_LABELER_CLASS_SUPPORT_IMAGE")
SMART_LABELER_PROPOSAL_GENERATION_IMAGE = os.getenv("SMART_LABELER_PROPOSAL_GENERATION_IMAGE")
SMART_LABELER_CLASSIFICATION_IMAGE = os.getenv("SMART_LABELER_CLASSIFICATION_IMAGE")
HPC_MAX_RUNTIME_MINUTES = os.getenv("HPC_MAX_RUNTIME_MINUTES", 210)
HPC_MEMORY_MB = os.getenv("HPC_MEMORY_MB", 64800)
HPC_CORES_PER_NODE = os.getenv("HPC_CORES_PER_NODE", 8)
HPC_NUMBER_OF_NODES = os.getenv("HPC_NUMBER_OF_NODES", 1)


def job_name(body, fallback):
    """
    The Tapis job name.

    Each step has its own fallback so that two jobs in one pipeline are never
    both submitted under the same name — an empty name field used to leave them
    indistinguishable in the Tapis job list.
    """
    name = (body.get("name") or "").strip()
    return name or fallback


class ObjectDetectionClassSupports:

    @staticmethod
    def run(digid, token, body, secret):
        ann_dir, ann_filename = os.path.split(body["annotationFilePath"])
        system = body["system"]
        queue = get_gpu_queue(system, default="gpu")
        emb_str = build_embedder_string(body["models"])

        app_config = get_app_config("class_supports", system)
        data = {
            "name": job_name(body, "Generate class supports"),
            **app_config,
            "description": "Test job for generate class supports object-detection",
            "nodeCount": HPC_NUMBER_OF_NODES,
            "coresPerNode": HPC_CORES_PER_NODE,
            "memoryMB": HPC_MEMORY_MB,
            "maxMinutes": HPC_MAX_RUNTIME_MINUTES,
            "execSystemId": system,
            "execSystemLogicalQueue": queue,
            "archiveSystemId": system,
            "archiveSystemDir": body["outputDir"],
            "fileInputs": [
                {
                    "name": "container SIF",
                    "envKey": "sifpath",
                    "autoMountLocal": True,
                    "sourceUrl": SMART_LABELER_CLASS_SUPPORT_IMAGE,
                    "targetPath": "class_supports.sif",
                },
                {
                    "name": "source",
                    "envKey": "SRC_DIR",
                    "autoMountLocal": True,
                    "sourceUrl": f"tapis://{system}{body['srcImgDir']}",
                    "targetPath": "workdir",
                },
                {
                    "name": "ann",
                    "envKey": "ANN_DIR",
                    "autoMountLocal": True,
                    "sourceUrl": f"tapis://{system}{ann_dir}",
                    "targetPath": "ann",
                },
            ],
            "parameterSet": {
                "appArgs": [
                    {"name": "Source image path", "arg": "--src_path"},
                    {"name": "source path value", "arg": "/workdir"},
                    {"name": "annotations file path", "arg": "--ann_path"},
                    {"name": "ann path value", "arg": f"/ann/{ann_filename}"},
                    {"name": "method", "arg": "--method"},
                    {"name": "method value", "arg": "image"},
                    {"name": "output path", "arg": "--output_path"},
                    {"name": "output path value", "arg": "/output"},
                    {"name": "crop size", "arg": "--crop_size"},
                    {"name": "crop size value", "arg": f"{body['crop_sizes'].strip().replace(' ', '')}"},
                    {"name": "embedder", "arg": "--embedding_backend"},
                    {"name": "emb value", "arg": emb_str},
                ],
                "schedulerOptions": [
                    {"arg": "-G 1", "name": "gpu_per_node"},
                    {"name": "slurm account", "arg": f"-A {get_slurmaccount(digid)}"},
                    {"name": "job name", "arg": "--job-name=object-detector"},
                ],
                "containerArgs": [
                    {
                        "name": "binding",
                        "arg": "--bind $PWD/output:/output,$PWD/workdir:/workdir,$PWD/ann:/ann",
                    }
                ],
                "archiveFilter": {"includeLaunchFiles": False},
            },
        }
        apply_hf_token(data, secret)
        print("Submitting job with data:", data)
        res = submit_tapis_job(data, token)
        print("Class supports - Job submission response:", res)
        # A job id is the only proof the submission landed; without one there is
        # nothing to record and nothing to report as submitted.
        sid = res.get("uuid") if res.get("status") == "success" else None
        if sid:
            print(f"Class supports job submitted successfully with UUID: {sid}")
            update_object_detection(digid, {"generate_class_supports_job_id": sid})
        else:
            print("Error submitting class supports job "
                  f"(HTTP {res.get('httpStatus')}): {res.get('message')}")
        return res


class ObjectDetection:

    @staticmethod
    def run(digid, token, body, secret):
        system = body["system"]
        queue = get_gpu_queue(system)

        if body["is_query_dir"]:
            query_file_path = body["queryImagePath"]
            query_filename = ""
        else:
            query_file_path, query_filename = os.path.split(body["queryImagePath"])

        proposer_models = [m.strip().lower() for m in body["proposer_ids"].split(",") if m.strip()]
        embedder_models = [m.strip().lower() for m in body["embedder_ids"].split(",") if m.strip()]
        proposer = build_proposer_string(proposer_models)
        embedder = build_embedder_string(embedder_models)

        app_config = get_app_config("detection", system)
        data = {
            "name": job_name(body, "Generate proposals"),
            **app_config,
            "description": "Test job for optimize objectness threshold",
            "nodeCount": body.get("node_count", HPC_NUMBER_OF_NODES),
            "coresPerNode": body.get("cores_per_node", HPC_CORES_PER_NODE),
            "memoryMB": body.get("memory_mb", HPC_MEMORY_MB),
            "maxMinutes": body.get("max_minutes", HPC_MAX_RUNTIME_MINUTES),
            "execSystemId": system,
            "execSystemLogicalQueue": queue,
            "archiveSystemId": system,
            "archiveSystemDir": body["outputDir"],
            "fileInputs": [
                {
                    "name": "container SIF",
                    "envKey": "sifpath",
                    "autoMountLocal": True,
                    "sourceUrl": SMART_LABELER_PROPOSAL_GENERATION_IMAGE,
                    "targetPath": "objectness_t.sif",
                },
                {
                    "name": "query",
                    "envKey": "QUERY_DIR",
                    "autoMountLocal": True,
                    "sourceUrl": f"tapis://{system}{query_file_path}",
                    "targetPath": "query",
                },
            ],
            "parameterSet": {
                "appArgs": [
                    {"name": "query image path", "arg": "--image_dir"},
                    {"name": "query path value", "arg": f"/query/{query_filename}" if query_filename else "/query"},
                    {"name": "output path", "arg": "--output_dir"},
                    {"name": "output path value", "arg": "/output"},
                    {"name": "objectness threshold", "arg": "--confidence"},
                    {"name": "objectness threshold value", "arg": f"{body['objectnessThreshold']}"},
                    {"name": "nms iou", "arg": "--nms_iou"},
                    {"name": "nms iou value", "arg": f"{body['nmsIoUThreshold']}"},
                    {"name": "batch size", "arg": "--batch_size"},
                    {"name": "batch size value", "arg": f"{body['batch_size']}"},
                    {"name": "tile size", "arg": "--tile_size"},
                    {"name": "tile size value", "arg": f"{body['tile_size']}"},
                    {"name": "overlap ratio", "arg": "--overlap_ratio"},
                    {"name": "overlap ratio value", "arg": f"{body['overlap_ratio']}"},
                    {"name": "embedding backend", "arg": "--embedder"},
                    {"name": "embedding backend value", "arg": embedder},
                    {"name": "proposer", "arg": "--proposer"},
                    {"name": "proposer value", "arg": proposer},
                ],
                "schedulerOptions": [
                    {"arg": "-G 1", "name": "gpu_per_node"},
                    {"name": "slurm account", "arg": f"-A {get_slurmaccount(digid)}"},
                    {"name": "job name", "arg": "--job-name=object-detector"},
                ],
                "containerArgs": [
                    {
                        "name": "binding",
                        "arg": "--bind $PWD/output:/output,$PWD/query:/query",
                    }
                ],
                "archiveFilter": {"includeLaunchFiles": False},
            },
        }
        if body.get("is_sahi", False):
            data["parameterSet"]["appArgs"].append({"name": "is_sahi", "arg": "--is_sahi"})
        apply_hf_token(data, secret)
        
        print("Submitting job with data:", data)

        res = submit_tapis_job(data, token)
        print("Proposal - Job submission response:", res)
        sid = res.get("uuid") if res.get("status") == "success" else None
        if sid:
            print(f"Proposal job submitted successfully with UUID: {sid}")
            update_query_image_configuration(body["id"], {"objectnessThresholdJobId": sid})
            update_object_detection(digid, {"current_query_image_configuration": body["id"]})
        else:
            print("Error submitting proposal job "
                  f"(HTTP {res.get('httpStatus')}): {res.get('message')}")
        return res


class ObjectClassification:

    @staticmethod
    def run(digid, token, body, secret):
        system = body["system"]
        queue = get_cpu_queue(system)

        if body["is_query_dir"]:
            query_file_path = body["queryImagePath"]
            query_filename = ""
        else:
            query_file_path, query_filename = os.path.split(body["queryImagePath"])

        app_config = get_app_config("classification", system)
        data = {
            "name": job_name(body, "Classify objects"),
            **app_config,
            "description": "Job to predict class",
            "nodeCount": 1,
            "coresPerNode": 8,
            "memoryMB": 64800,
            "maxMinutes": 210,
            "execSystemId": system,
            "execSystemLogicalQueue": queue,
            "archiveSystemId": system,
            "archiveSystemDir": body["outputDir"],
            "fileInputs": [
                {
                    "name": "container SIF",
                    "envKey": "sifpath",
                    "autoMountLocal": True,
                    "sourceUrl": SMART_LABELER_CLASSIFICATION_IMAGE,
                    "targetPath": "object_classification.sif",
                },
                {
                    "name": "query",
                    "envKey": "QUERY_DIR",
                    "autoMountLocal": True,
                    "sourceUrl": f"tapis://{system}{query_file_path}",
                    "targetPath": "query",
                },
            ],
            "parameterSet": {
                "appArgs": [
                    {"name": "query image path", "arg": "--qry_path"},
                    {"name": "query path value", "arg": f"/query/{query_filename}" if query_filename else "/query"},
                    {"name": "output path", "arg": "--output_path"},
                    {"name": "output path value", "arg": "/output"},
                    {"name": "class supports file path", "arg": "--class_support_file_paths"},
                    {"name": "class support path value", "arg": body["class_support_paths"]},
                    {"name": "object features path", "arg": "--object_features_file_paths"},
                    {"name": "object features path value", "arg": body["proposal_tensor_paths"]},
                    {"name": "model name", "arg": "--embedding_backends"},
                    {"name": "model name value", "arg": body["models"]},
                    {"name": "objectness threshold", "arg": "--objectness_threshold"},
                    {"name": "objectness threshold value", "arg": f"{body['objectnessThreshold']}"},
                    {"name": "similarity t", "arg": "--similarity_threshold"},
                    {"name": "similarity t value", "arg": f"{body['similarityThreshold']}"},
                ],
                "schedulerOptions": [
                    {"name": "slurm account", "arg": f"-A {get_slurmaccount(digid)}"},
                    {"name": "job name", "arg": "--job-name=object-detector"},
                ],
                "containerArgs": [
                    {
                        "name": "binding",
                        "arg": "--bind $PWD/output:/output,$PWD/query:/query",
                    }
                ],
                "archiveFilter": {"includeLaunchFiles": False},
            },
        }
        if body.get("is_query_dir", False):
            data["parameterSet"]["appArgs"].append({"name": "is_dir", "arg": "--is_query_dir"})
            
        print('data : ', data)
        res = submit_tapis_job(data, token)
        print("Classification - Job submission response:", res)
        sid = res.get("uuid") if res.get("status") == "success" else None
        if sid:
            print(f"Classification job submitted successfully with UUID: {sid}")
            update_query_image_configuration(body["id"], {"detectionJobId": sid})
            update_object_detection(digid, {"current_query_image_configuration": body["id"]})
        else:
            print("Error submitting classification job "
                  f"(HTTP {res.get('httpStatus')}): {res.get('message')}")
        return res


SMART_LABELER_PROTORCD_DETECT_IMAGE = os.getenv("SMART_LABELER_PROTORCD_DETECT_IMAGE")
SMART_LABELER_PROTORCD_EMBED_IMAGE = os.getenv("SMART_LABELER_PROTORCD_EMBED_IMAGE")

# Where each ProtoRCD job writes inside its output (archive) directory.
PROTORCD_PROPOSALS_FILE = "proposals.coco.json"


def protorcd_embedding_file(model, region):
    """File name jobs/protorcd/embed/run_embed.py writes for one model."""
    return f"{model}_{region}.npz"


def _protorcd_job(digid, body, *, app, name, description, sif, sif_target, mounts, app_args):
    """Tapis job body shared by both ProtoRCD stages.

    `mounts` is a list of (input name, Tapis directory, container dir); each is
    staged into the job directory and bind-mounted at /<container dir>.
    """
    system = body["system"]
    binds = ["$PWD/output:/output"] + [f"$PWD/{target}:/{target}" for _, _, target in mounts]
    return {
        "name": job_name(body, name),
        **get_app_config(app, system),
        "description": description,
        "nodeCount": body.get("node_count", HPC_NUMBER_OF_NODES),
        "coresPerNode": body.get("cores_per_node", HPC_CORES_PER_NODE),
        "memoryMB": body.get("memory_mb", HPC_MEMORY_MB),
        "maxMinutes": body.get("max_minutes", HPC_MAX_RUNTIME_MINUTES),
        "execSystemId": system,
        "execSystemLogicalQueue": get_gpu_queue(system),
        "archiveSystemId": system,
        "archiveSystemDir": body["outputDir"],
        "fileInputs": [
            {
                "name": "container SIF",
                "envKey": "sifpath",
                "autoMountLocal": True,
                "sourceUrl": sif,
                "targetPath": sif_target,
            },
            *[
                {
                    "name": input_name,
                    "autoMountLocal": True,
                    "sourceUrl": f"tapis://{system}{directory}",
                    "targetPath": target,
                }
                for input_name, directory, target in mounts
            ],
        ],
        "parameterSet": {
            "appArgs": [{"name": f"arg {i}", "arg": str(a)} for i, a in enumerate(app_args)],
            "schedulerOptions": [
                {"arg": "-G 1", "name": "gpu_per_node"},
                {"name": "slurm account", "arg": f"-A {get_slurmaccount(digid)}"},
                {"name": "job name", "arg": "--job-name=protorcd"},
            ],
            "containerArgs": [{"name": "binding", "arg": "--bind " + ",".join(binds)}],
            "archiveFilter": {"includeLaunchFiles": False},
        },
    }


def _record_protorcd_job(digid, res, what, updates_on_success):
    sid = res.get("uuid") if res.get("status") == "success" else None
    if sid:
        print(f"{what} job submitted successfully with UUID: {sid}")
        update_protorcd(digid, {k: (sid if v is None else v) for k, v in updates_on_success.items()})
    else:
        print(f"Error submitting {what} job (HTTP {res.get('httpStatus')}): {res.get('message')}")
    return res


class ProtoRCDDetect:
    """Stage 1: SAM3 proposals over an image directory -> <outputDir>/proposals.coco.json."""

    @staticmethod
    def run(digid, token, body, secret):
        args = [
            "--image_dir", "/images",
            "--output", f"/output/{PROTORCD_PROPOSALS_FILE}",
            "--text_prompt", body["text_prompt"],
            "--confidence_threshold", body["confidence_threshold"],
            "--score_threshold", body["score_threshold"],
            "--nms_iou_threshold", body["nms_iou_threshold"],
            "--batch_size", body["batch_size"],
        ]
        if body.get("use_sahi"):
            args += ["--use_sahi", "--crop_size", body["crop_size"],
                     "--overlap_h", body["overlap"], "--overlap_w", body["overlap"]]
        if body.get("return_masks"):
            args.append("--return_masks")

        data = _protorcd_job(
            digid, body,
            app="protorcd_detect",
            name="ProtoRCD proposals",
            description="ProtoRCD stage 1: SAM3 proposals exported as COCO",
            sif=SMART_LABELER_PROTORCD_DETECT_IMAGE,
            sif_target="protorcd_detect.sif",
            mounts=[("images", body["imageDir"], "images")],
            app_args=args,
        )
        # The SAM3 checkpoint is gated on Hugging Face.
        apply_hf_token(data, secret)
        print("Submitting ProtoRCD detect job with data:", data)
        res = submit_tapis_job(data, token)
        return _record_protorcd_job(digid, res, "ProtoRCD detect",
                                    {"detect_config": body, "detect_job_id": None})


class ProtoRCDEmbed:
    """Stage 2: DINOv3 + BioCLIP embeddings of every proposal in the stage-1 COCO file."""

    @staticmethod
    def run(digid, token, body, secret):
        coco_dir, coco_name = os.path.split(body["cocoPath"])
        mounts = [("images", body["imageDir"], "images"), ("coco", coco_dir, "coco")]
        args = [
            "--coco", f"/coco/{coco_name}",
            "--image_dir", "/images",
            "--output_dir", "/output",
            "--models", *body["models"],
            "--region", body["region"],
            "--batch_size", body["batch_size"],
            "--dtype", body["dtype"],
            "--dinov3_model_size", body["dinov3_model_size"],
            "--dinov3_image_size", body["dinov3_image_size"],
        ]
        if body.get("dinov3_weights"):
            weights_dir, weights_name = os.path.split(body["dinov3_weights"])
            mounts.append(("dinov3 weights", weights_dir, "weights"))
            args += ["--dinov3_weights", f"/weights/{weights_name}"]

        data = _protorcd_job(
            digid, body,
            app="protorcd_embed",
            name="ProtoRCD embeddings",
            description="ProtoRCD stage 2: DINOv3 / BioCLIP proposal embeddings",
            sif=SMART_LABELER_PROTORCD_EMBED_IMAGE,
            sif_target="protorcd_embed.sif",
            mounts=mounts,
            app_args=args,
        )
        apply_hf_token(data, secret)
        print("Submitting ProtoRCD embed job with data:", data)
        res = submit_tapis_job(data, token)
        # A new embedding run invalidates any dataset registered from the old files.
        return _record_protorcd_job(digid, res, "ProtoRCD embed", {
            "embed_config": body, "embed_job_id": None,
            "triage_dataset_id": "", "triage_dataset_key": "",
        })
