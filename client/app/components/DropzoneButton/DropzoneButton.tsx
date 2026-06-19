import {
  useRef,
  useState,
  useCallback,
  useReducer,
  useEffect,
  useImperativeHandle,
  forwardRe,
} from "react";
import { Text, Group, Button, rem, useMantineTheme } from "@mantine/core";
import { Dropzone, MIME_TYPES } from "@mantine/dropzone";
import { IconCloudUpload, IconX, IconDownload } from "@tabler/icons-react";
import classes from "./DropzoneButton.module.css";
import { Formik } from "formik";
import FormikTapisFileWrapper from "~/components/FileExplorer/FormikTapisFileWrapper";
import { fetchAndReturnData, SubmitData, getC } from "~/utils/utils";
import { Systems } from "@tapis/tapis-typescript";
import { Systems as SystemsHooks } from "@tapis/tapisui-hooks";
import { SubmitWrapper } from "@tapis/tapisui-common";
import { FileListingTable } from "@tapis/tapisui-common";
import { Button, Group, Select, Loader, Notification } from "@mantine/core";
import {
  TextInput,
  Textarea,
  PasswordInput,
  Input,
  Checkbox,
  Switch,
  NumberInput,
  Slider,
  Select,
  RadioGroup,
  Chips,
  MultiSelect,
  SubmitButton,
} from "~/components/formik-mantine/index";
import { IconX, IconCheck } from "@tabler/icons-react";
import { FileListingTable } from "@tapis/tapisui-common";
import { Files as Hooks } from "@tapis/tapisui-hooks";
import {
  FileOpEventStatusEnum,
  useFileOperations,
} from "~/components/DropzoneButton/useFileOperations";
import { focusManager } from "react-query";

export function DropzoneButton({ prompt, upLoadPath }) {
  const theme = useMantineTheme();
  const openRef = useRef<() => void>(null);
  let [selected, setSelected] = useState(false);
  let [fileNames, setFileNames] = useState([]);
  let [files, setFiles] = useState([]);
  const [path, setPath] = useState("");
  const {
    data: systemsData,
    isLoading: systemsIsLoading,
    error: systemsError,
  } = SystemsHooks.useList({
    listType: Systems.ListTypeEnum.All,
    select: "allAttributes",
  });
  const [systemId, setSystemId] = useState("");
  function getSystems() {
    if (!systemsIsLoading) {
      return systemsData["result"].map((x) => x["id"]);
    }
    return [];
  }

  const reducer = (
    state: FileProgressState,
    action: { name: string; progress: number },
  ) => {
    const { name, progress } = action;
    return {
      ...state,
      [name]: progress,
    };
  };

  const [fileProgressState, dispatch] = useReducer(
    reducer,
    {} as FileProgressState,
  );

  const onProgress = (uploadProgress: number, file: File) => {
    dispatch({
      name: file.name,
      progress: uploadProgress,
    });
  };
  const { uploadAsync, reset } = Hooks.useUpload();

  const key = (params: Hooks.InsertHookParams) => params.file.name;
  const onComplete = useCallback(() => {
    setFiles([]);
    setFileNames([]);
    focusManager.setFocused(true);
  }, []);

  const { state, run, isLoading, isSuccess, error } = useFileOperations<
    Hooks.InsertHookParams,
    Files.FileStringResponse
  >({
    fn: uploadAsync,
    key,
    onComplete,
  });

  useEffect(() => {
    reset();
  }, [reset, path]);

  const onSubmit = useCallback(
    (values) => {
      event.preventDefault();
      console.log(values);
      setPath(values["datalo"]);
      console.log(path);
      const operations: Array<Hooks.InsertHookParams> = files.map((file) => ({
        systemId: systemId!,
        path: (values["datalo"]! + "/").replace("//", "/"),
        file,
        progressCallback: onProgress,
      }));
      run(operations);
    },
    [files, run, systemId, path],
  );

  function getFileNames() {
    if (fileNames.length > 15) {
      const leftOver = fileNames.length - 15;
      let nms = fileNames.slice(0, 14).join(", ");
      return `${nms} and ${leftOver.toString()} more `;
    } else {
      return fileNames.join(", ");
    }
  }
  const back = {
    height: "100%",
    width: "100%",
    zIndex: 25,
    position: "fixed",
    top: "0px",
    right: "0px",
    background: "#00000020",
  };
  const container = {
    width: "10%",
    height: "auto",
    margin: "0 auto",
    position: "relative",
  };
  const xIcon = <IconX size={20} />;
  const checkIcon = <IconCheck size={20} />;
  return (
    <div>
      <Formik
        enableReinitialize={true}
        initialValues={{
          datalo: "",
          trainsystem: "",
        }}
        onSubmit={(values, event) => {
          setPath(values["datalo"]);
          onSubmit(values, event);
        }}
      >
        <form>
          <Select
            mt="md"
            comboboxProps={{ withinPortal: true }}
            data={
              ["pitzer-tapis"]
              //   systemsIsLoading
              //     ? []
              //     : getSystems()
            }
            label="Training System"
            placeholder="Pick one Training System"
            defaultValue=""
            value={systemId}
            name="trainsystem"
            onChange={(value, option) => setSystemId(value)}
          />

          <FormikTapisFileWrapper
            name="datalo"
            label="Path to Upload Data to."
            required={false}
            description="Enter full path to  data destination"
            systemId={systemId}
            disabled={!systemId}
            files={false}
            dirs={true}
          />
          <div className={classes.wrapper}>
            <Dropzone
              openRef={openRef}
              onDrop={(newfiles) => {
                setFiles(newfiles);
                setFileNames(newfiles.map((file) => file.name));
                setSelected(true);
              }}
              className={classes.dropzone}
              radius="md"
              // accept={[MIME_TYPES.pdf]}
              // maxSize={30 * 1024 ** 2}
            >
              <div style={{ pointerEvents: "none" }}>
                <Group justify="center">
                  <Dropzone.Accept>
                    <IconDownload
                      style={{ width: rem(50), height: rem(50) }}
                      color={theme.colors.blue[6]}
                      stroke={1.5}
                    />
                  </Dropzone.Accept>
                  <Dropzone.Reject>
                    <IconX
                      style={{ width: rem(50), height: rem(50) }}
                      color={theme.colors.red[6]}
                      stroke={1.5}
                    />
                  </Dropzone.Reject>
                  <Dropzone.Idle>
                    <IconCloudUpload
                      style={{ width: rem(50), height: rem(50) }}
                      stroke={1.5}
                    />
                  </Dropzone.Idle>
                </Group>

                <Text ta="center" fw={700} fz="lg" mt="xl">
                  <Dropzone.Accept>Drop files here</Dropzone.Accept>
                  <Dropzone.Reject>
                    This file cannot be uploaded :(
                  </Dropzone.Reject>
                  <Dropzone.Idle>Upload File</Dropzone.Idle>
                </Text>
                <Text ta="center" fz="sm" mt="xs" c="dimmed">
                  {prompt}
                </Text>

                {selected && (
                  <Text ta="center" fz="sm" mt="xs" c="dimmed">
                    You have uploaded: {getFileNames()}
                  </Text>
                )}
              </div>
            </Dropzone>

            <Button
              className={classes.control}
              size="md"
              radius="xl"
              onClick={() => openRef.current?.()}
            >
              Select files
            </Button>
          </div>
          <Group justify="flex-end" mt="md">
            <SubmitButton type="submit">
              {" "}
              {isLoading ? "Sending..." : "Submit"}
            </SubmitButton>
          </Group>
        </form>
      </Formik>

      <div hidden={!isLoading} style={back}>
        <div hidden={!isLoading} style={container}>
          <Loader hidden={!isLoading} color="blue" size="xl" />
        </div>
      </div>
      <div hidden={!error}>
        <Notification
          icon={xIcon}
          withCloseButton={false}
          color="red"
          title="Bummer!"
        >
          Something went wrong
        </Notification>
      </div>
      <div hidden={!isSuccess}>
        <Notification
          icon={checkIcon}
          withCloseButton={false}
          color="teal"
          title="All good!"
          mt="md"
        >
          Everything is fine
        </Notification>
      </div>
    </div>
  );
}
