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
  # Optional = göndermek zorunda da değilim, bakalım
class RFIGuncelle(BaseModel):
    konu: Optional[str] = None
    durum: Optional[str] = None
    notice_suresi_gun: Optional[int] = None  ## Aslında suna gerek yok ya neyse sımdılık dursun

class NoticeEkle (BaseModel):
    rfi_id: int
    tur: str
    konu: str
    tarih: date
    sozlesme_maddesi : str
    sure_gun : int
    durum : str

class NoticeGuncelle (BaseModel): 
    durum: Optional[str] = None
    sure_gun: Optional[int] = None
    sozlesme_maddesi: Optional[str] = None
    
