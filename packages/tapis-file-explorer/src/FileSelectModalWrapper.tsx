import { useCallback, useMemo, useState } from "react";
import { Modal, Button, Box, Group } from "@mantine/core";
import { FileExplorerWrapper, type TapisFileEntry, type TapisSelectMode } from "./FileExplorerWrapper";

export interface FileSelectModalWrapperProps {
  systemId?: string;
  path?: string;
  /** Auth token forwarded to the underlying Tapis listing requests. */
  token: string;
  onSelect?: (systemId: string | null, files: TapisFileEntry[]) => void;
  toggle: () => void;
  selectMode?: TapisSelectMode;
  initialSelection?: TapisFileEntry[];
}

export const FileSelectModalWrapper = ({
  systemId,
  path,
  token,
  onSelect,
  toggle,
  selectMode = { mode: "single", types: ["file", "dir"] },
  initialSelection,
}: FileSelectModalWrapperProps) => {
  const [selectedFiles, setSelectedFiles] = useState<TapisFileEntry[]>(initialSelection ?? []);
  const [selectedSystem, setSelectedSystem] = useState<string | null>(systemId ?? null);
  const [currentPath, setCurrentPath] = useState(path ?? "/");

  const dirSelectMode = useMemo(() => {
    return (
      selectMode?.mode === "single" &&
      selectMode?.types?.length === 1 &&
      selectMode?.types?.some((mode) => mode === "dir")
    );
  }, [selectMode]);

  const fileExplorerSelectCallback = useCallback(
    (files: TapisFileEntry[]) => {
      if (selectMode?.mode === "multi") {
        setSelectedFiles((prev) => [...prev, ...files]);
      } else {
        setSelectedFiles(files);
      }
    },
    [selectMode]
  );

  const fileExplorerUnselectCallback = useCallback(
    (files: TapisFileEntry[]) => {
      if (selectMode?.mode === "multi") {
        setSelectedFiles((prev) =>
          prev.filter(
            (selected) =>
              !files.some((unselected) => unselected.path === selected.path)
          )
        );
      } else {
        setSelectedFiles([]);
      }
    },
    [selectMode]
  );

  const fileExplorerNavigateCallback = useCallback(
    (systemId: string | null, path: string) => {
      setSelectedSystem(systemId);
      setSelectedFiles([]);
      setCurrentPath(path ?? "/");
    },
    []
  );

  const selectButtonCallback = useCallback(() => {
    toggle();

    if (onSelect) {
      if (selectedFiles.length) {
        onSelect(selectedSystem, selectedFiles);
      } else if (dirSelectMode) {
        onSelect(selectedSystem, [
          {
            name: currentPath.split("/").slice(-1)[0],
            path: currentPath,
          },
        ]);
      }
    }
  }, [toggle, onSelect, selectedSystem, selectedFiles, currentPath, dirSelectMode]);

  const body = (
    <Box style={{ maxHeight: "70vh", overflow: "auto" }}>
      <FileExplorerWrapper
        systemId={systemId ?? ""}
        token={token}
        path={currentPath}
        selectMode={selectMode}
        onSelect={fileExplorerSelectCallback}
        onUnselect={fileExplorerUnselectCallback}
        onNavigate={fileExplorerNavigateCallback}
        selectedFiles={selectedFiles}
      />
    </Box>
  );

  const footer = (
    <Group justify="flex-end" mt="md">
      <Button
        disabled={selectedFiles.length === 0 && !dirSelectMode}
        onClick={selectButtonCallback}
        data-testid="modalSelect"
      >
        Select{" "}
        {selectMode?.mode === "multi"
          ? `(${selectedFiles.length})`
          : dirSelectMode
            ? selectedFiles.length
              ? selectedFiles[0].name
              : currentPath
            : selectedFiles.length
              ? selectedFiles[0].name
              : ""}
      </Button>
    </Group>
  );

  let title = "Select files";

  const selectionNames =
    selectMode?.types?.map((selectType) => {
      if (selectMode.mode === "single") {
        return selectType === "dir" ? "directory" : "file";
      }
      if (selectMode.mode === "multi") {
        return selectType === "dir" ? "directories" : "files";
      }
      return "files";
    }) ?? [];

  if (selectionNames.length) {
    title = `Select ${selectMode?.mode === "multi" ? "one or more" : "a"} ${selectionNames[0]}${selectionNames.length > 1 ? ` or ${selectionNames[1]}` : ""}`;
  }

  return (
    <Modal opened={true} onClose={toggle} title={title} size="lg" centered>
      {body}
      {footer}
    </Modal>
  );
};

export default FileSelectModalWrapper;
