// App-level binding of the package's FileExplorerWrapper — supplies the Tapis
// token from this app's cookie. See ./FileExplorer.tsx for why.
import { FileExplorerWrapper as TapisFileExplorerWrapper, type FileExplorerWrapperProps } from "@icicle-ai/tapis-file-explorer";
import { useCookies } from "react-cookie";

export type { TapisFileEntry, TapisSelectMode } from "@icicle-ai/tapis-file-explorer";

export const FileExplorerWrapper = (props: Omit<FileExplorerWrapperProps, "token">) => {
   const [cookie] = useCookies(["tapis-token"]);
   return <TapisFileExplorerWrapper {...props} token={cookie["tapis-token"]?.["access_token"] ?? ""} />;
};

export default FileExplorerWrapper;
