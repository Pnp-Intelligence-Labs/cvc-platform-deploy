import re
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

from config import GOOGLE_CLIENT_SECRETS, GOOGLE_REDIRECT_URI, GOOGLE_SCOPES, TOKEN_DIR

GOOGLE_DOC_EXPORT = {
    "application/vnd.google-apps.document": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".docx",
    ),
    "application/vnd.google-apps.spreadsheet": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xlsx",
    ),
    "application/vnd.google-apps.presentation": (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".pptx",
    ),
}

FOLDER_URL_PATTERN = re.compile(r"/folders/([a-zA-Z0-9_-]+)")
FILE_URL_PATTERN = re.compile(r"/file/d/([a-zA-Z0-9_-]+)")


def token_path(user_id: str) -> Path:
    safe_id = re.sub(r"[^a-zA-Z0-9._-]", "_", user_id)
    return TOKEN_DIR / f"{safe_id}.json"


def create_oauth_flow() -> Flow:
    return Flow.from_client_secrets_file(
        str(GOOGLE_CLIENT_SECRETS),
        scopes=GOOGLE_SCOPES,
        redirect_uri=GOOGLE_REDIRECT_URI,
    )


def save_credentials(user_id: str, creds: Credentials) -> None:
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    token_path(user_id).write_text(creds.to_json())


def load_credentials(user_id: str) -> Credentials | None:
    path = token_path(user_id)
    if not path.exists():
        return None
    creds = Credentials.from_authorized_user_file(str(path), GOOGLE_SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        save_credentials(user_id, creds)
    return creds if creds.valid else None


def get_service(user_id: str):
    creds = load_credentials(user_id)
    if not creds:
        raise PermissionError("Google Drive not connected")
    return build("drive", "v3", credentials=creds)


def parse_drive_url(url_or_id: str) -> tuple[str, str]:
    if FOLDER_URL_PATTERN.search(url_or_id):
        return "folder", FOLDER_URL_PATTERN.search(url_or_id).group(1)
    if FILE_URL_PATTERN.search(url_or_id):
        return "file", FILE_URL_PATTERN.search(url_or_id).group(1)
    return "folder", url_or_id.strip()


def list_folder_children(service, folder_id: str, rel_path: str = "") -> list[dict]:
    files: list[dict] = []
    page_token = None

    while True:
        response = (
            service.files()
            .list(
                q=f"'{folder_id}' in parents and trashed=false",
                fields="nextPageToken, files(id, name, mimeType, size, modifiedTime)",
                pageToken=page_token,
                pageSize=200,
            )
            .execute()
        )

        for item in response.get("files", []):
            item_path = f"{rel_path}/{item['name']}" if rel_path else item["name"]
            if item["mimeType"] == "application/vnd.google-apps.folder":
                files.extend(list_folder_children(service, item["id"], item_path))
            else:
                item["rel_path"] = item_path
                files.append(item)

        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return files


def get_file_metadata(service, file_id: str) -> dict:
    return (
        service.files()
        .get(fileId=file_id, fields="id, name, mimeType, size, modifiedTime")
        .execute()
    )


def list_drive_files(service, url_or_id: str) -> list[dict]:
    resource_type, resource_id = parse_drive_url(url_or_id)
    if resource_type == "file":
        metadata = get_file_metadata(service, resource_id)
        metadata["rel_path"] = metadata["name"]
        return [metadata]
    return list_folder_children(service, resource_id)


def download_file(service, file_id: str, mime_type: str, dest_path: Path) -> bool:
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        if mime_type in GOOGLE_DOC_EXPORT:
            export_mime, ext = GOOGLE_DOC_EXPORT[mime_type]
            if dest_path.suffix != ext:
                dest_path = dest_path.with_suffix(ext)
            request = service.files().export_media(fileId=file_id, mimeType=export_mime)
        else:
            request = service.files().get_media(fileId=file_id)

        with open(dest_path, "wb") as handle:
            downloader = MediaIoBaseDownload(handle, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
        return True
    except Exception as exc:
        print(f"[drive] download failed for {dest_path.name}: {exc}")
        return False


def ingest_drive_source(service, url_or_id: str, dest_dir: Path) -> list[dict]:
    files = list_drive_files(service, url_or_id)
    results = []

    for item in files:
        local_path = dest_dir / item["rel_path"]
        success = download_file(service, item["id"], item["mimeType"], local_path)
        results.append(
            {
                "id": item["id"],
                "name": item["name"],
                "rel_path": item["rel_path"],
                "mime_type": item["mimeType"],
                "size": item.get("size"),
                "local_path": str(local_path),
                "success": success,
            }
        )

    return results
