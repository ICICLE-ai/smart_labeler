// Import styles of packages that you've installed.
// All packages except `@mantine/hooks` require styles imports
import "@mantine/core/styles.css";
import "~/styles/global-overrides.css";
import {
  Links,
  Meta,
  MetaFunction,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";
import { ColorSchemeScript, MantineProvider } from "@mantine/core";
import { LinksFunction } from "@remix-run/node";
import { CookiesProvider } from "react-cookie";
import { TapisProvider } from "@tapis/tapisui-hooks";
import { initConfig } from "~/utils/utils";
import { AppConfigProvider, type RuntimeEnv } from "~/context/AppConfigContext";

export const meta: MetaFunction = () => {
  return [
    { title: "Smart Labeler" },
    { name: "Smart Labeler", content: "Welcome to Smart Labeler" },
  ];
};

export const links: LinksFunction = () => {
  return [{ rel: "icon", href: "/icicleIcon.png", type: "image/png" }];
};

export async function loader() {
  return {
    ENV: {
      apiBaseUrl:    process.env.API_BASE_URL    ?? "http://127.0.0.1:11112",
      sam3Endpoint:  process.env.SAM3_ENDPOINT   ?? "https://sam3-sailab.nrp-nautilus.io",
      tapisBaseUrl:  process.env.TAPIS_BASE_URL  ?? "https://icicleai.tapis.io",
      allowedSystems:  process.env.ALLOWED_SYSTEMS  ?? null,
      embedders:       process.env.EMBEDDERS        ?? null,
      proposers:       process.env.PROPOSERS        ?? null,
      annotatorType:   process.env.ANNOTATOR_TYPE   ?? "DETECTION",
    } satisfies RuntimeEnv,
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <ColorSchemeScript />
      </head>
      <body>
        <CookiesProvider defaultSetOptions={{ path: "/" }}>
          <MantineProvider>
            {children}
            <ScrollRestoration />
            <Scripts />
          </MantineProvider>
        </CookiesProvider>
      </body>
    </html>
  );
}

export default function App() {
  const { ENV } = useLoaderData<typeof loader>();

  // Initialize module-level config so all utility functions pick up runtime values.
  // Called synchronously during render so child components always see the correct URLs.
  initConfig(ENV);

  return (
    <AppConfigProvider value={ENV}>
      <TapisProvider basePath={ENV.tapisBaseUrl}>
        <Outlet />
      </TapisProvider>
    </AppConfigProvider>
  );
}
