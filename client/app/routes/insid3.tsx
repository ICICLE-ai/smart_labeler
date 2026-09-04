import { useEffect, useMemo, useState } from "react";
import { useCookies } from "react-cookie";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { IndexAppShell } from "~/components/IndexAppShell";
import {
  getBaseURL,
  insid3Predictions,
  type Insid3Response,
} from "~/utils/utils";

const FileButton = ({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) => (
  <Button variant="outlined" component="label" fullWidth sx={{ justifyContent: "flex-start" }}>
    {file ? `${label}: ${file.name}` : label}
    <input
      hidden
      type="file"
      accept="image/*"
      onChange={(event) => onChange(event.target.files?.[0] ?? null)}
    />
  </Button>
);

export default function Insid3LabPage() {
  const [cookie] = useCookies(["tapis-token"]);
  const token = cookie["tapis-token"]?.["access_token"] ?? "";
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referenceMask, setReferenceMask] = useState<File | null>(null);
  const [targetImage, setTargetImage] = useState<File | null>(null);
  const [label, setLabel] = useState("object");
  const [minArea, setMinArea] = useState(64);
  const [maxObjects, setMaxObjects] = useState(100);
  const [result, setResult] = useState<Insid3Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [serviceStatus, setServiceStatus] = useState<
    "checking" | "ready" | "unavailable"
  >("checking");

  const targetUrl = useMemo(
    () => (targetImage ? URL.createObjectURL(targetImage) : ""),
    [targetImage],
  );

  useEffect(() => {
    return () => {
      if (targetUrl) URL.revokeObjectURL(targetUrl);
    };
  }, [targetUrl]);

  useEffect(() => {
    if (!token) {
      setServiceStatus("unavailable");
      return;
    }
    const controller = new AbortController();
    fetch(`${getBaseURL()}/insid3/health`, {
      headers: { "Tapis-Token": token },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) =>
        setServiceStatus(payload?.model_loaded ? "ready" : "unavailable"),
      )
      .catch((requestError) => {
        if (requestError?.name !== "AbortError") setServiceStatus("unavailable");
      });
    return () => controller.abort();
  }, [token]);

  const runPrediction = async () => {
    if (!referenceImage || !referenceMask || !targetImage) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const prediction = await insid3Predictions(
        {
          referenceImage,
          referenceMask,
          targetImage,
          label,
          minArea,
          maxObjects,
        },
        token,
      );
      setResult(prediction);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "INSID3 prediction failed.",
      );
    } finally {
      setLoading(false);
    }
  };

  const downloadResult = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "insid3-result.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <IndexAppShell>
      <Box sx={{ py: 4 }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="h4" fontWeight={700}>
            INSID3 Similar-Object Lab
          </Typography>
          <Typography color="text.secondary">
            Upload a reference image, its binary mask, and a target image.
            INSID3 will find target regions that match the masked reference.
          </Typography>
          <Box>
            <Chip
              size="small"
              color={serviceStatus === "ready" ? "success" : "default"}
              label={
                serviceStatus === "checking"
                  ? "Checking INSID3 service…"
                  : serviceStatus === "ready"
                    ? "INSID3 service ready"
                    : "INSID3 service unavailable"
              }
            />
          </Box>
        </Stack>

        {!token && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Log in to Smart Labeler before using the INSID3 service.
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Card variant="outlined">
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h6">Inputs</Typography>
                  <FileButton
                    label="Choose reference image"
                    file={referenceImage}
                    onChange={setReferenceImage}
                  />
                  <FileButton
                    label="Choose reference mask"
                    file={referenceMask}
                    onChange={setReferenceMask}
                  />
                  <FileButton
                    label="Choose target image"
                    file={targetImage}
                    onChange={(file) => {
                      setTargetImage(file);
                      setResult(null);
                    }}
                  />
                  <Divider />
                  <TextField
                    label="Object label"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    fullWidth
                  />
                  <TextField
                    label="Minimum component area"
                    type="number"
                    value={minArea}
                    inputProps={{ min: 1, step: 1 }}
                    onChange={(event) =>
                      setMinArea(Math.max(1, Number(event.target.value)))
                    }
                    fullWidth
                  />
                  <TextField
                    label="Maximum objects"
                    type="number"
                    value={maxObjects}
                    inputProps={{ min: 1, max: 1000, step: 1 }}
                    onChange={(event) =>
                      setMaxObjects(
                        Math.min(1000, Math.max(1, Number(event.target.value))),
                      )
                    }
                    fullWidth
                  />
                  <Button
                    variant="contained"
                    size="large"
                    disabled={
                      loading ||
                      !token ||
                      !referenceImage ||
                      !referenceMask ||
                      !targetImage ||
                      !label.trim()
                    }
                    onClick={runPrediction}
                  >
                    {loading ? (
                      <>
                        <CircularProgress size={20} color="inherit" sx={{ mr: 1 }} />
                        Running INSID3…
                      </>
                    ) : (
                      "Find Similar Objects"
                    )}
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            <Card variant="outlined">
              <CardContent>
                <Stack spacing={2}>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 2,
                    }}
                  >
                    <Typography variant="h6">Target preview</Typography>
                    {result && (
                      <Stack direction="row" spacing={1}>
                        <Chip
                          size="small"
                          color="primary"
                          label={`${result.object_count} object${
                            result.object_count === 1 ? "" : "s"
                          }`}
                        />
                        <Button size="small" onClick={downloadResult}>
                          Download JSON
                        </Button>
                        {result.mask_png_base64 && (
                          <Button
                            size="small"
                            component="a"
                            href={`data:image/png;base64,${result.mask_png_base64}`}
                            download="insid3-mask.png"
                          >
                            Download mask
                          </Button>
                        )}
                      </Stack>
                    )}
                  </Box>
                  {targetUrl ? (
                    <Box
                      sx={{
                        position: "relative",
                        display: "inline-block",
                        alignSelf: "flex-start",
                        maxWidth: "100%",
                        lineHeight: 0,
                        bgcolor: "#111",
                      }}
                    >
                      <Box
                        component="img"
                        src={targetUrl}
                        alt="INSID3 target"
                        sx={{ display: "block", maxWidth: "100%", height: "auto" }}
                      />
                      {result && (
                        <Box
                          component="svg"
                          viewBox={`0 0 ${result.width} ${result.height}`}
                          preserveAspectRatio="none"
                          sx={{
                            position: "absolute",
                            inset: 0,
                            width: "100%",
                            height: "100%",
                            pointerEvents: "none",
                          }}
                        >
                          {result.objects.map((object) => (
                            <g key={object.id}>
                              <polygon
                                points={object.points
                                  .map((point) => `${point.x},${point.y}`)
                                  .join(" ")}
                                fill="rgba(0, 255, 80, 0.22)"
                                stroke="#00ff50"
                                strokeWidth="3"
                                vectorEffect="non-scaling-stroke"
                              />
                              <rect
                                x={object.bbox.x}
                                y={object.bbox.y}
                                width={object.bbox.width}
                                height={object.bbox.height}
                                fill="none"
                                stroke="#ffeb3b"
                                strokeWidth="2"
                                vectorEffect="non-scaling-stroke"
                              />
                            </g>
                          ))}
                        </Box>
                      )}
                    </Box>
                  ) : (
                    <Box
                      sx={{
                        minHeight: 360,
                        display: "grid",
                        placeItems: "center",
                        bgcolor: "#f5f5f5",
                        border: "1px dashed #bbb",
                        borderRadius: 1,
                      }}
                    >
                      <Typography color="text.secondary">
                        Select a target image to preview it here.
                      </Typography>
                    </Box>
                  )}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>
    </IndexAppShell>
  );
}
