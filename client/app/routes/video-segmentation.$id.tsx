// The video segmentation & tracking workspace — upload, chunked frame browsing,
// keyframe annotation (reusing the existing segmentation canvas/tools), and
// whole-video tracking via the SAM3 Video Service — lives in
// @icicle-ai/video-segmentation. This route only supplies what is specific to
// this app: the pipeline id from the URL, and the Tapis token from the cookie.
import { VideoAnnotator } from "@icicle-ai/video-segmentation";
import { useLoaderData } from "@remix-run/react";
import { useCookies } from "react-cookie";
import { PipelineTypeGuard } from "~/components/PipelineTypeGuard/PipelineTypeGuard";
import { getSam3Endpoint, TYPE } from "~/utils/utils";

const VideoSegmentation = () => {
   const { pipeid } = useLoaderData<{ pipeid: string }>();
   const [cookie] = useCookies(["tapis-token"]);

   const token = cookie["tapis-token"]?.["access_token"] ?? "";

   return (
      <PipelineTypeGuard pipeid={pipeid} token={token} expected={TYPE.VIDEO_SEGMENTATION}>
         <VideoAnnotator
            pipeid={pipeid}
            tapisToken={token}
            sam3Endpoint={getSam3Endpoint()}
         />
      </PipelineTypeGuard>
   );
};

export default VideoSegmentation;

export function clientLoader({ params }: any) {
   return { pipeid: params.id };
}
clientLoader.hydrate = true;
