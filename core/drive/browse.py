"""
core/drive/browse.py — Shared Google Drive browse helpers.

Used by both the team ingest route and the per-user terminal route.
"""

# Google-native files must be exported to a downloadable Office format.
EXPORT_MIME = {
    "application/vnd.google-apps.document":     ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"),
    "application/vnd.google-apps.spreadsheet":  ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",      ".xlsx"),
    "application/vnd.google-apps.presentation": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"),
}


def build_tree(svc, folder_id: str, depth: int = 0, max_depth: int = 3) -> dict:
    """Recursively list a Drive folder. Returns {folders: [...], files: [...]}."""
    if depth > max_depth:
        return {"folders": [], "files": [], "truncated": True}

    folders, files = [], []
    page_token = None
    while True:
        resp = svc.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            fields="nextPageToken, files(id, name, mimeType, size, modifiedTime)",
            orderBy="name",
            pageSize=200,
            pageToken=page_token,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()

        for item in resp.get("files", []):
            if item["mimeType"] == "application/vnd.google-apps.folder":
                folders.append({
                    "id": item["id"],
                    "name": item["name"],
                    "children": build_tree(svc, item["id"], depth + 1, max_depth),
                })
            else:
                files.append({
                    "id": item["id"],
                    "name": item["name"],
                    "mimeType": item["mimeType"],
                    "size": item.get("size"),
                    "modifiedTime": item.get("modifiedTime"),
                })

        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    return {"folders": folders, "files": files}
