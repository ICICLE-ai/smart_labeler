import {
   Accordion,
   Alert,
   Badge,
   Button,
   Card,
   Checkbox,
   Divider,
   Grid,
   Group,
   MultiSelect,
   NumberInput,
   Paper,
   Select,
   SimpleGrid,
   Stack,
   Switch,
   Text,
   TextInput,
   Title,
} from "@mantine/core";
import { IconAlertCircle, IconArrowRight, IconFolderCheck, IconInfoCircle, IconRocket } from "@tabler/icons-react";
import { useNavigate, useParams } from "@remix-run/react";
import { Formik, type FormikProps } from "formik";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCookies } from "react-cookie";
import FormikTapisFileWrapper from "~/components/FileExplorer/FormikTapisFileWrapper";
import {
   clearTriageFiles,
   DETECT_DEFAULTS,
   EMBED_DEFAULTS,
   EMBED_MODELS,
   embedModelLabel,
   getProtoRCD,
   getTriageReadiness,
   setTriageFiles,
   type DetectConfig,
   type EmbedConfig,
   type EmbedJob,
   type EmbedModel,
   type HPCResources,
   type ProtoRCDRecord,
   type TriageFiles,
   type TriageReadiness,
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

// Triage needs one of each; the two DINOv3 variants are alternatives.
const REQUIRED_MODELS: EmbedModel[][] = [["dinov3", "dinov3_debiased"], ["bioclip"]];

const jobTitle = (models: string[]) => `ProtoRCD ${models.map(embedModelLabel).join(" + ") || "embeddings"}`;

/** One submitted embedding job: its models, output and live Tapis status. */
function EmbedJobRow({ job, token, onStatus }: {
   job: EmbedJob;
   token: string;
   onStatus: (jobId: string, status: string | null) => void;
}) {
   const status = useJobStatus(job.job_id, token);
   useEffect(() => onStatus(job.job_id, status.status), [job.job_id, status.status, onStatus]);
   return (
      <Paper withBorder radius="sm" p="xs">
         <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={2} miw={0}>
               <Group gap={4}>
                  {job.config.models.map((m) => <Badge key={m} size="sm" variant="light">{embedModelLabel(m)}</Badge>)}
                  <Text size="xs" c="dimmed">{job.config.region}</Text>
               </Group>
               <Text size="xs" c="dimmed" truncate title={job.config.outputDir}>→ {job.config.outputDir}</Text>
            </Stack>
            <JobStatusLine jobId={job.job_id} status={status.status} message={status.message}
               loading={status.loading} onRefresh={status.refresh} token={token} />
         </Group>
      </Paper>
   );
}

/** Triage proposals and embeddings the user already has, instead of running the jobs. */
function ExistingFilesCard({ record, pipeId, token, isDemo, onSaved }: {
   record: ProtoRCDRecord | null;
   pipeId: string;
   token: string;
   isDemo: boolean;
   onSaved: (record: ProtoRCDRecord) => void;
}) {
   const saved = record?.triage_files ?? null;
   const detected = record?.detect_config;
   const proposalsFile = record?.proposals_file ?? "proposals.coco.json";
   const initialValues: TriageFiles = saved ?? {
      system: detected?.system ?? DEFAULT_SYSTEM,
      imageDir: detected?.imageDir ?? "",
      cocoPath: detected?.outputDir ? join(detected.outputDir, proposalsFile) : "",
      dinov3Path: "",
      bioclipPath: "",
      outputDir: "",
   };
   const [clearing, setClearing] = useState(false);
   // Open while the files are in use; the record arrives after the first render.
   const inUse = !!saved;
   const [open, setOpen] = useState<string | null>(null);
   useEffect(() => {
      if (inUse) setOpen("files");
   }, [inUse]);

   const save = async (v: TriageFiles) => {
      const problem = await verifyJobPaths(v.system, [
         { label: "Image directory", path: v.imageDir },
         { label: "Proposals file", path: v.cocoPath },
         { label: "DINOv3 embeddings", path: v.dinov3Path },
         { label: "BioCLIP embeddings", path: v.bioclipPath },
         ...(v.outputDir ? [{ label: "Export directory", path: v.outputDir, allowMissing: true }] : []),
      ], token);
      if (problem) {
         // verifyJobPaths words its message for job submission.
         alert(problem.replace("The job was not submitted", "The files were not saved"));
         return;
      }
      const res = await setTriageFiles(pipeId, v, token);
      if (res.ok && res.data) onSaved(res.data);
      else alert(res.detail ?? "The files could not be saved.");
   };

   const clear = async () => {
      setClearing(true);
      const res = await clearTriageFiles(pipeId, token);
      setClearing(false);
      if (res.ok && res.data) onSaved(res.data);
      else alert(res.detail ?? "The files could not be cleared.");
   };

   return (
      <Accordion variant="contained" radius="md" value={open} onChange={setOpen}>
         <Accordion.Item value="files">
            <Accordion.Control icon={<IconFolderCheck size={18} />}>
               <Group gap="xs">
                  <Text fw={600}>Already have proposals and embeddings?</Text>
                  {saved && <Badge size="sm" color="teal" variant="light">In use for triage</Badge>}
               </Group>
            </Accordion.Control>
            <Accordion.Panel>
               <Formik enableReinitialize initialValues={initialValues} onSubmit={save}>
                  {(form) => (
                     <form onSubmit={form.handleSubmit}>
                        <Stack gap="sm">
                           <Text size="sm" c="dimmed">
                              If you made the proposals COCO file and both embedding files some other way, point to them
                              here and skip the jobs above. While these are set, triage uses them instead of the embedding
                              jobs. Both .npz files must be embeddings of this proposals file; that is checked when the
                              session starts.
                           </Text>
                           <Select label="HPC system" data={allowed_systems} value={form.values.system}
                              onChange={(v) => form.setFieldValue("system", v ?? DEFAULT_SYSTEM)} allowDeselect={false} />
                           <SimpleGrid cols={{ base: 1, md: 2 }}>
                              <FormikTapisFileWrapper name="imageDir" label="Image directory" required
                                 description="File names in the proposals file are relative to it."
                                 systemId={form.values.system} files={false} dirs />
                              <FormikTapisFileWrapper name="cocoPath" label="Proposals file" required
                                 description="Stage-1 COCO file"
                                 systemId={form.values.system} files dirs={false} />
                              <FormikTapisFileWrapper name="dinov3Path" label="DINOv3 embeddings" required
                                 description="e.g. dinov3_box.npz (debiased DINOv3 also works)"
                                 systemId={form.values.system} files dirs={false} />
                              <FormikTapisFileWrapper name="bioclipPath" label="BioCLIP embeddings" required
                                 description="e.g. bioclip_box.npz"
                                 systemId={form.values.system} files dirs={false} />
                           </SimpleGrid>
                           <FormikTapisFileWrapper name="outputDir" label="Export directory"
                              description="Where labelled COCO exports are saved. Leave empty to use the BioCLIP file's folder."
                              systemId={form.values.system} files={false} dirs />
                           <Group justify="flex-end">
                              {saved && (
                                 <Button variant="default" loading={clearing} onClick={clear}>
                                    Use the embedding jobs instead
                                 </Button>
                              )}
                              <Button type="submit" leftSection={<IconFolderCheck size={16} />} loading={form.isSubmitting}
                                 disabled={isDemo || !form.values.imageDir || !form.values.cocoPath
                                    || !form.values.dinov3Path || !form.values.bioclipPath}>
                                 {saved ? "Update files" : "Use these files"}
                              </Button>
                           </Group>
                        </Stack>
                     </form>
                  )}
               </Formik>
            </Accordion.Panel>
         </Accordion.Item>
      </Accordion>
   );
}

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

   // Whether triage can start is decided by the backend from the user's own files or all
   // embed jobs; ask again whenever those change or a job changes status.
   const [embedStatuses, setEmbedStatuses] = useState<Record<string, string | null>>({});
   const onEmbedStatus = useCallback((jobId: string, status: string | null) =>
      setEmbedStatuses((prev) => (prev[jobId] === status ? prev : { ...prev, [jobId]: status })), []);
   const [readiness, setReadiness] = useState<TriageReadiness | null>(null);
   const statusKey = JSON.stringify(embedStatuses);
   const filesKey = JSON.stringify(record?.triage_files ?? null);
   useEffect(() => {
      if (!pipeId || !token || !(record?.embed_jobs.length || record?.triage_files)) {
         setReadiness(null);
         return;
      }
      getTriageReadiness(pipeId, token).then((res) => setReadiness(res.ok && res.data ? res.data : null));
   }, [pipeId, token, record?.embed_jobs.length, statusKey, filesKey]);

   const proposalsFile = record?.proposals_file ?? "proposals.coco.json";
   const detectValues: DetectConfig = {
      ...DETECT_DEFAULTS,
      system: DEFAULT_SYSTEM,
      imageDir: "",
      outputDir: "",
      ...(record?.detect_config ?? {}),
   };
   const detected = record?.detect_config;
   const embedJobs = record?.embed_jobs ?? [];
   const latestEmbed = embedJobs.at(-1)?.config;
   const embedValues: EmbedConfig = useMemo(() => {
      // Pre-select the models no job has run yet, so a second job completes the pair.
      const submitted = new Set(embedJobs.flatMap((j) => j.config.models));
      const missing = REQUIRED_MODELS.filter((group) => !group.some((m) => submitted.has(m))).map((group) => group[0]);
      const models = missing.length ? missing : latestEmbed?.models ?? EMBED_DEFAULTS.models;
      return {
         ...EMBED_DEFAULTS,
         system: detected?.system ?? DEFAULT_SYSTEM,
         imageDir: detected?.imageDir ?? "",
         cocoPath: detected?.outputDir ? join(detected.outputDir, proposalsFile) : "",
         outputDir: detected?.outputDir ? join(detected.outputDir, "embeddings") : "",
         ...(latestEmbed ?? {}),
         models,
         name: jobTitle(models),
      };
   }, [embedJobs, latestEmbed, detected, proposalsFile]);

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
               HPC jobs prepare the triage. The proposal job finds candidate objects with SAM3 and writes a COCO file;
               embedding jobs then describe every proposal with DINOv3 (is it background?) and BioCLIP (which species?).
               Run both models in one job, or one job per model to run them in parallel. When DINOv3 and BioCLIP
               embeddings of the same proposals have finished, continue to the human-in-the-loop step. Already have
               those files? Point to them at the bottom of the page instead.
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
                        const usesDino = v.models.some((m) => m.startsWith("dinov3"));
                        if (usesDino && v.dinov3_weights) paths.push({ label: "DINOv3 weights", path: v.dinov3_weights });
                        return submit("The embedding job", `/protorcd/${pipeId}/embed-job`, v, v.system, paths);
                     }}
                  >
                     {(form) => {
                        const masksAvailable = !!detected?.return_masks;
                        const usesDino = form.values.models.some((m) => m.startsWith("dinov3"));
                        const setModels = (models: EmbedModel[]) => {
                           form.setFieldValue("models", models);
                           // Follow the models in the job name until the user names it themselves.
                           if (form.values.name === jobTitle(form.values.models)) form.setFieldValue("name", jobTitle(models));
                        };
                        return (
                           <form onSubmit={form.handleSubmit}>
                              <Stack gap="sm">
                                 <Stack gap={0}>
                                    <Text fw={700} size="lg">2. Embedding generation</Text>
                                    <Text size="xs" c="dimmed">One .npz per model, keyed by annotation id</Text>
                                 </Stack>

                                 {embedJobs.length > 0 && (
                                    <Stack gap={6}>
                                       {[...embedJobs].reverse().map((job) => (
                                          <EmbedJobRow key={job.job_id} job={job} token={token} onStatus={onEmbedStatus} />
                                       ))}
                                       <Divider label="Submit another embedding job" labelPosition="left" mt={4} />
                                    </Stack>
                                 )}

                                 {record?.detect_job_id && !detectJob.finished && (
                                    <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
                                       The proposal job is {detectJob.status?.toLowerCase() ?? "not finished"}. Embedding jobs read its
                                       {" "}{proposalsFile}, so submit them once the proposal job has finished.
                                    </Alert>
                                 )}

                                 <MultiSelect
                                    label="Models"
                                    description="Select one model to run it as its own job, or several to run them one after another in a single job."
                                    data={EMBED_MODELS}
                                    value={form.values.models}
                                    onChange={(v) => setModels(v as EmbedModel[])}
                                    error={form.values.models.length ? undefined : "Select at least one model"}
                                 />
                                 <TextInput label="Job name" value={form.values.name}
                                    onChange={(e) => form.setFieldValue("name", e.currentTarget.value)} />
                                 <Select label="HPC system" data={allowed_systems} value={form.values.system}
                                    onChange={(v) => form.setFieldValue("system", v ?? DEFAULT_SYSTEM)} allowDeselect={false} />
                                 <FormikTapisFileWrapper name="imageDir" label="Image directory" required
                                    description="The same directory the proposal job read."
                                    systemId={form.values.system} files={false} dirs />
                                 <FormikTapisFileWrapper name="cocoPath" label="Proposals file" required
                                    description={`The proposal job's ${proposalsFile}. DINOv3 and BioCLIP must embed the same file.`}
                                    systemId={form.values.system} files dirs={false} />
                                 <FormikTapisFileWrapper name="outputDir" label="Output directory" required
                                    description="Receives <model>_<region>.npz per model. Jobs for different models can share it."
                                    systemId={form.values.system} files={false} dirs />

                                 <SimpleGrid cols={{ base: 1, sm: 2 }}>
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
                                    {usesDino && (
                                       <>
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
                                       </>
                                    )}
                                 </SimpleGrid>
                                 {usesDino && (
                                    <FormikTapisFileWrapper name="dinov3_weights" label="DINOv3 weights"
                                       description="Checkpoint (.pth) on the HPC system, matching the DINOv3 size. The weights are gated, so they are not in the container."
                                       systemId={form.values.system} files dirs={false} />
                                 )}

                                 <HPCFields form={form} />

                                 <Group justify="flex-end">
                                    <Button type="submit" leftSection={<IconRocket size={16} />} loading={form.isSubmitting}
                                       disabled={isDemo || !form.values.models.length || !form.values.imageDir
                                          || !form.values.cocoPath || !form.values.outputDir}>
                                       Submit {form.values.models.map(embedModelLabel).join(" + ") || "embedding"} job
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

         <ExistingFilesCard record={record} pipeId={pipeId} token={token} isDemo={isDemo} onSaved={setRecord} />

         <Card withBorder radius="md" p="md">
            <Group justify="space-between">
               <Text size="sm" c={readiness?.ready ? undefined : "dimmed"}>
                  {readiness?.ready
                     ? record?.triage_files
                        ? "Triage will use your own proposals and embedding files. Set up the labelling session next."
                        : "DINOv3 and BioCLIP embeddings are ready. Set up the labelling session next."
                     : readiness?.problem
                        ?? "Human-in-the-loop labelling opens once DINOv3 and BioCLIP embeddings have finished."}
               </Text>
               <Button rightSection={<IconArrowRight size={16} />} disabled={!readiness?.ready}
                  onClick={() => navigate(`/protorcd/triage/${pipeId}`)}>
                  Continue to human in the loop
               </Button>
            </Group>
         </Card>
      </Stack>
   );
}
