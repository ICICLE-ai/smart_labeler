import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Container,
  Group,
  Loader,
  Modal,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconSearch, IconAlertCircle, IconEdit, IconInfoCircle, IconPlus, IconRocket, IconTrash, IconUpload, IconX, IconCheck, IconFile } from "@tabler/icons-react";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { Formik } from "formik";
import { useEffect, useRef, useState } from "react";
import { useCookies } from "react-cookie";
import FormikTapisFileWrapper from "~/components/FileExplorer/FormikTapisFileWrapper";
import { IndexAppShell } from "~/components/IndexAppShell";
import { useAppConfig } from "~/context/AppConfigContext";
import { DeleteData, fetchAndReturnData, SubmitData, TYPE, allowed_systems } from "~/utils/utils";

type Pipeline = {
  pid: string;
  name?: string;
  description?: string;
  slurm_account?: string;
  is_demo?: boolean;
  type?: string;
};

type FileUploadState = { progress: number; status: "idle" | "uploading" | "done" | "error" };

export default function DashBoardPage() {
  const loaded = useLoaderData<Pipeline[]>();
  const [pipelines, setPipelines] = useState<Pipeline[]>(loaded ?? []);
  const [loadingPipelines, setLoadingPipelines] = useState(!loaded || loaded.length === 0);
  const [pipelinesError, setPipelinesError] = useState(false);
  const [cookie] = useCookies(["tapis-token"]);
  const navigate = useNavigate();
  const { tapisBaseUrl } = useAppConfig();

  const token = cookie["tapis-token"]?.["access_token"] ?? "";

  const fetchPipelines = (silent = false) => {
    if (!token) {
      if (!silent) setLoadingPipelines(false);
      return;
    }
    if (!silent) setLoadingPipelines(true);
    setPipelinesError(false);
    fetchAndReturnData("/pipes", token)
      .then((res) => {
        if (res) {
          setPipelines(res);
        } else {
          setPipelinesError(true);
        }
      })
      .catch(() => setPipelinesError(true))
      .finally(() => setLoadingPipelines(false));
  };

  useEffect(() => {
    fetchPipelines();
  }, [token]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createSlurm, setCreateSlurm] = useState("");
  const [createType, setCreateType] = useState<TYPE>(TYPE.DETECTION);
  const [creating, setCreating] = useState(false);

  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameSlurm, setRenameSlurm] = useState("");
  const [renameDesc, setRenameDesc] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [createdPipeId, setCreatedPipeId] = useState<string | null>(null);

  // Upload state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadSystem, setUploadSystem] = useState<string>(allowed_systems[0]?.value ?? "");
  const [uploadItems, setUploadItems] = useState<{ file: File; relativePath: string }[]>([]);
  const [uploadStates, setUploadStates] = useState<Record<string, FileUploadState>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<"success" | "partial" | "error" | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const uploadFormRef = useRef<any>(null);

  useEffect(() => {
    if (createdPipeId) {
      navigate(`/annotation/image-annotator/${createdPipeId}`);
    }
  }, [createdPipeId]);

  // --- Upload helpers ---
  const addFiles = (incoming: FileList | File[], isDir = false) => {
    const next = Array.from(incoming).map((f: File) => ({
      file: f,
      relativePath: isDir && (f as any).webkitRelativePath ? (f as any).webkitRelativePath : f.name,
    }));
    setUploadItems((prev) => {
      const keys = new Set(prev.map((i) => i.relativePath));
      return [...prev, ...next.filter((i) => !keys.has(i.relativePath))];
    });
  };

  const removeUploadFile = (relativePath: string) => {
    setUploadItems((prev) => prev.filter((i) => i.relativePath !== relativePath));
    setUploadStates((prev) => { const s = { ...prev }; delete s[relativePath]; return s; });
  };

  const uploadSingleFile = ({ file, relativePath }: { file: File; relativePath: string }): Promise<void> =>
    new Promise((resolve, reject) => {
      const destPath = uploadFormRef.current?.values?.destPath?.trim().replace(/\/+$/, "") ?? "";
      const url = `${tapisBaseUrl}/v3/files/ops/${uploadSystem}/${destPath}/${relativePath}`;
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append("file", file);

      setUploadStates((p) => ({ ...p, [relativePath]: { progress: 0, status: "uploading" } }));

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded * 100) / e.total);
          setUploadStates((p) => ({ ...p, [relativePath]: { progress: pct, status: "uploading" } }));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setUploadStates((p) => ({ ...p, [relativePath]: { progress: 100, status: "done" } }));
          resolve();
        } else {
          setUploadStates((p) => ({ ...p, [relativePath]: { progress: 0, status: "error" } }));
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => {
        setUploadStates((p) => ({ ...p, [relativePath]: { progress: 0, status: "error" } }));
        reject(new Error("Network error"));
      };

      xhr.open("POST", url);
      xhr.setRequestHeader("X-Tapis-Token", token);
      xhr.send(fd);
    });

  const handleUpload = async () => {
    const destPath = uploadFormRef.current?.values?.destPath?.trim() ?? "";
    if (!uploadItems.length || !uploadSystem || !destPath) return;
    setIsUploading(true);
    setUploadResult(null);
    const results = await Promise.allSettled(uploadItems.map(uploadSingleFile));
    setIsUploading(false);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) setUploadResult("success");
    else if (succeeded === 0) setUploadResult("error");
    else setUploadResult("partial");
  };

  const openUpload = () => {
    setUploadItems([]);
    setUploadStates({});
    setUploadResult(null);
    setUploadSystem(allowed_systems[0]?.value ?? "");
    uploadFormRef.current?.resetForm?.();
    setUploadOpen(true);
  };

  const openCreate = () => {
    setCreateName("");
    setCreateDesc("");
    setCreateSlurm("");
    setCreateType(TYPE.DETECTION);
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!createName.trim() || !createSlurm.trim()) return;
    setCreating(true);
    let pipeId: string | null = null;
    try {
      const res = await SubmitData(`/pipe/create`, {
        name: createName.trim(),
        slurm: createSlurm.trim(),
        description: createDesc.trim(),
        type: createType,
      }, token);
      pipeId = res != null ? String(res) : null;
    } finally {
      setCreating(false);
      setCreateOpen(false);
      if (pipeId) {
        setCreatedPipeId(pipeId);
      } else {
        fetchPipelines(true);
      }
    }
  };

  const openRename = (p: Pipeline) => {
    setRenameId(p.pid);
    setRenameName(p.name ?? "");
    setRenameSlurm(p.slurm_account ?? "");
    setRenameDesc(p.description ?? "");
  };

  const handleRename = async (pid: string) => {
    if (!renameId || !renameName.trim()) return;
    setRenaming(true);
    try {
      await SubmitData(`/pipe/update/${pid}`, {
        name: renameName.trim(),
        slurmaccount: renameSlurm.trim(),
        description: renameDesc.trim(),
      }, token, "PUT");
    } finally {
      setRenaming(false);
      setRenameId(null);
      fetchPipelines(true);
    }
  };

  const handleDelete = async (pid: string) => {
    setDeletingId(pid);
    try {
      await DeleteData(`/pipe/delete/${pid}`, token);
    } finally {
      setDeletingId(null);
      fetchPipelines(true);
    }
  };

  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();

  const userPipelines = pipelines.filter((p) => !p.is_demo);
  const detectionPipelines = userPipelines.filter((p) => !p.type || p.type === TYPE.DETECTION);
  const segmentationPipelines = userPipelines.filter((p) => p.type === TYPE.SEGMENTATION);
  const demoPipelines = pipelines.filter((p) => p.is_demo);

  const filterBySearch = (list: Pipeline[]) =>
    q ? list.filter((p) => (p.name ?? "").toLowerCase().includes(q) || String(p.pid).includes(q)) : list;

  if (loadingPipelines) {
    return (
      <IndexAppShell>
        <Center h="60vh">
          <Loader size="lg" />
        </Center>
      </IndexAppShell>
    );
  }

  return (
    <IndexAppShell>
      <Container size="lg" mt="lg" mb="xl">
        {/* Header */}
        <Group justify="space-between" align="flex-end" mb="xl">
          <div>
            <Title order={1}>Pipelines</Title>
            <Text c="dimmed" mt={4}>
              Manage your Annotation pipelines
            </Text>
          </div>
          <Group gap="sm">
            <Button
              leftSection={<IconUpload size={16} />}
              onClick={openUpload}
              size="md"
              variant="light"
            >
              Upload Data
            </Button>
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={openCreate}
              size="md"
            >
              New Pipeline
            </Button>
          </Group>
        </Group>

        {/* Getting started guidance */}
        <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light" mb="lg">
          <Text size="sm" fw={500} mb={4}>Getting started</Text>
          <Text size="sm" c="dimmed">
            • Explore a <strong>demo pipeline</strong> (shown below) to try out the annotation workflow without any setup.
          </Text>
          <Text size="sm" c="dimmed">
            • Ready to annotate your own data? Click <strong>New Pipeline</strong> to create a pipeline.
          </Text>
          <Text size="sm" c="dimmed">
            • If your images are not yet on any cluster, use <strong>Upload Data</strong> to transfer files from your local machine to a Tapis storage system first.
          </Text>
        </Alert>

        {pipelinesError ? (
          <Alert color="red" variant="light" mb="md" title="Failed to load pipelines">
            <Text size="sm" mb="sm">
              Could not fetch your pipelines. This can happen if the server is warming up or there was a network error.
            </Text>
            <Button size="xs" variant="light" color="red" onClick={() => fetchPipelines()}>
              Retry
            </Button>
          </Alert>
        ) : (
          <Tabs defaultValue="detection" keepMounted={false}>
            <Tabs.List mb="md">
              <Tabs.Tab value="detection" rightSection={<Badge size="xs" variant="light">{detectionPipelines.length}</Badge>}>
                Detection
              </Tabs.Tab>
              <Tabs.Tab value="segmentation" rightSection={<Badge size="xs" variant="light">{segmentationPipelines.length}</Badge>}>
                Segmentation
              </Tabs.Tab>
              {demoPipelines.length > 0 && (
                <Tabs.Tab value="demo" rightSection={<Badge size="xs" variant="light" color="gray">{demoPipelines.length}</Badge>}>
                  Demo
                </Tabs.Tab>
              )}
            </Tabs.List>

            <TextInput
              leftSection={<IconSearch size={14} />}
              placeholder="Search pipelines by name or ID…"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              mb="md"
              style={{ maxWidth: 340 }}
            />

            <Tabs.Panel value="detection">
              {filterBySearch(detectionPipelines).length === 0 ? (
                <Card withBorder radius="md" p="xl" ta="center">
                  <Text c="dimmed" size="lg">{q ? "No matching pipelines." : "No detection pipelines yet."}</Text>
                  {!q && (
                    <Button leftSection={<IconPlus size={16} />} mt="md" onClick={openCreate}>New Pipeline</Button>
                  )}
                </Card>
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                  {filterBySearch(detectionPipelines).map((p) => (
                    <PipelineCard
                      key={p.pid}
                      pipeline={p}
                      onGo={() => navigate(`/object-detection/image-annotator/${p.pid}`)}
                      onRename={() => openRename(p)}
                      onDelete={() => handleDelete(p.pid)}
                      deleting={deletingId === p.pid}
                    />
                  ))}
                </SimpleGrid>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="segmentation">
              {filterBySearch(segmentationPipelines).length === 0 ? (
                <Card withBorder radius="md" p="xl" ta="center">
                  <Text c="dimmed" size="lg">{q ? "No matching pipelines." : "No segmentation pipelines yet."}</Text>
                  {!q && (
                    <Button leftSection={<IconPlus size={16} />} mt="md" onClick={openCreate}>New Pipeline</Button>
                  )}
                </Card>
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                  {filterBySearch(segmentationPipelines).map((p) => (
                    <PipelineCard
                      key={p.pid}
                      pipeline={p}
                      onGo={() => navigate(`/annotation/image-annotator/${p.pid}`)}
                      onRename={() => openRename(p)}
                      onDelete={() => handleDelete(p.pid)}
                      deleting={deletingId === p.pid}
                    />
                  ))}
                </SimpleGrid>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="demo">
              {filterBySearch(demoPipelines).length === 0 ? (
                <Card withBorder radius="md" p="xl" ta="center">
                  <Text c="dimmed" size="lg">No matching demo pipelines.</Text>
                </Card>
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                  {filterBySearch(demoPipelines).map((p) => (
                    <PipelineCard
                      key={p.pid}
                      pipeline={p}
                      onGo={() => navigate(`/object-detection/image-annotator/${p.pid}`)}
                      onRename={() => openRename(p)}
                      onDelete={() => handleDelete(p.pid)}
                      deleting={deletingId === p.pid}
                      readOnly
                    />
                  ))}
                </SimpleGrid>
              )}
            </Tabs.Panel>
          </Tabs>
        )}

        {/* Create Modal */}
        <Modal
          opened={createOpen}
          onClose={() => setCreateOpen(false)}
          title={<Title order={4}>New Pipeline</Title>}
          centered
          size="md"
        >
          <Stack gap="sm">
            <TextInput
              label="Pipeline Name"
              placeholder="e.g. my-detector"
              value={createName}
              onChange={(e) => setCreateName(e.currentTarget.value)}
              required
            />
            <TextInput
              label="SLURM Account"
              placeholder="e.g. PAS1234"
              value={createSlurm}
              onChange={(e) => setCreateSlurm(e.currentTarget.value)}
              required
            />
            <Select
              label="Pipeline Type"
              data={[
                { value: TYPE.DETECTION, label: "Detection" },
                { value: TYPE.SEGMENTATION, label: "Segmentation" },
              ]}
              value={createType}
              onChange={(v) => setCreateType((v as TYPE) ?? TYPE.DETECTION)}
              required
            />
            <Textarea
              label="Description"
              placeholder="What will this pipeline detect?"
              value={createDesc}
              onChange={(e) => setCreateDesc(e.currentTarget.value)}
              autosize
              minRows={2}
            />
            <Button
              mt="xs"
              onClick={handleCreate}
              loading={creating}
              disabled={!createName.trim() || !createSlurm.trim()}
              leftSection={<IconPlus size={16} />}
            >
              Create & Open
            </Button>
          </Stack>
        </Modal>

        {/* Rename Modal */}
        <Modal
          opened={!!renameId}
          onClose={() => setRenameId(null)}
          title={<Title order={4}>Edit Pipeline</Title>}
          centered
          size="md"
        >
          <Stack gap="sm">
            <TextInput
              label="Name"
              value={renameName}
              onChange={(e) => setRenameName(e.currentTarget.value)}
              required
            />
            <TextInput
              label="SLURM Account"
              placeholder="e.g. PAS1234"
              value={renameSlurm}
              onChange={(e) => setRenameSlurm(e.currentTarget.value)}
            />
            <Textarea
              label="Description"
              value={renameDesc}
              onChange={(e) => setRenameDesc(e.currentTarget.value)}
              autosize
              minRows={2}
            />
            <Button
              onClick={() => handleRename(renameId || "")}
              loading={renaming}
              disabled={!renameName.trim()}
            >
              Save
            </Button>
          </Stack>
        </Modal>

        {/* Upload Data Modal */}
        <Modal
          opened={uploadOpen}
          onClose={() => setUploadOpen(false)}
          title={<Title order={4}>Upload Data to Tapis</Title>}
          centered
          size="lg"
        >
          <Formik
            innerRef={uploadFormRef}
            initialValues={{ destPath: "" }}
            onSubmit={() => {}}
          >
            {({ values }) => (
              <Stack gap="md">
                <Select
                  label="Target System"
                  data={allowed_systems}
                  value={uploadSystem}
                  onChange={(v) => setUploadSystem(v ?? "")}
                  required
                />
                <FormikTapisFileWrapper
                  name="destPath"
                  label="Destination Path"
                  description="Directory on the target system where files will be uploaded"
                  systemId={uploadSystem}
                  dirs={true}
                  files={false}
                  disabled={!uploadSystem}
                  required
                />

                {/* Drop zone */}
                <Box
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
                  }}
                  style={{
                    border: `2px dashed ${dragOver ? "#228be6" : "#ced4da"}`,
                    borderRadius: 8,
                    padding: "20px 16px",
                    textAlign: "center",
                    background: dragOver ? "#e7f5ff" : "#f8f9fa",
                    transition: "all 0.15s ease",
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => { if (e.target.files) addFiles(e.target.files); }}
                  />
                  <input
                    ref={dirInputRef}
                    type="file"
                    multiple
                    style={{ display: "none" }}
                    {...{ webkitdirectory: "" } as any}
                    onChange={(e) => { if (e.target.files) addFiles(e.target.files, true); }}
                  />
                  <IconUpload size={28} color="#868e96" style={{ marginBottom: 6 }} />
                  <Text size="sm" c="dimmed" mb="xs">Drag & drop files here, or</Text>
                  <Group justify="center" gap="xs">
                    <Button size="xs" variant="light" onClick={() => fileInputRef.current?.click()}>
                      Select Files
                    </Button>
                    <Button size="xs" variant="light" onClick={() => dirInputRef.current?.click()}>
                      Select Directory
                    </Button>
                  </Group>
                </Box>

                {uploadResult === "success" && (
                  <Alert icon={<IconCheck size={16} />} color="green" variant="light">
                    All {uploadItems.length} file{uploadItems.length > 1 ? "s" : ""} uploaded successfully.
                  </Alert>
                )}
                {uploadResult === "partial" && (
                  <Alert icon={<IconAlertCircle size={16} />} color="orange" variant="light">
                    Some files failed to upload. Check the list below for details.
                  </Alert>
                )}
                {uploadResult === "error" && (
                  <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
                    Upload failed. Please check your connection and destination path, then try again.
                  </Alert>
                )}

                <Button
                  leftSection={<IconUpload size={16} />}
                  onClick={handleUpload}
                  loading={isUploading}
                  disabled={!uploadItems.length || !uploadSystem || !values.destPath.trim() || isUploading || uploadResult !== null}
                >
                  Upload {uploadItems.length > 0 ? `${uploadItems.length} file${uploadItems.length > 1 ? "s" : ""}` : ""}
                </Button>

                {/* File list with progress */}
                {uploadItems.length > 0 && (
                  <Stack gap="xs">
                    {uploadItems.map(({ file, relativePath }) => {
                      const state = uploadStates[relativePath];
                      const status = state?.status ?? "idle";
                      return (
                        <Box
                          key={relativePath}
                          style={{
                            border: "1px solid #dee2e6",
                            borderRadius: 6,
                            padding: "8px 10px",
                          }}
                        >
                          <Group justify="space-between" mb={status === "uploading" ? 4 : 0}>
                            <Group gap="xs" style={{ flex: 1, minWidth: 0 }}>
                              <IconFile size={14} color="#868e96" />
                              <Text size="sm" truncate style={{ flex: 1 }}>{relativePath}</Text>
                              <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                                {(file.size / 1024).toFixed(1)} KB
                              </Text>
                            </Group>
                            <Group gap={4}>
                              {status === "done" && <IconCheck size={14} color="green" />}
                              {status === "error" && <Text size="xs" c="red">failed</Text>}
                              {status !== "uploading" && (
                                <ActionIcon
                                  size="xs"
                                  variant="subtle"
                                  color="gray"
                                  onClick={() => removeUploadFile(relativePath)}
                                >
                                  <IconX size={12} />
                                </ActionIcon>
                              )}
                            </Group>
                          </Group>
                          {status === "uploading" && (
                            <Progress value={state.progress} size="xs" animated />
                          )}
                        </Box>
                      );
                    })}
                  </Stack>
                )}
              </Stack>
            )}
          </Formik>
        </Modal>
      </Container>
    </IndexAppShell>
  );
}

function PipelineCard({
  pipeline,
  onGo,
  onRename,
  onDelete,
  deleting,
  readOnly = false,
}: {
  pipeline: Pipeline;
  onGo: () => void;
  onRename: (pipelineId: string) => void;
  onDelete: (pipelineId: string) => void;
  deleting: boolean;
  readOnly?: boolean;
}) {
  return (
    <Card withBorder radius="md" padding="lg" style={{ display: "flex", flexDirection: "column" }}>
      <Group justify="space-between" align="flex-start" mb="xs">
        <Text fw={600} size="md" style={{ flex: 1 }}>
          {pipeline.name ?? `Pipeline ${pipeline.pid}`}
        </Text>
        {!readOnly && (
          <Group gap={4}>
            <Tooltip label="Rename">
              <ActionIcon variant="subtle" size="sm" onClick={() => onRename(pipeline.pid)}>
                <IconEdit size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Delete">
              <ActionIcon
                variant="subtle"
                size="sm"
                color="red"
                loading={deleting}
                onClick={() => onDelete(pipeline.pid)}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      </Group>

      <Text size="xs" c="dimmed" ff="monospace" mb="xs">
        ID: {pipeline.pid}
      </Text>

      {pipeline.description && (
        <Text size="sm" c="dimmed" mb="xs" lineClamp={2}>
          {pipeline.description}
        </Text>
      )}

      <Group gap="xs" mb="md" mt="auto">
        {pipeline.slurm_account && (
          <Badge variant="light" size="sm">
            {pipeline.slurm_account}
          </Badge>
        )}
        {pipeline.is_demo && (
          <Badge variant="outline" color="gray" size="sm">
            demo
          </Badge>
        )}
      </Group>

      <Button
        fullWidth
        leftSection={<IconRocket size={16} />}
        onClick={onGo}
        variant="light"
      >
        Open Pipeline
      </Button>
    </Card>
  );
}

export function clientLoader() {
  return [];
}
clientLoader.hydrate = true;
