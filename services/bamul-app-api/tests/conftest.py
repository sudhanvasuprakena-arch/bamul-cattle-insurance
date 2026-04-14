"""Pytest configuration and fixtures for BAMUL App API tests."""

import pytest
from app.main import app
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client() -> TestClient:
    """FastAPI TestClient — no real DB or Redis needed for unit tests."""
    with TestClient(app) as c:
        yield c
