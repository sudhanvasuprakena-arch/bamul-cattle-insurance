"""BAMUL AI Service — FastAPI application factory.

Serves muzzle biometric embedding generation and ANN similarity search.
Accessible only on internal VPC ALB — not public-facing.
Architecture ref: D6 — Service-to-Service Auth (HMAC + X-Internal-Token header)
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from app.api.embed import router as embed_router
from app.api.health import router as health_router
from app.api.health import set_faiss_ready
from app.api.match import router as match_router
from app.core.config import get_ai_settings

structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.BoundLogger,
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
)

log = structlog.get_logger()
settings = get_ai_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    log.info("bamul_ai_service.starting", env=settings.app_env)
    # Story 2.7: load FAISS index from S3, set_faiss_ready(True)
    # For now, mark ready immediately so /health returns 200 in local dev
    if settings.app_env == "development":
        set_faiss_ready(True)
        log.info("bamul_ai_service.faiss_skipped_dev_mode")
    yield
    log.info("bamul_ai_service.shutdown")


def create_app() -> FastAPI:
    app = FastAPI(
        title="BAMUL AI Service",
        version="1.0.0",
        docs_url="/api/docs" if settings.debug else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    app.include_router(health_router)
    app.include_router(embed_router, prefix="/api/v1")
    app.include_router(match_router, prefix="/api/v1")

    return app


app = create_app()
