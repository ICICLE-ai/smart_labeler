import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { fetchAndReturnData, JobStatus, getBaseURL } from "~/utils/utils";
import { useCookies } from "react-cookie";
import { Step } from "~/components/ImageAnnotation/utils";

interface PipelineContextType {
    stepsData: Step[];
    statusAlert: { stepId: number; message: string; type: "success" | "error" | "info" } | null;
    setStatusAlert: (alert: { stepId: number; message: string; type: "success" | "error" | "info" } | null) => void;
    statusModal: { status: string; condition: string; message: string } | null;
    setStatusModal: (modal: { status: string; condition: string; message: string } | null) => void;
    logsModal: { content: string } | null;
    setLogsModal: (modal: { content: string } | null) => void;
    fetchStatus: (jobId: string, stepNumber: number) => Promise<void>;
    downloadLogs: (stepId: number) => Promise<void>;
    notifyJobSubmitted: () => void;
}

const PipelineContext = createContext<PipelineContextType | undefined>(undefined);

interface PipelineProviderProps {
    children: ReactNode;
    pipeId: string;
}

const baseStepsCache = new Map<string, Step[]>();

function mapTapisStatus(tapisStatus: JobStatus): Step["status"] {
    switch (tapisStatus) {
        case JobStatus.FINISHED:
            return "COMPLETED";
        case JobStatus.FAILED:
        case JobStatus.CANCELLED:
            return "FAILED";
        case JobStatus.PENDING:
            return "READY";
        case JobStatus.RUNNING:
        case JobStatus.PROCESSING_INPUTS:
        case JobStatus.STAGING_INPUTS:
        case JobStatus.STAGING_JOB:
        case JobStatus.SUBMITTING_JOB:
        case JobStatus.QUEUED:
        case JobStatus.ARCHIVING:
            return "IN_PROGRESS";
        default:
            return "SKIPPED";
    }
}

export const PipelineProvider: React.FC<PipelineProviderProps> = ({ children, pipeId }) => {
    const [stepsData, setStepsData] = useState<Step[]>([]);
    const [statusAlert, setStatusAlert] = useState<{ stepId: number; message: string; type: "success" | "error" | "info" } | null>(null);
    const [statusModal, setStatusModal] = useState<{ status: string; condition: string; message: string } | null>(null);
    const [logsModal, setLogsModal] = useState<{ content: string } | null>(null);
    const [cookie] = useCookies(["tapis-token"]);
    const token = cookie["tapis-token"]?.["access_token"];

    const loadSteps = useCallback((bustCache = false) => {
        if (!pipeId || !token) return;

        if (bustCache) baseStepsCache.delete(pipeId);

        // Return cached result if available (cache already has statuses applied)
        if (!bustCache && baseStepsCache.has(pipeId)) {
            setStepsData(baseStepsCache.get(pipeId)!);
            return;
        }

        fetchAndReturnData(
            `/get-object-detection-pipeline/${pipeId}`,
            token
        ).then((res) => {
            if (!res) {
                console.log("Failed to fetch object detection pipeline.");
                return;
            }

            import("~/components/ImageAnnotation/utils").then(async (utils) => {
                const baseSteps = utils.steps;
                const classSupportsJobId = res["generateClassSupportJobId"] || "";
                let detectionJobId = "";
                let objectnessJobId = "";
                let classificationJobId = "";

                if (res["query_image_configuration"]) {
                    detectionJobId = res["query_image_configuration"]["detectionJobId"] || "";
                    objectnessJobId = res["query_image_configuration"]["objectnessThresholdJobId"] || "";
                }

                if (res["generate_class_supports_job_id"]) {
                    classificationJobId = res["generate_class_supports_job_id"] || "";
                }

                // Map step id → jobId for steps that have one
                const stepJobIds: Record<number, string> = {};
                if (classSupportsJobId) stepJobIds[3] = classSupportsJobId;
                if (objectnessJobId)    stepJobIds[5] = objectnessJobId;
                if (classificationJobId) stepJobIds[6] = classificationJobId;
                if (detectionJobId)     stepJobIds[7] = detectionJobId;

                // Fetch statuses for all steps that have a jobId in parallel
                const statusResults = await Promise.allSettled(
                    Object.entries(stepJobIds).map(async ([stepId, jobId]) => {
                        const statusRes = await fetchAndReturnData(`/get_job_status/${jobId}`, token);
                        return { stepId: Number(stepId), jobId, status: statusRes?.status as JobStatus | undefined };
                    })
                );

                const resolvedStatuses = new Map<number, { jobId: string; status: Step["status"] }>();
                for (const result of statusResults) {
                    if (result.status === "fulfilled" && result.value.status) {
                        resolvedStatuses.set(result.value.stepId, {
                            jobId: result.value.jobId,
                            status: mapTapisStatus(result.value.status),
                        });
                    }
                }

                const updatedSteps = baseSteps.map((step) => {
                    const jobId = stepJobIds[step.id];
                    if (!jobId) return step;
                    const resolved = resolvedStatuses.get(step.id);
                    return {
                        ...step,
                        jobId,
                        status: resolved?.status ?? step.status,
                    };
                });

                baseStepsCache.set(pipeId, updatedSteps);
                setStepsData(updatedSteps);
            });
        });
    }, [pipeId, token]);

    useEffect(() => {
        loadSteps();
    }, [loadSteps]);

    const notifyJobSubmitted = useCallback(() => {
        loadSteps(true);
    }, [loadSteps]);

    const fetchStatus = useCallback(async (jobId: string, stepNumber: number) => {
        if (!token) return;
        try {
            const res = await fetchAndReturnData(
                `/get_job_status/${jobId}`,
                token
            );

            let status: Step["status"] = "READY";
            if (res) {
                if (!res.status) {
                    console.log(`No status found for job ${jobId}`);
                    setStatusModal({
                        status: "ERROR",
                        condition: "NOT_FOUND",
                        message: `No status found for job ${jobId}`
                    });
                    return;
                }

                status = mapTapisStatus(res.status as JobStatus);

                setStepsData((prevSteps) =>
                    prevSteps.map((step) => {
                        if (step.id === stepNumber) {
                            return {
                                ...step,
                                status: status,
                                jobId: jobId,
                            };
                        }
                        return step;
                    })
                );

                // Display in modal with three fields
                setStatusModal({
                    status: res.status || "UNKNOWN",
                    condition: res.condition || status || "READY",
                    message: res.message || `Job ID: ${jobId}`
                });
            }
        } catch (error) {
            console.error("Error fetching status:", error);
            setStatusModal({
                status: "ERROR",
                condition: "FETCH_FAILED",
                message: `Error fetching status: ${error}`
            });
        }
    }, [token]);

    const downloadLogs = useCallback(async (stepId: number) => {
        if (!token) return;
        try {
            const step = stepsData.find(s => s.id === stepId);
            if (!step || !step.jobId) {
                setStatusAlert({
                    stepId: stepId,
                    message: "No job ID found for this step",
                    type: "error"
                });
                return;
            }

            const response = await fetch(`${getBaseURL()}/download_job_logs/${step.jobId}`, {
                headers: {
                    "Tapis-Token": token
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch logs: ${response.statusText}`);
            }

            const logsContent = await response.text();
            setLogsModal({
                content: logsContent
            });
        } catch (error) {
            console.error("Error downloading logs:", error);
            setStatusAlert({
                stepId: stepId,
                message: `Error downloading logs: ${error}`,
                type: "error"
            });
        }
    }, [stepsData, token]);

    return (
        <PipelineContext.Provider value={{ stepsData, statusAlert, setStatusAlert, statusModal, setStatusModal, logsModal, setLogsModal, fetchStatus, downloadLogs, notifyJobSubmitted }}>
            {children}
        </PipelineContext.Provider>
    );
};

export const usePipeline = (): PipelineContextType => {
    const context = useContext(PipelineContext);
    if (!context) {
        throw new Error("usePipeline must be used within a PipelineProvider");
    }
    return context;
};
