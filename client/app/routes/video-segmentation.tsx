import { Outlet, useMatches, useNavigate } from "@remix-run/react";
import { Box, Chip, IconButton, Tooltip, Typography } from "@mui/material";
import HomeIcon from "@mui/icons-material/Home";
import VideoFileIcon from "@mui/icons-material/VideoFile";

export default function VideoSegmentationLayout() {
   const matches = useMatches();
   const navigate = useNavigate();
   const childMatch = matches[matches.length - 1];
   const id = childMatch?.params?.id;

   return (
      <Box sx={{ width: "100%", display: "flex", flexDirection: "column", minHeight: "100vh", bgcolor: "#fafafa" }}>
         {id && (
            <Box
               sx={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1100,
                  width: "100%",
                  bgcolor: "background.paper",
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
               }}
            >
               <Box
                  sx={{
                     display: "flex",
                     flexDirection: "row",
                     alignItems: "center",
                     px: 1,
                     py: 0.75,
                     gap: 1,
                     minHeight: 52,
                  }}
               >
                  <Tooltip title="Dashboard" placement="bottom">
                     <IconButton
                        onClick={() => navigate("/dashboard")}
                        size="small"
                        sx={{
                           flexShrink: 0,
                           bgcolor: "action.hover",
                           borderRadius: "8px",
                           "&:hover": { bgcolor: "action.selected" },
                        }}
                     >
                        <HomeIcon fontSize="small" />
                     </IconButton>
                  </Tooltip>

                  <Box sx={{ flexShrink: 0, width: "1px", height: 28, bgcolor: "divider" }} />

                  <Chip
                     icon={
                        <Box sx={{ color: "#4527a0 !important", display: "flex", alignItems: "center" }}>
                           <VideoFileIcon sx={{ fontSize: 16 }} />
                        </Box>
                     }
                     label={
                        <Typography
                           sx={{ fontSize: "0.78rem", fontWeight: 700, whiteSpace: "nowrap", color: "#fff" }}
                        >
                           Video Segmentation & Tracking
                        </Typography>
                     }
                     variant="outlined"
                     sx={{
                        height: 34,
                        borderRadius: "999px",
                        borderWidth: 2,
                        borderStyle: "solid",
                        borderColor: "#4527a0",
                        bgcolor: "#4527a0",
                        "& .MuiChip-label": { px: 1 },
                        "& .MuiChip-icon": { ml: "8px", mr: 0 },
                        boxShadow: "0 0 0 3px #b39ddb",
                        flexShrink: 0,
                     }}
                  />
               </Box>
            </Box>
         )}
         <Box sx={{ flex: 1, overflow: "auto", bgcolor: "background.default" }}>
            <Outlet />
         </Box>
      </Box>
   );
}
