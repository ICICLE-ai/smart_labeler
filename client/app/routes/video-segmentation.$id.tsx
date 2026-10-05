// The video segmentation & tracking workspace — upload, chunked frame browsing,
// keyframe annotation (reusing the existing segmentation canvas/tools), and
// whole-video tracking via the SAM3 Video Service — lives in
// @icicle-ai/video-segmentation. This route only supplies what is specific to
// this app: the pipeline id from the URL, and the Tapis token from the cookie.
import { VideoAnnotator } from "@icicle-ai/video-segmentation";
import { useLoaderData } from "@remix-run/react";
import { useCookies } from "react-cookie";
import { getSam3Endpoint } from "~/utils/utils";

const VideoSegmentation = () => {
   const { pipeid } = useLoaderData<{ pipeid: string }>();
   const [cookie] = useCookies(["tapis-token"]);

   return (
      <VideoAnnotator
         pipeid={pipeid}
         tapisToken={cookie["tapis-token"]?.["access_token"] ?? ""}
         sam3Endpoint={getSam3Endpoint()}
      />
   );
};

export default VideoSegmentation;

export function clientLoader({ params }: any) {
   return { pipeid: params.id };
}
clientLoader.hydrate = true;
