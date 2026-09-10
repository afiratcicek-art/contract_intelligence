# ADR-0005: Tam maske mimarisi — 4 katman (registry + GLiNER-NER + regex + acronym/allowlist) + tutar-proxy ölçekleme
- Durum: Accepted
- Tarih: 2026-08-30
- Karar veren: Ali
- İlgili: ADR-0004 (GLiNER motor kilidi), ADR-0001 (lokal-embedding), INV-MASK-1..5, S-H4, INV-EGRESS/INV-DATA, faz-c-llm-spine.md (2026-08-20 mask EK-9 ölçüm+kilit serisi), masking_service.py, migration 056
- NOT: Bu belge, 2026-08-30 tarihli ilk ADR-0005 taslağını SUPERSEDE eder. İlk taslak yalnız tutar+belge-no'yu kapsıyordu ve 2026-08-20'de kilitlenmiş acronym-alias / don't-mask-allowlist / regex-katman / precompute kararlarından habersiz yazılmıştı (mimar faz-c-llm-spine.md'yi geç okudu). Bu v2 iki kaynağı birleştirir.

## Bağlam
İki bağımsız ölçüm serisi aynı mask mimarisine vardı, birleştiriliyor:

Kaynak A — 2026-08-20 (faz-c-llm-spine.md, gerçek 121-sayfa GCC sözleşmesi + sandbox): GLiNER urchade/gliner_multi-v2.1 kilitlendi (recall %88, Arapça dahil, typo 20/20, bozuk-Arapça org'ları bile yakaladı). 4-katman mask + tutar-maske + precompute mimarisi kilitlendi. v2 karne D=0 (registry+acronym+fail-closed => gerçek sözleşmede 0 ad + 0 tutar sızdı). Gerçek-veri bulgusu: 9 "Full Name (ACRONYM)" çiftinden 8'i kamu-kurumu/jenerik (SAMA, CCHI, "NDA"=belge-türü) => over-mask her şeyi çözmez, don't-mask-allowlist ŞART.

Kaynak B — 2026-08-30 (bu oturum, 5000+ ground-truth senaryo istatistik): Kimlik recall %100 (1000-senaryo). contract price GLiNER-label money'yi tuzaklardan (256 gün/%200/madde-no) ayırıyor (trap-FP K2 ile %18). torch cp314 = 122MB (Kaynak-A'nın "~2.3GB" tahminini 20x düzeltti — CPU-only wheel). Fine-tune fizibilitesi doğrulandı (gliner.train_model + ner_negatives). KRİTİK SENTEZ: belge-no GLiNER-label denendi => %7.6 toxic-confusion (docref->price), hiçbir konfigde (5 tur) çözülmedi => Kaynak-A'nın "sözleşme-no = regex-katman" planını istatistikle DOĞRULADI. Bare-number (1300000403) GLiNER'a yapısal uygun değil; belge-no GLiNER-label DEĞİL, regex/yapısal katmana ait.

## Karar
Mask = 4 katman, mevcut tersinir token-omurgasına (ADR-0004) entegre, sıralı:

Katman 1 — Registry (deterministik, PRIMARY): projects/contract_parties/project_parties bilinen tarafları => rol-token. Tüm-oluşum whole-word replace. v2 karne D=0'ın birincil sebebi. (MEVCUT C1a çekirdeği.)

Katman 1b — Acronym-alias kuralı (deterministik, ML'siz): "Full Name (XYZ)" desenini yakala => XYZ'yi registry'ye ekle. Kısaltma vakasını (Ali'nin en baştaki uyarısı, gerçek-veride 9 çift kanıtlı) NER'siz çözer.

Katman 2 — GLiNER NER-sweep: urchade/gliner_multi-v2.1 @0.30, etiketler = kimlik (person/org/loc) + contract price + negatif-label seti (clause reference/time period/percentage/date/quantity — tuzak-koruma). Yalnız KAYITSIZ/typo/Arapça taraf + tutar için ek-ağ. S2a/S2b build edildi.

Katman 2b — Don't-mask allowlist (precision): kamu-kurumu/jenerik terim listesi (SAMA, CCHI, kamu-otoriteleri, belge-türü-kelimeleri) => yakalansa bile MASKELENMEZ. Küçük, denetlenebilir, gerçek-veri gerektirdi.

Katman 3 — Regex/yapısal katman (deterministik, format-tanımlı): YAPISAL tanımlayıcılar => email, telefon, IBAN, ulusal-ID/Iqama, VAT, CR. Bunlar checksum/sabit-format taşır => regex GÜÇLÜ, GLiNER zayıf (bu oturum: email->PERSON@ORG parçalanması). Belge/referans-no (LC/fatura/bond/promissory) = AÇIK ALT-SORUN (TB-62).

Katman 4 — has_leak (INV-MASK-4): saf fail-closed doğrulayıcı; payload'ı DEĞİŞTİRMEZ; mask ile SİMETRİK eşik (@0.40). Blok = bozuk-token ∪ registry-ham ∪ allowlist-dışı NER-entity (mask-eşiğinde). Simetri → mask'in maskelediğini has_leak tekrar entity sanmaz (over-block yok); kaçırdığını bulursa True. recover yok.

Reddedilen alternatifler:
- (a) asimetrik has_leak (mask'ten agresif, örn. @0.25 / @0.15) → over-block [TB-64].
- (b) recover-in-has_leak (yerel kopyayı maskele, payload'a yazma) → payload/verdict uyuşmazlığı, sessiz egress [bu oturum: اتف BLOCK→LEAK ölçüldü].

TUTAR (Katman 2 içinde, özel işlem — 2026-08-20 B1 kilit): para => proje-scope gizli faktör k ile ÖLÇEKLE (lineer, precompute). Token = görünür-proxy AMT_n:proxy = (a) görünür ölçekli-sayı [Claude oran/aritmetik yapar], (b) "maskeli-vekil, gerçek değil" sarması [Ali istedi], (c) demask çıpası. %/gün/madde MASKELENMEZ (ölçek-değişmez + LD muhakemesi). Demask 3-durum: proxy-aynen->geri-map / Claude-yeni-sayı->böl-k / oran-%->dokunma. Kesinlik gerekince hesap YERELDE gerçek-değerle, Claude yorum için.

PRECOMPUTE + versiyon-remask (2026-08-20): yüklemede maskele + 3-sakla (HAM [embed+kullanıcı] + MASKELİ [Claude payload] + TOKEN-HARİTA [demask]), üçü KSA-içi. Sorgu-anı NER KOŞMAZ (hazır-maskeliyi çek). mask_version = registry+model+parse sürümü; yeni taraf düşünce eski belgeler HAM aranır => otomatik geriye-dönük re-mask. GARANTİ: egresste her payload'a CANLI has_leak (saklı-maske=performans-önbelleği, güvenlik değil).

## Gerçekleşme sırası (build slice)
S2a (GLiNER altyapı) + S2b (chokepoint wiring) + S3 (recall kanıtı) BU OTURUMDA build edildi. EKSİK (sonraki oturum): acronym-alias (1b) + don't-mask allowlist (2b) + regex-katman (3) + has_leak finansal-fix (4, kod-fix owed) + tutar-proxy ölçekleme + k-tablosu (migration 056) + precompute+versiyon-remask (ingestion worker).

## Sonuçlar — dayatılan INVARIANT'lar
- INV-MASK-6 (k gizliliği): k proje-scoped, kullanıcı-görünmez, sınır-dışı-çıkmaz. Saklama = migration 056 project_masking_config, service_role-only (member-read YOK; projects tenant-geniş-SELECT ve project_config member-read ikisi de fazla-açık). build() k'yi service_role ile okur.
- INV-MASK-7: her analiz-promptuna "tutarlar ölçekli-proxy, mutlak-değer üretme; %/gün/madde gerçek" sistem-notu gider.
- INV-MASK-8: belge/referans-no ölçeklenmez (maske-token, birebir-demask); ASLA k ile çarpılmaz.
- INV-MASK-9 (şema-tutarlılık): etiket-şeması (sınıflar + negatif-label) fine-tune veri-üreticisiyle aynı => Faz-3 sürtünmesiz.
- INV-MASK-10 (katman sırası): registry+acronym (deterministik) => regex (yapısal) => GLiNER (kalan) => allowlist-filtre => has_leak. Deterministik/yapısal katmanlar NER'den ÖNCE.
- INV-MASK-11 (registry precedence): Katman-1 registry, Katman-2b allowlist'ten BAĞIMSIZ ve ondan önce uygulanır (ayrı kanal: registry `_mask_pairs` üzerinden `\b`-substitüsyon; allowlist yalnız NER→dynamic yolunu keser). Bir kamu-kurumu adı allowlist'te OLSA BİLE, o kurum bu projenin TARAFI olarak registry'ye kayıtlıysa registry rol-token'ı (`⟦EMPLOYER⟧` vb.) kazanır. Allowlist'in anlamı "kayıtsız dış-kurum/regülatör maskelenmesin" (bağlam korunur), "bu isim asla token olmasın" DEĞİL. Örnek: JEDCO (taraf→registry→`⟦EMPLOYER⟧`) vs GACA (dış-regülatör→allowlist→ham). Bespoke: aynı kurum bir sözleşmede taraf, başkasında regülatör olabilir; registry-üyeliği ayrımı yapar, statik liste değil.
- INV-MASK-4 (has_leak = saf fail-closed doğrulayıcı): mask ile SİMETRİK eşik; payload'ı değiştirmez; recover yok. Blok = bozuk-token ∪ registry-ham ∪ allowlist-dışı NER-entity (mask-eşiğinde). Simetri → over-block yok. Reddedilen: (a) asimetrik has_leak (mask'ten agresif) → over-block [TB-64]; (b) recover-in-has_leak (yerel kopyayı maskele) → payload/verdict uyuşmazlığı, sessiz egress [bu oturum: اتف BLOCK→LEAK ölçüldü].
- ARTIK-RİSK (adlandırılır, papering yok): kayıtsız-taraf + NER-imperfect => fail-closed/over-mask + acronym ile sınırlı ama sıfır DEĞİL. Serbest-format belge-no toxic %7.6 = zero-shot sınırı, SIZINTI DEĞİL (gizli kalır, demask-bozulması). Mask-eşiği-altı garbled fragment (ör. اتف) NER-görünmez → registry (birincil) + gerçek-bağlam NER (--local) + parse ile kapanır; has_leak'in işi değil.

## İzleme-tetikleri
- Fine-tune (Faz-3): fizibilite doğrulandı (gliner.train_model + {tokenized_text,ner} + ner_negatives + GPU bulut/segment-B). Hedef: serbest-format belge-no toxic %7.6->~%2, trap-FP->min. Veri = STAT-şablonu + gerçek-pilot (INV-DATA sonrası).
- Slice-Y (lokal embedding): pdf_pipeline_service.py:181 ham clean_text maskesiz embed edecek => precompute-maske embedding'i de sarmalı (TB-63). Bugün kanal ölü.
- Recall AR eşik-altı => NAMAA arabic-fine-tune model.
- TB-67: _trim_allowlisted_edges kenar-kelimeyi (Client/Company) kırpıp ham bırakabilir; ayırt-edici kısım maskeli, düşük risk, precision-tune bekliyor.
- INV-MASK sub: mask/has_leak substitüsyonu \b DEĞİL (?<!\w)…(?!\w) lookaround — dotted legal form (W.L.L./LLC./Co.) \b'de sınır bulamıyordu (sızıntı). \b'ye geri döndürme. Neg: ZenithX↛Zenith.
- INV-MASK sub whitespace-esnek (\s+): satır-sonu/çoklu-boşlukla bölünen bilinen taraf (S10) deterministik kapanır; NER(c)'ye bağımlı değil. Ortaya kelime girmez.

## Doğurduğu TB'ler
- TB-62: serbest-format belge/referans-no (LC/fatura/bond/promissory) sınıflandırma — regex kırılgan (Ali: typo/format sonsuz) + GLiNER %7.6 toxic. Pilot: fail-closed+over-mask+has_leak-net. Fine-tune Faz-3 hedefi. Sonraki oturumda taze-test edilecek.
- TB-63: Slice-Y embedding maske-tutarlılığı (ADR-0001 kesişimi).
- TB-64: has_leak over-block precision — @0.25 agresif eşik temiz-maskeli metni bloklarsa ürün ölü doğar; taze-test temiz-maskeli metin has_leak=False döndüğünü ölçer.
- TB-65: egress-anı NER-latency — precompute öncesi mask_context+has_leak istek başına çok-pass; test_lat_profile ölçmeye başladı; migration 056 precompute kapatır.
- TB-66: GLiNER possessive/birleşik-ad span-sınırı — "X's Company" tek org-span verilmiyor (ayırt-edici kısım ör. "Jeddah Airport" LOC maskelenir, "'s Company" ham kalır). Sızıntı DEĞİL (ham taraf-adı çıktıda yok, ayırt-edici kısım maskeli); estetik/legibility. Fix seçenekleri: span-birleştirme veya possessive-desen kuralı; karmaşıklık/güvenlik-kazanç sıfır → şimdilik ertelendi.
