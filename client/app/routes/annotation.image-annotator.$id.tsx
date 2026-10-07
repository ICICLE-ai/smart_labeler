// The whole annotation workspace — file explorer, canvas, details panel, toolbar,
// annotator-config persistence and COCO/default JSON import/export — lives in
// @icicle-ai/image-annotator. This route only supplies what is specific to this
// app: the pipeline id from the URL, and the Tapis token from the cookie.
//
// Annotation is the final step for this standalone annotator, so no onNextStep is
// wired up and the toolbar's "Next Step" button stays hidden.
import { ImageAnnotator } from "@icicle-ai/image-annotator";
import { useLoaderData } from "@remix-run/react";
import { useCookies } from "react-cookie";
import { getSam3Endpoint } from "~/utils/utils";

const ImageAnnotation = () => {
   const { pipeid } = useLoaderData<{ pipeid: string }>();
   const [cookie] = useCookies(["tapis-token"]);

   return (
      <ImageAnnotator
         pipeid={pipeid}
         tapisToken={cookie["tapis-token"]?.["access_token"] ?? ""}
         sam3Endpoint={getSam3Endpoint()}
      />
   );
};

export default ImageAnnotation;

export function clientLoader({ params }: any) {
   return { pipeid: params.id };
}
clientLoader.hydrate = true;
