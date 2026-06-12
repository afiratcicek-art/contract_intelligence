from typing import Optional
from fastapi import FastAPI, HTTPException
from datetime import date, timedelta
from database import supabase
from models import RFIEkle, RFI, RFIGuncelle, NoticeEkle, NoticeGuncelle



app = FastAPI(
    title="Contract Intelligence API",
    description="RFI, Notice ve Change yönetim sistemi",
    version="0.1.0"
)

@app.get('/')
def ana_sayfa():
    return {"mesaj": "Contract Intelligence API çalışıyor"}

@app.get('/rfi')
def rfi_listele(
    durum: Optional[str] = None,
    proje: Optional[str] = None,
    sirala: Optional[str] = 'tarih'
):
    sorgu = supabase.table('rfi').select('*')

    if durum:
        sorgu = sorgu.eq('durum', durum)

    if proje:
        sorgu = sorgu.eq('proje', proje)

    if sirala == 'tarih':
        sorgu = sorgu.order('tarih', desc=False)
    elif sirala == 'tarih_desc':
        sorgu = sorgu.order('tarih', desc=True)

    response = sorgu.execute()
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
## Endpint bilmem kac, RFI Guncelleme
@app.put('/rfi/{rfi_id}')
def rfi_guncelle(rfi_id: int, guncelleme: RFIGuncelle):
    ##Once RFI var mı kontrol et
    mevcut = supabase.table('rfi').select('*').eq('id', rfi_id).execute()
    if not mevcut.data:
        raise HTTPException(status_code=404, detail='RFI bulunamadi')
## Sadece Gonderilen alanları güncelle
    guncellenecek = {}
    if guncelleme.konu is not None:
        guncellenecek['konu'] = guncelleme.konu
    if guncelleme.durum is not None:
        guncellenecek['durum'] = guncelleme.durum
    if guncelleme.notice_suresi_gun is not None:
        guncellenecek['notice_suresi_gun'] = guncelleme.notice_suresi_gun


    if not guncellenecek:
        raise HTTPException(status_code=400, detail='Güncellenecek alan gonderilmedi')

    response = supabase.table('rfi').update(guncellenecek).eq('id', rfi_id).execute()
    return response.data[0]
## Yeni endpoiint: RFI Silme
@app.delete('/rfi/{rfi_id}')
def rfi_sil(rfi_id: int):
    mevcut = supabase.table('rfi').select('*').eq('id', rfi_id).execute()
    if not mevcut.data:
        raise HTTPException(status_code=404, detail='RFI bulunamadi')

    supabase.table('rfi').delete().eq('id', rfi_id).execute()
    return {"mesaj": f"RFI {rfi_id} başarıyla silindi"}
###### NOTICE MODÜLÜ
@app.post('/notice')
def notice_ekle(notice: NoticeEkle):
    ## Önce Bağlı RFI var mı kontrol et
    rfi_kontrol = supabase.table('rfi').select('*').eq('id', notice.rfi_id).execute()
    if not rfi_kontrol.data:
        raise HTTPException(status_code=404, detail= f'RFI {notice.rfi_id} bulunamadi. RFI in Eklendiginden Emin olun')
    veri = {
        "rfi_id": notice.rfi_id,
        "tur": notice.tur,
        "konu": notice.konu,
        "tarih": str(notice.tarih),
        "sozlesme_maddesi": notice.sozlesme_maddesi,
        "sure_gun": notice.sure_gun,
        "durum": notice.durum
    }
    response = supabase.table('notice').insert(veri).execute()
    return response.data[0]
###Yeni Endpoint: RFI a Bağlı Notice Getirme
@app.get('/notice/rfi/{rfi_id}')
def rfi_noticelari(rfi_id: int):
    ##RFI Var mı kontrol et
        rfi_kontrol = supabase.table('rfi').select('*').eq('id', rfi_id).execute()
        if not rfi_kontrol.data:
         raise HTTPException(status_code=404, detail= f'RFI {rfi_id} bulunamadi.')
         rfi = rfi_kontrol.data[0]
         noticeler = supabase.table('notice').select('*').eq('rfi_id', rfi_id).execute()
         return {
    "rfi_numara": rfi["numara"],
    "rfi_konu": rfi["konu"],
    "notice_sayisi" : len(noticeler.data),
    "noticeler": noticeler.data
    }
### Notice Deadline Hesaplama Endpointi
@app.get('/notice/{notice_id}/deadline')
def notice_deadline(notice_id: int):
    response = supabase.table('notice').select('*').eq('id', notice_id).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail='Notice bulunamadi')
    notice = response.data[0]
    notice_tarihi = date.fromisoformat(notice['tarih'])
    deadline = notice_tarihi + timedelta(days=notice['sure_gun'])
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
        "notice_id": notice["id"],
        "tur": notice["tur"],
        "konu": notice["konu"],
        "sozlesme_maddesi": notice["sozlesme_maddesi"],
        "deadline": str(deadline),
        "kalan_gun": kalan,
        "durum": durum
    }
### Notice Güncelleme Endpointi
@app.put('/notice/{notice_id}')
def notice_guncelle(notice_id: int, guncelleme: NoticeGuncelle):
    mevcut = supabase.table('notice').select('*').eq('id', notice_id).execute()
    if not mevcut.data:
        raise HTTPException(status_code=404, detail='Notice bulunamadi')
    guncellenecek = {}
    if guncelleme.durum is not None:
        guncellenecek['durum'] = guncelleme.durum
    if guncelleme.sure_gun is not None:
        guncellenecek['sure_gun'] = guncelleme.sure_gun
    if guncelleme.sozlesme_maddesi is not None:
        guncellenecek['sozlesme_maddesi'] = guncelleme.sozlesme_maddesi
    if not guncellenecek:
        raise HTTPException(status_code=400, detail='Güncellenecek alan gonderilmedi')
    response = supabase.table('notice').update(guncellenecek).eq('id', notice_id).execute()
    return response.data[0]
