/**
 * Supabase + Prisma runtime connection helpers.
 *
 * Runtime: DATABASE_URL → Transaction pooler, port 6543
 * Prisma CLI (db push): DIRECT_URL → Direct connection, port 5432
 */
export function normalizeSupabaseDatabaseUrl(connectionString: string) {
  let url: URL;

  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL connection URL");
  }

  if (url.hostname.includes("pooler.supabase.com")) {
    if (!url.username.includes(".")) {
      throw new Error(
        "Supabase pooler DATABASE_URL must use username postgres.[project-ref], not postgres.",
      );
    }

    if (!url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }
  }

  return url.toString();
}

export function getRuntimeDatabaseUrl() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  return normalizeSupabaseDatabaseUrl(connectionString);
}

export function getPgPoolOptions(connectionString: string) {
  const isSupabase = connectionString.includes("supabase.com");

  return {
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? (process.env.VERCEL ? "1" : "10")),
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
  } satisfies import("pg").PoolConfig;
}
