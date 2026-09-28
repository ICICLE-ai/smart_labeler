// App-level binding of @icicle-ai/tapis-file-explorer.
//
// The package is deliberately auth-agnostic: it takes the Tapis token as a prop
// so it can be reused outside this app. This app keeps the token in a cookie, so
// this adapter reads it once and every route can go on rendering <FileExplorer />
// without repeating that plumbing.
import { FileExplorer as TapisFileExplorer, type FileExplorerProps } from "@icicle-ai/tapis-file-explorer";
import { useCookies } from "react-cookie";

export type { FileAnnotationStat } from "@icicle-ai/tapis-file-explorer";

export const FileExplorer = (props: Omit<FileExplorerProps, "token">) => {
   const [cookie] = useCookies(["tapis-token"]);
   return <TapisFileExplorer {...props} token={cookie["tapis-token"]?.["access_token"] ?? ""} />;
};

export default FileExplorer;
