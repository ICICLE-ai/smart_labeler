// App-level binding of @icicle-ai/image-annotation-canvas.
//
// The package takes its auth token and SAM3 endpoint as props so it can be reused
// outside this app. Here both come from app-wide config (cookie + runtime ENV),
// so this adapter fills them in and routes keep rendering <ImageCanvas /> as before.
import { ImageCanvas as Canvas, type ImageCanvasProps, type BaseAnnotation } from "@icicle-ai/image-annotation-canvas";
import { useCookies } from "react-cookie";
import { getSam3Endpoint } from "~/utils/utils";

// Re-exported so existing importers of this module keep working unchanged.
export {
   CanvasMode,
   detectionEngine,
   segmentationEngine,
   getLabelColor,
   LABEL_PALETTE,
   MAX_SCALE,
   SAM3_MODES,
} from "@icicle-ai/image-annotation-canvas";
export type {
   Annotation,
   SegmentationAnnotation,
   BaseAnnotation,
   CanvasEngine,
   Coords,
   DrawState,
   EngineContext,
   Sam3Client,
   Sam3Config,
   ImageCanvasProps,
} from "@icicle-ai/image-annotation-canvas";

function ImageCanvasInner<T extends BaseAnnotation>(props: Omit<ImageCanvasProps<T>, "tapisToken" | "sam3Endpoint">) {
   const [cookie] = useCookies(["tapis-token"]);
   return (
      <Canvas
         {...(props as ImageCanvasProps<T>)}
         tapisToken={cookie["tapis-token"]?.["access_token"] ?? ""}
         sam3Endpoint={getSam3Endpoint()}
      />
   );
}

// A generic component can't survive some React tooling paths as-is; the cast keeps
// the public import surface generic, matching the package's own wrapper.
export const ImageCanvas = ImageCanvasInner as <T extends BaseAnnotation>(
   props: Omit<ImageCanvasProps<T>, "tapisToken" | "sam3Endpoint">
) => React.ReactElement;

export default ImageCanvas;
