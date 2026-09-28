// App-level binding of the package's FileSelectModalWrapper — supplies the Tapis
// token from this app's cookie. See ./FileExplorer.tsx for why.
import { FileSelectModalWrapper as TapisFileSelectModalWrapper, type FileSelectModalWrapperProps } from "@icicle-ai/tapis-file-explorer";
import { useCookies } from "react-cookie";

export const FileSelectModalWrapper = (props: Omit<FileSelectModalWrapperProps, "token">) => {
   const [cookie] = useCookies(["tapis-token"]);
   return <TapisFileSelectModalWrapper {...props} token={cookie["tapis-token"]?.["access_token"] ?? ""} />;
};

export default FileSelectModalWrapper;
