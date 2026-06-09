# Keycloak SSO Setup — DuploCloud Deployment Guide

This platform supports Keycloak OIDC SSO. When configured, users sign in via your company's identity provider (Google, Okta, etc.) through Keycloak. Username/password login remains available for local dev and admin fallback.

---

## 1. Register the OIDC Client in Keycloak

In your Keycloak admin console:

1. Go to your realm → **Clients** → **Create client**
2. **Client type:** OpenID Connect
3. **Client ID:** `vertical-os` (or any name — you'll set this in env vars)
4. **Client authentication:** ON (confidential client — recommended)
5. **Valid redirect URIs:** `https://<your-app-domain>/app/auth/callback`
6. **Web origins:** `https://<your-app-domain>`
7. Save. Copy the **Client secret** from the **Credentials** tab.

If your Keycloak already has Google configured as an identity provider, users will see "Sign in with Google" on the Keycloak login screen automatically.

---

## 2. Environment Variables

Set these in your DuploCloud service's environment config:

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `KEYCLOAK_URL` | Yes | `https://auth.company.com` | Keycloak base URL (no trailing slash) |
| `KEYCLOAK_REALM` | Yes | `master` | Realm name |
| `KEYCLOAK_CLIENT_ID` | Yes | `vertical-os` | Client ID from step 1 |
| `KEYCLOAK_CLIENT_SECRET` | Yes* | `abc123...` | Client secret (*omit for public clients) |
| `PLATFORM_BASE_URL` | Yes | `https://app.company.com` | Public app URL — used to build redirect_uri |
| `KEYCLOAK_DEFAULT_ROLE` | No | `Ventures` | Platform role for new users (default: `Ventures`) |
| `KEYCLOAK_ROLE_CLAIM` | No | `realm_access.roles` | KC token claim to read platform role from. Dot-notation supported: `realm_access.roles` resolves to the nested list; `realm_access` reads the dict's `roles` key; `groups` reads a flat list. See Section 4. |
| `JWT_SECRET` | Yes | `<random 50+ char string>` | Internal JWT signing secret (existing) |

**`PLATFORM_BASE_URL` must match** the redirect URI you registered in Keycloak:
- If `PLATFORM_BASE_URL=https://app.company.com`, the redirect URI is `https://app.company.com/app/auth/callback`
- Register exactly that URL in Keycloak's Valid redirect URIs (no trailing slash, correct scheme)

---

## 3. Security Checklist Before Go-Live

- [ ] **JWT_SECRET** — generate a strong secret:
      ```bash
      python -c "import secrets; print(secrets.token_urlsafe(50))"
      ```
      Never reuse across environments (local dev, staging, production each get their own).

- [ ] **DJANGO_SECRET_KEY** — if using the Django backend (port 8003), generate separately:
      ```bash
      python -c "import secrets; print(secrets.token_urlsafe(50))"
      ```
      The placeholder `change-me-in-production` is **not acceptable** in any deployed environment.

- [ ] **KEYCLOAK_CLIENT_SECRET** — copy from Keycloak → Client → Credentials tab.
      Rotate it if it was ever visible in shell history, CI logs, or a committed `.env` file.

- [ ] **PLATFORM_BASE_URL** must exactly match the redirect URI registered in Keycloak
      (no trailing slash, `/app/auth/callback` suffix, correct scheme). Verify:
      ```bash
      curl https://app.yourdomain.com/auth/keycloak/config
      # → {"enabled": true, "client_id": "vertical-os"}
      ```

- [ ] **DB_PASSWORD** — do not use `platform_local` outside local dev. Generate:
      ```bash
      python -c "import secrets; print(secrets.token_urlsafe(32))"
      ```

- [ ] Confirm `.env` is in `.gitignore` and not committed to source control.

---

## 4. Role Mapping (optional)

By default, all new Keycloak users get the `Ventures` role.

To map Keycloak groups/roles to platform roles, set `KEYCLOAK_ROLE_CLAIM`.
The value supports dot-notation for nested claims:

```bash
# Keycloak realm roles (standard) — dot-notation resolves to the list
KEYCLOAK_ROLE_CLAIM=realm_access.roles

# Same realm roles via the dict claim — code reads the nested "roles" key
KEYCLOAK_ROLE_CLAIM=realm_access

# Flat group-membership list claim
KEYCLOAK_ROLE_CLAIM=groups
```

Valid platform roles: `GP`, `Principal`, `Director`, `Ventures`, `PSM`, `Senior PSM`

The first matching role wins. If no KC role matches a platform role, `KEYCLOAK_DEFAULT_ROLE` is used.

To add groups to the Keycloak token:
1. In Keycloak: Client → Client scopes → Add mapper → Group Membership
2. Set token claim name to `groups`
3. Name your groups to match platform role names (e.g. create a `GP` group in Keycloak)

---

## 5. Run the Database Migration

After deploying the new code, apply the migration once:

```bash
psql $DATABASE_URL -f core/db/migrations/137_keycloak_auth.sql
```

This adds `keycloak_sub` to the users table and makes `password_hash` nullable (so KC users don't need a local password). In Docker deployments the entrypoint runs migrations automatically.

---

## 6. Deploying Keycloak on DuploCloud

### 6a. Create the Keycloak Service

1. In DuploCloud → **DevOps → Containers → EKS/Native** → **Add Service**
2. **Image:** `quay.io/keycloak/keycloak:24.0.5` (pin a specific version — avoid `latest` in production)
3. **Replicas:** 1 to start; scale up after verifying SSO end-to-end
4. **Environment Variables** (set in DuploCloud → Service → Environment):

   | Variable | Value |
   |---|---|
   | `KC_HOSTNAME` | `https://auth.yourdomain.com` |
   | `KC_PROXY` | `edge` (required behind an ALB or nginx TLS terminator) |
   | `KEYCLOAK_ADMIN` | `admin` |
   | `KEYCLOAK_ADMIN_PASSWORD` | *(strong random password — store in DuploCloud Secrets)* |
   | `KC_DB` | `postgres` |
   | `KC_DB_URL` | `jdbc:postgresql://<db-host>:5432/<db-name>` |
   | `KC_DB_USERNAME` | `<db-user>` |
   | `KC_DB_PASSWORD` | `<db-password>` |

5. **Command / Args:** `start` — use `start-dev` only for local testing (disables HTTPS enforcement)
6. **Load Balancer:** Attach an HTTPS listener. The hostname must match `KC_HOSTNAME`.
7. After the service starts, navigate to `https://auth.yourdomain.com/admin` to complete initial realm and client setup (Sections 1 and 4 above).

### 6b. Set Platform API Env Vars in DuploCloud

1. In DuploCloud → **DevOps → Containers** → select your platform API service
2. Click **Edit → Environment Variables** and add/update:

   ```
   KEYCLOAK_URL=https://auth.yourdomain.com
   KEYCLOAK_REALM=your-realm-name
   KEYCLOAK_CLIENT_ID=vertical-os
   KEYCLOAK_CLIENT_SECRET=<from Keycloak Credentials tab>
   PLATFORM_BASE_URL=https://app.yourdomain.com
   KEYCLOAK_DEFAULT_ROLE=Ventures
   JWT_SECRET=<generated 50-char string>
   ```

3. Click **Update**. DuploCloud rolling-restarts the service automatically.
4. Do not set `KEYCLOAK_ROLE_CLAIM` unless you have configured a role/group mapper in Keycloak. The default (blank) assigns all new KC users `KEYCLOAK_DEFAULT_ROLE`.

### 6c. Verify the Redirect URI

The backend builds the redirect URI as: `{PLATFORM_BASE_URL}/app/auth/callback`

This must match — character for character — an entry in Keycloak → Clients → your client → **Valid redirect URIs**. Common mismatches:

- Trailing slash on one side but not the other
- `http://` vs `https://`
- Missing `/app` prefix

Quick check:
```bash
curl https://app.yourdomain.com/auth/keycloak/config
# Expected: {"enabled": true, "client_id": "vertical-os"}
```

---

## 7. DuploCloud Service Config Checklist

In DuploCloud → Services → your API service → Environment variables:

```
KEYCLOAK_URL=https://auth.company.com
KEYCLOAK_REALM=your-realm
KEYCLOAK_CLIENT_ID=vertical-os
KEYCLOAK_CLIENT_SECRET=<from keycloak credentials tab>
PLATFORM_BASE_URL=https://<your-duplo-app-url>
KEYCLOAK_DEFAULT_ROLE=Ventures
JWT_SECRET=<strong random secret>
```

That's it. Restart the service. The login page will automatically show "Sign in with Google (SSO)".

---

## 8. How It Works

```
User visits /ventures → not logged in
  ↓
AuthGuard redirects to /login with state.from='/ventures'
  ↓
LoginPage fetches /auth/keycloak/login-url?from=%2Fventures
  ↓
Backend embeds 'from' path in signed state JWT
  ↓
Browser navigates to Keycloak authorize endpoint
  ↓
Keycloak → Google OAuth (or any configured IdP)
  ↓
Keycloak redirects → /app/auth/callback?code=...&state=<JWT>
  ↓
OIDCCallback POST /auth/keycloak/exchange {code, state}
  ↓
Backend validates state JWT (signature + expiry + typ claim)
Backend exchanges code with Keycloak, validates ID token via JWKS
Backend auto-provisions user in DB (or matches existing by email)
Backend issues platform JWT
  ↓
Frontend stores JWT → decodes state JWT to recover 'from' path
  ↓
User lands on /ventures ✓
```

The platform JWT is identical to the one issued by username/password login. All existing API endpoints, role checks, and session handling work unchanged.

---

## 9. Existing Users

Existing users who previously logged in with username/password will be matched by **email** on their first Keycloak login and automatically linked to their KC identity. Their existing role and data are preserved. On subsequent logins, their platform role is updated to match their current Keycloak role (so role changes in Keycloak take effect immediately).

---

## 10. Local Development (no Keycloak)

If `KEYCLOAK_URL` is not set, SSO is disabled and the login page shows only username/password. This is the default for local dev.

To test Keycloak locally, you can run Keycloak via Docker:
```bash
docker run -p 8080:8080 \
  -e KEYCLOAK_ADMIN=admin \
  -e KEYCLOAK_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:latest start-dev
```
Then set `KEYCLOAK_URL=http://localhost:8080` and configure a realm + client.

---

## 11. Deactivated Accounts

If an admin deactivates a user via the platform admin UI, that user cannot log in via Keycloak SSO (returns HTTP 403). The deactivation is respected regardless of whether the user's Keycloak account is still active. To restore access, reactivate the user in the platform admin UI.
