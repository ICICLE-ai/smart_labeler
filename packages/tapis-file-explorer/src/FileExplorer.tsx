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
import { Formik } from "formik";
import { Group, Select } from "@mantine/core";
import { SubmitButton } from "./SubmitButton";
import { TapisDirectoryField } from "./TapisDirectoryField";
import { allowed_systems, DEFAULT_SYSTEM, getDirContentsFromTapis, getImage, sanitizePath } from "./tapisClient";

const PAGE_SIZE: number = 15;

export interface FileExplorerProps {
   onFileSelect: (file: any, filePath: string) => void;
   filesInDirectory: (files: string[], system: string, isRootReset?: boolean) => void;
   /** Identifies the pipeline/job this browsing session belongs to (used on the TIFF-conversion route). */
   pipeid: string;
   /** Auth token forwarded to every Tapis request this component makes. */
   token: string;
   fileDir?: string;
   parentSystem?: string;
   onDirectorySubmit?: (srcImgDir: string, system: string) => void;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
   onFileSelect,
   filesInDirectory,
   pipeid,
   token,
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

   // Image cache keyed by file path → object URL — persists across directory navigation
   const pageCacheRef = useRef<Map<string, string>>(new Map());
   // Directory listing cache keyed by path — makes back-navigation instant
   const dirCacheRef = useRef<Map<string, { dirs: Array<{ name: string; path: string }>; files: string[] }>>(new Map());
   // Navigation counter — incremented on every fetchDirContents call; stale fetches check against it and discard results
   const navCounterRef = useRef<number>(0);
   // AbortController for the current image-prefetch batch — aborted when navigating away
   const prefetchAbortRef = useRef<AbortController | null>(null);
   // AbortController for the currently-loading selected image — aborted when the user navigates before it finishes
   const selectAbortRef = useRef<AbortController | null>(null);
   // Paths currently being fetched by an active prefetch batch — used to skip duplicates
   const inflightPrefetchRef = useRef<Set<string>>(new Set());
   const currentPageRef = useRef<number>(0);
   const [pageLoading, setPageLoading] = useState<boolean>(false);
   const tokenRef = useRef(token);
   useEffect(() => { tokenRef.current = token; });

   // Refs that the keydown handler reads so it always sees the latest values
   // without needing to be re-attached on every selection change.
   const selectedPathRef = useRef<string | null>(selectedPath);
   const loadingPathRef = useRef<string | null>(loadingPath);
   const filesRef = useRef<string[]>(files);
   const onSelectFileRef = useRef<((filePath: string) => void) | null>(null);
   // Sync on every render (plain assignment, not a hook)
   selectedPathRef.current = selectedPath;
   loadingPathRef.current = loadingPath;
   filesRef.current = files;

   useEffect(() => {
      if (parentSystem) setSystem(parentSystem);
   }, [parentSystem]);

   // Attached once; reads live state via refs — no stale-closure skipped steps
   // on rapid keypresses.
   useEffect(() => {
      const handleKey = (event: KeyboardEvent) => {
         if (loadingPathRef.current) return;

         if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;

         if (event.ctrlKey || event.metaKey || event.altKey) return;

         const target = event.target as HTMLElement | null;
         if (
            target &&
            (target.tagName === "INPUT" ||
               target.tagName === "TEXTAREA" ||
               target.isContentEditable)
         ) {
            return;
         }

         const currentFiles = filesRef.current;
         if (currentFiles.length === 0) return;

         let currentIdx = currentFiles.indexOf(selectedPathRef.current ?? "");
         if (currentIdx === -1) currentIdx = 0;

         let targetIdx = currentIdx;
         if (event.key === "ArrowRight")
            targetIdx = Math.min(currentIdx + 1, currentFiles.length - 1);
         else
            targetIdx = Math.max(currentIdx - 1, 0);

         if (targetIdx === currentIdx) return;

         event.preventDefault();
         onSelectFileRef.current?.(currentFiles[targetIdx]);
         setPage(Math.floor(targetIdx / PAGE_SIZE) + 1);
      };

      window.addEventListener("keydown", handleKey);
      return () => window.removeEventListener("keydown", handleKey);
   // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);

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
      prefetchPageInBackground(2, null);
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
         (f) =>
            f !== excludePath &&
            isImageFile(f) &&
            !pageCacheRef.current.has(f) &&
            !inflightPrefetchRef.current.has(f)   // skip files already being fetched
      );
      if (toFetch.length === 0) return;

      // Mark these paths as in-flight before any async work starts.
      toFetch.forEach((f) => inflightPrefetchRef.current.add(f));

      setPageLoading(true);

      // Fire all fetches in parallel. Each image is written to the cache the moment
      // it arrives — callers don't have to wait for the slowest image in the batch.
      const perFile = toFetch.map((f) =>
         getImage(f, pipeid, system, tokenRef.current, controller.signal)
            .then((url) => {
               if (currentPageRef.current !== thisPage) {
                  URL.revokeObjectURL(url);
               } else {
                  pageCacheRef.current.set(f, url);
               }
            })
            .catch((e) => { if (e?.name !== "AbortError") console.error(`Prefetch failed for ${f}:`, e); })
            .finally(() => { inflightPrefetchRef.current.delete(f); })
      );

      Promise.all(perFile).finally(() => {
         if (currentPageRef.current === thisPage) setPageLoading(false);
      });
   };

   // Evict cached images for pages outside the [centerPage-1, centerPage, centerPage+1] window.
   const evictPagesOutsideWindow = (centerPage: number) => {
      const windowStartIdx = (Math.max(1, centerPage - 1) - 1) * PAGE_SIZE;
      const windowEndIdx = (centerPage + 1) * PAGE_SIZE;
      for (const [filePath, url] of pageCacheRef.current.entries()) {
         const idx = files.indexOf(filePath);
         if (idx === -1 || idx < windowStartIdx || idx >= windowEndIdx) {
            URL.revokeObjectURL(url);
            pageCacheRef.current.delete(filePath);
         }
      }
   };

   // Prefetch a specific page in the background (no loading indicator).
   const prefetchPageInBackground = (targetPage: number, excludePath: string | null) => {
      if (!system || files.length === 0) return;
      const maxPage = Math.ceil(files.length / PAGE_SIZE);
      if (targetPage < 1 || targetPage > maxPage) return;

      if (!prefetchAbortRef.current) prefetchAbortRef.current = new AbortController();
      const { signal } = prefetchAbortRef.current;

      const start = (targetPage - 1) * PAGE_SIZE;
      const toFetch = files.slice(start, start + PAGE_SIZE).filter(
         (f) =>
            f !== excludePath &&
            isImageFile(f) &&
            !pageCacheRef.current.has(f) &&
            !inflightPrefetchRef.current.has(f)
      );
      if (toFetch.length === 0) return;

      toFetch.forEach((f) => inflightPrefetchRef.current.add(f));
      toFetch.forEach((f) =>
         getImage(f, pipeid, system, tokenRef.current, signal)
            .then((url) => { pageCacheRef.current.set(f, url); })
            .catch((e) => { if (e?.name !== "AbortError") console.error(`Prefetch failed for ${f}:`, e); })
            .finally(() => { inflightPrefetchRef.current.delete(f); })
      );
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

      // Cancel image downloads that belong to the previous directory and clear their in-flight tracking.
      prefetchAbortRef.current?.abort();
      prefetchAbortRef.current = null;
      inflightPrefetchRef.current.clear();

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
      try {
         const res = await getDirContentsFromTapis(
            sanitizePath(dirPath),
            sys,
            tokenRef.current,
         );
         // Another navigation started while we were waiting — discard these results.
         if (navId !== navCounterRef.current) return;
         const newFiles: string[] = res.imgs.map((f: string) => "/" + f.replace(/^\/+/, ""));
         const newDirs: Array<{ name: string; path: string }> = res.dirs;
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
      // Already fetching this exact file — don't abort and restart the same request.
      if (filePath === loadingPathRef.current) return;

      // Abort any in-flight fetch and clear loading state before anything else.
      // Without this clear, navigating to a cached file after an aborted request
      // leaves loadingPath truthy indefinitely, blocking keyboard shortcuts.
      selectAbortRef.current?.abort();
      selectAbortRef.current = null;
      setLoadingPath(null);

      setSelectedPath(filePath);
      // Immediately notify parent so it can update annotation index before the image arrives.
      onFileSelect(null, filePath);

      // Sliding window: keep [clickedPage-1, clickedPage, clickedPage+1] in cache.
      const fileIdx = files.indexOf(filePath);
      if (fileIdx !== -1) {
         const clickedPage = Math.floor(fileIdx / PAGE_SIZE) + 1;
         evictPagesOutsideWindow(clickedPage);
         prefetchPageInBackground(clickedPage + 1, filePath);
      }

      const cached = pageCacheRef.current.get(filePath);
      if (cached) {
         onFileSelect(cached, filePath);
         return;
      }

      triggerPagePrefetch(filePath);

      const controller = new AbortController();
      selectAbortRef.current = controller;

      setLoadingPath(filePath);
      getImage(filePath, pipeid, system ?? "", tokenRef.current, controller.signal)
         .then((url) => {
            pageCacheRef.current.set(filePath, url);
            onFileSelect(url, filePath);
         })
         .catch((error) => { if (error?.name !== "AbortError") console.error("Error fetching image:", error); })
         .finally(() => { if (!controller.signal.aborted) setLoadingPath(null); });
   }
   // Keep the keydown handler ref in sync after onSelectFile is (re)defined each render
   onSelectFileRef.current = onSelectFile;

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
                           onChange={(value) => setSystem(value ?? "")}
                        />

                        <TapisDirectoryField
                           name="srcImgDir"
                           label="Source Image Directory"
                           description="Enter full path to source image directory"
                           placeholder="path/to/source-directory"
                           systemId={system ?? ""}
                           token={token}
                           disabled={!system}
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

export default FileExplorer;
