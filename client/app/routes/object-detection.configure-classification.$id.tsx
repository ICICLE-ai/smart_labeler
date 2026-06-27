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
    Accordion,
} from "@mantine/core";
import { IconInfoCircle, IconAlertCircle, IconTrash, IconPlus } from "@tabler/icons-react";
import { data, useLoaderData, useNavigate } from "@remix-run/react";
import { Formik } from "formik";
import React, { useEffect, useState } from "react";
import { useCookies } from "react-cookie";
import { SubmitButton } from "~/components/formik-mantine";
import { HeroTitle } from "~/components/HeroTitle/HeroTitle";
import { isImageFile, steps } from "~/components/ImageAnnotation/utils";
import { allowed_systems, DEFAULT_SYSTEM, fetchAndReturnData, SubmitData } from "~/utils/utils";
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
    const [name, setName] = useState<string>("Classification Job");
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
        setName("Classification Job");
        setSystem(DEFAULT_SYSTEM);
        setEmbedderModelId("");
        setSimilarityThreshold(0.5);
        setProposalMappings([]);
        setCurrentConfigurationId(null);
        formRef.current?.resetForm();
    };

    const addProposalMapping = () => {
        setProposalMappings([...proposalMappings, { proposal_tensor_file: "", class_support_file: "" }]);
    };

    const removeProposalMapping = (index: number) => {
        setProposalMappings(proposalMappings.filter((_, i) => i !== index));
    };

    const updateProposalTensorFile = (index: number, proposalFile: string) => {
        const updated = [...proposalMappings];
        updated[index].proposal_tensor_file = proposalFile;
        setProposalMappings(updated);
    };

    const updateClassSupportFiles = (index: number, classFile: string) => {
        const updated = [...proposalMappings];
        updated[index].class_support_file = classFile;
        setProposalMappings(updated);
    };

    const handleSubmit = (values: any): void => {
        if (isDemo) {
            alert("Demo mode: Job simulated successfully. This pipeline is for demonstration purposes — no real job was submitted.");
            navigate(`/object-detection/classification/${pipeid}`);
            return;
        }

        if (proposalMappings.length === 0) {
            alert("Please add at least one proposal tensor file with associated class support files.");
            return;
        }

        // Validate all mappings have both proposal and class files
        const invalidMappings = proposalMappings.filter(
            (m) => !m.proposal_tensor_file || !m.class_support_file
        );

        if (invalidMappings.length > 0) {
            alert("All mappings must have a proposal tensor file and at least one class support file.");
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

        SubmitData(
            `/object-classification/${pipeid}/${odId || 0}`,
            submitPayload,
            cookie["tapis-token"]["access_token"]
        )
            .then((res) => {
                if (!res) {
                    alert("Failed to submit classification configuration");
                    return;
                }
                notifyJobSubmitted();
                alert("Classification configuration submitted successfully");
                navigate(`/object-detection/classification/${pipeid}`);
            })
            .catch((err) => {
                console.error(err);
                alert("Failed to submit classification configuration");
            });
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
                        name: "Classification Job",
                        system: "",
                    }}
                    onSubmit={(values) => handleSubmit(values)}
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
                                        placeholder="Classification Job"
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
                                <Group justify="space-between" mb="md">
                                    <Box>
                                        <Text fw={700} size="lg">
                                            Proposal & Class Support Mapping
                                        </Text>
                                        <Text size="xs" c="dimmed">
                                            Associate class support files with each proposal tensor file
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

                                {proposalMappings.length === 0 ? (
                                    <Paper
                                        p="lg"
                                        radius="md"
                                        withBorder
                                        style={{
                                            textAlign: "center",
                                            background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
                                        }}
                                    >
                                        <Text size="sm" c="dimmed">
                                            No mappings yet. Click "Add Proposal" to create the first mapping.
                                        </Text>
                                    </Paper>
                                ) : (
                                    <Accordion defaultValue={proposalMappings.length > 0 ? "0" : null}>
                                        {proposalMappings.map((mapping, index) => {
                                            const proposalFileName = mapping.proposal_tensor_file
                                                ? mapping.proposal_tensor_file.split("/").pop()
                                                : "Select file";
                                            const classSupportFile = mapping.class_support_file
                                                ? mapping.class_support_file.split("/").pop()
                                                : "Select file";

                                            return (
                                                <Accordion.Item key={index} value={String(index)}>
                                                    <Accordion.Control>
                                                        <Group justify="space-between" style={{ width: "100%" }}>
                                                            <Box style={{ flex: 1 }}>
                                                                <Text fw={600}>{proposalFileName}</Text>
                                                                <Text fw={600}>{classSupportFile}</Text>
                                                            </Box>
                                                            <ActionIcon
                                                                color="red"
                                                                variant="light"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    removeProposalMapping(index);
                                                                }}
                                                            >
                                                                <IconTrash size={16} />
                                                            </ActionIcon>
                                                        </Group>
                                                    </Accordion.Control>

                                                    <Accordion.Panel>
                                                        <Stack gap="md">
                                                            <Box>
                                                                <Text size="sm" fw={600} mb="xs">
                                                                    Proposal Tensor File
                                                                </Text>
                                                                {loadingProposalFiles ? (
                                                                    <Group justify="center" py="md">
                                                                        <Loader size="sm" />
                                                                    </Group>
                                                                ) : proposalFileOptions.length === 0 ? (
                                                                    <Text size="xs" c="dimmed">⏳ Job still in progress — files will appear once processing completes.</Text>
                                                                ) : (
                                                                    <Select
                                                                        placeholder="Select proposal tensor file"
                                                                        data={proposalFileOptions}
                                                                        value={mapping.proposal_tensor_file}
                                                                        onChange={(value) =>
                                                                            updateProposalTensorFile(index, value || "")
                                                                        }
                                                                        searchable
                                                                        clearable
                                                                        maxDropdownHeight={200}
                                                                    />
                                                                )}
                                                            </Box>

                                                            <Box>
                                                                <Text size="sm" fw={600} mb="xs">
                                                                    Associated Class Support File
                                                                </Text>
                                                                {loadingClassFiles ? (
                                                                    <Group justify="center" py="md">
                                                                        <Loader size="sm" />
                                                                    </Group>
                                                                ) : classFileOptions.length === 0 ? (
                                                                    <Text size="xs" c="dimmed">⏳ Job still in progress — files will appear once processing completes.</Text>
                                                                ) : (
                                                                    <Select
                                                                        placeholder="Select class support files"
                                                                        data={classFileOptions}
                                                                        value={mapping.class_support_file}
                                                                        onChange={(value) =>
                                                                            updateClassSupportFiles(index, value || "")
                                                                        }
                                                                        searchable
                                                                        clearable
                                                                        maxDropdownHeight={200}
                                                                    />
                                                                )}
                                                            </Box>
                                                        </Stack>
                                                    </Accordion.Panel>
                                                </Accordion.Item>
                                            );
                                        })}
                                    </Accordion>
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
