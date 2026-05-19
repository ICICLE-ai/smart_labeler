import { Container, Group, Burger, Menu, Modal, TextInput, Button, Stack, Text, Alert, ActionIcon } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import classes from "./HeaderSimple.module.css";
import { NavLink } from "@remix-run/react";
import classNames from "classnames";
import icicleIcon from "../../assets/icicleIcon.jpg";
import { IconDotsVertical, IconKey, IconCheck, IconAlertCircle } from "@tabler/icons-react";
import { useState } from "react";
import { useCookies } from "react-cookie";
import { getBaseURL } from "~/utils/utils";

const links = [
  { link: "/", label: "Home" },
  { link: "/dashboard", label: "Dashboard" },
  { link: "/help", label: "Help" },
  { link: "/contact-us", label: "Contact Us" },
];

function AccessKeyModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [cookie] = useCookies(["tapis-token"]);

  const handleClose = () => {
    setToken("");
    setStatus(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!token.trim()) return;
    setLoading(true);
    setStatus(null);
    try {
      // TODO: replace with actual Tapis key-vault endpoint when provided
      const res = await fetch(`${getBaseURL()}/api/vault/secret/hftoken`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Tapis-Token": cookie["tapis-token"]?.["access_token"] ?? "",
        },
        body: JSON.stringify({ data: { "HF_TOKEN": token.trim() } }),
      });
      if (res.ok) {
        setStatus({ type: "success", message: "Hugging Face token saved to Tapis key vault successfully." });
        setToken("");
      } else {
        const err = await res.json().catch(() => ({}));
        setStatus({ type: "error", message: err?.message ?? `Request failed with status ${res.status}.` });
      }
    } catch (e: any) {
      setStatus({ type: "error", message: e?.message ?? "Network error. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`${getBaseURL()}/api/vault/secret/hftoken`, {
        method: "DELETE",
        headers: {
          "Tapis-Token": cookie["tapis-token"]?.["access_token"] ?? "",
        },
      });
      if (res.ok) {
        setStatus({ type: "success", message: "Hugging Face token revoked successfully." });
        setToken("");
      } else {
        const err = await res.json().catch(() => ({}));
        setStatus({ type: "error", message: err?.message ?? `Request failed with status ${res.status}.` });
      }
    } catch (e: any) {
      setStatus({ type: "error", message: e?.message ?? "Network error. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap="xs">
          <IconKey size={18} />
          <Text fw={700}>Access Key — Hugging Face</Text>
        </Group>
      }
      size="sm"
      radius="md"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Enter your Hugging Face access token. It will be stored securely in the Tapis key vault and used for model downloads.
        </Text>

        <TextInput
          label="Hugging Face Token"
          placeholder="hf_xxxxxxxxxxxxxxxxxxxx"
          value={token}
          onChange={(e) => setToken(e.currentTarget.value)}
          type="password"
          leftSection={<IconKey size={15} />}
          disabled={loading}
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
        />

        {status && (
          <Alert
            icon={status.type === "success" ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}
            color={status.type === "success" ? "green" : "red"}
            radius="md"
            variant="light"
          >
            {status.message}
          </Alert>
        )}

        <Group justify="space-between" gap="xs" mt="sm">
          <Button variant="subtle" color="red" onClick={handleRevoke} disabled={loading}>
            Revoke Token
          </Button>
          <Group gap="xs">
            <Button variant="default" onClick={handleClose} disabled={loading}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              loading={loading}
              disabled={!token.trim()}
              leftSection={<IconKey size={15} />}
            >
              Add Token
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

export function HeaderSimple({
  useBG,
  opened,
  toggle,
}: {
  useBG: boolean;
  opened: boolean;
  toggle: () => void;
}) {
  const [keyModalOpened, { open: openKeyModal, close: closeKeyModal }] = useDisclosure(false);

  const items = links.map((link) => (
    <NavLink
      to={link.link}
      key={link.label}
      className={({ isActive }) =>
        classNames(classes.link, { [classes.active]: isActive })
      }
    >
      {link.label}
    </NavLink>
  ));

  let BG;
  if (useBG) {
    BG = <Burger opened={opened} onClick={toggle} size="sm" />;
  } else {
    BG = <></>;
  }

  return (
    <>
      <header className={classes.header}>
        <Container size="md" className={classes.inner}>
          <Group gap={5}>
            <img src={icicleIcon} alt="icicle" style={{ height: "50px" }} />
            <h1 className={classes.link}>Smart Labeler</h1>
          </Group>

          <Group gap={5} visibleFrom="xs">
            {items}

            <Menu shadow="md" width={200} position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" radius="md" aria-label="More options">
                  <IconDotsVertical size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Settings</Menu.Label>
                <Menu.Item
                  leftSection={<IconKey size={15} />}
                  onClick={openKeyModal}
                >
                  Access Key (Hugging Face)
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>

          {BG}
        </Container>
      </header>

      <AccessKeyModal opened={keyModalOpened} onClose={closeKeyModal} />
    </>
  );
}
