import { Outlet, useLocation, useMatches } from "@remix-run/react";
import { PipelineProvider } from "~/context/PipelineContext";
import StepperStatusBar from "~/components/StepperStatusBar/stepper-status-bar";
import { steps } from "~/components/ImageAnnotation/utils/utils";
import { Box } from "@mui/material";

export default function ObjectDetectionLayout() {
   const location = useLocation();
   const matches = useMatches();

   // Get id from the matched child route params
   const childMatch = matches[matches.length - 1];
   const id = childMatch?.params?.id;

   // Get current step based on the route pathname
   let currentStep = 1;

   if (location.pathname.includes('/image-annotator/')) currentStep = 1;
   else if (location.pathname.includes('/build-class-supports/')) currentStep = 2;
   else if (location.pathname.includes('/optimize-patch-size/')) currentStep = 3;
   else if (location.pathname.includes('/configure-detection-job/')) currentStep = 4;
   else if (location.pathname.includes('/detection/')) currentStep = 5;
   else if (location.pathname.includes('/configure-classification/')) currentStep = 6;
   else if (location.pathname.includes('/classification/')) currentStep = 7;

   return (
      <PipelineProvider pipeId={id ?? ""}>
         <Box sx={{ width: "100%", display: "flex", flexDirection: "column", minHeight: "100vh", bgcolor: "#fafafa" }}>
            {id && (
               <Box sx={{ bgcolor: "white", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
                  <StepperStatusBar
                     steps={steps}
                     currentStep={currentStep}
                     pipeId={id}
                     onStepClick={() => { }}
                  />
               </Box>
            )}
            <Box sx={{ flex: 1, overflow: "auto", bgcolor: "background.default" }}>
               <Outlet />
            </Box>
         </Box>
      </PipelineProvider>
   );
}
