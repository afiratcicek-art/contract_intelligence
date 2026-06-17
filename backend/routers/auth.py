from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from backend.database import get_db, get_admin_client
from backend.core.limiter import limiter
from backend.core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

_IS_PRODUCTION = settings.APP_ENV == "production"
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
            samesite="strict",
            max_age=3600,
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
def logout(response: Response, db=Depends(get_db)):
    """Oturumu kapatır, cookie'yi siler."""
    try:
        db.auth.sign_out()
    except Exception:
        pass
    response.delete_cookie(
        key=_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=_IS_PRODUCTION,
        samesite="strict",
    )
    return {"message": "Signed out"}
