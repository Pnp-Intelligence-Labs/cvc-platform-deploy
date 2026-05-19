"""
drive.py — Google Drive client for DD pipeline.
Handles auth, recursive folder traversal, file download, and report upload.
Credentials live in ~/producer/ — already authenticated.
"""

import io
from pathlib import Path
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaFileUpload

from config.settings import GDRIVE_CREDS, GDRIVE_TOKEN, GDRIVE_DD_FOLDER

SCOPES = ["https://www.googleapis.com/auth/drive"]

GOOGLE_DOC_EXPORT = {
    "application/vnd.google-apps.document":     ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"),
    "application/vnd.google-apps.spreadsheet":  ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",      ".xlsx"),
    "application/vnd.google-apps.presentation": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"),
}


def get_service():
    """Authenticate and return a Drive service. Silently refreshes token."""
    creds = None

    if GDRIVE_TOKEN.exists():
        creds = Credentials.from_authorized_user_file(str(GDRIVE_TOKEN), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(GDRIVE_CREDS), SCOPES)
            creds = flow.run_local_server(port=0)
        with open(GDRIVE_TOKEN, "w") as f:
            f.write(creds.to_json())

    return build("drive", "v3", credentials=creds)


def extract_folder_id(url_or_id: str) -> str:
    """Parse a Google Drive folder URL into its ID."""
    if "drive.google.com" in url_or_id:
        for marker in ("/folders/", "/file/d/"):
            if marker in url_or_id:
                return url_or_id.split(marker)[1].split("?")[0].split("/")[0]
    return url_or_id


def list_files_recursive(service, folder_id: str, rel_path: str = "") -> list[dict]:
    """
    Recursively list all files in a Drive folder and its subfolders.
    Returns list of dicts: {id, name, mimeType, size, rel_path}
    """
    files = []
    page_token = None

    while True:
        query = f"'{folder_id}' in parents and trashed=false"
        resp = service.files().list(
            q=query,
            fields="nextPageToken, files(id, name, mimeType, size)",
            pageToken=page_token
        ).execute()

        for item in resp.get("files", []):
            item_path = f"{rel_path}/{item['name']}" if rel_path else item["name"]

            if item["mimeType"] == "application/vnd.google-apps.folder":
                # Recurse into subfolder
                files.extend(list_files_recursive(service, item["id"], item_path))
            else:
                item["rel_path"] = item_path
                files.append(item)

        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    return files


def download_file(service, file_id: str, mime_type: str, dest_path: Path) -> bool:
    """
    Download a file to dest_path.
    Google Docs (Sheets, Slides, Docs) are exported to Office formats.
    Returns True on success.
    """
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        if mime_type in GOOGLE_DOC_EXPORT:
            export_mime, ext = GOOGLE_DOC_EXPORT[mime_type]
            # Rename dest to correct extension if needed
            if not dest_path.suffix == ext:
                dest_path = dest_path.with_suffix(ext)
            request = service.files().export_media(fileId=file_id, mimeType=export_mime)
        else:
            request = service.files().get_media(fileId=file_id)

        with open(dest_path, "wb") as f:
            downloader = MediaIoBaseDownload(f, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()

        return True

    except Exception as e:
        print(f"  [drive] Download failed: {dest_path.name} — {e}")
        return False


def download_dataroom(service, folder_url: str, dest_dir: Path) -> list[dict]:
    """
    Download all files from a dataroom folder (recursively).
    Returns list of {filename, rel_path, local_path, mime_type, success}.
    """
    folder_id = extract_folder_id(folder_url)
    all_files = list_files_recursive(service, folder_id)

    results = []
    for f in all_files:
        # Preserve subfolder structure locally
        local_path = dest_dir / f["rel_path"]
        local_path.parent.mkdir(parents=True, exist_ok=True)

        success = download_file(service, f["id"], f["mimeType"], local_path)

        results.append({
            "filename":   f["name"],
            "rel_path":   f["rel_path"],
            "local_path": str(local_path),
            "mime_type":  f["mimeType"],
            "success":    success,
        })

    return results


def upload_report(service, local_path: str, company_name: str) -> str:
    """
    Upload finished DD report to Drive under DD Reports/[company_name]/.
    Returns shareable link.
    """
    # Find or create DD Reports folder
    query = f"name='{GDRIVE_DD_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    results = service.files().list(q=query, fields="files(id)").execute()
    folders = results.get("files", [])

    if folders:
        reports_id = folders[0]["id"]
    else:
        meta = {"name": GDRIVE_DD_FOLDER, "mimeType": "application/vnd.google-apps.folder"}
        reports_id = service.files().create(body=meta, fields="id").execute()["id"]

    # Find or create company subfolder
    query2 = f"name='{company_name}' and '{reports_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
    results2 = service.files().list(q=query2, fields="files(id)").execute()
    folders2 = results2.get("files", [])

    if folders2:
        company_id = folders2[0]["id"]
    else:
        meta2 = {"name": company_name, "mimeType": "application/vnd.google-apps.folder", "parents": [reports_id]}
        company_id = service.files().create(body=meta2, fields="id").execute()["id"]

    # Upload file
    file_name = Path(local_path).name
    mime = "application/pdf" if local_path.endswith(".pdf") else "text/html"
    media = MediaFileUpload(local_path, mimetype=mime)

    # Check if already exists — update if so
    query3 = f"name='{file_name}' and '{company_id}' in parents and trashed=false"
    existing = service.files().list(q=query3, fields="files(id)").execute().get("files", [])

    if existing:
        service.files().update(fileId=existing[0]["id"], media_body=media).execute()
        file_id = existing[0]["id"]
    else:
        meta3 = {"name": file_name, "parents": [company_id]}
        file_id = service.files().create(body=meta3, media_body=media, fields="id").execute()["id"]

    service.permissions().create(
        fileId=file_id,
        body={"type": "anyone", "role": "reader"}
    ).execute()

    return f"https://drive.google.com/file/d/{file_id}/view"
