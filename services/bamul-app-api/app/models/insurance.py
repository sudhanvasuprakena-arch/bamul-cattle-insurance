"""SQLAlchemy ORM models for the 'insurance' schema domain.

Domain: Policies, enrollment records, cattle tagging, claim records.
Tables defined in later stories: policies, enrollments, cattle, claims (Story 2+)

Architecture refs:
- D16: ECS Fargate — App API owns insurance schema reads/writes
- D12: Pagination — cursor-based on (created_at, id) for claim/enrollment queues

Mandatory column patterns — see identity.py for full reference.
Key insurance-domain rules:
- All monetary values in BIGINT (paise): sum_insured_paise, premium_amount_paise
- Enrollment status column: enrollment_status (suffix _status convention)
- Claim state column: claim_state (suffix _state convention)
- Composite index on claims: idx_claims_confidence_state_created_at
- Composite index on assignments: idx_assignments_assigned_fo_id_status
"""

from app.core.database import Base  # noqa: F401 — imported so Alembic tracks this schema

__all__: list[str] = []
