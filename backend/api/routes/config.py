import json
import os
from ninja import Router
from ninja.errors import HttpError

router = Router()

_CONFIG_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "config", "team.json"
)


@router.get("/")
def get_config(request):
    try:
        with open(_CONFIG_PATH) as f:
            return json.load(f)
    except FileNotFoundError:
        raise HttpError(500, "team.json not found — run install.sh")
