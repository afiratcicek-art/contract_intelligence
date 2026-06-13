from fastapi import HTTPException


class NotFoundError(HTTPException):
    """Kaynak bulunamadı — bilgi sızdırmamak için her zaman 404 döndürür."""
    def __init__(self, detail: str = "Kaynak bulunamadı"):
        super().__init__(status_code=404, detail=detail)


class ForbiddenError(HTTPException):
    """Yetki hatası — bilgi sızdırmamak için 404 olarak maskelenir."""
    def __init__(self):
        super().__init__(status_code=404, detail="Kaynak bulunamadı")


class UnauthorizedError(HTTPException):
    def __init__(self, detail: str = "Kimlik doğrulama gerekli"):
        super().__init__(status_code=401, detail=detail)


class ConflictError(HTTPException):
    def __init__(self, detail: str = "Çakışma"):
        super().__init__(status_code=409, detail=detail)


class ValidationError(HTTPException):
    def __init__(self, detail: str = "Geçersiz veri"):
        super().__init__(status_code=400, detail=detail)


class RaceConditionError(HTTPException):
    def __init__(self):
        super().__init__(
            status_code=409,
            detail="Kayıt başkası tarafından güncellendi. Lütfen sayfayı yenileyip tekrar deneyin."
        )
