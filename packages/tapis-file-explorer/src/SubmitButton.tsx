import { Button, type ButtonProps } from "@mantine/core";
import { useFormikContext } from "formik";

/** Submits the enclosing Formik form without needing a native `<button type="submit">`. */
export const SubmitButton = ({ ...props }: ButtonProps) => {
   const ctx = useFormikContext();
   return <Button type="button" {...props} onClick={() => ctx.submitForm()} />;
};

export default SubmitButton;
