export class ClientError extends Error {
  constructor(
    message: string,
    public code?: string,
    public requestId?: string,
    public status?: number,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  intent: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch("/app/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent, ...input }),
  });
  return parseResponse<T>(response);
}
export async function publishWhenReady(
  draftId: string,
  version: number | undefined,
  onWaiting: (attempt: number) => void,
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await api("publish", attempt === 1 ? { draftId, version } : { draftId });
    } catch (e) {
      if (!(e instanceof ClientError) || e.code !== "SHOPIFY_MEDIA_PROCESSING" || attempt >= 6)
        throw e;
      onWaiting(attempt);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
export async function parseResponse<T = any>(response: Response): Promise<T> {
  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new ClientError(
      "The session or connection expired. Reopen the app from Shopify Admin.",
    );
  }
  if (!response.ok)
    throw new ClientError(
      body.error || "The operation failed.",
      body.code,
      body.requestId,
      response.status,
    );
  return body as T;
}
export function errorText(error: unknown) {
  return error instanceof ClientError
    ? `${error.message}${error.requestId ? ` · Request ID: ${error.requestId}` : ""}`
    : error instanceof Error
      ? error.message
      : "The operation failed.";
}
