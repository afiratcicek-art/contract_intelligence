"""PDF render provider interface — implementation deferred (no docker-compose).

Gotenberg (self-hosted, network-isolated, no egress, in-region) plugs in here
as a second implementation once deployment is decided; callers never change.
Do NOT add Gotenberg client code in Faz A/B.
"""
from typing import Optional, Protocol


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


def get_render_provider() -> RenderProvider:
    """Config-selected provider; default Null until a render backend exists."""
    return NullRenderProvider()
