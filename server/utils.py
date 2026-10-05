import json
import requests
import os

TAPIS_BASE_URL = os.getenv("TAPIS_BASE_URL", "https://icicleai.tapis.io")
TAPIS_JOBS_URL = f"{TAPIS_BASE_URL}/v3/jobs/submit"
OSC_SYSTEMS = ["pitzer-tapis", "ascend-tapis", "cardinal-tapis"]

_APP_CONFIGS = {
    "class_supports": {
        "default": {"appId": "generate_class_supports_od", "appVersion": "1.0.0"},
        "pitzer-tapis": {"appId": "generate_class_supports", "appVersion": "1.0.0"},
        "ascend-tapis": {"appId": "generate_class_supports", "appVersion": "1.0.0"},
        "cardinal-tapis": {"appId": "generate_class_supports", "appVersion": "1.0.0"},
        "ascend-static": {"appId": "generate_class_supports", "appVersion": "1.0.0"}
    },
    "detection": {
        "default": {"appId": "objectness_threshold_od", "appVersion": "1.0.0"},
        "pitzer-tapis": {"appId": "generate_proposals", "appVersion": "1.0.0"},
        "ascend-tapis": {"appId": "generate_proposals", "appVersion": "1.0.0"},
        "cardinal-tapis": {"appId": "generate_proposals", "appVersion": "1.0.0"},
        "ascend-static": {"appId": "generate_proposals", "appVersion": "1.0.0"}
    },
    "classification": {
        "default": {"appId": "object_classification_smart_labeller", "appVersion": "1.0.0"},
        "pitzer-tapis": {"appId": "classify_objects", "appVersion": "1.0.0"},
        "ascend-tapis": {"appId": "classify_objects", "appVersion": "1.0.0"},
        "cardinal-tapis": {"appId": "classify_objects", "appVersion": "1.0.0"},
        "ascend-static": {"appId": "classify_objects", "appVersion": "1.0.0"}
        
    },
}


def get_app_config(app_name, system):
    configs = _APP_CONFIGS[app_name]
    return configs.get(system, configs["default"])


def get_gpu_queue(system, default="gpu"):
    if system in ["expanse-tapis", "expanse-tapis-static"]:
        return "tapisGPUshared"
    if system == "ascend-static" or system == "ascend-tapis":
        return "nextgen"
    if system in OSC_SYSTEMS:
        return "gpu"
    return default


def get_cpu_queue(system):
    return "tapisShared" if system in ["expanse-tapis", "expanse-tapis-static"] else "cpu" if system in ["pitzer-tapis", "cardinal-tapis"] else "nextgen"


def apply_osc_paths(data, system):
    if system in OSC_SYSTEMS:
        data.update({
            "execSystemExecDir": "/fs/ess/PAS2699/jobs/${JobUUID}",
            "execSystemInputDir": "/fs/ess/PAS2699/jobs/${JobUUID}",
            "execSystemOutputDir": "/fs/ess/PAS2699/jobs/${JobUUID}/output",
        })


def apply_hf_token(data, secret):
    if secret:
        data["parameterSet"]["envVariables"] = [{"key": "HF_TOKEN", "value": secret}]


def tapis_error_message(response):
    """
    Pull the human-readable reason out of a Tapis error response.

    Tapis wraps its explanation in a JSON envelope; the bare requests exception
    text is only ever "400 Client Error: Bad Request for url: ...", which tells
    the user nothing they can act on.
    """
    try:
        payload = response.json()
    except Exception:
        return (response.text or "").strip()[:500] or None

    for key in ("message", "detail", "error"):
        value = payload.get(key) if isinstance(payload, dict) else None
        if isinstance(value, str) and value.strip():
            return value.strip()[:500]
    if isinstance(payload, dict):
        result = payload.get("result")
        if isinstance(result, str) and result.strip():
            return result.strip()[:500]
    return None


def submit_tapis_job(data, token):
    """
    Submit a job to Tapis.

    Returns {"status": "success", "uuid": ...} or {"status": "error", "message":
    ..., "httpStatus": ...}. `httpStatus` is the status Tapis itself answered
    with, when it answered at all, so the caller can pass a truthful code on to
    its own client instead of reporting every failure the same way.
    """
    headers = {"X-Tapis-Token": token, "content-type": "application/json"}
    try:
        res = requests.post(TAPIS_JOBS_URL, data=json.dumps(data), headers=headers)
    except requests.exceptions.RequestException as e:
        return {"status": "error", "message": f"Could not reach Tapis to submit the job: {e}"}

    if not res.ok:
        reason = tapis_error_message(res)
        return {
            "status": "error",
            "message": reason or f"Tapis rejected the job submission (HTTP {res.status_code}).",
            "httpStatus": res.status_code,
        }

    try:
        return {"status": "success", "uuid": res.json()["result"]["uuid"]}
    except Exception as e:
        # A 2xx whose body is not the shape we expect is still a failed
        # submission: without a UUID there is no job to track.
        return {
            "status": "error",
            "message": f"Tapis accepted the request but returned no job id ({e}).",
            "httpStatus": 502,
        }


def build_embedder_string(models):
    parts = []
    for m in models:
        m_lower = m.lower()
        if "dinov3" in m_lower:
            parts.append("dinov3")
        if "owlv2" in m_lower:
            parts.append("owlv2")
        if "bioclip" in m_lower:
            parts.append("bioclip")
    return " ".join(parts)


def build_proposer_string(models):
    parts = []
    for m in models:
        m_lower = m.lower()
        if "sam" in m_lower:
            parts.append("sam3")
        elif "owlv2" in m_lower:
            parts.append("owlv2")
    return " ".join(parts)
