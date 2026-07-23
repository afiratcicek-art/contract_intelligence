"""Allow-list HTML sanitization for authored body_html.

Client-side TipTap/DOMPurify is NOT trusted — every body_html write
must pass through sanitize_body_html on the server.
"""
import re
from typing import Optional

import bleach

from backend.core.sanitizer import LIMITS

ALLOWED_TAGS = [
    "p", "br", "strong", "em", "u",
    "h1", "h2", "h3", "h4",
    "ul", "ol", "li",
    "table", "thead", "tbody", "tr", "td", "th",
    "a",
]

ALLOWED_ATTRIBUTES = {
    "a": ["href"],
    "td": ["colspan", "rowspan"],
    "th": ["colspan", "rowspan"],
}

ALLOWED_PROTOCOLS = ["http", "https", "mailto"]

# Remove forbidden containers AND their contents before allow-list pass
_FORBIDDEN_BLOCKS = re.compile(
    r"<(script|style|iframe|object|embed|link|meta)\b[^>]*>[\s\S]*?</\1\s*>",
    re.IGNORECASE,
)
_FORBIDDEN_SELF = re.compile(
    r"<(script|style|iframe|object|embed|link|meta)\b[^>]*/?\s*>",
    re.IGNORECASE,
)
_EVENT_ATTR = re.compile(r"\son\w+\s*=\s*(['\"]).*?\1", re.IGNORECASE)
_JS_HREF = re.compile(r"javascript\s*:", re.IGNORECASE)


def sanitize_body_html(value: Optional[str]) -> str:
    """Strip script/style/iframe/event handlers/javascript: from body HTML."""
    if value is None:
        return ""
    cleaned = _FORBIDDEN_BLOCKS.sub("", value)
    cleaned = _FORBIDDEN_SELF.sub("", cleaned)
    cleaned = _EVENT_ATTR.sub("", cleaned)
    cleaned = _JS_HREF.sub("", cleaned)
    cleaned = bleach.clean(
        cleaned,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
    )
    if len(cleaned) > LIMITS["content"]:
        cleaned = cleaned[: LIMITS["content"]]
    return cleaned
