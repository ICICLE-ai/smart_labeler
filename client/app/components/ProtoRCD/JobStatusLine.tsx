import { ActionIcon, Badge, Code, Group, Modal, ScrollArea, Text, Tooltip } from "@mantine/core";
import { IconFileText, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { getBaseURL, JobStatusDescriptions, type JobStatus } from "~/utils/utils";
import { jobStatusColor } from "./useJobStatus";

/** A job's id and Tapis status, with refresh and its tapisjob.out log. */
export function JobStatusLine({
   jobId,
   status,
   message,
   loading,
   onRefresh,
   token,
}: {
   jobId: string | null;
   status: string | null;
   message?: string | null;
   loading: boolean;
   onRefresh: () => void;
   token: string;
}) {
   const [log, setLog] = useState<string | null>(null);

   if (!jobId) {
      return <Badge color="gray" variant="light">Not submitted</Badge>;
   }

   const openLog = async () => {
      try {
         const res = await fetch(`${getBaseURL()}/download_job_logs/${jobId}`, { headers: { "Tapis-Token": token } });
         setLog(res.ok ? await res.text() : `The log is not available yet (HTTP ${res.status}).`);
      } catch (e) {
         setLog(`The log could not be fetched: ${e instanceof Error ? e.message : e}`);
      }
   };

   return (
      <>
         <Group gap="xs" wrap="nowrap">
            <Tooltip label={(status && JobStatusDescriptions[status as JobStatus]) || message || "Status unknown"}>
               <Badge color={jobStatusColor(status)} variant="light">{status ?? "UNKNOWN"}</Badge>
            </Tooltip>
            <Text size="xs" c="dimmed" ff="monospace" truncate maw={220} title={jobId}>{jobId}</Text>
            <Tooltip label="Refresh status">
               <ActionIcon size="sm" variant="subtle" onClick={onRefresh} loading={loading}>
                  <IconRefresh size={14} />
               </ActionIcon>
            </Tooltip>
            <Tooltip label="View job log">
               <ActionIcon size="sm" variant="subtle" onClick={openLog}>
                  <IconFileText size={14} />
               </ActionIcon>
            </Tooltip>
         </Group>
         <Modal opened={log !== null} onClose={() => setLog(null)} title="tapisjob.out" size="xl">
            <ScrollArea h="60vh">
               <Code block>{log}</Code>
            </ScrollArea>
         </Modal>
      </>
   );
}
