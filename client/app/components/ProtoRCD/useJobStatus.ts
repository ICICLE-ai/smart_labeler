import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAndReturnData, JobStatus } from "~/utils/utils";

const TERMINAL = new Set<string>([JobStatus.FINISHED, JobStatus.FAILED, JobStatus.CANCELLED]);
const POLL_MS = 30_000;

export interface JobStatusInfo {
   status: string | null;
   condition?: string | null;
   message?: string | null;
}

/**
 * Status of one Tapis job, polled every 30s until it reaches a terminal state.
 * `status` is null while unknown (no job yet, or the lookup failed).
 */
export function useJobStatus(jobId: string | null | undefined, token: string) {
   const [info, setInfo] = useState<JobStatusInfo>({ status: null });
   const [loading, setLoading] = useState(false);
   const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

   const refresh = useCallback(async () => {
      if (!jobId || !token) {
         setInfo({ status: null });
         return;
      }
      setLoading(true);
      try {
         const res = await fetchAndReturnData(`/get_job_status/${jobId}`, token);
         setInfo(res?.status ? { status: res.status, condition: res.condition, message: res.message } : { status: null });
      } finally {
         setLoading(false);
      }
   }, [jobId, token]);

   useEffect(() => {
      let cancelled = false;
      const tick = async () => {
         await refresh();
         if (!cancelled) timer.current = setTimeout(tick, POLL_MS);
      };
      tick();
      return () => {
         cancelled = true;
         if (timer.current) clearTimeout(timer.current);
      };
   }, [refresh]);

   // Stop polling once the job can no longer change.
   useEffect(() => {
      if (info.status && TERMINAL.has(info.status) && timer.current) {
         clearTimeout(timer.current);
         timer.current = null;
      }
   }, [info.status]);

   return { ...info, loading, refresh, finished: info.status === JobStatus.FINISHED };
}

export const jobStatusColor = (status: string | null): string => {
   switch (status) {
      case JobStatus.FINISHED:
         return "green";
      case JobStatus.FAILED:
      case JobStatus.CANCELLED:
         return "red";
      case null:
         return "gray";
      default:
         return "blue";
   }
};
