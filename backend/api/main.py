from ninja import NinjaAPI
from api.routes.config import router as config_router

api = NinjaAPI(title="Platform API", version="0.1.0")

api.add_router("/config", config_router)
