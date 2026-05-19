import { PassThrough } from "node:stream";

import type { AppLoadContext, EntryContext } from "@remix-run/node";
import { createReadableStreamFromReadable } from "@remix-run/node";
import { RemixServer } from "@remix-run/react";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { CacheProvider } from "@emotion/react";
import createEmotionCache from "./emotionCache";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const createEmotionServer = (require("@emotion/server/create-instance") as {
  default: (cache: ReturnType<typeof createEmotionCache>) => {
    extractCriticalToChunks: (html: string) => { html: string; styles: Array<{ key: string; ids: string[]; css: string }> };
    constructStyleTagsFromChunks: (criticalData: { html: string; styles: Array<{ key: string; ids: string[]; css: string }> }) => string;
  };
}).default;

const ABORT_DELAY = 5_000;

function isBotRequest(userAgent: string | null) {
  if (!userAgent) return false;
  return isbot(userAgent);
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  _loadContext: AppLoadContext
) {
  const prohibitOutOfOrderStreaming =
    isBotRequest(request.headers.get("user-agent")) || remixContext.isSpaMode;

  return prohibitOutOfOrderStreaming
    ? handleBotRequest(request, responseStatusCode, responseHeaders, remixContext)
    : handleBrowserRequest(request, responseStatusCode, responseHeaders, remixContext);
}

function renderAndInjectEmotionStyles(
  ui: React.ReactElement,
  responseStatusCode: number,
  responseHeaders: Headers,
  waitForAll: boolean
): Promise<Response> {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const emotionCache = createEmotionCache();
    const emotionServer = createEmotionServer(emotionCache);

    const onReady = (pipe: (stream: PassThrough) => void) => {
      shellRendered = true;
      const chunks: Buffer[] = [];
      const collector = new PassThrough();
      collector.on("data", (chunk: Buffer) => chunks.push(chunk));
      collector.on("end", () => {
        const html = Buffer.concat(chunks).toString();
        const emotionChunks = emotionServer.extractCriticalToChunks(html);
        const emotionStyles = emotionServer.constructStyleTagsFromChunks(emotionChunks);
        const styledHtml = html.replace(/<\/head>/, `${emotionStyles}</head>`);
        responseHeaders.set("Content-Type", "text/html");
        resolve(
          new Response(styledHtml, {
            headers: responseHeaders,
            status: responseStatusCode,
          })
        );
      });
      pipe(collector);
    };

    const { pipe, abort } = renderToPipeableStream(
      <CacheProvider value={emotionCache}>{ui}</CacheProvider>,
      {
        ...(waitForAll
          ? { onAllReady: () => onReady(pipe) }
          : { onShellReady: () => onReady(pipe) }),
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}

function handleBotRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  return renderAndInjectEmotionStyles(
    <RemixServer context={remixContext} url={request.url} abortDelay={ABORT_DELAY} />,
    responseStatusCode,
    responseHeaders,
    true
  );
}

function handleBrowserRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  return renderAndInjectEmotionStyles(
    <RemixServer context={remixContext} url={request.url} abortDelay={ABORT_DELAY} />,
    responseStatusCode,
    responseHeaders,
    false
  );
}
