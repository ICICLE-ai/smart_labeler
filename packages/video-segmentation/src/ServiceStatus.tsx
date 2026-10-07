import { useCallback, useEffect, useState } from "react";
import { Alert, AlertTitle, Box, Button, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import { checkHealth, getVideoServiceBaseUrl, Sam3VideoError, signIn, type ServiceHealth } from "./sam3VideoClient";

export type ServiceState = "checking" | "up" | "down";

export interface ServiceStatusProps {
   /** Reported upward so the workspace can disable actions that cannot work while the service is unreachable. */
   onStateChange?: (state: ServiceState) => void;
   /**
    * Tapis token, exchanged for the gateway's session cookie before anything
    * else is called. Deployments with no gateway in front ignore it.
    */
   tapisToken?: string;
}

/**
 * Reachability + readiness of the SAM3 Video Service, checked on mount.
 *
 * Without this the first sign of a closed SSH tunnel is a button that does
 * nothing, so this states plainly whether the service answered, what address
 * was tried, and whether it is in mock mode (placeholder masks) or still
 * loading model weights.
 */
export function ServiceStatus({ onStateChange, tapisToken = "" }: ServiceStatusProps) {
   const [state, setState] = useState<ServiceState>("checking");
   const [health, setHealth] = useState<ServiceHealth | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [username, setUsername] = useState<string | null>(null);

   const run = useCallback(() => {
      setState("checking");
      setError(null);
      // Sign in first: with the auth gateway in front, every other call needs
      // the session cookie this establishes. A deployment without the gateway
      // reports no user and carries on unauthenticated.
      signIn(tapisToken)
         .then((who) => { setUsername(who); return checkHealth(); })
         .then((h) => {
            setHealth(h);
            setState("up");
            onStateChange?.("up");
         })
         .catch((e) => {
            setHealth(null);
            setState("down");
            setError(e instanceof Sam3VideoError ? e.message : e instanceof Error ? e.message : String(e));
            onStateChange?.("down");
         });
   }, [onStateChange, tapisToken]);

   useEffect(() => { run(); }, [run]);

   if (state === "checking") {
      return (
         <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2, py: 1 }}>
            <CircularProgress size={14} />
            <Typography variant="caption" color="text.secondary">
               Contacting the video GPU service at {getVideoServiceBaseUrl()}…
            </Typography>
         </Stack>
      );
   }

   if (state === "down") {
      return (
         <Alert
            severity="error"
            sx={{ mb: 2, borderRadius: 2 }}
            action={<Button color="inherit" size="small" onClick={run}>Retry</Button>}
         >
            <AlertTitle sx={{ fontWeight: 700 }}>Video GPU service unavailable</AlertTitle>
            <Typography variant="body2" sx={{ mb: 1 }}>{error}</Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: "0.82rem", lineHeight: 1.7 }}>
               <li>Start the service on the GPU node, then retry.</li>
               <li>
                  If it runs on an HPC node, re-open the tunnel, e.g.{" "}
                  <Box component="code" sx={{ bgcolor: "rgba(0,0,0,0.07)", px: 0.5, borderRadius: 0.5 }}>
                     ssh -L 2129:localhost:2129 user@gpu-host
                  </Box>
               </li>
               <li>
                  Confirm the address is right — the UI is configured for{" "}
                  <strong>{getVideoServiceBaseUrl()}</strong> (set <code>SAM3_VIDEO_URL</code> to change it).
               </li>
            </Box>
         </Alert>
      );
   }

   const sam3 = health?.sam3;
   return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 0.5, py: 1, flexWrap: "wrap", rowGap: 1 }}>
         <Chip size="small" color="success" variant="outlined" label="GPU service connected" sx={{ fontWeight: 600 }} />
         {username && (
            <Chip size="small" variant="outlined" label={`Signed in as ${username}`} sx={{ fontWeight: 600 }} />
         )}
         {sam3?.mock && (
            <Chip
               size="small"
               color="warning"
               label="Mock mode — placeholder masks, not real tracking"
               sx={{ fontWeight: 600 }}
            />
         )}
         {sam3 && !sam3.mock && sam3.loading && (
            <Chip size="small" color="info" label="Loading model weights — first track may be slow" />
         )}
         {sam3 && !sam3.mock && !sam3.loading && !sam3.ready && (
            <Chip size="small" color="warning" label="Model not loaded yet" />
         )}
         {sam3 && (
            <Typography variant="caption" color="text.secondary">
               {sam3.backend} · {sam3.model_id} · {sam3.device}
            </Typography>
         )}
      </Stack>
   );
}

export default ServiceStatus;
