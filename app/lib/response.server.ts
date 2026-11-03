/** App-owned resources and mutation results must not be cached by a browser or proxy. */
export function privateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(body, { ...init, headers });
}
