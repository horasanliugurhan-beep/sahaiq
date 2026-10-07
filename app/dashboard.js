"use client";

import { useMemo, useRef, useState } from "react";
import { analyze, SEGMENTS } from "../lib/analyze.js";
import { generateSampleRows } from "../lib/sample-data.js";
import { parseCsv, toCsv } from "../lib/import/csv.js";
import { REQUIRED_FIELDS, OPTIONAL_FIELDS, FIELD_LABELS, autoMap, normalizeRow, validateMapping } from "../lib/import/schema.js";

const SAMPLE_ROWS = generateSampleRows();
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const PRIORITY_LABEL = { 3: "Yüksek öncelik", 2: "Orta öncelik", 1: "Düşük öncelik" };

// Hand-rolled Turkish formatting: Intl output differs between the build server
// and browsers, which would break hydration of the pre-rendered page.
const fmtInt = (n) => {
  const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return n < 0 ? "-" + s : s;
};
const fmtMoney = (n) => {
  if (Math.abs(n) >= 1e6) return "₺" + (n / 1e6).toFixed(1).replace(".", ",") + " Mn";
  return "₺" + fmtInt(n);
};
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const fmtDate = (iso) => {
  if (!iso) return "–";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

function Sparkline({ values, width = 96, height = 26 }) {
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1 || 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(" ");
  const lastHalf = values.slice(6).reduce((a, b) => a + b, 0);
  const firstHalf = values.slice(0, 6).reduce((a, b) => a + b, 0);
  const color = lastHalf < firstHalf * 0.7 ? "var(--high)" : "var(--accent)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Son 12 ay alım grafiği">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function download(name, text) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Dashboard() {
  const [source, setSource] = useState({ kind: "demo", name: "Kurgusal demo verisi", rows: SAMPLE_ROWS, skipped: 0 });
  const [pending, setPending] = useState(null); // uploaded file waiting for column mapping
  const [error, setError] = useState("");
  const [segment, setSegment] = useState(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "monetary", dir: -1 });
  const [showAll, setShowAll] = useState(false);
  const fileRef = useRef(null);

  const result = useMemo(() => analyze(source.rows), [source]);
  const unit = result.basis === "revenue" ? fmtMoney : (n) => `${fmtInt(n)} adet`;

  function applyRows(raw, map, name) {
    const normalized = raw.map((r) => normalizeRow(r, map));
    const rows = normalized.filter(Boolean);
    if (!rows.length) {
      setError("Dosyada geçerli satır bulunamadı. Tarih, müşteri kodu, müşteri adı ve adet sütunlarını kontrol edin.");
      return;
    }
    setSource({ kind: "upload", name, rows, skipped: raw.length - rows.length });
    setPending(null);
    setError("");
    setSegment(null);
    setQuery("");
    setShowAll(false);
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    if (file.size > MAX_FILE_BYTES) {
      setError("Dosya 25 MB'tan büyük. Daha kısa bir dönem seçip tekrar deneyin.");
      return;
    }
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError("Şimdilik CSV dosyası destekleniyor. Excel'de 'Farklı kaydet → CSV' ile dışa aktarabilirsiniz.");
      return;
    }
    try {
      const raw = parseCsv(await file.text());
      if (!raw.length) {
        setError("Dosya boş görünüyor.");
        return;
      }
      const headers = Object.keys(raw[0]);
      const map = autoMap(headers);
      if (validateMapping(map).length) setPending({ raw, headers, map, name: file.name });
      else applyRows(raw, map, file.name);
    } catch (err) {
      setError("Dosya okunamadı: " + err.message);
    }
  }

  const callList = result.callList;
  const visibleCalls = showAll ? callList : callList.slice(0, 6);
  const maxSeg = Math.max(...Object.values(result.segmentCounts), 1);

  const tableRows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    const val = (c) => (sort.key === "trend" ? c.trend.pct ?? -Infinity : sort.key === "name" ? c.name : c[sort.key]);
    return result.customers
      .filter((c) => (!segment || c.segment_key === segment) && (!q || c.name.toLocaleLowerCase("tr").includes(q) || String(c.id).toLocaleLowerCase("tr").includes(q)))
      .sort((a, b) => {
        const x = val(a), y = val(b);
        return (typeof x === "string" ? x.localeCompare(y, "tr") : x - y) * sort.dir;
      });
  }, [result, segment, query, sort]);

  const th = (key, label, cls = "") => (
    <th className={cls} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === "name" ? 1 : -1 }))}>
      {label} {sort.key === key ? (sort.dir === 1 ? "▲" : "▼") : ""}
    </th>
  );

  const k = result.kpis;

  return (
    <div className="wrap">
      <nav className="top">
        <div className="brand">
          SahaIQ<span className="badge">Canlı demo</span>
        </div>
        <div className="links">
          <a href="https://sahaiq.app">sahaiq.app</a>
          <a href="https://github.com/horasanliugurhan-beep/sahaiq">Kaynak kod</a>
        </div>
      </nav>

      <header className="hero">
        <h1>Bugün önce kimi aramalısınız?</h1>
        <p>
          Satış verisini okur, müşterileri RFM ile segmentlere ayırır, düşüşteki ve sessizleşen müşterileri işaretler ve her biri için gerekçesiyle bir sonraki adımı önerir. Aşağıdaki
          ekran gerçekten hesaplanıyor: kendi CSV dosyanızı yükleyip deneyebilirsiniz.
        </p>
      </header>

      <section className="source" aria-label="Veri kaynağı">
        <div className="meta">
          <b>{source.kind === "demo" ? "Kurgusal demo verisi" : source.name}</b> · {fmtInt(result.kpis.accounts)} müşteri · {fmtInt(result.rowCount)} satır · analiz tarihi{" "}
          {fmtDate(result.asOf)}
          {source.skipped > 0 && <> · {fmtInt(source.skipped)} satır atlandı (eksik/geçersiz)</>}
        </div>
        <div className="actions-row">
          <button className="btn primary" onClick={() => fileRef.current?.click()}>
            Kendi CSV'nizi yükleyin
          </button>
          <input ref={fileRef} className="hidden-input" type="file" accept=".csv,.txt,text/csv" onChange={onFile} />
          {source.kind === "upload" ? (
            <button className="btn" onClick={() => setSource({ kind: "demo", name: "Kurgusal demo verisi", rows: SAMPLE_ROWS, skipped: 0 })}>
              Demo veriye dön
            </button>
          ) : (
            <button className="btn" onClick={() => download("sahaiq-ornek-veri.csv", toCsv(SAMPLE_ROWS))}>
              Örnek CSV indir
            </button>
          )}
        </div>
        <div className="note">
          Dosyanız yalnızca tarayıcınızda işlenir; hiçbir sunucuya gönderilmez. Gerekli sütunlar: müşteri kodu, müşteri adı, tarih, adet. Tutar, ürün, marka ve bölge isteğe bağlı. Virgül
          veya noktalı virgül ayraçlı dosyalar ve 1.234,56 / 31.12.2026 gibi Türkçe formatlar desteklenir.
        </div>
      </section>

      {error && <div className="alert err">{error}</div>}

      {pending && (
        <section className="mapping">
          <h3>Sütunları eşleştirin</h3>
          <div className="sub">“{pending.name}” dosyasındaki bazı sütunları otomatik tanıyamadık. Hangi sütunun neye karşılık geldiğini seçin.</div>
          <div className="mapping-grid">
            {[...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map((f) => (
              <div key={f}>
                <label>
                  {FIELD_LABELS[f]}
                  {REQUIRED_FIELDS.includes(f) ? " *" : ""}
                </label>
                <select value={pending.map[f] || ""} onChange={(e) => setPending({ ...pending, map: { ...pending.map, [f]: e.target.value } })}>
                  <option value="">— seçin —</option>
                  {pending.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="actions-row">
            <button className="btn primary" disabled={validateMapping(pending.map).length > 0} onClick={() => applyRows(pending.raw, pending.map, pending.name)}>
              Analiz et
            </button>
            <button className="btn" onClick={() => setPending(null)}>
              Vazgeç
            </button>
          </div>
          {validateMapping(pending.map).length > 0 && (
            <div className="note">Eksik zorunlu alan: {validateMapping(pending.map).map((f) => FIELD_LABELS[f]).join(", ")}</div>
          )}
        </section>
      )}

      <section className="kpis" aria-label="Özet">
        <div className="kpi">
          <small>Müşteri</small>
          <div className="v">{fmtInt(k.accounts)}</div>
          <div className="s">son alım: {fmtDate(result.asOf)}</div>
        </div>
        <div className="kpi">
          <small>{result.basis === "revenue" ? "Toplam ciro" : "Toplam adet"}</small>
          <div className="v">{unit(k.total)}</div>
          <div className="s">dosyadaki tüm dönem</div>
        </div>
        <div className="kpi alertish">
          <small>Bugün aranacak</small>
          <div className="v">{fmtInt(k.highPriority)}</div>
          <div className="s">yüksek öncelikli müşteri</div>
        </div>
        <div className="kpi">
          <small>Risk altındaki {result.basis === "revenue" ? "ciro" : "hacim"}</small>
          <div className="v">%{Math.round(k.atRiskShare * 100)}</div>
          <div className="s">{unit(k.atRiskValue)} · sessiz veya düşüşte</div>
        </div>
        <div className="kpi">
          <small>Ciroyu taşıyanlar</small>
          <div className="v">{fmtInt(k.paretoCount)}</div>
          <div className="s">müşteri toplamın %80'ini yapıyor</div>
        </div>
      </section>

      <div className="grid">
        <section aria-label="Arama listesi">
          <h2>Bugün kimi aramalı?</h2>
          <p className="sub">Önceliğe ve müşterinin değerine göre sıralı. Her önerinin gerekçesi yanında.</p>
          {callList.length === 0 && <div className="call">Şu an aksiyon gerektiren müşteri yok.</div>}
          {visibleCalls.map((c) => {
            const cust = result.customers.find((x) => x.id === c.customerId);
            return (
              <article key={c.customerId} className="call">
                <div className="call-head">
                  <div>
                    <div className="call-name">{c.customerName}</div>
                    <div className="call-meta">
                      <span className="chip">{SEGMENTS[c.segmentKey]?.label}</span> · {unit(cust.monetary)} · son alım {cust.recency_days === 0 ? "bugün" : `${cust.recency_days} gün önce`}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span className={`prio p${c.priority}`}>{PRIORITY_LABEL[c.priority]}</span>
                    <div style={{ marginTop: 6 }}>
                      <Sparkline values={cust.monthly} />
                    </div>
                  </div>
                </div>
                <p>{c.reasons[0].reason}</p>
                <div className="next">→ {c.reasons[0].nextAction}</div>
                {c.reasons.length > 1 && <div className="more">Ayrıca: {c.reasons.slice(1).map((r) => r.reason).join(" · ")}</div>}
              </article>
            );
          })}
          {callList.length > 6 && (
            <button className="btn" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Daha az göster" : `Tümünü göster (${callList.length})`}
            </button>
          )}
        </section>

        <aside aria-label="Segmentler">
          <h2>Segmentler</h2>
          <p className="sub">Bir segmente tıklayın, aşağıdaki tablo filtrelensin.</p>
          <div className="panel">
            {Object.entries(SEGMENTS).map(([key, s]) => (
              <button key={key} className={`seg ${segment === key ? "active" : ""}`} onClick={() => setSegment(segment === key ? null : key)} title={s.hint}>
                <span>{s.label}</span>
                <span className="bar">
                  <i style={{ width: `${(result.segmentCounts[key] / maxSeg) * 100}%` }} />
                </span>
                <span className="n">{result.segmentCounts[key]}</span>
              </button>
            ))}
            <div className="seg-hint">{segment ? SEGMENTS[segment].hint : "Segment, müşterinin yakınlık (R), sıklık (F) ve ciro (M) puanlarından türetilir."}</div>
          </div>
        </aside>
      </div>

      <div className="table-head">
        <div>
          <h2>Müşteriler {segment && <span className="chip">{SEGMENTS[segment].label}</span>}</h2>
          <p className="sub" style={{ margin: 0 }}>
            {fmtInt(tableRows.length)} müşteri · başlıklara tıklayıp sıralayın
          </p>
        </div>
        <input className="search" placeholder="Müşteri ara…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Müşteri ara" />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {th("name", "Müşteri")}
              {th("segment_key", "Segment")}
              <th>R · F · M</th>
              {th("recency_days", "Son alım", "num")}
              {th("frequency", "Sipariş günü", "num")}
              {th("monetary", result.basis === "revenue" ? "Ciro" : "Adet", "num")}
              {th("trend", "Son 90 gün", "num")}
              <th>12 ay</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.name}
                  {c.region && <div className="call-meta">{c.region}</div>}
                </td>
                <td>
                  <span className="chip">{SEGMENTS[c.segment_key]?.label}</span>
                </td>
                <td>
                  {c.R} · {c.F} · {c.M}
                </td>
                <td className="num">{c.recency_days === 0 ? "bugün" : `${c.recency_days} gün`}</td>
                <td className="num">{c.frequency}</td>
                <td className="num">{unit(c.monetary)}</td>
                <td className={`num ${c.trend.pct === null ? "" : c.trend.pct < 0 ? "down" : "up"}`}>
                  {c.trend.pct === null ? "–" : `${c.trend.pct > 0 ? "+" : c.trend.pct < 0 ? "-" : ""}%${Math.abs(c.trend.pct)}`}
                </td>
                <td>
                  <Sparkline values={c.monthly} width={80} height={22} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="how">
        <summary>Nasıl hesaplanıyor?</summary>
        <ul>
          <li>
            <b>RFM:</b> Her müşteri; son alımdan bu yana geçen gün (R), alım yapılan gün sayısı (F) ve toplam ciro (M) bakımından diğer müşterilere göre 1–5 arası puanlanır.
          </li>
          <li>
            <b>Segment:</b> Puanların birleşiminden Şampiyon, Sadık, Risk altında, Yeni, Standart veya Pasif segmenti çıkar.
          </li>
          <li>
            <b>Trend:</b> Son 90 günün alımı önceki 90 günle karşılaştırılır; %30 ve üzeri düşüş “düşüşte” sayılır.
          </li>
          <li>
            <b>Öneri motoru:</b> Kural tabanlıdır; her öneri hangi kuralın neden tetiklendiğini gösterir. Yapay zekâ “kara kutusu” yoktur.
          </li>
          <li>
            <b>Analiz tarihi:</b> Dosyadaki en son işlem tarihi esas alınır; böylece geçmiş bir dönemin dökümü de kendi tarihine göre doğru okunur.
          </li>
        </ul>
      </details>

      <footer>
        <span>SahaIQ · Geliştiren: Uğurhan Horasanlı</span>
        <span>Demo verisindeki tüm firma, marka ve rakamlar kurgusaldır.</span>
      </footer>
    </div>
  );
}
