import { useEffect, useState } from "react";
import { useNavigate } from "@remix-run/react";
import { Button, Card, Center, Loader, Stack, Text, Title } from "@mantine/core";
import { fetchAndReturnData, TYPE } from "~/utils/utils";

/** Where each pipeline type's workspace lives. */
const WORKSPACE: Partial<Record<TYPE, (pipeid: string) => string>> = {
   [TYPE.DETECTION]: (id) => `/object-detection/image-annotator/${id}`,
   [TYPE.SEGMENTATION]: (id) => `/annotation/image-annotator/${id}`,
   [TYPE.VIDEO_SEGMENTATION]: (id) => `/video-segmentation/${id}`,
};

const LABEL: Partial<Record<TYPE, string>> = {
   [TYPE.DETECTION]: "object detection",
   [TYPE.SEGMENTATION]: "image segmentation",
   [TYPE.VIDEO_SEGMENTATION]: "video segmentation",
};

export interface PipelineTypeGuardProps {
   pipeid: string;
   token: string;
   /** The type this route's workspace is built for. */
   expected: TYPE;
   children: React.ReactNode;
}

/**
 * Renders a workspace only for a pipeline of the matching type.
 *
 * Image and video segmentation pipelines live side by side in one deployment and
 * open into different workspaces. The dashboard sends each to the right one, but
 * a bookmark or a hand-edited URL can still land a video pipeline in the image
 * annotator — where it would quietly fall back to the detection tools and let
 * someone annotate in a workspace whose output the pipeline cannot use. This
 * offers the right door instead of guessing.
 *
 * An unreadable or untyped pipeline renders the workspace: being unable to
 * check is not evidence of a mismatch, and blocking on a failed lookup would
 * strand people over a transient backend error.
 */
export function PipelineTypeGuard({ pipeid, token, expected, children }: PipelineTypeGuardProps) {
   const navigate = useNavigate();
   const [actual, setActual] = useState<TYPE | null | undefined>(undefined);

   useEffect(() => {
      if (!pipeid || !token) { setActual(null); return; }
      let cancelled = false;
      fetchAndReturnData(`/pipe/${pipeid}`, token)
         .then((pipe) => { if (!cancelled) setActual((pipe?.type as TYPE) ?? null); })
         .catch(() => { if (!cancelled) setActual(null); })
      return () => { cancelled = true; };
   }, [pipeid, token]);

   if (actual === undefined) {
      return (
         <Center h="60vh">
            <Loader size="lg" />
         </Center>
      );
   }

   if (actual === null || actual === expected) return <>{children}</>;

   const target = WORKSPACE[actual];
   return (
      <Center h="70vh" px="md">
         <Card withBorder radius="md" p="xl" maw={520}>
            <Stack gap="sm">
               <Title order={4}>This pipeline opens somewhere else</Title>
               <Text size="sm" c="dimmed">
                  Pipeline {pipeid} is a <strong>{LABEL[actual] ?? actual}</strong> pipeline, but this is
                  the {LABEL[expected] ?? expected} workspace. Annotating it here would produce work the
                  pipeline cannot use.
               </Text>
               {target && (
                  <Button onClick={() => navigate(target(pipeid))}>
                     Open the {LABEL[actual] ?? actual} workspace
                  </Button>
               )}
               <Button variant="subtle" onClick={() => navigate("/dashboard")}>
                  Back to pipelines
               </Button>
            </Stack>
         </Card>
      </Center>
   );
}

export default PipelineTypeGuard;
