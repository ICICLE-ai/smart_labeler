import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Grid,
  Group,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { IconInfoCircle } from "@tabler/icons-react";
import FormikTapisFileWrapper from "~/components/FileExplorer/FormikTapisFileWrapper";
import { Formik } from "formik";
import React, { useEffect, useRef, useState } from "react";
import { useCookies } from "react-cookie";
import { SubmitButton } from "~/components/formik-mantine";
import { HeroTitle } from "~/components/HeroTitle/HeroTitle";
import {
  isImageFile,
  QueryImageConfiguration,
  steps,
} from "~/components/ImageAnnotation/utils/utils";
import QueryImageConfigurationItem from "~/components/ObjectDetection/QueryImageConfigurationItem";
import {
  allowed_systems,
  fetchAndReturnData,
  SubmitData,
  getBaseURL,
  DEFAULT_SYSTEM,
} from "~/utils/utils";
import { ModelSelector } from "~/components/ModelSelector/ModelSelector";
import { usePipeline } from "~/context/PipelineContext";

interface FormValues {
  system: string;
  queryImagePath: string;
  objectnessThreshold: string;
  similarityThreshold: string;
  nmsIoUThreshold: string;
  device: string;
  outputDir: string;
  method: string;
  name: string;
}


const ConfigureDetectionJob: React.FC = () => {
  // Basic configuration state
  const [name, setName] = useState<string>("Predict objects");
  const [system, setSystem] = useState<string>(DEFAULT_SYSTEM);
  const [device, setDevice] = useState<string>("CPU");
  const [queryImagePath, setQueryImagePath] = useState<string>("");
  const [method, setMethod] = useState<string>("Image");
  const [outputDir, setOutputDir] = useState<string>("");

  // Model selection state - multi-select mode
  const [proposerModelIds, setProposerModelIds] = useState<string[]>([]);
  const [embedderModelIds, setEmbedderModelIds] = useState<string[]>([]);
  const [proposerModels, setProposerModels] = useState<any[]>([]);
  const [embedderModels, setEmbedderModels] = useState<any[]>([]);
  const [modelSource, setModelSource] = useState<"ours" | "patra">("ours");

  // Batch size and detection thresholds
  const [batchSize, setBatchSize] = useState<string>("4");
  const [objectnessThreshold, setObjectnessThreshold] =
    useState<string>("0.1");
  const [similarityThreshold, setSimilarityThreshold] =
    useState<string>("0.2");
  const [nmsIoUThreshold, setNmsIoUThreshold] = useState<string>("0.5");

  // SAHI settings
  const [enableSAHI, setEnableSAHI] = useState<boolean>(false);
  const [sahiTileSize, setSahiTileSize] = useState<string>("960");
  const [sahiOverlapRatio, setSahiOverlapRatio] = useState<string>("0.25");

  // HPC resource settings
  const [nodeCount, setNodeCount] = useState<string>("1");
  const [coresPerNode, setCoresPerNode] = useState<string>("8");
  const [memoryMB, setMemoryMB] = useState<string>("64800");
  const [maxMinutes, setMaxMinutes] = useState<string>("210");

  // Configuration history and pipeline state
  const [configurations, setConfigurations] = useState<
    QueryImageConfiguration[]
  >([]);
  const [currentConfigurationId, setCurrentConfigurationId] = useState<
    number | null
  >(null);
  const [objectDetectionId, setObjectDetectionId] = useState<number | null>(
    null
  );
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [detectionJobId, setDetectionJobId] = useState<string>("");
  const [isDemo, setIsDemo] = useState<boolean>(false);

  // UI references
  const formRef = useRef<any>(null);
  const navigate = useNavigate();
  const { notifyJobSubmitted } = usePipeline();
  const [cookie] = useCookies(["tapis-token"]);
  const { pipeid } = useLoaderData<{ pipeid: string }>();

  // Load configuration history
  useEffect(() => {
    const configurationHistory = async () => {
      try {
        const response = await fetchAndReturnData(
          `/get_all_query_image_configurations/${pipeid}`,
          cookie["tapis-token"]["access_token"]
        );
        if (response) {
          setConfigurations(response ?? []);
        }
      } catch (error) {
        console.error("Failed to fetch configuration history:", error);
      }
    };

    configurationHistory();
  }, [pipeid, cookie]);

  // Load object detection pipeline data
  useEffect(() => {
    fetchAndReturnData(
      `/get-object-detection-pipeline/${pipeid}`,
      cookie["tapis-token"]["access_token"]
    ).then((res) => {
      if (!res) {
        return;
      } else {
        const data: any = res;
        setCurrentConfigurationId(data["current_query_image_configuration"]);
        setObjectDetectionId(data["id"]);
        setDetectionJobId(data["query_image_configuration"]?.["detectionJobId"] || "");
        setIsDemo(data["is_demo"] || false);
      }
    });
  }, [pipeid, cookie]);

  // Fetch job status when detection job ID is available
  useEffect(() => {
    if (detectionJobId) {
      fetchAndReturnData(
        `/get_job_status/${detectionJobId}`,
        cookie["tapis-token"]["access_token"]
      ).then((res) => {
        if (res && res.status) {
          setJobStatus(res.status);
        }
      }).catch((err) => {
        console.error("Error fetching job status:", err);
      });
    }
  }, [detectionJobId, cookie]);

  // Load configuration when current configuration changes
  useEffect(() => {
    if (currentConfigurationId && configurations.length > 0) {
      const config = configurations.find(
        (cfg) => cfg.id === currentConfigurationId
      );
      if (config) {
        setObjectnessThreshold(String(config.objectnessThreshold));
        setSimilarityThreshold(String(config.similarityThreshold));
        setNmsIoUThreshold(String(config.nmsIoUThreshold));
        setQueryImagePath(config.queryImagePath);
        setMethod(config.method);
        setOutputDir(config.outputDir);
        setDevice(config.device);
        setSystem(config.system);
        formRef.current?.setFieldValue(
          "queryImagePath",
          config.queryImagePath
        );
        formRef.current?.setFieldValue("outputDir", config.outputDir);
        setEnableSAHI(config.is_sahi ?? false);
        setBatchSize(String(config.batch_size));
        if (config.is_sahi) {
          setSahiTileSize(String(config.tile_size) ?? "960");
          setSahiOverlapRatio(String(config.overlap_ratio) ?? "0.25");
        }
        
        // Load model IDs from preserved fields, fallback to parsing names if not available
        const proposerIds = config.proposer_ids 
          ? (config.proposer_ids ? (Array.isArray(config.proposer_ids) ? config.proposer_ids : String(config.proposer_ids).split(",").filter((id: string) => id.trim())) : []) : [];
        
        const embedderIds = config.embedder_ids 
          ? (config.embedder_ids ? (Array.isArray(config.embedder_ids) ? config.embedder_ids : String(config.embedder_ids).split(",").filter((id: string) => id.trim())) : []) : [];

        const proposerModels =  config.proposer_models ? config.proposer_models.split(",").filter((id: string) => id.trim()) : [];
        const embedderModels =  config.embedder_models ? config.embedder_models.split(",").filter((id: string) => id.trim()) : [];

        setProposerModelIds(proposerIds);
        setEmbedderModelIds(embedderIds);
        setProposerModels(proposerModels);
        setEmbedderModels(embedderModels);

        setName(config.name ?? "Predict objects");
        setNodeCount(String(config.node_count ?? 1));
        setCoresPerNode(String(config.cores_per_node ?? 8));
        setMemoryMB(String(config.memory_mb ?? 64800));
        setMaxMinutes(String(config.max_minutes ?? 210));
      }
    }
  }, [currentConfigurationId, configurations]);

  // Reset form to defaults
  const resetForm = () => {
    setName("Predict objects");
    setSystem(DEFAULT_SYSTEM);
    setDevice("CPU");
    setProposerModelIds([]);
    setEmbedderModelIds([]);
    setQueryImagePath("");
    setMethod("Image");
    setOutputDir("");
    setBatchSize("4");
    setObjectnessThreshold("0.1");
    setSimilarityThreshold("0.2");
    setNmsIoUThreshold("0.5");
    setEnableSAHI(false);
    setSahiTileSize("960");
    setSahiOverlapRatio("0.25");
    setNodeCount("1");
    setCoresPerNode("8");
    setMemoryMB("64800");
    setMaxMinutes("210");
    setCurrentConfigurationId(null);
    formRef.current?.resetForm();
  };

  // Handle form submission
  const handleSubmit = (values: FormValues): void => {
    if (isDemo) {
      notifyJobSubmitted();
      alert("Demo mode: Job simulated successfully. This pipeline is for demonstration purposes — no real job was submitted.");
      navigate(`/object-detection/detection/${pipeid}`);
      return;
    }

    if (proposerModelIds.length === 0 || embedderModelIds.length === 0) {
      alert("Please select at least one proposer and one embedder model.");
      return;
    }

    try {
      parseFloat(objectnessThreshold);
      parseFloat(similarityThreshold);
      parseFloat(nmsIoUThreshold);
      parseInt(batchSize);
      if (enableSAHI) {
        parseInt(sahiTileSize);
        parseFloat(sahiOverlapRatio);
      }
    } catch (error) {
      alert("Invalid numeric values provided");
      return;
    }

    const submitPayload: any = {
      od_id: objectDetectionId,
      queryImagePath: values.queryImagePath,
      system: system,
      proposer_ids: proposerModelIds.join(","),
      embedder_ids: embedderModelIds.join(","),
      device: device,
      outputDir: values.outputDir,
      method: method,
      objectnessThreshold: parseFloat(objectnessThreshold),
      similarityThreshold: parseFloat(similarityThreshold),
      nmsIoUThreshold: parseFloat(nmsIoUThreshold),
      batch_size: parseInt(batchSize),
      is_query_dir: isImageFile(values.queryImagePath) ? false : true,
      name: name,
      newPatra: true,
      node_count: parseInt(nodeCount),
      cores_per_node: parseInt(coresPerNode),
      memory_mb: parseInt(memoryMB),
      max_minutes: parseInt(maxMinutes),
    };

    if (enableSAHI) {
      submitPayload.is_sahi = true;
      submitPayload.tile_size = parseInt(sahiTileSize);
      submitPayload.overlap_ratio = parseFloat(sahiOverlapRatio) || 0.25;
    }

    SubmitData(
      `/object-detection/${pipeid}/${
        currentConfigurationId ? currentConfigurationId : 0
      }`,
      submitPayload,
      cookie["tapis-token"]["access_token"]
    )
      .then((res) => {
        if (!res) {
          alert("Failed to submit object detection job");
          return;
        }
        notifyJobSubmitted();
        alert("Object detection job submitted successfully");
        navigate(`/object-detection/detection/${pipeid}`);
      })
      .catch((err) => {
        console.error("Error submitting job:", err);
        alert("Failed to submit object detection job: " + (err?.message || "Unknown error"));
      });
  };

  // Handle configuration selection from history
  const handleConfigurationClick = (job: QueryImageConfiguration) => {
    setCurrentConfigurationId(job.id);
    if (isDemo) return;
    SubmitData(
      `/update_object_detection_entry/${pipeid}`,
      { current_query_image_configuration: job.id },
      cookie["tapis-token"]["access_token"]
    )
      .then((res) => {
        if (!res) {
          alert("Failed to set current query image configuration");
          return;
        }
        notifyJobSubmitted();
        alert("Current query image configuration set successfully");
      })
      .catch((err) => {
        console.error(err);
        alert("Failed to set current query image configuration");
      });
  };

  return (
    <Stack>
      {isDemo && (
        <Alert icon={<IconAlertCircle size={16} />} title="Demo Pipeline" color="yellow" variant="light">
          This is a demo pipeline for simulation and exploration only. Job submissions are simulated — no real compute jobs will be dispatched.
        </Alert>
      )}

      <HeroTitle
        title="Configure Detection Job"
        style={{ margin: "auto" }}
      />

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card
            shadow="md"
            padding="md"
            radius="md"
            withBorder
            style={{ width: "100%", height: "100%" }}
          >
            <Formik
              innerRef={formRef}
              initialValues={{
                system: "",
                queryImagePath: "",
                objectnessThreshold: "0.1",
                similarityThreshold: "0.2",
                nmsIoUThreshold: "0.5",
                device: "CPU",
                outputDir: "",
                method: "Image",
                name: "Predict objects",
              }}
              onSubmit={(values) => handleSubmit(values)}
            >
              {({ handleSubmit: formikSubmit }) => (
                <form onSubmit={formikSubmit} style={{ width: "100%" }}>
                  <Stack gap="md">
                    {/* Header */}
                    <Group justify="space-between">
                      <Text fw={700} size="lg">
                        Detection Job Configuration
                      </Text>
                      <Button
                        variant="light"
                        size="sm"
                        onClick={resetForm}
                      >
                        New Configuration
                      </Button>
                    </Group>

                    {/* Basic Settings */}
                    <TextInput
                      label="Job Name"
                      placeholder="Predict objects"
                      value={name}
                      onChange={(event) => setName(event.currentTarget.value)}
                    />

                    <Select
                      comboboxProps={{ withinPortal: true }}
                      data={allowed_systems}
                      label="Training System"
                      placeholder="Pick one Training System"
                      value={system}
                      defaultValue={DEFAULT_SYSTEM}
                      onChange={(value) => setSystem(value ?? "")}
                    />

                    <div className="tapis-file-field">
                      <FormikTapisFileWrapper
                        label="Query File Location"
                        required={false}
                        name="queryImagePath"
                        description="Enter full path to query file or directory"
                        placeholder="path to query location"
                        value={queryImagePath}
                        systemId={system}
                        disabled={!system}
                        files={false}
                        dirs={true}
                      />
                    </div>

                    <div className="tapis-file-field">
                      <FormikTapisFileWrapper
                        label="Output Directory"
                        required={false}
                        name="outputDir"
                        description="Enter full path to output directory"
                        placeholder="path to output directory"
                        value={outputDir}
                        systemId={system}
                        disabled={!system}
                        files={false}
                        dirs={true}
                      />
                    </div>

                    {/* Model Selection Section */}
                    <Paper
                      withBorder
                      p="md"
                      radius="md"
                      style={{
                        background:
                          "linear-gradient(135deg, #f8fbff 0%, #f0f7ff 100%)",
                      }}
                    >
                      <Stack gap="md">
                        <Text size="lg" fw={700}>
                          Model Selection
                        </Text>

                        {/* Proposer Model Selection */}
                        <Box>
                          <Text size="sm" fw={600} mb="sm">
                            Step 1: Select Proposer Model(s)
                          </Text>
                          <ModelSelector
                            selectedModelIds={proposerModelIds}
                            onModelSelect={(id) => setProposerModelIds([...proposerModelIds, id])}
                            onModelDeselect={(id) => setProposerModelIds(proposerModelIds.filter(m => m !== id))}
                            multiSelect={true}
                            filterList={["Segment Anything Model 3 (SAM 3)", "owlv2"]}
                            tapisToken={cookie["tapis-token"]["access_token"]}
                          />
                        </Box>

                        {/* Embedder Model Selection */}
                        <Box>
                          <Text size="sm" fw={600} mb="sm">
                            Step 2: Select Embedder Model(s)
                          </Text>
                          <ModelSelector
                            selectedModelIds={embedderModelIds}
                            onModelSelect={(id) => setEmbedderModelIds([...embedderModelIds, id])}
                            onModelDeselect={(id) => setEmbedderModelIds(embedderModelIds.filter(m => m !== id))}
                            multiSelect={true}
                            filterList={["OWLv2 Large Patch14 Ensemble", "DINOv3 ViT-S/16 (LVD-1689M Pretrained)", "BioCLIP 2 (via pybioclip)"]}
                            tapisToken={cookie["tapis-token"]["access_token"]}
                          />
                        </Box>
                      </Stack>
                    </Paper>

                    {/* Advanced Settings Section */}
                    <Paper
                      withBorder
                      p="md"
                      radius="md"
                      style={{ background: "#f9fafb" }}
                    >
                      <Stack gap="md">
                        <Text size="lg" fw={700}>
                          Advanced Settings
                        </Text>

                        <Group grow>
                          <TextInput
                            label="Batch Size"
                            placeholder="16"
                            value={batchSize}
                            onChange={(e) =>
                              setBatchSize(e.currentTarget.value)
                            }
                          />
                          <Select
                            data={["CPU", "CUDA"]}
                            label="Device"
                            value={device}
                            onChange={(v) => setDevice(v ?? "CPU")}
                          />
                          <Select
                            data={["Image", "Text", "RPN"]}
                            label="Method"
                            value={method}
                            onChange={(v) => setMethod(v ?? "Image")}
                          />
                        </Group>

                        <Checkbox
                          label="Enable SAHI (Slicing Aided Hyper Inference)"
                          checked={enableSAHI}
                          onChange={(e) =>
                            setEnableSAHI(prev => !prev)
                          }
                        />

                        {enableSAHI && (
                          <Group grow>
                            <TextInput
                              label="SAHI Tile Size (pixels)"
                              placeholder="512"
                              value={sahiTileSize}
                              onChange={(e) =>
                                setSahiTileSize(e.currentTarget.value)
                              }
                            />
                            <TextInput
                              label="SAHI Overlap Ratio"
                              placeholder="0.1"
                              value={sahiOverlapRatio}
                              onChange={(e) =>
                                setSahiOverlapRatio(e.currentTarget.value)
                              }
                              type="number"
                              step="0.01"
                              min="0"
                              max="1"
                            />
                          </Group>
                        )}
                      </Stack>
                    </Paper>

                    {/* Detection Thresholds Section */}
                    <Paper
                      withBorder
                      p="md"
                      radius="md"
                      style={{ background: "#f9fafb" }}
                    >
                      <Stack gap="md">
                        <Text size="lg" fw={700}>
                          Detection Thresholds
                        </Text>

                        <TextInput
                          label={
                            <Group align="center">
                              <Text>Objectness Threshold</Text>
                              <Tooltip label="Model confidence for detecting objects (0-1)">
                                <ActionIcon
                                  variant="transparent"
                                  size="xs"
                                >
                                  <IconInfoCircle size={14} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          }
                          placeholder="0.1"
                          value={objectnessThreshold}
                          onChange={(e) =>
                            setObjectnessThreshold(e.currentTarget.value)
                          }
                        />

                        <TextInput
                          label={
                            <Group align="center">
                              <Text>Similarity Threshold</Text>
                              <Tooltip label="Minimum match score to assign labels (0-1)">
                                <ActionIcon
                                  variant="transparent"
                                  size="xs"
                                >
                                  <IconInfoCircle size={14} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          }
                          placeholder="0.2"
                          value={similarityThreshold}
                          onChange={(e) =>
                            setSimilarityThreshold(e.currentTarget.value)
                          }
                        />

                        <TextInput
                          label={
                            <Group align="center">
                              <Text>NMS IoU Threshold</Text>
                              <Tooltip label="Filter overlapping bounding boxes (0-1)">
                                <ActionIcon
                                  variant="transparent"
                                  size="xs"
                                >
                                  <IconInfoCircle size={14} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          }
                          placeholder="0.5"
                          value={nmsIoUThreshold}
                          onChange={(e) =>
                            setNmsIoUThreshold(e.currentTarget.value)
                          }
                        />
                      </Stack>
                    </Paper>

                    {/* HPC Resource Settings */}
                    <Paper
                      withBorder
                      p="md"
                      radius="md"
                      style={{ background: "#f9fafb" }}
                    >
                      <Stack gap="md">
                        <Text size="lg" fw={700}>
                          HPC Resource Settings
                        </Text>
                        <Group grow>
                          <TextInput
                            label="Node Count"
                            placeholder="1"
                            value={nodeCount}
                            onChange={(e) => setNodeCount(e.currentTarget.value)}
                          />
                          <TextInput
                            label="Cores Per Node"
                            placeholder="8"
                            value={coresPerNode}
                            onChange={(e) => setCoresPerNode(e.currentTarget.value)}
                          />
                        </Group>
                        <Group grow>
                          <TextInput
                            label="Memory (MB)"
                            placeholder="64800"
                            value={memoryMB}
                            onChange={(e) => setMemoryMB(e.currentTarget.value)}
                          />
                          <TextInput
                            label="Max Minutes"
                            placeholder="210"
                            value={maxMinutes}
                            onChange={(e) => setMaxMinutes(e.currentTarget.value)}
                          />
                        </Group>
                      </Stack>
                    </Paper>

                    {/* Submit Button */}
                    <Group justify="flex-end" mt="lg">
                      <SubmitButton>Submit Detection Job</SubmitButton>
                    </Group>
                  </Stack>
                </form>
              )}
            </Formik>
          </Card>
        </Grid.Col>

        {/* Configuration History Sidebar */}
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card
            shadow="md"
            padding="md"
            radius="md"
            withBorder
            style={{ width: "100%", height: "100%" }}
          >
            <Stack gap="md" style={{ height: "100%" }}>
              <Box>
                <Text
                  fw={700}
                  size="lg"
                  mb="xs"
                  style={{
                    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  Saved Configurations
                </Text>
                <Text size="xs" c="dimmed">
                  Click to load previous configurations
                </Text>
              </Box>

              <ScrollArea
                style={{
                  maxHeight: "75vh",
                  flex: 1,
                }}
                type="scroll"
                offsetScrollbars
              >
                {configurations.length === 0 ? (
                  <Paper
                    p="lg"
                    radius="md"
                    withBorder
                    style={{
                      textAlign: "center",
                      background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
                    }}
                  >
                    <Stack gap="xs" align="center">
                      <Text size="sm" fw={500} c="dimmed">
                        No previous configurations found
                      </Text>
                      <Text size="xs" c="dimmed">
                        Create a new configuration to get started
                      </Text>
                    </Stack>
                  </Paper>
                ) : (
                  <Stack gap="xs" pr="xs">
                    {configurations.map((job) => (
                      <QueryImageConfigurationItem
                        key={job.id}
                        job={job}
                        clickHandler={handleConfigurationClick}
                        selected={currentConfigurationId === job.id}
                      />
                    ))}
                  </Stack>
                )}
              </ScrollArea>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
};

export default ConfigureDetectionJob;

export function clientLoader({ params }: any) {
   return { pipeid: params.id };
}
clientLoader.hydrate = true;