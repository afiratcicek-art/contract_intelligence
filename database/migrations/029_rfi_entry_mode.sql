-- Migration 029: RFI entry mode
-- Author: ClauseIQ
-- Applied: Applied: 2026-07-09
--
-- entry_mode, belgenin PLATFORMDA mi dogdugunu soyler; kim yazdigini degil.
--   authored -> platformda yazildi -> 'draft' dogar, onay ile 'open'a gecer,
--               submitted_date ve response_due_date onay aninda atanir
--   recorded -> disarida yazilmis/gelmis belge kayda geciriliyor -> 'open' dogar,
--               onay gerekmez, submitted_date kullanicidan gelir
--
-- entry_mode YARATILDIKTAN SONRA DEGISMEZ (tarihsel olgu, tercih degil).
-- Onaydan sonra ikisi de status='open' olur; ayirt edici tek sey bu kolondur.
-- Mevcut kayitlarin tamami gercekten sunulmus belgelerdir -> DEFAULT 'recorded'.

BEGIN;

ALTER TABLE rfis
    ADD COLUMN IF NOT EXISTS entry_mode TEXT NOT NULL DEFAULT 'recorded';

ALTER TABLE rfis DROP CONSTRAINT IF EXISTS rfis_entry_mode_check;
ALTER TABLE rfis ADD CONSTRAINT rfis_entry_mode_check
    CHECK (entry_mode IN ('authored', 'recorded'));

-- authored RFI taslaktir: henuz sunulmadi, sunum tarihi yoktur.
-- Tarih ve deadline onay aninda atanir. Bu yuzden NOT NULL kalkiyor.
ALTER TABLE rfis ALTER COLUMN submitted_date DROP NOT NULL;

-- Ama invaryant kaybolmuyor, kosullu hale geliyor:
-- kaydedilen (recorded) bir belge MUTLAKA sunum tarihi tasir,
-- aksi halde deadline hic hesaplanmaz -> sessiz time-bar kaybi.
ALTER TABLE rfis DROP CONSTRAINT IF EXISTS rfis_recorded_needs_submitted_date;
ALTER TABLE rfis ADD CONSTRAINT rfis_recorded_needs_submitted_date
    CHECK (entry_mode = 'authored' OR submitted_date IS NOT NULL);

COMMIT;

-- DOGRULAMA (Ali calistiracak):
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'rfis'::regclass AND conname = 'rfis_entry_mode_check';
-- SELECT entry_mode, status, count(*) FROM rfis GROUP BY 1,2;
-- SELECT count(*) FROM rfis WHERE submitted_date IS NULL;   -- beklenen: 0
