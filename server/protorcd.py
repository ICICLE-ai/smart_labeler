"""
Smart Labeler side of ProtoRCD triage: hand the jobs' outputs to the triage service.

The triage service (jobs/protorcd/triage) runs the human-in-the-loop session; this
module is the only place that talks to it. It downloads the embed job's outputs
from the HPC system through Tapis, registers them as a triage dataset, creates
sessions, and returns a WebSocket URL carrying the session's own token, so the
service-wide TRIAGE_API_TOKEN never reaches a browser.
"""

import hashlib
import json
import os
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
def dataset_inputs(record):
    """The three files the triage dataset is built from, read from the embed job's config."""
    from steps import protorcd_embedding_file

    cfg = record.get("embed_config") or {}
    if not cfg or not record.get("embed_job_id"):
        raise TriageError("Run the embedding job before starting triage.", 409)
    models = cfg.get("models") or []
    background = next((m for m in models if m in BACKGROUND_MODELS), None)
    if background is None or FOREGROUND_MODEL not in models:
        raise TriageError(
            "Triage needs both a DINOv3 and a BioCLIP embedding; the embedding job "
            f"produced only: {', '.join(models) or 'nothing'}.", 409)
    out = cfg["outputDir"].rstrip("/")
    region = cfg.get("region", "box")
    return {
        "system": cfg["system"],
        "image_dir": cfg["imageDir"],
        "coco": cfg["cocoPath"],
        "dinov3": f"{out}/{protorcd_embedding_file(background, region)}",
        "bioclip": f"{out}/{protorcd_embedding_file(FOREGROUND_MODEL, region)}",
        "output_dir": out,
    }


def dataset_key(inputs, labels, embed_job_id):
    """Identifies a registration: same files from the same job, same taxonomy."""
    blob = json.dumps({"inputs": inputs, "labels": labels, "job": embed_job_id}, sort_keys=True)
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
        raise TriageError(f"The triage service refused the job outputs: {_detail(resp)}",
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


def save_to_tapis(system, path, content, token):
    url = f"{TAPIS_BASE_URL}/v3/files/ops/{system}/{urllib.parse.quote(path.lstrip('/'), safe='/-_.')}"
    files = [("file", (os.path.basename(path), content, "application/json"))]
    try:
        resp = requests.post(url, headers={"X-Tapis-Token": token}, files=files, timeout=300)
    except requests.exceptions.RequestException as e:
        raise TriageError(f"Could not save the export to {system}: {e}", 502) from e
    if resp.status_code != 200:
        raise TriageError(f"Could not save the export to {system}:{path} (HTTP {resp.status_code}).", 502)
