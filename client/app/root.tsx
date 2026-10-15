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
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "@remix-run/react";
import { ColorSchemeScript, MantineProvider } from "@mantine/core";
import { LinksFunction } from "@remix-run/node";
import { CookiesProvider } from "react-cookie";
import { TapisProvider } from "@tapis/tapisui-hooks";
import { getAppTitle, initConfig, isEmbedded } from "~/utils/utils";
import { AppConfigProvider, type RuntimeEnv } from "~/context/AppConfigContext";

export const meta: MetaFunction = ({ data }) => {
  const title = getAppTitle((data as any)?.ENV?.annotatorType);
  return [
    { title },
    { name: title, content: `Welcome to ${title}` },
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
      sam3VideoUrl:  process.env.SAM3_VIDEO_URL  ?? "http://127.0.0.1:2129",
      // "gateway" only when SAM3_VIDEO_URL points at the auth gateway.
      sam3VideoAuth: process.env.SAM3_VIDEO_AUTH ?? "none",
      tapisBaseUrl:  process.env.TAPIS_BASE_URL  ?? "https://icicleai.tapis.io",
      allowedSystems:  process.env.ALLOWED_SYSTEMS  ?? null,
      embedders:       process.env.EMBEDDERS        ?? null,
      proposers:       process.env.PROPOSERS        ?? null,
      annotatorType:   process.env.ANNOTATOR_TYPE   ?? "DETECTION",
      docUrl: process.env.DOC_URL ?? "https://buckeyemailosu-my.sharepoint.com/:w:/g/personal/jajodia_6_buckeyemail_osu_edu/IQDKR27YD4HXTo2eFkEU5umiAToGmQAUjXW03u7YsBRhjKE?e=NAXqEx",
      demoVideoUrl:  process.env.DEMO_VIDEO_URL ?? "https://www.youtube.com/watch?v=8_My9auZnds",
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

/**
 * Shows what went wrong instead of a blank page.
 *
 * Without this, any uncaught render or hydration error leaves an empty
 * document — which is impossible to diagnose when the app is embedded in
 * another site, because the host page hides the console from the person
 * reporting it. Embedding is called out specifically: a cross-site iframe
 * blocks the Tapis session cookie this app reads, and that failure otherwise
 * looks identical to "the page is broken".
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const embedded = isEmbedded();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Unknown error";
  const stack = error instanceof Error ? error.stack : undefined;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Something went wrong</h1>
      <p style={{ margin: "0 0 16px", color: "#555" }}>{message}</p>

      {embedded && (
        <div
          style={{
            border: "1px solid #f0ad4e", background: "#fff8e6",
            borderRadius: 8, padding: 12, margin: "0 0 16px", maxWidth: 680,
          }}
        >
          <strong>This page is running inside another site.</strong>
          <p style={{ margin: "8px 0 0" }}>
            Browsers block cookies and storage for embedded pages by default, and this app reads
            its Tapis session from a cookie — so sign-in can fail here even when it works in a
            normal tab. Try opening it in its own tab to confirm.
          </p>
        </div>
      )}

      {stack && (
        <details>
          <summary style={{ cursor: "pointer" }}>Technical details</summary>
          <pre style={{ fontSize: 12, overflow: "auto", background: "#f6f6f6", padding: 12, borderRadius: 6 }}>
            {stack}
          </pre>
        </details>
      )}
    </div>
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
