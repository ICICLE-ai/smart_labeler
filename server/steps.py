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


class ObjectDetectionClassSupports:

    @staticmethod
    def run(digid, token, body, secret):
        ann_dir, ann_filename = os.path.split(body["annotationFilePath"])
        system = body["system"]
        queue = get_gpu_queue(system, default="gpu")
        emb_str = build_embedder_string(body["models"])

        app_config = get_app_config("class_supports", system)
        data = {
            "name": body["name"],
            **app_config,
            "description": "Test job for generate class supports object-detection",
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
        if res["status"] == "success":
            sid = res["uuid"]
            print(f"Class supports job submitted successfully with UUID: {sid}")
            update_object_detection(digid, {"generate_class_supports_job_id": sid})
        else:
            print("Error submitting job:", res["message"])
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
            "name": body["name"],
            **app_config,
            "description": "Test job for optimize objectness threshold",
            "nodeCount": body.get("node_count", 1),
            "coresPerNode": body.get("cores_per_node", 8),
            "memoryMB": body.get("memory_mb", 64800),
            "maxMinutes": body.get("max_minutes", 210),
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
        if res["status"] == "success":
            sid = res["uuid"]
            print(f"Proposal job submitted successfully with UUID: {sid}")
            update_query_image_configuration(body["id"], {"objectnessThresholdJobId": sid})
            update_object_detection(digid, {"current_query_image_configuration": body["id"]})
        else:
            print("Error submitting job:", res["message"])
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
            "name": body["name"],
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

        res = submit_tapis_job(data, token)
        print("Classification - Job submission response:", res)
        if res["status"] == "success":
            sid = res["uuid"]
            print(f"Classification job submitted successfully with UUID: {sid}")
            update_query_image_configuration(body["id"], {"classificationJobId": sid})
            update_object_detection(digid, {"current_query_image_configuration": body["id"]})
        else:
            print("Error submitting job:", res["message"])
            sid = None
        return res
