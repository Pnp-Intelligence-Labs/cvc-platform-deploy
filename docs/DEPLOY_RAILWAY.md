# Railway Deployment Guide

Backend deploys to Railway (Docker-native, always-on). Frontend stays on Vercel and proxies API calls to Railway.

## Prerequisites

- Railway account: railway.app
- Cloudflare account for R2 object storage (free up to 10 GB)
- Vercel CLI installed: `npm i -g vercel`
- Railway CLI installed: `npm i -g @railway/cli`

---

## 1. Cloudflare R2 (object storage)

The MinIO SDK is S3-compatible. R2 speaks the same API — no code changes required.

1. Go to dash.cloudflare.com → **R2** → **Create bucket** → name it `platform-documents`
2. Go to **R2 → Manage R2 API tokens** → **Create API token**
   - Permissions: **Object Read & Write** for the bucket above
   - Save the **Access Key ID** and **Secret Access Key**
3. Your endpoint is: `<account_id>.r2.cloudflarestorage.com`
   - Find account ID in the URL bar on any Cloudflare page

---

## 2. Supabase Database

The platform uses **Supabase** for PostgreSQL (replaces Railway's built-in Postgres plugin). Supabase is free up to 500 MB and requires no server management.

### Create the project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Choose a name (e.g. `cvc-platform`), set a strong password, pick a region close to your Railway deployment
3. Wait ~1 minute for provisioning

### Get the connection string

In the Supabase dashboard → **Settings → Database → Connection string → URI tab**:

```
postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
```

> **Use port 5432 (direct connection), NOT port 6543 (Supabase pooler/pgbouncer).**
> The app sets session-level settings (`SET search_path`, `SET app.audit_source`) on every
> connection. pgbouncer in transaction mode resets these between queries, which breaks the app.
> The app manages its own connection pool (2–20 connections), so you don't need pgbouncer.

### Run migrations against Supabase

From the repo root (requires `psql` installed — `brew install libpq`):

```bash
DATABASE_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \
  bash scripts/migrate.sh
```

This runs all 141 core migrations in order. Each is idempotent — safe to re-run.

After running, verify in Supabase → **Table Editor** that the `cvc` schema and its tables exist.

### Set DATABASE_URL in Railway

You will add this URI as the `DATABASE_URL` environment variable in your Railway service (see Section 3).

---

## 3. Create the Railway project

```bash
railway login
railway init          # creates a new project; name it "cvc-platform"
```

### Deploy the API service

```bash
# From repo root
railway up
```

Railway auto-detects `railway.toml` and builds via `Dockerfile`.

### Set environment variables

In the Railway dashboard → your API service → **Variables**, add each variable from [config/railway.env.example](../config/railway.env.example).

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase direct URI from Section 2 (includes `sslmode=require`) |
| `APP_SCHEMA` | `cvc` |
| `ENVIRONMENT` | `production` |
| `PYTHONPATH` | `/app:/app/core` |
| `JWT_SECRET` | *(run `openssl rand -hex 32`)* |
| `ALLOWED_ORIGINS` | your Vercel frontend URL |
| `ALLOW_CREDENTIALS` | `true` |
| `MFA_REQUIRED_ROLES` | `GP,PSM,Ventures` |
| `MINIO_ENDPOINT` | `<account_id>.r2.cloudflarestorage.com` |
| `MINIO_ACCESS_KEY` | R2 access key ID |
| `MINIO_SECRET_KEY` | R2 secret access key |
| `MINIO_BUCKET` | `platform-documents` |
| `MINIO_SECURE` | `true` |
| `MAX_UPLOAD_MB` | `25` |

### Get the Railway API URL

After first deploy, Railway assigns a public URL like `https://cvc-platform-api-production.up.railway.app`.

Find it: **Railway dashboard → your service → Settings → Public Networking → Generate Domain**.

---

## 4. Update Vercel frontend

Replace `RAILWAY_API_URL` in [designs/figma-dashboard/vercel.json](../designs/figma-dashboard/vercel.json) with your actual Railway domain (no `https://` prefix — it's already in each rewrite):

```bash
# Example: replace placeholder with actual domain
sed -i '' 's/RAILWAY_API_URL/cvc-platform-api-production.up.railway.app/g' \
  designs/figma-dashboard/vercel.json
```

Then add the Vercel frontend URL to `ALLOWED_ORIGINS` in Railway variables (e.g. `https://your-frontend.vercel.app`).

Redeploy frontend:
```bash
cd designs/figma-dashboard
vercel --prod
```

---

## 4. Verify

```bash
# Health check
curl https://<your-railway-domain>/health
# Expected: {"status": "ok"}

# Migrations ran automatically via docker_entrypoint.sh
# Check Railway logs: railway logs
```

---

## Ongoing deploys

Push to `main` → Railway auto-deploys (configure in Railway dashboard → **Settings → Source** → connect GitHub repo and enable auto-deploy on push).

Frontend: `cd designs/figma-dashboard && vercel --prod`

---

## Notes

- `sentence-transformers` model loads lazily on first `/recommendations` request (~10 s cold start). Subsequent requests are fast.
- Railway containers stay warm between requests (always-on, not serverless). No cold-start penalty after first boot.
- MinIO plugin vars (`MINIO_*`) point to R2. The `minio` Python SDK connects to R2 transparently.
- `MINIO_SECURE=true` is required because `ENVIRONMENT=production` enforces it in `docker_entrypoint.sh`. R2 is HTTPS-only, so this works.
