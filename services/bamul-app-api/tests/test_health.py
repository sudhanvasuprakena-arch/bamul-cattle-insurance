"""Smoke tests for App API health endpoint.

Test naming: test_{function}_{scenario}_{expected_outcome}
Architecture ref: naming conventions — Python Test Functions
"""


def test_health_endpoint_returns_200(client) -> None:
    response = client.get("/health")
    assert response.status_code == 200


def test_health_endpoint_returns_ok_status(client) -> None:
    response = client.get("/health")
    body = response.json()
    assert body["status"] == "ok"


def test_health_endpoint_identifies_service(client) -> None:
    response = client.get("/health")
    body = response.json()
    assert body["service"] == "bamul-app-api"
