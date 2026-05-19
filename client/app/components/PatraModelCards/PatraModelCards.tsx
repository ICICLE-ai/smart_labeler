import { Group, Text, Divider, Stack, Badge, Button, Grid, ThemeIcon, Paper, Alert } from "@mantine/core";
import {
   IconUser,
   IconTag,
   IconCategory,
   IconBolt,
   IconFileText,
   IconCpu,
   IconBrandPython,
   IconLicense,
   IconTargetArrow,
   IconChartBar,
   IconLink,
   IconDownload,
   IconDatabase,
   IconAlertCircle,
   IconLock,
} from "@tabler/icons-react";

export type PatraCard = {
   id: number;
   uuid: string;
   name: string;
   categories: string;
   author: string;
   version: string | null;
   short_description: string;
   is_gated: boolean;
};

export type PatraModelDetails = {
   is_gated?: boolean;
   input_data?: string;
   short_description?: string;
   full_description?: string;
   keywords?: string;
   author?: string;
   input_type?: string;
   name?: string;
   external_id?: string;
   categories?: string;
   output_data?: string;
   version?: string;
   ai_model?: {
      Backbone?: string;
      owner?: string;
      model_type?: string;
      test_accuracy?: number;
      description?: string;
      model_id?: string;
      Learning_Rate?: number;
      version?: string;
      Batch_Size?: number;
      license?: string;
      framework?: string;
      Precision?: number;
      name?: string;
      Recall?: number;
      location?: string;
      inference_labels?: string;
      Input_Shape?: string;
   };
};

const InfoRow: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = ({ icon, label, value }) => (
   <Group gap="sm" wrap="nowrap" align="flex-start">
      <ThemeIcon size="sm" variant="light" color="blue" radius="xl" style={{ marginTop: 2, flexShrink: 0 }}>
         {icon}
      </ThemeIcon>
      <Text size="sm" style={{ minWidth: 0 }}>
         <Text component="span" size="sm" fw={600} c="dimmed" mr={4}>{label}:</Text>
         {value}
      </Text>
   </Group>
);

const MetricCard: React.FC<{ label: string; value: React.ReactNode; color?: string }> = ({ label, value, color = "blue" }) => (
   <Paper withBorder radius="md" p="xs" style={{ textAlign: "center", flex: 1 }}>
      <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={2}>{label}</Text>
      <Text size="lg" fw={700} c={color}>{value}</Text>
   </Paper>
);

export const PatraDetailsContent: React.FC<{ details: PatraModelDetails; onUse: () => void }> = ({ details: d, onUse }) => (
   <Stack gap="md">
      {d.is_gated && (
         <Alert
            icon={<IconAlertCircle size={16} />}
            color="yellow"
            variant="light"
            title="Gated model access required"
         >
            <Text size="sm">
               We do not own this model license. Access must be approved under the model license
               {d.ai_model?.license ? <> (<b>{d.ai_model.license}</b>)</> : null}.
               {d.ai_model?.location ? (
                  <>
                     {" "}Request access here:{" "}
                     <a href={d.ai_model.location} target="_blank" rel="noreferrer" style={{ color: "var(--mantine-color-blue-6)" }}>
                        {d.ai_model.location}
                     </a>
                  </>
               ) : null}
            </Text>
         </Alert>
      )}

      {/* Header meta */}
      <Group gap="xs" wrap="wrap">
         {d.is_gated && <Badge leftSection={<IconLock size={11} />} variant="light" color="yellow" radius="sm">Gated</Badge>}
         {d.author && <Badge leftSection={<IconUser size={11} />} variant="light" color="gray" radius="sm">{d.author}</Badge>}
         {d.categories && <Badge leftSection={<IconCategory size={11} />} variant="light" color="violet" radius="sm">{d.categories}</Badge>}
         {d.input_type && <Badge leftSection={<IconBolt size={11} />} variant="light" color="teal" radius="sm">{d.input_type}</Badge>}
         {d.keywords && d.keywords.split(",").map((k) => (
            <Badge key={k.trim()} leftSection={<IconTag size={10} />} variant="outline" color="gray" size="xs" radius="sm">{k.trim()}</Badge>
         ))}
      </Group>

      {/* Descriptions */}
      {d.short_description && (
         <Paper withBorder radius="md" p="sm" bg="gray.0">
            <Text size="sm" c="dimmed">{d.short_description}</Text>
         </Paper>
      )}
      {d.full_description && (
         <Text size="sm" style={{ lineHeight: 1.7 }}>{d.full_description}</Text>
      )}

      {/* AI Model section */}
      {d.ai_model && (
         <>
            <Divider label={
               <Group gap={6}>
                  <IconCpu size={13} />
                  <Text size="xs" fw={700} tt="uppercase">AI Model</Text>
               </Group>
            } labelPosition="left" />

            {/* Metric cards for numeric values */}
            {(d.ai_model.test_accuracy !== undefined || d.ai_model.Precision !== undefined || d.ai_model.Recall !== undefined) && (
               <Group grow gap="xs">
                  {d.ai_model.test_accuracy !== undefined && (
                     <MetricCard label="Accuracy" value={`${(d.ai_model.test_accuracy * 100).toFixed(0)}%`} color="green" />
                  )}
                  {d.ai_model.Precision !== undefined && (
                     <MetricCard label="Precision" value={`${(d.ai_model.Precision * 100).toFixed(0)}%`} color="blue" />
                  )}
                  {d.ai_model.Recall !== undefined && (
                     <MetricCard label="Recall" value={`${(d.ai_model.Recall * 100).toFixed(0)}%`} color="orange" />
                  )}
                  {d.ai_model.Batch_Size !== undefined && (
                     <MetricCard label="Batch Size" value={d.ai_model.Batch_Size} color="gray" />
                  )}
                  {d.ai_model.Learning_Rate !== undefined && (
                     <MetricCard label="LR" value={d.ai_model.Learning_Rate} color="gray" />
                  )}
               </Group>
            )}

            <Grid gutter="xs">
               {d.ai_model.name && (
                  <Grid.Col span={6}><InfoRow icon={<IconCpu size={12} />} label="Name" value={d.ai_model.name} /></Grid.Col>
               )}
               {d.ai_model.model_type && (
                  <Grid.Col span={6}><InfoRow icon={<IconChartBar size={12} />} label="Type" value={d.ai_model.model_type} /></Grid.Col>
               )}
               {d.ai_model.framework && (
                  <Grid.Col span={6}><InfoRow icon={<IconBrandPython size={12} />} label="Framework" value={d.ai_model.framework} /></Grid.Col>
               )}
               {d.ai_model.Backbone && (
                  <Grid.Col span={6}><InfoRow icon={<IconTargetArrow size={12} />} label="Backbone" value={d.ai_model.Backbone} /></Grid.Col>
               )}
               {d.ai_model.owner && (
                  <Grid.Col span={6}><InfoRow icon={<IconUser size={12} />} label="Owner" value={d.ai_model.owner} /></Grid.Col>
               )}
               {d.ai_model.license && (
                  <Grid.Col span={6}><InfoRow icon={<IconLicense size={12} />} label="License" value={<Badge size="xs" variant="outline">{d.ai_model.license}</Badge>} /></Grid.Col>
               )}
               {d.ai_model.version && (
                  <Grid.Col span={6}><InfoRow icon={<IconTag size={12} />} label="Version" value={d.ai_model.version} /></Grid.Col>
               )}
               {d.ai_model.Input_Shape && (
                  <Grid.Col span={6}><InfoRow icon={<IconDatabase size={12} />} label="Input Shape" value={<code style={{ fontSize: "0.8em" }}>{d.ai_model.Input_Shape}</code>} /></Grid.Col>
               )}
            </Grid>

            {d.ai_model.description && (
               <Paper withBorder radius="md" p="sm" bg="blue.0">
                  <Group gap={6} mb={4}>
                     <IconFileText size={13} />
                     <Text size="xs" fw={700} c="blue">Model Description</Text>
                  </Group>
                  <Text size="sm" c="dimmed">{d.ai_model.description}</Text>
               </Paper>
            )}

            {(d.ai_model.location || d.ai_model.inference_labels) && (
               <Stack gap={4}>
                  {d.ai_model.location && (
                     <InfoRow
                        icon={<IconDownload size={12} />}
                        label="Model Weights"
                        value={
                           <a href={d.ai_model.location} target="_blank" rel="noreferrer"
                              style={{ wordBreak: "break-all", color: "var(--mantine-color-blue-6)", fontSize: "0.82em" }}>
                              {d.ai_model.location}
                           </a>
                        }
                     />
                  )}
                  {d.ai_model.inference_labels && (
                     <InfoRow
                        icon={<IconLink size={12} />}
                        label="Inference Labels"
                        value={
                           <a href={d.ai_model.inference_labels} target="_blank" rel="noreferrer"
                              style={{ color: "var(--mantine-color-blue-6)", fontSize: "0.82em" }}>
                              {d.ai_model.inference_labels}
                           </a>
                        }
                     />
                  )}
               </Stack>
            )}
         </>
      )}

      {/* External Links */}
      {(d.input_data || d.output_data) && (
         <>
            <Divider label={
               <Group gap={6}>
                  <IconLink size={13} />
                  <Text size="xs" fw={700} tt="uppercase">Links</Text>
               </Group>
            } labelPosition="left" />
            <Stack gap={4}>
               {d.input_data && (
                  <InfoRow
                     icon={<IconDatabase size={12} />}
                     label="Input Data"
                     value={<a href={d.input_data} target="_blank" rel="noreferrer" style={{ color: "var(--mantine-color-blue-6)", fontSize: "0.82em" }}>{d.input_data}</a>}
                  />
               )}
               {d.output_data && (
                  <InfoRow
                     icon={<IconDownload size={12} />}
                     label="Output Data"
                     value={<a href={d.output_data} target="_blank" rel="noreferrer" style={{ color: "var(--mantine-color-blue-6)", fontSize: "0.82em" }}>{d.output_data}</a>}
                  />
               )}
            </Stack>
         </>
      )}

      <Divider />
      <Group justify="flex-end">
         <Button
            type="button"
            onClick={onUse}
            leftSection={<IconBolt size={15} />}
            variant="gradient"
            gradient={{ from: "blue", to: "cyan", deg: 90 }}
            radius="md"
         >
            Use this Model
         </Button>
      </Group>
   </Stack>
);