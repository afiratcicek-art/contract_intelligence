"""Input sanitizasyon yardımcıları.

Kullanıcıdan gelen tüm string alanlar DB'ye yazılmadan önce
bu modüldeki fonksiyonlardan geçirilir.

Supabase ORM SQL injection'ı ORM seviyesinde bloke eder.
Bu modül XSS, null byte ve aşırı uzun input saldırılarına karşı koruma sağlar.
sanitize_contract_text() PDF'den çıkarılan metni LLM'e göndermeden önce temizler.
"""
import re
from typing import Optional

# Uzunluk sınırları
LIMITS = {
    "short":  200,   # number, reference, corr_number, rfi_number vb.
    "medium": 500,   # subject, title, external_actor_name vb.
    "long":   5000,  # description, note, close_note vb.
    "content": 50000, # draft content, final_content vb.
}

# XSS pattern'leri
_SCRIPT_TAG    = re.compile(r"<script[\s\S]*?>[\s\S]*?</script>", re.IGNORECASE)
_HTML_TAG      = re.compile(r"<[^>]+>")
_JS_PROTO      = re.compile(r"javascript\s*:", re.IGNORECASE)
_EVENT_HANDLER = re.compile(r"\bon\w+\s*=", re.IGNORECASE)
_NULL_BYTE     = re.compile(r"\x00")


def sanitize_string(
    value: Optional[str],
    max_length: int = LIMITS["medium"],
    allow_newlines: bool = False,
) -> Optional[str]:
    """
    Tek string alanı sanitize eder.
    - None girdi → None döner
    - Boş string → None döner
    - Script tag, HTML tag, JS protokol, event handler temizlenir
    - Null byte kaldırılır
    - max_length'i aşan input kırpılır
    - Başı/sonu boşluk temizlenir

    allow_newlines=True: description, note, content alanları için
    allow_newlines=False: tek satır alanlar için (subject, number vb.)
    """
    if value is None:
        return None

    # Null byte temizle
    value = _NULL_BYTE.sub("", value)

    # Script tag temizle
    value = _SCRIPT_TAG.sub("", value)

    # Kalan HTML tag'leri temizle
    value = _HTML_TAG.sub("", value)

    # javascript: protokol temizle
    value = _JS_PROTO.sub("", value)

    # on* event handler temizle
    value = _EVENT_HANDLER.sub("", value)

    # Tek satır alanlarda newline temizle
    if not allow_newlines:
        value = value.replace("\n", " ").replace("\r", " ")

    # Boşluk normalize
    value = value.strip()

    # Uzunluk sınırı
    if len(value) > max_length:
        value = value[:max_length]

    return value if value else None


def sanitize_short(value: Optional[str]) -> Optional[str]:
    """number, reference, external_ref gibi kısa alanlar (max 200)."""
    return sanitize_string(value, max_length=LIMITS["short"], allow_newlines=False)


def sanitize_medium(value: Optional[str]) -> Optional[str]:
    """subject, title, actor_name gibi orta uzunlukta alanlar (max 500)."""
    return sanitize_string(value, max_length=LIMITS["medium"], allow_newlines=False)


def sanitize_long(value: Optional[str]) -> Optional[str]:
    """description, note, close_note gibi uzun alanlar (max 5000)."""
    return sanitize_string(value, max_length=LIMITS["long"], allow_newlines=True)


def sanitize_content(value: Optional[str]) -> Optional[str]:
    """draft content, final_content gibi çok uzun alanlar (max 50000)."""
    return sanitize_string(value, max_length=LIMITS["content"], allow_newlines=True)


# ----------------------------------------------------------
# LLM prompt injection koruması — PDF extracted text için
# ----------------------------------------------------------

_INJECTION_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?",
        r"(?:forget|disregard)\s+(?:your|all|previous)\s+instructions?",
        r"you\s+are\s+now\b",
        r"new\s+(?:role|persona|identity)\b",
        r"(?:system|hidden)\s+prompt",
        r"override\s+instructions?",
        r"\[system\s*(?:instruction|message|prompt)\]",
        r"önceki\s+talimatları?\s+unut",
        r"sen\s+artık\b",
        r"tüm\s+projeleri\s+listele",
    ]
]

_INJECTION_PLACEHOLDER = "[CONTENT REDACTED — injection pattern detected]"

CONTRACT_TEXT_MAX_LENGTH = 50_000


def sanitize_contract_text(text: str) -> str:
    """PDF'den çıkarılan sözleşme metnini LLM'e göndermeden önce temizler.

    XSS temizliği (DB güvenliği için) + prompt injection pattern'lerini
    nötralize eder. Metin silinmez, injection satırları placeholder ile
    değiştirilir — böylece analiz bağlamı korunur.
    """
    if not text:
        return ""

    text = _NULL_BYTE.sub("", text)
    text = _SCRIPT_TAG.sub("", text)
    text = _HTML_TAG.sub("", text)
    text = _JS_PROTO.sub("", text)
    text = _EVENT_HANDLER.sub("", text)

    lines = text.splitlines()
    cleaned: list[str] = []
    for line in lines:
        if any(p.search(line) for p in _INJECTION_PATTERNS):
            cleaned.append(_INJECTION_PLACEHOLDER)
        else:
            cleaned.append(line)
    text = "\n".join(cleaned)

    if len(text) > CONTRACT_TEXT_MAX_LENGTH:
        text = text[:CONTRACT_TEXT_MAX_LENGTH]

    return text.strip()
