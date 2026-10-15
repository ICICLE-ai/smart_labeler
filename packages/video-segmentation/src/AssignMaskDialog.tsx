import { useEffect, useState } from "react";
import {
   Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
   Divider, List, ListItemButton, ListItemText, Stack, TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { nextObjectId, objectColorCss, type VideoObject } from "./utils";

export interface AssignMaskDialogProps {
   open: boolean;
   /** The frame the region was drawn on, named so the user knows what they are labelling. */
   frameIdx: number;
   objects: VideoObject[];
   /** Objects that already carry a mask on this frame — assigning replaces it. */
   objectsWithMaskHere: Set<number>;
   onAssign: (object: VideoObject) => void;
   /** Throw the region away; nothing is recorded and the canvas is cleared. */
   onDiscard: () => void;
}

/**
 * Asks which object a freshly drawn region belongs to.
 *
 * Drawing comes first and assignment second, because requiring an object to be
 * selected up front meant a region drawn without one was simply stranded: the
 * canvas had already painted it, nothing owned it, and it could be neither
 * tracked nor deleted.
 */
export function AssignMaskDialog({
   open, frameIdx, objects, objectsWithMaskHere, onAssign, onDiscard,
}: AssignMaskDialogProps) {
   const [creatingNew, setCreatingNew] = useState(objects.length === 0);
   const [newLabel, setNewLabel] = useState("");

   // A fresh region starts the dialog over; with no objects yet there is nothing
   // to pick from, so go straight to naming one.
   useEffect(() => {
      if (open) {
         setCreatingNew(objects.length === 0);
         setNewLabel("");
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [open, frameIdx]);

   const createAndAssign = () => {
      const label = newLabel.trim();
      if (!label) return;
      onAssign({ id: nextObjectId(objects), label });
   };

   return (
      <Dialog open={open} onClose={onDiscard} maxWidth="xs" fullWidth>
         <DialogTitle>Assign this region</DialogTitle>
         <DialogContent>
            <DialogContentText sx={{ fontSize: "0.9rem", mb: 1.5 }}>
               You drew a region on frame {frameIdx}. Every mask belongs to one tracked object — pick which.
            </DialogContentText>

            {objects.length > 0 && (
               <>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                     Existing objects
                  </Typography>
                  <List dense disablePadding sx={{ mb: 1 }}>
                     {objects.map((obj) => {
                        const replaces = objectsWithMaskHere.has(obj.id);
                        return (
                           <ListItemButton
                              key={obj.id}
                              onClick={() => onAssign(obj)}
                              sx={{ borderRadius: 1, mb: 0.5 }}
                           >
                              <Box
                                 sx={{
                                    width: 12, height: 12, borderRadius: "50%", mr: 1.25, flexShrink: 0,
                                    bgcolor: objectColorCss(obj.id),
                                 }}
                              />
                              <ListItemText
                                 primary={obj.label}
                                 secondary={replaces
                                    ? `obj_id ${obj.id} · replaces its mask on this frame`
                                    : `obj_id ${obj.id}`}
                              />
                           </ListItemButton>
                        );
                     })}
                  </List>
                  <Divider sx={{ my: 1.5 }} />
               </>
            )}

            {creatingNew ? (
               <Stack direction="row" spacing={1} alignItems="flex-start">
                  <TextField
                     size="small"
                     fullWidth
                     autoFocus
                     label="New object label"
                     placeholder="e.g. torch, weld_pool"
                     value={newLabel}
                     onChange={(e) => setNewLabel(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter") createAndAssign(); }}
                  />
                  <Button variant="contained" onClick={createAndAssign} disabled={!newLabel.trim()} sx={{ mt: 0.25 }}>
                     Add
                  </Button>
               </Stack>
            ) : (
               <Button startIcon={<AddIcon />} onClick={() => setCreatingNew(true)} size="small">
                  New object
               </Button>
            )}
         </DialogContent>
         <DialogActions>
            <Button color="error" onClick={onDiscard}>Discard region</Button>
         </DialogActions>
      </Dialog>
   );
}

export default AssignMaskDialog;
