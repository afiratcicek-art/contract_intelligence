import hmac
import hashlib
from fastapi import Request
from backend.database import get_anon_client, get_admin_client
from backend.core.exceptions import UnauthorizedError, ForbiddenError

_COOKIE_NAME = "clauseiq_token"


def get_current_user(request: Request) -> dict:
    """
    httpOnly cookie'den JWT token okur, Supabase Auth ile doğrular,
    profil döndürür. Sync.
    """
    token = request.cookies.get(_COOKIE_NAME)
    if not token:
        raise UnauthorizedError()

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
