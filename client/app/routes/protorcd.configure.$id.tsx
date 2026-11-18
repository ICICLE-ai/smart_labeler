import {
   Accordion,
   Alert,
   Button,
   Card,
   Checkbox,
   Grid,
   Group,
   NumberInput,
   Select,
   SimpleGrid,
   Stack,
   Switch,
   Text,
   TextInput,
   Title,
} from "@mantine/core";
import { IconAlertCircle, IconArrowRight, IconInfoCircle, IconRocket } from "@tabler/icons-react";
import { useNavigate, useParams } from "@remix-run/react";
import { Formik, type FormikProps } from "formik";
import { useCallback, useEffect, useState } from "react";
import { useCookies } from "react-cookie";
import FormikTapisFileWrapper from "~/components/FileExplorer/FormikTapisFileWrapper";
import {
   DETECT_DEFAULTS,
   EMBED_DEFAULTS,
   getProtoRCD,
   type BackgroundModel,
   type DetectConfig,
   type EmbedConfig,
   type HPCResources,
   type ProtoRCDRecord,
} from "~/components/ProtoRCD/api";
import { JobStatusLine } from "~/components/ProtoRCD/JobStatusLine";
import { useJobStatus } from "~/components/ProtoRCD/useJobStatus";
import { verifyJobPaths } from "~/utils/tapisAccess";
import { allowed_systems, DEFAULT_SYSTEM, describeJobFailure, fetchAndReturnData, SubmitJob } from "~/utils/utils";

type Form<T> = FormikProps<T>;

/** A NumberInput bound to one numeric Formik field. */
function NumberField<T>({ form, name, label, ...props }: {
   form: Form<T>;
   name: keyof T & string;
   label: string;
   description?: string;
   min?: number;
   max?: number;
   step?: number;
   decimalScale?: number;
}) {
   return (
      <NumberInput
         label={label}
         value={form.values[name] as unknown as number}
         onChange={(v) => form.setFieldValue(name, typeof v === "number" ? v : Number(v))}
         {...props}
      />
   );
}

function HPCFields<T extends HPCResources>({ form }: { form: Form<T> }) {
   return (
      <Accordion variant="contained" radius="md">
         <Accordion.Item value="hpc">
            <Accordion.Control>HPC resources</Accordion.Control>
            <Accordion.Panel>
               <SimpleGrid cols={2}>
                  <NumberField form={form} name="node_count" label="Nodes" min={1} />
                  <NumberField form={form} name="cores_per_node" label="Cores per node" min={1} />
                  <NumberField form={form} name="memory_mb" label="Memory (MB)" min={1024} step={1024} />
                  <NumberField form={form} name="max_minutes" label="Max minutes" min={1} />
               </SimpleGrid>
            </Accordion.Panel>
         </Accordion.Item>
      </Accordion>
   );
}

const join = (dir: string, name: string) => `${dir.replace(/\/+$/, "")}/${name}`;

export default function ConfigureProtoRCD() {
   const { id: pipeId = "" } = useParams();
   const navigate = useNavigate();
   const [cookie] = useCookies(["tapis-token"]);
   const token: string = cookie["tapis-token"]?.["access_token"] ?? "";

   const [record, setRecord] = useState<ProtoRCDRecord | null>(null);
   const [loadError, setLoadError] = useState<string | null>(null);
   const [isDemo, setIsDemo] = useState(false);

   const load = useCallback(async () => {
      if (!pipeId || !token) return;
      const res = await getProtoRCD(pipeId, token);
      if (res.ok && res.data) setRecord(res.data);
      else setLoadError(res.detail ?? "The pipeline's ProtoRCD settings could not be loaded.");
   }, [pipeId, token]);

   useEffect(() => {
      load();
      if (pipeId && token) fetchAndReturnData(`/pipe/${pipeId}`, token).then((p) => setIsDemo(!!p?.is_demo));
   }, [load, pipeId, token]);

   const detectJob = useJobStatus(record?.detect_job_id, token);
   const embedJob = useJobStatus(record?.embed_job_id, token);

   const proposalsFile = record?.proposals_file ?? "proposals.coco.json";
   const detectValues: DetectConfig = {
      ...DETECT_DEFAULTS,
      system: DEFAULT_SYSTEM,
      imageDir: "",
      outputDir: "",
      ...(record?.detect_config ?? {}),
   };
   const detected = record?.detect_config;
   const embedValues: EmbedConfig = {
      ...EMBED_DEFAULTS,
      system: detected?.system ?? DEFAULT_SYSTEM,
      imageDir: detected?.imageDir ?? "",
      cocoPath: detected?.outputDir ? join(detected.outputDir, proposalsFile) : "",
      outputDir: detected?.outputDir ? join(detected.outputDir, "embeddings") : "",
      ...(record?.embed_config ?? {}),
   };

   const submit = async (what: string, url: string, body: object, system: string,
      paths: { label: string; path: string; allowMissing?: boolean }[]) => {
      if (isDemo) {
         alert("This is a demo pipeline: jobs cannot be submitted from it.");
         return;
      }
      const problem = await verifyJobPaths(system, paths, token);
      if (problem) {
         alert(problem);
         return;
      }
      const res = await SubmitJob(url, body, token);
      if (!res.ok) {
         alert(describeJobFailure(what, res));
         return;
      }
      await load();
   };

   if (loadError) {
      return <Alert color="red" icon={<IconAlertCircle size={16} />} title="Could not load the pipeline">{loadError}</Alert>;
   }

   return (
      <Stack gap="lg" maw={1400} mx="auto">
         <Stack gap={4}>
            <Title order={2}>Configure ProtoRCD jobs</Title>
            <Text c="dimmed" size="sm">
               Two HPC jobs prepare the triage. The proposal job finds candidate objects with SAM3 and writes a COCO
               file; the embedding job then describes every proposal with DINOv3 (is it background?) and BioCLIP (which
               species?). When both have finished, continue to the human-in-the-loop step.
            </Text>
         </Stack>

         {isDemo && (
            <Alert color="yellow" icon={<IconAlertCircle size={16} />} title="Demo pipeline">
               Job submission is disabled for demo pipelines.
            </Alert>
         )}

         <Grid gutter="lg">
            {/* ── Stage 1: proposals ─────────────────────────────────────── */}
            <Grid.Col span={{ base: 12, lg: 6 }}>
               <Card withBorder radius="md" p="lg" h="100%">
                  <Formik
                     enableReinitialize
                     initialValues={detectValues}
                     onSubmit={(v) => submit("The proposal job", `/protorcd/${pipeId}/detect-job`, v, v.system, [
                        { label: "Image directory", path: v.imageDir },
                        { label: "Output directory", path: v.outputDir, allowMissing: true },
                     ])}
                  >
                     {(form) => (
                        <form onSubmit={form.handleSubmit}>
                           <Stack gap="sm">
                              <Group justify="space-between" align="flex-start">
                                 <Stack gap={0}>
                                    <Text fw={700} size="lg">1. Proposal generation</Text>
                                    <Text size="xs" c="dimmed">SAM3 text-prompt detection → {proposalsFile}</Text>
                                 </Stack>
                                 <JobStatusLine jobId={record?.detect_job_id ?? null} status={detectJob.status}
                                    message={detectJob.message} loading={detectJob.loading} onRefresh={detectJob.refresh} token={token} />
                              </Group>

                              <TextInput label="Job name" value={form.values.name}
                                 onChange={(e) => form.setFieldValue("name", e.currentTarget.value)} />
                              <Select label="HPC system" data={allowed_systems} value={form.values.system}
                                 onChange={(v) => form.setFieldValue("system", v ?? DEFAULT_SYSTEM)} allowDeselect={false} />
                              <FormikTapisFileWrapper name="imageDir" label="Image directory" required
                                 description="Searched recursively. File names in the COCO file are relative to it."
                                 systemId={form.values.system} files={false} dirs />
                              <FormikTapisFileWrapper name="outputDir" label="Output directory" required
                                 description={`Receives ${proposalsFile}. Created if missing.`}
                                 systemId={form.values.system} files={false} dirs />

                              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                                 <TextInput label="Text prompt" value={form.values.text_prompt}
                                    description="One word; `visual` finds any object"
                                    onChange={(e) => form.setFieldValue("text_prompt", e.currentTarget.value.trim())} />
                                 <NumberField form={form} name="batch_size" label="Batch size" min={1} max={256} />
                                 <NumberField form={form} name="confidence_threshold" label="Detector confidence"
                                    description="SAM3 keeps boxes above this" min={0} max={1} step={0.05} decimalScale={2} />
                                 <NumberField form={form} name="score_threshold" label="Export score threshold"
                                    description="Only these enter triage" min={0} max={1} step={0.05} decimalScale={2} />
                                 <NumberField form={form} name="nms_iou_threshold" label="NMS IoU" min={0} max={1} step={0.05} decimalScale={2} />
                              </SimpleGrid>

                              <Switch label="Tile large images (SAHI)" checked={form.values.use_sahi}
                                 onChange={(e) => form.setFieldValue("use_sahi", e.currentTarget.checked)} />
                              {form.values.use_sahi && (
                                 <SimpleGrid cols={2}>
                                    <NumberField form={form} name="crop_size" label="Tile size (px)" min={64} step={16} />
                                    <NumberField form={form} name="overlap" label="Tile overlap" min={0} max={0.9} step={0.05} decimalScale={2} />
                                 </SimpleGrid>
                              )}
                              <Checkbox label="Also export segmentation masks (needed for mask-region embeddings)"
                                 checked={form.values.return_masks}
                                 onChange={(e) => form.setFieldValue("return_masks", e.currentTarget.checked)} />

                              <HPCFields form={form} />

                              <Group justify="flex-end">
                                 <Button type="submit" leftSection={<IconRocket size={16} />} loading={form.isSubmitting}
                                    disabled={isDemo || !form.values.imageDir || !form.values.outputDir}>
                                    {record?.detect_job_id ? "Resubmit proposal job" : "Submit proposal job"}
                                 </Button>
                              </Group>
                           </Stack>
                        </form>
                     )}
                  </Formik>
               </Card>
            </Grid.Col>

            {/* ── Stage 2: embeddings ────────────────────────────────────── */}
            <Grid.Col span={{ base: 12, lg: 6 }}>
               <Card withBorder radius="md" p="lg" h="100%">
                  <Formik
                     enableReinitialize
                     initialValues={embedValues}
                     onSubmit={(v) => {
                        const paths = [
                           { label: "Image directory", path: v.imageDir },
                           { label: "Proposals file", path: v.cocoPath },
                           { label: "Output directory", path: v.outputDir, allowMissing: true },
                        ];
                        if (v.dinov3_weights) paths.push({ label: "DINOv3 weights", path: v.dinov3_weights });
                        return submit("The embedding job", `/protorcd/${pipeId}/embed-job`, v, v.system, paths);
                     }}
                  >
                     {(form) => {
                        const background = (form.values.models.find((m) => m.startsWith("dinov3")) ?? "dinov3") as BackgroundModel;
                        const masksAvailable = !!detected?.return_masks;
                        return (
                           <form onSubmit={form.handleSubmit}>
                              <Stack gap="sm">
                                 <Group justify="space-between" align="flex-start">
                                    <Stack gap={0}>
                                       <Text fw={700} size="lg">2. Embedding generation</Text>
                                       <Text size="xs" c="dimmed">DINOv3 + BioCLIP features keyed by annotation id</Text>
                                    </Stack>
                                    <JobStatusLine jobId={record?.embed_job_id ?? null} status={embedJob.status}
                                       message={embedJob.message} loading={embedJob.loading} onRefresh={embedJob.refresh} token={token} />
                                 </Group>

                                 {record?.detect_job_id && !detectJob.finished && (
                                    <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
                                       The proposal job is {detectJob.status?.toLowerCase() ?? "not finished"}. This job reads its
                                       {" "}{proposalsFile}, so submit it once the proposal job has finished.
                                    </Alert>
                                 )}

                                 <TextInput label="Job name" value={form.values.name}
                                    onChange={(e) => form.setFieldValue("name", e.currentTarget.value)} />
                                 <Select label="HPC system" data={allowed_systems} value={form.values.system}
                                    onChange={(v) => form.setFieldValue("system", v ?? DEFAULT_SYSTEM)} allowDeselect={false} />
                                 <FormikTapisFileWrapper name="imageDir" label="Image directory" required
                                    description="The same directory the proposal job read."
                                    systemId={form.values.system} files={false} dirs />
                                 <FormikTapisFileWrapper name="cocoPath" label="Proposals file" required
                                    description={`The proposal job's ${proposalsFile}.`}
                                    systemId={form.values.system} files dirs={false} />
                                 <FormikTapisFileWrapper name="outputDir" label="Output directory" required
                                    description="Receives one .npz file per model."
                                    systemId={form.values.system} files={false} dirs />

                                 <SimpleGrid cols={{ base: 1, sm: 2 }}>
                                    <Select
                                       label="Background model"
                                       description="BioCLIP is always added for species"
                                       data={[
                                          { value: "dinov3", label: "DINOv3" },
                                          { value: "dinov3_debiased", label: "DINOv3 (positionally debiased)" },
                                       ]}
                                       value={background}
                                       onChange={(v) => form.setFieldValue("models", [v ?? "dinov3", "bioclip"])}
                                       allowDeselect={false}
                                    />
                                    <Select
                                       label="Crop region"
                                       description={masksAvailable ? "Mask blacks out pixels outside the object" : "Mask needs masks from the proposal job"}
                                       data={[
                                          { value: "box", label: "Bounding box" },
                                          { value: "mask", label: "Mask", disabled: !masksAvailable },
                                       ]}
                                       value={form.values.region}
                                       onChange={(v) => form.setFieldValue("region", (v ?? "box") as EmbedConfig["region"])}
                                       allowDeselect={false}
                                    />
                                    <Select
                                       label="DINOv3 size"
                                       data={[
                                          { value: "hugeplus", label: "ViT-H+/16 (ProtoRCD default)" },
                                          { value: "large", label: "ViT-L/16" },
                                          { value: "base", label: "ViT-B/16" },
                                          { value: "small", label: "ViT-S/16" },
                                       ]}
                                       value={form.values.dinov3_model_size}
                                       onChange={(v) => form.setFieldValue("dinov3_model_size", (v ?? "hugeplus") as EmbedConfig["dinov3_model_size"])}
                                       allowDeselect={false}
                                    />
                                    <NumberField form={form} name="dinov3_image_size" label="DINOv3 input size (px)" min={64} step={16} />
                                    <NumberField form={form} name="batch_size" label="Batch size" min={1} max={512} />
                                    <Select
                                       label="Stored precision"
                                       data={[
                                          { value: "float32", label: "float32 (exact)" },
                                          { value: "float16", label: "float16 (half the size)" },
                                       ]}
                                       value={form.values.dtype}
                                       onChange={(v) => form.setFieldValue("dtype", (v ?? "float32") as EmbedConfig["dtype"])}
                                       allowDeselect={false}
                                    />
                                 </SimpleGrid>
                                 <FormikTapisFileWrapper name="dinov3_weights" label="DINOv3 weights"
                                    description="Checkpoint (.pth) on the HPC system. The weights are gated, so they are not in the container."
                                    systemId={form.values.system} files dirs={false} />

                                 <HPCFields form={form} />

                                 <Group justify="flex-end">
                                    <Button type="submit" leftSection={<IconRocket size={16} />} loading={form.isSubmitting}
                                       disabled={isDemo || !form.values.imageDir || !form.values.cocoPath || !form.values.outputDir}>
                                       {record?.embed_job_id ? "Resubmit embedding job" : "Submit embedding job"}
                                    </Button>
                                 </Group>
                              </Stack>
                           </form>
                        );
                     }}
                  </Formik>
               </Card>
            </Grid.Col>
         </Grid>

         <Card withBorder radius="md" p="md">
            <Group justify="space-between">
               <Text size="sm" c={embedJob.finished ? undefined : "dimmed"}>
                  {embedJob.finished
                     ? "Both jobs are done. Set up the labelling session next."
                     : "Human-in-the-loop labelling opens once the embedding job has finished."}
               </Text>
               <Button rightSection={<IconArrowRight size={16} />} disabled={!embedJob.finished}
                  onClick={() => navigate(`/protorcd/triage/${pipeId}`)}>
                  Continue to human in the loop
               </Button>
            </Group>
         </Card>
      </Stack>
   );
}
