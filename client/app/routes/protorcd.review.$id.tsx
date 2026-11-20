// Review step of a ProtoRCD pipeline: the triage's results in the annotator,
// where every box can be confirmed, corrected, flagged, saved and exported. The
// triage page writes the review file and points the pipeline's annotator
// configuration at it (POST /protorcd/:id/review); this route only shows it.
import { Alert, Button, Center, CloseButton, Code, Group, Loader, Paper, Stack, Text } from "@mantine/core";
import { IconArrowLeft, IconFlag, IconInfoCircle } from "@tabler/icons-react";
import { fetchAnnotatorConfigs, ImageAnnotator } from "@icicle-ai/image-annotator";
import { useNavigate, useParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { useCookies } from "react-cookie";
import { getProtoRCD, type Review } from "~/components/ProtoRCD/api";
import { getSam3Endpoint } from "~/utils/utils";

const NOTES_POSITION = { position: "fixed", left: "calc(25vw + 24px)", bottom: 16, zIndex: 1300 } as const;

export default function ProtoRCDReview() {
   const { id: pipeId = "" } = useParams();
   const navigate = useNavigate();
   const [cookie] = useCookies(["tapis-token"]);
   const token: string = cookie["tapis-token"]?.["access_token"] ?? "";
   const [review, setReview] = useState<Review | null | undefined>(undefined);
   // The file the annotator actually uses: "Save As" in the annotator can move it.
   const [annotationFile, setAnnotationFile] = useState<string | null>(null);
   const [showNotes, setShowNotes] = useState(true);

   useEffect(() => {
      if (!pipeId || !token) return;
      getProtoRCD(pipeId, token).then((res) => setReview(res.ok ? res.data?.review ?? null : null));
      fetchAnnotatorConfigs(pipeId, token).then((configs) => setAnnotationFile(configs?.at(-1)?.annotationFilePath ?? null));
   }, [pipeId, token]);

   if (review === undefined) {
      return <Center h={300}><Loader /></Center>;
   }
   if (!review) {
      return (
         <Alert color="blue" variant="light" title="Nothing to review yet" m="lg">
            <Stack gap="sm" align="flex-start">
               <Text size="sm">
                  Finish a triage session, then choose "Open in the annotator" on the human-in-the-loop page.
               </Text>
               <Button size="xs" variant="light" leftSection={<IconArrowLeft size={14} />}
                  onClick={() => navigate(`/protorcd/triage/${pipeId}`)}>
                  Human in the loop
               </Button>
            </Stack>
         </Alert>
      );
   }

   return (
      <>
         <ImageAnnotator pipeid={pipeId} tapisToken={token} sam3Endpoint={getSam3Endpoint()} />
         {/* A floating card rather than a bar above the annotator, whose File Explorer
             tab sits at a fixed spot near the top of the page. It sits clear of the
             explorer drawer (a quarter of the width) and collapses to a button. */}
         {!showNotes ? (
            <Button size="xs" variant="white" leftSection={<IconInfoCircle size={14} />}
               style={{ ...NOTES_POSITION, boxShadow: "var(--mantine-shadow-md)" }} onClick={() => setShowNotes(true)}>
               Review notes
            </Button>
         ) : (
            <Paper withBorder shadow="md" radius="md" p="sm" maw={440} role="note" aria-label="Review notes"
               style={NOTES_POSITION}>
               <Stack gap={6}>
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                     <Text size="sm" fw={700}>Reviewing the triage results</Text>
                     <CloseButton size="sm" aria-label="Hide review notes" onClick={() => setShowNotes(false)} />
                  </Group>
                  <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{annotationFile ?? review.path}</Code>
                  <Text size="xs" c="dimmed">
                     Open the File Explorer and the image folders; each image shows its boxes from the review file.
                  </Text>
                  {review.options.flagAuto && review.counts.auto_decided > 0 && (
                     <Group gap={6} wrap="nowrap">
                        <IconFlag size={14} style={{ flexShrink: 0 }} />
                        <Text size="xs">
                           <b>auto-decided</b> ({review.counts.auto_decided}): the triage labelled these on its own. Remove
                           the flag to confirm one, or fix its label.
                        </Text>
                     </Group>
                  )}
                  {review.counts.needs_review > 0 && (
                     <Group gap={6} wrap="nowrap">
                        <IconFlag size={14} style={{ flexShrink: 0 }} />
                        <Text size="xs">
                           <b>Needs Review</b> ({review.counts.needs_review}): left undecided, labelled "unknown". Give
                           each a class or delete it.
                        </Text>
                     </Group>
                  )}
                  <Text size="xs" c="dimmed">
                     Flag any box "Needs Review" to come back to it. Save writes your edits to this file; Export downloads
                     COCO or JSON.
                  </Text>
               </Stack>
            </Paper>
         )}
      </>
   );
}
