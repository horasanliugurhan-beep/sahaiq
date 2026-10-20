# Demo yeniden tasarım doğrulaması

Issue #27; başlangıç sürümü `83b451ba4ec140e305d3660e6c4d3941d66f5af0`.
Davranış sözleşmesi tasarımdan önce [SPEC.md](../SPEC.md) içine yazıldı.

## Sonuçlar

- `npm test`: 154 geçti, 0 hata, 0 atlanan.
- `npm run build`: başarılı; ana sayfa ve isteğe bağlı `/api/qlik` derlendi.
- `npm run build:static`: başarılı; tarayıcı testleri bu çıktı üzerinde çalıştı.
- `npm run test:e2e`: 17 geçti; başlangıçtaki 10 testin kapsamı korundu ve genişletildi.
- Axe: varsayılan görünümde, 390px / 1440px görünümlerde, açılmış 29 öneride, eşleştirme ve hata durumlarında ihlal yok.
- `git diff --exit-code -- lib/ mcp/ package.json package-lock.json test/ AGENTS.md`: değişiklik yok.

[Tam komut çıktıları](validation.txt). Bunlar yerel doğrulama sonuçlarıdır; GitHub CI sonucu değildir.

Bulut makinesi Node 24.19.0 / npm 11.9.0 ve kurulu Chromium 154 kullanır.
Playwright'ın Chromium indirme adresleri ağ politikasıyla engelli olduğundan:

```sh
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
npm run test:e2e
```

Bu isteğe bağlı değişken verilmezse mevcut Playwright tarayıcısı kullanılır;
CI'nın sabit tarayıcı kurulumu değiştirilmedi. Bağımlılık eklenmedi.

## Ekran görüntüleri

Kurgusal demo verisi, Türkçe yerel ayar, Europe/Istanbul saat dilimi.
Öncesi ve sonrası tam sayfa görüntülerinde aynı boyutta tarayıcı kullanıldı:
390 × 844 ve 1440 × 1000. Öncesinde Google Fonts isteği testlerdeki gibi boş
cevaplandı (sistem yazı tipi); sonrasında Archivo uygulamayla birlikte yerel
yüklendi. Sonraki ilk ekran görüntüleri ayrıca görünür alanı gösterir.

| Boyut | Önce | Sonra |
| --- | --- | --- |
| 390px mobil | [Tam sayfa](before-mobile.png) | [Tam sayfa](after-mobile.png) · [İlk ekran](after-mobile-viewport.png) |
| 1440px masaüstü | [Tam sayfa](before-desktop.png) | [Tam sayfa](after-desktop.png) · [İlk ekran](after-desktop-viewport.png) |

390 × 844 görünümde ilk önerinin adı, önceliği, gerekçesi ve sonraki adımı
kaydırma olmadan görünür. Bunun için koordinat denetimi yapan tarayıcı testi vardır.
