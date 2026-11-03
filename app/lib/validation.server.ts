import sanitizeHtml from "sanitize-html";
import { AppError } from "./errors";
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // Base64 fits the documented 6 MB HIOBuy request ceiling.
export function parse1688Url(input: string): { id: string; url: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AppError(
      "Enter a full https://detail.1688.com/offer/…html product URL.",
    );
  }
  const match = /^\/offer\/(\d{6,25})\.html$/.exec(url.pathname);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "detail.1688.com" ||
    url.port ||
    url.username ||
    url.password ||
    !match
  )
    throw new AppError(
      "Only HTTPS 1688 product listing URLs on detail.1688.com are supported.",
    );
  return {
    id: match[1],
    url: `https://detail.1688.com/offer/${match[1]}.html`,
  };
}
export function safeImageUrl(value: string): string {
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    const allowed = [
      "alicdn.com",
      "1688.com",
      "shopify.com",
      "shopifycdn.com",
      "hiobuy.com",
    ];
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      allowed.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
    )
      return url.href;
  } catch {
    /* Invalid marketplace media is omitted and reported in the editor. */
  }
  return "";
}
export function sanitizeDescription(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "h2",
      "h3",
      "h4",
      "ul",
      "ol",
      "li",
      "blockquote",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
      "img",
      "hr",
      "span",
      "div",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "width", "height", "referrerpolicy"],
    },
    allowedSchemes: ["https"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attr) => ({
        tagName: "a",
        attribs: { ...attr, target: "_blank", rel: "noopener noreferrer" },
      }),
      img: (_tag, attr) => ({
        tagName: "img",
        attribs: { ...attr, referrerpolicy: "no-referrer" },
      }),
    },
    exclusiveFilter: (frame) =>
      frame.tag === "img" && !safeImageUrl(frame.attribs.src || ""),
  });
}
export async function validateImage(
  file: File,
): Promise<{ bytes: Buffer; mime: string; filename: string }> {
  if (!file.size || file.size > MAX_IMAGE_BYTES)
    throw new AppError("Choose a PNG, JPEG or WebP image up to 4 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
  const mime = png
    ? "image/png"
    : jpeg
      ? "image/jpeg"
      : webp
        ? "image/webp"
        : "";
  if (!mime || mime !== file.type)
    throw new AppError("The image content does not match PNG, JPEG or WebP.");
  return {
    bytes,
    mime,
    filename: `upload.${png ? "png" : jpeg ? "jpg" : "webp"}`,
  };
}
export function assertMutation(request: Request) {
  if (request.method !== "POST")
    throw new AppError("Use POST for this operation.", 405);
  const origin = request.headers.get("Origin");
  const configured =
    process.env.SHOPIFY_APP_URL || process.env.APP_URL || process.env.HOST;
  const expected = new URL(
    configured
      ? /^https?:\/\//i.test(configured)
        ? configured
        : `https://${configured}`
      : request.url,
  ).origin;
  if (!origin || origin !== expected)
    throw new AppError(
      "The request origin is not allowed.",
      403,
      "INVALID_ORIGIN",
    );
}
export async function boundedRequest(
  request: Request,
  limit: number,
): Promise<Request> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > limit) throw new AppError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("Missing request body.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new AppError("Request is too large.", 413);
    }
    chunks.push(value);
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: Buffer.concat(chunks),
  });
}
export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("Expected JSON.", 415);
  try {
    return await (await boundedRequest(request, 1024 * 1024)).json();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Invalid JSON body.");
  }
}
