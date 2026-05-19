import { Paper, Typography, Box, Chip, Stack, Divider } from "@mui/material";
import { QueryImageConfiguration } from "../ImageAnnotation/utils";
import { blueGrey, blue, green, orange } from "@mui/material/colors";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

const QueryImageConfigurationItem = ({
   job,
   selected,
   clickHandler,
}: {
   job: QueryImageConfiguration;
   selected: boolean;
   clickHandler: (job: QueryImageConfiguration) => void;
}) => {
   const handleClick = () => {
      clickHandler(job);
   };

   const getFileName = (path: string) => {
      return path.lastIndexOf("/") !== -1
         ? path.substring(path.lastIndexOf("/") + 1)
         : path;
   };

   return (
      <Paper
         elevation={selected ? 6 : 1}
         onClick={handleClick}
         sx={{
            p: 2,
            m: 1,
            cursor: "pointer",
            transition: "all 0.3s ease",
            background: selected
               ? `linear-gradient(135deg, ${blue[50]} 0%, ${blue[100]} 100%)`
               : "#ffffff",
            border: selected ? `3px solid ${blue[500]}` : `1px solid ${blueGrey[200]}`,
            boxShadow: selected
               ? `0 8px 16px ${blue[200]}, 0 0 0 3px ${blue[100]}`
               : "0 2px 4px rgba(0,0,0,0.05)",
            "&:hover": {
               boxShadow: selected
                  ? `0 12px 20px ${blue[200]}`
                  : "0 8px 12px rgba(0,0,0,0.1)",
               transform: "translateY(-2px)",
            },
         }}
      >
         <Stack spacing={1.5}>
            {/* Header with name and selection indicator */}
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
               <Box sx={{ flex: 1 }}>
                  <Typography
                     variant="subtitle1"
                     sx={{
                        fontWeight: "bold",
                        color: selected ? blue[700] : blueGrey[800],
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: "0.95rem",
                     }}
                  >
                     {job.name || "Unnamed Configuration"}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                     Name: {job.name || "Object detection job"}
                  </Typography>
               </Box>
               {selected && (
                  <CheckCircleIcon sx={{ color: blue[500], fontSize: "1.5rem", ml: 1, flexShrink: 0 }} />
               )}
            </Box>

            <Divider sx={{ my: 0.5 }} />

            {/* Model Information */}
            <Box>
               <Typography variant="caption" sx={{ fontWeight: "600", color: blueGrey[700], display: "block", mb: 0.5 }}>
                  Models
               </Typography>
               <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                  {job.proposer_models && (
                     <Chip
                        label={`Proposer: ${String(job.proposer_models).substring(0, 20)}`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: "0.7rem" }}
                        color="primary"
                     />
                  )}
                  {job.embedder_models && (
                     <Chip
                        label={`Embedder: ${String(job.embedder_models).substring(0, 20)}`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: "0.7rem" }}
                        color="success"
                     />
                  )}
               </Box>
            </Box>

            {/* Detection Thresholds */}
            <Box>
               <Typography variant="caption" sx={{ fontWeight: "600", color: blueGrey[700], display: "block", mb: 0.5 }}>
                  Thresholds
               </Typography>
               <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                  <Typography variant="caption" display="block" sx={{ fontSize: "0.75rem" }}>
                     <strong>Objectness:</strong> {Number(job.objectnessThreshold).toFixed(2)}
                  </Typography>
                  <Typography variant="caption" display="block" sx={{ fontSize: "0.75rem" }}>
                     <strong>Similarity:</strong> {Number(job.similarityThreshold).toFixed(2)}
                  </Typography>
                  <Typography variant="caption" display="block" sx={{ fontSize: "0.75rem" }}>
                     <strong>NMS IoU:</strong> {Number(job.nmsIoUThreshold).toFixed(2)}
                  </Typography>
               </Box>
            </Box>

            {/* Advanced Settings */}
            <Box>
               <Typography variant="caption" sx={{ fontWeight: "600", color: blueGrey[700], display: "block", mb: 0.5 }}>
                  Settings
               </Typography>
               <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                  <Typography variant="caption" display="block" sx={{ fontSize: "0.75rem" }}>
                     <strong>Batch Size:</strong> {job.batch_size || 16}
                  </Typography>
                  <Typography variant="caption" display="block" sx={{ fontSize: "0.75rem" }}>
                     <strong>Device:</strong> {job.device || "CPU"}
                  </Typography>
                  <Typography variant="caption" display="block" sx={{ fontSize: "0.75rem" }}>
                     <strong>Method:</strong> {job.method || "Image"}
                  </Typography>
                  {job.is_sahi && (
                     <Chip
                        label="SAHI Enabled"
                        size="small"
                        variant="filled"
                        sx={{ fontSize: "0.7rem", height: "20px" }}
                        icon={<Box sx={{ fontSize: "0.7rem" }}>⚡</Box>}
                        color="warning"
                     />
                  )}
               </Box>
               {job.is_sahi && (
                  <Box sx={{ mt: 0.5, pl: 1, borderLeft: `2px solid ${orange[300]}` }}>
                     <Typography variant="caption" display="block" sx={{ fontSize: "0.7rem" }}>
                        SAHI Tile: {job.tile_size || 512}px, Overlap: {Number(job.overlap_ratio || 0.1).toFixed(2)}
                     </Typography>
                  </Box>
               )}
            </Box>
         </Stack>
      </Paper>
   );
};

export default QueryImageConfigurationItem;