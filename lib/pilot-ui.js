// All source values are rendered with textContent, never interpolated as HTML.
const $ = id => document.getElementById(id);
let sourceTable = null, mapping = {}, validation = null, currentReport = null;
let sourceName = "", readAt = "", isDemo = false, loadGeneration = 0;
const fmt = value => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value);
const moneyFmt = value => value === null ? "Bilinmiyor" : new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + " TL";
const todayIstanbul = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; }
function clearError() { $("globalError").hidden = true; $("globalError").textContent = ""; }
function showError(error) { $("globalError").textContent = error.message || String(error); $("globalError").hidden = false; }
function invalidateReport() { currentReport = null; $("reportCard").hidden = true; $("verified").checked = false; $("duplicates").checked = false; }
function reset() {
  loadGeneration++;
  sourceTable = null; mapping = {}; validation = null; currentReport = null; sourceName = ""; readAt = ""; isDemo = false;
  $("file").value = ""; $("paste").value = ""; $("filename").textContent = "Henüz dosya seçilmedi.";
  $("mappingCard").hidden = true; invalidateReport(); clearError();
  $("modeBadge").className = "badge"; $("modeBadge").textContent = "CANLI BAĞLANTI YOK";
  for (const id of ["mapping", "validation", "preview", "sourceInfo", "reportWarnings", "reportActions", "metrics", "customers", "limits"]) $(id).replaceChildren();
}
function tableElement(headers, rows) {
  const table = node("table"), thead = node("thead"), tr = node("tr");
  headers.forEach(h => tr.append(node("th", h))); thead.append(tr); table.append(thead);
  const body = node("tbody");
  rows.forEach(values => { const row = node("tr"); values.forEach(value => row.append(node("td", value === null || value === undefined ? "Bilinmiyor" : String(value)))); body.append(row); });
  table.append(body); return table;
}
function setSource(text, name, demo = false) {
  loadGeneration++;
  // Discard the previous source BEFORE parsing; a failed new upload cannot leave an old report visible.
  sourceTable = null; validation = null; mapping = {}; invalidateReport(); $("mappingCard").hidden = true; clearError();
  sourceName = name; isDemo = demo; readAt = new Date().toISOString();
  $("filename").textContent = name;
  $("modeBadge").textContent = demo ? "ÖRNEK VERİ • GERÇEK DEĞİL" : "DOSYA MODU • CANLI DEĞİL";
  $("modeBadge").className = demo ? "badge demo-badge" : "badge";
  try {
    sourceTable = parseTable(text);
    if (!sourceTable.rows.length) throw new Error("Tabloda başlıkların altında veri satırı bulunamadı.");
    mapping = autoMapping(sourceTable.headers); renderMapping(); $("mappingCard").hidden = false; refreshValidation();
  } catch (error) { showError(error); }
}
function renderMapping() {
  $("mapping").replaceChildren();
  [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].forEach(field => {
    const box = node("div"), label = node("label", FIELD_LABELS[field] + (REQUIRED_FIELDS.includes(field) ? " *" : ""));
    const select = node("select"); select.id = "map-" + field; label.htmlFor = select.id;
    const empty = node("option", "Seç / eşleştirme yok"); empty.value = ""; select.append(empty);
    sourceTable.headers.forEach(header => { const option = node("option", header); option.value = header; select.append(option); });
    select.value = mapping[field] || "";
    select.addEventListener("change", () => { mapping[field] = select.value; invalidateReport(); refreshValidation(); });
    box.append(label, select); $("mapping").append(box);
  });
}
function refreshValidation() {
  if (!sourceTable) return;
  validation = validateDataset(sourceTable, mapping, { asOfDate: $("sourceDate").value, locale: $("locale").value });
  if (Number($("followup").value) < 1 || Number($("followup").value) > 3650 || !Number.isInteger(Number($("followup").value))) validation.errors.push({ row: 0, field: "followupDays", message: "Takip eşiği 1–3650 tam gün olmalı." });
  $("validation").replaceChildren();
  const validCount = validation.rows.length;
  $("validation").append(node("div", `${fmt(validation.sourceRows)} kaynak satırı • ${fmt(validCount)} biçimi geçerli satır • ${validation.errors.length} hata • ${validation.warnings.length} uyarı`, validation.errors.length ? "error" : "good"));
  if (validation.errors.length) $("validation").append(node("p", "Hatalı satırlar dışarı atılıp rapor üretilmez. Hatalar düzelene kadar rapor kapalıdır.", "muted"));
  const issues = [...validation.errors, ...validation.warnings];
  if (issues.length) {
    const details = node("details"); details.open = true;
    details.append(node("summary", `Kontrol ayrıntıları (${issues.length}; ilk 100 gösterilir)`));
    const wrapper = node("div", undefined, "tablewrap");
    const table = tableElement(["Kaynak satırı", "Alan", "Açıklama"], issues.slice(0,100).map(issue => [issue.row || "Genel", FIELD_LABELS[issue.field] || issue.field, issue.message]));
    for (const tr of table.querySelectorAll("tbody tr")) tr.lastChild.className = "wrap";
    wrapper.append(table); details.append(wrapper); $("validation").append(details);
  }
  $("preview").replaceChildren(node("p", "Okunan ilk 5 satırın doğrulama önizlemesi", "muted"), tableElement(["Kaynak satırı", "Cari kod", "Cari ünvan", "Tarih", "Net adet", "Net tutar"], validation.rows.slice(0,5).map(r => [r.sourceRow, r.customer_id, r.customer_name, r.date, fmt(r.quantity), moneyFmt(r.revenue)])));
  $("duplicateLabel").hidden = !validation.warnings.some(w => w.field === "duplicate");
  updateReadiness();
}
function updateReadiness() {
  const duplicateOk = $("duplicateLabel").hidden || $("duplicates").checked;
  const ready = validation && !validation.errors.length && validation.rows.length > 0 && duplicateOk && $("verified").checked;
  $("reportButton").disabled = !ready;
  $("ready").textContent = ready ? "Dosya bazlı rapor hazırlanabilir." : "Hataları ve kaynak onayını tamamla.";
  if (currentReport && !ready) { currentReport = null; $("reportCard").hidden = true; }
}
function renderReport() {
  if (!validation || validation.errors.length || $("reportButton").disabled) return;
  clearError();
  try {
    currentReport = summarizeSales(validation.rows, { asOfDate: $("sourceDate").value, followupDays: Number($("followup").value) });
    const r = currentReport;
    $("sourceInfo").textContent = `${isDemo ? "ÖRNEK VERİ / " : ""}Kaynak: ${sourceName} • Okundu: ${new Date(readAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} (İstanbul) • Kaynak rapor tarihi: ${r.asOfDate} • Satış tarihleri: ${r.earliestDate} – ${r.latestDate}`;
    $("reportWarnings").replaceChildren();
    if (isDemo) $("reportWarnings").append(node("div", "Bu rapor sentetik örnek veriye aittir; gerçek bayi veya ticari sonuç içermez.", "warn"));
    if (r.asOfDate !== todayIstanbul()) $("reportWarnings").append(node("div", "Kaynak rapor tarihi bugün değil. Aşağıdaki sonuçlar bugünün canlı durumunu değil, belirtilen tarihteki dosyayı anlatır.", "warn"));
    if (validation.warnings.length) $("reportWarnings").append(node("div", `${validation.warnings.length} veri uyarısı korunuyor. Kaynak kontrolündeki uyarılar ortadan kalkmış sayılmadı.`, "warn"));
    $("reportActions").replaceChildren();
    if (!r.actions.length) $("reportActions").append(node("div", "⚪ Belirlenen takip eşiğini aşan pozitif satış kaydı bulunmadı. Bu sonuç, bölgede tahsilat veya sevkiyat sorunu olmadığı anlamına gelmez.", "hint"));
    r.actions.slice(0,5).forEach((action, i) => {
      const card = node("article", undefined, "action");
      card.append(node("h3", `${i + 1}. 🟠 ${action.customerName} (${action.customerId})`), node("p", action.reason), node("p", action.nextAction), node("small", `Kaynak veri satırları: ${action.sourceRows.slice(0,10).join(", ")}${action.sourceRows.length > 10 ? "…" : ""}`));
      $("reportActions").append(card);
    });
    if (r.actions.length > 5) $("reportActions").append(node("p", `${r.actions.length} takip adayından en öncelikli 5'i gösteriliyor. Tümü indirilen raporda bulunur.`, "muted"));
    $("metrics").replaceChildren();
    [["Dosyadaki müşteri", fmt(r.customerCount)], ["Net lastik adedi", fmt(r.netQuantity)], ["Tam net ciro", moneyFmt(r.revenue)], ["Takip adayı", fmt(r.actions.length)]].forEach(([label, value]) => {
      const card = node("div", undefined, "metric"); card.append(node("small", label), node("b", value)); $("metrics").append(card);
    });
    $("customers").replaceChildren(tableElement(["Cari kod", "Cari ünvan", "Net adet", "Net ciro", "Son pozitif satış", "Geçen gün"], r.customers.slice(0,500).map(c => [c.id, c.name, fmt(c.netQuantity), moneyFmt(c.revenue), c.lastPositiveSale, c.daysSincePositiveSale])));
    if (r.customers.length > 500) $("customers").append(node("p", "Ekranda ilk 500 müşteri gösteriliyor; hesaplama tüm doğrulanmış satırları kapsar.", "muted"));
    $("limits").replaceChildren(...r.limits.map(text => node("p", "⚪ " + text)), node("p", `Pozitif adet: ${fmt(r.grossQuantity)} • Negatif/iadeye konu adet: ${fmt(r.returnQuantity)} • Tutarı eksik satır: ${r.missingMoneyRows}.`));
    if (r.missingMoneyRows) $("limits").append(node("p", `Yalnızca bilinen tutarların ara toplamı: ${moneyFmt(r.knownRevenue)}. Bu rakam tam ciro değildir.`));
    $("reportCard").hidden = false;
  } catch (error) { currentReport = null; $("reportCard").hidden = true; showError(error); }
}
function downloadReport() {
  if (!currentReport) return;
  const r = currentReport;
  const lines = ["SAHAIQ / GÖZLEMCİ DOSYA RAPORU", isDemo ? "SENTETİK ÖRNEK VERİ — GERÇEK DEĞİL" : "Canlı bağlantı kullanılmadı.",
    `Kaynak: ${sourceName}`, `Kaynak rapor tarihi: ${r.asOfDate}`, `Okuma zamanı (UTC): ${readAt}`, `Satış tarihleri: ${r.earliestDate} – ${r.latestDate}`, "",
    "ÖNCELİKLİ TAKİPLER (dosya bazlı)", ...r.actions.flatMap((a,i) => [`${i+1}. ${a.customerName} (${a.customerId})`, a.reason, a.nextAction, `Kaynak satırları: ${a.sourceRows.join(", ")}`, ""]),
    `Müşteri: ${r.customerCount} | Satış satırı: ${r.rowCount} | Net adet: ${fmt(r.netQuantity)} | Tam ciro: ${moneyFmt(r.revenue)}`, "",
    "VERİ UYARILARI", ...validation.warnings.map(w => `Satır ${w.row || "genel"}: ${w.message}`), "",
    "SINIRLAR", ...r.limits];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }));
  const anchor = node("a"); anchor.href = url; anchor.download = "SahaIQ-Gozlemci-" + r.asOfDate + ".txt"; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("file").addEventListener("change", async event => {
  const file = event.target.files?.[0]; if (!file) return;
  const generation = ++loadGeneration;
  // Hide prior results even when decoding the new file fails.
  sourceTable = null; validation = null; invalidateReport(); $("mappingCard").hidden = true; clearError();
  try {
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) throw new Error("CSV / TSV seçin; Excel .xlsx tablosunu kopyalayıp yapıştırın.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Dosya 5 MB sınırını aşıyor.");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    if (generation !== loadGeneration) return;
    $("paste").value = ""; setSource(text, file.name);
  } catch (error) { if (generation !== loadGeneration) return; showError(new Error(error instanceof TypeError ? "Dosya UTF-8 olarak okunamadı. Excel'den kopyalayın veya UTF-8 CSV kaydedin." : error.message)); }
});
$("pasteButton").addEventListener("click", () => setSource($("paste").value, "Elle yapıştırılan Excel / tablo"));
$("clear").addEventListener("click", reset);
$("demo").addEventListener("click", () => {
  $("sourceDate").value = "2026-09-30"; $("locale").value = "tr-TR";
  const demo = "Cari Kod;Cari Ünvan;Tarih;Adet;Ciro\n001;ÖRNEK Bayi A;01.08.2026;1.000;152.544,50\n002;ÖRNEK Bayi B;25.09.2026;24;48.000,00\n003;ÖRNEK Bayi C;10.08.2026;12;\n";
  $("paste").value = demo; setSource(demo, "Sentetik örnek / gerçek veri değil", true);
});
for (const id of ["sourceDate", "locale", "followup"]) $(id).addEventListener(id === "locale" ? "change" : "input", () => { invalidateReport(); refreshValidation(); });
for (const id of ["verified", "duplicates"]) $(id).addEventListener("change", updateReadiness);
$("reportButton").addEventListener("click", renderReport);
$("download").addEventListener("click", downloadReport);
