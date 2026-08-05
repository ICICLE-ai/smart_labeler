import React, { useEffect, useState, useRef } from "react";
import type { BaseAnnotation } from "./types";
import {
   Box,
   Button,
   Chip,
   Dialog,
   DialogActions,
   DialogContent,
   DialogTitle,
   Divider,
   IconButton,
   List,
   ListItemButton,
   ListItemText,
   Menu,
   MenuItem,
   Paper,
   Slider,
   Stack,
   Tooltip,
   Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import FlagIcon from "@mui/icons-material/Flag";
import FlagOutlinedIcon from "@mui/icons-material/FlagOutlined";
import AddIcon from "@mui/icons-material/Add";
import { TextField } from "@mui/material";
import { applyNMS, getLabelColor } from "./utils";

// Colour palette for dynamically created flags (cycles through)
const FLAG_PALETTE = ["#f57c00", "#1976d2", "#388e3c", "#c62828", "#7b1fa2", "#00838f", "#ad1457", "#6d4c41"];
const getFlagColor = (index: number) => FLAG_PALETTE[index % FLAG_PALETTE.length];

// Default flag – only "Needs Review" pre-loaded.
const DEFAULT_FLAGS: { value: string; label: string; color: string }[] = [
   { value: "review", label: "Needs Review", color: "#f57c00" },
];

// ---------------------------------------------------------------------------
// Variant config – the small set of things that differ between the detection
// (bounding box) and segmentation (polygon mask) panels. Everything else in
// this component is shared. To add a new kind, add a variant here.
// ---------------------------------------------------------------------------
export type DetailsVariant = "detection" | "segmentation";

interface VariantConfig {
   /** Section header + count noun for the list */
   listTitle: string;
   /** Singular noun used in the bulk-edit dialog ("annotation" / "mask") */
   itemNoun: string;
   /** Secondary info line for a single item */
   describe: (ann: any) => string;
   /** Whether to show the Non-Maximum-Suppression control (detection only) */
   enableNMS: boolean;
   emptyState: React.ReactNode;
   removeBelowLabel: (confidence: string) => string;
   removeBelowTooltip: (confidence: string) => string;
   bulkPlaceholder: string;
}

// Detection: bounding-box coordinates.
const humanCoords = (b: any) =>
   `x:${b.x.toFixed(0)}, y:${b.y.toFixed(0)}, w:${b.width.toFixed(0)}, h:${b.height.toFixed(0)}`;

// Segmentation: point count + bounding box of the polygon.
const humanInfo = (ann: any): string => {
   if (!ann.points || ann.points.length === 0) return "no points";
   const xs = ann.points.map((p: any) => p.x);
   const ys = ann.points.map((p: any) => p.y);
   const minX = Math.min(...xs), maxX = Math.max(...xs);
   const minY = Math.min(...ys), maxY = Math.max(...ys);
   return `pts:${ann.points.length}  bb:${minX.toFixed(0)},${minY.toFixed(0)} ${(maxX - minX).toFixed(0)}×${(maxY - minY).toFixed(0)}`;
};

const VARIANT_CONFIG: Record<DetailsVariant, VariantConfig> = {
   detection: {
      listTitle: "Annotations",
      itemNoun: "annotation",
      describe: humanCoords,
      enableNMS: true,
      emptyState: (
         <>No annotations yet. <b>Lock</b> the view to enter draw mode, then click-drag on the image.</>
      ),
      removeBelowLabel: (c) => `Remove annotations below score : ${c}`,
      removeBelowTooltip: (c) => `Delete all annotations with score < ${c}`,
      bulkPlaceholder: "e.g., person, cat",
   },
   segmentation: {
      listTitle: "Masks",
      itemNoun: "mask",
      describe: humanInfo,
      enableNMS: false,
      emptyState: (
         <>No masks yet. <b>Lock</b> the view, then click to place polygon points. Click the first point (green) to close a mask.</>
      ),
      removeBelowLabel: (c) => `Remove masks below score: ${c}`,
      removeBelowTooltip: (c) => `Delete all masks with score < ${c}`,
      bulkPlaceholder: "e.g., car, building",
   },
};

interface AnnotationDetailsProps {
   /** Condition that selects the detection vs segmentation differences. */
   variant?: DetailsVariant;
   annotations: BaseAnnotation[];
   selectedBoxId?: string;
   selectedBoxIds?: string[];
   onSelectedBoxChange: (id: string | undefined) => void;
   onSelectedBoxIdsChange?: (ids: string[]) => void;
   onAnnotationUpdate: (id: string, updates: Partial<BaseAnnotation>) => void;
   deleteAnnotations: (id: string[]) => void;
   handleFilterAnnotations?: (score: number, activeLabels: string[], activeFlags: string[]) => void;
}

export const AnnotationDetails: React.FC<AnnotationDetailsProps> = ({
   variant = "detection",
   annotations,
   selectedBoxId,
   selectedBoxIds: selectedBoxIdsProp = [],
   onSelectedBoxChange,
   onSelectedBoxIdsChange,
   onAnnotationUpdate,
   deleteAnnotations,
   handleFilterAnnotations,
}) => {
   const config = VARIANT_CONFIG[variant];

   const [boxes, setBoxes] = useState<BaseAnnotation[]>(annotations);
   const [selectedId, setSelectedId] = useState<string | undefined>(selectedBoxId);
   const [selectedIds, setSelectedIds] = useState<string[]>(selectedBoxIdsProp);
   const [editingBoxId, setEditingBoxId] = useState<string | null>(null);
   const [labelValue, setLabelValue] = useState<string>("");
   const [bulkEditOpen, setBulkEditOpen] = useState<boolean>(false);
   const [bulkLabelValue, setBulkLabelValue] = useState<string>("");

   const [availableLabels, setAvailableLabels] = useState<string[]>([]);
   const [activeLabels, setActiveLabels] = useState<string[]>([]);
   const [activeFlags, setActiveFlags] = useState<string[]>([]);
   const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
   const [confidence, setConfidence] = useState<number>(0.3);
   const [nms, setNms] = useState<number>(0.95);

   // Flag options – starts with defaults, user can add more at runtime
   const [flagOptions, setFlagOptions] = useState(DEFAULT_FLAGS);
   const [newFlagInput, setNewFlagInput] = useState<string>("");

   // Flag menu state
   const [flagMenuAnchor, setFlagMenuAnchor] = useState<null | HTMLElement>(null);
   const [flagTargetId, setFlagTargetId] = useState<string | null>(null);

   // ---------------------------------------------------------------------------
   // Effects
   // ---------------------------------------------------------------------------
   useEffect(() => {
      handleFilterAnnotations?.(confidence, activeLabels, activeFlags);
   }, [confidence, activeLabels, activeFlags]);

   useEffect(() => {
      setSelectedId(selectedBoxId);
      if (selectedBoxId && itemRefs.current.has(selectedBoxId)) {
         itemRefs.current.get(selectedBoxId)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
   }, [selectedBoxId]);

   useEffect(() => { setSelectedIds(selectedBoxIdsProp); }, [selectedBoxIdsProp]);

   useEffect(() => {
      setBoxes(annotations);
      const distinctLabels = Array.from(new Set(annotations.map((a) => a.label)));
      setAvailableLabels((prev) => Array.from(new Set([...prev, ...distinctLabels])));

      const distinctFlags = Array.from(new Set(annotations.map((a) => a.flag).filter(Boolean))) as string[];
      setFlagOptions((prev) => {
         const existing = new Set(prev.map((f) => f.value));
         const added = distinctFlags
            .filter((v) => !existing.has(v))
            .map((value, i) => ({
               value,
               label: value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
               color: getFlagColor(prev.length + i),
            }));
         return added.length > 0 ? [...prev, ...added] : prev;
      });
   }, [annotations]);

   // ---------------------------------------------------------------------------
   // Handlers
   // ---------------------------------------------------------------------------
   const deleteBoxes = (ids: string[]) => {
      setBoxes((prev) => prev.filter((a) => !ids.includes(a.id)));
      deleteAnnotations(ids);
   };

   const deleteSelected = () => {
      const toDelete = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
      deleteBoxes(toDelete);
      setSelectedIds([]);
      setSelectedId(undefined);
      onSelectedBoxIdsChange?.([]);
      onSelectedBoxChange(undefined);
   };

   const removeBelowThreshold = () => {
      const toRemove: string[] = boxes
         .filter((b) => b.score !== undefined && b.score < confidence)
         .map((b) => b.id);
      deleteBoxes(toRemove);
   };

   const applyBulkLabel = (newLabel: string) => {
      const trimmed = newLabel.trim();
      if (!trimmed) return;
      const ids = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
      setBoxes((prev) =>
         prev.map((b) => ids.includes(b.id) ? { ...b, label: trimmed } : b)
      );
      ids.forEach((id) => {
         const box = boxes.find((b) => b.id === id);
         if (box) onAnnotationUpdate(id, { ...box, label: trimmed });
      });
      setBulkEditOpen(false);
      setBulkLabelValue("");
   };

   const editBox = (id: string) => {
      const annotation = boxes.find((a) => a.id === id);
      if (annotation) { setEditingBoxId(id); setLabelValue(annotation.label); }
   };

   const commitEdit = (b: BaseAnnotation) => {
      onAnnotationUpdate(b.id, { ...b, label: labelValue.trim() });
      setEditingBoxId(null);
      setLabelValue("");
   };

   const openFlagMenu = (e: React.MouseEvent<HTMLElement>, id: string) => {
      e.stopPropagation();
      setFlagTargetId(id);
      setFlagMenuAnchor(e.currentTarget);
   };

   const applyFlag = (flagValue: string | null) => {
      if (flagTargetId) {
         const box = boxes.find((b) => b.id === flagTargetId);
         if (box) {
            const updated = { ...box, flag: flagValue ?? undefined };
            setBoxes((prev) => prev.map((b) => (b.id === flagTargetId ? updated : b)));
            onAnnotationUpdate(flagTargetId, updated);
         }
      }
      setFlagMenuAnchor(null);
      setFlagTargetId(null);
   };

   const addFlag = () => {
      const trimmed = newFlagInput.trim();
      if (!trimmed) return;
      const value = trimmed.toLowerCase().replace(/\s+/g, "_");
      if (flagOptions.some((f) => f.value === value)) return;
      setFlagOptions((prev) => [
         ...prev,
         { value, label: trimmed, color: getFlagColor(prev.length) },
      ]);
      setNewFlagInput("");
   };

   // ---------------------------------------------------------------------------
   // Filtered + grouped data
   // ---------------------------------------------------------------------------
   const visibleBoxes = boxes.filter(
      (x) =>
         (x.score === undefined || (x.score !== undefined && x.score >= confidence)) &&
         (activeLabels.length === 0 || activeLabels.includes(x.label)) &&
         (activeFlags.length === 0 || (x.flag !== undefined && activeFlags.includes(x.flag)))
   );
   const groupedLabels = Array.from(new Set(visibleBoxes.map((b) => b.label)));

   // ---------------------------------------------------------------------------
   // Render
   // ---------------------------------------------------------------------------
   return (
      <Paper
         elevation={3}
         sx={{ p: 1.5, height: "90vh", display: "flex", flexDirection: "column", position: "relative", gap: 1 }}
      >
         {/* ── Filters (label, flag, confidence) – scrollable so annotations are never hidden ── */}
         <Box sx={{ flexShrink: 1, overflow: "auto", minHeight: 0 }}>

         {/* ── Label filter section ── */}
         <Box>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, letterSpacing: 0.5, textTransform: "uppercase", fontSize: "0.78rem", color: "text.secondary" }}>
               Filter by Label
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
               {availableLabels.map((label) => {
                  const color = getLabelColor(label);
                  const active = activeLabels.includes(label);
                  return (
                     <Chip
                        key={label}
                        label={label}
                        size="medium"
                        onClick={() =>
                           setActiveLabels((prev) =>
                              prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
                           )
                        }
                        sx={{
                           fontWeight: 600,
                           fontSize: "0.82rem",
                           borderRadius: "8px",
                           border: `2px solid ${color}`,
                           backgroundColor: active ? color : "transparent",
                           color: active ? "#fff" : color,
                           transition: "all 0.15s ease",
                           "&:hover": { backgroundColor: color, color: "#fff", opacity: 0.9 },
                        }}
                     />
                  );
               })}
               {activeLabels.length > 0 && (
                  <Chip
                     label="Clear"
                     size="small"
                     variant="outlined"
                     onClick={() => setActiveLabels([])}
                     sx={{ fontSize: "0.75rem", borderRadius: "8px", color: "text.secondary" }}
                  />
               )}
            </Box>
         </Box>

         <Divider />

         {/* ── Flag filter section ── */}
         <Box>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, letterSpacing: 0.5, textTransform: "uppercase", fontSize: "0.78rem", color: "text.secondary" }}>
               Filter by Flag
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
               {flagOptions.map((opt) => {
                  const active = activeFlags.includes(opt.value);
                  const count = boxes.filter((b) => b.flag === opt.value).length;
                  return (
                     <Chip
                        key={opt.value}
                        icon={<FlagIcon sx={{ fontSize: "0.85rem !important", color: `${active ? "#fff" : opt.color} !important` }} />}
                        label={`${opt.label}${count > 0 ? ` (${count})` : ""}`}
                        size="medium"
                        onClick={() =>
                           setActiveFlags((prev) =>
                              prev.includes(opt.value) ? prev.filter((f) => f !== opt.value) : [...prev, opt.value]
                           )
                        }
                        sx={{
                           fontWeight: 600,
                           fontSize: "0.82rem",
                           borderRadius: "8px",
                           border: `2px solid ${opt.color}`,
                           backgroundColor: active ? opt.color : "transparent",
                           color: active ? "#fff" : opt.color,
                           transition: "all 0.15s ease",
                           "&:hover": { backgroundColor: opt.color, color: "#fff", opacity: 0.9 },
                        }}
                     />
                  );
               })}
               {activeFlags.length > 0 && (
                  <Chip
                     label="Clear"
                     size="small"
                     variant="outlined"
                     onClick={() => setActiveFlags([])}
                     sx={{ fontSize: "0.75rem", borderRadius: "8px", color: "text.secondary" }}
                  />
               )}
            </Box>
            {/* ── Add new flag ── */}
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.75 }}>
               <TextField
                  size="small"
                  placeholder="New flag name…"
                  value={newFlagInput}
                  onChange={(e) => setNewFlagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addFlag(); }}
                  sx={{ flex: 1, "& .MuiInputBase-input": { fontSize: "0.82rem", py: 0.5 } }}
               />
               <Tooltip title="Add flag">
                  <span>
                     <IconButton size="small" onClick={addFlag} disabled={!newFlagInput.trim()} color="primary">
                        <AddIcon fontSize="small" />
                     </IconButton>
                  </span>
               </Tooltip>
            </Stack>
         </Box>

         <Divider />

         {/* ── Confidence slider ── */}
         <Box sx={{ px: 1 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
               <Typography variant="subtitle1" fontWeight={700} sx={{ letterSpacing: 0.5, textTransform: "uppercase", fontSize: "0.78rem", color: "text.secondary" }}>
                  Confidence
               </Typography>
               <Typography variant="body2" fontWeight={700} color="primary">
                  {confidence.toFixed(2)}
               </Typography>
            </Stack>
            <Slider
               value={confidence}
               min={0} max={1} step={0.01}
               valueLabelDisplay="auto"
               onChange={(_, v) => setConfidence(v as number)}
               size="small"
            />
            <Tooltip title={config.removeBelowTooltip(confidence.toFixed(2))}>
               <span>
                  <Button
                     size="small"
                     variant="outlined"
                     color="error"
                     startIcon={<DeleteIcon fontSize="small" />}
                     onClick={removeBelowThreshold}
                     disabled={!boxes.some((b) => b.score !== undefined && b.score < confidence)}
                     sx={{ mt: 0.5, fontSize: "0.75rem", textTransform: "none", borderRadius: 2, width: '100%' }}
                  >
                     {config.removeBelowLabel(confidence.toFixed(2))}
                  </Button>
               </span>
            </Tooltip>
            {config.enableNMS && (
               <Tooltip title="Apply Non-Maximum Suppression to eliminate overlapping boxes (keeps highest confidence)"
                  sx={{ width: '100%' }}
               >
                  <span>
                       <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, width: '100%', gap: 2 }}>
                         <TextField
                           type="number"
                           size="small"
                           value={nms}
                           onChange={(e) => setNms(parseFloat(e.target.value))}
                           sx={{ flex: '0 0 30%', "& .MuiInputBase-input": { fontSize: "0.75rem", textAlign: "center" } }}
                         />
                         <Button
                           size="small"
                           variant="outlined"
                           color="warning"
                           onClick={() => {
                              const boxesToRemove = applyNMS(boxes as any, nms);
                              deleteBoxes(boxesToRemove);
                           }}
                           disabled={boxes.length < 2}
                           sx={{ flex: 1, fontSize: "0.75rem", textTransform: "none", borderRadius: 2 }}
                         >
                           NMS (IoU ≥ {nms.toFixed(2)})
                         </Button>
                       </div>
                  </span>
               </Tooltip>
            )}
         </Box>

         <Divider />

         </Box>{/* end scrollable filters */}

         {/* ── Annotations list ── */}
         <Box sx={{ flex: 1, minHeight: 180, display: "flex", flexDirection: "column" }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
               <Typography variant="subtitle1" fontWeight={700} sx={{ letterSpacing: 0.5, textTransform: "uppercase", fontSize: "0.78rem", color: "text.secondary" }}>
                  {config.listTitle}
               </Typography>
               <Typography variant="caption" color="text.secondary">
                  {visibleBoxes.length} / {boxes.length}
               </Typography>
            </Stack>

            {/* Bulk action bar – visible when ≥1 item is multi-selected */}
            {selectedIds.length > 0 && (
               <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5, p: 0.5, borderRadius: 1, backgroundColor: "#e535351a", border: "1px solid #e5353566" }}>
                  <Chip
                     label={`${selectedIds.length} selected`}
                     size="small"
                     sx={{ fontWeight: 700, backgroundColor: "#e535351a", color: "#e53535", border: "1px solid #e53535" }}
                  />
                  <Tooltip title="Edit label for all selected">
                     <IconButton size="small" color="primary" onClick={() => { setBulkLabelValue(""); setBulkEditOpen(true); }}>
                        <EditIcon fontSize="small" />
                     </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete all selected">
                     <IconButton size="small" color="error" onClick={deleteSelected}>
                        <DeleteIcon fontSize="small" />
                     </IconButton>
                  </Tooltip>
                  <Tooltip title="Clear selection">
                     <IconButton size="small" onClick={() => { setSelectedIds([]); onSelectedBoxIdsChange?.([]); }}>
                        <span style={{ fontSize: "0.7rem", color: "text.secondary" }}>✕</span>
                     </IconButton>
                  </Tooltip>
               </Stack>
            )}

            <Box sx={{ flex: 1, overflow: "auto" }}>
               {boxes.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                     {config.emptyState}
                  </Typography>
               ) : (
                  groupedLabels.map((label) => {
                     const color = getLabelColor(label);
                     const groupBoxes = visibleBoxes.filter((b) => b.label === label);
                     return (
                        <Box key={label} sx={{ mb: 1.5 }}>
                           {/* Group header */}
                           <Box
                              sx={{
                                 display: "flex",
                                 alignItems: "center",
                                 gap: 1,
                                 px: 1,
                                 py: 0.5,
                                 borderRadius: "8px 8px 0 0",
                                 backgroundColor: color,
                              }}
                           >
                              <Typography
                                 variant="body2"
                                 fontWeight={700}
                                 sx={{ color: "#fff", fontSize: "0.88rem", letterSpacing: 0.4, flex: 1 }}
                              >
                                 {label}
                              </Typography>
                              <Chip
                                 label={groupBoxes.length}
                                 size="small"
                                 sx={{
                                    height: 20,
                                    fontSize: "0.72rem",
                                    fontWeight: 700,
                                    backgroundColor: "rgba(255,255,255,0.25)",
                                    color: "#fff",
                                 }}
                              />
                           </Box>

                           {/* Group items */}
                           <Paper
                              variant="outlined"
                              sx={{ borderRadius: "0 0 8px 8px", borderTop: "none", borderColor: color, overflow: "hidden" }}
                           >
                              <List dense disablePadding>
                                 {groupBoxes.map((b, idx) => {
                                    const isSelected = selectedId === b.id;
                                    const isMultiSelected = selectedIds.includes(b.id);
                                    const flagInfo = flagOptions.find((f) => f.value === b.flag);
                                    return (
                                       <React.Fragment key={b.id}>
                                          {idx > 0 && <Divider />}
                                          <ListItemButton
                                             ref={(el: HTMLDivElement | null) => {
                                                if (el) itemRefs.current.set(b.id, el);
                                                else itemRefs.current.delete(b.id);
                                             }}
                                             selected={isSelected || isMultiSelected}
                                             sx={{
                                                alignItems: "flex-start",
                                                borderLeft: isMultiSelected
                                                   ? "4px solid #e53535"
                                                   : isSelected ? `4px solid ${color}` : "4px solid transparent",
                                                backgroundColor: isMultiSelected ? "#e535350a" : undefined,
                                                transition: "border-left 0.15s ease",
                                                pl: (isSelected || isMultiSelected) ? 0.5 : 1,
                                             }}
                                             onClick={(e) => {
                                                if (e.ctrlKey || e.metaKey) {
                                                   const next = isMultiSelected
                                                      ? selectedIds.filter((id) => id !== b.id)
                                                      : [...selectedIds, b.id];
                                                   setSelectedIds(next);
                                                   onSelectedBoxIdsChange?.(next);
                                                } else {
                                                   setSelectedIds([]);
                                                   onSelectedBoxIdsChange?.([]);
                                                   setSelectedId(b.id);
                                                   onSelectedBoxChange(b.id);
                                                }
                                             }}
                                          >
                                             <ListItemText
                                                primary={
                                                   <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                                                      {editingBoxId === b.id ? (
                                                         <input
                                                            type="text"
                                                            value={labelValue}
                                                            autoFocus
                                                            onChange={(e) => setLabelValue(e.target.value)}
                                                            onBlur={() => commitEdit(b)}
                                                            onKeyDown={(e) => {
                                                               if (e.key === "Enter") commitEdit(b);
                                                               else if (e.key === "Escape") { setEditingBoxId(null); setLabelValue(""); }
                                                            }}
                                                            style={{
                                                               fontSize: "0.88rem",
                                                               fontWeight: 600,
                                                               width: "110px",
                                                               padding: "2px 6px",
                                                               borderRadius: 4,
                                                               border: `1px solid ${color}`,
                                                               outline: "none",
                                                            }}
                                                         />
                                                      ) : (
                                                         <>
                                                            {isMultiSelected && (
                                                               <Chip
                                                                  size="small"
                                                                  label="✓"
                                                                  sx={{ height: 18, fontSize: "0.7rem", fontWeight: 700, backgroundColor: "#e53535", color: "#fff" }}
                                                               />
                                                            )}
                                                            {isSelected && !isMultiSelected && (
                                                               <Chip
                                                                  size="small"
                                                                  label="Selected"
                                                                  sx={{ height: 18, fontSize: "0.7rem", fontWeight: 700, backgroundColor: color, color: "#fff" }}
                                                               />
                                                            )}
                                                         </>
                                                      )}
                                                      {flagInfo && (
                                                         <Chip
                                                            size="small"
                                                            icon={<FlagIcon sx={{ fontSize: "0.8rem !important", color: `${flagInfo.color} !important` }} />}
                                                            label={flagInfo.label}
                                                            sx={{
                                                               height: 18,
                                                               fontSize: "0.7rem",
                                                               fontWeight: 600,
                                                               backgroundColor: `${flagInfo.color}22`,
                                                               color: flagInfo.color,
                                                               border: `1px solid ${flagInfo.color}66`,
                                                            }}
                                                         />
                                                      )}
                                                   </Stack>
                                                }
                                                secondary={
                                                   <Typography variant="caption" color="text.secondary" component="span">
                                                      {config.describe(b)}
                                                      {b.score !== undefined && ` · ${(b.score * 100).toFixed(0)}%`}
                                                   </Typography>
                                                }
                                             />

                                             {/* Action buttons */}
                                             <Stack direction="row" alignItems="center" spacing={0}>
                                                <Tooltip title={b.flag ? `Flag: ${flagInfo?.label ?? b.flag}` : "Add Flag"}>
                                                   <IconButton
                                                      size="small"
                                                      onClick={(e) => openFlagMenu(e, b.id)}
                                                      sx={{ color: flagInfo ? flagInfo.color : "action.disabled" }}
                                                   >
                                                      {b.flag ? <FlagIcon fontSize="small" /> : <FlagOutlinedIcon fontSize="small" />}
                                                   </IconButton>
                                                </Tooltip>
                                                <Tooltip title="Edit label">
                                                   <IconButton size="small" onClick={(e) => { e.stopPropagation(); editBox(b.id); }}>
                                                      <EditIcon fontSize="small" />
                                                   </IconButton>
                                                </Tooltip>
                                                <Tooltip title="Delete">
                                                   <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); deleteBoxes([b.id]); }}>
                                                      <DeleteIcon fontSize="small" />
                                                   </IconButton>
                                                </Tooltip>
                                             </Stack>
                                          </ListItemButton>
                                       </React.Fragment>
                                    );
                                 })}
                              </List>
                           </Paper>
                        </Box>
                     );
                  })
               )}
            </Box>
         </Box>

         {/* ── Flag context menu ── */}
         <Menu
            anchorEl={flagMenuAnchor}
            open={Boolean(flagMenuAnchor)}
            onClose={() => setFlagMenuAnchor(null)}
            PaperProps={{ elevation: 3, sx: { minWidth: 160, borderRadius: 2 } }}
         >
            {flagOptions.map((opt) => (
               <MenuItem
                  key={opt.value}
                  onClick={() => applyFlag(opt.value)}
                  sx={{ gap: 1, fontSize: "0.88rem" }}
               >
                  <FlagIcon sx={{ color: opt.color, fontSize: "1rem" }} />
                  <Typography variant="body2" sx={{ color: opt.color, fontWeight: 600 }}>{opt.label}</Typography>
               </MenuItem>
            ))}
            <Divider />
            <MenuItem onClick={() => applyFlag(null)} sx={{ fontSize: "0.88rem", color: "text.secondary" }}>
               Clear flag
            </MenuItem>
         </Menu>

         {/* ── Bulk label edit dialog ── */}
         <Dialog open={bulkEditOpen} onClose={() => setBulkEditOpen(false)} maxWidth="xs" fullWidth>
            <DialogTitle>
               Edit label for {selectedIds.length} selected {config.itemNoun}{selectedIds.length !== 1 ? "s" : ""}
            </DialogTitle>
            <DialogContent>
               <TextField
                  variant="filled"
                  autoFocus
                  fullWidth
                  label="New label"
                  value={bulkLabelValue}
                  onChange={(e) => setBulkLabelValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") applyBulkLabel(bulkLabelValue); }}
                  placeholder={config.bulkPlaceholder}
               />
            </DialogContent>
            <DialogActions>
               <Button onClick={() => setBulkEditOpen(false)}>Cancel</Button>
               <Button variant="contained" onClick={() => applyBulkLabel(bulkLabelValue)}>Apply</Button>
            </DialogActions>
         </Dialog>
      </Paper>
   );
};
