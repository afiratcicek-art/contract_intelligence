# ADR-0001: Yerel (lokal) embedding — dış-sağlayıcı embedding kanalını değiştir

- Durum: Accepted
- Tarih: 2026-07-28
- Karar veren: Ali
- İlgili: S-H4 (OpenAI kanalı), 018 dim-migration (owed), Faz C / C1b, Faz-3 lokal-LLM yol haritası

## Bağlam
Ölçüldü: doküman embedding'i parse edilmiş TAM belge chunk'larını OpenAI'a MASKESİZ gönderiyordu
(embedding_service.py:150), otomatik, her upload'da — C1a maskesi yalnız Anthropic chat kanalını
sarıyordu; bu OpenAI kanalı S-H4'ün açık ikinci koluydu. Kanal şu an DORMANT (OPENAI_API_KEY yok),
semantik arama canlı değil (sorgu-embed yazılmamış) → greenfield. GCC/KSA residency: "KSA'da depolama
şart" → sınır-aşan embedding egress'i zaten sürdürülemez.

## Karar
Embedding, dış sağlayıcı (OpenAI) yerine YEREL, in-process ONNX modeliyle (fastembed) üretilecek.
Model = intfloat/multilingual-e5-large (çok-dilli EN/AR, 1024-dim, fastembed-ONNX) — sözleşmeler iki-dilli
olabildiği ve Arapça prevail edebildiği için çok-dilli zorunlu. (dense+sparse aday fastembed TextEmbedding
API'sinde yok; e5-large eşdeğer kalite + aynı 1024-dim, ölçüldü dim=1024.)

## Gerekçe
Ölçülmüş: fastembed torch-SUZ (~200MB lib, marjinal ~130MB), CPU embed ~10ms/chunk (Ali laptop),
kalite text-embedding-3-small ile eşdeğer/üstü. Greenfield → re-embed maliyeti şu an sıfır.
Masking-embed karmaşasını (stabilite-ledger + tutarlılık + non-deterministik-mask kırılganlığı)
tamamen ELER → C1b sadeleşir. Laptop→prod SÜREÇLE taşınır (cloud gibi prod'da yeniden-mimari yok).
Residency kilidini açar. Alternatif (masked-cloud-embedding) reddedildi: kalıcı ledger/tutarlılık
yükü + KSA'da zorunlu sökme.

## Sonuçlar — dayatılan INVARIANT'lar
1. Embedding LOKAL üretilir; ham metin vektörleştirme için dış sağlayıcıya GİTMEZ.
2. Model-load LAZY + tek-sefer, süreç-ömrü cache — get_embedding_service() singleton/module-cache
   olmalı (bugün her çağrı yeni instance = lokal'de kabul edilemez).
3. Model dosyası + fastembed sürümü VENDOR'LU + exact-PINNED — laptop→prod birebir aynı vektör uzayı;
   runtime'da HF CDN bağımlılığı yok (air-gap/residency).
4. Ham chunk metni DB'de saklı kalır (chunk_text, zaten böyle); retrieval vektörle bulur, ham metni
   çeker; kullanıcıya/LLM'e giden metin ayrı katmanda (C1a) maskelenir.
5. Sorgu-tarafı embed (yazıldığında) AYNI lokal modeli kullanır — vektör-uzay tutarlılığı.
6. e5 önek-konvansiyonu ZORUNLU: ingest chunk'ları "passage:", sorgu "query:" önekiyle embed edilir — ingest ve sorgu AYNI model + AYNI önek (aksi halde vektör-uzay tutarsız).
7. Vektör boyutu nihai modele göre BİR KEZ kilitlenir (018 dim-migration); sonraki model değişimi =
   bilinçli re-embed operasyonu.

## İzleme-tetikleri (EK-19 faz-sınırında kontrol)
- Korpus büyüdükçe model-swap/re-embed maliyeti.
- ✅ Çok-dilli (EN/AR) KARŞILANDI: multilingual-e5-large seçildi (fastembed-ONNX, dim=1024); sonraki dil-genişlemesi → yeniden değerlendir.
- Prod-grade altyapıya geçiş → kapasite/deployment revizyonu.
- Belirgin üstün yeni model → dim-migration kararı.

## Doğurduğu TB'ler
- 018 dim-migration (1536 → 1024, multilingual-e5-large) + re-embed.
- get_embedding_service singleton refactor.
- openai==1.59.9 paketini düşür (yalnız embedding'de kullanılıyordu).
- model dosyası vendoring + sürüm pinning.
