import { Button, Stack } from "@mantine/core";
import { useNavigate } from "@remix-run/react";
import React from "react";
import { useCookies } from "react-cookie";
import { SubmitData, TYPE } from "~/utils/utils";

export const NewPipeline: React.FC<{ objectDetection: boolean }> = ({
  objectDetection,
}) => {
  const navigate = useNavigate();
  const [cookie] = useCookies(["tapis-token"]);
  const [loading, setLoading] = React.useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const data = {
        type : TYPE.DETECTION,
      }
      const res = await SubmitData(
        "/pipe/create",
        data,
        (cookie["tapis-token"] as any)?.access_token ?? ""
      );
      if (res?.id) {
        navigate(`/object-detection/image-annotator/${res.id}`);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack mt="md">
      <Button onClick={handleCreate} loading={loading}>
        Create New{" "}
        {objectDetection ? "Object Detection" : "Classification"} Pipeline
      </Button>
    </Stack>
  );
};
