import { AppError } from "../errors";
import { HIOBUY_ORIGIN } from "../hiobuy.server";

const paths = {
  account: "/v1/ai/account",
  credits: "/v1/ai/credits",
  pricing: "/v1/ai/credits/pricing",
  estimate: "/v1/ai/credits/estimate",
  translate: "/v1/ai/text/translate",
  imageJob: "/v1/ai/image/jobs",
  job: "/v1/ai/jobs/",
} as const;

export class HiobuyAiCallError extends AppError {
  constructor(
    message: string,
    status: number,
    code: string,
    requestId?: string,
    readonly remoteJobId?: string,
    readonly retryAfterMs?: number,
    readonly accepted?: boolean,
  ) {
    super(message, status, code, requestId);
  }
}

export interface AiCreditBalance {
  requestId?: string;
  shop: string;
  creditsBalance: number;
}

export interface AiAccount {
  requestId?: string;
  shop: string;
  workspaceId: string;
  status: string;
  creditsBalance: number;
}

export interface AiPriceRule {
  feature: string;
  credits: number;
  enabled: boolean;
}

export interface AiEstimate {
  requestId?: string;
  feature: string;
  creditsRequired: number;
  creditsBalance: number;
  canAfford: boolean;
}

type Method = "GET" | "POST";

export class HiobuyAiClient {
  constructor(
    private readonly apiKey: string,
    private readonly shopDomain: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  assetHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "image/webp, image/png, image/jpeg",
      ...(this.shopDomain ? { "X-Shop-Domain": this.shopDomain } : {}),
    };
  }

  account() {
    return this.request<AiAccount>("GET", paths.account, undefined, {
      shop: false,
      map: (body, requestId) => {
        const shop = String(body.shop || "").trim();
        if (!shop || shop.length > 253)
          throw new HiobuyAiCallError(
            "HIOBuy returned an incomplete AI account.",
            502,
            "HIOBUY_INVALID_RESPONSE",
            requestId,
          );
        return {
          requestId,
          shop,
          workspaceId: String(body.workspace_id || ""),
          status: String(body.status || ""),
          creditsBalance: numberField(body.credits_balance, "credits_balance"),
        };
      },
    });
  }

  credits() {
    return this.request<AiCreditBalance>("GET", paths.credits, undefined, {
      shop: true,
      map: (body, requestId) => ({
        requestId,
        shop: String(body.shop || ""),
        creditsBalance: numberField(body.credits_balance, "credits_balance"),
      }),
    });
  }

  pricing() {
    return this.request<{ requestId?: string; rules: AiPriceRule[] }>(
      "GET",
      paths.pricing,
      undefined,
      {
        shop: false,
        map: (body, requestId) => ({
          requestId,
          rules: Array.isArray(body.rules)
            ? body.rules.map(
                (rule: {
                  feature?: unknown;
                  credits?: unknown;
                  enabled?: unknown;
                }) => ({
                  feature: String(rule?.feature || ""),
                  credits: numberField(rule?.credits, "credits"),
                  enabled: rule?.enabled === true,
                }),
              )
            : [],
        }),
      },
    );
  }

  estimate(input: Record<string, unknown>) {
    return this.request<AiEstimate>("POST", paths.estimate, input, {
      shop: true,
      map: (body, requestId) => ({
        requestId,
        feature: String(body.feature || ""),
        creditsRequired: numberField(body.credits_required, "credits_required"),
        creditsBalance: numberField(body.credits_balance, "credits_balance"),
        canAfford: body.can_afford === true,
      }),
    });
  }

  translate(input: Record<string, unknown>, idempotencyKey: string) {
    return this.request<Record<string, unknown>>(
      "POST",
      paths.translate,
      input,
      { shop: true, idempotencyKey, map: (body) => body },
    );
  }

  createImageJob(input: Record<string, unknown>, idempotencyKey: string) {
    return this.request<Record<string, unknown>>(
      "POST",
      paths.imageJob,
      input,
      { shop: true, idempotencyKey, map: (body) => body },
    );
  }

  getJob(jobId: string) {
    return this.request<Record<string, unknown>>(
      "GET",
      paths.job + encodeURIComponent(jobId),
      undefined,
      { shop: true, map: (body) => body },
    );
  }

  private async request<T>(
    method: Method,
    path: string,
    input: Record<string, unknown> | undefined,
    options: {
      shop: boolean;
      idempotencyKey?: string;
      map: (body: any, requestId?: string) => T;
    },
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.transport(HIOBUY_ORIGIN + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(input ? { "Content-Type": "application/json" } : {}),
          ...(options.shop ? { "X-Shop-Domain": this.shopDomain } : {}),
          ...(options.idempotencyKey
            ? { "X-Idempotency-Key": options.idempotencyKey }
            : {}),
        },
        body: input ? JSON.stringify(input) : undefined,
        signal: AbortSignal.timeout(45000),
        redirect: "error",
      });
    } catch {
      throw new HiobuyAiCallError(
        "HIOBuy did not respond. Retry this same AI task. A new task is not started automatically.",
        502,
        "HIOBUY_NETWORK_ERROR",
      );
    }
    let body: any;
    try {
      body = await response.json();
    } catch {
      throw new HiobuyAiCallError(
        "HIOBuy returned an unreadable AI response.",
        502,
        "HIOBUY_INVALID_RESPONSE",
        response.headers.get("x-request-id") || undefined,
      );
    }
    const requestId =
      String(
        body.request_id ||
          body.error?.request_id ||
          response.headers.get("x-request-id") ||
          "",
      ).slice(0, 150) || undefined;
    if (!response.ok || body.error) {
      throw aiError(response, body, requestId);
    }
    try {
      return options.map(body, requestId);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new HiobuyAiCallError(
        "HIOBuy returned an incomplete AI response.",
        502,
        "HIOBUY_INVALID_RESPONSE",
        requestId,
      );
    }
  }
}

function numberField(value: unknown, field: string) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number))
    throw new HiobuyAiCallError(
      "HIOBuy returned an incomplete AI response.",
      502,
      "HIOBUY_INVALID_RESPONSE",
    );
  void field;
  return number;
}

function aiError(response: Response, body: any, requestId?: string) {
  const code = String(body.error?.code || `HTTP_${response.status}`)
    .replace(/[^A-Z0-9_]/g, "")
    .slice(0, 80);
  const details = body.error?.details;
  const remoteJobId = remoteJob(details, body);
  const retryAfterMs = retryDelay(response, details, body.error);
  const accepted = details?.accepted;
  const message: Record<string, string> = {
    INVALID_API_KEY:
      "HIOBuy rejected the API key. Check that it is correct, active and not expired.",
    INSUFFICIENT_SCOPE:
      "This API key is missing the product:translate permission. Check the API key permissions of this app in HIOBuy Developer Center.",
    AI_ACCESS_DISABLED:
      "AI access is not available for this HIOBuy app. Contact your administrator or HIOBuy support.",
    AI_ACCOUNT_NOT_FOUND:
      "No prepaid AI account exists yet. In HIOBuy Developer Center → AI Enhancement, create the account for the app that owns this API key, then try again.",
    AI_TEST_KEY_NOT_ALLOWED:
      "Live Commerce AI needs a production key (hio_live_…). Test keys cannot run AI tools.",
    AI_ACCOUNT_INACTIVE:
      "This HIOBuy AI account is not active. Contact HIOBuy support and include the request ID.",
    AI_ACCOUNT_AMBIGUOUS:
      "HIOBuy found more than one AI account for this app. Contact HIOBuy support and include the request ID.",
    AI_FEATURE_DISABLED: "This Commerce AI feature is disabled for the app.",
    AI_FEATURE_NOT_PUBLIC:
      "This operation is not part of public Commerce AI V1.",
    IMAGE_HOST_NOT_ALLOWED:
      "HIOBuy rejected the image host. Use an approved HTTPS image. A URL that opens in the browser can still be refused, and local uploads are not accepted.",
    UNSAFE_IMAGE_URL:
      "HIOBuy rejected this image URL. Choose an approved HTTPS product image.",
    AI_REQUEST_IN_PROGRESS:
      "This AI task is still processing. It will be checked again without starting another charge.",
    AI_RECONCILIATION_REQUIRED:
      "HIOBuy is reconciling this AI task. It stays open so another paid task is not created.",
    AI_MAINTENANCE:
      "Commerce AI did not accept a new task. Retry the same task later.",
    AI_ADMISSION_UNAVAILABLE:
      "Commerce AI did not accept a new task. Retry the same task later.",
    RATE_LIMITED: waitMessage(retryAfterMs),
    HTTP_429: waitMessage(retryAfterMs),
  };
  const status =
    response.status >= 400 && response.status < 500 ? response.status : 502;
  const fallback =
    response.status === 401
      ? "HIOBuy rejected the API key. Check that it is correct, active and not expired."
      : response.status === 402
        ? "There are not enough AI Credits for this task. Check the balance and top up in the HIOBuy developer center. Product API quota is separate."
        : response.status === 429
          ? waitMessage(retryAfterMs)
          : response.status === 503
            ? "Commerce AI did not accept a new task. Retry the same task later."
            : `HIOBuy could not complete this AI request (${code}). Check AI access in HIOBuy Developer Center and the request ID.`;
  return new HiobuyAiCallError(
    message[code] || fallback,
    status,
    code || `HTTP_${response.status}`,
    requestId,
    remoteJobId,
    retryAfterMs,
    typeof accepted === "boolean" ? accepted : undefined,
  );
}

function remoteJob(details: any, body: any) {
  const value =
    details?.job_id || details?.existing_resource?.id || body?.job?.id;
  return typeof value === "string" && value.length > 0 && value.length <= 200
    ? value
    : undefined;
}

function retryDelay(response: Response, details: any, error: any) {
  const header = Number(response.headers.get("retry-after"));
  const seconds = Number(
    details?.retry_after_seconds ?? error?.retry_after_seconds,
  );
  const ms = Number(details?.retry_after_ms);
  const candidates = [
    Number.isFinite(header) ? header * 1000 : 0,
    Number.isFinite(seconds) ? seconds * 1000 : 0,
    Number.isFinite(ms) ? ms : 0,
  ].filter((value) => value > 0 && value < 24 * 60 * 60 * 1000);
  return candidates.length ? Math.max(...candidates) : undefined;
}

function waitMessage(retryAfterMs?: number) {
  const seconds = retryAfterMs ? Math.ceil(retryAfterMs / 1000) : undefined;
  return seconds
    ? `HIOBuy is rate limiting AI requests. Wait ${seconds} seconds before retrying this same task.`
    : "HIOBuy is rate limiting AI requests. Wait before retrying this same task.";
}
