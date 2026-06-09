import {
   Typography,
   Paper,
   Drawer,
   Box,
   List,
   ListItemText,
   Grid,
   Button,
   ListItem,
   IconButton,
   Tooltip,
   Slider,
   Alert,
   Menu,
   MenuItem,
   ListItemIcon,
   CircularProgress,
   Backdrop,
} from "@mui/material";
import ImageIcon from "@mui/icons-material/Image";
import ArrowLeftIcon from "@mui/icons-material/ArrowLeft";
import ArrowRightIcon from "@mui/icons-material/ArrowRight";
import DataObjectIcon from "@mui/icons-material/DataObject";
import ArticleIcon from "@mui/icons-material/Article";
import { replace, useLoaderData } from "@remix-run/react";
import React, { useEffect, useMemo, useRef } from "react";
import {
   Annotation,
   ImageCanvas,
} from "~/components/ImageAnnotation/ImageCanvas";
import {
   fetchAndReturnData,
   // fetchFile,
   SubmitData,
   getImage,
   getFile
} from "~/utils/utils";
import { useCookies } from "react-cookie";
import {
   FileAnnotations,
   generateJson,
   importFromDefaultJsonUtil,
   isImageFile,
   QueryImageConfiguration,
   steps,
} from "~/components/ImageAnnotation/utils";
import QueryImageConfigurationItem from "~/components/ObjectDetection/QueryImageConfigurationItem";
import { FileExplorer } from "~/components/ImageAnnotation/FileExplorer";

const Classification: React.FC = () => {
   const [boundingBoxes, setBoundingBoxes] = React.useState<Annotation[]>([]);
   const [system, setSystem] = React.useState<string>("expanse-tapis");
   const [selectedFile, setSelectedFile] = React.useState<any | null>(null);
   const [selectedFileIndex, setSelectedFileIndex] = React.useState<
      number | null
   >(null);
   const [fileToAnnotationsMap, setFileToAnnotationsMap] = React.useState<
      Map<number, FileAnnotations>
   >(new Map());
   const [cookie, setCookie] = useCookies(["tapis-token"]);
   const [resAnnotation, setResAnnotation] = React.useState<any>(null);
   const { pipeid } = useLoaderData<{ pipeid: string }>();
   const [outputDir, setOutputDir] = React.useState<string>("");
   const [jobId, setJobId] = React.useState<string>("");

   const [similarityThreshold, setSimilarityThreshold] =
      React.useState<number>(0.1);
   const [objectnessThreshold, setObjectnessThreshold] =
      React.useState<number>(0.1);
   const [nmsIoUThreshold, setNmsIoUThreshold] = React.useState<number>(0.5);
   const [classSupportFilePath, setClassSupportFilePath] =
      React.useState<string>("");
   const [queryImagePath, setQueryImagePath] = React.useState<string>("");
   const [detectionFiles, setDetectionFiles] = React.useState<string[]>([]);
   const [selectedDetectionFileIndex, setSelectedDetectionFileIndex] =
      React.useState<number | null>(null);
   const [currentConfiguration, setCurrentConfiguration] =
      React.useState<QueryImageConfiguration | null>(null);
   const [od_id, setOd_id] = React.useState<number | null>(null);
   const [queryImageDir, setQueryImageDir] = React.useState<string>("");
   const [openFileExplorer, setOpenFileExplorer] = React.useState<boolean>(false);
   const [imageFiles, setImageFiles] = React.useState<string[]>([]);
   const [downloadAnchor, setDownloadAnchor] = React.useState<HTMLElement | null>(null);
   const [isLoadingDetectionFile, setIsLoadingDetectionFile] = React.useState<boolean>(false);

   useEffect(() => {
      fetchAndReturnData(
         `/get-object-detection-pipeline/${pipeid}`,
         cookie["tapis-token"]["access_token"]
      ).then((res) => {
         if (!res) {
            alert(
               "Failed to fetch object detection pipeline. Make sure to generate class supports first (Use previous step)."
            );
         } else {
            console.log(res);
            const data: any = res;
            if (!data["query_image_configuration"]) {
               alert(
                  "No query image configuration found. Please configure query image in previous step."
               );
               replace(`/object-detection/configure-detection-job/${pipeid}`);
               return;
            }
            setOd_id(data["id"] || null);
            setClassSupportFilePath(
               data["classSupportsPath"] ? data["classSupportsPath"] : ""
            );
            const d = data["query_image_configuration"];
            setCurrentConfiguration(d);
            setJobId(d["detectionJobId"] || "");

            setSystem(d["system"] || "expanse-tapis");
            setQueryImagePath(d["queryImagePath"] || "");
            setSimilarityThreshold(
               d["similarityThreshold"] ? d["similarityThreshold"] : 0.2
            );
            setObjectnessThreshold(
               d["objectnessThreshold"] ? d["objectnessThreshold"] : 0.1
            );
            setNmsIoUThreshold(
               d["nmsIoUThreshold"] ? d["nmsIoUThreshold"] : 0.5
            );
            setOutputDir(d["outputDir"] ? d["outputDir"] : "");
         }
      });
   }, []);

   useEffect(() => {
      if (queryImagePath) {
         if (isImageFile(queryImagePath)) {
            getImage(queryImagePath, pipeid, system, cookie)
               .then((res) => {
                  setSelectedFile(res);
                  setSelectedFileIndex(0);
               })
               .catch((error) => {
                  console.error("Error fetching image:", error);
               });
         } else {
            setQueryImageDir(queryImagePath)
         }
      }
   }, [queryImagePath]);

   useEffect(() => {
      if (system && outputDir) {
         fetchFiles();
      }
   }, [outputDir, system]);

   useEffect(() => {
      if (selectedFile) {
         if (fileToAnnotationsMap) {
            const fileAnnotations =
               fileToAnnotationsMap.get(selectedFileIndex || 0) || null;
            setBoundingBoxes(fileAnnotations?.annotations || []);
         }
      }
   }, [selectedFile, fileToAnnotationsMap]);

   useEffect(() => {
      if (resAnnotation) {
         const map = importFromDefaultJsonUtil(resAnnotation, imageFiles.length > 0 ? imageFiles : [queryImagePath]);
         setFileToAnnotationsMap(map);
      }
   }, [resAnnotation, imageFiles, queryImagePath]);

   const fetchFiles = async () => {
      try {
         if (!outputDir || !system) {
            return;
         }

         const ecodedPath = encodeURIComponent(outputDir + "/detections");
         await fetchAndReturnData(
            `/get_files/${pipeid}/${system}?dir=${ecodedPath}`,
            cookie["tapis-token"]["access_token"]
         )
            .then(async (res) => {
               if (!res || !res["files"] || res["files"].length === 0) {
                  return;
               }
               setDetectionFiles(
                  res["files"]
                     .filter((f: any) => typeof f === "string")
                     .filter((f: string) => f.endsWith(".json"))
                     .map((f: string) => {
                        f = f.replace("tapis:/", "");
                        return "/" + f;
                     })
               );
            })
            .catch((error) => {
               console.error("Error fetching images:", error);
            });
      } catch (error) {
         console.error("Error fetching images:", error);
      }
   };

   const onSelectDetectionFile = async (index: number) => {
      setSelectedDetectionFileIndex(index);
      setIsLoadingDetectionFile(true);
      const file = detectionFiles[index];
      try {
         const res = await getFile('/' + file, pipeid, system, cookie);
         const text = await res.text();
         setResAnnotation(JSON.parse(text));
      } catch (error) {
         console.error("Error fetching file:", error);
      } finally {
         setIsLoadingDetectionFile(false);
      }
   };

   const getSimilarityThreshold = (filePath: string) => {
      if (!filePath) return "0.1";
      filePath = filePath.substring(filePath.lastIndexOf("/") + 1);
      const simThreshold = filePath.split("_")[2];
      if (!simThreshold) return "0.1";
      return simThreshold;
   };

   const handleFileSelect = (file: any, filePath: string) => {
      if (file) {
         setSelectedFile(file);
         setSelectedFileIndex(imageFiles.indexOf(filePath));
      }
   };

   const downloadFile = (coco: boolean) => {
      setDownloadAnchor(null);
      generateJson(fileToAnnotationsMap, "", imageFiles.length > 0 ? imageFiles : [queryImagePath], system, cookie, coco, false, outputDir, similarityThreshold);
   }

   const toggleDrawer = () => {
      setOpenFileExplorer(prev => !prev);
   };

   return (
      <>
         {isLoadingDetectionFile && (
            <Backdrop
               sx={{
                  color: "#fff",
                  zIndex: (theme) => theme.zIndex.drawer + 2,
                  backgroundColor: "rgba(0, 0, 0, 0.5)",
               }}
               open={isLoadingDetectionFile}
            >
               <Box
                  sx={{
                     display: "flex",
                     flexDirection: "column",
                     alignItems: "center",
                     gap: 2,
                  }}
               >
                  <CircularProgress color="inherit" size={60} />
                  <Typography variant="body1" sx={{ fontWeight: 500 }}>
                     Loading detection file...
                  </Typography>
               </Box>
            </Backdrop>
         )}
         <Paper elevation={3} style={{ padding: "16px" }}>

            {queryImageDir && (
               <>
                  <IconButton
                     onClick={toggleDrawer}
                     sx={{
                        position: "fixed",
                        top: 100,
                        left: openFileExplorer ? "25vw" : 0,
                        zIndex: (theme) => theme.zIndex.drawer + 1,
                        transition: "left 0.3s",
                        background: "white",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                        width: 20,
                        height: 42,
                        boxShadow: 1,
                     }}
                  >
                     {openFileExplorer ? <ArrowLeftIcon /> : <ArrowRightIcon />}
                  </IconButton>
                  <Drawer
                     anchor="left"
                     open={openFileExplorer}
                     onClose={toggleDrawer}
                     sx={{
                        width: "35vw",
                        flexShrink: 0,
                        "& .MuiDrawer-paper": {
                           width: "25vw",
                           boxSizing: "border-box",
                           p: 2,
                        },
                     }}
                     variant="persistent"
                  >
                     <FileExplorer
                        onFileSelect={handleFileSelect}
                        filesInDirectory={(newFiles, _sys) => {
                           setImageFiles(newFiles);
                           setFileToAnnotationsMap(new Map());
                           setBoundingBoxes([]);
                           setSelectedFile(null);
                        }}
                        pipeid={pipeid}
                        parentSystem={system}
                        fileDir={queryImageDir}
                     />
                  </Drawer>
               </>
            )}
            <Grid container spacing={2} sx={{ overflow: "hidden", mt: 2 }}>
               <Grid size={9}>
                  {selectedFile ? (
                     <ImageCanvas
                        file={selectedFile}
                        boxes={boundingBoxes}
                        generatedBoxes={[]}
                        selectedAnnotationId={""}
                        onBoxSelection={(id) => console.log(id)}
                        onBoxUpdate={() => console.log("update")}
                        isEditable={false}
                        setFileSize={() => { }}
                        isGraphEnabled={false}
                        score={similarityThreshold}
                     />
                  ) : (
                     <Box
                        sx={{
                           width: "100%",
                           display: "flex",
                           flexDirection: "column",
                           alignItems: "center",
                        }}
                     >
                        <h4 style={{ color: "rgba(0, 0, 0, 0.6)" }}>
                           Loading Image...
                        </h4>
                     </Box>
                  )}
               </Grid>
               <Grid size={3} sx={{ height: "90vh", overflowY: "auto", overflowX: "hidden" }}>
                  {currentConfiguration && (
                     <QueryImageConfigurationItem
                        key={currentConfiguration.id}
                        job={currentConfiguration}
                        clickHandler={() => { }}
                        selected={false}
                     />
                  )}
                  <Box
                     sx={{
                        p: 1.2,
                        mb: 1.5,
                        alignItems: "center",
                        display: "flex",
                        flexDirection: "column",
                        background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
                        borderRadius: "8px",
                        border: "1px solid rgba(25, 118, 210, 0.1)",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                        position: "sticky",
                        top: 0,
                        zIndex: 10,
                     }}
                  >
                     <Box
                        sx={{
                           display: "flex",
                           flexDirection: "column",
                           alignItems: "center",
                           gap: 0.8,
                           width: "100%",
                        }}
                     >
                        <Tooltip title="Download annotations">
                           <IconButton
                              size="small"
                              onClick={(e) => setDownloadAnchor(e.currentTarget)}
                              disabled={isLoadingDetectionFile}
                              sx={{
                                 color: "#1565c0",
                                 fontWeight: 600,
                                 fontSize: "0.8rem",
                                 borderRadius: 1.5,
                                 "&:hover": { bgcolor: "rgba(238, 224, 224, 0.1)", color: "rgba(6, 28, 53, 0.4)" },
                                 "&:disabled": { color: "rgba(21, 101, 192, 0.4)" },
                              }}
                           >
                              DOWNLOAD
                           </IconButton>
                        </Tooltip>
                        <Menu
                           anchorEl={downloadAnchor}
                           open={Boolean(downloadAnchor)}
                           onClose={() => setDownloadAnchor(null)}
                           slotProps={{
                              paper: {
                                 elevation: 6,
                                 sx: { minWidth: 200, mt: 0.5, borderRadius: 2 },
                              },
                           }}
                        >
                           <MenuItem onClick={() => downloadFile(true)} dense>
                              <ListItemIcon>
                                 <DataObjectIcon fontSize="small" color="primary" />
                              </ListItemIcon>
                              <ListItemText primary="COCO JSON" />
                           </MenuItem>
                           <MenuItem onClick={() => downloadFile(false)} dense>
                              <ListItemIcon>
                                 <ArticleIcon fontSize="small" color="primary" />
                              </ListItemIcon>
                              <ListItemText primary="Default JSON" />
                           </MenuItem>
                        </Menu>
                     </Box>

                     <Box
                        sx={{
                           width: "100%",
                           mt: 1,
                           display: "flex",
                           flexDirection: "column",
                           alignItems: "center",
                           bgcolor: "rgba(255, 255, 255, 0.8)",
                           p: 1,
                           borderRadius: "6px",
                           border: "1px solid rgba(25, 118, 210, 0.15)",
                        }}
                     >
                        <Typography
                           variant="caption"
                           sx={{
                              mb: 0.5,
                              color: "#424242",
                              fontWeight: 500,
                              fontSize: "0.7rem",
                           }}
                        >
                           Similarity Threshold
                        </Typography>
                        <Typography
                           variant="body2"
                           sx={{
                              mb: 0.8,
                              color: "#1565c0",
                              fontWeight: 700,
                              fontSize: "0.85rem",
                           }}
                        >
                           {similarityThreshold.toFixed(2)}
                        </Typography>
                        <Slider
                           value={similarityThreshold}
                           aria-label="Similarity Threshold"
                           valueLabelDisplay="auto"
                           min={0}
                           max={1}
                           step={0.01}
                           onChange={(e, newValue) =>
                              setSimilarityThreshold(newValue as number)
                           }
                           sx={{
                              width: "90%",
                              "& .MuiSlider-rail": {
                                 backgroundColor: "rgba(21, 101, 192, 0.2)",
                              },
                              "& .MuiSlider-track": {
                                 backgroundColor: "#1565c0",
                              },
                              "& .MuiSlider-thumb": {
                                 backgroundColor: "#1565c0",
                                 boxShadow: "0 2px 6px rgba(21, 101, 192, 0.4)",
                                 transition: "all 0.3s ease",
                                 "&:hover": {
                                    boxShadow: "0 4px 12px rgba(21, 101, 192, 0.6)",
                                 }
                              }
                           }}
                        />
                     </Box>
                  </Box>
                  {detectionFiles.length > 0 ? (
                     <Box
                        sx={{
                           p: 1.5,
                           border: "1px solid",
                           borderColor: "rgba(21, 101, 192, 0.15)",
                           borderRadius: "8px",
                           background: "linear-gradient(to bottom, rgba(229, 242, 253, 0.5), rgba(255, 255, 255, 0.8))",
                        }}
                     >
                        <Typography
                           variant="subtitle2"
                           sx={{
                              mb: 1.5,
                              fontWeight: 600,
                              color: "#1565c0",
                              textTransform: "uppercase",
                              letterSpacing: "0.5px",
                              fontSize: "0.75rem",
                           }}
                        >
                           Detection Files
                        </Typography>
                        <List>
                           {detectionFiles.map((file, index) => (
                              <ListItem
                                 key={index}
                                 onClick={() => onSelectDetectionFile(index)}
                                 // disabled={isLoadingDetectionFile}
                                 sx={{
                                    cursor: isLoadingDetectionFile ? "not-allowed" : "pointer",
                                    p: 1.5,
                                    mb: 1,
                                    border: "1px solid",
                                    borderColor: selectedDetectionFileIndex === index ? "#1565c0" : "rgba(21, 101, 192, 0.1)",
                                    borderRadius: "8px",
                                    boxShadow: selectedDetectionFileIndex === index
                                       ? "0 4px 12px rgba(21, 101, 192, 0.2)"
                                       : "0 1px 3px rgba(0, 0, 0, 0.08)",
                                    background: selectedDetectionFileIndex === index
                                       ? "linear-gradient(135deg, rgba(25, 118, 210, 0.12), rgba(25, 118, 210, 0.06))"
                                       : "rgba(255, 255, 255, 0.6)",
                                    transition: "all 0.3s ease",
                                    "&:hover": {
                                       borderColor: "#1565c0",
                                       background: "linear-gradient(135deg, rgba(25, 118, 210, 0.08), rgba(25, 118, 210, 0.04))",
                                       boxShadow: "0 2px 8px rgba(21, 101, 192, 0.15)",
                                    }
                                 }}
                              >
                                 {selectedDetectionFileIndex === index && (
                                    <ImageIcon
                                       color="primary"
                                       sx={{
                                          mr: 1.5,
                                          fontSize: "1.4rem",
                                       }}
                                    />
                                 )}
                                 <ListItemText
                                    primary={file.substring(
                                       file.lastIndexOf("/") + 1
                                    )}
                                    secondary={`Similarity Threshold: ${getSimilarityThreshold(
                                       file
                                    )}`}
                                    sx={{
                                       overflow: "auto",
                                       "& .MuiListItemText-primary": {
                                          fontWeight: selectedDetectionFileIndex === index ? 600 : 500,
                                          color: selectedDetectionFileIndex === index ? "#1565c0" : "#212121",
                                          fontSize: "0.9rem",
                                       },
                                       "& .MuiListItemText-secondary": {
                                          color: selectedDetectionFileIndex === index ? "#1565c0" : "#666",
                                          fontSize: "0.8rem",
                                       }
                                    }}
                                 />
                              </ListItem>
                           ))}
                        </List>
                     </Box>
                  ) : (
                     <>
                        <Box
                           sx={{
                              p: 3,
                              border: "2px dashed",
                              borderColor: "rgba(21, 101, 192, 0.2)",
                              borderRadius: "8px",
                              textAlign: "center",
                              background: "rgba(229, 242, 253, 0.4)",
                           }}
                        >
                           <Typography
                              variant="body2"
                              sx={{
                                 color: "#666",
                                 fontWeight: 500,
                              }}
                           >
                              ⏳ Detection pending...
                           </Typography>
                           <Typography
                              variant="caption"
                              sx={{
                                 color: "#999",
                                 display: "block",
                                 mt: 0.5,
                              }}
                           >
                              Files will appear here once detection completes
                           </Typography>
                        </Box>
                     </>
                  )}
               </Grid>
            </Grid>
         </Paper>
      </>
   );
};

export default Classification;

export function clientLoader({ params }: any) {
   return { pipeid: params.id };
}
clientLoader.hydrate = true;
