"""End-to-end tests: HTTP + WebSocket loop over synthetic stage-1/2 files."""
from __future__ import annotations

import io
import json
from dataclasses import replace

import pytest
from PIL import Image
from starlette.websockets import WebSocketDisconnect

from conftest import TAXONOMY


def upload(client, data, **extra):
    files = {
        "coco": ("proposals.coco.json", data["coco"].read_bytes(), "application/json"),
        "dinov3": ("dinov3_box.npz", data["dinov3"].read_bytes(), "application/octet-stream"),
        "bioclip": ("bioclip_box.npz", data["bioclip"].read_bytes(), "application/octet-stream"),
    }
    form = {"name": "synthetic", "image_root": str(data["images_dir"]), "labels": json.dumps(TAXONOMY), **extra}
    return client.post("/datasets", files=files, data=form)


def recv_until(ws, wanted: str, limit: int = 10) -> tuple[dict, list]:
    """Receive messages until one of type ``wanted``; returns it and everything seen."""
    seen = []
    for _ in range(limit):
        msg = ws.receive_json()
        seen.append(msg)
        if msg["type"] == wanted:
            return msg, seen
    raise AssertionError(f"no {wanted!r} message; got {[m['type'] for m in seen]}")


def answer(ws, batch, gt) -> None:
    ws.send_json({"type": "submit_labels", "batch_id": batch["batch_id"],
                  "labels": {str(p["proposal_id"]): gt[p["proposal_id"]] for p in batch["proposals"]}})


def create_session(client, dataset_id, **cfg):
    body = {"dataset_id": dataset_id, "seed": 3, "batch_size": 25, "calibration_size": 40,
            "max_rounds": 2, **cfg}
    r = client.post("/sessions", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_dataset_registration_joins_on_annotation_id(make_client, data):
    client = make_client()
    r = upload(client, data)
    assert r.status_code == 201, r.text
    info = r.json()
    assert info["num_proposals"] == 480
    assert info["num_pool"] == 479 and info["num_not_embedded"] == 1   # id 7 has no BioCLIP row
    assert info["labels"] == {str(k): v for k, v in TAXONOMY.items()} or info["labels"] == TAXONOMY
    assert "_files" not in info and info["has_images"]
    assert client.get("/datasets").json()["datasets"][0]["dataset_id"] == info["dataset_id"]

    crop = client.get(f"/datasets/{info['dataset_id']}/crops/1")
    assert crop.status_code == 200 and crop.headers["content-type"] == "image/jpeg"
    assert Image.open(io.BytesIO(crop.content)).size == (30, 30)
    assert client.get(f"/datasets/{info['dataset_id']}/crops/7").status_code == 404


def test_dataset_rejects_mismatched_files(make_client, data, tmp_path):
    client = make_client()
    other = tmp_path / "other.coco.json"
    other.write_text(data["coco"].read_text().replace('"area": 900.0', '"area": 901.0'))
    files = {
        "coco": ("c.json", other.read_bytes()),
        "dinov3": ("d.npz", data["dinov3"].read_bytes()),
        "bioclip": ("b.npz", data["bioclip"].read_bytes()),
    }
    r = client.post("/datasets", files=files, data={"name": "bad"})
    assert r.status_code == 400 and "different COCO file" in r.json()["detail"]
    # swapped models
    files = {"coco": ("c.json", data["coco"].read_bytes()),
             "dinov3": ("d.npz", data["bioclip"].read_bytes()),
             "bioclip": ("b.npz", data["dinov3"].read_bytes())}
    assert client.post("/datasets", files=files, data={"name": "bad"}).status_code == 400


def test_register_local_paths_respects_allowed_roots(make_client, data, settings, tmp_path):
    client = make_client()
    body = {"name": "local", "coco_uri": str(data["coco"]), "dinov3_uri": str(data["dinov3"]),
            "bioclip_uri": str(data["bioclip"])}
    assert client.post("/datasets/register", json=body).status_code == 201
    outside = tmp_path / "outside.json"
    outside.write_text("{}")
    r = client.post("/datasets/register", json={**body, "coco_uri": str(outside)})
    assert r.status_code == 400 and "outside the allowed" in r.json()["detail"]


def test_full_websocket_loop_validation_extend_restart_export(make_client, data, settings):
    gt = data["gt"]
    client = make_client()
    dataset_id = upload(client, data).json()["dataset_id"]
    state = create_session(client, dataset_id)
    sid = state["session_id"]
    assert state["status"] == "awaiting_labels" and state["pending_batch"]["phase"] == "calibration"
    assert state["websocket_path"] == f"/ws/sessions/{sid}"

    with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
        assert ws.receive_json()["type"] == "state"
        batch = ws.receive_json()
        assert batch["type"] == "batch" and batch["phase"] == "calibration"
        assert len(batch["proposals"]) == 40
        assert batch["proposals"][0]["crop_url"].startswith(f"/datasets/{dataset_id}/crops/")

        # rejected submissions consume nothing
        ws.send_json({"type": "submit_labels", "batch_id": "nope", "labels": {}})
        assert ws.receive_json()["code"] == "stale_batch"
        first = batch["proposals"][0]["proposal_id"]
        ws.send_json({"type": "submit_labels", "batch_id": batch["batch_id"], "labels": {str(first): 0}})
        assert ws.receive_json()["code"] == "invalid_labels"
        ws.send_json({"type": "submit_labels", "batch_id": batch["batch_id"],
                      "labels": {str(p["proposal_id"]): 9 for p in batch["proposals"]}})
        err = ws.receive_json()
        assert err["code"] == "invalid_labels" and "taxonomy" in err["message"]
        ws.send_text("not json")
        assert ws.receive_json()["code"] == "invalid_message"
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"

        # calibration -> round 1 -> round 2 -> finished at max_rounds
        answer(ws, batch, gt)
        calibrated, seen = recv_until(ws, "calibrated")
        assert seen[0]["type"] == "state" and seen[0]["state"]["status"] == "advancing"
        assert calibrated["rule"]["foreground_first"] is True
        batch, _ = recv_until(ws, "batch")
        assert batch["phase"] == "review" and batch["round"] == 1
        auto_total = 0
        for expected_round in (1, 2):
            answer(ws, batch, gt)
            result, _ = recv_until(ws, "round_result")
            assert result["result"]["round"] == expected_round
            auto_total += result["result"]["retired"]
            if expected_round == 1:
                batch, _ = recv_until(ws, "batch")
        finished, _ = recv_until(ws, "finished")
        assert finished["reason"] == "max_rounds"
        state = recv_until(ws, "state")[0]["state"]
        assert state["status"] == "finished" and state["can_extend"] and state["auto_decided"] == auto_total
        assert auto_total > 0, "synthetic data should produce auto-decisions"

        # blind validation of auto-decisions
        ws.send_json({"type": "request_validation", "sample_size": 20})
        vbatch, _ = recv_until(ws, "validation_batch")
        assert len(vbatch["proposals"]) == min(20, auto_total)
        assert "predicted_class" not in vbatch["proposals"][0]
        ws.send_json({"type": "submit_validation", "validation_id": vbatch["validation_id"],
                      "labels": {str(p["proposal_id"]): gt[p["proposal_id"]] for p in vbatch["proposals"]}})
        vresult, _ = recv_until(ws, "validation_result")
        assert vresult["checked"] == len(vbatch["proposals"]) and vresult["accuracy"] is not None
        assert vresult["cumulative"]["checked"] == vresult["checked"]
        recv_until(ws, "state")

        # extend after a max_rounds stop: rebuilt from the journal, continues at round 3
        ws.send_json({"type": "extend_rounds", "additional_rounds": 1})
        batch, _ = recv_until(ws, "batch")
        assert batch["round"] == 3
        state = recv_until(ws, "state")[0]["state"]
        assert state["max_rounds"] == 3 and state["round"] == 3 and state["rounds_completed"] == 2
        assert [r["round"] for r in state["rounds"]] == [1, 2]
        answer(ws, batch, gt)
        recv_until(ws, "round_result")
        recv_until(ws, "finished")
        final_state = recv_until(ws, "state")[0]["state"]

    # decisions + export
    decisions = client.get(f"/sessions/{sid}/decisions").json()
    counts = decisions["counts"]
    assert len(decisions["rounds"]) == 3
    acquired = sum(r["acquired"] for r in decisions["rounds"])
    retired = sum(r["retired"] for r in decisions["rounds"])
    assert counts["calibration"] == 40 and counts["reviewed"] == acquired and counts["not_embedded"] == 1
    assert counts.get("auto_resolve", 0) + counts.get("auto_clear", 0) == retired == final_state["auto_decided"]
    assert sum(counts.values()) == 480 and counts.get("deferred", 0) == final_state["remaining"]
    validated = [d for d in decisions["decisions"] if d["validated"] is not None]
    assert len(validated) == vresult["checked"]
    export = client.get(f"/sessions/{sid}/export").json()
    assert {c["id"] for c in export["categories"]} == {1, 2, 3}
    assert all(a["category_id"] > 0 and "triage" in a for a in export["annotations"])
    human_fg = sum(1 for d in decisions["decisions"]
                   if d["status"] in ("calibration", "reviewed") and d["label"] > 0)
    assert sum(1 for a in export["annotations"] if a["triage"]["source"] in ("calibration", "reviewed")) == human_fg
    with_bg = client.get(f"/sessions/{sid}/export", params={"include_background": True}).json()
    assert len(with_bg["annotations"]) > len(export["annotations"])

    # "pod restart": a new app over the same data dir restores the session by replay
    restarted = make_client(replace(settings))
    restored = restarted.get(f"/sessions/{sid}").json()
    for key in ("round", "cumulative_reviews", "auto_decided", "remaining", "max_rounds", "status", "validation"):
        assert restored[key] == final_state[key], key
    assert restarted.get(f"/sessions/{sid}/decisions").json()["decisions"] == decisions["decisions"]
    listing = restarted.get("/sessions").json()["sessions"]
    assert listing[0]["session_id"] == sid and listing[0]["rounds_completed"] == 3

    # a dataset in use cannot be deleted; delete the session first
    assert restarted.delete(f"/datasets/{dataset_id}").status_code == 409
    assert restarted.delete(f"/sessions/{sid}").status_code == 200
    assert restarted.get(f"/sessions/{sid}").status_code == 404
    assert restarted.delete(f"/datasets/{dataset_id}").status_code == 200


def test_restart_mid_session_and_reconnect(make_client, data, settings):
    gt = data["gt"]
    client = make_client()
    dataset_id = upload(client, data).json()["dataset_id"]
    sid = create_session(client, dataset_id, max_rounds=5)["session_id"]
    with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
        ws.receive_json()
        batch = ws.receive_json()
        answer(ws, batch, gt)
        recv_until(ws, "calibrated")
        batch, _ = recv_until(ws, "batch")
        recv_until(ws, "state")
        ws.send_json({"type": "extend_rounds", "additional_rounds": 2})   # while running
        assert recv_until(ws, "state")[0]["state"]["max_rounds"] == 7

    restarted = make_client(replace(settings))
    with restarted.websocket_connect(f"/ws/sessions/{sid}") as ws:
        state = ws.receive_json()["state"]
        assert state["calibrated"] and state["max_rounds"] == 7
        resumed = ws.receive_json()
        assert resumed["type"] == "batch" and resumed["batch_id"] == batch["batch_id"]
        assert resumed["proposals"] == batch["proposals"]
        answer(ws, resumed, gt)
        assert recv_until(ws, "round_result")[0]["result"]["round"] == 1


def test_two_clients_receive_broadcasts(make_client, data):
    gt = data["gt"]
    client = make_client()
    dataset_id = upload(client, data).json()["dataset_id"]
    sid = create_session(client, dataset_id)["session_id"]
    with client.websocket_connect(f"/ws/sessions/{sid}") as a, \
            client.websocket_connect(f"/ws/sessions/{sid}") as b:
        a.receive_json(); batch = a.receive_json()
        b.receive_json(); b.receive_json()
        answer(a, batch, gt)
        recv_until(a, "batch")
        nxt, _ = recv_until(b, "batch")
        assert nxt["phase"] == "review"
        b.send_json({"type": "submit_labels", "batch_id": batch["batch_id"], "labels": {}})
        assert recv_until(b, "error")[0]["code"] == "stale_batch"


def test_unknown_session_websocket(make_client):
    client = make_client()
    with client.websocket_connect("/ws/sessions/doesnotexist") as ws:
        assert ws.receive_json()["code"] == "not_found"
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_token_auth(make_client, data, settings):
    client = make_client(replace(settings, api_token="s3cret"))
    assert client.get("/healthz").status_code == 200
    assert client.get("/datasets").status_code == 401
    assert client.get("/datasets", headers={"Authorization": "Bearer s3cret"}).status_code == 200
    assert client.get("/datasets", params={"token": "s3cret"}).status_code == 200
    with client.websocket_connect("/ws/sessions/x") as ws:
        assert ws.receive_json()["code"] == "not_allowed"
    schema = client.get("/openapi.json").json()
    assert schema["security"] == [{"bearer": []}]


def test_session_token_opens_only_its_own_session(make_client, data, settings):
    client = make_client(replace(settings, api_token="s3cret"))
    auth = {"Authorization": "Bearer s3cret"}
    files = {
        "coco": ("c.json", data["coco"].read_bytes()),
        "dinov3": ("d.npz", data["dinov3"].read_bytes()),
        "bioclip": ("b.npz", data["bioclip"].read_bytes()),
    }
    dataset_id = client.post("/datasets", files=files, data={"name": "t"}, headers=auth).json()["dataset_id"]
    body = {"dataset_id": dataset_id, "calibration_size": 40, "batch_size": 25, "max_rounds": 1}
    first = client.post("/sessions", json=body, headers=auth).json()
    second = client.post("/sessions", json=body, headers=auth).json()
    assert first["session_token"] and first["session_token"] != second["session_token"]
    assert first["rounds"] == []
    assert client.get(f"/sessions/{first['session_id']}", headers=auth).json()["session_token"] == first["session_token"]

    with client.websocket_connect(f"/ws/sessions/{first['session_id']}?token={first['session_token']}") as ws:
        state = ws.receive_json()["state"]
        assert state["session_id"] == first["session_id"] and state.get("session_token") is None
        assert ws.receive_json()["type"] == "batch"
    with client.websocket_connect(f"/ws/sessions/{second['session_id']}?token={first['session_token']}") as ws:
        assert ws.receive_json()["code"] == "not_allowed"
    # a session token is not an API key
    assert client.get("/datasets", params={"token": first["session_token"]}).status_code == 401


def test_openapi_documents_http_and_websocket(make_client):
    client = make_client()
    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200
    schema = client.get("/openapi.json").json()
    for path in ("/datasets", "/datasets/register", "/datasets/{dataset_id}/crops/{proposal_id}",
                 "/sessions", "/sessions/{session_id}", "/sessions/{session_id}/decisions",
                 "/sessions/{session_id}/export", "/ws-protocol"):
        assert path in schema["paths"], path
    components = schema["components"]["schemas"]
    for name in ("WsClientMessage", "WsServerMessage", "SubmitLabels", "BatchMessage",
                 "ValidationResultMessage", "SessionState"):
        assert name in components, name
    assert "/ws/sessions/{session_id}" in schema["info"]["description"]
    proto = client.get("/ws-protocol").json()
    client_types = {v["properties"]["type"]["const"] for v in proto["client_messages"]["$defs"].values()
                    if "type" in v.get("properties", {})}
    assert {"submit_labels", "extend_rounds", "request_validation", "submit_validation"} <= client_types
