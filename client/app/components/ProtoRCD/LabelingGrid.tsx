import { Badge, Box, Button, Card, Group, Kbd, Paper, Progress, SimpleGrid, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconCheck, IconEraser, IconPaint } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import type { Proposal } from "./api";
import { ProposalCrop, type ImageLoader } from "./ProposalCrop";

export interface LabelClass {
   id: number;   // 0 = background
   name: string;
}

const CLASS_COLORS = ["blue", "teal", "orange", "grape", "cyan", "lime", "pink", "indigo", "yellow", "red"];
export const classColor = (id: number) => (id === 0 ? "gray" : CLASS_COLORS[(id - 1) % CLASS_COLORS.length]);

/** Classes in palette order, background first; from a triage taxonomy {"1": "deer", ...}. */
export const classesFromTaxonomy = (taxonomy: Record<string, string> | null | undefined): LabelClass[] => [
   { id: 0, name: "Background" },
   ...Object.entries(taxonomy ?? {})
      .map(([id, name]) => ({ id: Number(id), name }))
      .sort((a, b) => a.id - b.id),
];

/**
 * Paint-style labelling of one batch: choose a class in the palette (or press
 * its number key), then click proposals to give them that class. Clicking a
 * proposal that already has the active class clears it. The batch can only be
 * submitted once every proposal has a label, because the triage service
 * rejects partial batches.
 */
export function LabelingGrid({
   batchKey,
   proposals,
   classes,
   loadImage,
   onSubmit,
   submitting,
   submitLabel,
   context,
}: {
   /** Changes whenever a new batch arrives; resets the labels. */
   batchKey: string;
   proposals: Proposal[];
   classes: LabelClass[];
   loadImage: ImageLoader;
   onSubmit: (labels: Record<number, number>) => void;
   submitting: boolean;
   submitLabel: string;
   context: number;
}) {
   const [labels, setLabels] = useState<Record<number, number>>({});
   const [active, setActive] = useState<number>(classes[1]?.id ?? 0);

   useEffect(() => setLabels({}), [batchKey]);

   // Number keys pick a palette class: 0 = background, 1-9 = classes in order.
   useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
         const target = e.target as HTMLElement | null;
         if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
         if (!/^[0-9]$/.test(e.key)) return;
         const cls = classes[Number(e.key)];
         if (cls) setActive(cls.id);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
   }, [classes]);

   const byId = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
   const labelled = proposals.filter((p) => labels[p.proposal_id] !== undefined).length;
   const complete = labelled === proposals.length && proposals.length > 0;

   const toggle = (pid: number) =>
      setLabels((prev) => {
         const next = { ...prev };
         if (next[pid] === active) delete next[pid];
         else next[pid] = active;
         return next;
      });

   const fillRemaining = (classId: number) =>
      setLabels((prev) => {
         const next = { ...prev };
         proposals.forEach((p) => {
            if (next[p.proposal_id] === undefined) next[p.proposal_id] = classId;
         });
         return next;
      });

   return (
      <Stack gap="sm">
         <Paper withBorder p="sm" radius="md" style={{ position: "sticky", top: 0, zIndex: 2, background: "white" }}>
            <Stack gap="xs">
               <Group justify="space-between" wrap="wrap">
                  <Group gap={6} wrap="wrap">
                     <IconPaint size={16} />
                     {classes.map((c, index) => (
                        <Button
                           key={c.id}
                           size="xs"
                           color={classColor(c.id)}
                           variant={active === c.id ? "filled" : "light"}
                           onClick={() => setActive(c.id)}
                           rightSection={index < 10 ? <Kbd size="xs">{index}</Kbd> : null}
                        >
                           {c.name}
                        </Button>
                     ))}
                  </Group>
                  <Group gap="xs">
                     <Tooltip label="Give every unlabelled proposal the Background label">
                        <Button size="xs" variant="default" onClick={() => fillRemaining(0)} disabled={complete}>
                           Rest are background
                        </Button>
                     </Tooltip>
                     <Button size="xs" variant="subtle" color="gray" leftSection={<IconEraser size={14} />}
                        onClick={() => setLabels({})} disabled={labelled === 0}>
                        Clear
                     </Button>
                  </Group>
               </Group>
               <Group justify="space-between" align="center">
                  <Box style={{ flex: 1 }}>
                     <Progress value={(100 * labelled) / Math.max(1, proposals.length)} size="sm" />
                  </Box>
                  <Text size="sm" c="dimmed" w={120} ta="right">
                     {labelled} / {proposals.length} labelled
                  </Text>
                  <Button
                     leftSection={<IconCheck size={16} />}
                     onClick={() => onSubmit(labels)}
                     disabled={!complete}
                     loading={submitting}
                  >
                     {submitLabel}
                  </Button>
               </Group>
            </Stack>
         </Paper>

         <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 5, lg: 6, xl: 8 }} spacing="sm">
            {proposals.map((p) => {
               const label = labels[p.proposal_id];
               const cls = label !== undefined ? byId.get(label) : undefined;
               return (
                  <UnstyledButton key={p.proposal_id} onClick={() => toggle(p.proposal_id)} disabled={submitting}>
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
                           <ProposalCrop proposal={p} loadImage={loadImage} context={context} />
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
