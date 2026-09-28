// The annotation step of the object-detection pipeline. The workspace itself is
// @icicle-ai/image-annotator; this route supplies the pipeline id, the Tapis
// token, and what "Next Step" means inside this pipeline.
import { ImageAnnotator } from "@icicle-ai/image-annotator";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useCookies } from "react-cookie";
import { getSam3Endpoint } from "~/utils/utils";

const ImageAnnotation = () => {
   const { pipeid } = useLoaderData<{ pipeid: string }>();
   const [cookie] = useCookies(["tapis-token"]);
   const navigate = useNavigate();

   return (
      <ImageAnnotator
         pipeid={pipeid}
         tapisToken={cookie["tapis-token"]?.["access_token"] ?? ""}
         sam3Endpoint={getSam3Endpoint()}
         onNextStep={() => navigate(`/object-detection/build-class-supports/${pipeid}`)}
      />
   );
};

export default ImageAnnotation;

export function clientLoader({ params }: any) {
   return { pipeid: params.id };
}
clientLoader.hydrate = true;
