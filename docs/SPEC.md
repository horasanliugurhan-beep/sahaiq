# SahaIQ demo davranış sözleşmesi

Bu belge issue #27 için **yeniden tasarımdan önce**, `83b451b` sürümünün `app/`, `lib/` ve `mcp/` kodları okunarak ve mevcut demo çalıştırılarak çıkarıldı. Yeni özellik önerisi değildir. Yerel statik demo 390 × 844 ve 1440 × 1000 boyutlarında açıldı; öncesi görüntüleri `docs/demo-redesign/before-*.png` dosyalarıdır. MCP için yerel HTTP üzerinden `initialize`, `tools/list` ve `get_kpis` çağrıları yapıldı.

## Amaç ve sınır

Saha satış temsilcisi sabah telefonda önce **kimi, neden arayacağını** görür. Sayfa çalışan, kişisel ve ticari olmayan bir demodur. CRM görüşme kaydı, gerçek telefonla arama, giriş, kayıt, fiyatlandırma, görev tamamlama, otomatik mesaj gönderimi veya yapay zekâ ile metin üretimi yoktur. Tasarım mevcut akışları yeniden düzenler; yeni analitik veya hizmet eklemez.

## Veri yolu ve değişmez örnek

`app/page.js` → `Dashboard` (`app/dashboard.js`). İlk kaynak `generateSampleRows()` (`lib/sample-data.js`), sonraki kaynak doğrulanmış dosya/tablodur. `analyze(rows)` (`lib/analyze.js`) tüm ekranların tek hesap kaynağıdır:

1. `aggregateCustomers()` (`lib/aggregate.js`): müşteri bazında net tutar/adet, pozitif satış tarihleri, son alım, farklı alım günleri, bölge, en çok alınan ürün, son 12 ay ve ardışık 90 günlük dönemler. Para kuruş üzerinden toplanır; iadeler net tutarı azaltır, yeni alım sayılmaz.
2. `calculateRFM()` / `assignQuintile()` / `segmentOf()` (`lib/rfm.js`): alım geçmişi olanları birbirlerine göre 1–5 puanlar. Pozitif satışı olmayanlar puansız `no_purchase` kalır.
3. `evaluateRules()` / `groupByCustomer()` (`lib/action-engine-rules.js`): müşteri başına tüm gerekçeler; öncelik, değer ve ad sırası. Şampiyonun sessizliği, risk, satış düşüşü, sadık takip, yeni müşteri ve pasif geri kazanım kuralları. Son alım, görüşme kaydı bulunmadığından temas için kullanılan vekildir; gerçek görüşme tarihi değildir.
4. `analyze()` KPI ve segment sayılarını döndürür; arayüz bunları yeniden hesaplamaz. `fmtInt`, `fmtMoney`, `fmtDate`, `fmtRecency` (`lib/format.js`) yalnızca gösterimi biçimler.

| Sabit demo çıktısı | Değer |
| --- | --- |
| Kaynak / satır | Yalnızca kurgusal / 718 |
| Müşteri | 40; tüm firma adları `Kurgu ` ile başlar |
| Analiz tarihi (`asOf`) | 2026-09-27; sistem saati değildir |
| Net ciro | ₺53.799.175,00 (kompakt gösterim: ₺53,8 Mn) |
| Sessiz veya düşüşteki müşterilerin değeri | ₺20.886.617,00; pay %38,8 (mevcut yuvarlatılmış KPI/brifing %39) |
| Pareto | 16 müşteri toplamın %80'ini taşır |
| Arama listesi | 29: 17 yüksek, 6 orta, 6 düşük |
| Segmentler | 6 Şampiyon, 9 Sadık, 9 Risk altında, 5 Yeni, 4 Standart, 7 Pasif; 0 Alım geçmişi yok |
| İlk öneri | D016, Kurgu Bulut Jant & Lastik; 54 gündür sessiz; yüksek öncelik |

Bu değerler, `lib/` fonksiyonları, eşikler, sıralama ve brifing metni tasarım sırasında değiştirilmez. Arayüzdeki kompakt/yuvarlanmış rakamlar temel verinin değiştiği anlamına gelmez.

## Kullanıcı akışları

### Kaynak seçimi, dosya ve yapıştırma

- Varsayılan kaynak adı, müşteri/satır sayısı ve analiz tarihi görünür. `Örnek CSV indir`, `toCsv(SAMPLE_ROWS)` ile tarayıcıda BOM'lu dosya üretir.
- `Kendi dosyanızı yükleyin` gizli dosya girdisini açar. `.xlsx` için 15 MiB; `.csv`, `.tsv`, `.txt` için 5 MiB sınırı vardır. Eski `.xls` ve bilinmeyen uzantı açıklayıcı hata verir. Dosya sunucuya yüklenmez.
- Metinler `parseTable()` (`lib/import/csv.js`) ile okunur: virgül/noktalı virgül/sekme, tırnaklar, UTF-8/BOM ve fiziksel satır numaraları; bozuk yapı, tekrarlanan/boş başlık, fazla sütun, boyut ve 50.000 satır sınırı hata verir. Kayıt sessizce kırpılmaz.
- Excel tarayıcıda `read-excel-file/browser` ile, `trim:false` kullanılarak okunur. `pickSheet()` ve `sheetToTable()` (`lib/import/xlsx.js`) veri sayfasını ve ilk 20 satır içindeki başlığı bulur, baştaki açıklama satırlarını bildirir; tarih ve sayısal hücreleri korur.
- `Excel'den yapıştır` başlıkla birlikte tablo alınan bir metin alanı açar. Boşken `Analiz et` kapalıdır. Gönderince aynı `parseTable → ingest → tryApply` yolu çalışır. `Vazgeç` bu alanı kapatır.

### Sütun eşleştirme ve sayı biçimi

- `ingest()` önce `headerSignature()` ile yerel kayıt arar, uygun kayıt yoksa `autoMap()` ve `guessLocale()` (`lib/import/schema.js`) kullanır. Belirsiz başlık kullanıcıya bırakılır.
- Zorunlu alanlar: müşteri kodu/adı, tarih, adet. Tutar, ürün, marka, bölge isteğe bağlıdır. `validateMapping()` eksik zorunlu alan varsa analizi kapatır.
- Eşleştirme ekranında her alan için etiketli sütun seçimi ve Türkçe/İngilizce sayı biçimi seçimi vardır. Aynı sütunun iki alana atanması da `validateDataset()` tarafından reddedilir.
- Başarılı seçim bu tarayıcıda `sahaiq.mappings.v1` altında en son 20 düzenle sınırlı tutulur. Veri satırları kaydedilmez; yerel depolama kullanılamazsa analiz yine çalışır.
- Yüklenmiş kaynakta `Eşleştirmeyi değiştir` aynı tabloyu yeniden açar. `Demo veriye dön` sabit kurgusal kaynağı geri getirir.

### Hata ve uyarı ekranı

- `tryApply()` tüm tabloyu `validateDataset()` ile kontrol eder. **Tek hata bile yeni kaynağın analizini engeller**; önceki geçerli sonuç ekranda kalır. Hata ekranı bunu açıklar; toplam hata sayısı ve ilk 12 hatanın fiziksel satır numarası gösterilir. Eşleştirme/sayı biçimi düzeltilip tekrar kontrol edilebilir veya dosya düzeltilerek yeniden yüklenebilir.
- Geçersiz tarih/sayı, boş zorunlu alan, tam sayı olmayan adet, güvenli aralık dışı sayılar, aynı kodun farklı adları, ad/üründeki kontrol ve görünmez yönlendirme karakterleri reddedilir.
- Tekrarlı satırlar silinmez; iade ve boş tutar bildirilir. Boş tutar sıfır değildir; eksik tutar varsa hesap adet bazına geçer. Excel sayısal tutarı kuruşa yuvarlanır ve toleransı aşan değişiklikler ilk kaynak satırıyla bildirilir; metinsel tutarın ikiden fazla ondalığı reddedilir.
- Yüklenen kaynağın en son tarihi 14 günden eskiyse sonuçların bugüne ait olmadığı uyarılır. Demo, sabit veri tarihiyle çalışır; gerçek zamanlı veri izlenimi verilmez.

### Arama listesi: önce kişi ve gerekçe

- Kaynak `result.callList`; ilk 6 öneri gösterilir. `Tümünü göster (29)` ve `Daha az göster` yalnızca görünür kayıt sayısını değiştirir. Boş liste için açıklama vardır.
- Her kayıtta müşteri adı, metinle belirtilmiş öncelik, segment, net değer, son alım, 12 aylık seri, birincil gerekçe, sonraki adım ve varsa diğer gerekçeler bulunur. Veriler `callList` ve `result.customers` eşleşmesinden gelir.
- Öncelik dağılımı tüm listeyi kapsar; görünür 6 kayıt veya brifingdeki 5 kayıt tüm liste değildir. Liste sırası görsel yeniden tasarımda korunur. Bu bir telefon araması veya müşteriyle iletişim başlatmaz.

### Özet, segment ve müşteri detayları

| Görünen bilgi | Kaynak |
| --- | --- |
| Müşteri, toplam ciro/adet | `result.kpis.accounts`, `.total`, `result.basis` |
| Yüksek öncelikli ve toplam liste | `kpis.highPriority`, `callList.length` |
| Risk payı ve değeri | `kpis.atRiskShare`, `.atRiskValue` (risk altında veya düşüşte, müşteri bir kez sayılır) |
| %80'i taşıyan müşteri sayısı | `kpis.paretoCount` |
| Segment çubukları/sayıları/açıklamaları | `result.segmentCounts`, `SEGMENTS`; en büyük segment sayısına göre çubuk uzunluğu |
| Müşteri tablosu | `result.customers`: ad/bölge, segment, R/F/M, son alım, alım günü, net değer, 90/90 gün değişim, 12 aylık seri |

Segment düğmesi müşteri tablosunu süzer; tekrar basmak filtreyi kaldırır. Arama ad veya kodda Türkçe küçük/büyük harfe göre çalışır, segment filtresiyle birleşir. Sıralama başlıkları gerçek düğmelerdir, Tab/Enter/Space ile çalışır ve `aria-sort` sırasını bildirir. Bilinmeyen son alım her iki yönde de sonda kalır. Alım geçmişi olmayana “Alım yok”, bilinmeyen trende “–” gösterilir. Geniş tablo kendi alanında kayar; telefon sayfası yatay taşmaz. `Nasıl hesaplanıyor?` mevcut hesap açıklamalarını açar.

### Brifing, kopyala, WhatsApp ve dosya

- `buildBriefing(result)` → `briefingToText()` → `validateBriefingText()` (`lib/briefing.js`). Yüklenen veride `today` kullanılarak eski veri uyarısı üretilir. Demo tarihi sabittir.
- Önizleme ilk 5 yüksek ve ilk 5 orta öncelikli müşteriyi içerir; kalanların sayısını açıklar. Yüksek öncelikte hesaplanan olgular, gerekçe, sonraki adım ve sayısız, kod tarafından seçilmiş açılış cümlesi vardır. Özet veriden gelir. Yapay zekâ çağrısı yoktur.
- Bekçi tam olguları, türleri, işaretleri, ölçekleri, tarihleri ve müşteri/ürün bağlarını **sıralı tam belgeyle** karşılaştırır. Serbest yeniden yazım desteklenmez. Fiyat/stok/kampanya vaadi ve doğrulanmayan içerik reddedilir.
- Rozet başarısızsa paylaşım düğmeleri kapalıdır. `copyBriefing()` kopyalama anında **yeniden** doğrular; başarı/izin hatası geri bildirimi verir, izin hatasında elle kopyalama önerir.
- `sendBriefing()` her işlemde `shareTargets()` (`lib/briefing-share.js`) ile **yeniden** doğrular. `.txt indir` BOM'lu `sahaiq-brifing-YYYY-MM-DD.txt` dosyasını yerelde üretir.
- `WhatsApp'ta aç` tam brifingi URL parametresiyle WhatsApp'a aktarır; bu aktarım düğmenin yanında `aria-describedby="wa-note"` ile açıklanır. Otomatik gönderim yoktur; alıcı ve gönderme kullanıcıya aittir. Kopyalama ve dosya indirme dışarı veri göndermez.

### MCP bağlayıcısı (web sayfasından ayrı mevcut arayüz)

`npm run mcp:local`, mevcut `mcp/serve-local.mjs` sunucusunu çalıştırır. `mcp/server.js` durumsuz JSON-RPC/Streamable HTTP sunar; Cloudflare girişi aynı `handleHttp()` fonksiyonunu kullanır. Yeniden tasarım sunucu kurmaz veya yayımlamaz. Tarayıcıdaki yüklenen veri MCP'ye bağlanmaz.

`POST /mcp` üzerinde `initialize`, `ping`, `tools/list`, `tools/call` desteklenir. `mcp/tools.js` yalnızca `analyze(generateSampleRows())` sonucunu sunar; okuma dışında işlem, saat, dosya veya dış ağ kullanmaz. Her araç `source`, `asOf`, `basis` verir; para tamsayı `kurus` + biçimli `text` olarak döner.

| Araç | Girdi ve çıktı |
| --- | --- |
| `get_kpis` | Argümansız; KPI, kaynak, tarih, öncelik dağılımı |
| `get_call_list` | İsteğe bağlı öncelik/limit; tüm liste sayısı, eşleşen sayı, sırası/gerekçesi korunmuş öneriler |
| `get_customers` | Segment/bölge, sıralama, limit; RFM, trend ve müşteri listesi |
| `get_customer` | Zorunlu id; tek müşteri ve varsa arama önerisi |
| `get_segment_summary` | Argümansız; segment anlamı, sayı, net değer, pay |
| `get_sales_timeseries` | Haftalık/aylık, isteğe bağlı müşteri id; iadeler düşülmüş seri |

Katı argüman şeması, en çok 100 kayıt; 64 KiB gövde sınırı, UTF-8 denetimi, protokol sürümü ve Origin denetimi vardır. Origin varsa yalnızca `https://claude.ai` / `https://claude.com`; yoksa sunucudan sunucuya çağrı kabul edilir. Gerçek veri için kimlik doğrulama katmanı/onay gerekir; demo bunu sağlamaz. Ayrıntı: `mcp/README.md`.

### İsteğe bağlı Qlik

`app/api/qlik/route.js` → `handleQlikStatus()` (`lib/security/qlik-status.js`). Varsayılan kapalıdır (503). Açıldığında güçlü durum tokenı ve sunucu tarafı yapılandırma gerekir; başarılı yanıt yalnızca kimlik/uygulama metaverisi erişimini doğrular, iş verisini doğrulamaz. Statik demoda bu uç nokta yoktur. Yeniden tasarım Qlik'i etkinleştirmez.

## Tasarım sözleşmesi

Akış sırası: kısa kaynak/tarih bağlamı → arama listesi (kişi, öncelik, neden, sonraki adım) → KPI'lar → mevcut brifing ve veri yükleme → segment/müşteri detayları. İçe aktarma alanı ve hataları işlem sırasında odağa alınır; başarılı kaynak değişiminde odak yeni arama listesine döner. Mobilde ilk önerinin adı ve gerekçesi ilk 390 × 844 görünümde yer alır; masaüstünde de DOM ve okuma sırası korunur.

“Asfalt / sabah rotası” kimliği korunur: `#262b31`, `#1d2126`, sis `#eef0f1`, şerit sarısı `#f2c230`; Archivo yazı tipi (mevcut kimliği dış font isteği olmadan korumak için OFL lisansıyla yerel sunulur; kaynak: google/fonts, `app/fonts/OFL.txt`). Yüksek/orta/düşük renkleri yalnızca öncelik belirtir; diğer değer ve durumlar nötr, metinle açıklanır. Renk tek anlam taşıyıcısı değildir. Klavye odağı görünür, kontroller etiketli ve dokunulabilir, kontrast AA, axe denetimi temiz olmalıdır. Telefon ve masaüstü aynı işlevlere sahiptir.

## Değişmez kurallar ve doğrulama

| Sözleşme | Mevcut testler |
| --- | --- |
| Deterministik demo, RFM, kural sırası ve ciro/adet/iade hesapları | `test/analyze.test.mjs`, `test/core.test.mjs`, `test/data-correctness.test.mjs` |
| Satır numaralı fail-closed içe aktarma, yerel sayı/tarih, eşleştirme, Excel, görünmez karakterler | `test/analyze.test.mjs`, `test/import.test.mjs`, `test/sources.test.mjs`, `test/import-cleanup.test.mjs`, `test/data-correctness.test.mjs` |
| Tür/sıra/müşteri bağı korunan brifing, sayısız açılış, değiştirilen içerik ve vaatlerin reddi | `test/briefing.test.mjs`, `test/briefing-guard.test.mjs` |
| Kopyalama anında yeniden kontrol, paylaşım kapısı ve tam URL metni | `test/briefing-copy.test.mjs`, `test/briefing-share.test.mjs`, `e2e/demo.spec.mjs` |
| MCP salt okunur sözleşmesi ve demo ile tam mutabakat | `test/mcp.test.mjs`, `test/fixtures/mcp-tools.json` |
| Qlik varsayılan kapalı / kimlik doğrulama / metaverisi sınırı | `test/status.test.mjs`, `test/qlik.test.mjs`, `test/qix.test.mjs` |
| Gerçek tarayıcı: CSV/Excel/yapıştır, satır hatası, klavye sırası, 390px taşmama, axe, WhatsApp açıklaması, kurgusal adlar | `e2e/demo.spec.mjs` |

Teslimde mevcut testler silinmez veya kapsamları azaltılmaz. Tasarımla değişen seçiciler güncellenebilir; ilk görünüm, yeni sıralama, eşleştirme, filtreler ve sabit demo değerleri için ek regresyon kontrolleri yapılır. Yeni bağımlılık eklenmez, `lib/` ve demo verisi değişmez. Gerekli komutlar: `npm test`, `npm run build`, `npm run build:static`, `npm run test:e2e`. Statik derleme tarayıcı testlerinin ön koşuludur; sunucu ve statik derlemeler aynı `.next` dizinini kullandığından sırayla yapılır.
