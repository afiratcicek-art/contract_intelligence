# Architecture Decision Records (ADR)

Mimari-anlamlı KARARLAR — TB'den (TECHNICAL_DEBT.md) ayrı.
- TB  = düzeltilecek BORÇ (open → fixed → closed).
- ADR = uphold edilecek KARAR + izlenecek koşullar (Proposed → Accepted → Superseded).

## Neyi ADR yaparız
Geri-dönüşü zor, cross-cutting, veya uzun ömürlü invariant dayatan kararlar:
embedding-backend, auth/permission modeli, AI-provider stratejisi, veri-residency, şema-omurgası.
Küçük/yerel seçimler ADR olmaz.

## Protokol (EK-20)
1. ADR, kararın kilitlendiği anda (EK-9) mimar tarafından aynı işte yazılır.
2. Ali onaylar → commit'lenir (ertelenmez).
3. ADR TB doğurabilir: aksiyon gerektiren izleme-kalemleri linkli TB olarak TECHNICAL_DEBT.md'ye düşer.
4. İzleme-tetikleri EK-19 audit'inde, faz-sınırlarında kontrol edilir.
5. INDEX.md her ADR ekleme/değişiminde senkron tutulur (EK-18 mantığı).
6. Karar değişirse: yeni ADR yazılır, eski Superseded(→ADR-NNNN) işaretlenir — silinmez.

Dosya adı: NNNN-kisa-baslik.md (ör. 0001-local-embedding.md).
