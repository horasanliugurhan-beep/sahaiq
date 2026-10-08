"use client";

import { useMemo, useRef, useState } from "react";
import { analyze, SEGMENTS } from "../lib/analyze.js";
import { buildBriefing, briefingToText, validateBriefingText } from "../lib/briefing.js";
import { fmtDate, fmtInt, fmtMoney, fmtRecency } from "../lib/format.js";
import { generateSampleRows } from "../lib/sample-data.js";
import { parseTable, toCsv, MAX_IMPORT_CHARS } from "../lib/import/csv.js";
import { REQUIRED_FIELDS, OPTIONAL_FIELDS, FIELD_LABELS, LOCALES, autoMap, guessLocale, headerSignature, validateDataset, validateMapping } from "../lib/import/schema.js";
import { pickSheet, sheetToTable } from "../lib/import/xlsx.js";

const SAMPLE_ROWS = generateSampleRows();
const MAX_FILE_BYTES = MAX_IMPORT_CHARS;
const MAX_XLSX_BYTES = 15 * 1024 * 1024;
const MAPPINGS_KEY = "sahaiq.mappings.v1";

// Saved column mappings live only in this browser (a convenience, never required).
function loadMappings() {
  try {
    return JSON.parse(localStorage.getItem(MAPPINGS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function saveMapping(sig, map, locale) {
  try {
    const all = loadMappings();
    all[sig] = { map, locale, savedAt: Date.now() };
    const keep = Object.entries(all).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 20);
    localStorage.setItem(MAPPINGS_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    /* storage unavailable: mapping simply isn't remembered */
  }
}
const DAY_MS = 86400000;

const PRIORITY_LABEL = { 3: "Yüksek öncelik", 2: "Orta öncelik", 1: "Düşük öncelik" };

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
  const [source, setSource] = useState({ kind: "demo", name: "Kurgusal demo verisi", rows: SAMPLE_ROWS, warnings: [] });
  const [pending, setPending] = useState(null); // uploaded file waiting for mapping or fixes
  const [error, setError] = useState("");
  const [segment, setSegment] = useState(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "monetary", dir: -1 });
  const [showAll, setShowAll] = useState(false);
  const [paste, setPaste] = useState(null); // null = closed, string = textarea content
  const [copied, setCopied] = useState("");
  const fileRef = useRef(null);

  const result = useMemo(() => analyze(source.rows), [source]);
  const unit = result.basis === "revenue" ? fmtMoney : (n) => `${fmtInt(n)} adet`;
  // Uploaded data is checked against today's date; the fictional demo is not.
  const briefing = useMemo(() => {
    const today = source.kind === "upload" ? new Date().toISOString().slice(0, 10) : undefined;
    const b = buildBriefing(result, { today });
    const text = briefingToText(b);
    return { b, text, check: validateBriefingText(text, b) };
  }, [result, source.kind]);

  async function copyBriefing() {
    try {
      await navigator.clipboard.writeText(briefing.text);
      setCopied("Kopyalandı");
    } catch {
      setCopied("Kopyalanamadı; metni seçip elle kopyalayın");
    }
    setTimeout(() => setCopied(""), 2500);
  }

  // Validate the whole file; any error blocks the analysis and is shown with its line number.
  function tryApply(p) {
    const check = validateDataset(p.table, p.map, { locale: p.locale });
    if (check.errors.length) {
      setPending({ ...p, check });
      return;
    }
    // Analysing an old export is fine, but it must never look like today's state.
    const latest = check.rows.reduce((m, r) => (r.date > m ? r.date : m), check.rows[0].date);
    const ageDays = Math.floor((Date.now() - Date.parse(latest + "T00:00:00Z")) / DAY_MS);
    const warnings = [...check.warnings];
    if (p.note) warnings.unshift({ row: 0, field: "source", message: p.note });
    if (ageDays > 14) warnings.unshift({ row: 0, field: "asOf", message: `Dosyadaki en son kayıt ${fmtDate(latest)} (${fmtInt(ageDays)} gün önce). Sonuçlar bugünü değil, o tarihi gösterir.` });
    if (p.table.headers.length) saveMapping(headerSignature(p.table.headers), p.map, p.locale);
    setSource({ kind: "upload", name: p.name, rows: check.rows, warnings, locale: p.locale, origin: p.origin, table: p.table, map: p.map });
    setPending(null);
    setError("");
    setSegment(null);
    setQuery("");
    setShowAll(false);
  }

  // Every source (CSV, Excel, paste) ends up as the same table and the same checks.
  function ingest(table, name, extra = {}) {
    if (!table.rows.length) {
      setError("Dosyada veri satırı yok.");
      return;
    }
    const saved = loadMappings()[headerSignature(table.headers)];
    const savedOk = saved && Object.values(saved.map).every((h) => !h || table.headers.includes(h)) && !validateMapping(saved.map).length;
    const map = savedOk ? saved.map : autoMap(table.headers);
    const sample = table.rows.slice(0, 500).flatMap((r) => [map.quantity, map.revenue].filter(Boolean).map((h) => r[h]));
    const locale = savedOk ? saved.locale : guessLocale(sample.filter((v) => typeof v === "string"));
    const notes = [extra.note, savedOk ? "Bu rapor düzeni daha önce eşleştirilmişti; kayıtlı eşleştirme uygulandı." : null].filter(Boolean);
    const p = { table, map, locale, name, origin: extra.origin || "csv", note: notes.join(" ") || null };
    if (validateMapping(map).length) setPending({ ...p, check: null });
    else tryApply(p);
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setPending(null);
    setPaste(null);
    const isXlsx = /\.xlsx$/i.test(file.name);
    if (/\.xls$/i.test(file.name)) {
      setError("Eski .xls biçimi okunamıyor. Excel'de 'Farklı kaydet → Excel Çalışma Kitabı (.xlsx)' ya da CSV ile kaydedin.");
      return;
    }
    if (!isXlsx && !/\.(csv|txt|tsv)$/i.test(file.name)) {
      setError("Desteklenen dosyalar: .xlsx, .csv, .tsv. İsterseniz tabloyu Excel'den kopyalayıp 'Excel'den yapıştır' ile de ekleyebilirsiniz.");
      return;
    }
    if (file.size > (isXlsx ? MAX_XLSX_BYTES : MAX_FILE_BYTES)) {
      setError(`Dosya ${isXlsx ? "15" : "5"} MB sınırını aşıyor. Daha kısa bir dönem seçip tekrar deneyin.`);
      return;
    }
    try {
      if (isXlsx) {
        const { default: readExcelFile } = await import("read-excel-file/browser");
        // Validate original text before trimming, including edge newlines/tabs.
        const sheets = await readExcelFile(file, { trim: false });
        const sheet = pickSheet(sheets);
        if (!sheet) {
          setError("Excel dosyasında veri bulunan bir sayfa yok.");
          return;
        }
        const table = sheetToTable(sheet.data);
        const bits = [];
        if (sheets.length > 1) bits.push(`${sheets.length} sayfadan "${sheet.sheet}" okundu.`);
        if (table.skippedTitleRows) bits.push(`Üstteki ${table.skippedTitleRows} başlık/açıklama satırı atlandı; tablo ${table.skippedTitleRows + 1}. satırdan başlıyor.`);
        ingest(table, file.name, { origin: "xlsx", note: bits.join(" ") || null });
      } else {
        ingest(parseTable(await file.text()), file.name, { origin: "csv" });
      }
    } catch (err) {
      setError("Dosya okunamadı. " + (err?.message || ""));
    }
  }

  function onPasteSubmit() {
    setError("");
    setPending(null);
    try {
      const table = parseTable(paste || "");
      if (!table.rows.length) {
        setError("Yapıştırılan metinde başlık satırı ve en az bir veri satırı olmalı.");
        return;
      }
      setPaste(null);
      ingest(table, "Yapıştırılan tablo", { origin: "paste" });
    } catch (err) {
      setError("Yapıştırılan tablo okunamadı. " + (err?.message || ""));
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
        // Unknown recency stays last in both directions instead of sorting as 0.
        if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
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
          ekran gerçekten hesaplanıyor: kendi Excel veya CSV dosyanızı yükleyip ya da tabloyu yapıştırıp deneyebilirsiniz.
        </p>
      </header>

      <section className="source" aria-label="Veri kaynağı">
        <div className="meta">
          <b>{source.kind === "demo" ? "Kurgusal demo verisi" : source.name}</b> · {fmtInt(result.kpis.accounts)} müşteri · {fmtInt(result.rowCount)} satır · analiz tarihi{" "}
          {fmtDate(result.asOf)}
          {source.locale && <> · sayı biçimi {LOCALES[source.locale]}</>}
        </div>
        <div className="actions-row">
          <button className="btn primary" onClick={() => fileRef.current?.click()}>
            Kendi dosyanızı yükleyin
          </button>
          <input ref={fileRef} className="hidden-input" type="file" accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} />
          <button className="btn" onClick={() => setPaste((v) => (v === null ? "" : null))}>
            Excel'den yapıştır
          </button>
          {source.kind === "upload" && source.table && (
            <button className="btn" onClick={() => setPending({ table: source.table, map: source.map, locale: source.locale, name: source.name, origin: source.origin, check: null, note: null })}>
              Eşleştirmeyi değiştir
            </button>
          )}
          {source.kind === "upload" ? (
            <button className="btn" onClick={() => setSource({ kind: "demo", name: "Kurgusal demo verisi", rows: SAMPLE_ROWS, warnings: [] })}>
              Demo veriye dön
            </button>
          ) : (
            <button className="btn" onClick={() => download("sahaiq-ornek-veri.csv", toCsv(SAMPLE_ROWS))}>
              Örnek CSV indir
            </button>
          )}
        </div>
        <div className="note">
          Dosyanız yalnızca tarayıcınızda işlenir; hiçbir sunucuya gönderilmez. Excel (.xlsx), CSV/TSV veya herhangi bir ERP/BI ekranından kopyalanmış tablo kabul edilir. Gerekli
          sütunlar: müşteri kodu, müşteri adı, tarih, adet; tutar, ürün, marka ve bölge isteğe bağlı. Yaygın ERP başlıkları (Cari Kodu, Cari Hesap Ünvanı, Evrak Tarihi, Net Tutar…) otomatik
          tanınır; tanınmayanları bir kez eşleştirmeniz yeterli, bu tarayıcı aynı rapor düzenini hatırlar. Hatalı satır varsa analiz yapılmaz, satır numarasıyla gösterilir.
        </div>
      </section>

      {error && <div className="alert err">{error}</div>}
      {paste !== null && (
        <section className="mapping">
          <h3>Excel'den yapıştır</h3>
          <div className="sub">Excel'de, ERP'de ya da BI ekranında tabloyu başlık satırıyla birlikte seçip kopyalayın (Ctrl+C), aşağıya yapıştırın (Ctrl+V).</div>
          <textarea className="paste" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Cari Kodu\tCari Ünvanı\tFatura Tarihi\tMiktar\tNet Tutar\n..."} spellCheck={false} />
          <div className="actions-row" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={!paste.trim()} onClick={onPasteSubmit}>
              Analiz et
            </button>
            <button className="btn" onClick={() => setPaste(null)}>
              Vazgeç
            </button>
          </div>
        </section>
      )}
      {source.kind === "upload" && source.warnings.length > 0 && (
        <div className="alert warn">
          {source.warnings.map((w, i) => (
            <div key={i}>{w.message}</div>
          ))}
        </div>
      )}

      {pending && (
        <section className="mapping">
          <h3>{pending.check?.errors.length ? "Dosyada düzeltilmesi gereken yerler var" : validateMapping(pending.map).length ? "Sütunları eşleştirin" : "Eşleştirmeyi kontrol edin"}</h3>
          <div className="sub">
            {pending.check?.errors.length
              ? `“${pending.name}” analiz edilmedi: hatalı satırlar sessizce atılmaz, çünkü eksik veriyle yapılan analiz yanlış kişiyi öne çıkarır. Sütun veya sayı biçimi yanlış seçildiyse aşağıdan düzeltin; değilse dosyayı düzeltip tekrar yükleyin.`
              : validateMapping(pending.map).length
              ? `“${pending.name}” dosyasındaki bazı sütunları otomatik tanıyamadık. Hangi sütunun neye karşılık geldiğini bir kez seçin; bu tarayıcı aynı rapor düzenini bir dahaki sefere hatırlar.`
              : `“${pending.name}” için seçili eşleştirme aşağıda. Değiştirip tekrar analiz edebilirsiniz.`}
          </div>
          {pending.check?.errors.length > 0 && (
            <div className="alert err" style={{ marginTop: 12 }}>
              <b>{fmtInt(pending.check.errorCount)} hata</b>
              {pending.check.errorCount > pending.check.errors.length && <> (ilk {pending.check.errors.length} tanesi)</>}
              <ul className="errlist">
                {pending.check.errors.slice(0, 12).map((e, i) => (
                  <li key={i}>
                    {e.row ? `Satır ${e.row}: ` : ""}
                    {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mapping-grid">
            {[...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map((f) => (
              <div key={f}>
                <label>
                  {FIELD_LABELS[f]}
                  {REQUIRED_FIELDS.includes(f) ? " *" : ""}
                </label>
                <select value={pending.map[f] || ""} onChange={(e) => setPending({ ...pending, map: { ...pending.map, [f]: e.target.value } })}>
                  <option value="">— seçin —</option>
                  {pending.table.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div>
              <label>Sayı biçimi *</label>
              <select value={pending.locale} onChange={(e) => setPending({ ...pending, locale: e.target.value })}>
                {Object.entries(LOCALES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="actions-row">
            <button className="btn primary" disabled={validateMapping(pending.map).length > 0} onClick={() => tryApply(pending)}>
              {pending.check ? "Tekrar kontrol et" : "Analiz et"}
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
          <div className="s">son kayıt: {fmtDate(result.asOf)}</div>
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
                      <span className="chip">{SEGMENTS[c.segmentKey]?.label}</span> · {unit(cust.monetary)} · son alım {fmtRecency(cust.recency_days)}
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

      <section className="brief" aria-label="Sabah brifingi önizlemesi">
        <div className="table-head" style={{ marginTop: 30 }}>
          <div>
            <h2>Sabah brifingi önizlemesi</h2>
            <p className="sub" style={{ margin: 0 }}>
              Yukarıdaki hesaplardan şablonla üretilir. Yapay zekâ kullanılmaz; fiyat, stok ya da kampanya vaadi içermez. Otomatik gönderim henüz yok: kopyalayıp WhatsApp veya Telegram'a
              yapıştırabilirsiniz.
            </p>
          </div>
          <div className="actions-row">
            <span className={`chip ${briefing.check.ok ? "okchip" : "badchip"}`} title="Metindeki her rakam hesaplanan veride var mı?">
              {briefing.check.ok ? "✓ Tüm rakamlar veriden" : `Doğrulanmayan rakam: ${briefing.check.unknown.join(", ")}`}
            </span>
            <button className="btn" onClick={copyBriefing}>
              {copied || "Metni kopyala"}
            </button>
          </div>
        </div>
        <pre className="brief-text">{briefing.text}</pre>
      </section>

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
              {th("frequency", "Alım günü", "num")}
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
                  {c.R ?? "–"} · {c.F ?? "–"} · {c.M ?? "–"}
                </td>
                <td className="num">{fmtRecency(c.recency_days, { compact: true })}</td>
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
            <b>RFM:</b> Pozitif satışı olan müşteriler; son alımdan bu yana geçen gün (R), alım yapılan gün sayısı (F) ve toplam ciro (M) bakımından birbirlerine göre 1–5 arası puanlanır.
          </li>
          <li>
            <b>Segment:</b> Puanların birleşiminden Şampiyon, Sadık, Risk altında, Yeni, Standart veya Pasif segmenti çıkar. Yüklenen veride pozitif satışı olmayanlar “Alım geçmişi yok” olarak gösterilir; puan ve satış takibi önerisi üretilmez.
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
