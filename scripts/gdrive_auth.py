"""
gdrive_auth.py — One-time Google Drive OAuth flow.
Saves token to ~/producer/gdrive_token.json.

Usage:
    python scripts/gdrive_auth.py

If you get redirect_uri_mismatch, add http://localhost:8080 to your
Google Cloud Console → OAuth client → Authorized redirect URIs.
"""

from pathlib import Path
from google_auth_oauthlib.flow import InstalledAppFlow
import json

CREDS  = Path.home() / "producer" / "gdrive_credentials.json"
TOKEN  = Path.home() / "producer" / "gdrive_token.json"
SCOPES = ["https://www.googleapis.com/auth/drive"]

# InstalledAppFlow handles both "installed" and "web" client types
# when using run_local_server — redirect URI becomes http://localhost:PORT/
flow = InstalledAppFlow.from_client_secrets_file(str(CREDS), SCOPES)
creds = flow.run_local_server(port=8080, open_browser=True)

TOKEN.write_text(creds.to_json())
print(f"\nToken saved to {TOKEN}")
print("Google Drive auth complete — restart the API server.")
