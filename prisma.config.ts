import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Set DIRECT_URL (direct Postgres connection) or DATABASE_URL in .env. See .env.local.example.",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Prefer DIRECT_URL for db push; fall back to DATABASE_URL
    url: databaseUrl,
  },
});
