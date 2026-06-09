import {
   Typography,
   Paper,
   Drawer,
   Box,
   Pagination,
   ListItemButton,
   List,
   Divider,
   ListItemText,
   Grid,
   Button,
   ListItem,
   IconButton,
   Tooltip,
} from "@mui/material";
import ImageIcon from "@mui/icons-material/Image";
import ArrowLeftIcon from "@mui/icons-material/ArrowLeft";
import ArrowRightIcon from "@mui/icons-material/ArrowRight";
import { useLoaderData } from "@remix-run/react";
import React, { useEffect, useMemo, useRef } from "react";
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
   importFromDefaultJsonUtil,
   isImageFile,
   steps,
   getCropSize,
   generateClassSupportGraph,
   generateMultipleIoUScoreGraph
} from "~/components/ImageAnnotation/utils";
import { FileExplorer } from "~/components/ImageAnnotation/FileExplorer";
import { usePipeline } from "~/context/PipelineContext";

const OptimizeClassSupports: React.FC = () => {
   const [boundingBoxes, setBoundingBoxes] = React.useState<Annotation[]>([]);
   const [generatedBoxes, setGeneratedBoxes] = React.useState<Annotation[]>([]);
   const [files, setFiles] = React.useState<string[]>([]);
   const [system, setSystem] = React.useState<string>("expanse-tapis");
   const [selectedFile, setSelectedFile] = React.useState<any | null>(null);
   const [selectedFileIndex, setSelectedFileIndex] = React.useState<
      number | null
   >(0);
   const [fileToAnnotationsMap, setFileToAnnotationsMap] = React.useState<
      Map<number, FileAnnotations>
   >(new Map());
   const [fileToGeneratedAnnotationsMap, setFileToGeneratedAnnotationsMap] =
      React.useState<Map<number, FileAnnotations>>(new Map());
   const [openDrawer, setOpenDrawer] = React.useState<boolean>(false);
   React.useState<boolean>(false);
   const [cookie, setCookie] = useCookies(["tapis-token"]);
   const [page, setPage] = React.useState<number>(1);
   const [resGenerated, setResGenerated] = React.useState<any>(null);
   const [resAnnotation, setResAnnotation] = React.useState<any>(null);
   const { pipeid } = useLoaderData<{ pipeid: string }>();
   const { notifyJobSubmitted } = usePipeline();
   const [outputDir, setOutputDir] = React.useState<string>("");
   const [annotationFilePath, setAnnotationFilePath] =
      React.useState<string>("");
   const [srcImgDir, setSrcImgDir] = React.useState<string>("");
   const [cropSize, setCropSize] = React.useState<string>("");
   const [method, setMethod] = React.useState<string>("Image");
   const [device, setDevice] = React.useState<string>("CPU");
   const [classSupportsFiles, setClassSupportsFiles] = React.useState<string[]>([]);
   const [queryImagePath, setQueryImagePath] = React.useState<string>("");
   const [jobCompleted, setJobCompleted] = React.useState<boolean>(false);
   const [jobId, setJobId] = React.useState<string>("");
   const intervalIdRef = useRef<NodeJS.Timeout | null>(null);
   const [selectedClassSupportFileIndex, setSelectedClassSupportFileIndex] =
      React.useState<number | null>(null);
   const [fileToClassSupportsMap, setFileToClassSupportsMap] = React.useState<Map<string, Map<number, FileAnnotations>>>(new Map());
   const [graph, setGraph] = React.useState<React.ReactElement | null>(null);
   const [name, setName] = React.useState<string>("");
   const [cropSizes, setCropSizes] = React.useState<string>("1024");
   const [isDemo, setIsDemo] = React.useState<boolean>(false);

   const PAGE_SIZE = 10;

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
            setSrcImgDir(data["srcImgDir"] || "");
            setAnnotationFilePath(data["annotationFilePath"] || "");
            setOutputDir(data["outputDir"] || "");
            setMethod(data["method"] || "Image");
            setCropSize(data["cropSize"] ? data["cropSize"].toString() : "");
            setDevice(data["device"] || "cpu");
            setJobId(data["generateClassSupportJobId"]);
            setQueryImagePath(data["queryImagePath"] || "");
            setName(data["name"] || "");
            setCropSizes(data["crop_sizes"] || "1024");
            setIsDemo(data["is_demo"] || false);
         }
      });
   }, []);

   useEffect(() => {
      for (const filePath of classSupportsFiles) {
         // const cropSize = getCropSize(filePath);
         getFile(filePath, pipeid, system, cookie)
            .then(async (res) => {
               const text = await res.text();
               const json = JSON.parse(text);
               const map = importFromDefaultJsonUtil(json, files);
               setFileToClassSupportsMap((prev) => {
                  const newMap = new Map(prev);
                  newMap.set(filePath, new Map(map));
                  return newMap;
               });
            })
            .catch((error) => {
               console.error("Error fetching file:", error);
            });
      }
   }, [classSupportsFiles, files]);


   useEffect(() => {
      const fetchStatus = async () => {
         try {
            const res = await fetchAndReturnData(
               `/get_job_status/${jobId}`,
               cookie["tapis-token"]["access_token"]
            );
            if (res && res.status === "FINISHED") {
               setJobCompleted(true);
               if (intervalIdRef.current) clearInterval(intervalIdRef.current);
            }
         } catch (error) {
            console.error("Error fetching status:", error);
            if (intervalIdRef.current) {
               clearInterval(intervalIdRef.current);
            }
         }
      };
      if (jobId) {
         fetchStatus();
         intervalIdRef.current = setInterval(fetchStatus, 20000);
      }

      return () => {
         if (intervalIdRef.current) clearInterval(intervalIdRef.current);
      };
   }, [jobId]);

   // useEffect(() => {
   //    if (srcImgDir) {
   //       fetchImages({ system, srcImgDir });
   //    }
   // }, [srcImgDir]);

   useEffect(() => {
      if (system && outputDir) {
         fetchFiles();
      }
   }, [outputDir, system, jobCompleted]);

   useEffect(() => {
      if (system && annotationFilePath) {
         getFile(annotationFilePath, pipeid, system, cookie)
            .then(async (res) => {
               const text = await res.text();
               setResAnnotation(JSON.parse(text));
            })
            .catch((error) => {
               console.error("Error fetching file:", error);
            });
      }
   }, [annotationFilePath, system]);

   useEffect(() => {
      if (selectedFileIndex !== null && selectedFileIndex !== undefined) {
         // Get ground truth annotations
         if (fileToAnnotationsMap && fileToAnnotationsMap.size > 0) {
            const fileAnnotations =
               fileToAnnotationsMap.get(selectedFileIndex) || null;
            setBoundingBoxes(fileAnnotations?.annotations || []);
         }

         // Get generated annotations
         if (fileToGeneratedAnnotationsMap && fileToGeneratedAnnotationsMap.size > 0) {
            const generated =
               fileToGeneratedAnnotationsMap.get(selectedFileIndex) || null;
            setGeneratedBoxes(generated?.annotations || []);
            console.log(`Displaying annotations for file index ${selectedFileIndex}:`, generated?.annotations);
            setGraph(generateGraph());
         } else {
            // Clear generated boxes if no data available
            setGeneratedBoxes([]);
            setGraph(null);
         }
      }
   }, [selectedFileIndex, fileToAnnotationsMap, fileToGeneratedAnnotationsMap]);

   useEffect(() => {
      if (resGenerated && files.length > 0) {
         const gmap = importFromDefaultJsonUtil(resGenerated, files);
         setFileToGeneratedAnnotationsMap(new Map(gmap));
      }

      if (resAnnotation && files.length > 0) {
         const amap = importFromDefaultJsonUtil(resAnnotation, files);
         setFileToAnnotationsMap(new Map(amap));
      }
   }, [resAnnotation, resGenerated, files]);

   const fetchFiles = async () => {
      try {
         if (!outputDir || !system) {
            return;
         }

         const ecodedPath = encodeURIComponent(outputDir + "/class_supports/generated_boxes");
         await fetchAndReturnData(
            `/get_files/${pipeid}/${system}?dir=${ecodedPath}`,
            cookie["tapis-token"]["access_token"]
         )
            .then(async (res) => {
               if (!res || !res["files"] || res["files"].length === 0) {
                  return;
               }
               setClassSupportsFiles(
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

   const onSelectClassSupportFile = async (index: number) => {
      setSelectedClassSupportFileIndex(index);
      const file = classSupportsFiles[index];
      try {
         const classSupportsData = fileToClassSupportsMap.get(file);
         if (classSupportsData && classSupportsData.size > 0) {
            // Set the generated annotations map for this specific crop size
            setFileToGeneratedAnnotationsMap(classSupportsData);
            console.log(`Loaded class supports for ${file}:`, classSupportsData);
         } else {
            console.warn(`No data found for class supports file: ${file}`);
            setFileToGeneratedAnnotationsMap(new Map());
         }
         // Don't clear boxes here - let the useEffect handle it
      } catch (error) {
         console.error("Error fetching class support file:", error);
         setFileToGeneratedAnnotationsMap(new Map());
      }
   };

   const toggleDrawer = () => {
      setOpenDrawer((prev) => !prev);
   };

   const handleResubmission = () => {
      if (isDemo) {
         alert("Demo mode: Job submission is disabled for demo pipelines.");
         return;
      }
      SubmitData(
         `/generate_class_supports/${pipeid}?optimize_crop_size=true`,
         {
            system: system,
            method: method,
            device: device,
            outputDir: outputDir,
            modelName: "owlv2",
            cropSize: cropSize,
            srcImgDir: srcImgDir,
            annotationFilePath: annotationFilePath,
            name: name || `Optimize Class Supports Job - ${new Date().toLocaleString()}`
         },
         cookie["tapis-token"]["access_token"]
      )
         .then((res) => {
            if (!res) {
               alert("Failed to submit optimize class supports job");
               return;
            }
            notifyJobSubmitted();
            console.log(res);
            setJobId(res.data);
         })
         .catch((err) => {
            console.error(err);
            alert("Failed to submit optimize class supports job");
         });

      alert("Optimize class supports job submitted successfully");
   };

   const generateGraph = () => {
      if (selectedFileIndex === null || selectedFileIndex === undefined || fileToClassSupportsMap.size === 0) {
         console.warn("Cannot generate graph: missing file index or class supports data");
         return null;
      }

      let patchSizeToMap = new Map<string, FileAnnotations | null>();
      fileToClassSupportsMap.forEach((map, filePath) => {
         const cropSize = getCropSize(filePath);
         const annotations = map.get(selectedFileIndex) || null;
         if (annotations) {
            console.log(`Adding graph data for crop size ${cropSize}`);
            patchSizeToMap.set(cropSize, annotations);
         }
      });

      if (patchSizeToMap.size === 0) {
         console.warn("No annotation data available for graph generation");
         return null;
      }

      return generateMultipleIoUScoreGraph(patchSizeToMap);
   }

   const saveClassSupportFilePath = () => {
      if (isDemo) {
         alert("Demo mode: Saving is disabled for demo pipelines.");
         return;
      }
      if (selectedClassSupportFileIndex === null) {
         alert("Please select a class supports file to save.");
         return;
      }

      const fileName = classSupportsFiles[selectedClassSupportFileIndex];
      if (!fileName) {
         alert("Invalid class supports file selected.");
         return;
      }

      let name = fileName.substring(fileName.lastIndexOf("/") + 1);
      let cs = name.split("_")[2];
      let path = fileName.substring(0, fileName.lastIndexOf("/"));
      name = name.replace("generated_boxes", "class_supports").replace(".json", ".npz");
      path = path.replace("generated_boxes", "tensors");
      const classSupportFilePath = path + "/" + name;


      SubmitData(
         `/update_class_support_tensor_file_path/${pipeid}`,
         {
            class_support_tensor_file_path: classSupportFilePath,
            crop_size: cs
         },
         cookie["tapis-token"]["access_token"]
      )
         .then((res) => {
            if (!res) {
               alert("Failed to save class supports file path");
               return;
            }
            notifyJobSubmitted();
            console.log(res);
            alert("Class supports file path saved successfully");
         })
         .catch((err) => {
            console.error(err);
            alert("Failed to save class supports file path");
         });
   };

   const handleFileSelect = (file: any, filePath: string) => {
      if (file) {
         setSelectedFile(file);
         setSelectedFileIndex(files.indexOf(filePath));
      }
   };

   return (
      <>
         {srcImgDir && (
            <>
               <IconButton
                  onClick={toggleDrawer}
                  sx={{
                     position: "fixed",
                     top: 100,
                     left: openDrawer ? "25vw" : 0,
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
                  {openDrawer ? <ArrowLeftIcon /> : <ArrowRightIcon />}
               </IconButton>
               <Drawer
                  anchor="left"
                  open={openDrawer}
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
                  {/* <Typography variant="body2" sx={{ mt: 1, color: "text.secondary" }}>
               Files in source image directory.
            </Typography>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ flex: 1, overflow: "auto" }}>
               {files.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                     No files loaded. Click <b>Browse Folder</b> to select a
                     directory.
                  </Typography>
               ) : (
                  <List dense>
                     {pagedFiles.map((file, i) => {
                        const abs = absoluteIndexFor(i);
                        const isSelected = selectedFileIndex === abs;
                        return (
                           <ListItemButton
                              key={`${file.split("/").at(-1)}-${abs}`}
                              selected={isSelected}
                              onClick={() => onSelectFile(abs)}
                           >
                              <Tooltip title={file}>
                                 <ListItemText
                                    primary={file.split("/").at(-1)}
                                    secondary={`Path : ${file}`}
                                    sx={{ overflow: "auto" }}
                                 />
                              </Tooltip>
                              <ImageIcon
                                 sx={{
                                    ml: 1,
                                    opacity: isImageFile(file) ? 1 : 0.25,
                                 }}
                              />
                           </ListItemButton>
                        );
                     })}
                  </List>
               )}
            </Box>
            <Box sx={{ display: "flex", justifyContent: "center", pt: 1 }}>
               <Pagination
                  count={pageCount}
                  page={page}
                  onChange={(_, v) => setPage(v)}
                  size="small"
                  siblingCount={0}
               />
            </Box> */}
                  <FileExplorer
                     onFileSelect={handleFileSelect}
                     filesInDirectory={(newFiles, _sys) => {
                        setFiles(newFiles);
                        // Don't clear annotation maps - they're loaded separately from annotationFilePath
                     }}
                     pipeid={pipeid}
                     parentSystem={system}
                     fileDir={srcImgDir}
                  />
               </Drawer>
            </>
         )}

         <Paper elevation={3} style={{ padding: "16px", height: "100vh" }}>
            <Grid
               container
               spacing={2}
               sx={{ overflow: "hidden", mt: 2, height: "92%" }}
            >
               <Grid size={9} sx={{ height: "100%" }}>
                  {selectedFile ? (
                     <ImageCanvas
                        file={selectedFile}
                        boxes={boundingBoxes}
                        graph={graph}
                        generatedBoxes={generatedBoxes}
                        selectedAnnotationId={""}
                        onBoxSelection={(id) => {}}
                        onBoxUpdate={() => {}}
                        isEditable={false}
                        setFileSize={() => { }}
                        handleRenderGraph={generateGraph}
                        isGraphEnabled={true}
                        score={0.0}
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
                        <h2>No file selected</h2>
                        <h4 style={{ color: "rgba(0, 0, 0, 0.6)" }}>
                           Select a file to start annotating.
                        </h4>
                        <Button
                           variant="contained"
                           onClick={() => setOpenDrawer(true)}
                        >
                           Open File Explorer
                        </Button>
                     </Box>
                  )}
               </Grid>
               <Grid size={3} sx={{ height: "100%" }}>
                  <Box sx={{ display: "flex", flexDirection: "column", height: "100%", gap: 2 }}>
                     {/* Optimize Crop Size Section */}
                     <Paper
                        elevation={2}
                        sx={{
                           p: 2.5,
                           background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                           borderRadius: 2,
                           color: "white",
                        }}
                     >
                        <Typography
                           variant="h6"
                           sx={{
                              fontWeight: 700,
                              mb: 2,
                              fontSize: "1rem",
                              letterSpacing: 0.5,
                           }}
                        >
                           Optimize Crop Size
                        </Typography>
                        <Box
                           sx={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 1.5,
                           }}
                        >
                           <input
                              type="text"
                              placeholder="Enter crop size value"
                              value={cropSizes}
                              onChange={(e) => setCropSizes(e.target.value)}
                              style={{
                                 padding: "10px 14px",
                                 borderRadius: "6px",
                                 border: "none",
                                 fontSize: "14px",
                                 fontWeight: 500,
                                 backgroundColor: "rgba(255, 255, 255, 0.95)",
                                 color: "#333",
                                 transition: "all 0.2s ease",
                                 outline: "none",
                              }}
                              onFocus={(e) => (e.target.style.backgroundColor = "#fff")}
                              onBlur={(e) => (e.target.style.backgroundColor = "rgba(255, 255, 255, 0.95)")}
                           />
                           <Button
                              variant="contained"
                              onClick={handleResubmission}
                              sx={{
                                 width: "100%",
                                 backgroundColor: "rgba(255, 255, 255, 0.2)",
                                 color: "white",
                                 fontWeight: 600,
                                 textTransform: "none",
                                 fontSize: "0.95rem",
                                 border: "2px solid rgba(255, 255, 255, 0.3)",
                                 transition: "all 0.2s ease",
                                 "&:hover": {
                                    backgroundColor: "rgba(255, 255, 255, 0.3)",
                                    border: "2px solid rgba(255, 255, 255, 0.5)",
                                    transform: "translateY(-2px)",
                                 },
                              }}
                           >
                              Re-submit Job
                           </Button>
                           <Button
                              variant="contained"
                              onClick={saveClassSupportFilePath}
                              sx={{
                                 width: "100%",
                                 backgroundColor: "#4CAF50",
                                 color: "white",
                                 fontWeight: 600,
                                 textTransform: "none",
                                 fontSize: "0.95rem",
                                 transition: "all 0.2s ease",
                                 "&:hover": {
                                    backgroundColor: "#45a049",
                                    transform: "translateY(-2px)",
                                    boxShadow: "0 4px 12px rgba(76, 175, 80, 0.3)",
                                 },
                              }}
                           >
                              Save
                           </Button>
                        </Box>
                     </Paper>

                     {/* Legend Section */}
                     <Box>
                        <Typography
                           variant="subtitle2"
                           sx={{
                              fontWeight: 700,
                              mb: 1.5,
                              fontSize: "0.85rem",
                              letterSpacing: 0.5,
                              textTransform: "uppercase",
                              color: "text.secondary",
                           }}
                        >
                           Class Supports Files
                        </Typography>
                        <Box
                           sx={{
                              display: "flex",
                              justifyContent: "center",
                              gap: 2.5,
                              p: 1.5,
                              backgroundColor: "rgba(0, 0, 0, 0.02)",
                              borderRadius: 1.5,
                              border: "1px solid rgba(0, 0, 0, 0.08)",
                           }}
                        >
                           <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              <Box
                                 sx={{
                                    width: 14,
                                    height: 14,
                                    backgroundColor: "#FF6B6B",
                                    borderRadius: "50%",
                                    boxShadow: "0 2px 4px rgba(255, 107, 107, 0.3)",
                                 }}
                              />
                              <Typography
                                 variant="caption"
                                 sx={{
                                    fontWeight: 600,
                                    fontSize: "0.75rem",
                                    color: "text.secondary",
                                 }}
                              >
                                 GENERATED
                              </Typography>
                           </Box>
                        </Box>
                     </Box>

                     {/* Files List Section */}
                     <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                        {classSupportsFiles.length > 0 ? (
                           <Paper
                              elevation={1}
                              sx={{
                                 flex: 1,
                                 overflow: "hidden",
                                 display: "flex",
                                 flexDirection: "column",
                                 borderRadius: 2,
                                 border: "1px solid rgba(0, 0, 0, 0.08)",
                              }}
                           >
                              <Box
                                 sx={{
                                    flex: 1,
                                    overflowY: "auto",
                                    p: 1,
                                    "&::-webkit-scrollbar": {
                                       width: "6px",
                                    },
                                    "&::-webkit-scrollbar-track": {
                                       background: "rgba(0, 0, 0, 0.05)",
                                       borderRadius: "3px",
                                    },
                                    "&::-webkit-scrollbar-thumb": {
                                       background: "rgba(0, 0, 0, 0.2)",
                                       borderRadius: "3px",
                                       "&:hover": {
                                          background: "rgba(0, 0, 0, 0.3)",
                                       },
                                    },
                                 }}
                              >
                                 <List disablePadding>
                                    {classSupportsFiles.map((file, index) => (
                                       <ListItem
                                          key={index}
                                          onClick={() => onSelectClassSupportFile(index)}
                                          sx={{
                                             cursor: "pointer",
                                             p: 1.25,
                                             mb: 0.75,
                                             border: "1px solid",
                                             borderColor:
                                                selectedClassSupportFileIndex === index
                                                   ? "#667eea"
                                                   : "rgba(0, 0, 0, 0.1)",
                                             borderRadius: "8px",
                                             background:
                                                selectedClassSupportFileIndex === index
                                                   ? "linear-gradient(135deg, rgba(102, 126, 234, 0.08) 0%, rgba(118, 75, 162, 0.08) 100%)"
                                                   : "transparent",
                                             transition: "all 0.2s ease",
                                             "&:hover": {
                                                borderColor: "#667eea",
                                                background:
                                                   selectedClassSupportFileIndex === index
                                                      ? "linear-gradient(135deg, rgba(102, 126, 234, 0.12) 0%, rgba(118, 75, 162, 0.12) 100%)"
                                                      : "rgba(102, 126, 234, 0.04)",
                                                transform: "translateX(2px)",
                                                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                                             },
                                          }}
                                       >
                                          {selectedClassSupportFileIndex === index && (
                                             <Box
                                                sx={{
                                                   mr: 1,
                                                   width: 4,
                                                   height: 20,
                                                   backgroundColor: "#667eea",
                                                   borderRadius: "2px",
                                                }}
                                             />
                                          )}
                                          <ListItemText
                                             primary={
                                                <Typography
                                                   variant="body2"
                                                   sx={{
                                                      fontWeight: 600,
                                                      fontSize: "0.9rem",
                                                      color: "#333",
                                                      overflow: "hidden",
                                                      textOverflow: "ellipsis",
                                                   }}
                                                >
                                                   {file.substring(file.lastIndexOf("/") + 1)}
                                                </Typography>
                                             }
                                             secondary={
                                                <Typography
                                                   variant="caption"
                                                   sx={{
                                                      fontSize: "0.75rem",
                                                      color: "text.secondary",
                                                      fontWeight: 500,
                                                   }}
                                                >
                                                   Crop size:{" "}
                                                   <span style={{ fontWeight: 700, color: "#667eea" }}>
                                                      {getCropSize(file)}
                                                   </span>
                                                </Typography>
                                             }
                                             sx={{
                                                m: 0,
                                                overflow: "hidden",
                                             }}
                                          />
                                       </ListItem>
                                    ))}
                                 </List>
                              </Box>
                           </Paper>
                        ) : (
                           <Paper
                              elevation={1}
                              sx={{
                                 p: 2.5,
                                 display: "flex",
                                 alignItems: "center",
                                 justifyContent: "center",
                                 borderRadius: 2,
                                 border: "2px dashed rgba(0, 0, 0, 0.1)",
                                 backgroundColor: "rgba(0, 0, 0, 0.02)",
                                 minHeight: 150,
                              }}
                           >
                              <Typography
                                 variant="body2"
                                 sx={{
                                    color: "text.secondary",
                                    fontWeight: 500,
                                    textAlign: "center",
                                 }}
                              >
                                 No Class Supports Files
                              </Typography>
                           </Paper>
                        )}
                     </Box>
                  </Box>
               </Grid>
            </Grid>
         </Paper>
      </>
   );
};

export default OptimizeClassSupports;

export function clientLoader({ params }: any) {
   return { pipeid: params.id };
}
clientLoader.hydrate = true;
