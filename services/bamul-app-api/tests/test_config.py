"""Tests for Pydantic Settings configuration loading."""

from app.core.config import Settings, get_settings


def test_pydantic_settings_loads_with_defaults() -> None:
    """Settings loads successfully with default values — no .env required."""
    settings = Settings()
    assert settings.app_name == "BAMUL App API"
    assert settings.jwt_algorithm == "HS256"
    assert settings.jwt_access_token_expire_minutes == 480
    assert settings.aws_region == "ap-south-1"


def test_settings_enforces_ap_south_1_region() -> None:
    """AWS region must always be ap-south-1 by default — DPDP Act requirement."""
    settings = Settings()
    assert settings.aws_region == "ap-south-1"


def test_get_settings_returns_cached_instance() -> None:
    """get_settings() is cached via lru_cache — same instance returned."""
    s1 = get_settings()
    s2 = get_settings()
    assert s1 is s2
