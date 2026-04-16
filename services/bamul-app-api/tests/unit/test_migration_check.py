"""Unit tests for the startup migration check (_check_migrations).

Tests cover the three states described in Story 1.3 AC 5:
  1. Fresh DB (no alembic_version table) — startup allowed
  2. All migrations applied (at head) — startup allowed
  3. Pending migrations exist — RuntimeError raised with clear message

All tests use AsyncMock / MagicMock to avoid a real DB connection.
Integration-level verification (actual alembic upgrade head) is covered
in the Task 5 local verification steps.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.main import _check_migrations, app
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_conn_ctx(*, has_table: bool, current_heads: list[str]):
    """Build a mock async connection context manager."""
    mock_inspect = MagicMock()
    mock_inspect.has_table.return_value = has_table

    async def _run_sync(fn, *args, **kwargs):  # type: ignore[no-untyped-def]
        return fn(mock_inspect)

    mock_result = MagicMock()
    mock_result.fetchall.return_value = [(h,) for h in current_heads]

    mock_conn = AsyncMock()
    mock_conn.run_sync = _run_sync
    mock_conn.execute = AsyncMock(return_value=mock_result)

    mock_engine = MagicMock()
    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)
    mock_engine.connect.return_value = mock_ctx

    return mock_engine


def _patch_script_dir(expected_heads: list[str]) -> MagicMock:
    """Return a patched ScriptDirectory class with given expected heads."""
    mock_script = MagicMock()
    mock_script.get_heads.return_value = expected_heads
    mock_cls = MagicMock()
    mock_cls.from_config.return_value = mock_script
    return mock_cls


# ---------------------------------------------------------------------------
# Fresh DB tests
# ---------------------------------------------------------------------------


class TestMigrationCheckFreshDb:
    """Fresh database — no alembic_version table present."""

    @pytest.mark.asyncio
    async def test_allows_startup_when_no_alembic_version_table(self):
        """Service must start successfully when alembic_version does not exist."""
        mock_engine = _make_conn_ctx(has_table=False, current_heads=[])

        with patch("app.main.engine", mock_engine):
            await _check_migrations()  # must NOT raise

    @pytest.mark.asyncio
    async def test_allows_startup_when_alembic_version_table_is_empty(self):
        """Service must start when alembic_version table exists but has no rows."""
        mock_engine = _make_conn_ctx(has_table=True, current_heads=[])
        mock_sd = _patch_script_dir(["a1b2c3d4e5f6"])

        with (
            patch("app.main.engine", mock_engine),
            patch("app.main.ScriptDirectory", mock_sd),
        ):
            await _check_migrations()  # must NOT raise


# ---------------------------------------------------------------------------
# At-head tests
# ---------------------------------------------------------------------------


class TestMigrationCheckAtHead:
    """All migrations applied — service should start normally."""

    @pytest.mark.asyncio
    async def test_allows_startup_when_at_head(self):
        """Service starts when current revision == expected head."""
        revision = "a1b2c3d4e5f6"
        mock_engine = _make_conn_ctx(has_table=True, current_heads=[revision])
        mock_sd = _patch_script_dir([revision])

        with (
            patch("app.main.engine", mock_engine),
            patch("app.main.ScriptDirectory", mock_sd),
        ):
            await _check_migrations()  # must NOT raise

    @pytest.mark.asyncio
    async def test_allows_startup_with_multiple_heads_all_applied(self):
        """Service starts when all branches in a multi-head setup are applied."""
        heads = ["aabbccdd1234", "eeff56781234"]
        mock_engine = _make_conn_ctx(has_table=True, current_heads=heads)
        mock_sd = _patch_script_dir(heads)

        with (
            patch("app.main.engine", mock_engine),
            patch("app.main.ScriptDirectory", mock_sd),
        ):
            await _check_migrations()  # must NOT raise


# ---------------------------------------------------------------------------
# Pending migration tests
# ---------------------------------------------------------------------------


class TestMigrationCheckPendingMigrations:
    """Pending migrations detected — service must refuse to start."""

    @pytest.mark.asyncio
    async def test_raises_runtime_error_when_pending_migration_exists(self):
        """RuntimeError is raised when DB is behind the expected head."""
        applied = "a1b2c3d4e5f6"
        pending = "b2c3d4e5f6a7"
        mock_engine = _make_conn_ctx(has_table=True, current_heads=[applied])
        mock_sd = _patch_script_dir([applied, pending])

        with (
            patch("app.main.engine", mock_engine),
            patch("app.main.ScriptDirectory", mock_sd),
            pytest.raises(RuntimeError) as exc_info,
        ):
            await _check_migrations()

        assert pending in str(exc_info.value)
        assert "alembic upgrade head" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_raises_when_partially_applied_multi_head(self):
        """RuntimeError is raised when only some branches of multi-head are applied."""
        applied = "aabbccdd1234"
        not_applied = "eeff56781234"
        mock_engine = _make_conn_ctx(has_table=True, current_heads=[applied])
        mock_sd = _patch_script_dir([applied, not_applied])

        with (
            patch("app.main.engine", mock_engine),
            patch("app.main.ScriptDirectory", mock_sd),
            pytest.raises(RuntimeError) as exc_info,
        ):
            await _check_migrations()

        assert not_applied in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_error_message_includes_upgrade_instruction(self):
        """Error message must guide the operator to the correct fix command."""
        applied = "a1b2c3d4e5f6"
        pending = "c3d4e5f6a7b8"
        mock_engine = _make_conn_ctx(has_table=True, current_heads=[applied])
        mock_sd = _patch_script_dir([applied, pending])

        with (
            patch("app.main.engine", mock_engine),
            patch("app.main.ScriptDirectory", mock_sd),
            pytest.raises(RuntimeError) as exc_info,
        ):
            await _check_migrations()

        msg = str(exc_info.value)
        assert "alembic upgrade head" in msg.lower()
        assert pending in msg


# ---------------------------------------------------------------------------
# Health endpoint regression guard
# ---------------------------------------------------------------------------


class TestHealthEndpoint:
    """Verify /health endpoint returns 200 (regression guard).

    Patches _check_migrations so the TestClient can start without a real DB.
    """

    def test_health_returns_200(self):
        with patch("app.main._check_migrations", new_callable=AsyncMock), TestClient(app) as client:
            response = client.get("/health")

        assert response.status_code == 200
        assert response.json() == {"status": "ok", "service": "bamul-app-api"}
