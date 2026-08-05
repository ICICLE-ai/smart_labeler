import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Breadcrumbs,
  Checkbox,
  Chip,
  CircularProgress,
  IconButton,
  Link,
  List,
  ListItemButton,
  ListItemText,
  Tooltip,
  Typography,
} from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import { getTapisDirListing, sanitizePath } from "./tapisClient";

export interface TapisSelectMode {
  mode: "single" | "multi";
  types: Array<"file" | "dir">;
}

export interface TapisFileEntry {
  name: string;
  path: string;
}

export interface FileExplorerWrapperProps {
  systemId: string;
  path?: string;
  /** Auth token forwarded as `X-Tapis-Token` on every request. */
  token: string;
  className?: string;
  onNavigate?: (systemId: string | null, path: string) => void;
  onSelect?: (files: TapisFileEntry[]) => void;
  onUnselect?: (files: TapisFileEntry[]) => void;
  selectedFiles?: TapisFileEntry[];
  selectMode?: TapisSelectMode;
}

// Normalize a Tapis file-ops path into an absolute path within the system.
const normalizePath = (p: string) =>
  "/" + (p ?? "").replace(/^tapis:\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "");

const parentOf = (p: string) => {
  const parent = normalizePath(p).split("/").slice(0, -1).join("/");
  return parent && parent.length ? parent : "/";
};

export const FileExplorerWrapper = ({
  systemId,
  path,
  token,
  className,
  onNavigate,
  onSelect,
  onUnselect,
  selectedFiles = [],
  selectMode,
}: FileExplorerWrapperProps) => {
  const [currentSystem] = useState<string>(systemId ?? "");
  const [currentPath, setCurrentPath] = useState<string>(path ?? "/");
  const [dirs, setDirs] = useState<Array<{ name: string; path: string }>>([]);
  const [files, setFiles] = useState<Array<{ name: string; path: string }>>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const canSelectFiles = !!selectMode?.types?.includes("file");
  const isMulti = selectMode?.mode === "multi";

  // Navigation counter — stale fetches check against it and discard their results.
  const navCounter = useRef<number>(0);

  const load = useCallback(
    async (sys: string, p: string) => {
      if (!sys) {
        setDirs([]);
        setFiles([]);
        return;
      }
      const navId = ++navCounter.current;
      setLoading(true);
      setError(null);
      try {
        const res = await getTapisDirListing(sanitizePath(p || "/"), sys, token);
        if (navId !== navCounter.current) return;
        setDirs(res.dirs);
        setFiles(res.files);
      } catch (e: any) {
        if (navId !== navCounter.current) return;
        setError(e?.message ?? "Failed to list directory.");
        setDirs([]);
        setFiles([]);
      } finally {
        if (navId === navCounter.current) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    load(currentSystem, currentPath);
  }, [currentSystem, currentPath, load]);

  const navigateTo = (p: string) => {
    const next = normalizePath(p);
    setCurrentPath(next);
    // Keep the modal in sync (it uses currentPath for "select current directory"
    // and clears any active selection on navigation).
    onNavigate?.(currentSystem || null, next);
  };

  const isSelected = (p: string) =>
    selectedFiles.some((f) => f.path === p || normalizePath(f.path) === normalizePath(p));

  const toggleSelect = (item: { name: string; path: string }) => {
    if (isMulti) {
      if (isSelected(item.path)) onUnselect?.([item]);
      else onSelect?.([item]);
    } else {
      onSelect?.([item]);
    }
  };

  const segments = currentPath.split("/").filter(Boolean);
  const atRoot = segments.length === 0;

  return (
    <div className={className}>
      {/* Breadcrumb + up navigation */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          minHeight: 36,
        }}
      >
        <Tooltip title="Up one level">
          <span>
            <IconButton
              size="small"
              onClick={() => navigateTo(parentOf(currentPath))}
              disabled={atRoot}
              sx={{ p: 0.25 }}
            >
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Breadcrumbs maxItems={4} sx={{ fontSize: "0.72rem", flex: 1, overflow: "hidden" }}>
          <Link
            component="button"
            type="button"
            variant="caption"
            underline="hover"
            color="inherit"
            onClick={() => navigateTo("/")}
          >
            {currentSystem || "root"}
          </Link>
          {segments.map((segment, idx) => {
            const target = "/" + segments.slice(0, idx + 1).join("/");
            const isLast = idx === segments.length - 1;
            return isLast ? (
              <Typography key={target} variant="caption" fontWeight={600} noWrap sx={{ maxWidth: 160 }}>
                {segment}
              </Typography>
            ) : (
              <Link
                key={target}
                component="button"
                type="button"
                variant="caption"
                underline="hover"
                color="inherit"
                onClick={() => navigateTo(target)}
              >
                {segment}
              </Link>
            );
          })}
        </Breadcrumbs>
        {loading ? (
          <CircularProgress size={14} sx={{ mr: 0.5 }} />
        ) : (
          (dirs.length > 0 || files.length > 0) && (
            <Chip
              label={`${dirs.length} dir${dirs.length !== 1 ? "s" : ""}, ${files.length} file${files.length !== 1 ? "s" : ""}`}
              size="small"
              variant="outlined"
              sx={{ fontSize: "0.68rem", height: 20 }}
            />
          )
        )}
      </Box>

      {/* Listing */}
      <Box sx={{ maxHeight: "50vh", overflow: "auto", px: 1, py: 0.5 }}>
        {error ? (
          <Typography variant="body2" color="error" sx={{ p: 2 }}>
            {error}
          </Typography>
        ) : !loading && dirs.length === 0 && files.length === 0 ? (
          <Typography variant="body2" color="text.disabled" sx={{ p: 2 }}>
            This directory is empty.
          </Typography>
        ) : (
          <List dense disablePadding>
            {/* Directories — click to navigate in */}
            {dirs.map((dir) => (
              <Tooltip key={dir.path} title={dir.path} placement="right" arrow>
                <ListItemButton
                  onClick={() => navigateTo(dir.path)}
                  sx={{ borderRadius: 1, mb: 0.25, px: 1, py: 0.5 }}
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

            {/* Files — always listed; selectable only when the mode allows files,
                otherwise shown greyed-out for context (e.g. directory-pick mode). */}
            {files.map((file) => {
              const selected = isSelected(file.path);
              return (
                <Tooltip
                  key={file.path}
                  title={canSelectFiles ? file.path : `${file.path} (files can't be selected here)`}
                  placement="right"
                  arrow
                >
                  <ListItemButton
                    selected={selected}
                    disableRipple={!canSelectFiles}
                    onClick={() => { if (canSelectFiles) toggleSelect(file); }}
                    sx={{
                      borderRadius: 1,
                      mb: 0.25,
                      px: 1,
                      py: 0.5,
                      cursor: canSelectFiles ? "pointer" : "default",
                      opacity: canSelectFiles ? 1 : 0.55,
                    }}
                  >
                    {isMulti && canSelectFiles && (
                      <Checkbox edge="start" size="small" checked={selected} tabIndex={-1} disableRipple sx={{ p: 0.5, mr: 0.5 }} />
                    )}
                    <Box sx={{ mr: 1.5, color: "action.active", display: "flex", alignItems: "center" }}>
                      <InsertDriveFileOutlinedIcon fontSize="small" />
                    </Box>
                    <ListItemText
                      primary={
                        <Typography variant="body2" fontWeight={selected ? 600 : 400} noWrap title={file.name}>
                          {file.name}
                        </Typography>
                      }
                    />
                  </ListItemButton>
                </Tooltip>
              );
            })}
          </List>
        )}
      </Box>
    </div>
  );
};

export default FileExplorerWrapper;
