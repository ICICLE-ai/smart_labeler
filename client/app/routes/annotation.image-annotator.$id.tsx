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
import { PipelineTypeGuard } from "~/components/PipelineTypeGuard/PipelineTypeGuard";
import { getSam3Endpoint, TYPE } from "~/utils/utils";

const ImageAnnotation = () => {
   const { pipeid } = useLoaderData<{ pipeid: string }>();
   const [cookie] = useCookies(["tapis-token"]);

   const token = cookie["tapis-token"]?.["access_token"] ?? "";

   // This route serves image segmentation; a video pipeline belongs in the
   // video workspace, and the guard offers that rather than silently falling
   // back to the detection tools.
   return (
      <PipelineTypeGuard pipeid={pipeid} token={token} expected={TYPE.SEGMENTATION}>
         <ImageAnnotator
            pipeid={pipeid}
            tapisToken={token}
            sam3Endpoint={getSam3Endpoint()}
         />
      </PipelineTypeGuard>
   );
};

export default ImageAnnotation;

export function clientLoader({ params }: any) {
   return { pipeid: params.id };
}
clientLoader.hydrate = true;
