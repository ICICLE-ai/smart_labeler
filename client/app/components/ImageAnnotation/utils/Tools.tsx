// App-level binding of the package's annotator toolbar.
//
// The package takes the auth token as a prop and reports "Next Step" through a
// callback so it can be reused outside this app. Here the token comes from a
// cookie and "Next Step" means navigating the object-detection pipeline, so this
// adapter supplies both.
import { Tools as AnnotatorTools, type ToolsProps } from "@icicle-ai/image-annotator";
import { useNavigate } from "@remix-run/react";
import { useCookies } from "react-cookie";

export const Tools = (props: Omit<ToolsProps, "token" | "onNextStep">) => {
   const navigate = useNavigate();
   const [cookie] = useCookies(["tapis-token"]);
   return (
      <AnnotatorTools
         {...props}
         token={cookie["tapis-token"]?.["access_token"] ?? ""}
         onNextStep={() => navigate(`/object-detection/build-class-supports/${props.pipeId}`)}
      />
   );
};

export default Tools;
