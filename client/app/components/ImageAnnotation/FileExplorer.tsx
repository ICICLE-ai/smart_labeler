import React, { useState, useRef, useMemo, useEffect } from "react";
import {
   Box,
   Typography,
   Pagination,
   Paper,
   Stack,
   Chip,
   List,
   ListItemButton,
   ListItemText,
   Tooltip,
   CircularProgress,
   LinearProgress,
   alpha,
} from "@mui/material";
import ImageIcon from "@mui/icons-material/Image";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import PhotoLibraryOutlinedIcon from "@mui/icons-material/PhotoLibraryOutlined";
import FormikTapisFileWrapper from "~/components/FileExplorer/FormikTapisFileWrapper";
import { Formik } from "formik";
import { Group, Select } from "@mantine/core";
import { SubmitButton } from "../formik-mantine";
import { allowed_systems, fetchAndReturnData, getImage, getImages, sanitizePath } from "~/utils/utils";
import { useCookies } from "react-cookie";
// import { systems } from "./utils";

const PAGE_SIZE: number = 15;

interface FileExplorerProps {
   onFileSelect: (file: any, index: number) => void;
   filesInDirectory: (files: string[], system: string) => void;
   pipeid: string;
   fileDir?: string;
   parentSystem?: string;
   onDirectorySubmit?: (srcImgDir: string, system: string) => void;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
   onFileSelect,
   filesInDirectory,
   pipeid,
   fileDir,
   parentSystem,
   onDirectorySubmit,
}) => {
   const [files, setFiles] = useState<string[]>([]);
   const fileInputRef = useRef<HTMLInputElement>(null);
   const [page, setPage] = useState<number>(1);
   const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
   const [loadingIndex, setLoadingIndex] = useState<number | null>(null);

   // Tapis form state
   const [system, setSystem] = useState<string | null>(parentSystem ?? null);
   const [srcImgDir, setSrcImgDir] = useState<string | null>(null);
   const [cookie, setCookie] = useCookies(["tapis-token"]);

   // Page-level image cache: absolute file index → object URL
   const pageCacheRef = useRef<Map<number, string>>(new Map());
   // Tracks which page's prefetch is active so stale fetches can self-discard
   const currentPageRef = useRef<number>(0);
   const [pageLoading, setPageLoading] = useState<boolean>(false);
   // Keep latest cookie in a ref so the prefetch effect doesn't need it as a dep
   const cookieRef = useRef(cookie);
   useEffect(() => { cookieRef.current = cookie; });

   useEffect(() => {
      if (parentSystem) setSystem(parentSystem);
   }, [parentSystem]);

   const pagedFiles = useMemo(() => {
      const start = (page - 1) * PAGE_SIZE;
      return files.slice(start, start + PAGE_SIZE);
   }, [files, page]);

   const pageCount = Math.max(1, Math.ceil(files.length / PAGE_SIZE));
   // TODO : update this later

   const isImageFile = (filename: string): boolean => {
      const imageExtensions = [
         ".jpg",
         ".jpeg",
         ".png",
         ".tiff",
         ".tif",
         ".gif",
         ".bmp",
         ".webp",
      ];
      return imageExtensions.some((ext) =>
         filename.toLowerCase().endsWith(ext)
      );
   };

   // Clear cache when page or file list changes to free blob URL memory.
   // Actual fetching is deferred until the user clicks an image.
   useEffect(() => {
      currentPageRef.current = 1;
      pageCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      pageCacheRef.current = new Map();
      triggerPagePrefetch(0); // -1 indicates no clicked index, just prefetch the first page
   }, [files]);

   // Automatically select and load the first file (index 0) when files are loaded
   useEffect(() => {
      if (files.length > 0 && selectedIndex === null) {
         onSelectFile(0);
      }
   }, [files]);

   // Background-fetch all uncached images on the current page except the one
   // that was just clicked (already being handled by onSelectFile).
   const triggerPagePrefetch = (clickedIndex: number) => {
      if (!system || files.length === 0) return;

      currentPageRef.current = page;
      pageCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      pageCacheRef.current = new Map();

      const thisPage = page;
      const start = (thisPage - 1) * PAGE_SIZE;
      const pageFiles = files.slice(start, start + PAGE_SIZE);

      const imageEntries: Array<{ abs: number; path: string }> = [];
      pageFiles.forEach((file, i) => {
         const abs = start + i;
         if (abs !== clickedIndex && isImageFile(file) && !pageCacheRef.current.has(abs)) {
            imageEntries.push({ abs, path: file });
         }
      });

      if (imageEntries.length === 0) return;

      setPageLoading(true);

      getImages(
         imageEntries.map((e) => e.path),
         pipeid,
         system,
         cookieRef.current
      )
         .then((urlMap) => {
            if (currentPageRef.current !== thisPage) {
               urlMap.forEach((url) => URL.revokeObjectURL(url));
               return;
            }
            imageEntries.forEach(({ abs, path }) => {
               const url = urlMap.get(path);
               if (url) pageCacheRef.current.set(abs, url);
            });
         })
         .catch((e) => console.error("Background page prefetch failed:", e))
         .finally(() => {
            if (currentPageRef.current === thisPage) setPageLoading(false);
         });
   };

   useEffect(() => {
      if (fileDir && system) {
         fetchImages({ srcImgDir: fileDir ?? "", system: system ?? "" });
      }
   }, [fileDir, system]);

   const onSelectFile = (index: number) => {
      const file = files[index];
      if (!file || !isImageFile(file)) return;

      setSelectedIndex(index);

      // Kick off background prefetch for the rest of the page in parallel

      const cached = pageCacheRef.current.get(index);
      if (cached) {
         // Instant cache hit — no loading indicator needed
         onFileSelect(cached, index);
         return;
      }

      const newPage = Math.floor(index / PAGE_SIZE) + 1;
      if (newPage !== page || newPage !== currentPageRef.current) {
         triggerPagePrefetch(index);
      }

      // Cache miss — fetch this image immediately
      setLoadingIndex(index);
      getImage(file, pipeid, system ?? "", cookie)
         .then((url) => {
            pageCacheRef.current.set(index, url);
            onFileSelect(url, index);
         })
         .catch((error) => console.error("Error fetching image:", error))
         .finally(() => setLoadingIndex(null));
   };

   const handleSubmit = (values: { srcImgDir: string; system: string }) => {
      setSrcImgDir(values.srcImgDir);
      fetchImages(values, true);
   };

   const fetchImages = async (values: {
      srcImgDir: string;
      system: string;
   }, userSubmit = false) => {
      const srcImgDir = sanitizePath(values.srcImgDir);
      try {
         if (!srcImgDir) {
            alert("Please select a source image directory.");
            return;
         }
         setPageLoading(true);
         const ecodedPath = encodeURIComponent(srcImgDir);
         await fetchAndReturnData(
            `/get-imgs-in-dir/${pipeid}/${system}?dir=${ecodedPath}`,
            cookie["tapis-token"]["access_token"]
         )
            .then(async (res) => {
               if (!res) {
                  alert(
                     "Failed to fetch images. Please check the source directory."
                  );
                  return;
               }

               if (!res["imgs"] || res["imgs"].length === 0) {
                  alert(
                     "Failed to fetch images. Please check the source directory."
                  );
                  return;
               }
               setFiles(res["imgs"].map((f: string) => "/" + f.replace("tapis:/", "")));
               filesInDirectory(res["imgs"].map((f: string) => "/" + f.replace("tapis:/", "")), system ?? "");
               if (userSubmit) onDirectorySubmit?.(srcImgDir, system ?? "");
               setPage(1);
               setSelectedIndex(null);
            })
            .catch((error) => {
               console.error("Error fetching images:", error);
            })
            .finally(() => setPageLoading(false));
      } catch (error) {
         console.error("Error fetching images:", error);
      }
   };

   const absoluteIndexFor = (localIndex: number): number =>
      (page - 1) * PAGE_SIZE + localIndex;

   return (
      <Paper
         elevation={2}
         sx={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            borderRadius: 2,
            border: "1px solid",
            borderColor: "divider",
         }}
      >
         {/* Header */}
         <Box
            sx={{
               px: 2,
               py: 1.5,
               display: "flex",
               alignItems: "center",
               gap: 1,
               borderBottom: "1px solid",
               borderColor: "divider",
               bgcolor: "grey.50",
            }}
         >
            <FolderOpenIcon fontSize="small" sx={{ color: "primary.main" }} />
            <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>
               File Explorer
            </Typography>
            {files.length > 0 && (
               <Chip
                  label={`${files.length} file${files.length !== 1 ? "s" : ""}`}
                  size="small"
                  color="primary"
                  variant="outlined"
                  sx={{ fontSize: "0.7rem", height: 20 }}
               />
            )}
         </Box>

         {/* Form section — only shown when the parent allows directory changes */}
         {onDirectorySubmit && (
            <Box
               sx={{
                  px: 2,
                  pt: 2,
                  pb: 1,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  bgcolor: "background.paper",
               }}
            >
               <Formik
                  enableReinitialize
                  initialValues={{ srcImgDir: fileDir ?? "", system: "" }}
                  onSubmit={(values) => handleSubmit(values)}
               >
                     <form style={{ width: "100%" }}>
                        <Stack spacing={1.5}>
                           <Select
                              mt="md"
                              comboboxProps={{ withinPortal: true, zIndex: 1301 }}
                              data={allowed_systems}
                              label="System"
                              placeholder="Pick one System"
                              defaultValue="ascend-tapis"
                              value={system}
                              name="system"
                              onChange={(value, option) => setSystem(value ?? "")}
                           />

                           <FormikTapisFileWrapper
                              name="srcImgDir"
                              label="Source Image Directory"
                              required={false}
                              description="Enter full path to source image directory"
                              placeholder="path/to/source-directory"
                              systemId={system ?? ""}
                              disabled={!system}
                              files={false}
                              dirs={true}
                           />

                           <Group>
                              <SubmitButton style={{ width: "100%" }}>
                                 Get Images
                              </SubmitButton>
                           </Group>
                        </Stack>
                     </form>
                  </Formik>
                  <Typography
                     variant="caption"
                     sx={{ display: "block", mt: 1, color: "text.disabled" }}
                  >
                     Tip: Select a directory of images. Non-image files will be listed but won't preview.
                  </Typography>
            </Box>
         )}

         {/* Floating load indicator — sits above the scrollable list */}
         {pageLoading && (
            <LinearProgress
               variant="indeterminate"
               sx={{ borderRadius: 0, height: 3 }}
            />
         )}

         {/* File list */}
         <Box sx={{ flex: 1, overflow: "auto", px: 1, py: 0.5 }}>
            {files.length === 0 ? (
               <Stack
                  alignItems="center"
                  justifyContent="center"
                  spacing={1}
                  sx={{ height: "100%", py: 4, color: "text.disabled" }}
               >
                  <PhotoLibraryOutlinedIcon sx={{ fontSize: 40, opacity: 0.4 }} />
                  <Typography variant="body2" align="center" color="text.disabled">
                     No files loaded.
                     {!fileDir && (
                        <>
                           {" "}Select a system and directory above,
                           <br />then click <strong>Get Images</strong>.
                        </>
                     )}
                  </Typography>
               </Stack>
            ) : (
               <List dense disablePadding>
                  {pagedFiles.map((file, i) => {
                     const abs = absoluteIndexFor(i);
                     const isSelected = selectedIndex === abs;
                     const isImg = isImageFile(file);
                     const isLoading = loadingIndex === abs;
                     const filename = file.split("/").at(-1) ?? file;

                     return (
                        <Tooltip
                           key={`${filename}-${abs}`}
                           title={isImg ? file : "Not a supported image format"}
                           placement="right"
                           arrow
                        >
                           <ListItemButton
                              selected={isSelected}
                              onClick={() => onSelectFile(abs)}
                              disabled={!isImg}
                              sx={{
                                 borderRadius: 1,
                                 mb: 0.25,
                                 px: 1,
                                 py: 0.75,
                                 opacity: isImg ? 1 : 0.45,
                                 "&.Mui-selected": {
                                    bgcolor: (theme) =>
                                       alpha(theme.palette.primary.main, 0.12),
                                    "&:hover": {
                                       bgcolor: (theme) =>
                                          alpha(theme.palette.primary.main, 0.18),
                                    },
                                 },
                              }}
                           >
                              <Box
                                 sx={{
                                    mr: 1.5,
                                    color: isSelected
                                       ? "primary.main"
                                       : isImg
                                          ? "action.active"
                                          : "action.disabled",
                                    display: "flex",
                                    alignItems: "center",
                                 }}
                              >
                                 {isImg ? (
                                    <ImageIcon fontSize="small" />
                                 ) : (
                                    <InsertDriveFileOutlinedIcon fontSize="small" />
                                 )}
                              </Box>
                              <ListItemText
                                 primary={
                                    <Typography
                                       variant="body2"
                                       fontWeight={isSelected ? 600 : 400}
                                       noWrap
                                       title={filename}
                                    >
                                       {filename}
                                    </Typography>
                                 }
                              />
                              {isLoading && (
                                 <CircularProgress size={14} sx={{ ml: 1, flexShrink: 0 }} />
                              )}
                           </ListItemButton>
                        </Tooltip>
                     );
                  })}
               </List>
            )}
         </Box>

         {/* Pagination footer */}
         {files.length > 0 && (
            <Box
               sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  px: 2,
                  py: 1,
                  borderTop: "1px solid",
                  borderColor: "divider",
                  bgcolor: "grey.50",
               }}
            >
               <Typography variant="caption" color="text.disabled">
                  {(page - 1) * PAGE_SIZE + 1}–
                  {Math.min(page * PAGE_SIZE, files.length)} of {files.length}
               </Typography>
               <Pagination
                  count={pageCount}
                  page={page}
                  onChange={(_, v) => setPage(v)}
                  size="small"
                  siblingCount={0}
                  boundaryCount={1}
               />
            </Box>
         )}
      </Paper>
   );
};
