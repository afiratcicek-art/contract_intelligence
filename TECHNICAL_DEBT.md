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
**Konum:** `backend/core/sanitizer.py`, `backend/services/claude_service.py`, `backend/utils/pdf_utils.py`, `backend/routers/documents.py`
**Durum:** KAPATILDI (0c6abba, 2026-07-04)
**Çözüm (uygulanan):**
  1. `sanitize_contract_text()` — 10 injection pattern (TR+EN) + XSS strip, satır bazlı redaction
  2. `claude_service.py` — `analyze_clause()` + `generate_what_if_scenario()` contract_text sanitize edildi
  3. Gate system prompt — contract_excerpt injection taraması eklendi
  4. `scan_for_virus()` upload endpoint'e bağlandı (ClamAV)
  5. `clean_extracted_text()` XSS pattern'leri eklendi
  6. `extraction_service.py` TB-5 aktivasyonu için hazırlandı

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
**Konum:** `requirements.txt`, `frontend/package.json`
**Durum:** KAPATILDI (2026-07-04)
**Sonuç:** pip-audit + npm audit: 0 CVE bulundu. starlette CVE-2026-48710 pin zaten mevcut.
**Periyodik:** Production CI'da pip-audit + npm audit adımı eklenmeli.

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
- **TB-26**: content-relation eşiği (0.25) geçici/provizyonel.
  Skor kompoziti "keyword + semantic" olarak tasarlandı ama
  Haiku/embedding henüz kapalı (TB-5'e bağlı). Deterministik-tek
  modda 0.25 fazla yüksek; nihai değer TAHMİNLE değil, ölçülen
  skor dağılımından belirlenmeli ve TB-5 (Haiku) aktive edilince
  yeniden kalibre edilmeli. Bağımlı: TB-5.
  → Interim deterministic value set to 0.10 (2026-07-07, commit 6e1943c),
    surfaced via CONTENT_RELATION_THRESHOLD const in documents.py.
    Recalibrate on TB-5 (Haiku) activation.

---

## Performance

- **TB-20**: verify_project_access runs 2 Supabase queries
  on EVERY request with no caching, while its sub-function
  require_permission already caches (5-min TTL). On a page
  that calls several endpoints, this auth cost (~130ms warm,
  ~600ms cold, per endpoint) stacks. Opportunity: cache the
  access RESULT (not the JWT-scoped db client) keyed by
  (user_id, project_id) with a short TTL (30-60s).
  SECURITY CONSTRAINTS (mandatory, do not skip):
    1. Cache key MUST be (user_id + project_id) — never
       project_id alone (cross-tenant leak risk).
    2. NEVER cache the JWT-scoped db client (access["db"]) —
       only the permission result (bool + role). The db
       client must be rebuilt fresh each request with the
       caller's own token.
    3. Short TTL only (<=60s) so revoked access / role
       downgrades take effect quickly (privilege-escalation
       window otherwise).
    4. Membership-delete and role-change paths should
       invalidate the cache (or TTL must be short enough to
       tolerate staleness).
    5. In-memory cache is per-worker; note that multi-worker
       production deployments need a shared store (Redis) for
       consistency. Current dev is single-worker.
  Must be implemented in an isolated, well-tested change —
  auth-layer edits must never be mixed into unrelated commits.

---

## Backend refactor / AI service

- **TB-22**: C-04: claude_service `_execute_pipeline` refactor — 4 public
  method aynı 7 adımı tekrarlıyor; `_execute_pipeline()` helper ile ~150
  satır tasarruf. ÖNKOŞUL: pytest smoke test suite kurulmalı
  (gate→blocked→cache→analysis sırası korunduğunu doğrulamak için).
  Risk: Orta. Durum: ERTELENDİ — bu modül + yeni modül tamamlanınca
  yapılacak AI/LLM pipeline bahar temizliğinde ele alınacak (2026-07-07 kararı).

---

## Delete Workflow

- **TB-23**: Hatalı kayıt silme — iş kuralı + teknik implementasyon.
  Kural: Sadece draft/taslak statüsündeki kayıtlar silinebilir.
  Yayımlanmış/onaylanmış kayıtlar silinemez (forensic arşiv prensibi).
  Yetki: CM veya kaydı oluşturan DCC.
  Audit: Her silme işlemi loglanır.
  Kapsam: correspondences (endpoint yok), rfis (endpoint var, deleted_by
  kolonu eksik, frontend yok), pdf_document (endpoint yok).
  Önkoşul: deleted_by kolonunun migration ile eklenmesi.
  Stats etkisi: is_deleted=FALSE filtresi zaten mevcut — stats tutarlı kalır.

---

## Other Amendments

- **TB-25**: "Other Amendments" kategorisi — Contract & Amendments stats
  panelinde gösteriliyor ancak henüz ayrı bir entity/tablo yok.
  Örnek senaryo: gelen bir mektup ile doküman kontrol yönetimi
  değiştirilmiş olabilir — bu resmi olarak amendment teşkil eder
  ama change workflow'u gerektirmez.
  Tasarım gereksinimi: ayrı amendment entity + tablo + workflow
  (Changes sekmesi tasarımı ile birlikte ele alınacak).
  Stats'ta şimdilik count=0 gösterilir.

---

## Contract cardinality

- **TB-27**: Proje ↔ sözleşme kardinalitesi — İLERİDE ZİYARET EDİLECEK
  ÜRÜN KARARI (Ali, 2026-07-20). Pilot kuralı: proje başına TEK sözleşme.
  Satış da proje bazlı olacağı için bu varsayılan doğru; ancak işveren işi
  fazlara/paketlere böldüğünde ilişkili sözleşmeler kopuk projelere düşer
  ("model for N, default to 1" kararının nedeni).
  Mevcut durum: `contracts` tablosu project_id taşır ve UNIQUE(project_id)
  YOKTUR (migration 039) — şema 1:N'i bugün destekler. Tek-sözleşme kuralı
  yalnızca API'de (POST /contract 409 guard, backend/routers/contract.py).
  Çözüldüğünde: migration GEREKMEZ; karar "bir projede çok sözleşme" mi
  yoksa "projelerin üstünde programme/portfolio katmanı" mı — gerçek vaka
  gelince seçilecek, ikisi de tablo modeliyle açık.
  Ne zaman: ilk fazlı/çok-sözleşmeli müşteri vakası geldiğinde.

---

## Contract type dual-source

- **TB-28**: `projects.contract_type` (migration 001) ve `contracts.contract_type`
  (migration 042) aynı ContractType enum değerlerini taşır. Phase-1'de create
  sırasında client göndermezse proje değeri sözleşmeye DEFAULT edilir
  (continuity). İleride tek kaynak seçilmeli (muhtemelen contracts — hiyerarşi
  kökü / RAG çıpası) ve projects tarafı türetilen/denormalize veya kaldırılmış
  olmalı. Şimdilik ikisi de yazılıyor; senkron drift riski bilinçli ertelendi.
  Ne zaman: contract surface stabilize olduktan sonra, ilk veri-migration
  penceresinde.

---

## Document authoring — Faz 0/A/B (2026-07)

- **TB-33**: Watermark docx'e gömülmüyor. python-docx'in first-class watermark
  API'si yok; ham OOXML behind-text çapalama kırılgan çıktı
  (`docx_builder.py` ~159). `watermark_image_path` saklanıyor ve FE'de CSS
  önizleme opaklığı için dönüyor, ama .docx'e eklenmiyor. Header/footer gömme
  çalışıyor.
- **TB-34**: `bleach` bakımsız (Mozilla 2023'te bıraktı) ama güvenlik-kritik
  `body_html` sanitizasyonunu o taşıyor (`backend/core/html_sanitizer.py`).
  Bakımlı alternatif: `nh3`. Önceden-var platform tercihi (kök
  `requirements.txt`), authoring işinin getirdiği bir borç değil.
- **TB-35**: Şablon chrome görseli değiştirilince eskisi Storage'da yetim
  kalıyor — `upload_template_chrome` yeni yolu yazıyor, eskisini silmiyor.
- **TB-36**: `sanitize_body_html` sondaki `cleaned[:LIMITS["content"]]` kesmesi
  HTML'i etiket ortasından bölebilir → bozuk markup. Limit uygulanacaksa
  etiket-farkında kesilmeli.
- **TB-37**: `create_template` içinde "önce eskisini deactive et, sonra yenisini
  oluştur" transactional değil — `repo.create` hata verirse proje aktif
  şablonsuz kalır.
- **TB-38** (izleme): materyalizasyondaki referans insert'i `rdata` ile client
  anahtarlarını doğrudan geçiriyor. `create_rfi` aynısını yapıyorsa miras
  davranış; yapmıyorsa allow-list'e daraltılmalı.
- **TB-40**: C1a masking — `_load_contract_parties` / `_load_project_parties`
  hata durumunda `[]` dönüyor (fail-open). Projeler satırı birincil garanti;
  yardımcı kaynak yüklenemezse o kimlikler maskelenmez ve sızabilir.
  Supplementary mask-source yüklemesini fail-closed'a çek ya da
  completeness-check ekle (`masking_service.py`).

## TB-41 — Deterministic masking is a STOPGAP; target is hybrid (deterministic backbone + local NER)

Status: accepted stopgap (Faz C1a). Blocks zero-leak guarantee. Unblocks at: local model availability (Faz-3).

What ships now (C1a): `masking_service.py` masks project/party identities before any text
reaches the AI provider, by EXACT-matching names from the registry (projects
employer/contractor/engineer/name, contract_parties, project_parties) case-insensitively
and whole-word, replacing them with stable tokens (⟦EMPLOYER⟧, ⟦CONTRACTOR⟧, ⟦PARTY_n⟧…).
Model output is de-masked before the user sees it. Empty/failed registry → fail-closed.

Why it's a stopgap (the recall gap): exact-match only finds a name spelled EXACTLY as
stored. It CANNOT catch: typos ("Acme Developement LLC"), abbreviations/variants
("Acme Dev.", "ADL"), OCR-corrupted names, or any party not in the registry. Such a name
reaches the provider UNMASKED and `has_leak()` will NOT flag it (`has_leak` only knows registry
names). Inherent to exact-match masking, not a bug. Acceptance bar today = "cover known
canonical identities," NOT zero-leak.

Target (hybrid): add a LOCAL NER/LLM detector as a front-end to `MaskingProvider`. It finds
identity spans regardless of spelling and feeds the EXISTING deterministic backbone (token
assignment + bijection + de-mask + `has_leak` unchanged). LLM decides WHERE to mask;
deterministic code assigns stable, reversible tokens. This closes the recall gap.

Hard constraint: the mask model MUST be LOCAL / in-region. A cloud model (e.g. Haiku) used
for masking would send raw contract text to the provider in order to mask it — exactly the
S-H4 leak this layer prevents. Cloud masking is self-defeating.

Dependency/timing: no local model runs today; local inference is the Faz-3 (GPU) workstream.
When Faz-3 lands, wire the local NER in front of `MaskingProvider` without touching the backbone.

Related: TB-40 (supplementary mask-source loads currently fail-open).
