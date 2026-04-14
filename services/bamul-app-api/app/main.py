"""BAMUL App API — FastAPI application factory.

Architecture refs:
- D9: API versioning — all routes under /api/v1/
- D10: RFC 7807 error format — BAMULError handler registered here
- Structured logging: structlog JSON configured at startup
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.exceptions import BAMULError, bamul_error_handler

# Configure structlog — JSON in all environments
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.BoundLogger,
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
)

log = structlog.get_logger()
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan — startup and shutdown hooks."""
    log.info("bamul_app_api.starting", env=settings.app_env)
    # Story 1.3: connect to Redis, warm JWT key
    # Story 1.4: run Alembic migrations check
    yield
    log.info("bamul_app_api.shutdown")


def create_app() -> FastAPI:
    app = FastAPI(
        title="BAMUL App API",
        version="1.0.0",
        docs_url="/api/docs" if settings.debug else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    # CORS — restrictive in production; open in development
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if settings.app_env == "development" else [],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # RFC 7807 error handler — registered for all routes
    app.add_exception_handler(BAMULError, bamul_error_handler)  # type: ignore[arg-type]

    # Health endpoint — no auth required; used by ECS health check
    @app.get("/health", tags=["ops"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "bamul-app-api"}

    # API v1 routers registered here as features are built (Epic 2+)
    # from app.api.v1 import auth_router, enrollment_router
    # app.include_router(auth_router, prefix="/api/v1")

    return app


app = create_app()
