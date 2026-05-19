import os
import io
import json
import argparse
import time

import urllib.parse
import base64

import numpy as np
import cv2
from PIL import Image

from flask import Flask, send_file, abort
from flask import request, redirect
from flask import jsonify, make_response
from flask_cors import CORS

from db import *
from steps import *


os.environ.setdefault("APP_CONFIG_PATH", "./config.yaml")
os.environ.setdefault("FRONT_URL", "https://localhost:5174")
os.environ.setdefault("COOKIE_DOMAIN", "localhost")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
PATRA_BASE_NEW = os.getenv("PATRA_BASE_NEW", "https://patrabackend.pods.icicleai.tapis.io")

from iciflaskn import auth
from iciflaskn.config import config

app = Flask(__name__, template_folder="templates")

CORS(
    app,
    resources={r"/*": {"origins": "*"}},
    allow_headers=["Tapis-Token", "Content-Type", "Authorization"],
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
)

app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config.from_object(__name__)

def getAuth(request):
    try:
        token = request.headers.get("Tapis-Token")
        if not token:
            abort(401, description="Missing Tapis-Token header")
        username = auth.get_username(token)
        return token, username
    except Exception:
        abort(403, description="Tapis Authentication has failed please log back in")

### TODO : needs removal after testing
@app.route("/tapisui-entry", methods=["GET"])
def tapisUI_entry():
    """
    Entrypoint for TapisUI iframe
    """
    jwt = request.args.get("jwt")

    if not jwt:
        raise Exception(f"Error: No JWT in request")

    username = auth.get_username(jwt)

    response = make_response(redirect(os.environ["FRONT_URL"], code=302))

    domain = os.environ["COOKIE_DOMAIN"]
    response.set_cookie("token", jwt, domain=domain, secure=False)
    response.set_cookie("username", username, domain=domain, secure=False)

    return response

### TODO : needs removal after testing
@app.route("/login", methods=["GET"])
def login():
    """
    Check for the existence of a login session, and if none exists, start the OAuth2 flow.
    """
    authenticated, _, _ = auth.is_logged_in()
    if authenticated:
        result = {"path": "/", "code": 302}
        return result
    callback_url = f"{config['app_base_url']}/oauth2/callback"
    tapis_url = f"{config['tapis_base_url']}/v3/oauth2/authorize?client_id={config['client_id']}&redirect_uri={callback_url}&response_type=code"
    result = {"path": tapis_url, "code": 302}
    return jsonify(result)

### TODO : needs removal after testing
@app.route("/oauth2/callback", methods=["GET"])
def callback():
    """
    Process a callback from a Tapis authorization server:
      1) Get the authorization code from the query parameters.
      2) Exchange the code for a token
      3) Add the user and token to the sessionhttps
      4) Redirect to the /data endpoint.
    """
    code = request.args.get("code")
    if not code:
        raise Exception(f"Error: No code in request; debug: {request.args}")
    url = f"{config['tapis_base_url']}/v3/oauth2/tokens"
    data = {
        "code": code,
        "redirect_uri": f"{config['app_base_url']}/oauth2/callback",
        "grant_type": "authorization_code",
    }
    try:
        response = requests.post(
            url, data=data, auth=(config["client_id"], config["client_key"])
        )
        response.raise_for_status()
        json_resp = json.loads(response.text)
        token = json_resp["result"]["access_token"]["access_token"]
    except Exception as e:
        raise Exception(f"Error generating Tapis token; debug: {e}")

    username = auth.get_username(token)

    response = make_response(redirect(os.environ["FRONT_URL"], code=302))

    domain = os.environ["COOKIE_DOMAIN"]
    response.set_cookie("token", token, domain=domain, secure=COOKIE_SECURE)
    response.set_cookie("username", username, domain=domain, secure=COOKIE_SECURE)

    return response


# @app.route("/send_file/<digid>/<pic>/<token>")
# def send_files(digid, pic, token):
#     user = auth.get_username(token)
#     test_pipe(digid, user)
#     data_dir = get_data_dir(digid)
#     data_dir = data_dir.replace("tapis://", "")
#     print(data_dir)
#     pic = pic.replace("%252F", "/")
#     headers = {"X-Tapis-Token": token}
#     url = f"https://icicleai.tapis.io/v3/files/content/{data_dir}/{pic}"
#     print(url)
#     response = requests.get(url, headers=headers)
#     con = response.content
#     im = Image.open(io.BytesIO(con))
#     im = im.convert("RGB")
#     buffered = io.BytesIO()
#     im.save(buffered, format="JPEG")
#     buffered.seek(0)
#     return send_file(
#         buffered,
#         mimetype="image/jpeg",
#         as_attachment=True,
#         download_name="%s.jpg" % pic,
#     )

@app.route("/get-img/<digid>/<system>", methods=["GET"])
def get_img(digid, system):
    raw = request.args.get("imgURL") or request.args.get("filePath")
    if not raw:
        abort(400, description="Missing imgURL or filePath query parameter")
    imgURL = raw.replace("tapis://", "")
    token, user = getAuth(request)
    test_pipe(digid, user)
    headers = {"X-Tapis-Token": token}
    url = f"https://icicleai.tapis.io/v3/files/content/{system}/{imgURL}"
    print(url)
    response = requests.get(url, headers=headers)
    con = response.content
    mimetype = response.headers.get("Content-Type", "application/octet-stream")
    filename = os.path.basename(imgURL)
    is_tif_mimetype = mimetype.lower() == "image/tiff"
    is_tif_extension = filename.lower().endswith((".tif", ".tiff"))
    if is_tif_mimetype or is_tif_extension:
        print(
            f"Detected TIFF image ({filename}, MIME: {mimetype}). Attempting conversion to JPEG."
        )
        try:
            nparr = np.frombuffer(con, np.uint8)
            img_np = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img_np is None:
                raise ValueError(
                    "OpenCV could not decode the TIFF image. It might be corrupted or an unsupported TIFF variant."
                )
            success, encoded_image = cv2.imencode(
                ".jpeg", img_np, [int(cv2.IMWRITE_JPEG_QUALITY), 90]
            )

            if not success:
                raise ValueError("OpenCV failed to encode the image to JPEG format.")

            converted_io = io.BytesIO(encoded_image.tobytes())
            new_mimetype = "image/jpeg"
            new_filename = os.path.splitext(filename)[0] + ".jpg"

            print(
                f"Successfully converted and sending {new_filename} as {new_mimetype}"
            )
            return send_file(
                converted_io, mimetype=new_mimetype, download_name=new_filename
            )
        except Exception as e:
            print(f"ERROR: During TIFF conversion for {filename}: {e}")
            abort(500, description=f"Failed to convert TIFF image: {e}")
    else:
        print(f"Sending image ({filename}) as original mimetype: {mimetype}")
        return send_file(io.BytesIO(con), mimetype=mimetype, download_name=filename)   

def fetch_file_from_tapis(system, file_path, token):
   
    clean_path = file_path.replace("tapis://", "").lstrip("/")
    headers = {"X-Tapis-Token": token}
    url = f"https://icicleai.tapis.io/v3/files/content/{system}/{clean_path}"
    
    print(f"Fetching file from {url}")
    response = requests.get(url, headers=headers)
    
    if response.status_code != 200:
        raise Exception(f"Tapis file fetch failed: {response.text}")
    
    content = response.content
    mimetype = response.headers.get("Content-Type", "application/octet-stream")
    filename = os.path.basename(clean_path)
    
    return content, mimetype, filename


@app.route("/get_file/<digid>/<system>", methods=["GET"])
def get_file(digid, system):
    raw_path = request.args.get("filePath") or request.args.get("imgURL")
    if not raw_path:
        abort(400, description="Missing filePath or imgURL query parameter")

    token, _ = getAuth(request)
    
    try:
        content, mimetype, filename = fetch_file_from_tapis(system, raw_path, token)
        return send_file(
            io.BytesIO(content),
            mimetype=mimetype,
            as_attachment=False,
            download_name=filename,
        )
    except Exception as e:
        abort(500, description=str(e))
    
@app.route("/get_files/<digid>/<system>", methods=["GET"])
def get_files(digid, system):
    dirPath = request.args.get("dir").replace("tapis://", "")
    token, user = getAuth(request)
    headers = {"X-Tapis-Token": token}
    url = f"https://icicleai.tapis.io/v3/files/ops/{system}/{urllib.parse.quote(dirPath, safe='/-_')}"
    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        return f"Error fetching files: {response.text}", response.status_code
    results = response.json().get("result", [])
    list_of_files = [f["path"] for f in results if f["type"] == "file"]
    return json.dumps({"files": list_of_files})
    
    
####### Pipeline and annotation related endpoints ######################
@app.route("/pipes")
def getpipes():
    token, user = getAuth(request)
    pipelines = get_pipelines(user)
    data = []
    try:
        for pipe in pipelines:
            data.append({
                "pid": pipe["pipelineid"],
                "name": pipe["name"],
                "description": pipe["description"],
                "slurm_account": pipe["slurmaccount"],
                "is_demo": pipe["pipelineuser"] == 0,
            })
    except Exception as e:
        print(e)
    return json.dumps(data)


@app.route("/pipe/<pipe_id>", methods=["GET"])
def getpipe(pipe_id):
    token, user = getAuth(request)
    rows = is_user_pipeline(pipe_id, user)
    if not rows:
        abort(404, f"Pipeline not found: {pipe_id}")
    pipe = rows[0]
    return jsonify({
        "pid": pipe["pipelineid"],
        "name": pipe["name"],
        "description": pipe["description"],
        "slurm_account": pipe["slurmaccount"],
        "is_demo": pipe["pipelineuser"] == 0,
    })

@app.route("/pipe/create", methods=["POST"])
def newpipe():
    token, user = getAuth(request)
    data = json.loads(request.data)
    return create_pipeline(user, data)

@app.route("/pipe/delete/<pipe_id>", methods=["DELETE"])
def deletepipe(pipe_id):
    token, user = getAuth(request)
    test_pipe(pipe_id, user)
    return delete_pipeline(pipe_id, user)

@app.route("/pipe/update/<pipe_id>", methods=["PUT"])
def updatepipe(pipe_id):
    token, user = getAuth(request)
    test_pipe(pipe_id, user)
    data = json.loads(request.data)
    return update_pipeline(pipe_id, user, data)

########################################################################

####### Annotator Configuration endpoints ################################

@app.route("/is-admin", methods=["GET"])
def check_is_admin():
    token, user = getAuth(request)
    return jsonify({"is_admin": is_admin_user(user)})


@app.route("/annotator-configuration/<int:pipe_id>", methods=["POST"])
def create_annotator_config(pipe_id):
    token, user = getAuth(request)
    test_pipe(pipe_id, user)
    if is_demo_pipeline(pipe_id) and not is_admin_user(user):
        abort(403, description="Only admins can configure demo pipelines.")
    data = request.get_json(force=True)
    config_id = create_annotator_configuration(pipe_id, data)
    return jsonify({"id": config_id}), 201


@app.route("/annotator-configuration/<int:pipe_id>", methods=["GET"])
def get_annotator_config(pipe_id):
    token, user = getAuth(request)
    test_pipe(pipe_id, user)
    configs = get_all_annotator_configurations(pipe_id)
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
    ]), 200


@app.route("/annotator-configuration/config/<int:config_id>", methods=["PUT"])
def update_annotator_config(config_id):
    token, user = getAuth(request)
    config = get_annotator_configuration_by_id(config_id)
    if config and is_demo_pipeline(config["parentpipelineid"]) and not is_admin_user(user):
        abort(403, description="Only admins can configure demo pipelines.")
    data = request.get_json(force=True)
    if update_annotator_configuration(config_id, data):
        return jsonify({"message": "Annotator configuration updated."}), 200
    return jsonify({"message": "No valid fields to update."}), 400


@app.route("/annotator-configuration/config/<int:config_id>", methods=["DELETE"])
def delete_annotator_config(config_id):
    token, user = getAuth(request)
    delete_annotator_configuration(config_id)
    return jsonify({"message": "Annotator configuration deleted."}), 200

########################################################################

##### Files based API endpoints - to be moved to a separate file and cleaned up after testing #####
@app.route("/save-file/<system>", methods=["POST"])
def save_file(system):
    path = request.args.get("path")
    if not path:
        return "Missing 'path' query parameter", 400

    token, user = getAuth(request)
    file = request.get_data(as_text=True)
    if not file:
        return "No file content in the request", 400

    url = f"https://icicleai.tapis.io/v3/files/ops/{system}/{urllib.parse.quote(path, safe='/-_')}"
    headers_post = {"X-Tapis-Token": token}

    file_stream = io.BytesIO(file.encode())
    files = [("file", (f"ann-{time.time()}.json", file_stream, "application/json"))]
    response = requests.post(url, headers=headers_post, files=files)

    if response.status_code != 200:
        return f"Error saving file: {response.text}", response.status_code
    return "File saved successfully", 200


@app.route("/get_job_status/<job_id>", methods=["GET"])
def get_job_status(job_id):
    token, user = getAuth(request)
    return get_tapis_job_status(job_id, token)

def get_tapis_job_status(job_id, tapis_token):
    url = f"https://icicleai.tapis.io/v3/jobs/{job_id}"

    headers = {"X-Tapis-Token": tapis_token, "Content-Type": "application/json"}

    response = requests.get(url, headers=headers)

    if response.status_code == 200:
        full_response = response.json()
        result = full_response["result"]
        return {
            "job_id": result.get("uuid"),
            "status": result.get("status"),
            "condition": result.get("condition"),
            "message": result.get("lastMessage"),
            "execSystemOutputDir": result.get("execSystemOutputDir"),
            "execSystemId": result.get("execSystemId")
        }
    else:
        print(f"Error {response.status_code}: {response.text}")
        return None

@app.route("/download_job_logs/<job_id>", methods=["GET"])
def download_job_logs(job_id):   
    token, user = getAuth(request)
    response = get_tapis_job_status(job_id, token)
    if not response:
        return f"Failed to get job status for job_id {job_id}", 500
    exec_system_output_dir = response.get("execSystemOutputDir")
    system = response.get("execSystemId")
    print(f"Job {job_id} output dir: {exec_system_output_dir}, system: {system}")
    if not exec_system_output_dir or not system:
        print(f"No execSystemOutputDir or execSystemId found for job_id {job_id}")
        return f"No execSystemOutputDir found for job_id {job_id}", 404
    try:
        content, mimetype, filename = fetch_file_from_tapis(system, exec_system_output_dir+"/tapisjob.out", token)
        return send_file(
            io.BytesIO(content),
            mimetype=mimetype,
            as_attachment=False,
            download_name=filename,
        )
    except Exception as e:
        abort(500, description=str(e))


@app.route("/getimgs/<digid>", methods=["GET", "POST"])
def get_imgs(digid):
    token, user = getAuth(request)
    test_pipe(digid, user)
    headers = {"X-Tapis-Token": token}
    url = f"https://icicleai.tapis.io/v3/files/ops/{get_data_dir(digid).replace('tapis://','')}"
    print(url)
    response = requests.get(url, headers=headers)
    list_of_files = []
    for file_path in response.json()["result"]:
        if file_path["type"] == "file":
            list_of_files.append(file_path["name"])
    res = {"img": list_of_files, "num": get_numlabels(digid)}

    return json.dumps(res)


@app.route("/get_imgs_batch/<digid>/<system>", methods=["POST"])
def get_imgs_batch(digid, system):
    from concurrent.futures import ThreadPoolExecutor, as_completed

    token, user = getAuth(request)
    data = request.get_json(force=True)
    file_paths: list = data.get("files", [])

    def fetch_and_encode(file_path: str) -> dict:
        img_url_clean = file_path.replace("tapis://", "").lstrip("/")
        headers = {"X-Tapis-Token": token}
        url = f"https://icicleai.tapis.io/v3/files/content/{system}/{img_url_clean}"
        try:
            response = requests.get(url, headers=headers, timeout=30)
            if response.status_code != 200:
                return {"path": file_path, "error": f"HTTP {response.status_code}"}

            con = response.content
            mimetype = response.headers.get("Content-Type", "application/octet-stream")
            filename = os.path.basename(img_url_clean)

            is_tif = mimetype.lower() == "image/tiff" or filename.lower().endswith((".tif", ".tiff"))
            if is_tif:
                try:
                    nparr = np.frombuffer(con, np.uint8)
                    img_np = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    if img_np is not None:
                        success, encoded_image = cv2.imencode(
                            ".jpeg", img_np, [int(cv2.IMWRITE_JPEG_QUALITY), 90]
                        )
                        if success:
                            con = encoded_image.tobytes()
                            mimetype = "image/jpeg"
                except Exception as e:
                    print(f"TIFF conversion failed for {filename}: {e}")

            return {
                "path": file_path,
                "data": base64.b64encode(con).decode("utf-8"),
                "mime": mimetype,
            }
        except Exception as e:
            return {"path": file_path, "error": str(e)}

    with ThreadPoolExecutor(max_workers=min(10, len(file_paths) or 1)) as executor:
        results = list(executor.map(fetch_and_encode, file_paths))

    return jsonify({"images": results})


@app.route("/get-imgs-in-dir/<digid>/<system>", methods=["GET", "POST"])
def get_imgs_in_dir(digid, system):

    token, user = getAuth(request)
    dir = request.args.get("dir")
    n = request.args.get("n")
    supported_extensions = [".JPEG", ".JPG", ".PNG", ".TIF", ".TIFF"]
    
    headers = {"X-Tapis-Token": token}
    url = f"https://icicleai.tapis.io/v3/files/ops/{system}/{urllib.parse.quote(dir, safe='/-_')}"
    
    offset = 0
    list_of_files = []
    count = 0
    n = int(n) if n is not None else 50000
    completed = False
    
    while not completed:
        
        response = requests.get(url, headers=headers, params={"offset": offset, "limit": 1000})
        if response.status_code != 200:
            break
        
        results = response.json().get("result", [])
        if not results:
            break
        for file_path in results:
            if count >= n:
                completed = True
                break
            if file_path["type"] == "file" and (
                file_path["name"].upper().endswith(tuple(supported_extensions))
            ):
                list_of_files.append(file_path["path"])
                count += 1
        if len(results) < 1000:
            completed = True    

        offset += 1000
            
    return json.dumps({"imgs": list_of_files})


TAPIS_BASE = "https://icicleai.tapis.io"


@app.errorhandler(400)
def handle_bad_request(e):
    msg = getattr(e, "description", str(e))
    return jsonify({"error": msg}), 400

@app.errorhandler(401)
def handle_unauthorized(e):
    msg = getattr(e, "description", str(e))
    return jsonify({"error": msg}), 401

@app.errorhandler(403)
def handle_forbidden(e):
    msg = getattr(e, "description", str(e))
    return jsonify({"error": msg}), 403

@app.errorhandler(404)
def handle_not_found(e):
    msg = getattr(e, "description", str(e))
    return jsonify({"error": msg}), 404

@app.errorhandler(500)
def handle_server_error(e):
    msg = getattr(e, "description", str(e))
    return jsonify({"error": msg}), 500

@app.route("/get_object_detection_pipeline/<id>", methods=["GET"])
def get_od_pipeline(id):
    token, user = getAuth(request)
    return get_object_detection_pipeline(id)

@app.route("/get-object-detection-pipeline/<pipeId>", methods=["GET"])
def getObjectDetectionPipeline(pipeId):
    token, user = getAuth(request)
    pipeline = get_object_detection_pipeline(pipeId)
    if not pipeline:
        abort(404, f"Pipeline not found: {pipeId}")
    data = {
        'id': pipeline["detectionid"],
        'system': pipeline["system"],
        'srcImgDir': pipeline["srcimgdir"],
        'annotationFilePath': pipeline["annotationfilepath"],
        'model_ids': pipeline["model_ids"],
        'method': pipeline["method"],
        'device': pipeline["device"],
        'outputDir': pipeline["outputdir"],
        'cropSize': pipeline["cropsize"],
        'generateClassSupportJobId': pipeline["generate_class_supports_job_id"],
        'classSupportsPath': pipeline["class_supports_tensor_file_path"],
        'current_query_image_configuration': pipeline["current_query_image_configuration"],
        'name': pipeline["name"],
        'crop_sizes': pipeline["crop_sizes"],
        'model_names': pipeline["model_names"],
        'is_demo': bool(pipeline.get("is_demo", False)),
    }
    if data['current_query_image_configuration'] and data['current_query_image_configuration'] != 0:
        query_image_configuration = get_query_image_configuration(data['current_query_image_configuration'])
        if query_image_configuration:
            data['query_image_configuration'] = {
                'id': query_image_configuration["id"],
                'objectnessThreshold': query_image_configuration["objectnessthreshold"],
                'nmsIoUThreshold': query_image_configuration["nmsiouthreshold"],
                'similarityThreshold': query_image_configuration["similaritythreshold"],
                'queryImagePath': query_image_configuration["queryimagepath"],
                'outputDir': query_image_configuration["outputdir"],
                'device': query_image_configuration["device"],
                'method': query_image_configuration["method"],
                'objectnessThresholdJobId': query_image_configuration["objectnessthresholdjobid"],
                'detectionJobId': query_image_configuration["detectionjobid"],
                'system': query_image_configuration["system"],
                'object_feature_tensor_file_path': query_image_configuration["object_feature_tensor_file_path"],
                'name': query_image_configuration["name"],
                'proposer_ids': query_image_configuration["proposer_ids"],
                'embedder_ids': query_image_configuration["embedder_ids"],
                'is_sahi': query_image_configuration["is_sahi"],
                'tile_size': query_image_configuration["tile_size"],
                'overlap_ratio': query_image_configuration["overlap_ratio"],
                'batch_size': query_image_configuration["batch_size"],
                'proposer_models': query_image_configuration.get("proposer_models", ""),
                'embedder_models': query_image_configuration.get("embedder_models", ""),
                'class_support_paths': query_image_configuration.get("class_support_paths", ""),
                'proposal_tensor_paths': query_image_configuration.get("proposal_tensor_paths", ""),
            }
            
    return jsonify(data), 200

@app.route("/generate_class_supports/<ids>", methods=["POST"])
def generate_class_supports(ids):
    optimize_crop_size = request.args.get("optimize_crop_size", "false").lower() == "true"
    print("done fetching args")
    data = json.loads(request.data)
    token, user = getAuth(request)
    secret = None
    try:
        secret = read_vault_secret("hftoken", user, token, False)
    except Exception as e:
        print(f"Error reading vault secret: {e}")
        
    models = []
    if optimize_crop_size:
        print("Optimizing crop size, skipping model downloads")
        models = ["owlv2"]
    else :     
        try :   
            for model_id in data.get("model_ids", "").split(","):
                response = patra_download_mc(model_id, token, data["newPatra"] if "newPatra" in data else False)
                if isinstance(response, tuple):
                    print(f"Error fetching model {model_id}: {response[0]}")
                    continue

                model_data = response.get_json() if hasattr(response, 'get_json') else response
                models.append(model_data.get("ai_model", {}).get("name", ""))        
        except Exception as e:
            print(f"Error occurred while downloading models: {e}")
    print(f"Fetched model names: {models}")  
        
    body = {
            "srcImgDir": data["srcImgDir"],
            "annotationFilePath": data["annotationFilePath"],
            "system": data["system"],
            "method": data["method"],
            "cropSize": data["cropSize"],
            "device": data["device"],
            "outputDir": data["outputDir"],
            "model_ids": data.get("model_ids", ""),
            "name": data.get("name", ""),
            "crop_sizes": data.get("crop_sizes", "1024"),
            "model_names": ",".join(models) if models else "",
            "modelName": data.get("modelName", ""),
        }
    if not optimize_crop_size:
        create_object_detection_entry(ids, body)
        print("Created new object detection entry")
    else :
        cropSize = 1024
        if 'cropSize' not in body or not isinstance(body['cropSize'], (int)):
            if 'cropSize' in body and isinstance(body['cropSize'], str):
                try:
                    parsed_list = json.loads(body['cropSize'])
                    if isinstance(parsed_list, list) and parsed_list:
                        cropSize = int(parsed_list[0])
                except (json.JSONDecodeError, ValueError, IndexError):
                    cropSize = 1024
                    pass
        else :
            cropSize = body['cropSize']        
        update_object_detection(ids, {"cropSize": cropSize, "crop_sizes": data.get("crop_sizes", "1024")})
        print("Updated object detection entry")
    
    body["models"] = models
    res = ObjectDetectionClassSupports.run(
        ids,
        token,
        body,
        secret
    )
    return res

@app.route("/object-detection/<pipeid>/<id>", methods=["POST"])
def object_detection(pipeid, id):
    data = json.loads(request.data)
    token, user = getAuth(request)
    secret = None
    print(f"Received object detection request for pipeid: {pipeid}, id: {id}, user: {user}")
    print(f"Request data: {data}")
    try:
        secret = read_vault_secret("hftoken", user, token, False)
    except Exception as e:
        print(f"Error reading vault secret: {e}")
        
    embedder_names, proposer_names = [], []
    print(f"Embedder names: {embedder_names}")
    print(f"Proposer names: {proposer_names}")

    try:
        if "embedder_ids" in data and data["embedder_ids"]:
            embedder_ids = [mid.strip() for mid in data["embedder_ids"].split(",") if mid.strip()]
            for model_id in embedder_ids:
                response = patra_download_mc(model_id, token, data["newPatra"] if "newPatra" in data else False)
                if isinstance(response, tuple):
                    print(f"Error fetching embedder model {model_id}: {response[0]}")
                else:
                    model_data = response.get_json() if hasattr(response, 'get_json') else response
                    model_name = model_data.get("ai_model", {}).get("name", "")
                    if model_name:
                        embedder_names.append(model_name)
        
        if "proposer_ids" in data and data["proposer_ids"]:
            proposer_ids = [mid.strip() for mid in data["proposer_ids"].split(",") if mid.strip()]
            for model_id in proposer_ids:
                response = patra_download_mc(model_id, token, data["newPatra"] if "newPatra" in data else False)
                if isinstance(response, tuple):
                    print(f"Error fetching proposer model {model_id}: {response[0]}")
                else:
                    model_data = response.get_json() if hasattr(response, 'get_json') else response
                    model_name = model_data.get("ai_model", {}).get("name", "")
                    if model_name:
                        proposer_names.append(model_name)
    except Exception as e:
        print(f"Error occurred while downloading embedder/proposer models: {e}")
    
        
    body = {
            "id": id,
            "queryImagePath": data["queryImagePath"],
            "system": data["system"],
            "method": data["method"],
            "device": data["device"],
            "outputDir": data["outputDir"],
            "objectnessThreshold": data["objectnessThreshold"],
            "similarityThreshold": data["similarityThreshold"],
            "nmsIoUThreshold": data["nmsIoUThreshold"],
            "name": data["name"],
            "batch_size": data.get("batch_size", 4),
            "tile_size": data.get("tile_size", 960),
            "overlap_ratio": data.get("overlap_ratio", 0.2),
            "embedder_ids": data.get("embedder_ids", "4"),
            "proposer_ids": data.get("proposer_ids", "1"),
            "is_sahi": data.get("is_sahi", False),
            "is_query_dir": data.get("is_query_dir", False),
            "embedder_models": ",".join(embedder_names) if embedder_names else "",
            "proposer_models": ",".join(proposer_names) if proposer_names else ""
        }
    
    if int(id) == 0:
        print("Creating new query image configuration")
        create_query_image_configuration(pipeid, body)
        
    else:
        print("Updating existing query image configuration")
        update_query_image_configuration(id, body)   
    
    if int(id) == 0:
        id = get_latest_query_image_configuration_id(pipeid)
        body['id'] = id
        print(f"Fetched latest query image configuration id: {id}") 
    
    body["embedder_ids"] = ",".join(embedder_names) if embedder_names else ""
    body["proposer_ids"] = ",".join(proposer_names) if proposer_names else ""
    
    res = ObjectDetection.run(
        pipeid,
        token,
        body,
        secret
    )
    
    return res

@app.route("/object-classification/<pipeid>/<od_id>", methods=["POST"])
def object_classification(pipeid, od_id):
    data = json.loads(request.data)
    token, user = getAuth(request)
    secret = None
    try:
        secret = read_vault_secret("hftoken", user, token, False)
    except Exception as e:
        print(f"Error reading vault secret: {e}")
        
    
    body = {
            "id": data['id'],
            "queryImagePath": data["queryImagePath"],
            "system": data["system"],
            "outputDir": data["outputDir"],
            "objectnessThreshold": data["objectnessThreshold"],
            "similarityThreshold": data["similarityThreshold"],
            "class_support_paths": data["class_support_paths"],
            "proposal_tensor_paths": data["proposal_tensor_paths"],
            "is_query_dir": data['is_query_dir'],
            "name": data.get("name", ""),
        }
    update_query_image_configuration(body['id'], body)
    models =[]
    if data['class_support_paths']:
        for path in data['class_support_paths'].split(" "):
            filename = path.split("/")[-1]
            components = filename.split("_")
            model = components[2] if len(components) > 2 else ""
            if model:
                models.append(model)
    body["models"] = " ".join(models)  
    body["name"] = data["name"]      
    res = ObjectClassification.run(
        pipeid,
        token,
        body,
        secret
    )
    return res


@app.route("/update_class_support_tensor_file_path/<ids>", methods=["POST"])
def update_class_support_tensor_file_path(ids):
    data = json.loads(request.data)
    token, user = getAuth(request)
    class_support_tensor_file_path = data["class_support_tensor_file_path"]
    crop_size = data["crop_size"]
    update_object_detection(ids, {"class_supports_tensor_file_path": class_support_tensor_file_path, "cropSize": crop_size})
    return jsonify({"message": "Class support tensor file path updated."}), 200

@app.route("/get_all_query_image_configurations/<pipeId>", methods=["GET"])
def get_all_query_image_configurations(pipeId):
    token, user = getAuth(request)
    return jsonify(get_all_query_configurations(pipeId)), 200

@app.route("/update_current_query_image_configuration/<pipeId>/<configId>", methods=["POST"])
def update_current_query_image_configuration(pipeId, configId):
    token, user = getAuth(request)
    data = json.loads(request.data)
    if update_query_image_configuration(configId, data):
        return jsonify({"message": "Current query image configuration updated."}), 200
    return jsonify({"message": "Failed to update current query image configuration."}), 400

@app.route("/update_object_detection_entry/<pipeId>", methods=["POST"])
def update_object_detection_entry(pipeId):
    token, user = getAuth(request)
    data = json.loads(request.data)
    if update_object_detection(pipeId, data):
        return jsonify({"message": "Object detection entry updated."}), 200
    return jsonify({"message": "Failed to update object detection entry."}), 400

@app.route("/cancel-job/<pipeId>/<jobId>", methods=["GET"])
def cancelCurrentJob(pipeId, jobId):
    token, user = getAuth(request)

    if not jobId:
        return jsonify({"message": "No job found to cancel"}), 404
    print("JobId to be cancelled : " + jobId)
    response = requests.post(
        url=f"https://icicleai.tapis.io/v3/jobs/{jobId}/cancel",
        headers={"X-Tapis-Token": token},
    )
    if response.status_code == 200:
        cancel_response = response.json()
        if cancel_response.get("result", {}).get("status") == "CANCELED":
            return jsonify({"message": "Job cancellation successful."}), 200
        else:
            return jsonify({"message": "Job cancellation request sent but job status is not CANCELED."}), 200
    else:
        return jsonify({"message": "Job cancellation failed."}), 404


def test_pipe(pipeline, user):
    is_user_pipeline(pipeline, user)

@app.route("/patra/list", methods=["GET"])
def patra_list():
    print("Received request for Patra model card list")
    new = request.args.get("new", "false").lower() == "true"
    token, user = getAuth(request)
    
    try:
        url = f"{PATRA_BASE_NEW}/modelcards"
        headers = {"X-Tapis-Token": token} 
        res = requests.get(url, headers=headers)
        if res.status_code != 200:
            return jsonify({"message": "Failed to fetch Patra model cards"}), 404
        return res.json()

    except Exception as e:
        print(f"Error fetching Patra models: {e}")
        return jsonify({"error": str(e)}), 502

@app.route("/patra/download_mc/<mc_id>", methods=["GET"])
def patra_download_mc(mc_id: str):
    token, user = getAuth(request)
    new = request.args.get("new", "false").lower() == "true"
    return patra_download_mc(mc_id, token, new=new)

def patra_download_mc(mc_id: str, token: str, new: bool = False):
    if not mc_id:
        return jsonify({"error": "id param required"}), 400
    try:
        url = f"{PATRA_BASE_NEW}/modelcard/{mc_id}"
        headers = {"X-Tapis-Token": token} 
        res = requests.get(url, headers=headers)
        print(f"Fetched model card {mc_id} with status code {res.status_code} .. {res}")
        if res.status_code != 200:
            return jsonify({"message": "Failed to fetch Patra model card"}), 404
        return jsonify(res.json())
    except Exception as e:
        return jsonify({"error": str(e)}), 502  


@app.route("/api/vault/secret/<secret_name>", methods=["POST"])
def create_vault_secret(secret_name):
    token, user = getAuth(request)
    data = request.get_json(force=True)
    url = f"{TAPIS_BASE}/v3/security/vault/secret/user/{secret_name}"
    headers = {
        "X-Tapis-Token": token,
        "Content-Type": "application/json"
    }
    payload = {
        "tenant": "icicleai",
        "user": user,
        "data": data.get("data", {})
    }
    try:
        resp = requests.post(url, headers=headers, json=payload)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/vault/secret/<secret_name>", methods=["GET"])
def read_vault_secret_mask(secret_name):
    token, user = getAuth(request)
    try:
        res = read_vault_secret(secret_name, user, token)
        if res is not None:
            return jsonify({"secret": res}), 200
        else:
            return jsonify({"error": "Secret not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500    
    
    

def read_vault_secret(secret_name, user, token, mask: bool = True):
    
    url = f"{TAPIS_BASE}/v3/security/vault/secret/user/{secret_name}?tenant=icicleai&user={user}"
    headers = {"X-Tapis-Token": token}
    try:
        resp = requests.get(url, headers=headers) 
        resp_json = json.loads(resp.content)

        if resp.status_code == 200 and "result" in resp_json:
            secret_data = resp_json["result"].get("secretMap", {}).get("HF_TOKEN", None)
            if mask:
                masked_data = secret_data[:3] + "*****************" if secret_data and len(secret_data) > 3 else None
                return masked_data
            else :
                return secret_data
        else:
            return None

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/vault/secret/<secret_name>", methods=["DELETE"])
def destroy_vault_secret(secret_name):
    token, user = getAuth(request)
    url = f"{TAPIS_BASE}/v3/security/vault/secret/destroy/user/{secret_name}"
    headers = {
        "X-Tapis-Token": token,
        "Content-Type": "application/json"
    }
    payload = {
        "tenant": "icicleai",
        "user": user,
        "versions": []
    }
    try:
        resp = requests.post(url, headers=headers, json=payload)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="End2End testing",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--host", type=str, help="the IP of host to run flask server")
    parser.add_argument(
        "--port", type=int, default=11112, help="the port to run flask server on"
    )
    parser.add_argument(
        "--interactive",
        type=int,
        default=0,
        help="flag to enable interactive version of SAI that requires host and port from the user",
    )

    args = parser.parse_args()

   
    if args.interactive:
        print(
            "Interactive mode is activated with Host: "
            + args.host
            + " and port: "
            + str(args.port)
        )
        print(type(args.host))
        print(type(args.port))
        app.run(host=args.host, port=args.port, threaded=False)
    else:
        print("passenger mode is activated by default")
        app.run(threaded=True, port=11112, host="0.0.0.0")
        
  
      
