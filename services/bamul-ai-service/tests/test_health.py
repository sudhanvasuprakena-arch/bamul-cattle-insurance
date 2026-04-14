"""Smoke tests for AI Service health endpoint.

Architecture ref: D21 — FAISS Cold-Start Strategy
/health returns {"status": "ready"} only after FAISS index loaded.
In development mode, FAISS is skipped and service reports ready immediately.
"""

from app.api.health import set_faiss_ready


def test_health_endpoint_returns_200_in_dev_mode(client) -> None:
    """In development mode (APP_ENV=development), service is immediately ready."""
    response = client.get("/health")
    assert response.status_code == 200


def test_health_endpoint_returns_status_field(client) -> None:
    response = client.get("/health")
    body = response.json()
    assert "status" in body


def test_health_endpoint_identifies_service(client) -> None:
    response = client.get("/health")
    body = response.json()
    assert body["service"] == "bamul-ai-service"


def test_health_returns_503_when_faiss_not_loaded(client) -> None:
    """When FAISS index is not ready, /health returns 503 — ECS gates on this."""
    set_faiss_ready(False)
    response = client.get("/health")
    assert response.status_code == 503
    assert response.json()["status"] == "starting"
    # restore for other tests
    set_faiss_ready(True)


def test_health_returns_200_when_faiss_ready(client) -> None:
    set_faiss_ready(True)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"


def test_embed_endpoint_returns_501_not_implemented(client) -> None:
    """Embedding endpoint is a stub until Epic 2 Story 2.7."""
    response = client.post("/api/v1/embed")
    assert response.status_code == 501


def test_match_endpoint_returns_501_not_implemented(client) -> None:
    """Match endpoint is a stub until Epic 5 Story 5.1."""
    response = client.post("/api/v1/match")
    assert response.status_code == 501
