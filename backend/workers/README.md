# PDF Worker

PDF parse işlemlerini arka planda yürüten worker servisi.

## Çalıştırma

### Geliştirme ortamı

İki ayrı terminal gerekir — yalnız API yetmez (PDF'ler `pending` kalır).

Terminal 1 — API (tek process):
```
uvicorn backend.main:app --reload --port 8000
```

Terminal 2 — Worker:
```
python -m backend.workers.pdf_worker
```

### Production (Railway / Render)

`Procfile` iki process tanımlar; **ikisi de çalışmalı**:

- `web` — API (`uvicorn`)
- `worker` — `python -m backend.workers.pdf_worker`

Yalnız `web` deploy edilirse yüklenen belgeler kuyrukta kalır.

### Tek worker kısıtı (bilinçli)

API'yi `uvicorn --workers N` veya birden fazla web replica ile
ölçekleme **şimdilik yapma**. Auth / membership / permission cache
in-memory'dir (`backend/core/cache.py`, TB-20). Çok process = tutarsız
revoke. Ölçek gerekince paylaşımlı cache (Redis) ayrı karar.

Procfile `web` satırı tek process bırakılmalı.

### Environment değişkenleri

| Değişken | Varsayılan | Anlam |
|---|---|---|
| POLL_INTERVAL_SECONDS | 15 | Kaç saniyede bir pending tarama |
| WORKER_BATCH_SIZE | 3 | Her turda işlenen kayıt sayısı |

### Parse durumları

pending: kuyrukta | processing: işleniyor |
completed: hazır | failed: hata

### Startup recovery

API restart'ta `processing` kayıtlar `pending`'e döner
(`backend/main.py` startup). Worker'ın da ayakta olması gerekir.
