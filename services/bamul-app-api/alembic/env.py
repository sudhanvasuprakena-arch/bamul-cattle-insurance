"""Alembic migration environment.

Architecture ref: D1 — SQLAlchemy 2.x (async) + Alembic
Uses async runner (asyncpg) to match the app's async SQLAlchemy engine.
DATABASE_URL is read from the environment — never hardcoded.
"""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy.pool import NullPool

# Alembic Config object — provides access to alembic.ini values
config = context.config

# Logging — set up from alembic.ini [loggers] section
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override sqlalchemy.url from environment — never rely on alembic.ini default.
# Local dev: set DATABASE_URL in .env or export before running alembic commands.
# Staging/Prod: injected by ECS task definition from Secrets Manager.
_db_url = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://bamul:bamul_dev_secret@localhost:5432/bamul_dev",
)
config.set_main_option("sqlalchemy.url", _db_url)

# Import all model modules so Alembic autogenerate can detect table changes.
# Each model file registers its tables with Base.metadata on import.
# noqa: E402 — these imports must come after config.set_main_option (Alembic env.py convention)
import app.models  # noqa: E402, F401
from app.core.database import Base  # noqa: E402

target_metadata = Base.metadata


def do_run_migrations(connection) -> None:  # type: ignore[type-arg]
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Online migration runner using asyncpg (matches app's async engine)."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=NullPool,  # no pooling during migrations — each run is short-lived
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_offline() -> None:
    """Generate SQL script without DB connection (used for review / dry-run)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Apply migrations against a live database."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
