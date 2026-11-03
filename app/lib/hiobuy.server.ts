import { AppError } from "./errors";
export const HIOBUY_ORIGIN = "https://api.hiobuy.com";
const paths = {
  search: "/v1/products/search",
  detail: "/v1/products/detail",
  upload: "/v1/products/upload-image",
  imageSearch: "/v1/products/search-by-image",
} as const;
export class HiobuyClient {
  constructor(
    private readonly apiKey: string,
    private readonly transport: typeof fetch = fetch,
  ) {}
  private async post(
    operation: keyof typeof paths,
    input: Record<string, unknown>,
  ) {
    let response: Response;
    try {
      response = await this.transport(HIOBUY_ORIGIN + paths[operation], {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          channel: "1688",
          response_format: "standard",
          ...input,
        }),
        signal: AbortSignal.timeout(45000),
        redirect: "error",
      });
    } catch {
      throw new AppError(
        "HIOBuy did not respond. Check the connection and retry. A request may still have used API quota.",
        502,
        "HIOBUY_NETWORK_ERROR",
      );
    }
    let body: any;
    try {
      body = await response.json();
    } catch {
      throw new AppError(
        "HIOBuy returned an unreadable response.",
        502,
        "HIOBUY_INVALID_RESPONSE",
        response.headers.get("x-request-id") || undefined,
      );
    }
    const requestId =
      String(
        body.request_id || response.headers.get("x-request-id") || "",
      ).slice(0, 150) || undefined;
    if (!response.ok || body.error) {
      const code = String(body.error?.code || `HTTP_${response.status}`)
        .replace(/[^A-Z0-9_]/g, "")
        .slice(0, 80);
      const message: Record<string, string> = {
        INVALID_API_KEY: "HIOBuy rejected the API key. Replace it in Settings.",
        CHANNEL_NOT_AUTHORIZED:
          "Authorize the 1688 channel in your HIOBuy developer portal.",
        INSUFFICIENT_SCOPE:
          "This API key or subscription does not permit this operation.",
        QUOTA_EXCEEDED:
          "Your HIOBuy API quota is exhausted. Check the developer portal.",
        RATE_LIMITED:
          "HIOBuy is rate limiting requests. Wait before trying again.",
        PRODUCT_UNAVAILABLE: "This 1688 product is unavailable.",
        NOT_FOUND: "The product was not found.",
      };
      throw new AppError(
        message[code] ||
          `HIOBuy could not complete this request (${code}). Check your subscription, permissions and request ID.`,
        response.status >= 400 && response.status < 500 ? response.status : 502,
        code,
        requestId,
      );
    }
    return { body, requestId };
  }
  async search(keyword: string, page = 1, sort = "") {
    return this.post("search", {
      keyword,
      page,
      page_size: 20,
      language: "en",
      ...(sort ? { sort } : {}),
    });
  }
  async detail(id: string) {
    return this.post("detail", { id, language: "en" });
  }
  async uploadImage(bytes: Buffer) {
    const result = await this.post("upload", {
      image_base64: bytes.toString("base64"),
    });
    if (typeof result.body.image_id !== "string")
      throw new AppError("HIOBuy did not return an image ID.", 502);
    return result.body.image_id as string;
  }
  async imageSearch(imageId: string, page = 1, sort = "") {
    return this.post("imageSearch", {
      image_id: imageId,
      page,
      page_size: 20,
      language: "en",
      ...(sort ? { sort } : {}),
    });
  }
}
