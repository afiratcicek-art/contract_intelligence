# ClauseIQ — Technical Debt Register

Her teknik borç: tanım, neden ertelendi, ne zaman çözülmeli.
Yeni borç eklendikçe bu dosya güncellenir.
Kod içinde ilgili satıra `# TECHNICAL DEBT: [ID]` notu düşülür.

---

## TD-001 — PDF İşleme: Async Queue UX
**Konum:** `backend/services/pdf_pipeline_service.py`, `backend/routers/documents.py`
**Durum:** Kısmen çözüldü — DB-backed async queue kuruldu
**Sorun:** Kullanıcı PDF yüklediğinde 202 Accepted alır, belge arka planda işlenir.
Şu an kullanıcı sayfayı manuel yenilemek zorunda. Otomatik durum güncellemesi yok.
**Çözüm:** Frontend'de WebSocket veya polling ile parse_status takibi.
**Ne zaman:** Frontend geliştirme aşamasında, ilk kullanıcı testlerinden önce.

---

## TD-002 — LlamaParse Entegrasyonu
**Konum:** `backend/services/pdf_pipeline_service.py` → `_extract_llamaparse()`
**Durum:** Stub mevcut, aktif değil
**Sorun:** pydantic>=2.8 gerektirir, mevcut pydantic==2.7.0 ile çakışır.
Karma içerikli PDF'lerde (0.25 <= quality_score < 0.75) PyMuPDF fallback devreye giriyor.
**Çözüm:**
  1. pydantic upgrade kararı ver (2.7.0 → uyumlu versiyon)
  2. pip install llama-parse
  3. LLAMAPARSE_API_KEY .env'e ekle
  4. _extract_llamaparse() implement et
**Ne zaman:** Katılımcı testlerinden hemen önce.

---

## TD-003 — PDF Metin Injection Taraması
**Konum:** `backend/services/pdf_pipeline_service.py` → `process()` — ADIM 4 sonrası
**Durum:** Yapılmadı
**Sorun:** PDF'den çıkarılan metin doğrudan Claude API'ye gönderilecek.
Kötü niyetli bir PDF prompt injection içerebilir.
**Çözüm:** clean_extracted_text() sonrası LLM injection pattern taraması ekle.
**Ne zaman:** Claude entegrasyonu başlamadan önce — zorunlu.

---

## TD-004 — ClamAV Production Kurulumu
**Konum:** `backend/utils/pdf_utils.py` → `scan_for_virus()`
**Durum:** Development'ta pasif, production'da zorunlu
**Sorun:** ClamAV kurulu olmadığında development modunda tarama atlanıyor.
Production deployment'ta sistem paketi olarak kurulması gerekiyor.
**Çözüm:** Deployment script'e `apt-get install clamav clamav-daemon` ekle.
**Ne zaman:** İlk production deployment'ta.

---

## TD-005 — Dependency CVE Taraması
**Konum:** `requirements.txt`
**Durum:** Yapılmadı
**Sorun:** Mevcut bağımlılıklarda bilinen güvenlik açığı olabilir.
**Çözüm:** `pip audit` veya `safety check` çalıştır, kritik CVE'leri kapat.
**Ne zaman:** Production deployment öncesi.

---

## TD-006 — Sentry Error Tracking
**Konum:** `backend/main.py`
**Durum:** Yapılmadı
**Sorun:** Production'da hata takibi yok. Global exception handler logluyor ama
merkezi izleme sistemi olmadan sorunlar gözden kaçabilir.
**Çözüm:** sentry-sdk ekle, main.py'de initialize et.
**Ne zaman:** Production deployment'ta.

---

## TD-007 — Migration Otomasyonu
**Konum:** `database/migrations/`
**Durum:** Manuel SQL Editor ile uygulanıyor
**Sorun:** Migration sırası ve tekrar çalıştırma riski manuel süreçte hata yaratabilir.
**Çözüm:** Alembic veya basit bir migration runner script.
**Ne zaman:** İkinci geliştirici katılmadan önce veya deployment pipeline kurulurken.

---

## TD-008 — Supabase Connection Retry
**Konum:** `backend/database.py`
**Durum:** Yapılmadı
**Sorun:** Supabase geçici kesinti yaşarsa bağlantı retry mekanizması yok.
**Çözüm:** Exponential backoff ile retry decorator ekle.
**Ne zaman:** V2 — ilk müşteri sonrası stabilite aşamasında.

---

## TD-009 — pdf_document Bileşik Index
**Konum:** `database/migrations/006_pdf_pipeline.sql`
**Durum:** Tek kolonlu indexler mevcut, bileşik index yok
**Sorun:** `list_documents` endpoint'i project_id + entity_type + entity_id
üçlüsüyle sorguluyor. Büyük projelerde performans düşebilir.
**Çözüm:** `CREATE INDEX idx_pdf_document_project_entity ON pdf_document(project_id, entity_type, entity_id);`
**Ne zaman:** İlk performans sorunu yaşandığında veya V2'de.

---

## TD-010 — API Versioning Frontend Uyumu
**Konum:** `backend/main.py`, tüm router'lar
**Durum:** /api/v1/ prefix eklendi
**Sorun:** Frontend URL'leri henüz yazılmadı — /api/v1/ prefix gözetilerek yazılmalı.
**Çözüm:** Frontend geliştirme başlarken base URL sabitini merkezi tanımla.
**Ne zaman:** Frontend geliştirme başlangıcında.
