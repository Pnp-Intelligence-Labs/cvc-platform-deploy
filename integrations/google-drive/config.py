import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
TOKEN_DIR = DATA_DIR / "tokens"
DOWNLOAD_DIR = DATA_DIR / "downloads"

GOOGLE_CLIENT_SECRETS = Path(
    os.getenv("GOOGLE_CLIENT_SECRETS", str(BASE_DIR / "client_secret.json"))
)
GOOGLE_REDIRECT_URI = os.getenv(
    "GOOGLE_REDIRECT_URI", "http://127.0.0.1:8085/oauth2callback"
)
GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

HOST = os.getenv("GDRIVE_INGEST_HOST", "127.0.0.1")
PORT = int(os.getenv("GDRIVE_INGEST_PORT", "8085"))
SESSION_SECRET = os.getenv("GDRIVE_SESSION_SECRET", "dev-change-me")
