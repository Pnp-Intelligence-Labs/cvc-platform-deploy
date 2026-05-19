"""
Plugin loader — discovers and mounts installed plugins at API startup.

Scans plugins/installed/<slug>/ directories. Each must have:
  - manifest.json  (slug, name, version, routes.prefix, routes.tag)
  - routes.py      (exports a FastAPI APIRouter named `router`)

Plugins are loaded in alphabetical order by slug.
Import errors are logged but do not crash the server.
"""
import importlib.util
import json
import logging
import os
import sys
from pathlib import Path
from typing import List

from fastapi import FastAPI, Depends

logger = logging.getLogger(__name__)

_PLUGINS_DIR = Path(__file__).resolve().parents[1] / "plugins" / "installed"

_loaded_plugins: List[dict] = []


def _load_manifest(plugin_dir: Path) -> dict | None:
    manifest_path = plugin_dir / "manifest.json"
    if not manifest_path.exists():
        logger.warning("Plugin %s missing manifest.json — skipping", plugin_dir.name)
        return None
    try:
        manifest = json.loads(manifest_path.read_text())
        required = {"slug", "name", "version", "routes"}
        missing = required - manifest.keys()
        if missing:
            logger.warning("Plugin %s manifest missing keys %s — skipping", plugin_dir.name, missing)
            return None
        if "prefix" not in manifest["routes"] or "tag" not in manifest["routes"]:
            logger.warning("Plugin %s manifest.routes missing prefix/tag — skipping", plugin_dir.name)
            return None
        return manifest
    except Exception as e:
        logger.warning("Plugin %s manifest.json invalid: %s — skipping", plugin_dir.name, e)
        return None


def _load_router(plugin_dir: Path, slug: str):
    routes_path = plugin_dir / "routes.py"
    if not routes_path.exists():
        logger.warning("Plugin %s missing routes.py — skipping", slug)
        return None
    try:
        module_name = f"_plugin_{slug.replace('-', '_')}"
        spec = importlib.util.spec_from_file_location(module_name, routes_path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        router = getattr(module, "router", None)
        if router is None:
            logger.warning("Plugin %s routes.py has no `router` export — skipping", slug)
            return None
        return router
    except Exception as e:
        logger.error("Plugin %s routes.py failed to import: %s — skipping", slug, e)
        return None


def load_plugins(app: FastAPI, require_auth) -> List[dict]:
    """Scan plugins/installed/, mount valid plugins into the FastAPI app.

    Returns list of loaded plugin manifests (for /config/plugins endpoint).
    Called once at startup from main.py.
    """
    global _loaded_plugins
    _loaded_plugins = []

    if not _PLUGINS_DIR.exists():
        return _loaded_plugins

    plugin_dirs = sorted(
        [d for d in _PLUGINS_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")],
        key=lambda d: d.name,
    )

    for plugin_dir in plugin_dirs:
        slug = plugin_dir.name
        manifest = _load_manifest(plugin_dir)
        if not manifest:
            continue

        router = _load_router(plugin_dir, slug)
        if not router:
            continue

        prefix = manifest["routes"]["prefix"]
        tag = manifest["routes"]["tag"]
        try:
            app.include_router(
                router,
                prefix=prefix,
                tags=[tag],
                dependencies=[Depends(require_auth)],
            )
            _loaded_plugins.append({
                "slug":    manifest["slug"],
                "name":    manifest["name"],
                "version": manifest["version"],
                "prefix":  prefix,
                "nav":     manifest.get("nav"),
                "requires_tables": manifest.get("requires_tables", []),
            })
            logger.info("Plugin loaded: %s v%s at %s", manifest["name"], manifest["version"], prefix)
        except Exception as e:
            logger.error("Plugin %s failed to mount: %s", slug, e)

    return _loaded_plugins


def get_loaded_plugins() -> List[dict]:
    """Return the list of successfully loaded plugin manifests."""
    return _loaded_plugins
