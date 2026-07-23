"""PDF render provider interface — Null default; Gotenberg optional via config."""
import logging
from typing import Optional, Protocol

import httpx

from backend.core.config import settings

logger = logging.getLogger(__name__)


class RenderProvider(Protocol):
    def render_to_pdf(self, docx_bytes: bytes) -> Optional[bytes]:
        ...


class NullRenderProvider:
    """No render backend deployed yet (no docker-compose in repo).
    Returns None -> API responds 'preview unavailable, download the .docx'.
    Gotenberg (self-hosted, network-isolated, no egress, in-region) plugs in here
    as a second implementation once deployment is decided; callers never change.
    """

    def render_to_pdf(self, docx_bytes: bytes) -> Optional[bytes]:
        return None


class GotenbergRenderProvider:
    """LibreOffice convert via Gotenberg HTTP API.

    PROD REQUIREMENTS (infra concern, not enforced here):
    self-hosted IN-REGION, network-isolated with NO EGRESS, behind basic-auth,
    resource-limited, never reachable by the user directly. Only ever converts
    docx WE built from a clean base — never user uploads. Do NOT use Gotenberg's
    S3/webhook features for sensitive documents.
    """

    def __init__(self, base_url: str) -> None:
        self._base_url = base_url.rstrip("/")

    def render_to_pdf(self, docx_bytes: bytes) -> Optional[bytes]:
        url = f"{self._base_url}/forms/libreoffice/convert"
        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.post(
                    url,
                    files={
                        "files": (
                            "document.docx",
                            docx_bytes,
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        )
                    },
                )
            if response.status_code != 200:
                logger.warning(
                    "Gotenberg render failed: status %s", response.status_code
                )
                return None
            return response.content
        except Exception as exc:
            logger.warning("Gotenberg render failed: %s", exc, exc_info=True)
            return None


def get_render_provider() -> RenderProvider:
    """Config-selected provider; default Null until RENDER_PROVIDER=gotenberg."""
    if settings.RENDER_PROVIDER.lower() == "gotenberg":
        return GotenbergRenderProvider(settings.GOTENBERG_URL)
    return NullRenderProvider()
