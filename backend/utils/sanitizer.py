"""Input temizleme ve prompt injection koruması."""
import re
import bleach
from fastapi import HTTPException

INJECTION_PATTERNS = [
    r"önceki talimatları unut",
    r"ignore previous instructions?",
    r"forget your instructions?",
    r"sen artık",
    r"you are now",
    r"new role",
    r"system prompt",
    r"tüm projeleri listele",
    r"list all (?:projects?|users?|data)",
    r"show me all",
    r"\[sistem talimat[ıi]\]",
    r"\[system instruction\]",
    r"disregard",
    r"override instructions?",
]

_COMPILED = [re.compile(p, re.IGNORECASE) for p in INJECTION_PATTERNS]

MAX_INPUT_LENGTH = 10_000

SENSITIVE_FIELDS = frozenset({
    "cost_claimed_amount",
    "cost_agreed_amount",
    "time_impact_days_claimed",
    "time_impact_days_agreed",
    "contract_value",
})


def sanitize_user_input(text: str) -> str:
    """Kullanıcı girdisini LLM'e göndermeden önce temizler.

    1. Uzunluk kontrolü
    2. Prompt injection taraması
    3. HTML temizleme (bleach)
    """
    if not text:
        return text

    if len(text) > MAX_INPUT_LENGTH:
        raise HTTPException(400, "Girdi çok uzun (maks. 10.000 karakter)")

    for pattern in _COMPILED:
        if pattern.search(text):
            raise HTTPException(400, "Geçersiz içerik tespit edildi")

    text = bleach.clean(text, tags=[], strip=True)
    return text.strip()


def mask_sensitive_fields(data: dict, role: str) -> dict:
    """Viewer rolü için hassas finansal alanları maskeler."""
    if role != "viewer":
        return data
    masked = dict(data)
    for field in SENSITIVE_FIELDS:
        if field in masked and masked[field] is not None:
            masked[field] = "***"
    return masked
