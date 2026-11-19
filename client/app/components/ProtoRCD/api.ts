// Types and backend calls for ProtoRCD pipelines.
//
// The HPC jobs (one proposal job, then any number of embedding jobs) are submitted
// through this app's backend (/protorcd/...), which also brokers the triage session:
// it copies the jobs' outputs to the triage service and hands back a WebSocket URL
// carrying a token for that one session.
// The message shapes below mirror jobs/protorcd/triage/triage_service/schemas.py.
import { getBaseURL } from "~/utils/utils";

// ── Job configuration ─────────────────────────────────────────────────────────
export interface HPCResources {
   node_count: number;
   cores_per_node: number;
   memory_mb: number;
   max_minutes: number;
}

export interface DetectConfig extends HPCResources {
   name: string;
   system: string;
   imageDir: string;
   outputDir: string;
   text_prompt: string;
   confidence_threshold: number;
   score_threshold: number;
   nms_iou_threshold: number;
   batch_size: number;
   use_sahi: boolean;
   crop_size: number;
   overlap: number;
   return_masks: boolean;
}

export type EmbedModel = "dinov3" | "dinov3_debiased" | "bioclip";

export const EMBED_MODELS: { value: EmbedModel; label: string }[] = [
   { value: "dinov3", label: "DINOv3" },
   { value: "dinov3_debiased", label: "DINOv3 (positionally debiased)" },
   { value: "bioclip", label: "BioCLIP" },
];

export const embedModelLabel = (model: string) => EMBED_MODELS.find((m) => m.value === model)?.label ?? model;

export interface EmbedConfig extends HPCResources {
   name: string;
   system: string;
   imageDir: string;
   cocoPath: string;
   outputDir: string;
   models: EmbedModel[];
   region: "box" | "mask";
   batch_size: number;
   dtype: "float32" | "float16";
   dinov3_model_size: "small" | "base" | "large" | "hugeplus";
   dinov3_image_size: number;
   dinov3_weights: string;
}

export interface TriageConfig {
   labels: string[];
   seed: number;
   batch_size: number;
   calibration_size: number;
   max_rounds: number;
}

const HPC_DEFAULTS: HPCResources = { node_count: 1, cores_per_node: 8, memory_mb: 64800, max_minutes: 210 };

export const DETECT_DEFAULTS: Omit<DetectConfig, "system" | "imageDir" | "outputDir"> = {
   ...HPC_DEFAULTS,
   name: "ProtoRCD proposals",
   text_prompt: "visual",
   confidence_threshold: 0.2,
   score_threshold: 0.4,
   nms_iou_threshold: 0.4,
   batch_size: 4,
   use_sahi: false,
   crop_size: 1008,
   overlap: 0.25,
   return_masks: false,
};

export const EMBED_DEFAULTS: Omit<EmbedConfig, "system" | "imageDir" | "cocoPath" | "outputDir"> = {
   ...HPC_DEFAULTS,
   name: "ProtoRCD embeddings",
   models: ["dinov3", "bioclip"],
   region: "box",
   batch_size: 16,
   dtype: "float32",
   dinov3_model_size: "hugeplus",
   dinov3_image_size: 1024,
   dinov3_weights: "",
};

export const TRIAGE_DEFAULTS: TriageConfig = {
   labels: [],
   seed: 0,
   batch_size: 50,
   calibration_size: 100,
   max_rounds: 10,
};

export interface EmbedJob {
   job_id: string;
   config: EmbedConfig;
   submitted: string;
}

/** The files a triage session is built from, picked by the backend from finished embed jobs. */
export interface TriageInputs {
   system: string;
   image_dir: string;
   coco: string;
   dinov3: string;
   bioclip: string;
   output_dir: string;
   job_ids: { dinov3: string; bioclip: string };
}

export interface TriageReadiness {
   ready: boolean;
   inputs: TriageInputs | null;
   problem: string | null;
}

export interface ProtoRCDRecord {
   detect_config: DetectConfig | null;
   detect_job_id: string | null;
   /** Oldest first. */
   embed_jobs: EmbedJob[];
   triage_session_id: string | null;
   triage_config: (TriageConfig & { inputs?: TriageInputs }) | null;
   triage_service_configured: boolean;
   proposals_file: string;
}

// ── Triage service messages ───────────────────────────────────────────────────
export interface Proposal {
   proposal_id: number;
   image_id: number;
   file_name: string;
   bbox_xywh: [number, number, number, number];
   score: number;
   crop_url: string | null;
}

export interface DecisionCounts {
   resolve: number;
   clear: number;
   defer: number;
}

export interface RoundSummary {
   round: number;
   acquired: number;
   retired: number;
   counts: DecisionCounts;
   remaining: number;
   cumulative_reviews: number;
}

export interface ValidationSummary {
   checked: number;
   agreed: number;
   accuracy: number | null;
   ci95: [number, number] | null;
   pending_validation_id: string | null;
}

export type SessionStatus = "starting" | "awaiting_labels" | "advancing" | "finished" | "failed" | "restoring";

export interface SessionState {
   session_id: string;
   dataset_id: string;
   status: SessionStatus;
   error: string | null;
   calibrated: boolean;
   rule: Record<string, number | boolean> | null;
   round: number;
   rounds_completed: number;
   max_rounds: number;
   cumulative_reviews: number;
   remaining: number;
   auto_decided: number;
   finish_reason: "max_rounds" | "pool_exhausted" | "failed" | null;
   can_extend: boolean;
   pending_batch: { batch_id: string; phase: "calibration" | "review"; round: number; size: number } | null;
   validation: ValidationSummary;
   labels: Record<string, string> | null;
   config: Omit<TriageConfig, "labels"> & { dataset_id: string };
   rounds: RoundSummary[];
   websocket_path: string;
}

export interface BatchMessage {
   type: "batch";
   batch_id: string;
   phase: "calibration" | "review";
   round: number;
   proposals: Proposal[];
}

export interface ValidationBatchMessage {
   type: "validation_batch";
   validation_id: string;
   proposals: Proposal[];
}

export interface ValidationResultMessage {
   type: "validation_result";
   validation_id: string;
   checked: number;
   agreed: number;
   accuracy: number | null;
   ci95: [number, number] | null;
   by_decision: Record<"resolve" | "clear", { checked: number; agreed: number }>;
   cumulative: ValidationSummary;
}

export interface TriageErrorMessage {
   type: "error";
   code: string;
   message: string;
   request_type: string | null;
}

export type ServerMessage =
   | { type: "state"; state: SessionState }
   | BatchMessage
   | { type: "calibrated"; rule: Record<string, number | boolean>; bank_size: number }
   | { type: "round_result"; result: RoundSummary }
   | { type: "finished"; reason: "max_rounds" | "pool_exhausted"; counts: Record<string, number> }
   | ValidationBatchMessage
   | ValidationResultMessage
   | TriageErrorMessage
   | { type: "pong" };

export interface TriageConnection {
   session_id: string;
   websocket_url: string;
   state: SessionState;
}

// ── Backend calls ─────────────────────────────────────────────────────────────
export interface ApiResult<T> {
   ok: boolean;
   status?: number;
   data?: T;
   /** The server's explanation of a failure, when it gave one. */
   detail?: string;
}

async function request<T>(method: string, url: string, token: string, body?: unknown): Promise<ApiResult<T>> {
   let response: Response;
   try {
      response = await fetch(`${getBaseURL()}${url}`, {
         method,
         headers: { "Tapis-Token": token, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
         body: body !== undefined ? JSON.stringify(body) : undefined,
      });
   } catch (e) {
      return { ok: false, detail: `The server could not be reached (${e instanceof Error ? e.message : e}).` };
   }
   let data: any = null;
   try {
      data = await response.json();
   } catch {
      /* empty or non-JSON body */
   }
   if (!response.ok) {
      const detail = data?.description ?? data?.detail ?? data?.message;
      return { ok: false, status: response.status, detail: typeof detail === "string" ? detail : undefined };
   }
   return { ok: true, status: response.status, data };
}

export const getProtoRCD = (pipeId: string, token: string) =>
   request<ProtoRCDRecord>("GET", `/protorcd/${pipeId}`, token);

export const getTriageReadiness = (pipeId: string, token: string) =>
   request<TriageReadiness>("GET", `/protorcd/${pipeId}/triage/inputs`, token);

export const startTriage = (pipeId: string, config: TriageConfig, token: string) =>
   request<TriageConnection>("POST", `/protorcd/${pipeId}/triage/session`, token, config);

export const getTriage = (pipeId: string, token: string) =>
   request<TriageConnection>("GET", `/protorcd/${pipeId}/triage/session`, token);

export const discardTriage = (pipeId: string, token: string) =>
   request<{ message: string }>("DELETE", `/protorcd/${pipeId}/triage/session`, token);

export const exportTriage = (pipeId: string, token: string, opts: { includeBackground: boolean; save: boolean }) =>
   request<{ saved_path: string | null; coco: unknown }>(
      "GET",
      `/protorcd/${pipeId}/triage/export?include_background=${opts.includeBackground}&save=${opts.save}`,
      token,
   );

/** Join a directory on the HPC system with a COCO file_name relative to it. */
export const joinImagePath = (dir: string, fileName: string) =>
   `${dir.replace(/\/+$/, "")}/${fileName.replace(/^\/+/, "")}`;
