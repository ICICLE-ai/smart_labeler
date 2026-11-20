import {
   Alert,
   Badge,
   Box,
   Button,
   Center,
   DEFAULT_THEME,
   Divider,
   Grid,
   Group,
   Kbd,
   Loader,
   Paper,
   Progress,
   ScrollArea,
   Stack,
   Text,
   Tooltip,
   UnstyledButton,
} from "@mantine/core";
import { IconAlertTriangle, IconCheck, IconChevronLeft, IconChevronRight, IconEraser, IconPhoto, IconRefresh } from "@tabler/icons-react";
import { ImageCanvas } from "@icicle-ai/image-annotation-canvas";
import { useEffect, useMemo, useState } from "react";
import type { Proposal } from "./api";
import { ClassPalette, classColor } from "./LabelingGrid";
import { useImageRetries, type ImageStore, type Preview } from "./imageStore";
import { triageEngine, type TriageBox } from "./triageEngine";
import { isTyping, type BatchLabels, type LabelClass } from "./useBatchLabels";

const noop = () => {};
const baseName = (path: string) => path.split("/").pop() ?? path;
const hex = (classId: number) => DEFAULT_THEME.colors[classColor(classId)][6];

/** The batch's proposals grouped by image, in the order the batch lists them. */
function groupByImage(proposals: Proposal[]) {
   const groups = new Map<string, Proposal[]>();
   for (const p of proposals) {
      const list = groups.get(p.file_name);
      if (list) list.push(p);
      else groups.set(p.file_name, [p]);
   }
   return [...groups.entries()].map(([file, items]) => ({ file, items }));
}

/**
 * The batch on the full images, in the annotator's canvas: the images that hold
 * the batch's proposals on the left, the image in the middle with only this
 * batch's boxes on it, and the class palette on the right. Pick a class, then
 * click boxes. Labels are shared with the crop view (see useBatchLabels).
 */
export function ImageLabeling({
   batchKey,
   proposals,
   classes,
   labeler,
   images: store,
   onSubmit,
   submitting,
   submitLabel,
}: {
   batchKey: string;
   proposals: Proposal[];
   classes: LabelClass[];
   labeler: BatchLabels;
   images: ImageStore;
   onSubmit: (labels: Record<number, number>) => void;
   submitting: boolean;
   submitLabel: string;
}) {
   const images = useMemo(() => groupByImage(proposals), [proposals]);
   const [index, setIndex] = useState(0);
   const [preview, setPreview] = useState<(Preview & { file: string }) | null>(null);
   const [loadFailed, setLoadFailed] = useState(false);
   const [selected, setSelected] = useState<string | null>(null);
   const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);

   useEffect(() => setIndex(0), [batchKey]);

   // A retry asks again only if the image on screen failed.
   const retries = useImageRetries(store);
   const [attempt, setAttempt] = useState(0);
   useEffect(() => {
      if (loadFailed) setAttempt((a) => a + 1);
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [retries]);

   const current = images[Math.min(index, images.length - 1)];
   const file = current?.file;
   const unlabelledIn = (items: Proposal[]) => items.filter((p) => labeler.labels[p.proposal_id] === undefined).length;

   useEffect(() => {
      if (!file) return;
      let cancelled = false;
      setLoadFailed(false);
      setSelected(null);
      store.preview(file, true)
         .then((p) => !cancelled && setPreview({ ...p, file }))
         .catch(() => !cancelled && setLoadFailed(true));
      // Prepare the next image too, so moving on is instant.
      const next = images[(index + 1) % images.length]?.file;
      if (next && next !== file) store.preview(next).catch(noop);
      return () => {
         cancelled = true;
      };
   }, [file, store, images, index, attempt]);

   const nextUnlabelled = () => {
      for (let step = 1; step <= images.length; step++) {
         const i = (index + step) % images.length;
         if (unlabelledIn(images[i].items) > 0) return setIndex(i);
      }
   };

   // N jumps to the next image that still has unlabelled boxes.
   useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
         if (isTyping(e.target)) return;
         if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) nextUnlabelled();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
   });

   const byId = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
   const shown = preview?.file === file ? preview : null;
   // The canvas shows a downscaled copy of the image, so boxes are scaled to match.
   const scale = shown?.scale ?? 1;
   const boxes: TriageBox[] = useMemo(
      () =>
         (current?.items ?? []).map((p) => {
            const classId = labeler.labels[p.proposal_id] ?? null;
            const [x, y, width, height] = p.bbox_xywh.map((v) => v * scale);
            return {
               id: String(p.proposal_id),
               proposalId: p.proposal_id,
               x, y, width, height,
               classId,
               label: classId === null ? "" : byId.get(classId)?.name ?? String(classId),
               color: classId === null ? "" : hex(classId),
            };
         }),
      [current, labeler.labels, byId, scale],
   );

   const onBoxClick = (id: string | null) => {
      if (!id || submitting) return;
      labeler.toggle(Number(id));
      setSelected(id);
   };
   const focusBox = (id: string) => {
      setSelected(id);
      setFocus({ id, nonce: Date.now() });
   };

   if (!current) return null;
   const leftHere = unlabelledIn(current.items);
   const imagesLeft = images.filter((g) => unlabelledIn(g.items) > 0).length;

   return (
      <Grid gutter="sm" align="flex-start">
         {/* ── Images holding this batch ── */}
         <Grid.Col span={{ base: 12, md: 3, xl: 2 }}>
            <Paper withBorder radius="md" p="xs">
               <Group justify="space-between" mb={6} px={4}>
                  <Text size="sm" fw={700}>Images</Text>
                  <Text size="xs" c="dimmed">{imagesLeft} of {images.length} to do</Text>
               </Group>
               <ScrollArea.Autosize mah="70vh" type="auto">
                  <Stack gap={2} component="nav" aria-label="Images in this batch">
                     {images.map((g, i) => {
                        const left = unlabelledIn(g.items);
                        const isCurrent = i === index;
                        return (
                           <UnstyledButton key={g.file} onClick={() => setIndex(i)} px={6} py={4}
                              aria-current={isCurrent ? "true" : undefined}
                              style={{
                                 borderRadius: 6,
                                 background: isCurrent ? "var(--mantine-color-blue-light)" : undefined,
                              }}>
                              <Group gap={6} wrap="nowrap" justify="space-between">
                                 <Group gap={6} wrap="nowrap" miw={0}>
                                    <IconPhoto size={14} style={{ flexShrink: 0 }} />
                                    <Text size="xs" truncate title={g.file} fw={isCurrent ? 700 : 400}>
                                       {baseName(g.file)}
                                    </Text>
                                 </Group>
                                 {store.failure(g.file) ? (
                                    <Tooltip label={store.failure(g.file)}>
                                       <IconAlertTriangle size={14} color="var(--mantine-color-red-6)" style={{ flexShrink: 0 }}
                                          aria-label={`Could not load: ${store.failure(g.file)}`} />
                                    </Tooltip>
                                 ) : left === 0 ? (
                                    <IconCheck size={14} color="var(--mantine-color-teal-6)" style={{ flexShrink: 0 }} />
                                 ) : (
                                    <Badge size="xs" variant="light" color="orange" style={{ flexShrink: 0 }}>{left} left</Badge>
                                 )}
                              </Group>
                           </UnstyledButton>
                        );
                     })}
                  </Stack>
               </ScrollArea.Autosize>
            </Paper>
         </Grid.Col>

         {/* ── The image ── */}
         <Grid.Col span={{ base: 12, md: 6, xl: 7 }}>
            <Stack gap={6}>
               <Group justify="space-between" wrap="nowrap">
                  <Text size="sm" fw={600} truncate title={current.file}>{current.file}</Text>
                  <Group gap={4} wrap="nowrap">
                     <Text size="xs" c="dimmed" mr={4}>{index + 1} / {images.length}</Text>
                     <Button size="xs" variant="default" px={6} onClick={() => setIndex((index - 1 + images.length) % images.length)}
                        aria-label="Previous image">
                        <IconChevronLeft size={14} />
                     </Button>
                     <Button size="xs" variant="default" px={6} onClick={() => setIndex((index + 1) % images.length)}
                        aria-label="Next image">
                        <IconChevronRight size={14} />
                     </Button>
                     <Tooltip label="Press N">
                        <Button size="xs" variant="light" onClick={nextUnlabelled} disabled={imagesLeft === 0 || (imagesLeft === 1 && leftHere > 0)}>
                           Next unlabelled
                        </Button>
                     </Tooltip>
                  </Group>
               </Group>
               {loadFailed ? (
                  <Alert color="red" variant="light" title="This image could not be loaded">
                     <Stack gap={6} align="flex-start">
                        <Text size="sm">{store.failure(current.file) ?? "Unknown error"}.</Text>
                        <Button size="xs" variant="light" color="red" leftSection={<IconRefresh size={14} />}
                           onClick={store.retryFailed}>
                           Retry
                        </Button>
                     </Stack>
                  </Alert>
               ) : shown ? (
                  <Box style={{ position: "relative" }}>
                     <ImageCanvas<TriageBox>
                        engine={triageEngine}
                        file={shown.url}
                        fileName={current.file}
                        annotations={boxes}
                        isEditable={false}
                        selectedAnnotationId={selected}
                        onSelection={onBoxClick}
                        onUpdate={noop}
                        setFileSize={noop}
                        isGraphEnabled={false}
                        score={0}
                        focusRequest={focus}
                     />
                  </Box>
               ) : (
                  <Center h={360}><Loader /></Center>
               )}
            </Stack>
         </Grid.Col>

         {/* ── Labels ── */}
         <Grid.Col span={{ base: 12, md: 3 }}>
            <Paper withBorder radius="md" p="sm" style={{ position: "sticky", top: 0 }}>
               <Stack gap="sm">
                  <Stack gap={4}>
                     <Text size="sm" fw={700}>Label</Text>
                     <Text size="xs" c="dimmed">Pick a class (or press its number), then click boxes on the image.</Text>
                     <ClassPalette classes={classes} labeler={labeler} vertical />
                  </Stack>

                  <Divider />
                  <Stack gap={4}>
                     <Group justify="space-between">
                        <Text size="sm" fw={700}>On this image</Text>
                        <Text size="xs" c="dimmed">{current.items.length - leftHere} / {current.items.length}</Text>
                     </Group>
                     <ScrollArea.Autosize mah={180} type="auto">
                        <Stack gap={2} component="nav" aria-label="Boxes on this image">
                           {current.items.map((p) => {
                              const classId = labeler.labels[p.proposal_id];
                              const cls = classId !== undefined ? byId.get(classId) : undefined;
                              const id = String(p.proposal_id);
                              return (
                                 <UnstyledButton key={id} onClick={() => focusBox(id)} px={6} py={2}
                                    style={{ borderRadius: 4, background: selected === id ? "var(--mantine-color-gray-1)" : undefined }}>
                                    <Group justify="space-between" wrap="nowrap">
                                       <Text size="xs" c="dimmed">#{p.proposal_id}</Text>
                                       {cls ? (
                                          <Badge size="xs" color={classColor(cls.id)} variant="filled">{cls.name}</Badge>
                                       ) : (
                                          <Badge size="xs" color="gray" variant="outline">unlabelled</Badge>
                                       )}
                                    </Group>
                                 </UnstyledButton>
                              );
                           })}
                        </Stack>
                     </ScrollArea.Autosize>
                     <Button size="xs" variant="default" disabled={leftHere === 0}
                        onClick={() => labeler.fillRemaining(0, current.items.map((p) => p.proposal_id))}>
                        Rest of this image are background
                     </Button>
                  </Stack>

                  <Divider />
                  <Stack gap={6}>
                     <Group justify="space-between">
                        <Text size="sm" fw={700}>Batch</Text>
                        <Text size="sm" c="dimmed">{labeler.labelled} / {labeler.total} labelled</Text>
                     </Group>
                     <Progress value={(100 * labeler.labelled) / Math.max(1, labeler.total)} size="sm" />
                     <Group gap="xs" grow>
                        <Tooltip label="Give every unlabelled proposal in the batch the Background label">
                           <Button size="xs" variant="default" onClick={() => labeler.fillRemaining(0)} disabled={labeler.complete}>
                              Rest are background
                           </Button>
                        </Tooltip>
                        <Button size="xs" variant="subtle" color="gray" leftSection={<IconEraser size={14} />}
                           onClick={labeler.clear} disabled={labeler.labelled === 0}>
                           Clear
                        </Button>
                     </Group>
                     <Button leftSection={<IconCheck size={16} />} onClick={() => onSubmit(labeler.labels)}
                        disabled={!labeler.complete} loading={submitting} fullWidth>
                        {submitLabel}
                     </Button>
                     {!labeler.complete && imagesLeft > 0 && (
                        <Text size="xs" c="dimmed">
                           {labeler.total - labeler.labelled} boxes on {imagesLeft} image{imagesLeft === 1 ? "" : "s"} still need a label.
                           Press <Kbd size="xs">N</Kbd> for the next one.
                        </Text>
                     )}
                  </Stack>
               </Stack>
            </Paper>
         </Grid.Col>
      </Grid>
   );
}
