# Database schema (Prisma)

`prisma/schema.prisma` is the **source of truth for table structure**. Sync it to Postgres with:

```bash
npm run db:generate   # prisma generate
npm run db:push       # prisma generate && prisma db push
```

Use **`DIRECT_URL`** (port 5432) for `db push`. Use **`DATABASE_URL`** (pooler, port 6543) at runtime on Vercel/serverless.

Auth and authorization live in the app (NextAuth + Prisma queries scoped by `accountId`), not in Postgres RLS.
