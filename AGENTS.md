# AGENTS.md — SahaIQ çalışma kuralları

Bu dosya, bu repoda çalışan yapay zekâ ajanları (Codex, Claude) ve insanlar için ortak kurallardır. Her işe başlamadan önce okuyun.

## Kim ne yapar

- **Uğurhan (sahip):** Son kararı verir, PR'ları birleştirir (merge). Maliyet, sunucu, yeni erişim ve güvenlik değişiklikleri yalnızca onun onayıyla yapılır.
- **Codex:** Denetçi ve hata giderici. Kodu inceler, hataları bulur, düzeltme PR'ı açar, Claude'un incelemelerine yanıt verir.
- **Claude:** Koordinatör ve inceleyici. Codex'in PR'larını inceler, kendi düzeltmelerini PR ile önerir, Codex'in yorumlarına yanıt verir.

Biri kod yazdıysa diğeri inceler. Kimse kendi PR'ını onaylamaz.

## Nasıl konuşuyoruz (GitHub üzerinden)

1. **Bulgu = Issue.** Her hata ya da risk ayrı bir issue. Başlık: `[bulgu][önem] kısa açıklama`. Önem: `kritik`, `yüksek`, `orta`, `düşük`.
   Issue içeriği: dosya ve satır, nasıl tekrar üretilir (kurgusal veriyle), beklenen ve gerçekleşen davranış, önerilen çözüm.
2. **Düzeltme = PR.** Her PR tek bir konu. Dal adı: `codex/<konu>` ya da `claude/<konu>`. PR açıklaması: hangi issue'yu kapatıyor (`Closes #N`), ne değişti, neden, nasıl test edildi, kalan risk.
3. **İnceleme = PR yorumu.** İnceleyen, bulguyu satıra yorum olarak yazar. Yazar ya düzeltir ya da gerekçesiyle itiraz eder. Her yorumun sonuna imza: `— Codex` veya `— Claude`.
4. **Anlaşmazlık:** İki tur yorumda uzlaşılamazsa PR'a `karar-gerekli` yazılır ve Uğurhan'a bırakılır. Kimse diğerinin değişikliğini tartışmasız geri almaz.
5. **`main` dalına doğrudan push yok.** Tüm değişiklikler PR ile gelir; CI yeşil olmadan birleştirilmez.

## Değişmez kurallar

- Gerçek müşteri, bayi, firma verisi, gerçek marka ya da kişi adı repoya girmez. Testler ve örnekler yalnızca kurgusal veri kullanır.
- Sır (API anahtarı, token, şifre, tenant adresi) commit edilmez.
- Yeni bağımlılık, ücretli servis, sunucu ya da dış servise veri gönderen kod: önce issue aç, Uğurhan onaylasın.
- Site ve README yalnızca bugün gerçekten çalışan şeyi anlatır. Çalışmayan özellik "yol haritası" olarak yazılır.
- Kullanıcıya gösterilen metin Türkçe ve doğal; Türkçe karakterler eksiksiz.
- **Doğrulama gevşetilmez.** Hatalı satır sessizce atılmaz; analiz durur ve satır numarasıyla gösterilir (`lib/import/schema.js`). Boş tutar sıfır sayılmaz.
- **Brifing rakam bekçisi zayıflatılmaz.** `lib/briefing.js` içindeki `validateBriefingText` her rakamı türüyle (tutar, %, gün, tarih, adet) veriyle karşılaştırır. Brifingde fiyat, stok ya da kampanya vaadi olmaz; bayiye yönelik açılış cümlelerinde rakam olmaz.
- Rakamı ve kararı kod verir; yapay zekâ en fazla metni toparlar.

## Proje haritası

- `app/dashboard.js` — demo arayüzü (tek sayfa, tamamen tarayıcıda)
- `lib/import/` — CSV/TSV okuyucu (`csv.js`), doğrulama ve ERP başlık eşleştirme (`schema.js`), Excel (`xlsx.js`)
- `lib/aggregate.js` — satırlardan müşteri profili (son alım, sıklık, ciro, 90/90 gün trendi; kuruş hesabı; iadeler)
- `lib/rfm.js`, `lib/action-engine-rules.js`, `lib/analyze.js` — RFM, kurallar, arama listesi
- `lib/briefing.js` — brifing üreticisi ve rakam bekçisi
- `lib/sample-data.js` — deterministik kurgusal demo verisi
- `lib/connectors/`, `lib/security/qlik-status.js`, `app/api/qlik` — Qlik bağlantısı (varsayılan kapalı, token korumalı)
- `test/` — `node --test` testleri

## Komutlar

```
npm install
npm test              # tüm testler yeşil olmalı
npm run build         # sunucu build
npm run build:static  # GitHub Pages için statik demo (out/)
```

CI (`.github/workflows/ci.yml`) test + build çalıştırır. `main`e birleşen her değişiklik `pages.yml` ile canlı demoya çıkar: https://horasanliugurhan-beep.github.io/sahaiq/
