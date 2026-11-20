import {
   Alert,
   Badge,
   Button,
   Card,
   Center,
   Checkbox,
   Grid,
   Group,
   Loader,
   NumberInput,
   Paper,
   SegmentedControl,
   SimpleGrid,
   Stack,
   Table,
   TagsInput,
   Text,
   Title,
} from "@mantine/core";
import {
   IconAlertCircle,
   IconArrowLeft,
   IconCloudUpload,
   IconDownload,
   IconPlayerPlay,
   IconPlugConnected,
   IconPlus,
   IconRefresh,
   IconShieldCheck,
} from "@tabler/icons-react";
import { useNavigate, useParams } from "@remix-run/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCookies } from "react-cookie";
import { downloadFile } from "~/components/ImageAnnotation/utils/utils";
import {
   exportTriage,
   getProtoRCD,
   getTriage,
   getTriageReadiness,
   startTriage,
   TRIAGE_DEFAULTS,
   type ProtoRCDRecord,
   type SessionState,
   type TriageConfig,
   type TriageConnection,
   type TriageInputs,
   type TriageReadiness,
   type ValidationSummary,
} from "~/components/ProtoRCD/api";
import { BatchLabeler, type LabelingView } from "~/components/ProtoRCD/BatchLabeler";
import { classColor, classesFromTaxonomy, type LabelClass } from "~/components/ProtoRCD/LabelingGrid";
import { useImageStore, type ImageStore } from "~/components/ProtoRCD/imageStore";
import { ReviewCard } from "~/components/ProtoRCD/ReviewCard";
import { useTriageSocket, type ConnectionStatus } from "~/components/ProtoRCD/useTriageSocket";

const VIEW_KEY = "protorcd.labelingView";

/** The reviewer's last view, remembered in this browser; images unless they chose crops. */
function useLabelingView(): [LabelingView, (v: LabelingView) => void] {
   const [view, setView] = useState<LabelingView>("images");
   useEffect(() => {
      try {
         if (localStorage.getItem(VIEW_KEY) === "crops") setView("crops");
      } catch {
         // Storage unavailable: keep the default.
      }
   }, []);
   const choose = (v: LabelingView) => {
      setView(v);
      try {
         localStorage.setItem(VIEW_KEY, v);
      } catch {
         // Not remembered; harmless.
      }
   };
   return [view, choose];
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${(100 * x).toFixed(1)}%`);

// ── Setup ─────────────────────────────────────────────────────────────────────
function SessionSetup({
   record,
   ready,
   notReadyReason,
   onStart,
   onResume,
   busy,
}: {
   record: ProtoRCDRecord;
   ready: boolean;
   notReadyReason: string | null;
   onStart: (config: TriageConfig) => void;
   onResume: () => void;
   busy: "start" | "resume" | null;
}) {
   const [config, setConfig] = useState<TriageConfig>(() => {
      const { inputs: _inputs, ...saved } = record.triage_config ?? {};
      return { ...TRIAGE_DEFAULTS, ...saved };
   });
   const set = <K extends keyof TriageConfig>(key: K, value: TriageConfig[K]) => setConfig((c) => ({ ...c, [key]: value }));
   const num = (key: "seed" | "batch_size" | "calibration_size" | "max_rounds") => (v: string | number) =>
      set(key, typeof v === "number" ? v : Number(v));

   return (
      <Grid gutter="lg">
         <Grid.Col span={{ base: 12, md: record.triage_session_id ? 7 : 12 }}>
            <Card withBorder radius="md" p="lg">
               <Stack gap="sm">
                  <Text fw={700} size="lg">New labelling session</Text>
                  <Text size="sm" c="dimmed">
                     The triage service first asks you to label a random calibration batch, which tunes its decision
                     rule. Each round after that it picks the proposals it is least sure about, you label them, and it
                     auto-labels (Resolve) or discards as background (Clear) everything it can now decide. The session stops
                     after the number of rounds you set; you can then spot-check its decisions and add rounds.
                  </Text>

                  {!ready && notReadyReason && (
                     <Alert color="yellow" icon={<IconAlertCircle size={16} />}>{notReadyReason}</Alert>
                  )}

                  <TagsInput
                     label="Classes"
                     description="The species or object classes you will label, in order. Background is always available."
                     placeholder="Type a class name and press Enter"
                     value={config.labels}
                     onChange={(v) => set("labels", v)}
                     splitChars={[","]}
                     clearable
                     required
                  />
                  {config.labels.length > 0 && (
                     <Group gap={6}>
                        <Badge color={classColor(0)} variant="light">0 · Background</Badge>
                        {config.labels.map((name, i) => (
                           <Badge key={name} color={classColor(i + 1)} variant="light">{i + 1} · {name}</Badge>
                        ))}
                     </Group>
                  )}

                  <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
                     <NumberInput label="Rounds" description="Review rounds before it stops" min={1} max={1000}
                        value={config.max_rounds} onChange={num("max_rounds")} />
                     <NumberInput label="Batch size" description="Proposals per round" min={1} max={1000}
                        value={config.batch_size} onChange={num("batch_size")} />
                     <NumberInput label="Calibration batch" description="Labelled once, first" min={2} max={5000}
                        value={config.calibration_size} onChange={num("calibration_size")} />
                     <NumberInput label="Seed" description="Same seed, same batches" min={0}
                        value={config.seed} onChange={num("seed")} />
                  </SimpleGrid>

                  <Group justify="flex-end">
                     <Button leftSection={<IconPlayerPlay size={16} />} loading={busy === "start"}
                        disabled={!ready || config.labels.length === 0 || busy !== null}
                        onClick={() => onStart(config)}>
                        Start session
                     </Button>
                  </Group>
                  {busy === "start" && (
                     <Text size="xs" c="dimmed" ta="right">
                        Copying the job outputs to the triage service and drawing the calibration batch. Large runs can take
                        a few minutes.
                     </Text>
                  )}
               </Stack>
            </Card>
         </Grid.Col>
         {record.triage_session_id && (
            <Grid.Col span={{ base: 12, md: 5 }}>
               <Card withBorder radius="md" p="lg" h="100%">
                  <Stack gap="sm" h="100%">
                     <Text fw={700} size="lg">Continue where you left off</Text>
                     <Text size="sm" c="dimmed">
                        This pipeline has a session in progress. Resume it to see the batch waiting for you. Starting a new
                        session discards it.
                     </Text>
                     {record.triage_config && (
                        <Text size="sm">
                           {record.triage_config.labels.length} classes · {record.triage_config.max_rounds} rounds ·{" "}
                           {record.triage_config.batch_size} per round
                        </Text>
                     )}
                     <Button mt="auto" leftSection={<IconPlugConnected size={16} />} onClick={onResume}
                        loading={busy === "resume"} disabled={busy !== null}>
                        Resume session
                     </Button>
                  </Stack>
               </Card>
            </Grid.Col>
         )}
      </Grid>
   );
}

// ── Session ───────────────────────────────────────────────────────────────────
function ConnectionBadge({ status }: { status: ConnectionStatus }) {
   const color = status === "open" ? "green" : status === "closed" ? "red" : "yellow";
   const label = status === "open" ? "Connected" : status === "reconnecting" ? "Reconnecting…" : status === "closed" ? "Disconnected" : "Connecting…";
   return <Badge color={color} variant="dot">{label}</Badge>;
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
   return (
      <Paper withBorder p="sm" radius="md">
         <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
         <Text fw={700} size="xl">{value}</Text>
         {hint && <Text size="xs" c="dimmed">{hint}</Text>}
      </Paper>
   );
}

function SessionStats({ state }: { state: SessionState }) {
   const calibrationLabels = state.calibrated ? state.config.calibration_size : 0;
   return (
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }}>
         <Stat
            label="Round"
            value={state.calibrated ? `${state.rounds_completed} / ${state.max_rounds}` : "Calibration"}
            hint={state.calibrated ? "completed of budget" : "label the calibration batch"}
         />
         <Stat label="Labelled by you" value={state.cumulative_reviews + calibrationLabels} />
         <Stat label="Auto-decided" value={state.auto_decided} hint="resolved or cleared" />
         <Stat label="Still deferred" value={state.remaining} hint="need a human" />
         <Stat
            label="Spot-check accuracy"
            value={pct(state.validation.accuracy)}
            hint={state.validation.checked ? `${state.validation.agreed}/${state.validation.checked} checked` : "not checked yet"}
         />
      </SimpleGrid>
   );
}

function RoundHistory({ state }: { state: SessionState }) {
   if (state.rounds.length === 0) return null;
   return (
      <Card withBorder radius="md" p="md">
         <Text fw={600} mb="xs">Rounds</Text>
         <Table striped highlightOnHover withTableBorder={false} verticalSpacing={4}>
            <Table.Thead>
               <Table.Tr>
                  <Table.Th>Round</Table.Th>
                  <Table.Th>You labelled</Table.Th>
                  <Table.Th>Auto-labelled</Table.Th>
                  <Table.Th>Cleared</Table.Th>
                  <Table.Th>Deferred after</Table.Th>
               </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
               {state.rounds.map((r) => (
                  <Table.Tr key={r.round}>
                     <Table.Td>{r.round}</Table.Td>
                     <Table.Td>{r.acquired}</Table.Td>
                     <Table.Td>{r.counts.resolve}</Table.Td>
                     <Table.Td>{r.counts.clear}</Table.Td>
                     <Table.Td>{r.remaining}</Table.Td>
                  </Table.Tr>
               ))}
            </Table.Tbody>
         </Table>
      </Card>
   );
}

function ValidationResultView({ summary, byDecision }: {
   summary: ValidationSummary;
   byDecision?: Record<"resolve" | "clear", { checked: number; agreed: number }>;
}) {
   if (!summary.checked) return null;
   return (
      <Alert color={(summary.accuracy ?? 0) >= 0.8 ? "green" : "orange"} variant="light" icon={<IconShieldCheck size={16} />}
         title={`Auto-decisions agreed with you on ${summary.agreed} of ${summary.checked} (${pct(summary.accuracy)})`}>
         <Stack gap={2}>
            {summary.ci95 && (
               <Text size="sm">95% range for the true accuracy: {pct(summary.ci95[0])} – {pct(summary.ci95[1])}.</Text>
            )}
            {byDecision && (
               <Text size="sm">
                  Auto-labelled: {byDecision.resolve.agreed}/{byDecision.resolve.checked} right · Cleared as background:{" "}
                  {byDecision.clear.agreed}/{byDecision.clear.checked} right.
               </Text>
            )}
            <Text size="sm" c="dimmed">
               Your corrections are used in the export. If the accuracy is too low, run more rounds and check again.
            </Text>
         </Stack>
      </Alert>
   );
}

function FinishedPanel({
   pipeId,
   token,
   state,
   socket,
   classes,
   images,
   view,
   context,
}: {
   pipeId: string;
   token: string;
   state: SessionState;
   socket: ReturnType<typeof useTriageSocket>;
   classes: LabelClass[];
   images: ImageStore;
   view: LabelingView;
   context: number;
}) {
   const [sample, setSample] = useState<number>(Math.min(50, Math.max(1, state.auto_decided)));
   const [more, setMore] = useState<number>(3);
   const [includeBackground, setIncludeBackground] = useState(false);
   const [exporting, setExporting] = useState<"download" | "save" | null>(null);
   const [exportNote, setExportNote] = useState<{ ok: boolean; text: string } | null>(null);

   const runExport = async (save: boolean) => {
      setExporting(save ? "save" : "download");
      setExportNote(null);
      const res = await exportTriage(pipeId, token, { includeBackground, save });
      setExporting(null);
      if (!res.ok || !res.data) {
         setExportNote({ ok: false, text: res.detail ?? "The export failed." });
         return;
      }
      if (save) setExportNote({ ok: true, text: `Saved to ${res.data.saved_path}` });
      else downloadFile(JSON.stringify(res.data.coco, null, 2), `protorcd_triage_${state.session_id}.coco.json`);
   };

   const reason =
      state.finish_reason === "pool_exhausted"
         ? "Every proposal has been labelled by you or decided automatically."
         : `The session used its budget of ${state.max_rounds} rounds.`;

   if (socket.validationBatch) {
      return (
         <Stack gap="sm">
            <Alert color="blue" variant="light" icon={<IconShieldCheck size={16} />} title="Spot check">
               These {socket.validationBatch.proposals.length} proposals were decided automatically. Label them as you
               normally would; the triage's answers are hidden so they cannot sway you.
            </Alert>
            <BatchLabeler
               view={view}
               batchKey={socket.validationBatch.validation_id}
               proposals={socket.validationBatch.proposals}
               classes={classes}
               images={images}
               context={context}
               submitting={socket.pending}
               submitLabel="Submit spot check"
               onSubmit={(labels) => socket.submitValidation(socket.validationBatch!.validation_id, labels)}
            />
         </Stack>
      );
   }

   return (
      <Stack gap="md">
         <Alert color="teal" variant="light" title="Rounds complete">{reason}</Alert>

         <Grid gutter="md">
            <Grid.Col span={{ base: 12, md: 6 }}>
               <Card withBorder radius="md" p="md" h="100%">
                  <Stack gap="sm">
                     <Text fw={700}>1. Check the automatic decisions</Text>
                     <Text size="sm" c="dimmed">
                        Label a random sample of auto-decided proposals to measure how often the triage is right.
                     </Text>
                     <ValidationResultView
                        summary={socket.validationResult?.cumulative ?? state.validation}
                        byDecision={socket.validationResult?.by_decision}
                     />
                     <Group align="flex-end">
                        <NumberInput label="Sample size" min={1} max={Math.max(1, state.auto_decided)} w={140}
                           value={sample} onChange={(v) => setSample(typeof v === "number" ? v : Number(v))} />
                        <Button leftSection={<IconShieldCheck size={16} />} onClick={() => socket.requestValidation(sample)}
                           disabled={state.auto_decided === 0} loading={socket.pending}>
                           Draw a sample
                        </Button>
                     </Group>
                  </Stack>
               </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
               <Card withBorder radius="md" p="md" h="100%">
                  <Stack gap="sm">
                     <Text fw={700}>2. Not good enough? Keep going</Text>
                     <Text size="sm" c="dimmed">
                        More rounds give the triage more examples. {state.remaining} proposals are still deferred.
                     </Text>
                     <Group align="flex-end">
                        <NumberInput label="Extra rounds" min={1} max={1000} w={140}
                           value={more} onChange={(v) => setMore(typeof v === "number" ? v : Number(v))} />
                        <Button leftSection={<IconPlus size={16} />} onClick={() => socket.extendRounds(more)}
                           disabled={!state.can_extend} loading={socket.pending}>
                           Run more rounds
                        </Button>
                     </Group>
                     {!state.can_extend && <Text size="xs" c="dimmed">Nothing is left to review.</Text>}
                  </Stack>
               </Card>
            </Grid.Col>
         </Grid>

         <ReviewCard pipeId={pipeId} token={token} sessionId={state.session_id} step={3} />

         <Card withBorder radius="md" p="md">
            <Stack gap="sm">
               <Text fw={700}>4. Or export the triage's labels as they are</Text>
               <Text size="sm" c="dimmed">
                  A COCO file of every labelled object: your labels first, then spot-check corrections, then the triage's
                  own decisions. Deferred proposals are left out.
               </Text>
               <Checkbox label="Include proposals labelled background" checked={includeBackground}
                  onChange={(e) => setIncludeBackground(e.currentTarget.checked)} />
               <Group>
                  <Button leftSection={<IconDownload size={16} />} onClick={() => runExport(false)}
                     loading={exporting === "download"} disabled={exporting !== null}>
                     Download COCO
                  </Button>
                  <Button variant="light" leftSection={<IconCloudUpload size={16} />} onClick={() => runExport(true)}
                     loading={exporting === "save"} disabled={exporting !== null}>
                     Save next to the embeddings on HPC
                  </Button>
               </Group>
               {exportNote && <Text size="sm" c={exportNote.ok ? "teal" : "red"}>{exportNote.text}</Text>}
            </Stack>
         </Card>
      </Stack>
   );
}

function LiveSession({
   pipeId,
   token,
   connection,
   inputs,
   onLeave,
}: {
   pipeId: string;
   token: string;
   connection: TriageConnection;
   /** Where the session's images live (crops are cut from them in the browser). */
   inputs: Pick<TriageInputs, "system" | "image_dir">;
   onLeave: () => void;
}) {
   const socket = useTriageSocket(connection.websocket_url);
   const state = socket.state ?? connection.state;
   const classes = useMemo(() => classesFromTaxonomy(state.labels), [state.labels]);
   const [context, setContext] = useState("0.25");
   const [view, setView] = useLabelingView();
   const images = useImageStore(pipeId, inputs.system, inputs.image_dir, token);

   const advancing = state.status === "advancing" || state.status === "restoring";
   const finished = !socket.batch && !!state.finish_reason && state.finish_reason !== "failed";

   return (
      <Stack gap="md">
         <Group justify="space-between">
            <Group gap="sm">
               <ConnectionBadge status={socket.connection} />
               <Badge variant="light">{state.status.replace("_", " ")}</Badge>
               <Text size="xs" c="dimmed" ff="monospace">session {state.session_id.slice(0, 8)}</Text>
            </Group>
            <Group gap="xs">
               <SegmentedControl size="xs" value={view} onChange={(v) => setView(v as LabelingView)}
                  data={[{ value: "images", label: "Images" }, { value: "crops", label: "Crops" }]} />
               {view === "crops" && (
                  <>
                     <Text size="xs" c="dimmed">Crop context</Text>
                     <SegmentedControl size="xs" value={context} onChange={setContext}
                        data={[{ value: "0", label: "Tight" }, { value: "0.25", label: "Some" }, { value: "0.75", label: "Wide" }]} />
                  </>
               )}
               <Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} onClick={socket.refreshState}>
                  Refresh
               </Button>
               <Button size="xs" variant="default" leftSection={<IconArrowLeft size={14} />} onClick={onLeave}>
                  Session settings
               </Button>
            </Group>
         </Group>

         <SessionStats state={state} />

         {socket.error && (
            <Alert color="red" variant="light" withCloseButton onClose={socket.clearError}
               icon={<IconAlertCircle size={16} />} title="The triage service refused that">
               {socket.error.message}
            </Alert>
         )}
         {state.status === "failed" && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="The session failed">
               The triage service stopped this session ({state.error ?? "unknown error"}). Start a new session from the
               session settings.
            </Alert>
         )}

         {socket.connection !== "open" && !socket.state ? (
            <Center h={240}><Loader /></Center>
         ) : advancing ? (
            <Card withBorder radius="md" p="xl">
               <Center>
                  <Stack align="center" gap="xs">
                     <Loader />
                     <Text fw={600}>
                        {state.calibrated ? "Updating prototypes and triaging the remaining proposals…" : "Calibrating the decision rule on your labels…"}
                     </Text>
                     <Text size="sm" c="dimmed">The next batch appears here when it is ready.</Text>
                  </Stack>
               </Center>
            </Card>
         ) : socket.batch ? (
            <Stack gap="sm">
               <Stack gap={2}>
                  <Title order={4}>
                     {socket.batch.phase === "calibration" ? "Calibration batch" : `Round ${socket.batch.round} of ${state.max_rounds}`}
                  </Title>
                  <Text size="sm" c="dimmed">
                     {socket.batch.phase === "calibration"
                        ? "A random sample that tunes how confident the triage must be before it decides on its own. Label each proposal with its class, or Background if it is not an object of interest."
                        : "The proposals the triage is least sure about. Your labels become new prototypes; everything it can then decide is removed from the pool."}
                  </Text>
               </Stack>
               <BatchLabeler
                  view={view}
                  batchKey={socket.batch.batch_id}
                  proposals={socket.batch.proposals}
                  classes={classes}
                  images={images}
                  context={Number(context)}
                  submitting={socket.pending}
                  submitLabel={socket.batch.phase === "calibration" ? "Submit calibration labels" : "Submit round"}
                  onSubmit={(labels) => socket.submitLabels(socket.batch!.batch_id, labels)}
               />
            </Stack>
         ) : finished ? (
            <FinishedPanel pipeId={pipeId} token={token} state={state} socket={socket} classes={classes}
               images={images} view={view} context={Number(context)} />
         ) : null}

         <RoundHistory state={state} />
      </Stack>
   );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ProtoRCDTriage() {
   const { id: pipeId = "" } = useParams();
   const navigate = useNavigate();
   const [cookie] = useCookies(["tapis-token"]);
   const token: string = cookie["tapis-token"]?.["access_token"] ?? "";

   const [record, setRecord] = useState<ProtoRCDRecord | null>(null);
   const [loadError, setLoadError] = useState<string | null>(null);
   const [connection, setConnection] = useState<TriageConnection | null>(null);
   const [busy, setBusy] = useState<"start" | "resume" | null>(null);
   const [setupError, setSetupError] = useState<string | null>(null);

   const [readiness, setReadiness] = useState<TriageReadiness | null>(null);

   const load = useCallback(async () => {
      if (!pipeId || !token) return;
      const res = await getProtoRCD(pipeId, token);
      if (res.ok && res.data) setRecord(res.data);
      else setLoadError(res.detail ?? "The pipeline's ProtoRCD settings could not be loaded.");
      const ready = await getTriageReadiness(pipeId, token);
      setReadiness(ready.ok && ready.data
         ? ready.data
         : { ready: false, inputs: null, problem: ready.detail ?? "Could not check the embedding jobs." });
   }, [pipeId, token]);

   useEffect(() => {
      load();
   }, [load]);

   const start = async (config: TriageConfig) => {
      if (record?.triage_session_id &&
         !window.confirm("Starting a new session discards the session in progress, including its labels. Continue?")) {
         return;
      }
      setBusy("start");
      setSetupError(null);
      const res = await startTriage(pipeId, config, token);
      setBusy(null);
      if (res.ok && res.data) {
         setConnection(res.data);
         load();
      } else setSetupError(res.detail ?? "The session could not be started.");
   };

   const resume = async () => {
      setBusy("resume");
      setSetupError(null);
      const res = await getTriage(pipeId, token);
      setBusy(null);
      if (res.ok && res.data) setConnection(res.data);
      else {
         setSetupError(res.detail ?? "The session could not be resumed.");
         if (res.status === 404) load();
      }
   };

   if (loadError) {
      return <Alert color="red" icon={<IconAlertCircle size={16} />} title="Could not load the pipeline">{loadError}</Alert>;
   }
   if (!record) {
      return <Center h="50vh"><Loader /></Center>;
   }

   const notReadyReason = !record.triage_service_configured
      ? "The triage service is not configured on this server, so sessions cannot be started. Ask an administrator to set TRIAGE_SERVICE_URL."
      : !readiness
         ? "Checking the embedding jobs…"
         : readiness.ready
            ? null
            : readiness.problem ?? "The embedding jobs have not finished.";
   // A running session keeps using the files it started with, even after newer embedding jobs finish.
   const sessionInputs = record.triage_config?.inputs ?? readiness?.inputs ?? null;

   return (
      <Stack gap="lg" maw={1600} mx="auto">
         <Group justify="space-between" align="flex-end">
            <Stack gap={4}>
               <Title order={2}>Human in the loop</Title>
               <Text c="dimmed" size="sm">Label what the triage cannot decide; it handles the rest.</Text>
            </Stack>
            {!connection && (
               <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={() => navigate(`/protorcd/configure/${pipeId}`)}>
                  Job configuration
               </Button>
            )}
         </Group>

         {setupError && (
            <Alert color="red" withCloseButton onClose={() => setSetupError(null)} icon={<IconAlertCircle size={16} />}>
               {setupError}
            </Alert>
         )}

         {connection && sessionInputs ? (
            <LiveSession pipeId={pipeId} token={token} connection={connection} inputs={sessionInputs}
               onLeave={() => { setConnection(null); load(); }} />
         ) : (
            <SessionSetup record={record} ready={!notReadyReason} notReadyReason={notReadyReason}
               onStart={start} onResume={resume} busy={busy} />
         )}
      </Stack>
   );
}
