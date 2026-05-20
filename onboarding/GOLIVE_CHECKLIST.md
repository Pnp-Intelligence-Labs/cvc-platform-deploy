# Go-Live Checklist

Work through this before sharing the platform URL with your team.
Each item takes 1–5 minutes. The whole checklist takes under 30 minutes.

---

## Security

- [ ] **Change the admin password**
  Log in as `admin` → top-right corner → Change Password.
  The default (`changeme`) is public knowledge — do this first.

- [ ] **Set `ALLOWED_ORIGINS` in `.env`**
  This controls which URLs can talk to the API.
  ```env
  ALLOWED_ORIGINS=https://your-domain.com,http://your-server-ip:8002
  ```
  Without this, the API will reject requests from your production frontend.
  After editing, restart the API.

- [ ] **Set a strong `JWT_SECRET`**
  The installer generates one automatically. If you set it manually,
  use at least 32 random characters. Do not use a dictionary word.
  ```bash
  python3 -c "import secrets; print(secrets.token_hex(32))"
  ```

- [ ] **Set a strong `DB_PASSWORD`**
  Default for local dev is `platform_local`. Change it for any
  server that is reachable from outside your local machine.

- [ ] **Firewall the DB port**
  PostgreSQL (port 5432) should not be exposed to the internet.
  Only the API (port 8002) needs to be reachable — and ideally
  only through a reverse proxy (nginx/Caddy) on port 443.

---

## Users

- [ ] **Create accounts for every team member**
  Admin → Users → Add User. Set the correct role for each person.

- [ ] **Assign PSM users to their partners**
  Admin → Partner Assignments. PSM users only see assigned partners —
  skip this and they'll see an empty screen.

- [ ] **Send your team the invite** (template in `onboarding/TEAM_INVITE.md`)

---

## Data

- [ ] **Import your companies**
  Ventures → Companies → Import CSV, or:
  ```bash
  curl -X POST http://your-server:8002/admin/companies/import \
    -H "Authorization: Bearer <token>" \
    -F "file=@your_companies.csv"
  ```

- [ ] **Import your partners**
  Partners → Import CSV. Use `onboarding/sample_partners.csv` as a column guide.

- [ ] **Load demo data (optional)**
  If you want the platform pre-populated for a demo or evaluation:
  ```bash
  python3 scripts/seed_demo.py
  ```
  Demo records are tagged and can be deleted anytime:
  ```sql
  DELETE FROM cvc.companies WHERE enrichment_source = 'demo_seed';
  ```

---

## Infrastructure

- [ ] **Set up the API as a persistent service**
  Without this, the API stops when your SSH session ends.
  ```bash
  sudo tee /etc/systemd/system/platform-api.service > /dev/null <<EOF
  [Unit]
  Description=Vertical OS API
  After=docker.service

  [Service]
  Type=simple
  User=$(whoami)
  WorkingDirectory=$(pwd)
  ExecStart=$(pwd)/.venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8002
  Restart=always
  EnvironmentFile=$(pwd)/.env

  [Install]
  WantedBy=multi-user.target
  EOF

  sudo systemctl enable platform-api
  sudo systemctl start platform-api
  ```

- [ ] **Set up nightly DB backups**
  ```bash
  # Add to crontab: crontab -e
  0 3 * * * docker exec platform-db pg_dump -U platform platform_db | gzip > /opt/backups/platform_$(date +\%Y\%m\%d).sql.gz
  ```
  Make sure `/opt/backups/` exists and is writable. Test it once manually.

- [ ] **Put the API behind a reverse proxy (recommended)**
  Use nginx or Caddy to serve HTTPS on port 443 and proxy to port 8002.
  This gives you a clean URL and valid SSL. Caddy handles certificates automatically.

  Minimal Caddy config:
  ```
  your-domain.com {
      reverse_proxy localhost:8002
  }
  ```

---

## Final Verification

- [ ] **Run the smoke test**
  ```bash
  bash scripts/smoke_test.sh http://your-server:8002 admin yournewpassword
  ```
  All checks should pass. Fix anything that fails before sharing with the team.

- [ ] **Test a login as a non-admin user**
  Create a test account with the Ventures role, log in, confirm the right
  sections are visible and nothing admin-only is accessible.

- [ ] **Test CSV import end-to-end**
  Use `onboarding/sample_companies.csv` — import it, confirm records appear,
  then delete the test data if needed.

---

## You're Live

Once all boxes are checked:
1. Send the team invite (`onboarding/TEAM_INVITE.md`)
2. Pin the URL somewhere visible (Slack channel topic, internal wiki, etc.)
3. Schedule a 15-minute walkthrough call — the `onboarding/USER_GUIDE.md` covers everything
