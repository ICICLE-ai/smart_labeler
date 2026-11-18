import { useCallback, useEffect, useRef, useState } from "react";
import type {
   BatchMessage,
   RoundSummary,
   ServerMessage,
   SessionState,
   TriageErrorMessage,
   ValidationBatchMessage,
   ValidationResultMessage,
} from "./api";

export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

// Close codes the triage service uses for answers that retrying cannot change.
const FINAL_CLOSE_CODES = new Set([1000, 4401, 4404]);
const MAX_BACKOFF_MS = 30_000;

/**
 * One WebSocket connection to a triage session.
 *
 * The service re-sends `state`, the pending `batch` and any pending
 * `validation_batch` on every connect, so a dropped connection is simply
 * reopened (with backoff) and the screen picks up where it was.
 */
export function useTriageSocket(url: string | null) {
   const [connection, setConnection] = useState<ConnectionStatus>("idle");
   const [state, setState] = useState<SessionState | null>(null);
   const [batch, setBatch] = useState<BatchMessage | null>(null);
   const [validationBatch, setValidationBatch] = useState<ValidationBatchMessage | null>(null);
   const [validationResult, setValidationResult] = useState<ValidationResultMessage | null>(null);
   const [lastRound, setLastRound] = useState<RoundSummary | null>(null);
   const [error, setError] = useState<TriageErrorMessage | null>(null);
   const [pending, setPending] = useState(false);

   const ws = useRef<WebSocket | null>(null);

   useEffect(() => {
      if (!url) {
         setConnection("idle");
         return;
      }
      let disposed = false;
      let attempt = 0;
      let retry: ReturnType<typeof setTimeout> | null = null;

      const handle = (msg: ServerMessage) => {
         switch (msg.type) {
            case "state":
               setState(msg.state);
               // "advancing" arrives first after a submission; any settled state
               // ends the wait (some replies, like extend_rounds, are only a state).
               if (msg.state.status === "advancing" || msg.state.status === "restoring") setBatch(null);
               else setPending(false);
               break;
            case "batch":
               setBatch(msg);
               setPending(false);
               break;
            case "round_result":
               setLastRound(msg.result);
               break;
            case "finished":
               setBatch(null);
               setPending(false);
               break;
            case "validation_batch":
               setValidationBatch(msg);
               setValidationResult(null);
               setPending(false);
               break;
            case "validation_result":
               setValidationResult(msg);
               setValidationBatch(null);
               setPending(false);
               break;
            case "error":
               setError(msg);
               setPending(false);
               break;
            default:
               break;
         }
      };

      const open = () => {
         setConnection(attempt === 0 ? "connecting" : "reconnecting");
         const socket = new WebSocket(url);
         ws.current = socket;
         socket.onopen = () => {
            attempt = 0;
            setConnection("open");
         };
         socket.onmessage = (event) => {
            try {
               handle(JSON.parse(event.data));
            } catch {
               /* ignore a malformed frame */
            }
         };
         socket.onclose = (event) => {
            if (ws.current === socket) ws.current = null;
            setPending(false);
            if (disposed) return;
            if (FINAL_CLOSE_CODES.has(event.code)) {
               setConnection("closed");
               return;
            }
            attempt += 1;
            setConnection("reconnecting");
            retry = setTimeout(open, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempt - 1)));
         };
      };

      open();
      return () => {
         disposed = true;
         if (retry) clearTimeout(retry);
         ws.current?.close(1000);
         ws.current = null;
      };
   }, [url]);

   const send = useCallback((message: object, expectsReply = true) => {
      const socket = ws.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
         setError({ type: "error", code: "not_connected", message: "Not connected to the triage service.", request_type: null });
         return false;
      }
      setError(null);
      if (expectsReply) setPending(true);
      socket.send(JSON.stringify(message));
      return true;
   }, []);

   return {
      connection,
      state,
      batch,
      validationBatch,
      validationResult,
      lastRound,
      error,
      pending,
      clearError: () => setError(null),
      submitLabels: (batchId: string, labels: Record<number, number>) =>
         send({ type: "submit_labels", batch_id: batchId, labels }),
      extendRounds: (additional: number) => send({ type: "extend_rounds", additional_rounds: additional }),
      requestValidation: (sampleSize: number) => send({ type: "request_validation", sample_size: sampleSize }),
      submitValidation: (validationId: string, labels: Record<number, number>) =>
         send({ type: "submit_validation", validation_id: validationId, labels }),
      refreshState: () => send({ type: "get_state" }, false),
   };
}
