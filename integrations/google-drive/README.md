# Google Drive Ingestion Engine

Standalone OAuth + ingestion service for pulling files from a user's Google Drive into local storage. Built separately from the main platform API so it can be wired into MinIO / partner ingestion later.

Uses the standard **Google OAuth 2.0 web application flow** with:

- `google-auth-oauthlib` (`Flow`) for browser sign-in
- Google Drive API v3 for listing and downloading files
- FastAPI for the local OAuth callback and ingestion API

## Setup

### 1. Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable **Google Drive API**
4. Configure **OAuth consent screen** (External is fine for testing)
5. Create **OAuth client ID** → **Web application**
6. Add authorized redirect URI:

```
http://127.0.0.1:8085/oauth2callback
```

7. Download the client JSON and save it as:

```
integrations/google-drive/client_secret.json
```

### 2. Environment

```bash
cp integrations/google-drive/.env.example integrations/google-drive/.env
```

Optional: add the same variables to the repo root `.env`.

### 3. Run

```bash
bash integrations/google-drive/run.sh
```

Open `http://127.0.0.1:8085`.

## Usage

1. Click **Sign in with Google**
2. Approve Drive read access
3. Paste a Drive folder or file URL
4. **Preview files** to inspect what will be downloaded
5. **Ingest to local storage** to download into:

```
integrations/google-drive/data/downloads/<user-email>/<job-name>/
```

OAuth tokens are stored in:

```
integrations/google-drive/data/tokens/
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health + OAuth config status |
| `/api/session` | GET | Current Google session |
| `/auth/login` | GET | Start browser OAuth |
| `/oauth2callback` | GET | OAuth redirect handler |
| `/auth/logout` | POST | Clear local session |
| `/api/preview` | POST | List files for a Drive URL |
| `/api/ingest` | POST | Download files locally |
| `/api/jobs` | GET | List prior ingest jobs |

### Example ingest request

```bash
curl -X POST http://127.0.0.1:8085/api/ingest \
  -H "Content-Type: application/json" \
  -b "session=<cookie>" \
  -d '{"drive_url":"https://drive.google.com/drive/folders/ABC123","job_name":"dataroom"}'
```

## Platform integration (later)

This service is intentionally isolated. When ready to connect to the platform:

1. Upload ingested files to MinIO via `core/storage.py`
2. Trigger platform document indexing from the ingest job result
3. Mount routes under a plugin or proxy from the main API on port 8002
4. Replace file-based token storage with encrypted DB storage per team/user

## Notes

- Scope is read-only: `https://www.googleapis.com/auth/drive.readonly`
- Google Docs/Sheets/Slides are exported to Office formats before download
- Do not commit `client_secret.json`, `.env`, or `data/`
