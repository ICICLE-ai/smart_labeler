import {
   Typography,
   Paper,
   Box,
   List,
   ListItemText,
   Grid,
   Button,
   ListItem,
   Slider,
   IconButton,
   Drawer,
} from "@mui/material";
import ImageIcon from "@mui/icons-material/Image";
import { replace, useLoaderData } from "@remix-run/react";
import React, { useEffect, useRef } from "react";
import {
   Annotation,
   ImageCanvas,
} from "~/components/ImageAnnotation/ImageCanvas";
import {
   fetchAndReturnData,
   fetchFile,
   getImage,
   SubmitData,
   getFile
} from "~/utils/utils";
import { useCookies } from "react-cookie";
import {
   FileAnnotations,
   generateObjectnessScoreGraph,
   importFromDefaultJsonUtil,
   isImageFile,
   QueryImageConfiguration,
   steps,
} from "~/components/ImageAnnotation/utils";
import QueryImageConfigurationItem from "~/components/ObjectDetection/QueryImageConfigurationItem";
import { FileExplorer } from "~/components/ImageAnnotation/FileExplorer";
import { usePipeline } from "~/context/PipelineContext";


const OptimizeObjectnessThreshold: React.FC = () => {
   const [boundingBoxes, setBoundingBoxes] = React.useState<Annotation[]>([]);
   const [queryFile, setQueryFile] = React.useState<string>("");
   const [system, setSystem] = React.useState<string>("expanse-tapis");
   const [selectedFile, setSelectedFile] = React.useState<any | null>(null);
   const [selectedFileIndex, setSelectedFileIndex] = React.useState<
      number | null
   >(null);
   const [fileToAnnotationsMap, setFileToAnnotationsMap] = React.useState<
      Map<number, FileAnnotations>
   >(new Map());
   React.useState<boolean>(false);
   const [cookie, setCookie] = useCookies(["tapis-token"]);
   const [resGenerated, setResGenerated] = React.useState<any>(null);
   const { pipeid } = useLoaderData<{ pipeid: string }>();
   const { notifyJobSubmitted } = usePipeline();
   const [outputDir, setOutputDir] = React.useState<string>("");
   const [method, setMethod] = React.useState<string>("Image");
   const [device, setDevice] = React.useState<string>("CPU");
   const [featureFiles, setFeatureFiles] = React.useState<string[]>([]);
   const [selectedFeatureFileIndex, setSelectedFeatureFileIndex] =
      React.useState<number | null>(null);
   const [objectnessThreshold, setObjectnessThreshold] =
      React.useState<number>(0.1);
   const [boxes, setBoxes] = React.useState<Annotation[]>([]);
   const [currentConfiguration, setCurrentConfiguration] =
      React.useState<QueryImageConfiguration | null>(null);
   const [queryFileDir, setQueryFileDir] = React.useState<string>("");
   const [openFileExplorer, setOpenFileExplorer] = React.useState<boolean>(false);
   const [imageFiles, setImageFiles] = React.useState<string[]>([]);
   const [featureFileNameToAnnotationsMap, setFeatureFileNameToAnnotationsMap] =
      React.useState<Map<string, Map<number, FileAnnotations>>>(new Map());
   const [graph, setGraph] = React.useState<React.ReactElement | null>(null);
   const [isDemo, setIsDemo] = React.useState<boolean>(false);

   const toggleDrawer = () => {
      setOpenFileExplorer(prev => !prev);
   };

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
            setSystem(data["system"] || "expanse-tapis");
            setIsDemo(data["is_demo"] || false);
            // setOutputDir(
            //    data["outputDir"] ? data["outputDir"] + "/query/boxes" : ""
            // );
            setMethod(data["method"] || "Image");
            setDevice(data["device"] || "cpu");
            setQueryFile(data["queryImagePath"] || "");
            if (!data["query_image_configuration"]) {
               alert(
                  "No query image configuration found. Please configure query image in previous step."
               );
               replace(`/object-detection/configure-detection-job/${pipeid}`);
               return;
            }
            if (data["query_image_configuration"]) {
               const d = data["query_image_configuration"];
               setQueryFile(d["queryImagePath"] || "");
               setObjectnessThreshold(d["objectness_threshold"] || 0.1);
               setCurrentConfiguration(d);
               setOutputDir(
                  d["outputDir"] ? d["outputDir"] : ""
               );
               setSystem(d["system"] || "expanse-tapis");

            }
         }
      });
   }, []);

   useEffect(() => {
      if (queryFile) {
         if (isImageFile(queryFile)) {
            getImage(queryFile, pipeid, system, cookie).then((res) => {
               setSelectedFile(res);
               setSelectedFileIndex(0);
            });
         } else {
            setQueryFileDir(queryFile);
         }
      }
   }, [queryFile]);

   const handleFileSelect = (filePath: string, index: number) => {
      if (filePath) {
         setSelectedFile(filePath);
         setSelectedFileIndex(index);
      }
   }

   useEffect(() => {
      if (system && outputDir) {
         fetchFiles();
      }
   }, [outputDir, system]);

   useEffect(() => {
      if (selectedFile) {
         const anns =
            fileToAnnotationsMap.get(selectedFileIndex || 0) || null;
         setBoundingBoxes(
            anns?.annotations.filter(
               (box): box is Annotation =>
                  !!box && (box.score === undefined || box.score >= objectnessThreshold)
            ) || []
         );
         setBoxes(anns?.annotations || []);
         setGraph(generateGraph());
      }
   }, [selectedFile, fileToAnnotationsMap]);

   const fetchFiles = async () => {
      try {
         if (!outputDir || !system) {
            return;
         }

         const ecodedPath = encodeURIComponent(outputDir + "/proposals/generated_boxes");
         await fetchAndReturnData(
            `/get_files/${pipeid}/${system}?dir=${ecodedPath}`,
            cookie["tapis-token"]["access_token"]
         )
            .then(async (res) => {
               if (!res || !res["files"] || res["files"].length === 0) {
                  return;
               }
               setFeatureFiles(
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

   useEffect(() => {
      if (resGenerated) {
         const map = importFromDefaultJsonUtil(resGenerated, imageFiles.length > 0 ? imageFiles : [queryFile]);
         setFileToAnnotationsMap(map);
         setBoundingBoxes([]);
         setBoxes([]);
      }
   }, [resGenerated, queryFile, imageFiles]);

   useEffect(() => {
      if (featureFiles.length > 0 && ( imageFiles.length > 0 || queryFile)) {
         featureFiles.forEach((file, index) => {
            getFile("/" + file, pipeid, system, cookie)
               .then(async (res) => {
                  const text = await res.text();
                  const map = importFromDefaultJsonUtil(JSON.parse(text), imageFiles.length > 0 ? imageFiles : [queryFile]);
                  setFeatureFileNameToAnnotationsMap(prev => {
                     const newMap = new Map(prev);
                     newMap.set(file, map);
                     return newMap;
                  });
               })
               .catch((error) => {
                  console.error("Error fetching file:", error);
               });
         })
      }
   }, [featureFiles, imageFiles, queryFile]);

   const onSelectFeatureFile = async (index: number) => {
      setSelectedFeatureFileIndex(index);
      const file = featureFiles[index];
      try {
         setFileToAnnotationsMap(featureFileNameToAnnotationsMap.get(file) || new Map());
         setBoundingBoxes([]);
         setBoxes([]);
      } catch (error) {
         console.error("Error fetching file:", error);
      }
   };

   useEffect(() => {
      if (objectnessThreshold) {
         const updatedBoxes = boxes.filter(
            (box: Annotation) =>
               box.score !== undefined && box.score >= objectnessThreshold
         );
         setBoundingBoxes(updatedBoxes);
      }
   }, [ objectnessThreshold]);

   const handleSave = () => {
      if (isDemo) {
         alert("Demo mode: Saving is disabled for demo pipelines.");
         return;
      }
      if (!currentConfiguration || !currentConfiguration.id) {
         alert("No query image configuration selected.");
         return;
      }
      if (selectedFeatureFileIndex === null) {
         alert("Please select a feature file to save.");
         return;
      }

      const fileName = featureFiles[selectedFeatureFileIndex];
      if (!fileName) {
         alert("Invalid feature file selected.");
         return;
      }

      const featureFileName = fileName
         .replace("boxes", "objects")
         .replace("generated_boxes", "features")
         .replace(".json", ".npz");

      SubmitData(
         `/update_current_query_image_configuration/${pipeid}/${currentConfiguration.id}`,
         {
            object_feature_tensor_file_path: featureFileName,
            objectnessThreshold: objectnessThreshold,
         },
         cookie["tapis-token"]["access_token"]
      )
         .then((res) => {
            if (!res) {
               alert("Failed to save object feature file path");
               return;
            }
            notifyJobSubmitted();
            console.log(res);
            alert("Object feature file path saved successfully");
         })
         .catch((err) => {
            console.error(err);
            alert("Failed to save object feature file path");
         });
   };

   const generateGraph = () => {
      return generateObjectnessScoreGraph(fileToAnnotationsMap.get(selectedFileIndex || 0) || null);
   }

   function getProposer(file: string) {
      if (!file) return "Unknown";
      const fileName = file.split("/").pop() || "";
      const parts = fileName.split("_");
      if (parts.length < 4) return "Unknown";
      return parts[3] || "Unknown";
   }

   function getEmbedder(file: string) {
      if (!file) return "Unknown";
      const fileName = file.split("/").pop() || "";
      const parts = fileName.split("_");
      if (parts.length < 3) return "Unknown";
      return parts[2] || "Unknown";
   }

   return (
      <>
         <Paper elevation={3} style={{ padding: "16px" }}>
            {queryFileDir && (
               <>
                  <Button
                     onClick={toggleDrawer}
                     sx={{
                        position: "fixed",
                        top: 120,
                        left: openFileExplorer ? "25vw" : 0,
                        zIndex: (theme) => theme.zIndex.drawer + 1,
                        transition: "left 0.3s",
                        background: "white",
                        border: "1px solid #ccc",
                        borderTopRightRadius: "6px",
                        borderBottomRightRadius: "6px",
                        borderTopLeftRadius: 0,
                        borderBottomLeftRadius: 0,
                        minWidth: 0,
                        width: 24,
                        padding: "10px 4px",
                        boxShadow: 2,
                        writingMode: "vertical-lr",
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        color: "primary.main",
                        textTransform: "none",
                        whiteSpace: "nowrap",
                        "&:hover": {
                           background: "primary.light",
                           borderColor: "primary.main",
                        },
                     }}
                  >
                     File Explorer
                  </Button>
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
                        filesInDirectory={(files) => {
                           setImageFiles(files);
                           setFileToAnnotationsMap(new Map());
                           setBoundingBoxes([]);
                           setSelectedFile(null);
                        }}
                        pipeid={pipeid}
                        parentSystem={system}
                        fileDir={queryFileDir}
                     />
                  </Drawer>
               </>
            )}

            <Grid container spacing={2} sx={{ overflow: "hidden", mt: 2 }}>
               <Grid size={9}>
                  {selectedFile ? (
                     <ImageCanvas
                        file={selectedFile}
                        boxes={[]}
                        graph={graph}
                        generatedBoxes={boundingBoxes}
                        selectedAnnotationId={""}
                        onBoxSelection={(id) => console.log(id)}
                        onBoxUpdate={() => console.log("update")}
                        isEditable={false}
                        setFileSize={() => { }}
                        handleRenderGraph={generateGraph}
                        isGraphEnabled={true}
                        score={objectnessThreshold}
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
                     <Typography 
                        variant="subtitle1"
                        sx={{
                           fontWeight: 700,
                           color: "#1565c0",
                           mb: 1,
                           letterSpacing: "0.5px",
                           fontSize: "0.95rem",
                        }}
                     >
                        Optimize Objectness Threshold
                     </Typography>
                     <Box
                        sx={{
                           display: "flex",
                           flexDirection: "column",
                           alignItems: "center",
                           gap: 0.8,
                           width: "100%",
                        }}
                     >
                        <Button
                           variant="contained"
                           color="primary"
                           onClick={handleSave}
                           size="small"
                           sx={{ 
                              width: "100%",
                              fontWeight: 600,
                              py: 0.6,
                              fontSize: "0.8rem",
                              boxShadow: "0 4px 12px rgba(21, 101, 192, 0.3)",
                              transition: "all 0.3s ease",
                              "&:hover": {
                                 boxShadow: "0 6px 16px rgba(21, 101, 192, 0.4)",
                                 transform: "translateY(-2px)",
                              }
                           }}
                        >
                           Save
                        </Button>
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
                           Threshold
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
                           {objectnessThreshold.toFixed(2)}
                        </Typography>
                        <Slider
                           value={objectnessThreshold}
                           aria-label="Objectness Threshold"
                           valueLabelDisplay="auto"
                           min={0}
                           max={1}
                           step={0.01}
                           onChange={(e, newValue) =>
                              setObjectnessThreshold(newValue as number)
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
                  {featureFiles.length > 0 ? (
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
                           Proposal Files
                        </Typography>
                        <List sx={{ overflowY: "auto" }}>
                           {featureFiles.map((file, index) => (
                              <ListItem
                                 key={index}
                                 onClick={() => onSelectFeatureFile(index)}
                                 sx={{
                                    cursor: "pointer",
                                    p: 1.5,
                                    mb: 1,
                                    border: "1px solid",
                                    borderColor: selectedFeatureFileIndex === index ? "#1565c0" : "rgba(21, 101, 192, 0.1)",
                                    borderRadius: "8px",
                                    boxShadow: selectedFeatureFileIndex === index
                                       ? "0 4px 12px rgba(21, 101, 192, 0.2)"
                                       : "0 1px 3px rgba(0, 0, 0, 0.08)",
                                    background: selectedFeatureFileIndex === index
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
                                 {selectedFeatureFileIndex === index && (
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
                                    secondary={`Proposer: ${getProposer(file)}\nEmbedder: ${getEmbedder(file)}`}
                                    sx={{ 
                                       overflow: "auto",
                                       "& .MuiListItemText-primary": {
                                          fontWeight: selectedFeatureFileIndex === index ? 600 : 500,
                                          color: selectedFeatureFileIndex === index ? "#1565c0" : "#212121",
                                          fontSize: "0.9rem",
                                       },
                                       "& .MuiListItemText-secondary": {
                                          color: selectedFeatureFileIndex === index ? "#1565c0" : "#666",
                                          fontSize: "0.8rem",
                                          whiteSpace: "pre-line",
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
                              ⏳ Feature detection pending...
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

export default OptimizeObjectnessThreshold;

export function clientLoader({ params }: any) {
   return { pipeid: params.id };
}
clientLoader.hydrate = true;
