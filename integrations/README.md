# Integrations

Standalone connector apps — separate processes with their own OAuth flows,
not part of the main FastAPI API server.

## google-drive/

Standalone OAuth 2.0 connector for Google Drive. Handles the authorization
code flow and stores tokens so the main API can access Drive files on behalf
of users.

**Relation to `core/drive/`:** `core/drive/` is the runtime library used by
the API to browse and read files. This directory handles the initial OAuth
handshake and token storage that `core/drive/` depends on.
