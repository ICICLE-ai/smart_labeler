"""
Smart Labeler side of ProtoRCD triage: hand the jobs' outputs to the triage service.

The triage service (jobs/protorcd/triage) runs the human-in-the-loop session; this
module is the only place that talks to it. It picks the embedding files from the
pipeline's finished embed jobs (or files the user already had), downloads them from the HPC system through Tapis,
registers them as a triage dataset, creates
sessions, and returns a WebSocket URL carrying the session's own token, so the
service-wide TRIAGE_API_TOKEN never reaches a browser.
"""

import hashlib
import json
import os
import posixpath
import tempfile
import urllib.parse

import requests

TRIAGE_SERVICE_URL = os.getenv("TRIAGE_SERVICE_URL", "").rstrip("/")
# What a browser uses to reach the service, when it differs from the URL this
# server uses (e.g. an in-cluster Service name vs. the public ingress).
TRIAGE_PUBLIC_URL = (os.getenv("TRIAGE_PUBLIC_URL") or TRIAGE_SERVICE_URL).rstrip("/")
TRIAGE_API_TOKEN = os.getenv("TRIAGE_API_TOKEN", "")
TAPIS_BASE_URL = os.getenv("TAPIS_BASE_URL", "https://icicleai.tapis.io")

# Uploading a large pool and loading it can take minutes.
REGISTER_TIMEOUT_S = int(os.getenv("TRIAGE_REGISTER_TIMEOUT_S", "1800"))

BACKGROUND_MODELS = ("dinov3", "dinov3_debiased")
FOREGROUND_MODEL = "bioclip"


class TriageError(Exception):
    """A failure to show the user as-is, with the HTTP status to answer with."""

    def __init__(self, message, status=502):
        super().__init__(message)
        self.message = message
        self.status = status


def configured():
    return bool(TRIAGE_SERVICE_URL)


def _call(method, path, *, timeout=60, **kwargs):
    if not configured():
        raise TriageError("The triage service is not configured on this server (TRIAGE_SERVICE_URL).", 503)
    headers = {"Authorization": f"Bearer {TRIAGE_API_TOKEN}"} if TRIAGE_API_TOKEN else {}
    try:
        return requests.request(method, f"{TRIAGE_SERVICE_URL}{path}", headers=headers,
                                timeout=timeout, **kwargs)
    except requests.exceptions.RequestException as e:
        raise TriageError(f"Could not reach the triage service: {e}", 502) from e


def _detail(resp):
    try:
        detail = resp.json().get("detail")
        if isinstance(detail, str):
            return detail
    except ValueError:
        pass
    return (resp.text or "").strip()[:300] or f"HTTP {resp.status_code}"


# ── Inputs ────────────────────────────────────────────────────────────────────
def _background_model(models):
    return next((m for m in BACKGROUND_MODELS if m in models), None)


def _describe(jobs, statuses, label):
    if not jobs:
        return f"{label}: no job yet"
    return f"{label}: " + ", ".join(
        f"job {j['job_id'][:8]} {(statuses.get(j['job_id']) or 'status unknown').lower()}" for j in jobs)


def select_inputs(embed_jobs, statuses):
    """The files a triage dataset is built from, picked from the pipeline's embed jobs.

    Any finished jobs may supply them: one job that ran both models, or a DINOv3 job and
    a BioCLIP job. Both files must embed the same proposals file; the newest finished
    pair is used. `statuses` maps job id -> Tapis status. Returns (inputs, None), or
    (None, why triage cannot start yet).
    """
    from steps import protorcd_embedding_file

    if not embed_jobs:
        return None, "Run the embedding jobs before starting triage."
    finished = [j for j in reversed(embed_jobs) if statuses.get(j["job_id"]) == "FINISHED"]
    for anchor in finished:
        same = [j for j in finished
                if (j["config"]["system"], j["config"]["cocoPath"])
                == (anchor["config"]["system"], anchor["config"]["cocoPath"])]
        bg = next((j for j in same if _background_model(j["config"]["models"])), None)
        fg = next((j for j in same if FOREGROUND_MODEL in j["config"]["models"]), None)
        if bg is None or fg is None:
            continue
        bg_cfg, fg_cfg = bg["config"], fg["config"]
        newest = bg if embed_jobs.index(bg) > embed_jobs.index(fg) else fg
        return {
            "system": bg_cfg["system"],
            "image_dir": fg_cfg["imageDir"],
            "coco": bg_cfg["cocoPath"],
            "dinov3": f"{bg_cfg['outputDir'].rstrip('/')}/"
                      f"{protorcd_embedding_file(_background_model(bg_cfg['models']), bg_cfg.get('region', 'box'))}",
            "bioclip": f"{fg_cfg['outputDir'].rstrip('/')}/"
                       f"{protorcd_embedding_file(FOREGROUND_MODEL, fg_cfg.get('region', 'box'))}",
            "output_dir": newest["config"]["outputDir"].rstrip("/"),
            "job_ids": {"dinov3": bg["job_id"], "bioclip": fg["job_id"]},
        }, None

    bg_jobs = [j for j in reversed(embed_jobs) if _background_model(j["config"]["models"])]
    fg_jobs = [j for j in reversed(embed_jobs) if FOREGROUND_MODEL in j["config"]["models"]]
    if any(j in finished for j in bg_jobs) and any(j in finished for j in fg_jobs):
        return None, ("The finished DINOv3 and BioCLIP jobs embedded different proposals files. "
                      "Run the missing model on the same proposals file.")
    return None, ("Triage needs finished DINOv3 and BioCLIP embeddings of the same proposals file. "
                  f"{_describe(bg_jobs, statuses, 'DINOv3')}; {_describe(fg_jobs, statuses, 'BioCLIP')}.")


def files_inputs(files):
    """Triage inputs from files the user already has (made outside these jobs).

    `files` is the saved ProtoRCDTriageFilesRequest. Exports are saved next to the
    BioCLIP file unless an output directory was given. The triage service checks that
    both .npz files hold the right model and were built from this COCO file.
    """
    return {
        "system": files["system"],
        "image_dir": files["imageDir"],
        "coco": files["cocoPath"],
        "dinov3": files["dinov3Path"],
        "bioclip": files["bioclipPath"],
        "output_dir": (files.get("outputDir") or posixpath.dirname(files["bioclipPath"])).rstrip("/"),
        "job_ids": None,
    }


def dataset_key(inputs, labels):
    """Identifies a registration: same files from the same jobs, same taxonomy."""
    blob = json.dumps({"inputs": inputs, "labels": labels}, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()


def _download(system, path, dest, token):
    url = f"{TAPIS_BASE_URL}/v3/files/content/{system}/{urllib.parse.quote(path.lstrip('/'), safe='/-_.')}"
    try:
        with requests.get(url, headers={"X-Tapis-Token": token}, stream=True, timeout=600) as resp:
            if resp.status_code == 404:
                raise TriageError(f"{path} does not exist on {system}. Did the job finish writing it?", 409)
            if resp.status_code != 200:
                raise TriageError(f"Could not read {path} from {system} (HTTP {resp.status_code}).", 502)
            with open(dest, "wb") as f:
                for chunk in resp.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
    except requests.exceptions.RequestException as e:
        raise TriageError(f"Could not read {path} from {system}: {e}", 502) from e


# ── Triage service calls ──────────────────────────────────────────────────────
def dataset_exists(dataset_id):
    return bool(dataset_id) and _call("GET", f"/datasets/{dataset_id}").status_code == 200


def register_dataset(name, inputs, labels, token):
    """Copy the job outputs from the HPC system to the triage service. Returns the dataset id."""
    with tempfile.TemporaryDirectory(prefix="protorcd_") as tmp:
        local = {}
        for key in ("coco", "dinov3", "bioclip"):
            local[key] = os.path.join(tmp, os.path.basename(inputs[key]))
            _download(inputs["system"], inputs[key], local[key], token)
        with open(local["coco"], "rb") as coco, open(local["dinov3"], "rb") as dino, \
                open(local["bioclip"], "rb") as bioclip:
            resp = _call(
                "POST", "/datasets", timeout=REGISTER_TIMEOUT_S,
                data={"name": name, "labels": json.dumps(labels)},
                files={
                    "coco": ("proposals.coco.json", coco, "application/json"),
                    "dinov3": ("dinov3.npz", dino, "application/octet-stream"),
                    "bioclip": ("bioclip.npz", bioclip, "application/octet-stream"),
                },
            )
    if resp.status_code != 201:
        # 400 means the files themselves were refused (mismatched COCO, wrong
        # model); that is the user's to fix, so it is passed on as such.
        raise TriageError(f"The triage service refused the proposals or embedding files: {_detail(resp)}",
                          400 if resp.status_code == 400 else 502)
    return resp.json()["dataset_id"]


def create_session(dataset_id, config):
    resp = _call("POST", "/sessions", timeout=REGISTER_TIMEOUT_S, json={"dataset_id": dataset_id, **config})
    if resp.status_code != 201:
        raise TriageError(f"The triage service could not start a session: {_detail(resp)}",
                          400 if resp.status_code in (400, 422) else 502)
    return resp.json()


def get_session(session_id):
    """Session state (with its token), or None if the service no longer has it."""
    resp = _call("GET", f"/sessions/{session_id}", timeout=REGISTER_TIMEOUT_S)
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        raise TriageError(f"The triage session is unavailable: {_detail(resp)}", 502)
    return resp.json()


def delete_session(session_id):
    resp = _call("DELETE", f"/sessions/{session_id}")
    if resp.status_code not in (200, 404):
        raise TriageError(f"Could not delete the triage session: {_detail(resp)}", 502)


def export(session_id, include_background):
    resp = _call("GET", f"/sessions/{session_id}/export", timeout=300,
                 params={"include_background": str(bool(include_background)).lower()})
    if resp.status_code != 200:
        raise TriageError(f"Could not export the triage session: {_detail(resp)}",
                          404 if resp.status_code == 404 else 502)
    return resp.json()


def connection(state):
    """What the browser needs: the WebSocket URL (with the session token) and the state."""
    state = dict(state)
    token = state.pop("session_token", None)
    base = TRIAGE_PUBLIC_URL
    if base.startswith("https://"):
        base = "wss://" + base[len("https://"):]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://"):]
    url = f"{base}{state['websocket_path']}"
    if token:
        url += f"?token={urllib.parse.quote(token)}"
    return {"session_id": state["session_id"], "websocket_url": url, "state": state}


def save_to_tapis(system, path, content, token, what="the export"):
    url = f"{TAPIS_BASE_URL}/v3/files/ops/{system}/{urllib.parse.quote(path.lstrip('/'), safe='/-_.')}"
    files = [("file", (os.path.basename(path), content, "application/json"))]
    try:
        resp = requests.post(url, headers={"X-Tapis-Token": token}, files=files, timeout=300)
    except requests.exceptions.RequestException as e:
        raise TriageError(f"Could not save {what} to {system}: {e}", 502) from e
    if resp.status_code != 200:
        raise TriageError(f"Could not save {what} to {system}:{path} (HTTP {resp.status_code}).", 502)


def read_json_from_tapis(system, path, token):
    with tempfile.TemporaryDirectory() as tmp:
        dest = os.path.join(tmp, "file.json")
        _download(system, path, dest, token)
        with open(dest, "rb") as f:
            return json.load(f)


# ── Review in the annotator ───────────────────────────────────────────────────
# Flags the annotator shows and filters by. "review" is its built-in "Needs Review".
REVIEW_FLAG_AUTO = "auto-decided"
REVIEW_FLAG_NEEDS_REVIEW = "review"
UNKNOWN_LABEL = "unknown"


def review_coco(export, proposals=None, flag_auto=True, include_background=False):
    """The annotator's starting file for reviewing a session's results.

    `export` is the triage export with background included, so every decided
    proposal is in it. Each box keeps its proposal id, and is flagged by what a
    reviewer still has to do:
    - labelled by a person, or an auto-decision a spot check covered: no flag;
    - auto-decided and never checked: REVIEW_FLAG_AUTO when `flag_auto`
      (removing the flag in the annotator is how a reviewer confirms it);
    - in `proposals` (the source COCO) but never decided, i.e. deferred or not
      embedded: labelled UNKNOWN_LABEL and flagged REVIEW_FLAG_NEEDS_REVIEW.
    Detector scores are dropped: the annotator hides boxes under its score
    threshold, and a reviewer should see every box.
    """
    names = {int(c["id"]): c["name"] for c in export["categories"]}
    annotations, decided = [], set()

    def box(a, category_id, flag=None):
        out = {"id": a["id"], "image_id": a["image_id"], "category_id": category_id,
               "bbox": a["bbox"], "area": a.get("area", a["bbox"][2] * a["bbox"][3]), "iscrowd": 0}
        if flag:
            out["flag"] = flag
        return out

    for a in export["annotations"]:
        decided.add(a["id"])
        if a["category_id"] == 0 and not include_background:
            continue
        triage = a.get("triage") or {}
        unchecked_auto = triage.get("source") in ("auto_resolve", "auto_clear") and triage.get("validated") is None
        annotations.append(box(a, a["category_id"], REVIEW_FLAG_AUTO if flag_auto and unchecked_auto else None))

    undecided = [a for a in (proposals or {}).get("annotations", []) if a["id"] not in decided]
    if undecided:
        unknown_id = max(names, default=0) + 1
        names[unknown_id] = UNKNOWN_LABEL
        annotations += [box(a, unknown_id, REVIEW_FLAG_NEEDS_REVIEW) for a in undecided]

    used = {a["category_id"] for a in annotations}
    info = export.get("info", {})
    return {
        "info": {
            "description": "ProtoRCD triage results for review",
            "date_created": info.get("date_created"),
            "session_id": info.get("session_id"),
            "counts": info.get("counts"),
        },
        "licenses": [],
        "images": export["images"],
        "categories": [{"id": i, "name": n} for i, n in sorted(names.items())
                       if i in used or (i != 0 and n != UNKNOWN_LABEL)],
        "annotations": annotations,
    }
