"""
api/routes/config.py — serves team.json to the frontend.

GET /config  — public (no auth required), returns the team configuration.
"""
import json
import os
from fastapi import APIRouter, HTTPException

router = APIRouter()

_CONFIG_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "config", "team.json"
)


@router.get("/")
def get_config():
    try:
        with open(_CONFIG_PATH) as f:
            return json.load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="team.json not found — run install.sh")
