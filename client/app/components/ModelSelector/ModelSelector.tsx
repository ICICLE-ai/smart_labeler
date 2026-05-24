import {
   Box,
   Group,
   Text,
   ScrollArea,
   Paper,
   Stack,
   Alert,
   Badge,
   Tooltip,
   ActionIcon,
   Loader,
   Modal,
   PasswordInput,
   Button,
   Checkbox,
} from "@mantine/core";
import { IconInfoCircle, IconLock, IconAlertCircle, IconCheck } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { getBaseURL } from "~/utils/utils";
import { PatraCard, PatraModelDetails, PatraDetailsContent } from "~/components/PatraModelCards/PatraModelCards";
import { checkSecretExists, saveHfTokenToVault } from "~/utils/hfTokenManager";
import { useCookies } from "react-cookie";

// type ModelFilterType = "proposer" | "embedder" | "all";

interface ModelSelectorProps {
   selectedModelIds: string[];
   onModelSelect: (modelId: string) => void;
   onModelDeselect: (modelId: string) => void;
   title?: string;
   maxHeight?: number;
   multiSelect?: boolean;
   filterList: string[];
   onHfTokenRequired?: (modelId: string, modelName: string) => void;
   tapisToken?: string;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
   selectedModelIds,
   onModelSelect,
   onModelDeselect,
   title = "Select Model",
   maxHeight = 220,
   multiSelect = false,
   filterList = [],
   onHfTokenRequired,
   tapisToken = "",
}) => {
   const [patraCards, setPatraCards] = useState<PatraCard[]>([]);
   const [patraDetailsMap, setPatraDetailsMap] = useState<Map<string, PatraModelDetails>>(new Map());
   const [patraLoading, setPatraLoading] = useState(false);
   const [hfModalOpen, setHfModalOpen] = useState(false);
   const [hfTokenValue, setHfTokenValue] = useState("");
   const [hfTokenError, setHfTokenError] = useState<string | null>(null);
   const [hfTokenSaving, setHfTokenSaving] = useState(false);
   const [pendingModelId, setPendingModelId] = useState<string | null>(null);
   const [pendingModelName, setPendingModelName] = useState<string | null>(null);
   const [hfDetailsLoading, setHfDetailsLoading] = useState(false);
   const [detailsModalId, setDetailsModalId] = useState<string | null>(null);
   const [detailsLoading, setDetailsLoading] = useState<boolean>(false);
   const [cookie] = useCookies(["tapis-token"]);


   // Fetch model details when HF modal opens, so license/location are available
   useEffect(() => {
      if (!hfModalOpen || !pendingModelId) return;
      if (patraDetailsMap.has(pendingModelId)) return;
      setHfDetailsLoading(true);
      fetch(`${getBaseURL()}/patra/download_mc/${pendingModelId}?new=true`, {
         headers: { "Tapis-Token": cookie["tapis-token"]["access_token"] },
      })
         .then((res) => res.json())
         .then((details: PatraModelDetails) => {
            setPatraDetailsMap((prev) => new Map(prev).set(pendingModelId, details));
         })
         .catch((e) => console.error("Failed to fetch model details for HF modal:", e))
         .finally(() => setHfDetailsLoading(false));
   }, [hfModalOpen, pendingModelId]);

   // Handle opening model details modal
   const openDetails = (uuid: string) => {
      setDetailsModalId(uuid);
      if (patraDetailsMap.has(uuid)) return;
      setDetailsLoading(true);
      fetch(`${getBaseURL()}/patra/download_mc/${uuid}?new=true`, {
         headers: {
            "Tapis-Token": cookie["tapis-token"]["access_token"],
         },
      })
         .then((res) => res.json())
         .then((details: PatraModelDetails) => {
            setPatraDetailsMap((prev) => new Map(prev).set(uuid, details));
         })
         .catch((e) => console.error("Failed to fetch Patra details:", e))
         .finally(() => setDetailsLoading(false));
   };

   // Helper: Retrieve card by UUID
   const getOurModelById = (uuid: string): PatraCard | null => {
      if (!Array.isArray(patraCards)) return null;
      return patraCards.find((m) => m.uuid === uuid) ?? null;
   };

   useEffect(() => {
      setPatraLoading(true);
      fetch(`${getBaseURL()}/patra/list?new=true`, {
         headers: {
            "Tapis-Token": cookie["tapis-token"]["access_token"],
         },
      })
         .then((res) => res.json())
         .then((data) => setPatraCards(data))
         .catch((e) => console.error("Failed to fetch Patra model cards:", e))
         .finally(() => setPatraLoading(false));
   }, []);

   // Filter models based on type
   const getFilteredModels = (cards: PatraCard[]): PatraCard[] => {
      if (!cards || !Array.isArray(cards)) return [];
      if (filterList.length === 0) return cards;

      return cards.filter((card) => {
         if (selectedModelIds.includes(card.uuid)) return true;
         return filterList.some((filter) =>
            card.uuid === filter ||
            card.name.toLowerCase().includes(filter.toLowerCase()) ||
            card.categories.toLowerCase().includes(filter.toLowerCase())
         );
      });
   };



   // Handle model selection with gated model checking
   const handleModelClick = async (uuid: string) => {
      const card = getOurModelById(uuid);

      if (card?.is_gated && tapisToken) {
         const secretExists = await checkSecretExists(tapisToken);
         if (!secretExists) {
            setPendingModelId(uuid);
            setPendingModelName(card.name || uuid);
            setHfTokenValue("");
            setHfTokenError(null);
            setHfModalOpen(true);
            if (onHfTokenRequired) {
               onHfTokenRequired(uuid, card.name || uuid);
            }
            return;
         }
      }

      const isAlreadySelected = selectedModelIds.includes(uuid);
      if (isAlreadySelected) {
         onModelDeselect(uuid);
      } else {
         if (!multiSelect && selectedModelIds.length > 0) {
            onModelDeselect(selectedModelIds[0]);
         }
         onModelSelect(uuid);
      }
   };

   // Clear all selections
   const handleClearAll = () => {
      selectedModelIds.forEach((modelId) => onModelDeselect(modelId));
   };

   // Save HF token
   const saveHfToken = async () => {
      if (!tapisToken) {
         setHfTokenError("Tapis token not available");
         return;
      }

      setHfTokenSaving(true);
      const result = await saveHfTokenToVault(hfTokenValue, tapisToken);
      setHfTokenSaving(false);

      if (!result.success) {
         setHfTokenError(result.error || "Failed to save token");
         return;
      }

      setHfModalOpen(false);
      if (pendingModelId) {
         // Retry the selection
         handleModelClick(pendingModelId);
         setPendingModelId(null);
         setPendingModelName(null);
      }
   };

   // Render individual model card
   const renderCard = (card: PatraCard) => {
      const isSelected = selectedModelIds.includes(card.uuid);

      return (
         <Paper
            key={card.uuid}
            withBorder
            p="sm"
            radius="md"
            style={{
               borderColor: isSelected
                  ? "var(--mantine-color-blue-6)"
                  : "var(--mantine-color-gray-3)",
               backgroundColor: isSelected
                  ? "var(--mantine-color-blue-0)"
                  : "white",
               cursor: "pointer",
               boxShadow: isSelected
                  ? "0 0 0 1px var(--mantine-color-blue-4), 0 6px 14px rgba(59,130,246,0.16)"
                  : "0 1px 2px rgba(15,23,42,0.05)",
               transition: "all 140ms ease",
            }}
            onClick={() => handleModelClick(card.uuid)}
         >
            <Group justify="space-between" wrap="nowrap">
               <Box style={{ flex: 1, minWidth: 0 }}>
                  <Group gap="xs" mb={2}>
                     <Text size="sm" fw={600}>
                        {card.name}
                     </Text>
                     {card.version && (
                        <Badge size="xs" variant="light">
                           {card.version}
                        </Badge>
                     )}
                     {card.is_gated && (
                        <Badge
                           size="xs"
                           color="yellow"
                           variant="light"
                           leftSection={<IconLock size={10} />}
                        >
                           Gated
                        </Badge>
                     )}
                     {isSelected && !multiSelect && (
                        <IconCheck size={16} color="var(--mantine-color-green-6)" />
                     )}
                  </Group>
                  <Text size="xs" c="dimmed" lineClamp={2}>
                     {card.short_description}
                  </Text>
               </Box>
               <Tooltip label="View full details">
                  <ActionIcon
                     variant="subtle"
                     size="sm"
                     onClick={(e) => {
                        e.stopPropagation();
                        openDetails(card.uuid);
                     }}
                  >
                     <IconInfoCircle size={16} />
                  </ActionIcon>
               </Tooltip>
            </Group>
         </Paper>
      );
   };

   const filteredModels = getFilteredModels(patraCards) || [];

   return (
      <Box>
         <Text size="sm" fw={700} mb={8}>
            {title}
         </Text>

         <Box mt="sm">
               {patraLoading ? (
                  <Group justify="center" py="md">
                     <Loader size="sm" />
                  </Group>
               ) : (
                  <ScrollArea h={maxHeight} type="scroll" offsetScrollbars>
                     <Stack gap="xs">
                        {filteredModels.length === 0 ? (
                           <Text size="sm" c="dimmed" ta="center" py="lg">
                              No models available for this selection
                           </Text>
                        ) : (
                           filteredModels.map((card) => renderCard(card))
                        )}
                     </Stack>
                  </ScrollArea>
               )}
            </Box>

         {selectedModelIds.length > 0 && (
            <Alert
               icon={<IconInfoCircle size={16} />}
               title={multiSelect ? `Selected Models (${selectedModelIds.length})` : "Selected Model"}
               color="blue"
               mt="sm"
            >
               <Stack gap={4}>
                  {selectedModelIds.map((modelId) => {
                     const model = getOurModelById(modelId);
                     const modelName = model?.name ?? modelId;
                     return (
                        <Group key={modelId} justify="space-between" gap="xs">
                           <Text size="sm" fw={500}>
                              {modelName}
                           </Text>
                           {multiSelect && (
                              <ActionIcon
                                 size="xs"
                                 variant="light"
                                 color="red"
                                 onClick={() => onModelDeselect(modelId)}
                              >
                                 ×
                              </ActionIcon>
                           )}
                        </Group>
                     );
                  })}
                     {multiSelect && selectedModelIds.length > 1 && (
                        <Button
                           size="xs"
                           variant="light"
                           color="gray"
                           onClick={handleClearAll}
                           fullWidth
                           mt="xs"
                        >
                           Clear All
                        </Button>
                     )}
               </Stack>
            </Alert>
         )}

         {/* HF Token Modal */}
         <Modal
            opened={hfModalOpen}
            onClose={() => setHfModalOpen(false)}
            title="Hugging Face Token Required"
            centered
         >
            <Stack gap="md">
               <Alert icon={<IconAlertCircle size={16} />} color="yellow">
                  <Text size="sm">
                     The model "<strong>{pendingModelName}</strong>" is gated and requires a
                     Hugging Face API token to access. Please provide your token
                     to continue.
                  </Text>
               </Alert>

               {(() => {
                  const details = pendingModelId ? patraDetailsMap.get(pendingModelId) : undefined;
                  const license = details?.ai_model?.license;
                  const location = details?.ai_model?.location;
                  if (hfDetailsLoading) return <Text size="xs" c="dimmed">Loading model details…</Text>;
                  if (!license && !location) return null;
                  return (
                     <Stack gap={4}>
                        {license && (
                           <Text size="sm">
                              <strong>License:</strong> {license}
                           </Text>
                        )}
                        {location && (
                           <Text size="sm">
                              <strong>Request access:</strong>{" "}
                              <a href={location} target="_blank" rel="noreferrer" style={{ color: "var(--mantine-color-blue-6)" }}>
                                 {location}
                              </a>
                           </Text>
                        )}
                     </Stack>
                  );
               })()}

               <PasswordInput
                  label="Hugging Face API Token"
                  placeholder="hf_xxxxxxxxxxxxx"
                  value={hfTokenValue}
                  onChange={(e) => {
                     setHfTokenValue(e.currentTarget.value);
                     setHfTokenError(null);
                  }}
                  disabled={hfTokenSaving}
               />

               {hfTokenError && (
                  <Alert icon={<IconAlertCircle size={16} />} color="red">
                     <Text size="sm">{hfTokenError}</Text>
                  </Alert>
               )}

               <Group justify="flex-end">
                  <Button
                     variant="default"
                     onClick={() => setHfModalOpen(false)}
                     disabled={hfTokenSaving}
                  >
                     Cancel
                  </Button>
                  <Button
                     onClick={saveHfToken}
                     loading={hfTokenSaving}
                     disabled={!hfTokenValue.trim()}
                  >
                     Save Token
                  </Button>
               </Group>
            </Stack>
         </Modal>

         {/* Model Card Details Modal */}
         <Modal
            opened={detailsModalId !== null}
            onClose={() => setDetailsModalId(null)}
            title="Model Card Details"
            size="lg"
            scrollAreaComponent={ScrollArea.Autosize}
         >
            {detailsLoading && detailsModalId !== null && !patraDetailsMap.has(detailsModalId) ? (
               <Group justify="center" py="xl"><Text>Loading...</Text></Group>
            ) : detailsModalId !== null && patraDetailsMap.has(detailsModalId)
               ? (
                  <PatraDetailsContent
                     details={(patraDetailsMap.get(detailsModalId!))!}
                     onUse={() => {
                        if (detailsModalId) {
                           onModelSelect(detailsModalId);
                        }
                        setDetailsModalId(null);
                     }}
                  />
               ) : null}
         </Modal>

      </Box>
   );
};
