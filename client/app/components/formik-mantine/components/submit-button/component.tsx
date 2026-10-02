import { Button, ButtonProps } from "@mantine/core";
import { useFormikContext } from "formik";

/**
 * Submits the enclosing Formik form.
 *
 * While the form's `onSubmit` is in flight the button shows a spinner and stops
 * accepting clicks. Job submissions take several seconds to come back, and
 * without this the page looks inert — users conclude nothing happened and submit
 * the same job again, several times over, before the first response arrives.
 *
 * This relies on Formik's own `isSubmitting`, which stays true only for as long
 * as the promise returned by `onSubmit` is pending. A handler that returns
 * nothing leaves the button spinning, so form handlers must be async.
 */
export const SubmitButton = ({ loading, disabled, ...props }: ButtonProps) => {
  const ctx = useFormikContext();
  const busy = loading ?? ctx.isSubmitting;
  return (
    <Button
      type="button"
      {...props}
      loading={busy}
      disabled={disabled || busy}
      onClick={() => ctx.submitForm()}
    />
  );
};

export default SubmitButton;
