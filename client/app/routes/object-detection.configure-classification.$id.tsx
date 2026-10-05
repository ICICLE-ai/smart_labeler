import {
    Card,
    Group,
    Select,
    Stack,
    TextInput,
    Tooltip,
    ActionIcon,
    Text,
    Box,
    Paper,
    Alert,
    Button,
    ScrollArea,
    Checkbox,
    Grid,
    Divider,
    MultiSelect,
    Loader,
    Badge,
} from "@mantine/core";
import { IconInfoCircle, IconAlertCircle, IconTrash, IconPlus } from "@tabler/icons-react";
import { data, useLoaderData, useNavigate } from "@remix-run/react";
import { Formik } from "formik";
import React, { useEffect, useState } from "react";
import { useCookies } from "react-cookie";
import { SubmitButton } from "~/components/formik-mantine";
import { HeroTitle } from "~/components/HeroTitle/HeroTitle";
import { isImageFile, steps } from "~/components/ImageAnnotation/utils/utils";
import { allowed_systems, DEFAULT_SYSTEM, describeJobFailure, fetchAndReturnData, SubmitData, SubmitJob } from "~/utils/utils";
import { ModelSelector } from "~/components/ModelSelector/ModelSelector";
import { usePipeline } from "~/context/PipelineContext";

interface ClassificationConfig {
    id?: number;
    name: string;
    system: string;
    embedder_model_id: string;
    similarity_threshold: number;
    class_support_paths: string[];
    proposal_tensor_paths: string[];
}

interface ProposalClassMapping {
    proposal_tensor_file: string;
    class_support_file: string;
}

const ConfigureClassification: React.FC = () => {
    const [name, setName] = useState<string>("Classify objects");
    const [system, setSystem] = useState<string>(DEFAULT_SYSTEM);
    const [embedderModelId, setEmbedderModelId] = useState<string>("");
    const [similarityThreshold, setSimilarityThreshold] = useState<number>(0.5);
    const [proposalMappings, setProposalMappings] = useState<ProposalClassMapping[]>([]);
    const [proposalOutputDir, setProposalOutputDir] = useState<string>("");
    const [classSupportOutputDir, setClassSupportOutputDir] = useState<string>("");

    const [classFileOptions, setClassFileOptions] = useState<{ label: string; value: string }[]>([]);
    const [proposalFileOptions, setProposalFileOptions] = useState<{ label: string; value: string }[]>([]);
    const [loadingClassFiles, setLoadingClassFiles] = useState(false);
    const [loadingProposalFiles, setLoadingProposalFiles] = useState(false);

    const [configurations, setConfigurations] = useState<ClassificationConfig[]>([]);
    const [currentConfigurationId, setCurrentConfigurationId] = useState<string | null>(null);
    const [jobStatus, setJobStatus] = useState<string | null>(null);
    const [classificationJobId, setClassificationJobId] = useState<string>("");
    const [isDemo, setIsDemo] = useState<boolean>(false);
    const [pipelineData, setPipelineData] = useState<any>(null);
    const [queryDir, setQueryDir] = useState<string>("");
    const [model_ids, setModelIds] = useState<string>("");
    const [model_names, setModelNames] = useState<string>("");
    const [odId, setOdId] = useState<string>("");
    const [outputDir, setOutputDir] = useState<string>("");
    const [objectnessThreshold, setObjectnessThreshold] = useState<number>(0.5);

    const formRef = React.useRef<any>(null);
    const navigate = useNavigate();
    const [cookie] = useCookies(["tapis-token"]);
    const { pipeid } = useLoaderData<{ pipeid: string }>();

    const { notifyJobSubmitted } = usePipeline();


    // Fetch files from a directory
    const fetchFilesFromDir = async (dirPath: string, setOptions: any, setLoading: any) => {
        if (!dirPath || !system) {
            return;
        }
        setLoading(true);
        try {
            const encodedPath = encodeURIComponent(dirPath);
            const res = await fetchAndReturnData(
                `/get_files/${pipeid}/${system}?dir=${encodedPath}`,
                cookie["tapis-token"]["access_token"]
            );

            if (res && res.files && Array.isArray(res.files)) {
                const fileList = res.files
                    .filter((f: any) => typeof f === "string")
                    .map((f: string) => {
                        const fullPath = f.replace("tapis:/", "").replace(/^\//, "");
                        const fileName = fullPath.split("/").pop() || fullPath;
                        return {
                            label: fileName,
                            value: `/${fullPath}`,
                        };
                    });
                console.log(`Fetched files from ${dirPath}:`, fileList);    
                setOptions(fileList);
            }
        } catch (error) {
            console.error("Error fetching files:", error);
        } finally {
            setLoading(false);
        }
    };

    // Load pipeline data
    useEffect(() => {
        fetchAndReturnData(
            `/get-object-detection-pipeline/${pipeid}`,
            cookie["tapis-token"]["access_token"]
        ).then((res) => {
            if (res) {
                setPipelineData(res);
                setSystem(res["system"] || DEFAULT_SYSTEM);
                setClassSupportOutputDir(res["outputDir"] || "");
                setOdId(res["id"] || "");
                setOutputDir(res["outputDir"] || "");

                const queryConfig = res["query_image_configuration"];
                if (queryConfig) {
                    setCurrentConfigurationId(queryConfig["id"] || "");
                    // This job's own name. `name` on the configuration belongs to
                    // the proposal job that created it, so reading it here would
                    // show the wrong job's name back to the user.
                    setName(queryConfig["classification_name"] || "Classify objects");
                    setProposalOutputDir(queryConfig["outputDir"] || "");
                    setQueryDir(queryConfig["queryImagePath"] || "");
                    setSystem(queryConfig["system"] || DEFAULT_SYSTEM);
                    setModelIds(queryConfig["embedder_ids"] || "");
                    setModelNames(queryConfig["embedder_models"] || "");
                    setSimilarityThreshold(queryConfig["similarityThreshold"] ? queryConfig["similarityThreshold"] : 0.5);
                    setObjectnessThreshold(queryConfig["objectnessThreshold"] ? queryConfig["objectnessThreshold"] : 0.5);
                    setOutputDir(queryConfig["outputDir"] || "");
                    const proposalMappings: ProposalClassMapping[] = [];
                    const proposalPaths: string[] = queryConfig["proposal_tensor_paths"] ? queryConfig["proposal_tensor_paths"].split(" ") : [];
                    const classSupportPaths: string[] = queryConfig["class_support_paths"] ? queryConfig["class_support_paths"].split(" ") : [];
                    
                    proposalPaths.forEach((proposalPath: string, index: number) => {
                        proposalMappings.push({
                            proposal_tensor_file: proposalPath,
                            class_support_file: classSupportPaths[index] || ""
                        });
                    });
                    setProposalMappings(proposalMappings);
                }
                setIsDemo(res["is_demo"] || false);
                setClassificationJobId(res["generate_class_supports_job_id"] || "");
            } else {
                alert(
                    "Failed to fetch object detection pipeline. Make sure to complete previous steps first."
                );
            }
        });
    }, [pipeid, cookie]);

    // Fetch class support files when classSupportOutputDir changes
    useEffect(() => {
        if (classSupportOutputDir && system) {
            const classDir = `${classSupportOutputDir}/class_supports/tensors`;
            fetchFilesFromDir(classDir, setClassFileOptions, setLoadingClassFiles);
        }
    }, [classSupportOutputDir, system]);

    // Fetch proposal tensor files when proposalOutputDir changes
    useEffect(() => {
        if (proposalOutputDir && system) {
            const proposalDir = `${proposalOutputDir}/proposals/tensors`;
            fetchFilesFromDir(proposalDir, setProposalFileOptions, setLoadingProposalFiles);
        }
    }, [proposalOutputDir, system]);

    // Fetch job status
    useEffect(() => {
        if (!classificationJobId) return;
        const TERMINAL = new Set(["FINISHED", "FAILED", "CANCELLED", "STOPPED", "BLOCKED"]);
        const token = cookie["tapis-token"]["access_token"];

        const fetchStatus = async () => {
            try {
                const res = await fetchAndReturnData(`/get_job_status/${classificationJobId}`, token);
                if (res?.status) setJobStatus(res.status);
                return res?.status as string | undefined;
            } catch (err) {
                console.error("Error fetching job status:", err);
            }
        };

        fetchStatus();
        const intervalId = setInterval(async () => {
            const status = await fetchStatus();
            if (status && TERMINAL.has(status)) clearInterval(intervalId);
        }, 10000);

        return () => clearInterval(intervalId);
    }, [classificationJobId]);

    const resetForm = () => {
        setName("Classify objects");
        setSystem(DEFAULT_SYSTEM);
        setEmbedderModelId("");
        setSimilarityThreshold(0.5);
        setProposalMappings([]);
        setCurrentConfigurationId(null);
        formRef.current?.resetForm();
    };

    /**
     * Readiness of the mapping list, so the section can say what is missing
     * before the user hits Submit and gets an alert instead.
     */
    const mappingStatus = React.useMemo(() => {
        const seen = new Map<string, number>();
        const duplicates = new Set<number>();
        proposalMappings.forEach((m, i) => {
            if (!m.proposal_tensor_file) return;
            const first = seen.get(m.proposal_tensor_file);
            if (first === undefined) seen.set(m.proposal_tensor_file, i);
            else { duplicates.add(first); duplicates.add(i); }
        });
        const usable = proposalMappings.reduce(
            (n, m, i) =>
                n + (m.proposal_tensor_file && m.class_support_file && !duplicates.has(i) ? 1 : 0), 0);
        return {
            duplicates,
            incomplete: proposalMappings.length - usable,
            complete: usable,
        };
    }, [proposalMappings]);

    /** The generated files arrive only once the upstream jobs finish. */
    const filesPending = proposalFileOptions.length === 0 || classFileOptions.length === 0;

    const addProposalMapping = () => {
        setProposalMappings((prev) => [...prev, { proposal_tensor_file: "", class_support_file: "" }]);
    };

    const removeProposalMapping = (index: number) => {
        setProposalMappings((prev) => prev.filter((_, i) => i !== index));
    };

    // Replace the row rather than writing into it: the spread above is shallow,
    // so the old objects are the same ones the previous state holds and editing
    // them in place mutates state React believes it already rendered.
    const updateProposalTensorFile = (index: number, proposalFile: string) => {
        setProposalMappings((prev) =>
            prev.map((m, i) => (i === index ? { ...m, proposal_tensor_file: proposalFile } : m))
        );
    };

    const updateClassSupportFiles = (index: number, classFile: string) => {
        setProposalMappings((prev) =>
            prev.map((m, i) => (i === index ? { ...m, class_support_file: classFile } : m))
        );
    };

    const handleSubmit = async (values: any): Promise<void> => {
        if (isDemo) {
            alert("Demo mode: Job simulated successfully. This pipeline is for demonstration purposes — no real job was submitted.");
            navigate(`/object-detection/classification/${pipeid}`);
            return;
        }

        if (proposalMappings.length === 0) {
            alert("Please add at least one proposal tensor file with associated class support files.");
            return;
        }

        // Validate all mappings have both proposal and class files. The row
        // numbers are included so the user knows which ones to go and fix.
        const incompleteRows = proposalMappings
            .map((m, i) => (!m.proposal_tensor_file || !m.class_support_file ? i + 1 : 0))
            .filter(Boolean);
        if (incompleteRows.length > 0) {
            alert(
                `Every mapping needs both a proposal tensor and a class support file.\n\n` +
                `Incomplete: mapping ${incompleteRows.join(", ")}.`
            );
            return;
        }

        // Shares its reasoning with the inline warning, so the form never says
        // one thing on the page and another in the alert.
        if (mappingStatus.duplicates.size > 0) {
            alert(
                "The same proposal tensor is mapped more than once. " +
                "Each proposal should appear in a single row."
            );
            return;
        }

        try {
            const threshold = similarityThreshold;
            if (isNaN(threshold) || threshold < 0 || threshold > 1) {
                throw new Error("Similarity threshold must be between 0 and 1");
            }
        } catch (error) {
            alert((error as Error).message);
            return;
        }

        const submitPayload = {
            id: currentConfigurationId,
            name: name,
            system: system,
            queryImagePath: queryDir,
            outputDir: outputDir,
            similarityThreshold: similarityThreshold,
            class_support_paths: proposalMappings.map((m) => m.class_support_file).join(" "),
            proposal_tensor_paths: proposalMappings.map((m) => m.proposal_tensor_file).join(" "),
            is_query_dir: !isImageFile(queryDir),
            objectnessThreshold: objectnessThreshold,
        };

        try {
            const res = await SubmitJob(
                `/object-classification/${pipeid}/${odId || 0}`,
                submitPayload,
                cookie["tapis-token"]["access_token"]
            );
            if (!res.ok) {
                // Nothing was queued, so neither announce it nor move the user
                // on to the step that waits for a job that does not exist.
                alert(describeJobFailure("The classification job", res));
                return;
            }
            notifyJobSubmitted();
            alert("Classification configuration submitted successfully");
            navigate(`/object-detection/classification/${pipeid}`);
        } catch (err) {
            console.error(err);
            alert(`The classification job was NOT submitted.\n\n${err instanceof Error ? err.message : String(err)}`);
        }
    };

    return (
        <Stack gap="lg" px="md" pb="xl">
            {isDemo && (
                <Alert icon={<IconAlertCircle size={16} />} title="Demo Pipeline" color="yellow" variant="light">
                    This is a demo pipeline for simulation and exploration only. Job submissions are simulated — no real compute jobs will be dispatched.
                </Alert>
            )}
            {jobStatus && (
                <Alert icon={<IconInfoCircle />} title="Classification Job Status" color="blue">
                    Current Status: <strong>{jobStatus}</strong> {classificationJobId && `(Job ID: ${classificationJobId})`}
                </Alert>
            )}

            <Stack gap={4} align="center">
                <HeroTitle title={`Configure Classification`} style={{ margin: "auto" }} />
                <Text size="sm" c="dimmed" ta="center">
                    Configure classification parameters with embedder model, thresholds, and file paths.
                </Text>
            </Stack>

            <Card
                shadow="md"
                padding="xl"
                radius="lg"
                withBorder
                style={{
                    width: "100%",
                    maxWidth: 1000,
                    margin: "auto",
                    background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
                }}
            >
                <Formik
                    innerRef={formRef}
                    initialValues={{
                        name: "Classify objects",
                        system: "",
                    }}
                    onSubmit={async (values) => { await handleSubmit(values); }}
                >
                    <form style={{ width: "100%" }}>
                        <Stack gap="lg">
                            {/* Basic Settings */}
                            <Box>
                                <Text fw={700} size="lg" mb="md">
                                    Basic Settings
                                </Text>
                                <Stack gap="md">
                                    <TextInput
                                        label="Job Name"
                                        placeholder="Classify objects"
                                        value={name}
                                        onChange={(event) => {
                                            setName(event.currentTarget.value);
                                        }}
                                    />

                                    <Select
                                        comboboxProps={{ withinPortal: true }}
                                        data={allowed_systems}
                                        label="System"
                                        placeholder="Pick one System"
                                        value={system}
                                        onChange={(value) => setSystem(value ?? "")}
                                        disabled
                                    />
                                </Stack>
                            </Box>

                            <Divider />

                            <Divider />

                            {/* Similarity Threshold */}
                            <Box>
                                <Group justify="space-between" mb="xs">
                                    <Text fw={700} size="lg">
                                        Similarity Threshold
                                    </Text>
                                    <Tooltip label="Threshold for feature similarity matching (0-1)">
                                        <ActionIcon variant="transparent">
                                            <IconInfoCircle size={16} />
                                        </ActionIcon>
                                    </Tooltip>
                                </Group>
                                <TextInput
                                    type="number"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={similarityThreshold}
                                    onChange={(e) => setSimilarityThreshold(parseFloat(e.currentTarget.value))}
                                    description="Value between 0 and 1 for matching threshold"
                                />
                            </Box>

                            {/* Objectness Threshold */}
                            <Box>
                                <Group justify="space-between" mb="xs">
                                    <Text fw={700} size="lg">
                                        Objectness Threshold
                                    </Text>
                                    <Tooltip label="Threshold for proposal confidence (0-1)">
                                        <ActionIcon variant="transparent">
                                            <IconInfoCircle size={16} />
                                        </ActionIcon>
                                    </Tooltip>
                                </Group>
                                <TextInput
                                    type="number"
                                    // placeholder="0.5"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={objectnessThreshold}
                                    onChange={(e) => setObjectnessThreshold(parseFloat(e.currentTarget.value))}
                                    description="Value between 0 and 1 for matching threshold"
                                />
                            </Box>

                            <Divider />

                            {/* Proposal Tensor & Class Support Mapping */}
                            <Box>
                                <Group justify="space-between" align="flex-start" mb="xs" wrap="wrap">
                                    <Box style={{ minWidth: 240, flex: 1 }}>
                                        <Group gap="xs" align="center">
                                            <Text fw={700} size="lg">
                                                Proposal &amp; Class Support Mapping
                                            </Text>
                                            {proposalMappings.length > 0 && (
                                                <Badge variant="light" color={mappingStatus.incomplete ? "orange" : "teal"}>
                                                    {mappingStatus.complete} of {proposalMappings.length} ready
                                                </Badge>
                                            )}
                                        </Group>
                                        <Text size="xs" c="dimmed" mt={2}>
                                            Each proposal tensor is classified against one class support tensor.
                                            Pair them up below — add a row for every proposal you want classified.
                                        </Text>
                                    </Box>
                                    <Button
                                        leftSection={<IconPlus size={16} />}
                                        onClick={addProposalMapping}
                                        variant="light"
                                    >
                                        Add Mapping
                                    </Button>
                                </Group>

                                {filesPending && (
                                    <Alert
                                        icon={<IconInfoCircle size={16} />}
                                        color="blue"
                                        variant="light"
                                        mb="sm"
                                    >
                                        {proposalFileOptions.length === 0 && classFileOptions.length === 0
                                            ? "Neither the proposal tensors nor the class support tensors are available yet. They appear here once those jobs finish."
                                            : proposalFileOptions.length === 0
                                                ? "No proposal tensor files yet — they appear here once the proposal generation job finishes."
                                                : "No class support tensor files yet — they appear here once the class support job finishes."}
                                    </Alert>
                                )}

                                {mappingStatus.duplicates.size > 0 && (
                                    <Alert
                                        icon={<IconAlertCircle size={16} />}
                                        color="orange"
                                        variant="light"
                                        mb="sm"
                                    >
                                        The same proposal tensor is mapped more than once. Each proposal should
                                        appear in a single row.
                                    </Alert>
                                )}

                                {proposalMappings.length === 0 ? (
                                    <Paper
                                        p="xl"
                                        radius="md"
                                        style={{
                                            textAlign: "center",
                                            border: "1px dashed var(--mantine-color-gray-4)",
                                            background: "var(--mantine-color-gray-0)",
                                        }}
                                    >
                                        <Text size="sm" fw={600}>No mappings yet</Text>
                                        <Text size="xs" c="dimmed" mt={4}>
                                            Use <b>Add Mapping</b> above to pair your first proposal tensor
                                            with the class support tensor it should be classified against.
                                        </Text>
                                    </Paper>
                                ) : (
                                    <Stack gap="sm">
                                        {proposalMappings.map((mapping, index) => {
                                            const ready = !!mapping.proposal_tensor_file && !!mapping.class_support_file;
                                            const duplicated = mappingStatus.duplicates.has(index);
                                            const borderColor = duplicated
                                                ? "var(--mantine-color-orange-4)"
                                                : ready
                                                    ? "var(--mantine-color-teal-3)"
                                                    : "var(--mantine-color-gray-3)";
                                            return (
                                                <Paper
                                                    key={index}
                                                    p="md"
                                                    radius="md"
                                                    style={{ border: `1px solid ${borderColor}`, background: "#fff" }}
                                                >
                                                    <Group justify="space-between" mb="xs" wrap="nowrap">
                                                        <Group gap="xs" align="center" wrap="nowrap">
                                                            <Badge
                                                                circle
                                                                variant={ready && !duplicated ? "filled" : "light"}
                                                                color={duplicated ? "orange" : ready ? "teal" : "gray"}
                                                            >
                                                                {index + 1}
                                                            </Badge>
                                                            <Text size="sm" fw={600}>
                                                                {/* A duplicated row is not ready, whatever is filled in. */}
                                                                {duplicated
                                                                    ? "Duplicate proposal"
                                                                    : ready ? "Ready" : "Needs both files"}
                                                            </Text>
                                                        </Group>
                                                        <Tooltip label="Remove this mapping">
                                                            <ActionIcon
                                                                color="red"
                                                                variant="subtle"
                                                                aria-label={`Remove mapping ${index + 1}`}
                                                                onClick={() => removeProposalMapping(index)}
                                                            >
                                                                <IconTrash size={16} />
                                                            </ActionIcon>
                                                        </Tooltip>
                                                    </Group>

                                                    {/* Both halves of the pair side by side, so what maps to what
                                                        is readable without opening anything. Stacks when narrow. */}
                                                    <Grid gutter="sm" align="flex-start">
                                                        <Grid.Col span={{ base: 12, sm: 6 }}>
                                                            {loadingProposalFiles ? (
                                                                <Group justify="center" py="md"><Loader size="sm" /></Group>
                                                            ) : (
                                                                <Select
                                                                    label="Proposal tensor"
                                                                    placeholder={proposalFileOptions.length === 0
                                                                        ? "Not available yet"
                                                                        : "Select proposal tensor file"}
                                                                    data={proposalFileOptions}
                                                                    value={mapping.proposal_tensor_file}
                                                                    onChange={(value) => updateProposalTensorFile(index, value || "")}
                                                                    disabled={proposalFileOptions.length === 0}
                                                                    error={duplicated ? "Already mapped" : undefined}
                                                                    searchable
                                                                    clearable
                                                                    comboboxProps={{ withinPortal: true }}
                                                                    maxDropdownHeight={200}
                                                                />
                                                            )}
                                                        </Grid.Col>
                                                        <Grid.Col span={{ base: 12, sm: 6 }}>
                                                            {loadingClassFiles ? (
                                                                <Group justify="center" py="md"><Loader size="sm" /></Group>
                                                            ) : (
                                                                <Select
                                                                    label="Classified against"
                                                                    placeholder={classFileOptions.length === 0
                                                                        ? "Not available yet"
                                                                        : "Select class support file"}
                                                                    data={classFileOptions}
                                                                    value={mapping.class_support_file}
                                                                    onChange={(value) => updateClassSupportFiles(index, value || "")}
                                                                    disabled={classFileOptions.length === 0}
                                                                    searchable
                                                                    clearable
                                                                    comboboxProps={{ withinPortal: true }}
                                                                    maxDropdownHeight={200}
                                                                />
                                                            )}
                                                        </Grid.Col>
                                                    </Grid>
                                                </Paper>
                                            );
                                        })}
                                    </Stack>
                                )}
                            </Box>

                            {/* Submit Buttons */}
                            <Group justify="flex-end" mt="xl">
                                <Button
                                    variant="light"
                                    onClick={resetForm}
                                >
                                    Reset
                                </Button>
                                <SubmitButton>Submit Job</SubmitButton>
                            </Group>
                        </Stack>
                    </form>
                </Formik>
            </Card>
        </Stack>
    );
};

export default ConfigureClassification;

export function clientLoader({ params }: any) {
   return { pipeid: params.id };
}
clientLoader.hydrate = true;
