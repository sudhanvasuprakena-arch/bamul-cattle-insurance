"""SQLAlchemy ORM models for the 'compliance' schema domain.

Domain: DPDP consent log, UIDAI authentication log, audit trail.
Tables defined in later stories: consent_log, uidai_auth_log, audit_logs (Story 1.7+)

Architecture refs:
- D4: Audit Log — PARTITION BY RANGE(created_at) monthly; cryptographic hash chain
  event_hash = SHA-256(prev_event_hash || actor_id || action || payload_json || created_at_iso8601)
- D8: compliance.consent_log — App API INSERT-only; no UPDATE/DELETE grant to bamul_app
- DPDP Act 2023: consent log is immutable; separately retained from policy record
- IRDAI: 5-year retention; archived to S3 Glacier via lifecycle policy (Story 1.2)

Special grants for compliance schema (enforced in baseline migration):
- bamul_app has INSERT-only on consent_log — NOT UPDATE or DELETE
- This is enforced at DB user grant level, not just application level

Partitioned table naming: audit_logs_y{year}_m{month} (e.g., audit_logs_y2026_m04)
"""

from app.core.database import Base  # noqa: F401 — imported so Alembic tracks this schema

__all__: list[str] = []
