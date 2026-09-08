# DifferenceAI

DifferenceAI is a smartphone comparison app built with Next.js, Prisma, and PostgreSQL, deployed on Vercel. It hosts a self-owned catalog of thousands of devices with normalized specifications, and pairs it with an AI assistant that answers natural-language questions about the phones you're comparing.

> **Note on data:** this repository contains the application code and a small sample dataset for local development. The full production phone catalog is a maintained product asset and is not included here - see [Working With Phone Data](#working-with-phone-data).

## Features

- Search a Postgres-backed catalog of thousands of smartphone specification records
- Filter results by brand and release year
- Compare up to four phones side by side, with normalized spec-by-spec breakdowns
- View detailed per-device spec pages
- Ask an AI assistant contextual questions about the phones you're comparing (OpenAI, Hugging Face, or a local model)
- Rate-limited, timeout-protected, and input-validated AI endpoint to guard against abuse
- CLI tooling for importing, backfilling, and migrating phone data (see [Working With Phone Data](#working-with-phone-data))

## Tech Stack

- Next.js 14
- React 18
- TypeScript
- Prisma
- PostgreSQL
- Tailwind CSS tooling

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

`npm install` also runs `prisma generate` automatically via the `postinstall` script.

### 2. Set Up a Local PostgreSQL Database

Any local Postgres works (Postgres.app, Homebrew, Docker). Create a database, then set `DATABASE_URL` (and `DIRECT_URL`, which can be the same value for local dev) in `.env.local`:

```bash
DATABASE_URL=postgresql://localhost:5432/differenceai_dev
DIRECT_URL=postgresql://localhost:5432/differenceai_dev
```

Prisma's CLI (`prisma migrate`, `prisma db push`, `prisma studio`) reads a plain `.env` file, not `.env.local`. For local CLI use, either copy the same two variables into a `.env` file or export them in your shell before running Prisma commands.

Apply the schema:

```bash
npx prisma migrate deploy
```

(Use `npm run db:migrate:dev` instead if you're actively changing `prisma/schema.prisma` and want Prisma to generate a new migration for you.)

### 3. Load Phone Data

This repository ships with a small sample dataset (`data/imports/sample-phones.json`, a couple of well-known devices) so you can run the app locally without needing the production catalog. See [Working With Phone Data](#working-with-phone-data) for the full picture, including how to migrate an existing dataset.

### 4. Add Import Data

Place JSON files in `data/imports/`. Files other than the bundled sample are intentionally ignored by Git (see [Working With Phone Data](#working-with-phone-data)).

Each JSON file should contain an array of phone records. The importer accepts flexible payloads, including nested `specifications` arrays:

```json
[
  {
    "brand": "Samsung",
    "model": "Galaxy S24",
    "name": "Samsung Galaxy S24",
    "image": "https://example.com/galaxy-s24.jpg",
    "specifications": [
      {
        "title": "Launch",
        "specs": [{ "key": "Status", "value": "Available. Released 2024, January 24" }]
      },
      {
        "title": "Display",
        "specs": [{ "key": "Size", "value": "6.2 inches" }]
      }
    ]
  }
]
```

### 5. Import Phones

Import every `.json` file in `data/imports` (including the bundled sample):

```bash
npm run import:phones
```

Import one file:

```bash
node scripts/import-phone-data.mjs sample-phones.json
```

### 6. Run the App

```bash
npm run dev
```

Open `http://localhost:3000`.

## Common Workflows

### Browse and Compare Phones

1. Start the app with `npm run dev`.
2. Use the search box, brand dropdown, or release-year dropdown to load matching devices.
3. Add two to four phones to the comparison workspace.
4. Open the comparison page to review normalized specs and ask follow-up questions.

## Working With Phone Data

**The production phone catalog is not part of this repository.** It's a maintained product asset, populated and updated independently, and loaded into the production Postgres database separately from the application deploy. What's included here is:

- A tiny sample dataset (`data/imports/sample-phones.json`) so the app runs locally out of the box.
- The importer (`scripts/import-phone-data.mjs`), which accepts general smartphone specification/reference data as flexible JSON (see the format in [Add Import Data](#4-add-import-data)) and upserts it into Postgres by brand/device slug.
- `scripts/import-phone-backfill.mjs`, a maintainer tool that imports only records missing from the catalog. This is internal tooling, not required to run or evaluate the app, so usage details are kept out of the public README; see the script itself for its CLI options.

### Migrating an Existing SQLite Dataset to Postgres

If you're bringing over phone data from a SQLite-backed instance of this app (e.g. before it moved to Postgres), dump directly from that database rather than re-running the JSON importers - re-importing from source files isn't guaranteed to reproduce a dataset that's since been backfilled or hand-corrected:

```bash
# 1. While prisma/schema.prisma still points at the old SQLite file,
#    dump every brand and device row to JSON:
node scripts/export-sqlite-catalog.mjs
# -> writes data/exports/catalog-dump.json (gitignored; keep a backup of it)

# 2. Point DATABASE_URL at the target Postgres database, apply the schema:
npx prisma migrate deploy

# 3. Load the dump. Safe to re-run - brands/devices are upserted by slug:
npm run db:import:catalog
```

This preserves every stored field exactly as it was (no re-normalization). It's the same mechanism used to seed a production database - see [Deploying to Vercel](#deploying-to-vercel).

## Comparison Assistant

The comparison page can answer natural-language questions using the selected phones' normalized catalog data. It supports OpenAI, Hugging Face Inference Providers, or a local Ollama server. If no provider is available, it returns a grounded fallback summary from the stored specs.

### OpenAI

```bash
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-5-mini
```

### Hugging Face

```bash
COMPARE_ASSISTANT_PROVIDER=huggingface
HF_TOKEN=your_hugging_face_token_here
HUGGINGFACE_MODEL=deepseek-ai/DeepSeek-R1:fastest
```

`HUGGINGFACE_API_KEY` can be used instead of `HF_TOKEN`.

### Ollama

```bash
COMPARE_ASSISTANT_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
```

Provider selection is controlled with `COMPARE_ASSISTANT_PROVIDER`. Supported values are `openai`, `huggingface`, and `ollama`.

### Abuse Protection

`/api/compare/chat` has lightweight, in-process safeguards suited to a single-instance deployment:

- **Rate limiting** — 10 requests per minute per IP, returns `429` with a `Retry-After` header once exceeded.
- **Request timeout** — each provider call (OpenAI, Hugging Face, Ollama) aborts after 20 seconds so a stalled upstream can't tie up the request.
- **Input limits** — questions are capped at 2000 characters and comparisons at 6 devices.
- **Response caching** — identical questions for the same set of devices are served from a 5-minute in-memory cache instead of re-hitting the provider.

This is in-memory state (see `src/lib/rate-limit.ts`), scoped to a single running process. **On Vercel, this is best-effort, not a hard guarantee**: concurrent requests can land on separate serverless function instances, each with its own memory, so sustained concurrent traffic could exceed 10 req/min in aggregate even though each warm instance enforces the limit correctly. This is intentional for a first low-traffic launch - it still meaningfully blocks basic scripted abuse without adding infrastructure. If usage grows to the point this matters, replace it with a shared store (e.g. Upstash Redis) behind the same `checkRateLimit` interface.

## Scripts

```bash
npm run dev                 # Start the Next.js dev server
npm run build               # Build for production
npm run start               # Start the production server
npm run db:generate         # Generate Prisma client (also runs automatically on npm install)
npm run db:push             # Push schema to the database without a migration (prototyping only)
npm run db:migrate:dev      # Create + apply a new migration from schema changes (local dev)
npm run db:migrate:deploy   # Apply existing migrations (use this in production)
npm run db:studio           # Open Prisma Studio
npm run db:export:catalog   # Dump an existing SQLite catalog to data/exports/catalog-dump.json
npm run db:import:catalog   # Load that dump into whichever database DATABASE_URL points to
npm run import:phones       # Import all JSON files in data/imports
npm run import:phones:backfill # Import only records missing from the catalog (pass a JSON file)
```

## API Routes

- `GET /api/phones` returns brands and release years
- `GET /api/phones/search?q=&brand=&year=` searches catalog devices
- `GET /api/phones/[brand]` returns devices for a brand
- `GET /api/phones/device/[id]` returns normalized device details
- `POST /api/compare/chat` answers comparison assistant prompts

## Project Layout

```text
data/imports/                     JSON import drop zone (gitignored, except sample-phones.json)
data/exports/                     SQLite -> Postgres migration dumps (gitignored)
prisma/schema.prisma              Prisma data model (PostgreSQL)
prisma/migrations/                Migration history (apply with `prisma migrate deploy`)
scripts/export-sqlite-catalog.mjs Dumps an existing SQLite catalog to JSON
scripts/import-catalog-dump.mjs   Loads that JSON dump into Postgres
scripts/import-phone-data.mjs     CLI importer
scripts/import-phone-backfill.mjs Imports only missing records
src/app/                          Next.js app routes and UI
src/lib/db.ts                     Prisma client singleton
src/lib/phone-catalog.ts          Catalog queries
src/lib/phone-normalization.js    Phone payload normalization
src/lib/comparison-assistant.ts   AI provider calls, timeouts, response cache
src/lib/rate-limit.ts             In-memory per-IP rate limiter
```

## Data and Git

The repository ignores:

- `.env*` (except `.env.example`, which contains placeholders only)
- `data/imports/*.json` (except the bundled `sample-phones.json`)
- `data/exports/`
- any `*.sqlite`/`*.sqlite3`/`*.db` file, database backups, and generated dumps
- build artifacts such as `.next/`

This keeps local API keys, the production phone dataset, and database files out of source control - **the full catalog is never committed to this repository**, in any commit, past or present. Because `data/exports/catalog-dump.json` (the Postgres migration snapshot, when generated) is also gitignored, keep a copy of it somewhere safe after generating it - it's the only portable copy of your dataset outside the databases themselves.

## Deploying to Vercel

Architecture: **GitHub → Vercel → PostgreSQL → Hugging Face**. Nothing here needs Redis or another infrastructure service - the app is stateless Next.js route handlers backed by one Postgres database.

### 1. Create the PostgreSQL database

From the Vercel dashboard: **Storage → Create Database → Postgres** (this provisions a Neon-backed Postgres database and can be created before or after importing your project). Any other Postgres provider (Neon, Supabase, Railway) works the same way - Vercel doesn't require its own.

### 2. Get the connection string(s)

Vercel's Postgres integration shows a pooled connection string and a direct (non-pooling) one. You need both:

- **Pooled** string → `DATABASE_URL` (what the app uses at runtime; required because many concurrent serverless functions would otherwise exhaust Postgres's connection limit)
- **Direct** string → `DIRECT_URL` (used only for running migrations)

If your provider only gives you one connection string, use it for both.

### 3. Add environment variables to Vercel

In your Vercel project → **Settings → Environment Variables**:

| Variable | Value | Environments |
|---|---|---|
| `DATABASE_URL` | Pooled Postgres connection string | Production, Preview, Development |
| `DIRECT_URL` | Direct (non-pooling) Postgres connection string | Production, Preview, Development |
| `HF_TOKEN` | Your Hugging Face token | Production (add to Preview too if you want PRs to run the assistant) |
| `HUGGINGFACE_MODEL` | e.g. `Qwen/Qwen2.5-72B-Instruct:fastest` | Production, Preview |
| `COMPARE_ASSISTANT_PROVIDER` | `huggingface` (or `openai`) | Production, Preview |
| `OPENAI_API_KEY` | Only if using the OpenAI provider | Production, Preview |
| `OPENAI_MODEL` | Only if using the OpenAI provider | Production, Preview |

Do not set `OLLAMA_BASE_URL`/`OLLAMA_MODEL` in Vercel - there's no local Ollama server to reach in production, so leaving the provider on `huggingface` or `openai` is required. Never paste real secret values into a file in the repo; enter them directly in the Vercel dashboard (or via `vercel env add`).

### 4. Connect the GitHub repository

In Vercel: **Add New → Project → Import Git Repository**, select this repo. Vercel auto-detects Next.js.

### 5. Build command

The default build command (`next build` via `npm run build`) is sufficient - no override needed. `npm install` already runs `prisma generate` through the `postinstall` script, so the Prisma Client is generated on every build.

### 6. Run migrations against the production database

Do this once, from your own machine, before the first deploy (or any time after you add a new migration):

```bash
DATABASE_URL="<direct-or-pooled-url>" DIRECT_URL="<direct-url>" npx prisma migrate deploy
```

This applies `prisma/migrations/` to create the `Brand` and `Device` tables. It's safe to re-run.

### 7. Import the existing phone dataset

If you haven't already generated `data/exports/catalog-dump.json` locally (see [Migrating an Existing SQLite Dataset to Postgres](#migrating-an-existing-sqlite-dataset-to-postgres)), do that first against your existing SQLite database. Then, from your own machine, load it into production:

```bash
DATABASE_URL="<production-database-url>" npm run db:import:catalog
```

This upserts by slug, so it's safe to re-run if you need to refresh the dataset later.

### 8. Deploy

Push to the branch Vercel is tracking (or click **Deploy** in the dashboard). Vercel builds and deploys automatically on every push once the project is connected.

### 9. Verify the production deployment

Open the deployed URL and confirm:

- The homepage loads and brand/year filters populate (confirms `DATABASE_URL` and the imported data are working)
- Searching and filtering return real devices
- A device detail page loads full specs
- Selecting 2+ phones and opening the comparison page works

### 10. Check the Hugging Face AI functionality

On the comparison page, ask a question about the selected phones. A real answer (not the "I couldn't reach a live AI provider" fallback message) confirms `HF_TOKEN`/`COMPARE_ASSISTANT_PROVIDER` are set correctly and Hugging Face is reachable. Check Vercel's function logs for `[comparison-assistant] ... provider failed` lines if it falls back.

### 11. Check rate limiting

Send more than 10 requests to `/api/compare/chat` within a minute (e.g. by asking questions quickly) and confirm you get a `429` response with a `Retry-After` header. Remember this is per-serverless-instance, not global - see [Abuse Protection](#abuse-protection).

### 12. Confirm no admin/debug endpoint is exposed

Visit `/admin` and `/api/phones/download` on the deployed URL - both should be gone (404 for `/admin`; `/api/phones/download` resolves to the `[brand]` catalog route and returns an empty device list, not any privileged data). There is no other admin or debug route in the app.

## Validation

Before opening a PR or deploying, run:

```bash
npm run build
npx tsc --noEmit
npx prisma migrate status # if you changed prisma/schema.prisma - confirms pending migrations without applying them
```
