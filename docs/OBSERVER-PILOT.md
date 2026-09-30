# SahaIQ: dosya bazlı Gözlemci Pilotu (v0.2)

## En kolay kullanım

1. `public/pilot.html` dosyasını tarayıcıda açın. Dosya üretimi: `npm run pilot:build` (Node 22; ek paket gerekmez).
2. Excel tablosunu sütun başlıklarıyla kopyalayıp yapıştırın veya UTF-8 CSV/TSV seçin.
3. Kaynak rapor tarihini, sayı biçimini ve önerilen sütun eşleştirmelerini kontrol edin.
4. Hataları düzeltip kaynak doğrulama kutusunu işaretleyin; raporu oluşturun.

Doğrudan `.xlsx` okuma eklenmedi: Excel kopyala-yapıştır yolu seçildi. Bu, bozuk/karmaşık çalışma kitaplarını sessizce yorumlamak yerine dar ve doğrulanabilir bir ilk adımdır. En fazla 50.000 veri satırı / 5 MB dosya kabul edilir.

Zorunlu satış sütunları: cari kod, cari ünvan, satış/fatura tarihi, net adet. Net satış tutarı (TL), ürün, marka ve bölge isteğe bağlıdır. Borç/bakiye alanı ciroya otomatik eşleştirilmez. Başlıklar aynı değilse kullanıcı eşleştirir. Cari kodlar metindir; baştaki sıfırlar korunur.

## Veri doğruluğu

- Türkçe `1.000` = 1000; `152.544,50` = 152544.50. İngilizce sayı biçimi ayrı seçimdir.
- Geçersiz sayı/tarih ve çelişen cari kod-ünvan kayıtları bütün raporu durdurur; hatalı satırlar sessizce atılmaz.
- Eksik tutar `null`/bilinmiyor olarak korunur; tam ciro yerine sıfır yazılmaz. Para toplamları kuruş cinsinden hesaplanır.
- Tekrarlanan satış alanları işaretlenir; belge numarası olmadığından otomatik silinmez. Ayrı işlem oldukları ayrıca onaylanmalıdır.
- Negatif adetler net adetten düşülür. Son pozitif satış tarihi iade satırıyla ileri taşınmaz.
- Satış satırları sipariş sayısı değildir. Demo açıkça etiketlidir ve sadece kullanıcı seçerse yüklenir.

## Gerçekten yapılan ve yapılmayan işler

Pilot yalnızca seçilen satış dosyasını analiz eder. Belirlenen gün eşiğine göre, dosyadaki son pozitif satıştan itibaren geçen süreyi kullanarak doğrulama/takip adaylarını sıralar; ilk beşi gösterir. Eşik varsayılan 30 gündür; şirket kuralı veya müşteri kaybı kanıtı değildir. Eski kaynak tarihi bugünkü canlı durum gibi sunulmaz.

Henüz yok: Qlik iş verisi aktarımı, Outlook/e-posta/takvim entegrasyonu, doğrulanmış bayi ana listesi, tahsilat-vade-sevkiyat modeli, kampanya motoru, kalıcı CRM kayıtları, zamanlanmış/7x24 çalışma. Satış artışı, müşteri kaybı veya ROI iddia edilmez.

## Veri güvenliği ve saklama

Bağımsız HTML ağ isteği yapmaz; CSP `connect-src 'none'` ve dış betik yasağı içerir. Veri yalnızca sayfanın belleğindedir; LocalStorage/SessionStorage/veritabanı kullanılmaz. Yenileme veya Veri temizle ile silinir. TXT rapor yalnızca kullanıcının açık indirme işlemiyle cihazına kaydedilir; bu dosyanın güvenli saklanması kullanıcıya aittir. Tarayıcı eklentileri veya ele geçirilmiş cihazlara karşı güvenlik garantisi verilmez.

Next.js ana sayfası aynı üretilmiş HTML'yi sandbox iframe içinde sunar. Web sunucusu uygulama dosyalarını servis eder; seçilen dosyanın içeriğini almaz. Geliştirme, test ve derleme öncesi HTML kaynaklardan yeniden üretilir. `public/pilot.html` elle düzenlenmez.

## Qlik durum uç noktası

`/api/qlik` varsayılan olarak kapalıdır. Yalnızca şirket izniyle sunucuda `SAHAIQ_ENABLE_QLIK_CHECK=true`, en az 32 karakterli rastgele `SAHAIQ_STATUS_TOKEN` ve Qlik bağlantı alanları tanımlanabilir. Durum isteği `Authorization: Bearer <status-token>` ister. Token veya API anahtarı tarayıcı koduna/depoya yazılmaz. Pilot arayüzü bu uç noktayı çağırmaz.

Yalnızca Qlik Cloud HTTPS tenant kök adresleri kabul edilir; yönlendirmeler izlenmez; istekler GET, no-store ve 8 saniye zaman aşımıyla gönderilir. Yetkisiz istek Qlik'e ulaşmaz. Durum yanıtında kullanıcı adı, e-posta, uygulama adı veya API anahtarı yoktur.

Başarılı durum bile `metadata_only` döner. Kimlik doğrulama ve uygulama metadatası ayrı kontrol edilir; `business_data` ve `read_only_permissions` her zaman `not_verified` kalır. Yetki kapsamını bu test kanıtlamaz. Gerçek iş verisi ve bölge kapsamı ayrı kabul testi gerektirir. Paylaşılan durum tokeni tam kurumsal oturum/yetki yönetimi yerine geçmez; üretimde SSO ve erişim politikası ayrıca gerekir.

Qlik resmi yanıt şeması: https://qlik.dev/apis/rest/apps/ (GET /api/v1/apps/{appId}, attributes.id / attributes.name).
Next.js API erişim kontrolü: https://nextjs.org/docs/app/guides/authentication

## Test ve kabul sınırı

`npm test` ile veri doğrulama, CSV/TSV, para/tarih, tekrar/çelişki, rapor, güvenlik ve üretilmiş HTML tutarlılık testleri çalışır. Qlik testleri sahtelenmiş yanıtlar kullanır; gerçek şirket bağlantısı kurulduğunu kanıtlamaz. Ana proje derlemesi ayrıca `npm run build` ile doğrulanmalıdır.

Canlı pilot kabulü için üç gerçek bayi seçilmeli; yetkili güncel kaynaktaki cari kod ve adet/tutar toplamları bu raporla karşılaştırılmalıdır. Bunun öncesinde çıktı bir dosya pilotudur, çalışan tam bölge asistanı değildir.
