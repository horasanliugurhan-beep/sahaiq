# SahaIQ MCP sunucusu

SahaIQ'yu Claude'a (ör. Claude Panelleri) **salt okunur** bir veri kaynağı olarak açar. Claude sorguyu ve grafiği yazar; rakamlar `lib/` içindeki test edilmiş hesaplardan gelir. Tasarım ve kararlar: sahaiq#21.

**Yalnızca kurgusal demo verisi.** Firma adları `Kurgu` ile başlar. Gerçek veya Qlik verisi, şirket onayı ve kimlik doğrulama eklenmeden bu sunucuya bağlanmaz.

## Araçlar

| Araç | Ne verir |
|---|---|
| `get_kpis` | Müşteri, toplam ciro, öncelik dağılımı, risk altındaki ciro, Pareto |
| `get_call_list` | Gerekçeli arama listesi (öncelik ile süzülebilir) |
| `get_customers` | RFM, segment, son alım, 90/90 gün değişimi; süzme ve sıralama |
| `get_customer` | Tek müşteri ve arama listesindeki gerekçeleri |
| `get_segment_summary` | Segment başına müşteri, ciro ve pay |
| `get_sales_timeseries` | Haftalık/aylık net satış (tümü ya da tek müşteri) |

Her yanıt `source`, `asOf` (veri tarihi) ve `basis` taşır. Para alanlarında `kurus` tamsayıdır, `text` gösterim içindir.

## Yerelde çalıştırma

```
npm run mcp:local        # http://127.0.0.1:8787/mcp
npm test                 # test/mcp.test.mjs dahil
```

## Cloudflare Workers'a yayın (ücretsiz katman)

1. cloudflare.com'da ücretsiz hesap açın (sahip açar).
2. Depo kökünde: `npx wrangler login`, ardından `npx wrangler deploy`.
3. Çıkan adres `https://sahaiq-mcp.<hesap>.workers.dev`; MCP uç noktası sonuna `/mcp` eklenmiş halidir.

## Claude'a bağlama

Claude'da bağlayıcı ayarlarından özel (custom) bir bağlayıcı ekleyip URL olarak `https://…workers.dev/mcp` girin. Kimlik doğrulama yoktur; veri kurgusal olduğu için gerekmez. Sonra örneğin şunu isteyin: "SahaIQ'dan son 90 günde satışı en çok düşen bayileri panel olarak göster."

## Protokol

Durumsuz Streamable HTTP; yalnızca `POST /mcp`, JSON yanıt. Desteklenenler: `initialize`, `ping`, `tools/list`, `tools/call`. Bağımlılık yoktur; resmi MCP istemci kütüphanesiyle ve Cloudflare `workerd` çalışma ortamında denenmiştir.
