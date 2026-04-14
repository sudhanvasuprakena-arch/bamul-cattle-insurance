"""POST /embed — generate muzzle embedding from image.

Full implementation in Epic 2, Story 2.7.
Returns 501 until model is loaded and preprocessing pipeline is implemented.
Architecture ref: ARCH16, ARCH17
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()


@router.post("/embed", tags=["biometric"])
async def generate_embedding() -> JSONResponse:
    """Generate muzzle biometric embedding from submitted image.

    Preprocessing pipeline: grayscale → hist-eq → crop → 224×224 → denoise
    Model: PyTorch CNN → 512-dim embedding vector
    Implementation: Epic 2, Story 2.7
    """
    return JSONResponse(status_code=501, content={"detail": "Not implemented — see Epic 2 Story 2.7"})
