"""Tests for RFC 7807 Problem Details error format.

Architecture ref: D10 — Error Response Format
"""

import pytest
from app.core.exceptions import (
    BAMULError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
    bamul_error_handler,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def error_test_app() -> TestClient:
    """Minimal FastAPI app with a route that raises BAMULError."""
    test_app = FastAPI()
    test_app.add_exception_handler(BAMULError, bamul_error_handler)

    @test_app.get("/test/not-found")
    async def raise_not_found():
        raise NotFoundError(resource="enrollment", identifier="UAID-999")

    @test_app.get("/test/conflict")
    async def raise_conflict():
        raise ConflictError(
            type_="enrollment/duplicate-ear-tag",
            title="Ear tag already registered",
            detail="Tag ID KA-2026-004821 is already bound to UAID BA-2026-KA-003312",
        )

    @test_app.get("/test/unauthorized")
    async def raise_unauthorized():
        raise UnauthorizedError()

    @test_app.get("/test/forbidden")
    async def raise_forbidden():
        raise ForbiddenError()

    return TestClient(test_app)


def test_not_found_error_returns_rfc7807_format(error_test_app) -> None:
    response = error_test_app.get("/test/not-found")
    assert response.status_code == 404
    body = response.json()
    assert body["type"] == "enrollment/not-found"
    assert body["status"] == 404
    assert "title" in body
    assert "detail" in body
    assert "instance" in body


def test_conflict_error_returns_409_with_type(error_test_app) -> None:
    response = error_test_app.get("/test/conflict")
    assert response.status_code == 409
    body = response.json()
    assert body["type"] == "enrollment/duplicate-ear-tag"
    assert body["status"] == 409


def test_unauthorized_error_returns_401(error_test_app) -> None:
    response = error_test_app.get("/test/unauthorized")
    assert response.status_code == 401


def test_forbidden_error_returns_403(error_test_app) -> None:
    response = error_test_app.get("/test/forbidden")
    assert response.status_code == 403


def test_rfc7807_response_never_contains_stack_trace(error_test_app) -> None:
    response = error_test_app.get("/test/not-found")
    body = response.json()
    assert "traceback" not in body
    assert "stacktrace" not in body
    assert "exception" not in body
