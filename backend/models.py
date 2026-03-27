from pydantic import BaseModel
from datetime import date
from typing import Optional

class RFIEkle(BaseModel):
    numara: str
    konu: str
    proje: str
    tarih: date
    durum: str
    notice_suresi_gun: int

class RFI(BaseModel):
    id: Optional[int] = None
    numara: str
    konu: str
    proje: str
    tarih: date
    durum: str
    notice_suresi_gun: int