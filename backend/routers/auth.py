from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from backend.database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    full_name: str


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, db=Depends(get_db)):
    """Supabase Auth ile oturum açar, JWT token döndürür."""
    try:
        result = db.auth.sign_in_with_password({
            "email": body.email,
            "password": body.password,
        })
        if not result.session:
            raise HTTPException(401, "Geçersiz e-posta veya şifre")

        profile = (
            db.table("profiles")
            .select("full_name")
            .eq("id", result.user.id)
            .single()
            .execute()
        )

        return LoginResponse(
            access_token=result.session.access_token,
            user_id=str(result.user.id),
            full_name=profile.data.get("full_name", "") if profile.data else "",
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "Geçersiz e-posta veya şifre")


@router.post("/logout")
def logout(db=Depends(get_db)):
    """Oturumu kapatır."""
    try:
        db.auth.sign_out()
    except Exception:
        pass
    return {"mesaj": "Oturum kapatıldı"}
