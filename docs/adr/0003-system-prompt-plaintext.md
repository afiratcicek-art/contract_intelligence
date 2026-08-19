# ADR-0003: Sistem-prompt at-rest şifrelemesi — iddia gerçeğe hizalandı, gerçek şifreleme deploy-turuna ertelendi

- Durum: Accepted
- Tarih: 2026-08-19
- Karar veren: Ali
- İlgili: P-S2 (eski S-H3), commit 1ced293, backend/services/claude_service.py, P-B4 (Docker/deploy), TB-57

## Bağlam
Sistem-prompt (ClauseIQ'nun fikri mülkiyeti: domain-çerçeve, gate/prompt mantığı) at-rest "şifreli" saklanıyormuş gibi beyan ediliyordu ama değildi. Ölçüldü (2026-08-19): `SYSTEM_PROMPT_PATH=prompts/system.enc` + `SYSTEM_PROMPT_KEY` config vardı; ama (a) kod tabanında hiç decrypt/kripto-lib yok (cryptography/Fernet/AES → 0 eşleşme, requirements'ta da yok), (b) `SYSTEM_PROMPT_KEY` sıfır call-site = ölü config, (c) `claude_service.py:223` `open(...,"r")` düz-metin okuyor, (d) `prompts/` klasörü diskte yok → qualified katman jenerik fallback prompt'la çalışıyordu, sessizce (yalnız `warning` log). İddia ≠ davranış: olmayan bir kontrol beyan ediliyordu (ISO 27001 / SOC 2 / TÜBİTAK "sahip olmadığın kontrolü iddia etme" ilkesine aykırı).

## Karar
İddiayı gerçeğe hizala: `.enc`→`.txt`, ölü `SYSTEM_PROMPT_KEY` silindi, docstring/yorum düz-metin gerçeğini söylüyor, prompt-eksik durumu artık `error` loglanıyor (görünür sessiz-degrade). Gerçek at-rest şifreleme (Yol-2) bugün KURULMADI; KSA-server/KMS deploy-turuna ertelendi.

## Gerekçe
At-rest şifreleme yalnız tek tehdide karşı işe yarar: ciphertext sızar ama saldırgan anahtara ulaşamaz — ve bu ancak anahtar ciphertext'ten AYRI durursa geçerli. Bugün laptop ortamında anahtarın tek yeri disk (`.env`, dosyanın yanı) olurdu → diske erişen hem ciphertext'i hem anahtarı alır → şifreleme etkisiz, sahte-güven. Gerçek koruma değeri KMS/secrets-manager (anahtar diskte değil) ile doğar; onu getiren adım = P-B4 server/deploy turu. Varlık = IP (ticari-hassas), kişisel-veri değil → regülasyon at-rest kripto zorlamıyor; residency ekseni (yurt-içi + egress-yok) sözleşme metni içindir (S-H4/Faz-C/ADR-0001), sistem-prompt değil. Alternatif "bugün gerçekten şifrele" reddedildi: değer sıfır + yeni-dependency + boot-karmaşası + iki-kez-kurma (laptop sonra server) + devir-yükü.

## Sonuçlar — dayatılan INVARIANT'lar
- `prompts/` altındaki prompt dosyası HER uzantıda gitignored kalır (repo'ya hiç girmez); repo private.
- Sistem-prompt = IP, kişisel-veri değil; residency/egress kontrolleri sözleşme metni içindir, prompt için değil.
- Server'a geçince: prompt runtime-only çözülür; anahtar KMS'te, diske düz-metin yazılmaz.
- İddia = davranış: kod şifreleme beyan etmez; ne yapıyorsa onu söyler.

## İzleme-tetikleri
- KSA-server / P-B4 deploy turunda KMS/secrets-manager provision edildiğinde → Yol-2 gerçek at-rest şifreleme yeniden değerlendirilir (anahtar KMS'te, ciphertext'ten ayrı; `_get_system_prompt` boot'ta decrypt).
- Aynı turda fallback 5a (`error`-log + jenerik prompt, ürün ayakta) → 5b (fail-loud: `prompts/system.txt` yoksa prod BOOT ETMEZ) yükseltilir — jenerik-beyinle sessiz prod engellenir.
- Sistem-prompt sınıflandırması IP'den kişisel-veri-içerir'e değişirse → at-rest kripto zorunlu olur, bu ADR yeniden açılır.

## Doğurduğu TB'ler
- TB-57: Server-turu P-S2 şifreleme ayağı — KMS'ten anahtar + boot-decrypt + fallback 5b fail-loud yükseltme. P-B4'e bağlı.
