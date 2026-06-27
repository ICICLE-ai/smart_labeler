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
   IconButton,
   Breadcrumbs,
   Link,
} from "@mui/material";
import ImageIcon from "@mui/icons-material/Image";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import PhotoLibraryOutlinedIcon from "@mui/icons-material/PhotoLibraryOutlined";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import FormikTapisFileWrapper from "~/components/FileExplorer/FormikTapisFileWrapper";
import { Formik } from "formik";
import { Group, Select } from "@mantine/core";
import { SubmitButton } from "../formik-mantine";
import { allowed_systems, DEFAULT_SYSTEM, fetchAndReturnData, getImage, getImages, sanitizePath } from "~/utils/utils";
import { useCookies } from "react-cookie";
// import { systems } from "./utils";

const PAGE_SIZE: number = 15;

interface FileExplorerProps {
   onFileSelect: (file: any, filePath: string) => void;
   filesInDirectory: (files: string[], system: string, isRootReset?: boolean) => void;
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
   // current directory's image files (display/pagination only)
   const [files, setFiles] = useState<string[]>([]);
   const [dirs, setDirs] = useState<Array<{ name: string; path: string }>>([]);
   const [currentPath, setCurrentPath] = useState<string>("");
   const [pathHistory, setPathHistory] = useState<string[]>([]);
   // rootPath is the top-most directory the user entered — navigation cannot go above it
   const [rootPath, setRootPath] = useState<string>("");
   const [page, setPage] = useState<number>(1);
   // path-based selection — no indices, so navigation never scrambles the highlight
   const [selectedPath, setSelectedPath] = useState<string | null>(null);
   const [loadingPath, setLoadingPath] = useState<string | null>(null);

   // Tapis form state
   const [system, setSystem] = useState<string | null>(parentSystem ?? DEFAULT_SYSTEM);
   const [srcImgDir, setSrcImgDir] = useState<string | null>(null);
   const [cookie] = useCookies(["tapis-token"]);

   // Image cache keyed by file path → object URL — persists across directory navigation
   const pageCacheRef = useRef<Map<string, string>>(new Map());
   // Directory listing cache keyed by path — makes back-navigation instant
   const dirCacheRef = useRef<Map<string, { dirs: Array<{ name: string; path: string }>; files: string[] }>>(new Map());
   // Navigation counter — incremented on every fetchDirContents call; stale fetches check against it and discard results
   const navCounterRef = useRef<number>(0);
   // AbortController for the current image-prefetch batch — aborted when navigating away
   const prefetchAbortRef = useRef<AbortController | null>(null);
   const currentPageRef = useRef<number>(0);
   const [pageLoading, setPageLoading] = useState<boolean>(false);
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

   const isImageFile = (filename: string): boolean =>
      [".jpg", ".jpeg", ".png", ".tiff", ".tif", ".gif", ".bmp", ".webp"].some(
         (ext) => filename.toLowerCase().endsWith(ext)
      );

   // Prefetch when directory changes — image cache is preserved across directories.
   useEffect(() => {
      currentPageRef.current = 1;
      triggerPagePrefetch(null);
   }, [files]);

   // Auto-select the first image when navigating into a new directory.
   useEffect(() => {
      if (files.length > 0 && selectedPath === null) {
         onSelectFile(files[0]);
      }
   }, [files]);

   // Background-prefetch uncached images on the current page.
   // excludePath = the file currently being fetched by onSelectFile (skip it).
   const triggerPagePrefetch = (excludePath: string | null) => {
      if (!system || files.length === 0) return;

      currentPageRef.current = page;

      // Give this prefetch batch its own abort controller so navigating away can cancel it.
      const controller = new AbortController();
      prefetchAbortRef.current = controller;

      const thisPage = page;
      const start = (thisPage - 1) * PAGE_SIZE;
      const pageFiles = files.slice(start, start + PAGE_SIZE);

      const toFetch = pageFiles.filter(
         (f) => f !== excludePath && isImageFile(f) && !pageCacheRef.current.has(f)
      );
      if (toFetch.length === 0) return;

      setPageLoading(true);
      getImages(toFetch, pipeid, system, cookieRef.current, controller.signal)
         .then((urlMap) => {
            if (currentPageRef.current !== thisPage) {
               urlMap.forEach((url) => URL.revokeObjectURL(url));
               return;
            }
            urlMap.forEach((url, path) => pageCacheRef.current.set(path, url));
         })
         .catch((e) => { if (e?.name !== "AbortError") console.error("Background page prefetch failed:", e); })
         .finally(() => { if (currentPageRef.current === thisPage) setPageLoading(false); });
   };

   useEffect(() => {
      if (fileDir && system) {
         setRootPath(fileDir);
         fetchDirContents(fileDir, system, false);
      }
   }, [fileDir, system]);

   const fetchDirContents = async (dirPath: string, sys: string, isRootReset = false, onDone?: () => void) => {
      if (!dirPath || !sys) return;

      // Stamp this navigation so any older in-flight fetch can detect it's been superseded.
      const navId = ++navCounterRef.current;

      // Cancel image downloads that belong to the previous directory.
      prefetchAbortRef.current?.abort();
      prefetchAbortRef.current = null;

      // On a new root directory, evict the entire dir cache (stale listings).
      if (isRootReset) dirCacheRef.current.clear();

      // Serve from cache — makes back-navigation and breadcrumb clicks instant.
      const cached = dirCacheRef.current.get(dirPath);
      if (cached) {
         if (navId !== navCounterRef.current) return; // superseded while we checked the cache
         setFiles(cached.files);
         setDirs(cached.dirs);
         filesInDirectory(cached.files, sys, isRootReset);
         setPage(1);
         setSelectedPath(null);
         setCurrentPath(dirPath);
         onDone?.();
         return;
      }

      setPageLoading(true);
      const encodedPath = encodeURIComponent(sanitizePath(dirPath));
      try {
         const res = await fetchAndReturnData(
            `/get-dir-contents/${pipeid}/${sys}?dir=${encodedPath}`,
            cookie["tapis-token"]["access_token"]
         );
         // Another navigation started while we were waiting — discard these results.
         if (navId !== navCounterRef.current) return;
         if (!res) return;
         const newFiles: string[] = (res["imgs"] ?? []).map((f: string) => "/" + f.replace("tapis:/", ""));
         const newDirs: Array<{ name: string; path: string }> = res["dirs"] ?? [];
         dirCacheRef.current.set(dirPath, { dirs: newDirs, files: newFiles });
         setFiles(newFiles);
         setDirs(newDirs);
         filesInDirectory(newFiles, sys, isRootReset);
         setPage(1);
         setSelectedPath(null);
         setCurrentPath(dirPath);
         onDone?.();
      } catch (err) {
         if (navId === navCounterRef.current) console.error("Error fetching directory contents:", err);
      } finally {
         if (navId === navCounterRef.current) setPageLoading(false);
      }
   };

   const navigateInto = (dir: { name: string; path: string }) => {
      const cleanPath = "/" + dir.path.replace("tapis:/", "");
      setPathHistory((h) => [...h, currentPath]);
      fetchDirContents(cleanPath, system ?? "", false);
   };

   const navigateBack = () => {
      const prev = pathHistory[pathHistory.length - 1];
      if (prev === undefined) return;
      // Never navigate above the root directory the user entered
      if (rootPath && !prev.startsWith(rootPath)) return;
      setPathHistory((h) => h.slice(0, -1));
      fetchDirContents(prev, system ?? "", false);
   };

   // filePath is the file's path string — the parent uses this as the annotation key.
   const onSelectFile = (filePath: string) => {
      if (!filePath || !isImageFile(filePath)) return;

      setSelectedPath(filePath);

      const cached = pageCacheRef.current.get(filePath);
      if (cached) {
         onFileSelect(cached, filePath);
         return;
      }

      triggerPagePrefetch(filePath);

      setLoadingPath(filePath);
      getImage(filePath, pipeid, system ?? "", cookie)
         .then((url) => {
            pageCacheRef.current.set(filePath, url);
            onFileSelect(url, filePath);
         })
         .catch((error) => console.error("Error fetching image:", error))
         .finally(() => setLoadingPath(null));
   };

   const handleSubmit = (values: { srcImgDir: string; system: string }) => {
      const dir = sanitizePath(values.srcImgDir);
      if (!dir) { alert("Please select a source image directory."); return; }
      setSrcImgDir(dir);
      setRootPath(dir);
      setPathHistory([]);
      fetchDirContents(dir, system ?? "", true, () => onDirectorySubmit?.(dir, system ?? ""));
   };

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
            {(files.length > 0 || dirs.length > 0) && (
               <Chip
                  label={`${dirs.length > 0 ? `${dirs.length} dir${dirs.length !== 1 ? "s" : ""}, ` : ""}${files.length} img${files.length !== 1 ? "s" : ""}`}
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
                              defaultValue={DEFAULT_SYSTEM}
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

         {/* Breadcrumb / back navigation */}
         {currentPath && (
            <Box
               sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  px: 1,
                  py: 0.5,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  bgcolor: "grey.50",
                  minHeight: 36,
               }}
            >
               {pathHistory.length > 0 && (
                  <Tooltip title="Go back">
                     <IconButton size="small" onClick={navigateBack} sx={{ p: 0.25 }}>
                        <ArrowBackIcon fontSize="small" />
                     </IconButton>
                  </Tooltip>
               )}
               <Breadcrumbs maxItems={3} sx={{ fontSize: "0.72rem", flex: 1, overflow: "hidden" }}>
                  {(() => {
                     const rootSegmentCount = rootPath.split("/").filter(Boolean).length;
                     return currentPath.split("/").filter(Boolean).map((segment, idx, arr) => {
                        // Hide segments that belong to directories above the root
                        if (idx < rootSegmentCount - 1) return null;
                        const isLast = idx === arr.length - 1;
                        return isLast ? (
                           <Typography key={idx} variant="caption" fontWeight={600} noWrap sx={{ maxWidth: 120 }}>
                              {segment}
                           </Typography>
                        ) : (
                           <Link
                              key={idx}
                              component="button"
                              variant="caption"
                              underline="hover"
                              color="inherit"
                              sx={{ maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", display: "block", whiteSpace: "nowrap" }}
                              onClick={() => {
                                 const targetPath = "/" + arr.slice(0, idx + 1).join("/");
                                 const stepsBack = arr.length - 1 - idx;
                                 const newHistory = pathHistory.slice(0, pathHistory.length - stepsBack + 1);
                                 setPathHistory(newHistory.slice(0, -1));
                                 fetchDirContents(targetPath, system ?? "");
                              }}
                           >
                              {segment}
                           </Link>
                        );
                     });
                  })()}
               </Breadcrumbs>
            </Box>
         )}

         {/* File list */}
         <Box sx={{ flex: 1, overflow: "auto", px: 1, py: 0.5 }}>
            {dirs.length === 0 && files.length === 0 ? (
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
                  {/* Directories */}
                  {dirs.map((dir) => (
                     <Tooltip key={dir.path} title={dir.path} placement="right" arrow>
                        <ListItemButton
                           onClick={() => navigateInto(dir)}
                           sx={{ borderRadius: 1, mb: 0.25, px: 1, py: 0.75 }}
                        >
                           <Box sx={{ mr: 1.5, color: "warning.main", display: "flex", alignItems: "center" }}>
                              <FolderOpenIcon fontSize="small" />
                           </Box>
                           <ListItemText
                              primary={
                                 <Typography variant="body2" noWrap title={dir.name}>
                                    {dir.name}
                                 </Typography>
                              }
                           />
                        </ListItemButton>
                     </Tooltip>
                  ))}

                  {/* Images */}
                  {pagedFiles.map((file) => {
                     const isSelected = selectedPath === file;
                     const isImg = isImageFile(file);
                     const isLoading = loadingPath === file;
                     const filename = file.split("/").at(-1) ?? file;

                     return (
                        <Tooltip
                           key={file}
                           title={isImg ? file : "Not a supported image format"}
                           placement="right"
                           arrow
                        >
                           <ListItemButton
                              selected={isSelected}
                              onClick={() => onSelectFile(file)}
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
