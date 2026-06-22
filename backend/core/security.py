import hmac
import hashlib
from fastapi import Request
from backend.database import get_anon_client, get_admin_client
from backend.core.exceptions import UnauthorizedError, ForbiddenError
from backend.core.cache import cache_get, cache_set, cache_delete

_AUTH_CACHE_TTL = 60  # seconds

def _auth_cache_key(token: str) -> str:
    """Token'ın SHA256 hash'ini cache key olarak kullan — raw token cache'de durmasın."""
    import hashlib
    return "auth:" + hashlib.sha256(token.encode()).hexdigest()[:32]

_COOKIE_NAME = "clauseiq_token"


def get_current_user(request: Request) -> dict:
    """
    httpOnly cookie'den JWT token okur, Supabase Auth ile doğrular,
    profil döndürür. Sync. Auth sonucu 60s cache'lenir.
    """
    token = request.cookies.get(_COOKIE_NAME)
    if not token:
        raise UnauthorizedError()

    # Cache kontrolü — is_active False ise cache bypass
    cache_key = _auth_cache_key(token)
    cached = cache_get(cache_key)
    if cached is not None and cached.get("is_active"):
        return cached

    try:
        db = get_anon_client()
        user_resp = db.auth.get_user(token)
        if not user_resp or not user_resp.user:
            raise UnauthorizedError()

        result = (
            get_admin_client().table("profiles")
            .select("*")
            .eq("id", str(user_resp.user.id))
            .single()
            .execute()
        )
        if not result.data:
            raise UnauthorizedError("Kullanıcı profili bulunamadı")
        if not result.data.get("is_active"):
            raise ForbiddenError()

        user_data = result.data
        # Cache'e yaz — sadece active kullanıcılar
        # _meta (raw token) cache'e yazılmaz — memory exposure riski
        cache_set(cache_key, user_data, _AUTH_CACHE_TTL)
        user_data["_meta"] = {"token": token}
        return user_data

    except (UnauthorizedError, ForbiddenError):
        raise
    except Exception:
        raise UnauthorizedError()


def verify_whatsapp_webhook(
    payload: bytes,
    signature: str,
    app_secret: str,
) -> bool:
    """Meta/WhatsApp webhook imza doğrulaması."""
    if not signature or not app_secret:
        return False
    try:
        expected = hmac.new(
            key=app_secret.encode(),
            msg=payload,
            digestmod=hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(f"sha256={expected}", signature)
    except Exception:
        return False
