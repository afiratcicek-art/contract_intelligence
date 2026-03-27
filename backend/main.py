from fastapi import FastAPI, HTTPException
from datetime import date, timedelta
from database import supabase
from models import RFIEkle, RFI

app = FastAPI(
    title="Contract Intelligence API",
    description="RFI, Notice ve Change yönetim sistemi",
    version="0.1.0"
)

@app.get('/')
def ana_sayfa():
    return {"mesaj": "Contract Intelligence API çalışıyor"}

@app.get('/rfi')
def rfi_listele():
    response = supabase.table('rfi').select('*').execute()
    return response.data

@app.post('/rfi')
def rfi_ekle(rfi: RFIEkle):
    veri = {
        "numara": rfi.numara,
        "konu": rfi.konu,
        "proje": rfi.proje,
        "tarih": str(rfi.tarih),
        "durum": rfi.durum,
        "notice_suresi_gun": rfi.notice_suresi_gun
    }
    response = supabase.table('rfi').insert(veri).execute()
    return response.data[0]

@app.get('/rfi/{rfi_id}')
def rfi_getir(rfi_id: int):
    response = supabase.table('rfi').select('*').eq('id', rfi_id).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail='RFI bulunamadi')
    return response.data[0]

@app.get('/rfi/{rfi_id}/deadline')
def deadline_hesapla(rfi_id: int):
    response = supabase.table('rfi').select('*').eq('id', rfi_id).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail='RFI bulunamadi')

    rfi = response.data[0]
    rfi_tarihi = date.fromisoformat(rfi['tarih'])
    deadline = rfi_tarihi + timedelta(days=rfi['notice_suresi_gun'])
    kalan = (deadline - date.today()).days

    if kalan < 0:
        durum = 'KRİTİK — DEADLINE KAÇIRILDI'
    elif kalan <= 3:
        durum = 'ACİL — 3 gün veya daha az'
    elif kalan <= 7:
        durum = 'UYARI — 7 gün veya daha az'
    else:
        durum = 'Normal'

    return {
        "rfi_numara": rfi["numara"],
        "rfi_konu": rfi["konu"],
        "rfi_tarihi": rfi["tarih"],
        "notice_suresi_gun": rfi["notice_suresi_gun"],
        "deadline": str(deadline),
        "kalan_gun": kalan,
        "durum": durum 
    }
    # Tüm deadlinelari getiren bir endpoint eklemek istiyorum
@app.get('/rfi/deadline/hepsi')
def tum_deadlinelari_getir():
    response = supabase.table('rfi').select('*').execute()
    sonuclar = []
    for rfi in response.data:
        rfi_tarihi = date.fromisoformat(rfi['tarih'])
        deadline = rfi_tarihi + timedelta(days=rfi['notice_suresi_gun'])
        kalan = (deadline - date.today()).days
        if kalan < 0:
            durum = "KRİTİK"
        elif kalan <= 3:
            durum = "ACİL"
        elif kalan <= 7:
            durum = "UYARI"
        else :
            durum = "NORMAL"

    sonuclar.append(
    {
    "numara": rfi["numara"],
    "konu" : rfi["konu"],
    "deadline" : str(deadline),
    "kalan_gun" : kalan,
    "durum" : durum
    })
    return sonuclar