"""SQLAlchemy ORM models for the 'biometric' schema domain.

Domain: Muzzle embedding vectors, model version tracking, FAISS index metadata.
Tables defined in Story 1.4: model_versions, embedding_store

Architecture refs:
- D8: biometric.embedding_store — AI Service ONLY; no App API access
  Access control layers:
    1. Network ACL: AI service SG → RDS SG (port 5432, private subnet)
    2. DB user: biometric_rw has USAGE on biometric schema only; denied all others
    3. Application: AI service never receives farmer PII from App API
- D21: FAISS cold-start — embedding_store is the source of truth for FAISS rebuild
- Architecture constraint: model_version column mandatory on every embedding record
  (model is retrained quarterly — cross-version search must remain possible)

CRITICAL: No App API code should ever import from this module or reference
biometric schema tables. All biometric reads/writes go through bamul-ai-service.
"""

from app.core.database import Base  # noqa: F401 — imported so Alembic tracks this schema

__all__: list[str] = []
