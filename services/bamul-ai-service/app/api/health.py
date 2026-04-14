"""GET /health — AI service readiness.

ECS health check gates on FAISS index loaded.
Returns {"status": "ready"} only after FAISS index fully loaded.
Returns {"status": "starting"} while index is loading.
Architecture ref: D21 — FAISS Cold-Start Strategy
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()

# Set to True by FAISS index loader in app/core/index.py (Epic 2, Story 2.7)
_faiss_index_ready: bool = False


def set_faiss_ready(ready: bool) -> None:  # called from lifespan
    global _faiss_index_ready  # noqa: PLW0603
    _faiss_index_ready = ready


@router.get("/health", tags=["ops"])
async def health() -> JSONResponse:
    status = "ready" if _faiss_index_ready else "starting"
    http_status = 200 if _faiss_index_ready else 503
    return JSONResponse(status_code=http_status, content={"status": status, "service": "bamul-ai-service"})
