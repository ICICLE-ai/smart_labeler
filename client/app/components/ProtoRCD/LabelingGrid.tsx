import { Badge, Box, Button, Card, Group, Kbd, Paper, Progress, SimpleGrid, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconCheck, IconEraser, IconPaint } from "@tabler/icons-react";
import { useMemo } from "react";
import type { Proposal } from "./api";
import type { ImageStore } from "./imageStore";
import { ProposalCrop } from "./ProposalCrop";
import type { BatchLabels, LabelClass } from "./useBatchLabels";

export type { LabelClass } from "./useBatchLabels";

const CLASS_COLORS = ["blue", "teal", "orange", "grape", "cyan", "lime", "pink", "indigo", "yellow", "red"];
export const classColor = (id: number) => (id === 0 ? "gray" : CLASS_COLORS[(id - 1) % CLASS_COLORS.length]);

/** Classes in palette order, background first; from a triage taxonomy {"1": "deer", ...}. */
export const classesFromTaxonomy = (taxonomy: Record<string, string> | null | undefined): LabelClass[] => [
   { id: 0, name: "Background" },
   ...Object.entries(taxonomy ?? {})
      .map(([id, name]) => ({ id: Number(id), name }))
      .sort((a, b) => a.id - b.id),
];

/** One button per class with its number key; the active class is filled. */
export function ClassPalette({ classes, labeler, vertical = false }: {
   classes: LabelClass[];
   labeler: BatchLabels;
   vertical?: boolean;
}) {
   const buttons = classes.map((c, index) => (
      <Button
         key={c.id}
         size="xs"
         color={classColor(c.id)}
         variant={labeler.active === c.id ? "filled" : "light"}
         onClick={() => labeler.setActive(c.id)}
         rightSection={index < 10 ? <Kbd size="xs">{index}</Kbd> : null}
         justify={vertical ? "space-between" : undefined}
         fullWidth={vertical}
      >
         {c.name}
      </Button>
   ));
   return vertical ? <Stack gap={6}>{buttons}</Stack> : <Group gap={6} wrap="wrap"><IconPaint size={16} />{buttons}</Group>;
}

/** Labelled count, progress and the submit button for a batch. */
export function BatchProgress({ labeler, submitting, submitLabel, onSubmit }: {
   labeler: BatchLabels;
   submitting: boolean;
   submitLabel: string;
   onSubmit: (labels: Record<number, number>) => void;
}) {
   return (
      <Group justify="space-between" align="center">
         <Box style={{ flex: 1, minWidth: 80 }}>
            <Progress value={(100 * labeler.labelled) / Math.max(1, labeler.total)} size="sm" />
         </Box>
         <Text size="sm" c="dimmed" ta="right">
            {labeler.labelled} / {labeler.total} labelled
         </Text>
         <Button
            leftSection={<IconCheck size={16} />}
            onClick={() => onSubmit(labeler.labels)}
            disabled={!labeler.complete}
            loading={submitting}
         >
            {submitLabel}
         </Button>
      </Group>
   );
}

/** The batch as a grid of crops: fastest when most proposals are easy calls. */
export function LabelingGrid({
   proposals,
   classes,
   labeler,
   images,
   onSubmit,
   submitting,
   submitLabel,
   context,
}: {
   proposals: Proposal[];
   classes: LabelClass[];
   labeler: BatchLabels;
   images: ImageStore;
   onSubmit: (labels: Record<number, number>) => void;
   submitting: boolean;
   submitLabel: string;
   context: number;
}) {
   const byId = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

   return (
      <Stack gap="sm">
         <Paper withBorder p="sm" radius="md" style={{ position: "sticky", top: 0, zIndex: 2, background: "white" }}>
            <Stack gap="xs">
               <Group justify="space-between" wrap="wrap">
                  <ClassPalette classes={classes} labeler={labeler} />
                  <Group gap="xs">
                     <Tooltip label="Give every unlabelled proposal the Background label">
                        <Button size="xs" variant="default" onClick={() => labeler.fillRemaining(0)} disabled={labeler.complete}>
                           Rest are background
                        </Button>
                     </Tooltip>
                     <Button size="xs" variant="subtle" color="gray" leftSection={<IconEraser size={14} />}
                        onClick={labeler.clear} disabled={labeler.labelled === 0}>
                        Clear
                     </Button>
                  </Group>
               </Group>
               <BatchProgress labeler={labeler} submitting={submitting} submitLabel={submitLabel} onSubmit={onSubmit} />
            </Stack>
         </Paper>

         <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 5, lg: 6, xl: 8 }} spacing="sm">
            {proposals.map((p) => {
               const label = labeler.labels[p.proposal_id];
               const cls = label !== undefined ? byId.get(label) : undefined;
               return (
                  <UnstyledButton key={p.proposal_id} onClick={() => labeler.toggle(p.proposal_id)} disabled={submitting}>
                     <Card
                        withBorder
                        padding={6}
                        radius="md"
                        style={{
                           borderWidth: 2,
                           borderColor: cls ? `var(--mantine-color-${classColor(cls.id)}-6)` : undefined,
                        }}
                     >
                        <Stack gap={4} align="center">
                           <ProposalCrop proposal={p} images={images} context={context} />
                           <Group gap={4} justify="space-between" w="100%" wrap="nowrap">
                              <Text size="xs" c="dimmed" truncate title={p.file_name}>
                                 #{p.proposal_id}
                              </Text>
                              {cls ? (
                                 <Badge size="xs" color={classColor(cls.id)} variant="filled" maw={100}>
                                    {cls.name}
                                 </Badge>
                              ) : (
                                 <Badge size="xs" color="gray" variant="outline">unlabelled</Badge>
                              )}
                           </Group>
                        </Stack>
                     </Card>
                  </UnstyledButton>
               );
            })}
         </SimpleGrid>
      </Stack>
   );
}
