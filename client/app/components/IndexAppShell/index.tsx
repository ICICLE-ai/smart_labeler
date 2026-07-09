import { AppShell, Burger, Group, NavLink, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Link, useLocation } from "@remix-run/react";
import React from "react";
import { useAppConfig } from "~/context/AppConfigContext";
import { getAppTitle } from "~/utils/utils";

const navItems = [
  { label: "Dashboard", to: "/dashboard" },
  { label: "Contact Us", to: "/contact-us" },
  { label: "Help", to: "/help" },
];

export const IndexAppShell: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [opened, { toggle }] = useDisclosure();
  const location = useLocation();
  const { annotatorType } = useAppConfig();
  const title = getAppTitle(annotatorType);

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 220, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <Text fw={700} size="lg">
            {title}
          </Text>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            label={item.label}
            component={Link}
            to={item.to}
            active={location.pathname === item.to}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
};
