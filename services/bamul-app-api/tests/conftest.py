"""Pytest configuration and fixtures for BAMUL App API tests."""

from unittest.mock import AsyncMock, patch

import pytest
from app.main import app
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client() -> TestClient:
    """FastAPI TestClient — no real DB or Redis needed for unit tests.

    Patches _check_migrations so the lifespan can complete without a live
    Postgres connection. Integration tests that need a real DB should spin
    up the testcontainer or use docker compose directly (Story 1.3 Task 5).
    """
    with patch("app.main._check_migrations", new_callable=AsyncMock), TestClient(app) as c:
        yield c
