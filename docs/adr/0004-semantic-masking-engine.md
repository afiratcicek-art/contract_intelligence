# ADR-0004: Semantik maskeleme motoru — lokal GLiNER NER, deterministik token-omurgası korunur
- Durum: Accepted
- Tarih: 2026-08-29
- Karar veren: Ali
- İlgili: ADR-0001 (lokal-inference disiplini), ADR-0003 (anti-sahte-kontrol), TB-41 (deterministik stopgap), S-H4, INV-EGRESS/INV-DATA/INV-PORT, backend/services/masking_service.py, P-B4 (deploy imaj footprint)

## Bağlam
Bugünkü maskeleme deterministik exact-match (TB-41 stopgap): `MaskingProvider` registry'deki bilinen taraf-adlarını (`projects`, `contract_parties`, `project_parties`) toplar, `MaskSession.mask()` bunları `\bad\b` regex ile token'lar (⟦EMPLOYER⟧ / ⟦CONTRACTOR⟧ / ⟦ENGINEER⟧ / ⟦PROJECT⟧ / ⟦PARTY_n⟧). Bu tasarım gereği typo / kısaltma ("ABC" ↔ "A.B.C. Ltd") / OCR-varyant / kayıtsız-yeni taraf adını KAÇIRIR — ham kimlik provider'a maskesiz gider ve `has_leak()` de bunu göremez (yalnız registry adlarını bilir). Ali'nin settled ilkesi: deterministik exact-match = sahte-kontrol riski (residency/INV-EGRESS iddiasını çürütür); semantik NER şart.

Ölçüldü (2026-08-29): (1) backend'de sıfır ML-dependency (maskeleme saf-Python). (2) Chokepoint sözleşmesi temiz — `MaskSession.mask()`/`has_leak()`, `claude_service._mask_session_or_block` üzerinden 7 call-site'ı besliyor. (3) `masking_service.py` docstring'i hedef mimariyi zaten tanımlıyor: "a local NER detector fronts this module... feeding this same deterministic token backbone (assignment + bijection + de-mask unchanged)." (4) Paketleme (gerçek Linux footprint): Yol A `gliner`+torch ~0.8-1 GB (model-kilidi korur, kararlı API) vs Yol B `gliner2-onnx` ~0.31 GB (torch-suz ama "experimental, API may change between versions" + modeli GLiNER2'ye değiştirir). torch cp314 wheel dev (Windows) + prod (Linux) için MEVCUT → wheel-blocker yok.

## Karar
Semantik NER motoru = resmî **`gliner`** paketi (Yol A), **çok-dilli GLiNER modeli, vendor-pinli**, lokal/CPU inference. `MaskSession.mask()`/`has_leak()`'in **altına**, chokepoint arkası, **sıfır call-site değişikliği**. Kapsam = ham GLiNER + mevcut registry (consistency-supplement) + ince regex kural katmanı (email/ID/sözleşme-no), hepsi `masking_service.py` içinde. **Presidio kullanılmaz.**

## Gerekçe
Recall = güvenlik önceliği: bir varyant kaçarsa ham kişisel-veri sınırı geçer, residency iddiası sahte-kontrol olur. Motor lokal ZORUNLU — bulut-NER ham metni maskelemek için dışarı çıkarır, amacı yener (S-H4). Registry SİLİNMEZ (EK-10): primary değil ama bilinen tarafları tutarlı pseudonyme sabitler (kalite ekseni). Yol B (torch-suz, ~200M hafif) REDDEDİLDİ: kütüphanenin kendi uyarısı "API her sürümde değişebilir" + model-ailesini değiştirmesi GCC taraf-adı recall'ının yeniden-doğrulanmasını gerektirir = solo-dev tuzağı; ~200M avantajı DEFER-kovasına (deploy imaj boyutu) ait, bakılabilirlik ise DO-NOW-ve-sonsuza-kadar → yanlış takas. Presidio REDDEDİLDİ: spaCy + kendi AnalyzerEngine/AnonymizerEngine katmanı = daha çok hareketli parça; mevcut çalışan token-omurgasını yeniden-yazmak gerekir.

## Sonuçlar — dayatılan INVARIANT'lar
- **INV-MASK-1:** Maske motoru lokal/CPU, sıfır dış-çağrı (INV-EGRESS altı; yinelenen API masrafı $0).
- **INV-MASK-2:** Model dosyası + `gliner` sürümü vendor'lı/pinli → laptop ↔ prod birebir aynı maske çıktısı (residency + pseudonym-consistency).
- **INV-MASK-3:** Fail-closed — model yükleme/inference başarısız → `build()→None` → gate-block; ham veri provider'a gitmez.
- **INV-MASK-4:** Recall-öncelik; belirsizlikte over-mask. Registry primary değil, consistency-supplement (EK-10: silinmez).
- **INV-MASK-5:** Chokepoint sözleşmesi (`mask`/`demask`/`has_leak`/`mask_context` imzaları + `build()→MaskSession|None`) değişmez; semantik motor drop-in.

## İzleme-tetikleri
- GCC Arapça+İngilizce taraf-adı recall'ı (sentetik ölçüm) eşik-altı → model/eşik revizyonu (TB-60 Arapça parse-kalitesine bağımlı — bozuk metin → bozuk NER).
- Deploy imajında torch-cpu-slim uygulandı mı (TB-61 / P-B4).
- `gliner` sürüm bump'ı → maske-çıktı diff kontrolü (INV-MASK-2 vendor-pin ihlali riski).
- NER'in hedef span-tipleri (PERSON/ORG/LOC) GCC-dışı yeni bir entity-tipi (ör. koordinat, ticari-şart) gerektirirse → bu ADR yeniden açılır (Segment-B lokal-LLM tartışmasıyla kesişir).

## Doğurduğu TB'ler
- **TB-61:** torch-cpu-slim deploy imajı footprint optimizasyonu (P-B4'e bağlı).
- **TB-41 güncellemesi:** stopgap → semantik-katman-altında consistency-supplement'e indirgendi; KAPANMAZ/SİLİNMEZ (EK-10, deterministik omurga korunur).
