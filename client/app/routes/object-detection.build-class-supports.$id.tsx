import { Card, Group, Select, Stack, TextInput, Tooltip, ActionIcon, Text, Box, Paper, Alert, Button } from "@mantine/core";
import { IconInfoCircle, IconAlertCircle } from "@tabler/icons-react";
import { data, useLoaderData, useNavigate } from "@remix-run/react";
// import FormikTapisFileWrapper from "~/components/FileExplorer/FormikTapisFileWrapper";
import { Formik } from "formik";
import React, { useEffect, useState } from "react";
import { useCookies } from "react-cookie";
import { SubmitButton } from "~/components/formik-mantine";
import { HeroTitle } from "~/components/HeroTitle/HeroTitle";
import { allowed_systems, DEFAULT_SYSTEM, fetchAndReturnData, SubmitData } from "~/utils/utils";
import { ModelSelector } from "~/components/ModelSelector/ModelSelector";
import { usePipeline } from "~/context/PipelineContext";
import FormikTapisFileWrapper from "~/components/FileExplorer/FormikTapisFileWrapper";


const GenerateClassSupports: React.FC = () => {
   const [system, setSystem] = useState<string>(DEFAULT_SYSTEM);
   const [srcImgDir, setSrcImgDir] = useState<string>("");
   const [annotationFilePath, setAnnotationFilePath] = useState<string>("");
   const [device, setDevice] = useState<string>("CPU");
   const [modelNames, setModelNames] = useState<string>("");
   const [cropSize, setCropSize] = useState<string>("");
   const [method, setMethod] = useState<string>("Image");
   const [outputDir, setOutputDir] = useState<string>("");
   const [cookie, setCookie] = useCookies(["tapis-token"]);
   const { pipeid } = useLoaderData<{ pipeid: string }>();
   const [name, setName] = useState<string>("Generate Support embeddings");
   const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
   const navigate = useNavigate();
   const { notifyJobSubmitted } = usePipeline();
   const formRef = React.useRef<any>(null);
   const [cropSizes, setCropSizes] = useState<string>("");
   const [jobId, setJobId] = useState<string>("");
   const [jobStatus, setJobStatus] = useState<string | null>(null);
   const [isDemo, setIsDemo] = useState<boolean>(false);

   useEffect(() => {
      const token = cookie["tapis-token"]["access_token"];
      fetchAndReturnData(`/get-object-detection-pipeline/${pipeid}`, token).then(async (res) => {
         if (!res) {
            // alert(
            //    "Failed to fetch object detection pipeline. Make sure to generate class supports first (Use previous step)."
            // );
            return;
         }

         const data: any = res;
         const resolvedSystem = data["system"] || DEFAULT_SYSTEM;
         let resolvedSrcImgDir = data["srcImgDir"] || "";
         let resolvedAnnotationFilePath = data["annotationFilePath"] || "";

         // Fall back to annotator_configuration for missing path fields
         if (!resolvedSrcImgDir || !resolvedAnnotationFilePath) {
            const configs = await fetchAndReturnData(`/annotator-configuration/${pipeid}`, token).catch(() => null);
            if (configs && configs.length > 0) {
               const cfg = configs[configs.length - 1];
               if (!resolvedSrcImgDir && cfg.srcImgDir) resolvedSrcImgDir = cfg.srcImgDir;
               if (!resolvedAnnotationFilePath && cfg.annotationFilePath) resolvedAnnotationFilePath = cfg.annotationFilePath;
            }
         }

         setCropSize(data["cropSize"] ? data["cropSize"] : "");
         setCropSizes(data["crop_sizes"] ? data["crop_sizes"] : "");
         setSystem(resolvedSystem);
         setSrcImgDir(resolvedSrcImgDir);
         setAnnotationFilePath(resolvedAnnotationFilePath);
         setSelectedModelIds(data["model_ids"] ? data["model_ids"].split(",") : []);
         setModelNames(data["model_names"] ? data["model_names"].split(",") : []);
         setDevice(data["device"] ? data["device"] : "CUDA");
         setOutputDir(data["outputDir"] ? data["outputDir"] : "");
         setMethod(data["method"] ? data["method"] : "Image");
         setName(data["name"] ? data["name"] : "Generate Support embeddings");
         setIsDemo(data["is_demo"] || false);
         setJobId(data["generateClassSupportJobId"] || "");
         formRef.current?.setValues({
            srcImgDir: resolvedSrcImgDir,
            annotationFilePath: resolvedAnnotationFilePath,
            outputDir: data["outputDir"] ? data["outputDir"] : "",
         });
      });
   }, []);

   useEffect(() => {
      if (!jobId) return;
      const TERMINAL = new Set(["FINISHED", "FAILED", "CANCELLED", "STOPPED", "BLOCKED"]);
      const token = cookie["tapis-token"]["access_token"];

      const fetchStatus = async () => {
         try {
            const res = await fetchAndReturnData(`/get_job_status/${jobId}`, token);
            if (res?.status) setJobStatus(res.status);
            return res?.status as string | undefined;
         } catch (err) {
            console.error("Error fetching job status:", err);
         }
      };

      fetchStatus();
      const intervalId = setInterval(async () => {
         const status = await fetchStatus();
         if (status && TERMINAL.has(status)) clearInterval(intervalId);
      }, 10000);

      return () => clearInterval(intervalId);
   }, [jobId]);

   const handleSubmit = (values: any): void => {
      if (isDemo) {
         notifyJobSubmitted();
         alert("Demo mode: Job simulated successfully. This pipeline is for demonstration purposes — no real job was submitted.");
         navigate(`/object-detection/optimize-patch-size/${pipeid}`);
         return;
      }

      if (selectedModelIds.length === 0) {
         alert("Please select at least one model.");
         return;
      }

      const isInteger = (value: any) => /^-?\d+$/.test(String(value).trim());
      const isIntegerList = (value: any) => {
         const trimmed = String(value).trim();
         if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            const content = trimmed.substring(1, trimmed.length - 1);
            if (content.trim() === "") return true;
            return content.split(",").every(isInteger);
         }
         return false;
      };

      if (!isInteger(cropSizes) && !isIntegerList(cropSizes)) {
         alert("Crop size must be an integer or a list of integers (e.g., 1024 or [1024, 512]).");
         return;
      }

      SubmitData(
         `/generate_class_supports/${pipeid}`,
         {
            srcImgDir: values["srcImgDir"],
            annotationFilePath: values["annotationFilePath"],
            system: system,
            model_ids: selectedModelIds.join(","),
            cropSize: 1024,
            device: device,
            outputDir: values["outputDir"],
            method: method,
            name: name,
            newPatra: true,
            crop_sizes: cropSizes
         },
         cookie["tapis-token"]["access_token"])
         .then((res) => {
            if (!res) {
               alert("Failed to submit class supports generation job");
               return;
            }
            notifyJobSubmitted();
            alert("Class supports generation job submitted successfully");
            navigate(`/object-detection/optimize-patch-size/${pipeid}`);
         })
         .catch((err) => {
            console.error(err);
            alert("Failed to submit class supports generation job");
         });
   };

   return (
      <Stack gap="lg" px="md" pb="xl">
         {isDemo && (
            <Alert icon={<IconAlertCircle size={16} />} title="Demo Pipeline" color="yellow" variant="light">
               This is a demo pipeline for simulation and exploration only. Job submissions are simulated — no real compute jobs will be dispatched.
            </Alert>
         )}
         {jobStatus && (
            <Alert icon={<IconInfoCircle size={16} />} title="Class Supports Job Status" color="blue" variant="light">
               Current Status: <strong>{jobStatus}</strong>{jobId && ` (Job ID: ${jobId})`}
            </Alert>
         )}
         <Stack gap={4} align="center">
            <HeroTitle title={`Generate Class Supports`} style={{ margin: "auto" }} />
            <Text size="sm" c="dimmed" ta="center">
               Configure data paths, select a model card, and submit class-support generation.
            </Text>
         </Stack>
         <Card
            shadow="md"
            padding="xl"
            radius="lg"
            withBorder
            style={{ width: "100%", maxWidth: 980, margin: "auto", background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)" }}
         >
            <Formik
               innerRef={formRef}
               initialValues={{
                  system: "",
                  srcImgDir: "",
                  annotationFilePath: "",
                  queryImagePath: "",
                  crop_sizes: "",
                  device: "CPU",
                  outputDir: "",
                  method: "Image",
                  name: "Generate Support embeddings",
               }}
               onSubmit={(values) => handleSubmit(values)}
            >
               <form style={{ width: "100%" }}>
                  <Stack>
                     <TextInput
                        mt="md"
                        name="name"
                        label="Job Name"
                        // classNames={baseFieldClassNames}
                        placeholder="Generate Support embeddings"
                        value={name}
                        onChange={(event) => {
                           setName(event.currentTarget.value);
                        }}
                     />
                     <Select
                        mt="md"
                        comboboxProps={{ withinPortal: true }}
                        // classNames={baseFieldClassNames}
                        data={allowed_systems}
                        label="System"
                        placeholder="Pick one System"
                        defaultValue={DEFAULT_SYSTEM}
                        value={system}
                        name="system"
                        onChange={(value, option) => setSystem(value ?? "")}
                     />

                     <div className="tapis-file-field">
                        <FormikTapisFileWrapper
                           name={`srcImgDir`}
                           label="Source Image Directory"
                           required={false}
                           description="Enter full path to source image directory"
                           value={srcImgDir}
                           systemId={system}
                           disabled={!system}
                           files={false}
                           dirs={true}
                        />
                     </div>

                     <div className="tapis-file-field">
                        <FormikTapisFileWrapper
                           label="Annotation File Path"
                           required={false}
                           name="annotationFilePath"
                           description="Enter full path to annotation file"
                           placeholder="path/to/annotation/file"
                           value={annotationFilePath}
                           systemId={system}
                           disabled={!system}
                           files={false}
                           dirs={true}
                        />
                     </div>


                     <div className="tapis-file-field">
                        <FormikTapisFileWrapper
                           label="Output Directory"
                           required={false}
                           name="outputDir"
                           description="Enter full path to output directory"
                           placeholder="path to output directory"
                           value={outputDir}
                           systemId={system}
                           disabled={!system}
                           files={false}
                           dirs={true}
                        />
                     </div>

                     <Paper withBorder p="sm" radius="md" mt="sm" style={{ background: "#fcfdff" }}>
                        <Text size="sm" fw={700} mb={8}>Model Selection</Text>
                        <ModelSelector
                           selectedModelIds={selectedModelIds}
                           onModelSelect={(id) => setSelectedModelIds((prev) => prev.includes(id) ? prev : [...prev, id])}
                           onModelDeselect={(id) => setSelectedModelIds((prev) => prev.filter((modelId) => modelId !== id))}
                           tapisToken={cookie["tapis-token"]["access_token"]}
                           filterList={["OWLv2 Large Patch14 Ensemble", "dinov3", "bioclip"]}
                           multiSelect={true}
                        />
                     </Paper>

                     <TextInput
                        mt="md"
                        name="cropSizes"
                        label={
                           <Group align="center">
                              <Text>Crop/Patch Size</Text>
                              <Tooltip label="Crop size in pixels. Images are cropped to this square size before processing. Enter a positive integer.">
                                 <ActionIcon variant="transparent" aria-label="Crop size info">
                                    <IconInfoCircle size={16} />
                                 </ActionIcon>
                              </Tooltip>
                           </Group>
                        }
                        // classNames={baseFieldClassNames}
                        placeholder="1024 or [2048, 1024, 512 ....]"
                        value={cropSizes}
                        onChange={(event) => {
                           setCropSizes(event.currentTarget.value);
                        }}
                     />

                     <Select
                        mt="md"
                        comboboxProps={{ withinPortal: true }}
                        // classNames={baseFieldClassNames}
                        data={["CPU", "CUDA"]}
                        label="Device"
                        placeholder="Device"
                        defaultValue="CPU"
                        value={device}
                        name="device"
                        onChange={(value, option) => setDevice(value ?? "CPU")}
                     />

                     <Select
                        mt="md"
                        comboboxProps={{ withinPortal: true }}
                        // classNames={baseFieldClassNames}
                        data={["Image", "Text", "RPN"]}
                        label="Method"
                        placeholder="method"
                        defaultValue="Image"
                        value={method}
                        name="method"
                        onChange={(value, option) => setDevice(value ?? "CPU")}
                     />

                     <Group justify="flex-end" mt="md">
                        <SubmitButton>Generate Class Supports</SubmitButton>
                     </Group>
                  </Stack>
               </form>
            </Formik>
         </Card>

      </Stack>
   );
};

export default GenerateClassSupports;

export function clientLoader({ params }: any) {
   return { pipeid: params.id };
}
clientLoader.hydrate = true;
