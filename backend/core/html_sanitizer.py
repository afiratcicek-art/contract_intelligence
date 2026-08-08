"""Allow-list HTML sanitization for authored body_html.

Client-side TipTap/DOMPurify is NOT trusted — every body_html write
must pass through sanitize_body_html on the server.
"""
import re
from typing import Optional

import bleach

from backend.core.sanitizer import LIMITS

ALLOWED_TAGS = [
    "p", "br", "strong", "em", "u", "s", "b", "i",
    "h1", "h2", "h3", "h4",
    "ul", "ol", "li",
    "blockquote", "hr",
    "span",
    "table", "thead", "tbody", "tr", "td", "th",
    "a",
]

ALLOWED_ATTRIBUTES = {
    "a": ["href"],
    "td": ["colspan", "rowspan"],
    "th": ["colspan", "rowspan"],
    "span": ["class"],
    "p": ["class"],
    "h1": ["class"],
    "h2": ["class"],
    "h3": ["class"],
    "h4": ["class"],
}

ALLOWED_PROTOCOLS = ["http", "https", "mailto"]

# Mirrors RichTextEditor ALLOWED_CLASSES (font-size, align, indent)
_ALLOWED_CLASSES = frozenset({
    "text-fs-11",
    "text-fs-12",
    "text-fs-14",
    "text-fs-16",
    "text-fs-18",
    "text-align-left",
    "text-align-center",
    "text-align-right",
    "text-align-justify",
    "indent-1",
    "indent-2",
    "indent-3",
    "indent-4",
    "clauseiq-references",
})

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
_CLASS_ATTR = re.compile(
    r'(<(?:span|p|h1|h2|h3|h4)\b[^>]*\bclass\s*=\s*)([\'"])([^\'"]*)\2',
    re.IGNORECASE,
)


def _filter_allowed_classes(html: str) -> str:
    """Keep only allow-listed classes on span/p/heading elements."""

    def repl(match: re.Match[str]) -> str:
        prefix, quote, classes = match.group(1), match.group(2), match.group(3)
        kept = [c for c in classes.split() if c in _ALLOWED_CLASSES]
        if not kept:
            return ""
        return f"{prefix}{quote}{' '.join(kept)}{quote}"

    return _CLASS_ATTR.sub(repl, html)


def sanitize_body_html(value: Optional[str]) -> str:
    """Strip script/style/iframe/event handlers/javascript: from body HTML."""
    if value is None:
        return ""
    cleaned = _FORBIDDEN_BLOCKS.sub("", value)
    cleaned = _FORBIDDEN_SELF.sub("", cleaned)
    cleaned = _EVENT_ATTR.sub("", cleaned)
    # javascript: hrefs are dropped by bleach protocols (do not strip the
    # scheme prefix alone — that left href="alert(1)" as a relative URL).
    cleaned = bleach.clean(
        cleaned,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
    )
    cleaned = _filter_allowed_classes(cleaned)
    if len(cleaned) > LIMITS["content"]:
        cut = cleaned[: LIMITS["content"]]
        # Prefer ending after a complete tag — avoid mid-tag truncate (TB-36).
        last_gt = cut.rfind(">")
        if last_gt >= LIMITS["content"] // 2:
            cut = cut[: last_gt + 1]
        cleaned = cut
    return cleaned
