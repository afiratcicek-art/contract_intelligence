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

## [TD-SEARCH-001] Semantic Search — RAG Entegrasyonu
**Öncelik:** V2
**Modül:** Workspace / General
**Tarih:** 19 Haziran 2026

### Açıklama
Global arama şu an PostgreSQL full-text search (tsvector/tsquery) ile çalışmaktadır.
V2'de pgvector + embedding tabanlı semantic search entegre edilecek.

### Beklenen Davranış
"Kazı derinliği" araması → "hafriyat", "excavation depth", "foundation depth" içeren
belgeleri de bulabilmeli. Cross-language ve synonym matching desteklenmeli.

### Teknik Gereksinimler
- pgvector extension (Supabase'de mevcut)
- Embedding model: mevcut two-layer LLM mimarisi ile entegre
- RAG pipeline: rag_service.py'daki hybrid retrieval (BM25 + pgvector + RRF fusion)
- HITL approval: yeni belge embedding'leri human approval sonrası sisteme girer
- Opt-out toggle: kullanıcı UI'dan semantic search'ü devre dışı bırakabilir

### İlgili Dosyalar
- backend/services/rag_service.py
- backend/services/claude_service.py
- backend/routers/ (yeni /search endpoint eklenecek)

## [TD-CHART-001] Overview ±15 Gün Chart — Görsel İyileştirme
**Öncelik:** V1.5
**Modül:** Overview / ProjectDetail
**Tarih:** 20 Haziran 2026

### Açıklama
Şu an: Stacked bar, belge tipine göre renkli (Seçenek D), bugün çizgisi ile geçmiş/gelecek ayrımı.
Geri dönülecek konu: 4 belge tipi renginin dar barlarda okunabilirliği.

### Değerlendirilecek Alternatifler
- Seçenek A: Stacked bar, belge tipine göre renkli — mevcut seçim
- Seçenek B: İki ayrı mini chart (geçmiş aktivite / gelecek deadline'lar)
- Belge tiplerini 2'ye indirme: "Correspondence" + "Diğerleri"
- Tooltip ile detay gösterimi

### Karar Kriteri
- 4 rengin dar barlarda okunabilirliği test edilecek
- Gerçek veri ile görsel yoğunluk değerlendirilecek
- Warhol kuralı (ekonomik renk) ve Rönesans hiyerarşisi gözetilecek

### İlgili Dosyalar
- frontend/src/pages/ProjectDetail.tsx
- frontend/src/components/CorrespondenceChart.tsx (genişletilecek)

---

## Relation graph / search architecture

- **TB-17**: Chain search RPCs (search_rfi_chains,
  search_correspondence_chains, migration 021/022) still
  match via pdf_document.search_vector (includes
  pdf_document.keywords). Relation graph endpoints
  (/all-relations, /card-relations, /focused-graph) use
  card-level keywords (correspondences.keywords,
  rfis.keywords, migration 024) instead. These are two
  different keyword sources for two different features —
  intentional for now, but should be reconciled once TB-5
  (Haiku) is live and both paths need the same source of
  truth.
- **TB-18**: Card-level keywords (migration 024) are not
  yet included in correspondences/rfis full-text search
  (search_vector, migration 020 — still subject-only).
  Searching by a card keyword won't surface it via the
  main search bar. Needs a migration to extend
  search_vector generation.
- **TB-19**: entityPath() navigation helper is duplicated
  across DocumentRelationGraph.tsx, FocusedRelationGraph.tsx,
  and RelationPopup.tsx. Low risk (identical logic, small),
  but should be extracted to a shared util when touching
  these files next.
