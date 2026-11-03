// Authentication/SSR structure follows Shopify's MIT React Router template.
import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
export const streamTimeout = 5000;
export default function handleRequest(
  request: Request,
  status: number,
  headers: Headers,
  context: EntryContext,
) {
  addDocumentResponseHeaders(request, headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Cache-Control", "no-store");
  return new Promise<Response>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={context} url={request.url} />,
      {
        [isbot(request.headers.get("user-agent") || "")
          ? "onAllReady"
          : "onShellReady"]: () => {
          const body = new PassThrough();
          body.on("close", () => clearTimeout(timer));
          headers.set("Content-Type", "text/html");
          resolve(
            new Response(createReadableStreamFromReadable(body), {
              status,
              headers,
            }),
          );
          pipe(body);
        },
        onShellError: reject,
        onError: () => {
          status = 500;
          console.error("SSR rendering failed.");
        },
      },
    );
    timer = setTimeout(abort, streamTimeout + 1000);
  });
}
