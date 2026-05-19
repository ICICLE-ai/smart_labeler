import React, { useCallback, useMemo } from "react";
import FieldWrapper from "@tapis/tapisui-common/dist/ui-formik/FieldWrapperFormik/FieldWrapperFormik";
import { Input, InputGroup, Button } from "reactstrap";
import { useField } from "formik";
import { useModal } from "@tapis/tapisui-common";
import FileSelectModalWrapper from "~/components/FileExplorer/FileSelectModalWrapper";

const pathToFile = (path?: string) => {
  if (path) {
    return {
      name: path.split("/").slice(-1)[0],
      path,
    };
  }
  return undefined;
};

const pathParent = (path?: string) => {
  const parentDir = path?.split("/").slice(0, -1).join("/");
  return !!parentDir && !!parentDir.length ? parentDir : "/";
};

export const parseTapisURI = (uri?: string) => {
  const regex = /tapis:\/\/([\w.\-_]+)\/(.+)/;
  const match = uri?.match(regex);

  if (match) {
    const systemId = match[1];
    const filePath = `/${match[2]}`;
    return {
      systemId,
      file: pathToFile(filePath),
      parent: pathParent(filePath),
    };
  }

  return undefined;
};

const normalizeToPathOnly = (value?: string) => {
  if (!value) {
    return "";
  }

  const parsed = parseTapisURI(value);
  if (parsed?.file?.path) {
    return parsed.file.path.startsWith("/") ? parsed.file.path : `/${parsed.file.path}`;
  }

  return value.startsWith("/") ? value : "/" + value;
};

export const FormikTapisFileInputWrapper = ({
  allowSystemChange = true,
  disabled,
  systemId,
  path,
  mode = "single",
  files = true,
  dirs = true,
  ...props
}: any) => {
  const { name } = props;
  const [field, , helpers] = useField(name);
  const { setValue } = helpers;
  const { value } = field;
  const { modal, open, close } = useModal();

  const onSelect = useCallback(
    (_selectedSystemId, selectedFiles) => {
      const selectedPath = selectedFiles?.[0]?.path;
      setValue(normalizeToPathOnly(selectedPath));
    },
    [setValue],
  );

  const { systemId: parsedSystemId, file, parent } = useMemo(() => {
    const result = parseTapisURI(value) ?? {
      systemId: systemId,
      file: value ? pathToFile(normalizeToPathOnly(value)) : pathToFile(path),
      parent: value ? pathParent(normalizeToPathOnly(value)) : pathParent(path),
    };
    return result;
  }, [value, systemId, path]);

  const selectMode = useMemo(() => {
    const types = [];
    if (files) {
      types.push("file");
    }
    if (dirs) {
      types.push("dir");
    }
    return {
      mode,
      types,
    };
  }, [mode, files, dirs]);

  const displayValue = normalizeToPathOnly(value);

  return (
    <>
      <InputGroup className="w-100" style={{ width: "100%" }}>
        <Button size="sm" onClick={open} disabled={disabled}>
          Browse
        </Button>
        <Input
          disabled={disabled}
          {...field}
          {...props}
          className="flex-grow-1"
          value={displayValue}
          bsSize="sm"
          onChange={(e) => setValue(normalizeToPathOnly(e.currentTarget.value))}
        />
      </InputGroup>
      {modal && (
        <FileSelectModalWrapper
          toggle={close}
          onSelect={onSelect}
          systemId={parsedSystemId ?? systemId}
          selectMode={selectMode}
          path={parent}
          initialSelection={file ? [file] : undefined}
          allowSystemChange={allowSystemChange}
        />
      )}
    </>
  );
};

const FormikTapisFileWrapper = ({
  name,
  label,
  required,
  description,
  systemId,
  path,
  mode,
  files,
  dirs,
  ...props
}: any) => {
  return (
    <div style={{
      width: "100%",
    }}
    className="formik-tapis-file-wrapper">
      <style>{`
        .formik-tapis-file-wrapper > * { width: 100% !important; }
        .formik-tapis-file-wrapper .form-group { width: 100% !important; }
        .formik-tapis-file-wrapper .input-group { width: 100% !important; display: flex !important; flex-wrap: nowrap !important; }
        .formik-tapis-file-wrapper .input-group input { flex: 1 1 auto; width: auto !important; min-width: 0; }
      `}</style>
      <FieldWrapper
        name={name}
        label={label}
        required={required}
        description={description}
        as={(formikProps: any) => (
          <FormikTapisFileInputWrapper
            {...props}
            {...formikProps}
            bsSize="sm"
            systemId={systemId}
            path={path}
            mode={mode}
            files={files}
            dirs={dirs}
          />
        )}
      />
    </div>
  );
};

export default React.memo(FormikTapisFileWrapper);
