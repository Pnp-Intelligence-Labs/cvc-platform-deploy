# Deprecated: Django backend

This directory contains a parallel Django backend (port 8003) that was built during
an incremental migration phase.

**The primary backend is `api/` (FastAPI, port 8002).** All new features go there.

This Django backend is being phased out. Do not add features here. It exists only to
serve legacy routes during transition and will be removed once migration is complete.
