import { useCallback, useState, useEffect } from "react";
import {
  breadcrumbsFromPathname,
  FileListing,
  SystemListing,
} from "@tapis/tapisui-common";
// @ts-ignore
import normalize from "normalize-path";
import BreadcrumbsWrapper from "./BreadcrumbsWrapper";
import styles from "./FileExplorerWrapper.module.scss";

const FileExplorerWrapper = ({
  systemId,
  path,
  className,
  allowSystemChange,
  onNavigate,
  onSelect,
  onUnselect,
  fields = ["size"],
  selectedFiles,
  selectMode,
}: any) => {
  const [currentSystem, setCurrentSystem] = useState(systemId);
  const [currentPath, setCurrentPath] = useState(path);
  const [targetBreadcrumbs, setTargetBreadcrumbs] = useState([]);
  const onFileNavigate = useCallback(
    (file: any) => {
      const newPath = normalize(`${currentPath}/${file.name}`);
      setCurrentPath(newPath);
      onNavigate && onNavigate(currentSystem ?? null, newPath);
    },
    [setCurrentPath, currentPath, onNavigate, currentSystem]
  );
  const onSystemNavigate = useCallback(
    (system: any) => {
      if (!system) {
        onNavigate && onNavigate(null, null);
      }
      setCurrentSystem(system?.id);
      setCurrentPath("/");
      onNavigate && onNavigate(system?.id ?? null, "/");
    },
    [setCurrentPath, setCurrentSystem, onNavigate]
  );
  const onBreadcrumbNavigate = useCallback(
    (to: string) => {
      setCurrentPath(to);
      onNavigate && onNavigate(currentSystem ?? null, to);
    },
    [setCurrentPath, currentSystem, onNavigate]
  );
  useEffect(() => {
    const breadcrumbs = breadcrumbsFromPathname(currentPath ?? "");
    const newCrumbs = breadcrumbs.map((breadcrumb) => ({
      ...breadcrumb,
      onClick: onBreadcrumbNavigate,
    }));
    newCrumbs.unshift({
      text: currentSystem ?? "",
      to: "/",
      onClick: onBreadcrumbNavigate,
    });
    setTargetBreadcrumbs(newCrumbs);
  }, [
    setTargetBreadcrumbs,
    currentPath,
    setCurrentPath,
    currentSystem,
    onBreadcrumbNavigate,
  ]);
  const breadcrumbs: any[] = [];
  if (allowSystemChange) {
    breadcrumbs.push({
      text: "Files",
      to: "/",
      onClick: () => onSystemNavigate(null),
    });
  }
  if (currentSystem) {
    breadcrumbs.push(...targetBreadcrumbs);
  }
  return (
    <div className={className}>
      <BreadcrumbsWrapper breadcrumbs={breadcrumbs} />
      <div>
        {currentSystem ? (
          <FileListing
            className={styles["nav-list"]}
            systemId={currentSystem}
            path={currentPath ?? "/"}
            onNavigate={onFileNavigate}
            onSelect={onSelect}
            onUnselect={onUnselect}
            selectedFiles={selectedFiles}
            fields={fields}
            selectMode={selectMode}
          />
        ) : (
          <SystemListing
            className={styles["nav-list"]}
            onNavigate={onSystemNavigate}
          />
        )}
      </div>
    </div>
  );
};

export default FileExplorerWrapper;
