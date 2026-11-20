import { Box, Button, Group, Stepper, Text } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { Outlet, useLocation, useNavigate, useParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { useCookies } from "react-cookie";
import PipelineTypeGuard from "~/components/PipelineTypeGuard/PipelineTypeGuard";
import { fetchAndReturnData, TYPE } from "~/utils/utils";

/** The steps of a ProtoRCD pipeline, in order. */
const STEPS = [
   { path: "configure", label: "Configure jobs", description: "Proposals and embeddings on HPC" },
   { path: "triage", label: "Human in the loop", description: "Label batches until triage is done" },
   { path: "review", label: "Review", description: "Confirm and fix every box in the annotator" },
];

export default function ProtoRCDLayout() {
   const { id = "" } = useParams();
   const location = useLocation();
   const navigate = useNavigate();
   const [cookie] = useCookies(["tapis-token"]);
   const token = cookie["tapis-token"]?.["access_token"] ?? "";
   const [name, setName] = useState<string>("");

   useEffect(() => {
      if (!id || !token) return;
      fetchAndReturnData(`/pipe/${id}`, token).then((p) => setName(p?.name ?? ""));
   }, [id, token]);

   const active = Math.max(0, STEPS.findIndex((s) => location.pathname.includes(`/protorcd/${s.path}/`)));
   // The annotator lays itself out against the top of the page (its File Explorer
   // tab is fixed there), so the review step gets no padding.
   const flush = STEPS[active].path === "review";

   return (
      <PipelineTypeGuard pipeid={id} token={token} expected={TYPE.PROTORCD}>
         <Box style={{ minHeight: "100vh", background: "#fafafa" }}>
            <Box px="lg" py="sm" style={{ background: "white", boxShadow: "0 2px 4px rgba(0,0,0,0.08)" }}>
               <Group justify="space-between" wrap="nowrap" gap="lg">
                  <Group gap="sm" wrap="nowrap">
                     <Button variant="subtle" size="xs" leftSection={<IconArrowLeft size={14} />}
                        onClick={() => navigate("/dashboard")}>
                        Pipelines
                     </Button>
                     <Text fw={600} truncate maw={260}>{name || `Pipeline ${id}`}</Text>
                  </Group>
                  <Stepper
                     active={active}
                     onStepClick={(i) => navigate(`/protorcd/${STEPS[i].path}/${id}`)}
                     size="sm"
                     style={{ flex: 1, maxWidth: 900 }}
                  >
                     {STEPS.map((s) => (
                        <Stepper.Step key={s.path} label={s.label} description={s.description} />
                     ))}
                  </Stepper>
               </Group>
            </Box>
            <Box p={flush ? 0 : "lg"}>
               <Outlet />
            </Box>
         </Box>
      </PipelineTypeGuard>
   );
}
