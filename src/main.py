import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.lms_integration import router as lms_router
from src.api.routes import router
from src.api.workspace import router as workspace_router
from src.config import get_settings
from src.db import initialize_database
from src.middleware import ProductionSecurityMiddleware
from src.services.sync_worker import poll_lms_events


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    initialize_database()
    stop_sync = asyncio.Event()
    sync_task = asyncio.create_task(poll_lms_events(settings, stop_sync))
    print(f"Starting {settings.app_name} in {settings.app_env} mode")
    yield
    stop_sync.set()
    await sync_task
    print("Shutting down...")


app = FastAPI(
    title="AI20K Agent",
    description="AI Agent built with LangGraph",
    version="1.0.0",
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(ProductionSecurityMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")
app.include_router(lms_router, prefix="/api/v1")
app.include_router(workspace_router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.app_env}
