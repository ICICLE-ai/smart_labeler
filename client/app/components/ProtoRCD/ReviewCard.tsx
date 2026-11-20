import { Alert, Badge, Button, Card, Checkbox, Code, Group, Stack, Text } from "@mantine/core";
import { IconEdit, IconRefresh } from "@tabler/icons-react";
import { useNavigate } from "@remix-run/react";
import { useEffect, useState } from "react";
import { getProtoRCD, openReview, REVIEW_DEFAULTS, type Review, type ReviewOptions } from "./api";

/**
 * Sends the session's results to the annotator, where every box can be confirmed,
 * corrected, flagged, saved and exported. The backend writes a review file next
 * to the embeddings and points the pipeline's annotator at it; edits are saved
 * into that file, so reopening continues where the reviewer left off.
 */
export function ReviewCard({ pipeId, token, sessionId, step }: {
   pipeId: string;
   token: string;
   sessionId: string;
   /** Its number among the finished panel's steps. */
   step: number;
}) {
   const navigate = useNavigate();
   const [last, setLast] = useState<Review | null>(null);
   const [options, setOptions] = useState<ReviewOptions>(REVIEW_DEFAULTS);
   const [opening, setOpening] = useState<"continue" | "fresh" | null>(null);
   const [error, setError] = useState<string | null>(null);

   useEffect(() => {
      getProtoRCD(pipeId, token).then((res) => res.ok && setLast(res.data?.review ?? null));
   }, [pipeId, token]);

   // Only a review of this session can be continued; a new session starts afresh.
   const resumable = last?.session_id === sessionId ? last : null;

   const open = async (rebuild: boolean) => {
      setOpening(rebuild ? "fresh" : "continue");
      setError(null);
      const res = await openReview(pipeId, token, { ...options, rebuild });
      setOpening(null);
      if (!res.ok) return setError(res.detail ?? "The review file could not be written.");
      navigate(`/protorcd/review/${pipeId}`);
   };

   const set = (key: keyof ReviewOptions) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setOptions((o) => ({ ...o, [key]: e.currentTarget.checked }));

   return (
      <Card withBorder radius="md" p="md">
         <Stack gap="sm">
            <Group justify="space-between">
               <Text fw={700}>{step}. Review in the annotator</Text>
               {resumable && <Badge variant="light" color="teal">Review in progress</Badge>}
            </Group>
            <Text size="sm" c="dimmed">
               Go through every box on the full images, then confirm it, fix its label or outline, flag it for
               review, or delete it. Your edits are saved to a review file on the HPC system, and you can export it
               from the annotator.
            </Text>

            {resumable ? (
               <Stack gap={6}>
                  <Text size="sm">
                     Review file: <Code>{resumable.path}</Code>
                  </Text>
                  <Text size="xs" c="dimmed">
                     Started {new Date(resumable.created).toLocaleString()} with {resumable.counts.boxes} boxes:{" "}
                     {resumable.counts.auto_decided} auto-decided to confirm, {resumable.counts.needs_review} still
                     undecided.
                  </Text>
                  <Group>
                     <Button leftSection={<IconEdit size={16} />} onClick={() => open(false)}
                        loading={opening === "continue"} disabled={opening !== null}>
                        Continue reviewing
                     </Button>
                  </Group>
               </Stack>
            ) : null}

            <Stack gap={6}>
               {resumable && (
                  <Text size="sm" fw={600} mt="xs">Or start a fresh review file from the triage results</Text>
               )}
               <Checkbox checked={options.flagAuto} onChange={set("flagAuto")}
                  label='Flag boxes the triage decided on its own as "auto-decided"'
                  description="Remove the flag from a box to confirm it. Boxes you labelled or spot-checked are not flagged." />
               <Checkbox checked={options.includeUndecided} onChange={set("includeUndecided")}
                  label='Add the proposals the triage left undecided, labelled "unknown"'
                  description='They are flagged "Needs Review"; give each a class or delete it.' />
               <Checkbox checked={options.includeBackground} onChange={set("includeBackground")}
                  label="Include proposals labelled background" />
               <Group>
                  <Button variant={resumable ? "default" : "filled"}
                     leftSection={resumable ? <IconRefresh size={16} /> : <IconEdit size={16} />}
                     onClick={() => open(true)} loading={opening === "fresh"} disabled={opening !== null}>
                     {resumable ? "Start a fresh review" : "Open in the annotator"}
                  </Button>
               </Group>
               {resumable && (
                  <Text size="xs" c="dimmed">The current review file is kept; the annotator switches to the new one.</Text>
               )}
            </Stack>
            {error && <Alert color="red" variant="light">{error}</Alert>}
         </Stack>
      </Card>
   );
}
