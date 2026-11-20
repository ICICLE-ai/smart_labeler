import { Alert, Button, Group, Progress, Stack, Text } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import type { Proposal } from "./api";
import { ImageLabeling } from "./ImageLabeling";
import { useImageRetries, type ImageStore } from "./imageStore";
import { LabelingGrid } from "./LabelingGrid";
import { useBatchLabels, type LabelClass } from "./useBatchLabels";

export type LabelingView = "images" | "crops";

/**
 * Starts downloading every image of the batch as soon as it arrives, in the
 * order the batch lists them (and again on a retry), and reports how many are
 * in and which failed, grouped by reason.
 */
function useBatchPrefetch(images: ImageStore, batchKey: string, proposals: Proposal[]) {
   const files = useMemo(() => [...new Set(proposals.map((p) => p.file_name))], [proposals]);
   const [done, setDone] = useState(0);
   const retries = useImageRetries(images);
   useEffect(() => {
      let cancelled = false;
      setDone(0);
      images.prefetch(files).forEach((loaded) => loaded.then(() => !cancelled && setDone((d) => d + 1)));
      return () => {
         cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [images, batchKey, retries]);

   const byReason = new Map<string, string[]>();
   for (const f of files) {
      const reason = images.failure(f);
      if (reason) byReason.set(reason, [...(byReason.get(reason) ?? []), f]);
   }
   const failed = [...byReason.values()].reduce((n, fs) => n + fs.length, 0);
   return { done, total: files.length, failed, byReason };
}

/**
 * One batch (review, calibration or spot check) in either view. The labels live
 * here, so switching views mid-batch keeps them.
 */
export function BatchLabeler({ view, batchKey, proposals, classes, images, context, submitting, submitLabel, onSubmit }: {
   view: LabelingView;
   /** Changes whenever a new batch arrives; resets the labels. */
   batchKey: string;
   proposals: Proposal[];
   classes: LabelClass[];
   images: ImageStore;
   /** Crop view only: extra margin around each box, as a fraction of its size. */
   context: number;
   submitting: boolean;
   submitLabel: string;
   onSubmit: (labels: Record<number, number>) => void;
}) {
   const labeler = useBatchLabels(batchKey, proposals, classes);
   const loading = useBatchPrefetch(images, batchKey, proposals);
   const shared = { proposals, classes, labeler, images, submitting, submitLabel, onSubmit };
   return (
      <>
         {loading.done < loading.total && (
            <Group gap="xs" wrap="nowrap" aria-live="polite">
               <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  Loading images {loading.done} / {loading.total}
               </Text>
               <Progress value={(100 * loading.done) / loading.total} size="xs" style={{ flex: 1 }} />
            </Group>
         )}
         {loading.failed > 0 && loading.done === loading.total && (
            <Alert color="red" variant="light" py="xs"
               title={`${loading.failed} of ${loading.total} images could not be loaded`}>
               <Group justify="space-between" align="flex-end" wrap="nowrap">
                  <Stack gap={2}>
                     {[...loading.byReason].map(([reason, files]) => (
                        <Text key={reason} size="xs" title={files.join("\n")}>
                           {files.length} × {reason}
                        </Text>
                     ))}
                  </Stack>
                  <Button size="xs" variant="light" color="red" leftSection={<IconRefresh size={14} />}
                     onClick={images.retryFailed} style={{ flexShrink: 0 }}>
                     Retry {loading.failed === 1 ? "it" : `all ${loading.failed}`}
                  </Button>
               </Group>
            </Alert>
         )}
         {view === "images"
            ? <ImageLabeling batchKey={batchKey} {...shared} />
            : <LabelingGrid context={context} {...shared} />}
      </>
   );
}
