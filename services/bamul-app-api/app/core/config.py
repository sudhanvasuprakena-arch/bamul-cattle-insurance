"""Pydantic Settings — all env vars typed. Loaded once at startup via get_settings().

Architecture ref: D20 — Environment Configuration
All secrets loaded from AWS Secrets Manager in staging/production.
Local development uses .env file (gitignored).
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Application
    app_name: str = "BAMUL App API"
    app_env: str = "development"  # development | staging | production
    debug: bool = False

    # Database — AWS RDS PostgreSQL (ap-south-1)
    database_url: str = "postgresql+asyncpg://bamul:bamul_dev_secret@localhost:5432/bamul_dev"

    # Redis — AWS ElastiCache (ap-south-1)
    redis_url: str = "redis://localhost:6379"

    # JWT — loaded from AWS Secrets Manager in staging/production
    jwt_secret_key: str = "CHANGE_ME_IN_PRODUCTION"  # noqa: S105
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 480  # 8 hours
    jwt_refresh_token_expire_days: int = 30

    # AI Service — internal VPC ALB (not public)
    ai_service_base_url: str = "http://localhost:8001"
    ai_service_internal_token: str = "CHANGE_ME_IN_PRODUCTION"  # noqa: S105

    # AWS
    aws_region: str = "ap-south-1"
    aws_s3_bucket_name: str = "bamul-dev-photos"
    aws_sqs_embedding_queue_url: str = ""
    aws_sqs_match_queue_url: str = ""

    # UIDAI AUA eKYC
    uidai_aua_code: str = ""
    uidai_aua_licence_key: str = ""

    # WhatsApp Business API
    whatsapp_api_key: str = ""
    whatsapp_phone_number_id: str = ""

    # SMS Gateway
    sms_gateway_api_key: str = ""

    # Firebase FCM
    fcm_server_key: str = ""


@lru_cache
def get_settings() -> Settings:
    """Return cached Settings instance. Use as FastAPI dependency."""
    return Settings()
