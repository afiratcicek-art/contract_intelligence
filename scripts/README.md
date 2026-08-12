# Migration Runner (`scripts/migrate.py`)

ClauseIQ şema evrimini deterministik + denetlenebilir yürüten ops-aracı
(ADR-0002). Migration'lar `database/migrations/NNN_*.sql`; uygulanan-durum
`schema_migrations` tablosunda checksum'la tutulur.

## Komutlar
- `python -m scripts.migrate status` — applied / pending / drift özeti (salt-okur).
- `python -m scripts.migrate adopt [--yes]` — mevcut şemayı ÇALIŞTIRMADAN
  applied işaretler (canlıya elle uygulanmış 001-054 için bir-kerelik baseline).
- `python -m scripts.migrate up [--yes]` — bekleyen migration'ları SIRAYLA koşar.

Bağlantı yalnız gitignored `.env.migrations` içindeki `MIGRATION_DATABASE_URL`'den
okunur (bkz. `.env.migrations.example`). App-sunucusu bu dosyayı OKUMAZ (INV-2).

## `up` işlem modeli (tx-model — YOL 2)
Her migration kendi dış-transaction'ında çalışır: dosyanın SQL'i olduğu gibi
koşulur, ardından aynı tx içinde `schema_migrations`'a checksum'lu bir satır
yazılır, sonra commit. Uygulama-öncesi checksum-drift kontrolü fail-loud'dur
(applied bir dosya değişmişse HİÇBİR şey uygulanmaz). İlk hatada runner durur ve
uygulandı/patladı/koşulmadı özetini basar.

### Yeni migration yazma kuralı (ÖNEMLİ)
Yeni migration dosyalarını **`BEGIN;`/`COMMIT;` YAZMADAN** ekle — transaction'ı
runner yönetir. Böylece SQL ve bookkeeping tek atomik tx'te uygulanır (yarım-yazma
imkânsız). Eski dosyalar (027-054) tarihsel olarak kendi `BEGIN;/COMMIT;`'ini
taşır; bunlar checksum-kilitli, DEĞİŞTİRİLEMEZ — ve `up` normalde onları koşmaz
(adopt ile applied'dır).

### Atomiklik penceresi ve kurtarma
Kendi `BEGIN;/COMMIT;`'ini taşıyan bir dosyada, dosya-içi COMMIT dış-tx'i erken
kapatır; SQL commit'i ile bookkeeping arasında süreç ölürse SQL uygulanmış ama
kaydedilmemiş kalabilir. Bu pencere yalnızca eski dosyaları sıfırdan koşan nadir
"fresh bootstrap" hâlinde geçerlidir. **Kurtarma:** sonraki `up`, o migration'ı
tekrar deneyip "already exists" ile durur → `adopt` o version'ı applied işaretler
→ `up` kaldığı yerden devam eder. tx-ifadesiz (yeni) dosyalarda böyle bir pencere
yoktur.
