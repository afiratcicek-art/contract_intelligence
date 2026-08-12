# ADR-0002: Migration Runner — doğrudan-PG mekanizması + secret/rol izolasyonu

- Durum: Accepted
- Tarih: 2026-08-10
- Karar veren: Ali
- İlgili: P-B3 (production-grade ark), database/migrations/ (51 dosya), EK-20, doğacak TB'ler

## Bağlam
Ölçüldü (2026-08-10, Cursor tracked-only): database/migrations/ altında 001–054 arası 51 migration
(040/041/042 tombstone — 039–042 contract-root konsolidasyonu); + 1 backfill + 4 view ayrı
yaşam-döngüsünde. Üç kritik boşluk: (1) uygulanan-migration state'ini tutan tablo/kayıt YOK —
canlıya hangi migration'ın uygulandığı deterministik cevaplanamıyor; (2) mevcut runner/apply
script YOK; (3) Supabase CLI YOK (supabase/ dizini yok) → migration'lar dashboard SQL editor'den
ELLE uygulanıyor. Ayrıca app bugün doğrudan-Postgres bağlantısı KULLANMIYOR — yalnız PostgREST +
service_role anahtarı/HTTPS (config.py:6-8, database.py:13-26). Deterministik/devir-edilebilir
migration uygulaması için runner gerekli; ama app'in bugün ihtiyaç duymadığı iki yeni şey getiriyor:
tam DDL + tüm-veri erişimli DB bağlantı-string'i (yeni secret sınıfı) ve bir Postgres wire-driver
(yeni dependency).

## Karar
database/migrations/*.sql'i deterministik+idempotent uygulayan, uygulanan-state'i bir
schema_migrations bookkeeping tablosunda tutan, doğrudan-Postgres bağlantısını psycopg v3 (senkron)
ile ayrı gitignored .env.migrations'taki MIGRATION_DATABASE_URL'den okuyan, YALNIZ DDL/migration
kapsamlı bir Python CLI runner inşa edilir. Baseline = 001-054 için "adopt" (çalıştırmadan
applied-işaretle); checksum-drift'te fail-loud.

## Gerekçe
PostgREST DDL koşamaz → doğrudan-PG şart. Driver ölçüldü: SQLAlchemy (ORM makinesi=gereksiz ağırlık,
ret), asyncpg (tek-atışlık CLI için async fazlalık, ret), psql'e shell-out (bağlantı-string
komut-satırına düşer → INV-5 redaksiyonu bozar + psql binary bağımlılığı, ret) → psycopg v3 hem en
hafif hem redaksiyon açısından en güvenli (string Python-env'inde kalır). Secret ayrı .env.migrations'ta:
app-sunucusu .env yükler; MIGRATION_DATABASE_URL'i oraya KOYMAMAK, çalışan sunucu-sürecinin
DB-şifresini env'inde HİÇ taşımamasını sağlar. Baseline adopt: eski migration'lar tam-idempotent değil
→ canlıda re-run "already exists" patlar; var-olanı çalıştırmadan işaretlemek tek güvenli yol.
requirements-migrations.txt (ne runtime ne CI): app yüzeyi + CI yüzeyi değişmez.

## Sonuçlar — dayatılan INVARIANT'lar
1. (INV-1 Rol-ayrımı) Cursor runner KODUNU yazar/düzenler; runner'ı canlı/gerçek DB'ye karşı ASLA
   çalıştırmaz. Migration'ı canlıya YALNIZ Ali uygular (kendi terminali/env'i).
2. (INV-2 Secret-izolasyonu) DB bağlantı-string'i yalnız gitignored .env.migrations'ta; koda/committed
   dosyaya/terminal-echo'ya ASLA girmez. .env.example boş şablon, kontrol yüzeyi değil.
3. (INV-3 Cursor↔secret duvarı) Cursor'a her ölçüm tracked-only (git grep/git ls-files) — gitignored
   secret'ları yapısal göremez. Cursor .env, .env.migrations, system.enc, .gitignore ve canlı-DB
   bağlantısına DOKUNMAZ.
4. (INV-4 En-az-yetki) Runner yalnız DDL/migration kapsamlı; kullanıcı-tablosu SELECT/dump yeteneği
   YOK → kötüye-kullanım blast-radius'u küçük.
5. (INV-5 Redaksiyon) Runner bağlantı-string'i/secret'ı loglamaz; her çıktıda redakte eder.
6. (INV-6 Test-izolasyonu) Runner test edilecekse Ali'nin kontrol ettiği tek-kullanımlık/lokal
   dummy-veri DB'sine karşı; Cursor asla canlıya yöneltmez.
7. schema_migrations bir ALTYAPI tablosudur (bootstrap IF NOT EXISTS), domain-migration DEĞİL —
   migration dizisine (055...) girmez.
8. psycopg yalnız requirements-migrations.txt'te; runtime requirements.txt'e veya CI'ın kurduğu
   requirements-dev.txt'e sızması = ihlal.
9. tx-model (up, YOL 2): her migration autocommit=False dış-tx'te koşulur; dosya SQL'i + bookkeeping INSERT aynı tx (execute/INSERT cursor'dan). tx-ifadesiz dosyalar tam-atomik; kendi BEGIN;/COMMIT;'ini taşıyan eski dosyalarda dar, bilinçli, adopt-ile-kurtarılabilir bir pencere kalır. Yeni migration'lar tx-ifadesiz yazılır (kural: scripts/README.md). Karar gerekçesi: byte-sadık provenance + küçük/fail-loud güvenlik yüzeyi + devir-edilebilirlik > runtime-SQL-strip'in sıfır-pencere avantajı.

## İzleme-tetikleri
- Her canlı migration-apply öncesi git check-ignore -v .env.migrations (+ .env) — secret dosyası
  gerçekten ignored mı.
- psycopg runtime requirements.txt'e veya requirements-dev.txt'e sızdı mı (git grep).
- Runner'a herhangi bir data-read/dump yeteneği eklenmesi → bu ADR'yi YENİDEN açar (INV-4 ihlali).
- Prod-grade altyapıya/ayrı prod-DB'ye geçiş → bağlantı-kaynağı + residency (KSA) revizyonu.
- Çoklu-ortam (dev/staging/prod ayrı DB) ihtiyacı → tek MIGRATION_DATABASE_URL modeli yeniden değerlendirilir.

## Doğurduğu TB'ler
- .env.migrations.example boş şablon + .gitignore kuralı (.env.migrations) — Ali ekler.
- İlk-canlı-apply öncesi git check-ignore -v .env.migrations kapısı (operasyonel checklist).
