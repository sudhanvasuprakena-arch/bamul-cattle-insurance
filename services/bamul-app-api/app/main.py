"""BAMUL App API — FastAPI application factory.

Architecture refs:
- D9: API versioning — all routes under /api/v1/
- D10: RFC 7807 error format — BAMULError handler registered here
- Structured logging: structlog JSON configured at startup
- Story 1.3: startup migration check — fails fast if pending migrations exist
"""

from __future__ import annotations

import pathlib
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import structlog
from alembic.config import Config as AlembicConfig
from alembic.script import ScriptDirectory
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from app.core.config import get_settings
from app.core.database import engine
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

# Resolve alembic.ini path relative to this file — works in Docker (/app) and local dev
_ALEMBIC_INI = pathlib.Path(__file__).parent.parent / "alembic.ini"


async def _check_migrations() -> None:
    """Fail fast if any pending Alembic migrations exist.

    Three states handled:
    - Fresh DB (no alembic_version table): allow startup — local dev scenario
    - All migrations applied (head): allow startup — normal state
    - Partial migrations (some applied, some pending): FAIL with clear log

    Migrations are NEVER auto-applied here. Run 'alembic upgrade head'
    explicitly via CI/CD or locally before starting the service.
    """
    async with engine.connect() as conn:
        # Check if alembic_version table exists (absent on a fresh/empty database)
        has_alembic_table = await conn.run_sync(
            lambda sync_conn: inspect(sync_conn).has_table("alembic_version")
        )

        if not has_alembic_table:
            log.info(
                "bamul_app_api.migration_check_skipped",
                reason="alembic_version table not found — fresh database, no migrations applied",
            )
            return

        # Read current applied revision heads
        result = await conn.execute(text("SELECT version_num FROM alembic_version"))
        current_heads = {row[0] for row in result.fetchall()}

    # Read expected heads from the script directory (no DB connection needed)
    alembic_cfg = AlembicConfig(str(_ALEMBIC_INI))
    script = ScriptDirectory.from_config(alembic_cfg)
    expected_heads = set(script.get_heads())

    if not current_heads:
        # alembic_version table exists but is empty — treat as fresh DB
        log.info(
            "bamul_app_api.migration_check_skipped",
            reason="alembic_version table is empty — no migrations applied",
        )
        return

    if current_heads != expected_heads:
        pending = expected_heads - current_heads
        log.error(
            "bamul_app_api.migration_check_failed",
            current_heads=sorted(current_heads),
            expected_heads=sorted(expected_heads),
            pending_revisions=sorted(pending),
        )
        raise RuntimeError(
            f"Pending Alembic migrations detected: {sorted(pending)}. "
            "Run 'alembic upgrade head' before starting the service. "
            "Migrations are never auto-applied in production."
        )

    log.info(
        "bamul_app_api.migration_check_passed",
        applied_heads=sorted(current_heads),
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan — startup and shutdown hooks."""
    log.info("bamul_app_api.starting", env=settings.app_env)
    await _check_migrations()
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
