import { useState } from "react";
import { useField } from "formik";
import { Group, TextInput, Button } from "@mantine/core";
import { FileSelectModalWrapper } from "./FileSelectModalWrapper";
import type { TapisFileEntry } from "./FileExplorerWrapper";

export interface TapisDirectoryFieldProps {
   /** Formik field name this control writes to. */
   name: string;
   label?: string;
   description?: string;
   systemId: string;
   /** Auth token forwarded to the browse modal's Tapis requests. */
   token: string;
   disabled?: boolean;
   placeholder?: string;
}

/**
 * A Formik-bound text field with a "Browse" button that opens a Tapis
 * directory picker (`FileSelectModalWrapper`) and writes the chosen path
 * back into the form. Mirrors the "source directory" field used by
 * `FileExplorer`'s own directory-entry form, but usable standalone in any
 * Formik form.
 */
export const TapisDirectoryField = ({
   name,
   label,
   description,
   systemId,
   token,
   disabled,
   placeholder = "path/to/directory",
}: TapisDirectoryFieldProps) => {
   const [field, , helpers] = useField(name);
   const [open, setOpen] = useState(false);

   return (
      <div style={{ width: "100%" }}>
         <Group gap="xs" align="flex-end" wrap="nowrap" style={{ width: "100%" }}>
            <TextInput
               style={{ flex: 1 }}
               label={label}
               description={description}
               placeholder={placeholder}
               disabled={disabled}
               value={field.value ?? ""}
               onChange={(e) => helpers.setValue(e.currentTarget.value)}
            />
            <Button
               size="sm"
               variant="outline"
               disabled={disabled || !systemId}
               onClick={() => setOpen(true)}
            >
               Browse
            </Button>
         </Group>
         {open && (
            <FileSelectModalWrapper
               toggle={() => setOpen(false)}
               systemId={systemId}
               token={token}
               path={field.value || "/"}
               selectMode={{ mode: "single", types: ["dir"] }}
               onSelect={(_systemId: string | null, files: TapisFileEntry[]) => {
                  const picked = files?.[0];
                  if (picked) helpers.setValue(picked.path);
               }}
            />
         )}
      </div>
   );
};

export default TapisDirectoryField;
