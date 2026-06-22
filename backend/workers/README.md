# PDF Worker

PDF parse işlemlerini arka planda yürüten worker servisi.

## Çalıştırma

### Geliştirme ortamı

İki ayrı terminal: Terminal 1 — API:
uvicorn backend.main:app --reload --port 8000

Terminal 2 — Worker:
python -m backend.workers.pdf_worker

### Environment değişkenleri

POLL_INTERVAL_SECONDS: varsayılan 15 — kaç saniyede bir kontrol
WORKER_BATCH_SIZE: varsayılan 3 — her turda işlenen kayıt sayısı

### Production (Railway / Render)
Procfile ile otomatik başlatılır.

### Parse durumları
pending: kuyrukta | processing: işleniyor |
completed: hazır | failed: hata

### Startup recovery
Server restart'ta processing kayıtlar pending'e döner.
