"""
auth_drive.py — One-time Google Drive OAuth flow for the DD ingestion pipeline.

Uses the registered redirect URI (http://127.0.0.1:8085/oauth2callback) to match
what's in Google Cloud Console. Saves token to ~/producer/gdrive_token.json.

Run once:
    python3 auth_drive.py
"""

import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from google_auth_oauthlib.flow import Flow

CREDS_PATH   = Path.home() / "producer" / "gdrive_credentials.json"
TOKEN_PATH   = Path.home() / "producer" / "gdrive_token.json"
REDIRECT_URI = "http://127.0.0.1:8085/oauth2callback"
SCOPES       = ["https://www.googleapis.com/auth/drive"]

# Shared state between the HTTP server and main thread
_auth_code  = None
_auth_state = None
_server_done = threading.Event()


class CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global _auth_code, _auth_state
        params = parse_qs(urlparse(self.path).query)
        _auth_code  = params.get("code",  [None])[0]
        _auth_state = params.get("state", [None])[0]

        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<h2>Authorised! You can close this tab.</h2>")
        _server_done.set()

    def log_message(self, *_):
        pass  # suppress access logs


def main():
    if not CREDS_PATH.exists():
        print(f"ERROR: credentials not found at {CREDS_PATH}")
        sys.exit(1)

    flow = Flow.from_client_secrets_file(
        str(CREDS_PATH),
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI,
    )

    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )

    # Start local callback server
    server = HTTPServer(("127.0.0.1", 8085), CallbackHandler)
    t = threading.Thread(target=server.handle_request)
    t.daemon = True
    t.start()

    print(f"\nOpening browser for Google OAuth…")
    print(f"If it doesn't open, visit:\n  {auth_url}\n")
    webbrowser.open(auth_url)

    # Wait for callback (60s timeout)
    if not _server_done.wait(timeout=120):
        print("ERROR: timed out waiting for OAuth callback")
        sys.exit(1)

    if not _auth_code:
        print("ERROR: no auth code received")
        sys.exit(1)

    flow.fetch_token(code=_auth_code)
    creds = flow.credentials

    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_PATH.write_text(creds.to_json())
    print(f"Token saved → {TOKEN_PATH}")
    print("You can now run ingest.py — no further auth needed.")


if __name__ == "__main__":
    main()
