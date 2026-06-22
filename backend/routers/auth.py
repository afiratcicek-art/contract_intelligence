from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from backend.database import get_db, get_admin_client
from backend.core.cache import cache_delete
from backend.core.security import get_current_user
from backend.core.limiter import limiter
from backend.core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

_IS_PRODUCTION = settings.APP_ENV == "production"
_COOKIE_SAMESITE = "strict" if _IS_PRODUCTION else "lax"
_COOKIE_NAME = "clauseiq_token"


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
            raise HTTPException(401, "Geçersiz e-posta veya şifre")

        full_name = ""
        try:
            profile = (
                get_admin_client().table("profiles")
                .select("full_name")
                .eq("id", str(result.user.id))
                .single()
                .execute()
            )
            full_name = profile.data.get("full_name", "") if profile.data else ""
        except Exception:
            pass

        # httpOnly cookie — JavaScript erişimi yok
        response.set_cookie(
            key=_COOKIE_NAME,
            value=result.session.access_token,
            httponly=True,
            secure=_IS_PRODUCTION,
            samesite=_COOKIE_SAMESITE,
            path="/",
        )

        return LoginResponse(
            user_id=str(result.user.id),
            full_name=full_name,
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "Geçersiz e-posta veya şifre")


@router.post("/logout")
def logout(request: Request, response: Response, db=Depends(get_db)):
    """Oturumu kapatır, cookie'yi siler, auth cache'i temizler."""
    # Auth cache'i temizle — token artık geçersiz
    token = request.cookies.get(_COOKIE_NAME)
    if token:
        import hashlib
        cache_key = "auth:" + hashlib.sha256(token.encode()).hexdigest()[:32]
        cache_delete(cache_key)
    try:
        db.auth.sign_out()
    except Exception:
        pass
    response.delete_cookie(
        key=_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=_IS_PRODUCTION,
        samesite=_COOKIE_SAMESITE,
    )
    return {"message": "Signed out"}


@router.get("/me")
def me(current_user: dict = Depends(get_current_user)):
    """Token doğrulama — geçerliyse 200, geçersizse 401."""
    return {
        "user_id": current_user["id"],
        "full_name": current_user.get("full_name", ""),
    }
