"""AI Service Pydantic Settings."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class AIServiceSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)

    app_name: str = "BAMUL AI Service"
    app_env: str = "development"
    debug: bool = False

    # Internal token — validates requests from App API only (VPC ALB)
    internal_token: str = "CHANGE_ME_IN_PRODUCTION"  # noqa: S105

    # FAISS index
    faiss_index_path: str = "/tmp/bamul_faiss.index"  # noqa: S108
    faiss_flat_threshold: int = 10_000  # switch to IVFFlat at this many embeddings
    faiss_nlist: int = 100  # IVFFlat nlist parameter

    # Model
    model_path: str = "models/muzzle_model.pt"
    model_version: str = "v1.0.0"
    embedding_dim: int = 512

    # AWS S3 — index persistence
    aws_region: str = "ap-south-1"
    aws_s3_bucket_name: str = "bamul-dev-faiss"

    # Match thresholds
    match_high_confidence_threshold: float = 0.95
    match_medium_confidence_threshold: float = 0.80

    # SLA
    match_sla_seconds: float = 3.0


@lru_cache
def get_ai_settings() -> AIServiceSettings:
    return AIServiceSettings()
