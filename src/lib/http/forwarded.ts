/**
 * Normalize proxy headers. Chained proxies (recallsync → ngrok → app) often
 * send comma-separated values like `x-forwarded-proto: https, https`.
 * Always take the left-most (client-facing) value.
 */
export function firstHeaderValue(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  const first = value.split(",")[0]?.trim();
  return first || undefined;
}

/** Best-effort public origin from forwarded/host headers. */
export function requestOrigin(request: Request): string | undefined {
  const host =
    firstHeaderValue(request.headers.get("x-forwarded-host")) ??
    firstHeaderValue(request.headers.get("host"));
  if (!host) return undefined;

  const proto = firstHeaderValue(request.headers.get("x-forwarded-proto")) ?? "https";
  return `${proto}://${host}`;
}

/**
 * Parse a Request URL safely behind misconfigured reverse proxies.
 * Falls back to AUTH_URL / forwarded headers when `request.url` is malformed.
 */
export function safeRequestUrl(request: Request): URL {
  try {
    return new URL(request.url);
  } catch {
    const configured = process.env.AUTH_URL?.trim().replace(/\/+$/, "");
    const origin = configured ?? requestOrigin(request) ?? "http://localhost:3000";

    const apiPath = request.url.match(/(\/api\/[^\s]*)/)?.[1];
    const pathAndQuery = apiPath ?? "/";

    return new URL(pathAndQuery, origin);
  }
}
