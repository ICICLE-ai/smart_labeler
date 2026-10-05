import { useState } from "react";
import {
   Box, Button, Chip, IconButton, List, ListItemButton, ListItemText, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import { objectColorCss, nextObjectId, type VideoObject } from "./utils";

export interface ObjectPanelProps {
   objects: VideoObject[];
   onObjectsChange: (objects: VideoObject[]) => void;
   activeObjectId: number | null;
   onActiveObjectChange: (id: number | null) => void;
   /** How many frames currently carry a mask for each object, for a quick glance at coverage. */
   maskCountByObject: Map<number, number>;
   disabled?: boolean;
}

/**
 * Object list for video tracking: add/rename/delete objects, each with a
 * stable id (the tracker's `obj_id`) and a color. "Select object, then
 * annotate" — whichever object is active here is the one new masks on the
 * canvas are attached to, regardless of which tool drew them.
 */
export function ObjectPanel({
   objects, onObjectsChange, activeObjectId, onActiveObjectChange, maskCountByObject, disabled,
}: ObjectPanelProps) {
   const [editingId, setEditingId] = useState<number | null>(null);
   const [editingLabel, setEditingLabel] = useState("");

   const addObject = () => {
      const id = nextObjectId(objects);
      const label = `object_${id}`;
      onObjectsChange([...objects, { id, label }]);
      onActiveObjectChange(id);
   };

   const startRename = (obj: VideoObject) => { setEditingId(obj.id); setEditingLabel(obj.label); };
   const commitRename = () => {
      if (editingId == null) return;
      const trimmed = editingLabel.trim();
      if (trimmed) {
         onObjectsChange(objects.map((o) => (o.id === editingId ? { ...o, label: trimmed } : o)));
      }
      setEditingId(null);
   };

   const deleteObject = (id: number) => {
      onObjectsChange(objects.filter((o) => o.id !== id));
      if (activeObjectId === id) onActiveObjectChange(null);
   };

   return (
      <Box sx={{ p: 1.5 }}>
         <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" fontWeight={700}>Objects</Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={addObject} disabled={disabled}>
               Add
            </Button>
         </Stack>

         {objects.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 0.5 }}>
               Add an object, then annotate it on one or more keyframes.
            </Typography>
         )}

         <List dense disablePadding>
            {objects.map((obj) => {
               const isActive = obj.id === activeObjectId;
               const count = maskCountByObject.get(obj.id) ?? 0;
               const color = objectColorCss(obj.id);
               return (
                  <ListItemButton
                     key={obj.id}
                     selected={isActive}
                     onClick={() => onActiveObjectChange(obj.id)}
                     disabled={disabled}
                     sx={{ borderRadius: 1, mb: 0.5, px: 1, py: 0.5 }}
                  >
                     <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: color, mr: 1, flexShrink: 0 }} />
                     {editingId === obj.id ? (
                        <TextField
                           size="small"
                           autoFocus
                           value={editingLabel}
                           onChange={(e) => setEditingLabel(e.target.value)}
                           onClick={(e) => e.stopPropagation()}
                           onKeyDown={(e) => { if (e.key === "Enter") commitRename(); }}
                           sx={{ flex: 1, mr: 1 }}
                        />
                     ) : (
                        <ListItemText
                           primary={obj.label}
                           secondary={`obj_id ${obj.id}`}
                           primaryTypographyProps={{ fontWeight: isActive ? 700 : 400 }}
                        />
                     )}
                     {count > 0 && (
                        <Chip label={count} size="small" sx={{ mr: 0.5, height: 18, fontSize: "0.68rem" }} />
                     )}
                     {editingId === obj.id ? (
                        <Tooltip title="Save">
                           <IconButton size="small" onClick={(e) => { e.stopPropagation(); commitRename(); }}>
                              <CheckIcon fontSize="small" />
                           </IconButton>
                        </Tooltip>
                     ) : (
                        <Tooltip title="Rename">
                           <IconButton size="small" onClick={(e) => { e.stopPropagation(); startRename(obj); }}>
                              <EditIcon fontSize="small" />
                           </IconButton>
                        </Tooltip>
                     )}
                     <Tooltip title="Delete object">
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); deleteObject(obj.id); }}>
                           <DeleteIcon fontSize="small" />
                        </IconButton>
                     </Tooltip>
                  </ListItemButton>
               );
            })}
         </List>
      </Box>
   );
}

export default ObjectPanel;
