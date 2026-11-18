"""Pydantic models for the HTTP API and the WebSocket message protocol.

The WebSocket messages are plain JSON objects discriminated by ``type``. They are
published in the OpenAPI document (``/openapi.json`` -> ``components.schemas``) and served
at ``GET /ws-protocol`` so clients can be generated from the same source.
"""
from __future__ import annotations

from typing import Annotated, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, TypeAdapter

# --------------------------------------------------------------------------- #
# Shared                                                                       #
# --------------------------------------------------------------------------- #
Label = Annotated[int, Field(ge=0, description="0 = background; a positive id = a class from the taxonomy")]


class Proposal(BaseModel):
    proposal_id: int = Field(description="COCO annotation id from the stage-1 proposals file")
    image_id: int
    file_name: str = Field(description="Image path relative to the dataset's image root")
    bbox_xywh: List[float]
    score: float
    crop_url: Optional[str] = Field(
        None, description="Relative URL of a JPEG crop; null when the dataset has no image root"
    )


class DecisionCounts(BaseModel):
    resolve: int = 0
    clear: int = 0
    defer: int = 0


# --------------------------------------------------------------------------- #
# Datasets                                                                     #
# --------------------------------------------------------------------------- #
class DatasetRegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    coco_uri: str = Field(description="s3://bucket/key, or a path under TRIAGE_ALLOWED_LOCAL_ROOTS")
    dinov3_uri: str = Field(description="Stage-2 DINOv3 .npz (same URI forms)")
    bioclip_uri: str = Field(description="Stage-2 BioCLIP .npz (same URI forms)")
    image_root: Optional[str] = Field(
        None, description="s3://bucket/prefix or a local directory; enables crop URLs"
    )
    labels: Optional[Dict[int, str]] = Field(
        None, description="Taxonomy: class id (>0) -> name. When set, labels outside it are rejected."
    )


class DatasetInfo(BaseModel):
    dataset_id: str
    name: str
    created: str
    num_images: int
    num_proposals: int = Field(description="Annotations in the COCO file")
    num_pool: int = Field(description="Proposals embedded by both models (the triage pool)")
    num_not_embedded: int
    dinov3: dict = Field(description="Selected fields of the DINOv3 .npz meta")
    bioclip: dict = Field(description="Selected fields of the BioCLIP .npz meta")
    coco_sha256: str
    has_images: bool
    labels: Optional[Dict[int, str]] = None


class DatasetList(BaseModel):
    datasets: List[DatasetInfo]


# --------------------------------------------------------------------------- #
# Sessions                                                                     #
# --------------------------------------------------------------------------- #
class SessionCreateRequest(BaseModel):
    dataset_id: str
    seed: int = Field(0, ge=0, description="Fixes the calibration bank and acquisition order")
    batch_size: int = Field(50, ge=1, le=1000, description="Proposals per review round")
    calibration_size: int = Field(100, ge=2, le=5000, description="Proposals in the calibration bank")
    max_rounds: int = Field(10, ge=1, le=1000, description="Review rounds before the session stops; can be extended")


class PendingBatchSummary(BaseModel):
    batch_id: str
    phase: Literal["calibration", "review"]
    round: int
    size: int


class ValidationSummary(BaseModel):
    checked: int
    agreed: int
    accuracy: Optional[float]
    ci95: Optional[List[float]] = Field(None, description="Wilson 95% interval for accuracy")
    pending_validation_id: Optional[str] = None


class SessionState(BaseModel):
    session_id: str
    dataset_id: str
    created: str
    status: Literal["starting", "awaiting_labels", "advancing", "finished", "failed", "restoring"]
    error: Optional[str] = Field(None, description="Exception type only; details are in server logs")
    calibrated: bool
    rule: Optional[dict] = None
    round: int = Field(description="Current review round (in progress while its batch awaits labels)")
    rounds_completed: int
    max_rounds: int
    cumulative_reviews: int
    remaining: int = Field(description="Deferred proposals still eligible for review")
    auto_decided: int = Field(description="Proposals Resolved or Cleared so far")
    finish_reason: Optional[Literal["max_rounds", "pool_exhausted", "failed"]] = None
    can_extend: bool
    pending_batch: Optional[PendingBatchSummary] = None
    validation: ValidationSummary
    labels: Optional[Dict[int, str]] = None
    config: SessionCreateRequest
    websocket_path: str


class SessionList(BaseModel):
    sessions: List[SessionState]


class RoundSummary(BaseModel):
    round: int
    acquired: int
    retired: int
    counts: DecisionCounts
    remaining: int
    cumulative_reviews: int


class ProposalDecision(BaseModel):
    proposal_id: int
    status: Literal["calibration", "reviewed", "auto_resolve", "auto_clear", "deferred", "not_embedded"]
    label: Optional[int] = Field(None, description="Final label: human > validation correction > auto")
    validated: Optional[bool] = Field(None, description="For auto decisions checked in validation: agreed?")


class DecisionList(BaseModel):
    session_id: str
    counts: Dict[str, int]
    rounds: List[RoundSummary]
    decisions: List[ProposalDecision]


# --------------------------------------------------------------------------- #
# WebSocket: client -> server                                                  #
# --------------------------------------------------------------------------- #
class SubmitLabels(BaseModel):
    """Answer the pending batch. Every proposal in it must be labelled."""

    type: Literal["submit_labels"]
    batch_id: str = Field(description="Echo of the pending batch's id; stale ids are rejected")
    labels: Dict[int, Label] = Field(description="proposal_id -> label")


class GetState(BaseModel):
    type: Literal["get_state"]


class ExtendRounds(BaseModel):
    """Raise max_rounds. Works while running or after a max_rounds stop."""

    type: Literal["extend_rounds"]
    additional_rounds: int = Field(ge=1, le=1000)


class RequestValidation(BaseModel):
    """Draw a random sample of auto-decided proposals for a blind spot check."""

    type: Literal["request_validation"]
    sample_size: int = Field(50, ge=1, le=1000)


class SubmitValidation(BaseModel):
    type: Literal["submit_validation"]
    validation_id: str
    labels: Dict[int, Label]


class Ping(BaseModel):
    type: Literal["ping"]


ClientMessage = Annotated[
    Union[SubmitLabels, GetState, ExtendRounds, RequestValidation, SubmitValidation, Ping],
    Field(discriminator="type"),
]
client_message_adapter: TypeAdapter = TypeAdapter(ClientMessage)


# --------------------------------------------------------------------------- #
# WebSocket: server -> client                                                  #
# --------------------------------------------------------------------------- #
class StateMessage(BaseModel):
    type: Literal["state"] = "state"
    state: SessionState


class BatchMessage(BaseModel):
    """Proposals awaiting labels. Sent on connect and after each completed phase."""

    type: Literal["batch"] = "batch"
    batch_id: str
    phase: Literal["calibration", "review"]
    round: int
    proposals: List[Proposal]


class CalibratedMessage(BaseModel):
    type: Literal["calibrated"] = "calibrated"
    rule: dict
    bank_size: int


class RoundResultMessage(BaseModel):
    type: Literal["round_result"] = "round_result"
    result: RoundSummary


class FinishedMessage(BaseModel):
    type: Literal["finished"] = "finished"
    reason: Literal["max_rounds", "pool_exhausted"]
    counts: Dict[str, int]


class ValidationBatchMessage(BaseModel):
    """Auto-decided proposals to check. Predictions are withheld so the check is blind."""

    type: Literal["validation_batch"] = "validation_batch"
    validation_id: str
    proposals: List[Proposal]


class DecisionAgreement(BaseModel):
    checked: int
    agreed: int


class ValidationResultMessage(BaseModel):
    type: Literal["validation_result"] = "validation_result"
    validation_id: str
    checked: int
    agreed: int
    accuracy: Optional[float]
    ci95: Optional[List[float]]
    by_decision: Dict[str, DecisionAgreement]
    cumulative: ValidationSummary


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    code: Literal[
        "invalid_message", "stale_batch", "invalid_labels", "not_allowed", "session_failed",
        "not_found", "internal",
    ]
    message: str
    request_type: Optional[str] = None


class Pong(BaseModel):
    type: Literal["pong"] = "pong"


ServerMessage = Annotated[
    Union[
        StateMessage, BatchMessage, CalibratedMessage, RoundResultMessage, FinishedMessage,
        ValidationBatchMessage, ValidationResultMessage, ErrorMessage, Pong,
    ],
    Field(discriminator="type"),
]


class WebSocketProtocol(BaseModel):
    """Machine-readable description of the WebSocket protocol."""

    path: str = "/ws/sessions/{session_id}"
    auth: str
    client_messages: dict
    server_messages: dict


def ws_message_schemas() -> dict:
    """JSON schemas for both message directions (with shared $defs)."""
    return {
        "client_messages": TypeAdapter(ClientMessage).json_schema(ref_template="#/$defs/{model}"),
        "server_messages": TypeAdapter(ServerMessage).json_schema(ref_template="#/$defs/{model}"),
    }
