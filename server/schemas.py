from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Any


# ── Shared path models ────────────────────────────────────────────────────────

class PipePath(BaseModel):
    pipe_id: int

class ConfigPath(BaseModel):
    config_id: int

class DigidSystemPath(BaseModel):
    digid: str
    system: str

class DigidPath(BaseModel):
    digid: str

class PipeIdSystemPath(BaseModel):
    pipeid: str
    system: str

class PipeIdIdPath(BaseModel):
    pipeid: str
    id: int

class PipeIdOdIdPath(BaseModel):
    pipeid: str
    od_id: str

class IdPath(BaseModel):
    id: str

class IdsPath(BaseModel):
    ids: str

class PipeIdPath(BaseModel):
    pipeId: int

class PipeIdConfigIdPath(BaseModel):
    pipeId: int
    configId: int

class JobIdPath(BaseModel):
    job_id: str

class PipeJobPath(BaseModel):
    pipeId: int
    jobId: str

class SystemPath(BaseModel):
    system: str

class McIdPath(BaseModel):
    mc_id: str

class SecretNamePath(BaseModel):
    secret_name: str


# ── Pipelines ─────────────────────────────────────────────────────────────────

class PipelineCreate(BaseModel):
    name: str
    description: str = ""
    slurmaccount: str = ""
    type: str = "DETECTION"

    model_config = ConfigDict(extra="ignore")


class PipelineUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    slurmaccount: Optional[str] = None
    type: Optional[str] = None

    model_config = ConfigDict(extra="ignore")


class PipelineOut(BaseModel):
    pid: int
    name: str
    description: str
    slurmaccount: str
    is_demo: bool
    type: str


class IdOut(BaseModel):
    id: int


class MessageOut(BaseModel):
    message: str


# ── Annotator Configuration ───────────────────────────────────────────────────

class AnnotatorConfigCreate(BaseModel):
    system: str
    srcImgDir: str
    annotationFilePath: str
    fileType: str = "default"

    model_config = ConfigDict(extra="ignore")


class AnnotatorConfigUpdate(BaseModel):
    system: Optional[str] = None
    srcImgDir: Optional[str] = None
    annotationFilePath: Optional[str] = None
    fileType: Optional[str] = None

    model_config = ConfigDict(extra="ignore")


class AnnotatorConfigOut(BaseModel):
    id: int
    system: str
    srcImgDir: str
    annotationFilePath: str
    fileType: str
    parentPipelineId: int


# ── Files ─────────────────────────────────────────────────────────────────────

class ImgQuery(BaseModel):
    imgURL: Optional[str] = None
    filePath: Optional[str] = None


class DirQuery(BaseModel):
    dir: str


class DirContentsQuery(BaseModel):
    dir: str = ""


class ImgsInDirQuery(BaseModel):
    dir: str
    n: int = 50000


class SaveFileQuery(BaseModel):
    path: str


class BatchImgRequest(BaseModel):
    files: List[str]


class BatchImgItem(BaseModel):
    path: str
    data: Optional[str] = None
    mime: Optional[str] = None
    error: Optional[str] = None


class BatchImgResponse(BaseModel):
    images: List[BatchImgItem]


class FileListOut(BaseModel):
    files: List[str]


class ImgListOut(BaseModel):
    img: List[str]
    num: int


class ImgsOut(BaseModel):
    imgs: List[str]


class DirItem(BaseModel):
    name: str
    path: str


class DirContentsOut(BaseModel):
    dirs: List[DirItem]
    imgs: List[str]


# ── Object Detection Pipeline ─────────────────────────────────────────────────

class QueryImageConfigOut(BaseModel):
    id: int
    objectnessThreshold: float
    nmsIoUThreshold: float
    similarityThreshold: float
    queryImagePath: str
    outputDir: str
    device: str
    method: str
    system: str
    name: str = ""
    proposer_ids: str = ""
    embedder_ids: str = ""
    proposer_models: str = ""
    embedder_models: str = ""
    is_sahi: bool = False
    is_query_dir: bool = False
    tile_size: int = 960
    overlap_ratio: float = 0.2
    batch_size: int = 4
    node_count: int = 1
    cores_per_node: int = 8
    memory_mb: int = 64800
    max_minutes: int = 210
    object_feature_tensor_file_path: str = ""
    class_support_paths: str = ""
    proposal_tensor_paths: str = ""
    objectnessThresholdJobId: Optional[str] = None
    detectionJobId: Optional[str] = None


class ObjectDetectionPipelineOut(BaseModel):
    id: int
    system: Optional[str] = None
    srcImgDir: Optional[str] = None
    annotationFilePath: Optional[str] = None
    model_ids: Optional[str] = None
    method: Optional[str] = None
    device: Optional[str] = None
    outputDir: Optional[str] = None
    cropSize: Optional[int] = None
    generateClassSupportJobId: Optional[str] = None
    classSupportsPath: Optional[str] = None
    current_query_image_configuration: Optional[int] = None
    name: Optional[str] = None
    crop_sizes: Optional[str] = None
    model_names: Optional[str] = None
    is_demo: bool = False
    query_image_configuration: Optional[Any] = None


class ClassSupportsQuery(BaseModel):
    optimize_crop_size: bool = False


class ClassSupportsRequest(BaseModel):
    srcImgDir: str
    annotationFilePath: str
    system: str
    method: str
    cropSize: Any = 1024
    device: str
    outputDir: str
    model_ids: str = ""
    name: str = ""
    crop_sizes: str = "1024"
    newPatra: bool = False

    model_config = ConfigDict(extra="ignore")


class ObjectDetectionRequest(BaseModel):
    queryImagePath: str
    system: str
    method: str
    device: str
    outputDir: str
    objectnessThreshold: float
    similarityThreshold: float
    nmsIoUThreshold: float
    name: str = ""
    embedder_ids: str = "4"
    proposer_ids: str = "1"
    is_sahi: bool = False
    is_query_dir: bool = False
    tile_size: int = 960
    overlap_ratio: float = 0.2
    batch_size: int = 4
    node_count: int = 1
    cores_per_node: int = 8
    memory_mb: int = 64800
    max_minutes: int = 210
    newPatra: bool = False

    model_config = ConfigDict(extra="ignore")


class ObjectClassificationRequest(BaseModel):
    id: int
    queryImagePath: str
    system: str
    outputDir: str
    objectnessThreshold: float
    similarityThreshold: float
    class_support_paths: str
    proposal_tensor_paths: str
    is_query_dir: bool = False
    name: str = ""

    model_config = ConfigDict(extra="ignore")


class ClassSupportTensorUpdate(BaseModel):
    class_support_tensor_file_path: str
    crop_size: int


class QueryImageConfigUpdate(BaseModel):
    objectnessThreshold: Optional[float] = None
    nmsIoUThreshold: Optional[float] = None
    similarityThreshold: Optional[float] = None
    queryImagePath: Optional[str] = None
    outputDir: Optional[str] = None
    device: Optional[str] = None
    method: Optional[str] = None
    system: Optional[str] = None
    name: Optional[str] = None
    proposer_ids: Optional[str] = None
    embedder_ids: Optional[str] = None
    proposer_models: Optional[str] = None
    embedder_models: Optional[str] = None
    is_sahi: Optional[bool] = None
    is_query_dir: Optional[bool] = None
    tile_size: Optional[int] = None
    overlap_ratio: Optional[float] = None
    batch_size: Optional[int] = None
    node_count: Optional[int] = None
    cores_per_node: Optional[int] = None
    memory_mb: Optional[int] = None
    max_minutes: Optional[int] = None
    class_support_paths: Optional[str] = None
    proposal_tensor_paths: Optional[str] = None

    model_config = ConfigDict(extra="ignore")


class ObjectDetectionUpdate(BaseModel):
    srcImgDir: Optional[str] = None
    annotationFilePath: Optional[str] = None
    cropSize: Optional[int] = None
    device: Optional[str] = None
    method: Optional[str] = None
    system: Optional[str] = None
    outputDir: Optional[str] = None
    class_supports_tensor_file_path: Optional[str] = None
    generate_class_supports_job_id: Optional[str] = None
    current_query_image_configuration: Optional[int] = None
    name: Optional[str] = None
    crop_sizes: Optional[str] = None

    model_config = ConfigDict(extra="ignore")


# ── Jobs ──────────────────────────────────────────────────────────────────────

class JobStatusOut(BaseModel):
    job_id: Optional[str] = None
    status: Optional[str] = None
    condition: Optional[str] = None
    message: Optional[str] = None
    execSystemOutputDir: Optional[str] = None
    execSystemId: Optional[str] = None


# ── Admin ─────────────────────────────────────────────────────────────────────

class IsAdminOut(BaseModel):
    is_admin: bool


# ── Vault ─────────────────────────────────────────────────────────────────────

class VaultSecretWrite(BaseModel):
    data: dict


class VaultSecretRead(BaseModel):
    secret: Optional[str] = None
