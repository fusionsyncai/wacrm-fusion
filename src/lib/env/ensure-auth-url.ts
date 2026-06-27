/**
 * NextAuth middleware calls `new URL(process.env.AUTH_URL)` with no normalization.
 * A value like `myapp.vercel.app` (no protocol) or `"https://..."` (quotes) throws
 * `TypeError: Invalid URL` on every authenticated request.
 */
export function normalizeAuthUrl(
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;

  let url = raw.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  if (!url) return undefined;

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  try {
    new URL(url);
    return url;
  } catch {
    return undefined;
  }
}

/** Normalize AUTH_URL once at module load so NextAuth middleware can parse it. */
export function ensureAuthUrlEnv(): void {
  const raw = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  const normalized = normalizeAuthUrl(raw);

  if (normalized) {
    process.env.AUTH_URL = normalized;
    if (process.env.NEXTAUTH_URL) {
      process.env.NEXTAUTH_URL = normalized;
    }
    return;
  }

  if (raw) {
    console.warn(
      "[auth] AUTH_URL is invalid and will be ignored:",
      raw,
    );
    delete process.env.AUTH_URL;
    delete process.env.NEXTAUTH_URL;
  }

  const fromVercel = normalizeAuthUrl(
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  );
  if (fromVercel) {
    process.env.AUTH_URL = fromVercel;
  }
}
