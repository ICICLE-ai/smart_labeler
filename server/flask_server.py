import os
import io
import json
import time

import urllib.parse
import base64

import numpy as np
import cv2

from flask import send_file, abort, redirect, make_response, jsonify, request
from flask_cors import CORS
from flask_openapi3 import OpenAPI, APIBlueprint, Tag
from flask_openapi3.models.info import Info
from flask_openapi3.models.security_scheme import SecurityScheme
from flask_openapi3.models.security_scheme_in_type import SecuritySchemeInType as SchemeIn

from db import *
from steps import *
from schemas import (
    PipePath, ConfigPath, DigidSystemPath, DigidPath, SystemPath,
    PipeIdSystemPath, PipeIdIdPath, PipeIdOdIdPath, IdPath, IdsPath,
    PipeIdPath, PipeIdConfigIdPath, JobIdPath, PipeJobPath,
    McIdPath, SecretNamePath,
    PipelineCreate, PipelineUpdate, PipelineOut,
    IdOut, MessageOut,
    AnnotatorConfigCreate, AnnotatorConfigUpdate, AnnotatorConfigOut,
    ImgQuery, DirQuery, DirContentsQuery, ImgsInDirQuery, SaveFileQuery,
    BatchImgRequest, BatchImgResponse, FileListOut, ImgListOut, ImgsOut, DirContentsOut,
    ObjectDetectionPipelineOut, QueryImageConfigOut, QueryImageConfigUpdate,
    ClassSupportsQuery, ClassSupportsRequest,
    ObjectDetectionRequest, ObjectClassificationRequest,
    ClassSupportTensorUpdate, ObjectDetectionUpdate,
    JobStatusOut, IsAdminOut,
    VaultSecretWrite, VaultSecretRead,
)


os.environ.setdefault("APP_CONFIG_PATH", "./config.yaml")
os.environ.setdefault("FRONT_URL", "https://localhost:5174")
os.environ.setdefault("COOKIE_DOMAIN", "localhost")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
PATRA_BASE_NEW = os.getenv("PATRA_BASE_NEW", "https://patrabackend.pods.icicleai.tapis.io")
TAPIS_BASE = "https://icicleai.tapis.io"

from iciflaskn import auth
from iciflaskn.config import config

tapis_token_scheme = SecurityScheme(type="apiKey", name="Tapis-Token", security_scheme_in=SchemeIn.HEADER)

app = OpenAPI(
    __name__,
    info=Info(title="Smart Labeler API", version="1.0.0"),
    security_schemes={"TapisToken": tapis_token_scheme},
    template_folder="templates",
)
app.config["TEMPLATES_AUTO_RELOAD"] = True

CORS(
    app,
    resources={r"/*": {"origins": "*"}},
    allow_headers=["Tapis-Token", "Content-Type", "Authorization"],
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
)


# ── Auth helper ───────────────────────────────────────────────────────────────
def getAuth(req):
    try:
        token = req.headers.get("Tapis-Token")
        if not token:
            abort(401, description="Missing Tapis-Token header")
        username = auth.get_username(token)
        return token, username
    except Exception:
        abort(403, description="Tapis authentication failed — please log back in")


# ── Blueprints ────────────────────────────────────────────────────────────────
_auth_sec = [{"TapisToken": []}]

auth_blp = APIBlueprint("auth", __name__, url_prefix="",
                        abp_tags=[Tag(name="Auth", description="OAuth2 / session endpoints")])

pipes_blp = APIBlueprint("pipelines", __name__, url_prefix="",
                         abp_tags=[Tag(name="Pipelines", description="Pipeline CRUD")],
                         abp_security=_auth_sec)

annot_blp = APIBlueprint("annotator", __name__, url_prefix="",
                         abp_tags=[Tag(name="Annotator", description="Annotator configurations")],
                         abp_security=_auth_sec)

files_blp = APIBlueprint("files", __name__, url_prefix="",
                         abp_tags=[Tag(name="Files", description="File and image access")],
                         abp_security=_auth_sec)

od_blp = APIBlueprint("object_detection", __name__, url_prefix="",
                      abp_tags=[Tag(name="ObjectDetection", description="Object detection pipelines and jobs")],
                      abp_security=_auth_sec)

jobs_blp = APIBlueprint("jobs", __name__, url_prefix="",
                        abp_tags=[Tag(name="Jobs", description="Tapis job management")],
                        abp_security=_auth_sec)

admin_blp = APIBlueprint("admin", __name__, url_prefix="",
                         abp_tags=[Tag(name="Admin", description="Admin utilities")],
                         abp_security=_auth_sec)

patra_blp = APIBlueprint("patra", __name__, url_prefix="/patra",
                         abp_tags=[Tag(name="Patra", description="Patra model cards")],
                         abp_security=_auth_sec)

vault_blp = APIBlueprint("vault", __name__, url_prefix="/api/vault",
                         abp_tags=[Tag(name="Vault", description="Tapis vault secrets")],
                         abp_security=_auth_sec)


# ── Auth endpoints ────────────────────────────────────────────────────────────
@auth_blp.get("/tapisui-entry", doc_ui=True, summary="TapisUI iframe entry (deprecated)")
def tapisUI_entry():
    jwt = request.args.get("jwt")
    if not jwt:
        abort(400, description="No JWT in request")
    username = auth.get_username(jwt)
    response = make_response(redirect(os.environ["FRONT_URL"], code=302))
    domain = os.environ["COOKIE_DOMAIN"]
    response.set_cookie("token", jwt, domain=domain, secure=False)
    response.set_cookie("username", username, domain=domain, secure=False)
    return response


@auth_blp.get("/login", summary="Begin OAuth2 login flow")
def login():
    authenticated, _, _ = auth.is_logged_in()
    if authenticated:
        return {"path": "/", "code": 302}
    callback_url = f"{config['app_base_url']}/oauth2/callback"
    tapis_url = (
        f"{config['tapis_base_url']}/v3/oauth2/authorize"
        f"?client_id={config['client_id']}&redirect_uri={callback_url}&response_type=code"
    )
    return {"path": tapis_url, "code": 302}


@auth_blp.get("/oauth2/callback", summary="OAuth2 authorization code callback")
def callback():
    code = request.args.get("code")
    if not code:
        abort(400, description=f"No code in request; debug: {request.args}")
    url = f"{config['tapis_base_url']}/v3/oauth2/tokens"
    data = {
        "code": code,
        "redirect_uri": f"{config['app_base_url']}/oauth2/callback",
        "grant_type": "authorization_code",
    }
    try:
        resp = requests.post(url, data=data, auth=(config["client_id"], config["client_key"]))
        resp.raise_for_status()
        token = resp.json()["result"]["access_token"]["access_token"]
    except Exception as e:
        abort(500, description=f"Error generating Tapis token: {e}")
    username = auth.get_username(token)
    response = make_response(redirect(os.environ["FRONT_URL"], code=302))
    domain = os.environ["COOKIE_DOMAIN"]
    response.set_cookie("token", token, domain=domain, secure=COOKIE_SECURE)
    response.set_cookie("username", username, domain=domain, secure=COOKIE_SECURE)
    return response


# ── Pipelines ─────────────────────────────────────────────────────────────────
@pipes_blp.get("/pipes", summary="List all pipelines for the authenticated user",
               responses={"200": PipelineOut})
def getpipes():
    token, user = getAuth(request)
    pipelines = get_pipelines(user)
    return jsonify([
        {
            "pid": p["pipelineid"],
            "name": p["name"],
            "description": p["description"],
            "slurmaccount": p["slurmaccount"],
            "is_demo": p["pipelineuser"] == 0,
            "type": p.get("type", "DETECTION"),
        }
        for p in pipelines
    ])


@pipes_blp.get("/pipe/<int:pipe_id>", summary="Get a single pipeline by ID",
               responses={"200": PipelineOut})
def getpipe(path: PipePath):
    token, user = getAuth(request)
    rows = is_user_pipeline(path.pipe_id, user)
    if not rows:
        abort(404, description=f"Pipeline not found: {path.pipe_id}")
    p = rows[0]
    return jsonify({
        "pid": p["pipelineid"],
        "name": p["name"],
        "description": p["description"],
        "slurmaccount": p["slurmaccount"],
        "is_demo": p["pipelineuser"] == 0,
        "type": p.get("type", "DETECTION"),
    })


@pipes_blp.post("/pipe/create", summary="Create a new pipeline",
                responses={"201": IdOut})
def newpipe(body: PipelineCreate):
    token, user = getAuth(request)
    pid = create_pipeline(user, body.model_dump())
    return jsonify({"id": int(pid)}), 201


@pipes_blp.put("/pipe/update/<int:pipe_id>", summary="Update a pipeline",
               responses={"200": MessageOut})
def updatepipe(path: PipePath, body: PipelineUpdate):
    token, user = getAuth(request)
    test_pipe(path.pipe_id, user)
    update_pipeline(path.pipe_id, user, body.model_dump(exclude_none=True))
    return jsonify({"message": "Pipeline updated."})


@pipes_blp.delete("/pipe/delete/<int:pipe_id>", summary="Delete a pipeline",
                  responses={"200": MessageOut})
def deletepipe(path: PipePath):
    token, user = getAuth(request)
    test_pipe(path.pipe_id, user)
    delete_pipeline(path.pipe_id, user)
    return jsonify({"message": "Pipeline deleted."})


# ── Annotator Configuration ───────────────────────────────────────────────────
@annot_blp.get("/annotator-configuration/<int:pipe_id>",
               summary="List annotator configurations for a pipeline",
               responses={"200": AnnotatorConfigOut})
def get_annotator_config(path: PipePath):
    token, user = getAuth(request)
    test_pipe(path.pipe_id, user)
    configs = get_all_annotator_configurations(path.pipe_id)
    return jsonify([
        {
            "id": r["id"],
            "system": r["system"],
            "srcImgDir": r["srcimgdir"],
            "annotationFilePath": r["annotationfilepath"],
            "fileType": r.get("filetype", "default"),
            "parentPipelineId": r["parentpipelineid"],
        }
        for r in configs
    ])


@annot_blp.post("/annotator-configuration/<int:pipe_id>",
                summary="Create an annotator configuration",
                responses={"201": IdOut})
def create_annotator_config(path: PipePath, body: AnnotatorConfigCreate):
    token, user = getAuth(request)
    test_pipe(path.pipe_id, user)
    if is_demo_pipeline(path.pipe_id) and not is_admin_user(user):
        abort(403, description="Only admins can configure demo pipelines.")
    config_id = create_annotator_configuration(path.pipe_id, body.model_dump())
    return jsonify({"id": config_id}), 201


@annot_blp.put("/annotator-configuration/config/<int:config_id>",
               summary="Update an annotator configuration",
               responses={"200": MessageOut})
def update_annotator_config(path: ConfigPath, body: AnnotatorConfigUpdate):
    token, user = getAuth(request)
    cfg = get_annotator_configuration_by_id(path.config_id)
    if cfg and is_demo_pipeline(cfg["parentpipelineid"]) and not is_admin_user(user):
        abort(403, description="Only admins can configure demo pipelines.")
    if update_annotator_configuration(path.config_id, body.model_dump(exclude_none=True)):
        return jsonify({"message": "Annotator configuration updated."})
    abort(400, description="No valid fields to update.")


@annot_blp.delete("/annotator-configuration/config/<int:config_id>",
                  summary="Delete an annotator configuration",
                  responses={"200": MessageOut})
def delete_annotator_config(path: ConfigPath):
    token, user = getAuth(request)
    delete_annotator_configuration(path.config_id)
    return jsonify({"message": "Annotator configuration deleted."})


# ── Files ─────────────────────────────────────────────────────────────────────
def fetch_file_from_tapis(system, file_path, token):
    clean_path = file_path.replace("tapis://", "").lstrip("/")
    headers = {"X-Tapis-Token": token}
    url = f"https://icicleai.tapis.io/v3/files/content/{system}/{clean_path}"
    print(f"Fetching file from {url}")
    resp = requests.get(url, headers=headers)
    if resp.status_code != 200:
        raise Exception(f"Tapis file fetch failed: {resp.text}")
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream"), os.path.basename(clean_path)


@files_blp.get("/get-img/<digid>/<system>",
               summary="Fetch an image from Tapis; TIFF is auto-converted to JPEG")
def get_img(path: DigidSystemPath, query: ImgQuery):
    raw = query.imgURL or query.filePath
    if not raw:
        abort(400, description="Missing imgURL or filePath query parameter")
    imgURL = raw.replace("tapis://", "")
    token, user = getAuth(request)
    test_pipe(path.digid, user)
    headers = {"X-Tapis-Token": token}
    url = f"https://icicleai.tapis.io/v3/files/content/{path.system}/{imgURL}"
    resp = requests.get(url, headers=headers)
    con = resp.content
    mimetype = resp.headers.get("Content-Type", "application/octet-stream")
    filename = os.path.basename(imgURL)
    if mimetype.lower() == "image/tiff" or filename.lower().endswith((".tif", ".tiff")):
        try:
            nparr = np.frombuffer(con, np.uint8)
            img_np = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img_np is None:
                abort(500, description="Could not decode TIFF image")
            ok, encoded = cv2.imencode(".jpeg", img_np, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
            if not ok:
                abort(500, description="Could not encode image to JPEG")
            return send_file(io.BytesIO(encoded.tobytes()), mimetype="image/jpeg",
                             download_name=os.path.splitext(filename)[0] + ".jpg")
        except Exception as e:
            abort(500, description=f"TIFF conversion failed: {e}")
    return send_file(io.BytesIO(con), mimetype=mimetype, download_name=filename)


@files_blp.get("/get_file/<digid>/<system>",
               summary="Fetch a single file from Tapis")
def get_file(path: DigidSystemPath, query: ImgQuery):
    raw_path = query.filePath or query.imgURL
    if not raw_path:
        abort(400, description="Missing filePath or imgURL query parameter")
    token, _ = getAuth(request)
    try:
        content, mimetype, filename = fetch_file_from_tapis(path.system, raw_path, token)
        return send_file(io.BytesIO(content), mimetype=mimetype, as_attachment=False, download_name=filename)
    except Exception as e:
        abort(500, description=str(e))


@files_blp.get("/get_files/<digid>/<system>",
               summary="List files in a Tapis directory",
               responses={"200": FileListOut})
def get_files(path: DigidSystemPath, query: DirQuery):
    token, user = getAuth(request)
    dirPath = query.dir.replace("tapis://", "")
    headers = {"X-Tapis-Token": token}
    url = f"https://icicleai.tapis.io/v3/files/ops/{path.system}/{urllib.parse.quote(dirPath, safe='/-_')}"
    resp = requests.get(url, headers=headers)
    if resp.status_code != 200:
        abort(resp.status_code, description=f"Error fetching files: {resp.text}")
    results = resp.json().get("result", [])
    return jsonify({"files": [f["path"] for f in results if f["type"] == "file"]})


@files_blp.get("/getimgs/<digid>",
               summary="List images and label count for a pipeline data directory",
               responses={"200": ImgListOut})
@files_blp.post("/getimgs/<digid>")
def get_imgs(path: DigidPath):
    token, user = getAuth(request)
    test_pipe(path.digid, user)
    headers = {"X-Tapis-Token": token}
    url = f"https://icicleai.tapis.io/v3/files/ops/{get_data_dir(path.digid).replace('tapis://','')}"
    resp = requests.get(url, headers=headers)
    list_of_files = [f["name"] for f in resp.json()["result"] if f["type"] == "file"]
    return jsonify({"img": list_of_files, "num": get_numlabels(path.digid)})


@files_blp.get("/get-imgs-in-dir/<digid>/<system>",
               summary="List image paths in a directory (auto-paginated)",
               responses={"200": ImgsOut})
@files_blp.post("/get-imgs-in-dir/<digid>/<system>")
def get_imgs_in_dir(path: DigidSystemPath, query: ImgsInDirQuery):
    token, user = getAuth(request)
    supported = [".JPEG", ".JPG", ".PNG", ".TIF", ".TIFF"]
    headers = {"X-Tapis-Token": token}
    url = f"https://icicleai.tapis.io/v3/files/ops/{path.system}/{urllib.parse.quote(query.dir, safe='/-_')}"
    offset, list_of_files, count = 0, [], 0
    while True:
        resp = requests.get(url, headers=headers, params={"offset": offset, "limit": 1000})
        if resp.status_code != 200:
            break
        results = resp.json().get("result", [])
        if not results:
            break
        for f in results:
            if count >= query.n:
                break
            if f["type"] == "file" and f["name"].upper().endswith(tuple(supported)):
                list_of_files.append(f["path"])
                count += 1
        if len(results) < 1000 or count >= query.n:
            break
        offset += 1000
    return jsonify({"imgs": list_of_files})


@files_blp.get("/get-dir-contents/<digid>/<system>",
               summary="List subdirectories and images at a path (single level)",
               responses={"200": DirContentsOut})
def get_dir_contents(path: DigidSystemPath, query: DirContentsQuery):
    token, user = getAuth(request)
    supported = (".JPEG", ".JPG", ".PNG", ".TIF", ".TIFF")
    headers = {"X-Tapis-Token": token}
    url = f"https://icicleai.tapis.io/v3/files/ops/{path.system}/{urllib.parse.quote(query.dir, safe='/-_')}"
    resp = requests.get(url, headers=headers, params={"offset": 0, "limit": 1000})
    if resp.status_code != 200:
        return jsonify({"dirs": [], "imgs": []})
    results = resp.json().get("result", [])
    clean_dir = query.dir.strip("/")
    dirs, imgs = [], []
    for item in results:
        if item["type"] == "dir" and item.get("path", "").strip("/") != clean_dir:
            dirs.append({"name": item["name"], "path": item["path"]})
        elif item["type"] == "file" and item["name"].upper().endswith(supported):
            imgs.append(item["path"])
    return jsonify({"dirs": dirs, "imgs": imgs})


@files_blp.post("/get_imgs_batch/<digid>/<system>",
                summary="Fetch multiple images in parallel as base64-encoded strings",
                responses={"200": BatchImgResponse})
def get_imgs_batch(path: DigidSystemPath, body: BatchImgRequest):
    from concurrent.futures import ThreadPoolExecutor
    token, user = getAuth(request)

    def fetch_and_encode(file_path):
        clean = file_path.replace("tapis://", "").lstrip("/")
        headers = {"X-Tapis-Token": token}
        url = f"https://icicleai.tapis.io/v3/files/content/{path.system}/{clean}"
        try:
            r = requests.get(url, headers=headers, timeout=30)
            if r.status_code != 200:
                return {"path": file_path, "error": f"HTTP {r.status_code}"}
            con = r.content
            mimetype = r.headers.get("Content-Type", "application/octet-stream")
            filename = os.path.basename(clean)
            if mimetype.lower() == "image/tiff" or filename.lower().endswith((".tif", ".tiff")):
                try:
                    nparr = np.frombuffer(con, np.uint8)
                    img_np = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    if img_np is not None:
                        ok, enc = cv2.imencode(".jpeg", img_np, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
                        if ok:
                            con, mimetype = enc.tobytes(), "image/jpeg"
                except Exception as e:
                    print(f"TIFF conversion failed for {filename}: {e}")
            return {"path": file_path, "data": base64.b64encode(con).decode(), "mime": mimetype}
        except Exception as e:
            return {"path": file_path, "error": str(e)}

    with ThreadPoolExecutor(max_workers=min(10, len(body.files) or 1)) as ex:
        results = list(ex.map(fetch_and_encode, body.files))
    return jsonify({"images": results})


@files_blp.post("/save-file/<system>",
                summary="Upload a file to Tapis",
                responses={"200": MessageOut})
def save_file(path: SystemPath, query: SaveFileQuery):
    token, user = getAuth(request)
    file = request.get_data(as_text=True)
    if not file:
        abort(400, description="No file content in the request")
    url = f"https://icicleai.tapis.io/v3/files/ops/{path.system}/{urllib.parse.quote(query.path, safe='/-_')}"
    file_stream = io.BytesIO(file.encode())
    files = [("file", (f"ann-{time.time()}.json", file_stream, "application/json"))]
    resp = requests.post(url, headers={"X-Tapis-Token": token}, files=files)
    if resp.status_code != 200:
        abort(resp.status_code, description=f"Error saving file: {resp.text}")
    return jsonify({"message": "File saved successfully"})


# ── Object Detection Pipeline ─────────────────────────────────────────────────
@od_blp.get("/get_object_detection_pipeline/<id>",
            summary="Get object detection pipeline (legacy route)")
def get_od_pipeline(path: IdPath):
    token, user = getAuth(request)
    return jsonify(get_object_detection_pipeline(path.id))


@od_blp.get("/get-object-detection-pipeline/<int:pipeId>",
            summary="Get object detection pipeline config including active query image config",
            responses={"200": ObjectDetectionPipelineOut})
def getObjectDetectionPipeline(path: PipeIdPath):
    token, user = getAuth(request)
    pipeline = get_object_detection_pipeline(path.pipeId)
    if not pipeline:
        abort(404, description=f"Pipeline not found: {path.pipeId}")
    data = {
        "id": pipeline["detectionid"],
        "system": pipeline["system"],
        "srcImgDir": pipeline["srcimgdir"],
        "annotationFilePath": pipeline["annotationfilepath"],
        "model_ids": pipeline["model_ids"],
        "method": pipeline["method"],
        "device": pipeline["device"],
        "outputDir": pipeline["outputdir"],
        "cropSize": pipeline["cropsize"],
        "generateClassSupportJobId": pipeline["generate_class_supports_job_id"],
        "classSupportsPath": pipeline["class_supports_tensor_file_path"],
        "current_query_image_configuration": pipeline["current_query_image_configuration"],
        "name": pipeline["name"],
        "crop_sizes": pipeline["crop_sizes"],
        "model_names": pipeline["model_names"],
        "is_demo": bool(pipeline.get("is_demo", False)),
    }
    if data["current_query_image_configuration"]:
        qic = get_query_image_configuration(data["current_query_image_configuration"])
        if qic:
            data["query_image_configuration"] = {
                "id": qic["id"],
                "objectnessThreshold": qic["objectnessthreshold"],
                "nmsIoUThreshold": qic["nmsiouthreshold"],
                "similarityThreshold": qic["similaritythreshold"],
                "queryImagePath": qic["queryimagepath"],
                "outputDir": qic["outputdir"],
                "device": qic["device"],
                "method": qic["method"],
                "objectnessThresholdJobId": qic["objectnessthresholdjobid"],
                "detectionJobId": qic["detectionjobid"],
                "system": qic["system"],
                "object_feature_tensor_file_path": qic["object_feature_tensor_file_path"],
                "name": qic["name"],
                "proposer_ids": qic["proposer_ids"],
                "embedder_ids": qic["embedder_ids"],
                "is_sahi": qic["is_sahi"],
                "tile_size": qic["tile_size"],
                "overlap_ratio": qic["overlap_ratio"],
                "batch_size": qic["batch_size"],
                "proposer_models": qic.get("proposer_models", ""),
                "embedder_models": qic.get("embedder_models", ""),
                "class_support_paths": qic.get("class_support_paths", ""),
                "proposal_tensor_paths": qic.get("proposal_tensor_paths", ""),
            }
    return jsonify(data)


@od_blp.post("/generate_class_supports/<ids>",
             summary="Submit a Tapis job to generate class support tensors")
def generate_class_supports(path: IdsPath, query: ClassSupportsQuery, body: ClassSupportsRequest):
    token, user = getAuth(request)
    secret = None
    try:
        secret = read_vault_secret("hftoken", user, token, False)
    except Exception as e:
        print(f"Error reading vault secret: {e}")

    models = []
    if query.optimize_crop_size:
        models = ["owlv2"]
    else:
        for model_id in body.model_ids.split(","):
            model_id = model_id.strip()
            if not model_id:
                continue
            resp = patra_download_mc(model_id, token, body.newPatra)
            if isinstance(resp, tuple):
                print(f"Error fetching model {model_id}: {resp[0]}")
                continue
            model_data = resp.get_json() if hasattr(resp, "get_json") else resp
            models.append(model_data.get("ai_model", {}).get("name", ""))

    job_body = {
        **body.model_dump(),
        "model_names": ",".join(models),
        "models": models,
    }

    if not query.optimize_crop_size:
        create_object_detection_entry(path.ids, job_body)
    else:
        cropSize = 1024
        raw = body.cropSize
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
                cropSize = int(parsed[0]) if isinstance(parsed, list) and parsed else 1024
            except Exception:
                pass
        elif isinstance(raw, int):
            cropSize = raw
        update_object_detection(path.ids, {"cropSize": cropSize, "crop_sizes": body.crop_sizes})

    return ObjectDetectionClassSupports.run(path.ids, token, job_body, secret)


@od_blp.post("/object-detection/<pipeid>/<int:id>",
             summary="Submit a Tapis object detection job; use id=0 to create a new config")
def object_detection(path: PipeIdIdPath, body: ObjectDetectionRequest):
    token, user = getAuth(request)
    secret = None
    try:
        secret = read_vault_secret("hftoken", user, token, False)
    except Exception as e:
        print(f"Error reading vault secret: {e}")

    embedder_names, proposer_names = [], []
    try:
        for mid in [m.strip() for m in body.embedder_ids.split(",") if m.strip()]:
            resp = patra_download_mc(mid, token, body.newPatra)
            if not isinstance(resp, tuple):
                name = (resp.get_json() if hasattr(resp, "get_json") else resp).get("ai_model", {}).get("name", "")
                if name:
                    embedder_names.append(name)
        for mid in [m.strip() for m in body.proposer_ids.split(",") if m.strip()]:
            resp = patra_download_mc(mid, token, body.newPatra)
            if not isinstance(resp, tuple):
                name = (resp.get_json() if hasattr(resp, "get_json") else resp).get("ai_model", {}).get("name", "")
                if name:
                    proposer_names.append(name)
    except Exception as e:
        print(f"Error downloading embedder/proposer models: {e}")

    job_body = {
        **body.model_dump(exclude={"newPatra"}),
        "id": path.id,
        "embedder_models": ",".join(embedder_names),
        "proposer_models": ",".join(proposer_names),
    }

    if path.id == 0:
        create_query_image_configuration(path.pipeid, job_body)
    else:
        update_query_image_configuration(path.id, job_body)

    actual_id = path.id
    if path.id == 0:
        actual_id = get_latest_query_image_configuration_id(path.pipeid)
        job_body["id"] = actual_id

    job_body["embedder_ids"] = ",".join(embedder_names)
    job_body["proposer_ids"] = ",".join(proposer_names)

    return ObjectDetection.run(path.pipeid, token, job_body, secret)


@od_blp.post("/object-classification/<pipeid>/<od_id>",
             summary="Submit a Tapis object classification job")
def object_classification(path: PipeIdOdIdPath, body: ObjectClassificationRequest):
    token, user = getAuth(request)
    secret = None
    try:
        secret = read_vault_secret("hftoken", user, token, False)
    except Exception as e:
        print(f"Error reading vault secret: {e}")

    job_body = body.model_dump()
    update_query_image_configuration(body.id, job_body)

    models = []
    for p in body.class_support_paths.split(" "):
        parts = os.path.basename(p).split("_")
        if len(parts) > 2:
            models.append(parts[2])
    job_body["models"] = " ".join(models)

    return ObjectClassification.run(path.pipeid, token, job_body, secret)


@od_blp.post("/update_class_support_tensor_file_path/<ids>",
             summary="Update the class support tensor file path for an object detection entry",
             responses={"200": MessageOut})
def update_class_support_tensor_file_path(path: IdsPath, body: ClassSupportTensorUpdate):
    token, user = getAuth(request)
    update_object_detection(path.ids, {
        "class_supports_tensor_file_path": body.class_support_tensor_file_path,
        "cropSize": body.crop_size,
    })
    return jsonify({"message": "Class support tensor file path updated."})


@od_blp.get("/get_all_query_image_configurations/<int:pipeId>",
            summary="List all query image configurations for a pipeline",
            responses={"200": QueryImageConfigOut})
def get_all_query_image_configurations(path: PipeIdPath):
    token, user = getAuth(request)
    return jsonify(get_all_query_configurations(path.pipeId))


@od_blp.post("/update_current_query_image_configuration/<int:pipeId>/<int:configId>",
             summary="Update a query image configuration",
             responses={"200": MessageOut})
def update_current_query_image_configuration(path: PipeIdConfigIdPath, body: QueryImageConfigUpdate):
    token, user = getAuth(request)
    if update_query_image_configuration(path.configId, body.model_dump(exclude_none=True)):
        return jsonify({"message": "Current query image configuration updated."})
    abort(400, description="Failed to update current query image configuration.")


@od_blp.post("/update_object_detection_entry/<int:pipeId>",
             summary="Update an object detection entry",
             responses={"200": MessageOut})
def update_object_detection_entry(path: PipeIdPath, body: ObjectDetectionUpdate):
    token, user = getAuth(request)
    if update_object_detection(path.pipeId, body.model_dump(exclude_none=True)):
        return jsonify({"message": "Object detection entry updated."})
    abort(400, description="Failed to update object detection entry.")


# ── Jobs ──────────────────────────────────────────────────────────────────────
def _get_tapis_job_status(job_id, tapis_token):
    url = f"https://icicleai.tapis.io/v3/jobs/{job_id}"
    resp = requests.get(url, headers={"X-Tapis-Token": tapis_token, "Content-Type": "application/json"})
    if resp.status_code == 200:
        result = resp.json()["result"]
        return {
            "job_id": result.get("uuid"),
            "status": result.get("status"),
            "condition": result.get("condition"),
            "message": result.get("lastMessage"),
            "execSystemOutputDir": result.get("execSystemOutputDir"),
            "execSystemId": result.get("execSystemId"),
        }
    return None


@jobs_blp.get("/get_job_status/<job_id>",
              summary="Get the status of a Tapis job",
              responses={"200": JobStatusOut})
def get_job_status(path: JobIdPath):
    token, user = getAuth(request)
    result = _get_tapis_job_status(path.job_id, token)
    if result is None:
        abort(404, description=f"Job not found: {path.job_id}")
    return jsonify(result)


@jobs_blp.get("/download_job_logs/<job_id>",
              summary="Download tapisjob.out log for a job")
def download_job_logs(path: JobIdPath):
    token, user = getAuth(request)
    status = _get_tapis_job_status(path.job_id, token)
    if not status:
        abort(500, description=f"Failed to get job status for {path.job_id}")
    exec_dir = status.get("execSystemOutputDir")
    system = status.get("execSystemId")
    if not exec_dir or not system:
        abort(404, description=f"No output dir found for job {path.job_id}")
    try:
        content, mimetype, filename = fetch_file_from_tapis(system, exec_dir + "/tapisjob.out", token)
        return send_file(io.BytesIO(content), mimetype=mimetype, as_attachment=False, download_name=filename)
    except Exception as e:
        abort(500, description=str(e))


@jobs_blp.get("/cancel-job/<int:pipeId>/<jobId>",
              summary="Cancel a running Tapis job",
              responses={"200": MessageOut})
def cancelCurrentJob(path: PipeJobPath):
    token, user = getAuth(request)
    resp = requests.post(
        url=f"https://icicleai.tapis.io/v3/jobs/{path.jobId}/cancel",
        headers={"X-Tapis-Token": token},
    )
    if resp.status_code == 200:
        if resp.json().get("result", {}).get("status") == "CANCELED":
            return jsonify({"message": "Job cancellation successful."})
        return jsonify({"message": "Cancellation request sent but job not yet CANCELED."})
    abort(404, description="Job cancellation failed.")


# ── Admin ─────────────────────────────────────────────────────────────────────
@admin_blp.get("/is-admin",
               summary="Check whether the authenticated user is an admin",
               responses={"200": IsAdminOut})
def check_is_admin():
    token, user = getAuth(request)
    return jsonify({"is_admin": is_admin_user(user)})


# ── Patra ─────────────────────────────────────────────────────────────────────
@patra_blp.get("/list", summary="List all Patra model cards")
def patra_list():
    token, user = getAuth(request)
    try:
        resp = requests.get(f"{PATRA_BASE_NEW}/modelcards", headers={"X-Tapis-Token": token})
        if resp.status_code != 200:
            abort(404, description="Failed to fetch Patra model cards")
        return jsonify(resp.json())
    except Exception as e:
        abort(502, description=str(e))


@patra_blp.get("/download_mc/<mc_id>", summary="Fetch a single Patra model card by ID")
def patra_download_mc_route(path: McIdPath):
    new = request.args.get("new", "false").lower() == "true"
    token, user = getAuth(request)
    return patra_download_mc(path.mc_id, token, new=new)


def patra_download_mc(mc_id, token, new=False):
    if not mc_id:
        abort(400, description="id param required")
    try:
        resp = requests.get(f"{PATRA_BASE_NEW}/modelcard/{mc_id}", headers={"X-Tapis-Token": token})
        if resp.status_code != 200:
            abort(404, description="Failed to fetch Patra model card")
        return jsonify(resp.json())
    except Exception as e:
        abort(502, description=str(e))


# ── Vault ─────────────────────────────────────────────────────────────────────
@vault_blp.post("/secret/<secret_name>",
                summary="Store a secret in the Tapis vault")
def create_vault_secret(path: SecretNamePath, body: VaultSecretWrite):
    token, user = getAuth(request)
    url = f"{TAPIS_BASE}/v3/security/vault/secret/user/{path.secret_name}"
    payload = {"tenant": "icicleai", "user": user, "data": body.data}
    try:
        resp = requests.post(url, headers={"X-Tapis-Token": token, "Content-Type": "application/json"}, json=payload)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        abort(500, description=str(e))


@vault_blp.get("/secret/<secret_name>",
               summary="Read a secret from the Tapis vault (value is masked)",
               responses={"200": VaultSecretRead})
def read_vault_secret_route(path: SecretNamePath):
    token, user = getAuth(request)
    try:
        res = read_vault_secret(path.secret_name, user, token)
        if res is not None:
            return jsonify({"secret": res})
        abort(404, description="Secret not found")
    except Exception as e:
        abort(500, description=str(e))


@vault_blp.delete("/secret/<secret_name>",
                  summary="Destroy a secret from the Tapis vault",
                  responses={"200": MessageOut})
def destroy_vault_secret(path: SecretNamePath):
    token, user = getAuth(request)
    url = f"{TAPIS_BASE}/v3/security/vault/secret/destroy/user/{path.secret_name}"
    payload = {"tenant": "icicleai", "user": user, "versions": []}
    try:
        resp = requests.post(url, headers={"X-Tapis-Token": token, "Content-Type": "application/json"}, json=payload)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        abort(500, description=str(e))


def read_vault_secret(secret_name, user, token, mask=True):
    url = f"{TAPIS_BASE}/v3/security/vault/secret/user/{secret_name}?tenant=icicleai&user={user}"
    try:
        resp = requests.get(url, headers={"X-Tapis-Token": token})
        resp_json = json.loads(resp.content)
        if resp.status_code == 200 and "result" in resp_json:
            secret = resp_json["result"].get("secretMap", {}).get("HF_TOKEN", None)
            if mask and secret and len(secret) > 3:
                return secret[:3] + "*****************"
            return secret
        return None
    except Exception:
        return None


def test_pipe(pipeline, user):
    is_user_pipeline(pipeline, user)


# ── Register blueprints ───────────────────────────────────────────────────────
app.register_api(auth_blp)
app.register_api(pipes_blp)
app.register_api(annot_blp)
app.register_api(files_blp)
app.register_api(od_blp)
app.register_api(jobs_blp)
app.register_api(admin_blp)
app.register_api(patra_blp)
app.register_api(vault_blp)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("--host", type=str, help="Host IP")
    parser.add_argument("--port", type=int, default=11112, help="Port")
    parser.add_argument("--interactive", type=int, default=0)
    args = parser.parse_args()

    if args.interactive:
        app.run(host=args.host, port=args.port, threaded=False)
    else:
        app.run(threaded=True, port=11112, host="0.0.0.0")
