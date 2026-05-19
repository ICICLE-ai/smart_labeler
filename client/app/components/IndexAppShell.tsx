import {
  AppShell,
  Container,
} from "@mantine/core";

import { HeaderSimple } from "./HeaderSimple/HeaderSimple";

export function IndexAppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      header={{ height: 55 }}
      withBorder={false}
    >
      <AppShell.Header zIndex={1}>
        <HeaderSimple useBG={false} opened={true} toggle={() => {}} />
      </AppShell.Header>

      <AppShell.Main>
        <Container size="l">{children}</Container>
      </AppShell.Main>
    </AppShell>
  );
}
