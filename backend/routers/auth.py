import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from backend.database import get_db, get_admin_client
from backend.core.cache import cache_delete
from backend.core.security import get_current_user
from backend.core.limiter import limiter
from backend.core.config import settings
from backend.services.audit_service import AuditService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

_IS_PRODUCTION = settings.APP_ENV == "production"
_COOKIE_SAMESITE = "strict" if _IS_PRODUCTION else "lax"
_COOKIE_NAME = "clauseiq_token"
# audit_log.entity_id is UUID NOT NULL — anonymous auth events use nil UUID.
_AUTH_ENTITY_NIL = "00000000-0000-0000-0000-000000000000"


def _client_ip(request: Request) -> str | None:
    if request.client is None:
        return None
    return request.client.host


def _audit_auth(
    *,
    action: str,
    request: Request,
    user_id: str | None = None,
    note: str | None = None,
    new_value: dict | None = None,
) -> None:
    """Best-effort auth audit (SEC-H2). Never raises to the client."""
    AuditService().log(
        action=action,
        entity_type="auth",
        entity_id=user_id or _AUTH_ENTITY_NIL,
        user_id=user_id,
        project_id=None,
        new_value=new_value,
        note=note,
        ip_address=_client_ip(request),
    )


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    user_id: str
    full_name: str


@router.post("/login", response_model=LoginResponse)
@limiter.limit("5/minute")
def login(request: Request, response: Response, body: LoginRequest, db=Depends(get_db)):
    """Supabase Auth ile oturum açar, JWT token httpOnly cookie olarak set eder."""
    try:
        result = db.auth.sign_in_with_password({
            "email": body.email,
            "password": body.password,
        })
        if not result.session:
            _audit_auth(
                action="login",
                request=request,
                note="failed",
                new_value={"success": False, "email": body.email},
            )
            raise HTTPException(401, "Geçersiz e-posta veya şifre")

        user_id = str(result.user.id)
        full_name = ""
        try:
            profile = (
                get_admin_client().table("profiles")
                .select("full_name")
                .eq("id", user_id)
                .single()
                .execute()
            )
            full_name = profile.data.get("full_name", "") if profile.data else ""
        except Exception as exc:  # noqa: BLE001
            logger.debug("profile fetch failed (non-blocking, full_name defaults to ''): %s", exc)

        # httpOnly cookie — JavaScript erişimi yok
        response.set_cookie(
            key=_COOKIE_NAME,
            value=result.session.access_token,
            httponly=True,
            secure=_IS_PRODUCTION,
            samesite=_COOKIE_SAMESITE,
            path="/",
        )

        _audit_auth(
            action="login",
            request=request,
            user_id=user_id,
            note="ok",
            new_value={"success": True},
        )

        return LoginResponse(
            user_id=user_id,
            full_name=full_name,
        )
    except HTTPException:
        raise
    except Exception:
        _audit_auth(
            action="login",
            request=request,
            note="failed",
            new_value={"success": False, "email": body.email},
        )
        raise HTTPException(401, "Geçersiz e-posta veya şifre")


@router.post("/logout")
def logout(request: Request, response: Response, db=Depends(get_db)):
    """Oturumu kapatır, cookie'yi siler, auth cache'i temizler."""
    user_id: str | None = None
    token = request.cookies.get(_COOKIE_NAME)
    if token:
        import hashlib
        cache_key = "auth:" + hashlib.sha256(token.encode()).hexdigest()[:32]
        cache_delete(cache_key)
        try:
            user_resp = db.auth.get_user(token)
            if user_resp and user_resp.user:
                user_id = str(user_resp.user.id)
        except Exception as exc:  # noqa: BLE001
            logger.debug("logout user resolve failed (non-blocking): %s", exc)
    try:
        db.auth.sign_out()
    except Exception as exc:  # noqa: BLE001
        logger.debug("sign_out failed (non-blocking, cookie will be cleared regardless): %s", exc)
    response.delete_cookie(
        key=_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=_IS_PRODUCTION,
        samesite=_COOKIE_SAMESITE,
    )
    _audit_auth(
        action="logout",
        request=request,
        user_id=user_id,
        note="ok",
    )
    return {"message": "Signed out"}


@router.get("/me")
def me(current_user: dict = Depends(get_current_user)):
    """Token doğrulama — geçerliyse 200, geçersizse 401."""
    return {
        "user_id": current_user["id"],
        "full_name": current_user.get("full_name", ""),
    }
