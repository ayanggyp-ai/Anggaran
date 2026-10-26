/* =========================================================
   KONFIGURASI
========================================================= */

const SPREADSHEET_ID = "1yCqCOq9LxYnmES5LdoDiNrNW5uGKsPJ5af4mu3Ga4l8";
const SHEET_GID = "2054630734";

const MONTHS = ["jan", "feb", "mar", "apr", "mei", "jun", "jul", "agus", "sept", "okt", "nov", "des"];
const MONTH_LABELS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

/* =========================================================
   DATA GLOBAL
========================================================= */

let allItems = [];
let pjList = [];
let monthlyAverage = new Array(12).fill(0);
let currentSort = "original";
let chartMonthly = null;
let chartPJ = null;

/* =========================================================
   ELEMENT
========================================================= */

const refreshBtn = document.getElementById("refreshBtn");
const sortSelect = document.getElementById("sortSelect");
const itemSearch = document.getElementById("itemSearch");
const pjFilter = document.getElementById("pjFilter");
const itemGrid = document.getElementById("itemGrid");
const itemEmpty = document.getElementById("itemEmpty");
const loading = document.getElementById("loading");
const errorMessage = document.getElementById("errorMessage");
const errorText = document.getElementById("errorText");
const dataStatus = document.getElementById("dataStatus");

/* =========================================================
   LOAD GOOGLE SHEETS
========================================================= */

async function loadData() {
  showLoading();

  try {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?gid=${SHEET_GID}&headers=0&tqx=out:json&_=${Date.now()}`;

    const response = await fetch(url, { cache: "no-store" });
    console.log("[dashboard v2] data diambil", new Date().toLocaleTimeString("id-ID"), url);
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

    const text = await response.text();
    const json = parseGoogleResponse(text);
    const table = json.table;
    if (!table) throw new Error("Struktur data Google Sheets tidak ditemukan.");

    const rawRows = (table.rows || []).map((r) => (r.c || []).map(cellValue));
    const colLabels = (table.cols || []).map((c) => (c && c.label ? c.label : ""));

    // Diagnostik: buka Console (F12) kalau ada bagian yang gagal terbaca.
    console.groupCollapsed("[dashboard-capaian] Diagnostik data mentah (10 baris pertama)");
    console.log("table.cols labels:", colLabels);
    console.table(rawRows.slice(0, 10));
    console.groupEnd();

    const parsed = parseSheet(rawRows, colLabels);
    allItems = parsed.items;
    monthlyAverage = parsed.monthlyAverage;
    pjList = parsed.pjList;

    populatePjFilter();
    renderStats();
    renderCharts();
    renderList();

    dataStatus.textContent = `${allItems.length} output · Update: ${new Date().toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    })}`;

    hideLoading();
  } catch (error) {
    console.error("Terjadi kesalahan:", error);
    showError(error.message);
  }
}

/* =========================================================
   PARSE GOOGLE RESPONSE
========================================================= */

function parseGoogleResponse(text) {
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start === -1 || end === -1) throw new Error("Format response Google Sheets tidak valid.");

  const json = JSON.parse(text.substring(start + 1, end));
  if (json.status === "error") {
    const msg =
      (json.errors && json.errors[0] && json.errors[0].detailed_message) ||
      "Sheet tidak ditemukan atau tidak dapat diakses.";
    throw new Error(msg);
  }
  return json;
}

function cellValue(cell) {
  if (!cell) return null;
  if (cell.v !== undefined && cell.v !== null) return cell.v;
  if (cell.f !== undefined && cell.f !== null && cell.f !== "") return cell.f;
  return null;
}

function normText(v) {
  return v === null || v === undefined ? "" : String(v).trim().toLowerCase();
}

function textOf(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

/* =========================================================
   PARSING UTAMA
   Sheet ini punya banyak kolom kosong/tersembunyi tanpa label teks
   (mis. kolom satuan, PJ, dan blok bulan kedua). Strateginya:
   1) Temukan baris header via teks "Kode".
   2) Temukan kolom "Target Vol RO pada DIPA" & "PJ/Ketua Tim" via
      pencocokan substring teks (keduanya benar-benar ada sebagai teks).
   3) Temukan SEMUA posisi label bulan ("Jan","Feb",...) di baris-baris
      sekitar header — ini menandai 2 blok data bulanan (Volume & %
      Capaian). Blok pertama = Volume, blok kedua = % Capaian.
========================================================= */

function findRowWithText(rows, matcher, searchLimit) {
  const limit = searchLimit ?? rows.length;
  for (let i = 0; i < Math.min(rows.length, limit); i++) {
    const row = rows[i];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (matcher(normText(row[c]))) return { rowIdx: i, colIdx: c };
    }
  }
  return null;
}

function findColumnBySubstring(rows, substrings, searchLimit) {
  const limit = searchLimit ?? rows.length;
  for (let i = 0; i < Math.min(rows.length, limit); i++) {
    const row = rows[i];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const t = normText(row[c]);
      if (substrings.some((s) => t.includes(s))) return { rowIdx: i, colIdx: c };
    }
  }
  return null;
}

// Cari SEMUA baris (dalam jendela baris tertentu) yang memuat label bulan,
// lalu kembalikan peta {namaBulan: kolomIndex} untuk tiap kemunculan blok.
function findMonthBlocks(rows, fromIdx, toIdx) {
  const blocks = [];

  for (let i = fromIdx; i <= toIdx && i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    // Hitung berapa banyak label bulan dikenali pada baris ini
    const janPositions = [];
    for (let c = 0; c < row.length; c++) {
      if (normText(row[c]) === "jan") janPositions.push(c);
    }
    if (!janPositions.length) continue;

    janPositions.forEach((startCol) => {
      // Validasi: kolom-kolom berikutnya harus cocok dengan urutan bulan
      let valid = true;
      for (let m = 1; m < 6; m++) {
        // cukup validasi 6 bulan pertama biar tetap toleran pada sheet lain
        if (normText(row[startCol + m]) !== MONTHS[m]) {
          valid = false;
          break;
        }
      }
      if (valid) blocks.push({ rowIdx: i, startCol });
    });
  }

  return blocks;
}

function parseSheet(rows, colLabels) {
  const headerHit = findRowWithText(rows, (t) => t === "kode", 15);
  const headerIdx = headerHit ? headerHit.rowIdx : -1;
  const kodeCol = headerHit ? headerHit.colIdx : 0;
  const rincianCol = kodeCol + 1;

  const targetVolHit = findColumnBySubstring(rows, ["target vol"], 15);
  const targetVolCol = targetVolHit ? targetVolHit.colIdx : kodeCol + 2;
  const satuanCol = targetVolCol + 1;

  const pjHit = findColumnBySubstring(rows, ["pj ", "pj/", "ketua tim"], 15);
  const pjCol = pjHit ? pjHit.colIdx : -1;

  // Cari 2 blok bulan (Volume per Bulan & Capaian per Bulan) di sekitar
  // baris header (header row itu sendiri ATAU 1-2 baris setelahnya, karena
  // label bulan bisa berada di baris sub-header terpisah akibat merge cell).
  const scanFrom = Math.max(0, headerIdx);
  const scanTo = headerIdx + 3;
  const monthBlocks = findMonthBlocks(rows, scanFrom, scanTo);

  let volBlock = monthBlocks[0] || null;
  let capaianBlock = monthBlocks[1] || null;

  // Fallback: kalau label teks "Jan/Feb/dst" tidak ditemukan sama sekali
  // (kasus di sheet ini — header sub-kolom bulan tidak tersimpan sebagai
  // teks), asumsikan blok "% Capaian per Bulan" adalah 13 KOLOM TERAKHIR
  // pada tiap baris (12 bulan + Jumlah), karena posisi ini terverifikasi
  // konsisten dari data mentah nyata. Blok Volume per Bulan tidak dipakai
  // di tampilan manapun sehingga cukup diabaikan kalau tidak ketemu lewat teks.
  if (!capaianBlock) {
    const colCount = Math.max(...rows.map((r) => (r ? r.length : 0)));
    if (colCount >= 13) {
      capaianBlock = { rowIdx: headerIdx, startCol: colCount - 13 };
    }
  }

  // Baris data dimulai TEPAT SETELAH baris yang memuat label bulan
  // (kalau label bulan ada di baris terpisah dari "Kode"), atau setelah
  // baris header "Kode" itu sendiri.
  let dataStart = headerIdx + 1;
  if (monthBlocks.length) {
    const monthRowIdx = Math.max(...monthBlocks.map((b) => b.rowIdx));
    dataStart = Math.max(dataStart, monthRowIdx + 1);
  }

  const items = [];
  const pjSet = new Set();
  const monthSums = new Array(12).fill(0);
  const monthCounts = new Array(12).fill(0);

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const kode = textOf(row[kodeCol]);
    const rincian = textOf(row[rincianCol]);

    if (!kode && !rincian) {
      // Baris kosong bisa jadi pemisah biasa atau akhir tabel. Cek apakah
      // masih ada baris data berkode setelahnya dalam 3 baris ke depan;
      // kalau tidak, anggap tabel sudah selesai.
      const stillHasData = [1, 2, 3].some((k) => rows[i + k] && textOf(rows[i + k][kodeCol]));
      if (!stillHasData) break;
      continue;
    }
    if (/^ket\s*:?$/i.test(kode) || /^ket\s*:?$/i.test(rincian)) break; // baris "Ket :" = akhir tabel
    if (!kode) continue;

    const pjRaw = pjCol >= 0 ? textOf(row[pjCol]) : "";
    // Beberapa baris menuliskan literal "0" di kolom PJ alih-alih dikosongkan
    // — perlakukan sebagai "belum ditentukan" juga, bukan nama PJ sungguhan.
    const pj = pjRaw && pjRaw !== "0" ? pjRaw : "";
    if (pj) pjSet.add(pj);

    const capaianPerBulan = MONTHS.map((_, idx) => {
      if (!capaianBlock) return 0;
      const v = toNumber(row[capaianBlock.startCol + idx]);
      return v || 0;
    });

    capaianPerBulan.forEach((v, idx) => {
      monthSums[idx] += v;
      monthCounts[idx] += 1;
    });

    const volumePerBulan = MONTHS.map((_, idx) => {
      if (!volBlock) return null;
      return toNumber(row[volBlock.startCol + idx]);
    });

    items.push({
      kode,
      rincian: rincian || "(tanpa uraian)",
      targetVol: toNumber(row[targetVolCol]),
      satuan: textOf(row[satuanCol]),
      pj: pj || "Belum ditentukan",
      volumePerBulan,
      capaianPerBulan,
      peakMonthIdx: capaianPerBulan.reduce(
        (best, v, idx) => (v > capaianPerBulan[best] ? idx : best),
        0,
      ),
    });
  }

  const monthlyAverage = monthSums.map((sum, idx) => (monthCounts[idx] ? sum / monthCounts[idx] : 0));

  const pjList = Array.from(pjSet).sort((a, b) => a.localeCompare(b, "id"));

  return { items, monthlyAverage, pjList };
}

/* =========================================================
   FORMAT
========================================================= */

function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const cleaned = String(v)
    .replace(/[^\d.,\-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function formatInteger(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

function formatPct(value) {
  if (value === null || value === undefined) return "-";
  return Number(value).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + "%";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* =========================================================
   RENDER: STAT CARDS
========================================================= */

function renderStats() {
  document.getElementById("totalRO").textContent = formatInteger(allItems.length);
  document.getElementById("totalPJ").textContent = formatInteger(pjList.length);

  const peakIdx = monthlyAverage.reduce((best, v, idx) => (v > monthlyAverage[best] ? idx : best), 0);
  document.getElementById("peakMonth").textContent = MONTH_LABELS[peakIdx] || "-";
  document.getElementById("peakMonthSub").textContent = `rata-rata ${formatPct(monthlyAverage[peakIdx])} output`;

  const noPj = allItems.filter((it) => it.pj === "Belum ditentukan").length;
  document.getElementById("noPjCount").textContent = formatInteger(noPj);

  const banner = document.getElementById("statsInsightBanner");
  banner.innerHTML = `Dari <strong>${allItems.length} Rincian Output</strong> yang dipantau, beban rencana capaian tertinggi ada di bulan <strong>${
    MONTH_LABELS[peakIdx] || "-"
  }</strong> (rata-rata ${formatPct(monthlyAverage[peakIdx])} per output). ${
    noPj > 0 ? `<strong>${noPj} output</strong> belum memiliki penanggung jawab yang tercatat.` : "Semua output sudah memiliki penanggung jawab."
  }`;
}

/* =========================================================
   RENDER: CHARTS
========================================================= */

function renderCharts() {
  renderChartMonthly();
  renderChartPJ();
}

function renderChartMonthly() {
  const ctx = document.getElementById("chartMonthly");
  if (!ctx) return;

  if (chartMonthly) chartMonthly.destroy();

  chartMonthly = new Chart(ctx, {
    type: "bar",
    data: {
      labels: MONTH_LABELS,
      datasets: [
        {
          label: "Rata-rata % Capaian",
          data: monthlyAverage,
          backgroundColor: "#0066a1",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => formatPct(c.raw) } },
      },
      scales: {
        y: { ticks: { callback: (v) => v + "%", font: { size: 10 } } },
        x: { ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 45 } },
      },
    },
  });

  const peakIdx = monthlyAverage.reduce((best, v, idx) => (v > monthlyAverage[best] ? idx : best), 0);
  document.getElementById("chartMonthlyInsight").innerHTML = `Bulan <strong>${
    MONTH_LABELS[peakIdx]
  }</strong> menjadi periode dengan rata-rata rencana capaian tertinggi (${formatPct(monthlyAverage[peakIdx])}).`;
}

function renderChartPJ() {
  const ctx = document.getElementById("chartPJ");
  if (!ctx) return;

  const counts = {};
  allItems.forEach((it) => {
    counts[it.pj] = (counts[it.pj] || 0) + 1;
  });

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const labels = sorted.map(([name]) => (name.length > 20 ? name.slice(0, 20) + "…" : name));
  const data = sorted.map(([, count]) => count);

  if (chartPJ) chartPJ.destroy();

  chartPJ = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Jumlah RO", data, backgroundColor: "#159447", borderRadius: 6 }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.raw} output` } },
      },
      scales: {
        x: { ticks: { stepSize: 1, font: { size: 10 } } },
        y: { ticks: { font: { size: 10 } } },
      },
    },
  });

  if (sorted.length) {
    document.getElementById("chartPJInsight").innerHTML = `<strong>${escapeHtml(
      sorted[0][0],
    )}</strong> menangani jumlah output terbanyak (${sorted[0][1]} RO).`;
  } else {
    document.getElementById("chartPJInsight").textContent = "Belum ada data penanggung jawab.";
  }
}

/* =========================================================
   RENDER: DAFTAR OUTPUT
========================================================= */

function populatePjFilter() {
  const hasUnassigned = allItems.some((it) => it.pj === "Belum ditentukan");
  pjFilter.innerHTML =
    `<option value="all">Semua</option>` +
    pjList.map((pj) => `<option value="${escapeHtml(pj)}">${escapeHtml(pj)}</option>`).join("") +
    (hasUnassigned ? `<option value="Belum ditentukan">Belum ditentukan</option>` : "");
}

function applyFilters() {
  const q = (itemSearch.value || "").trim().toLowerCase();
  const pjVal = pjFilter.value;

  let list = allItems.filter((it) => {
    if (
      q &&
      !(
        it.kode.toLowerCase().includes(q) ||
        it.rincian.toLowerCase().includes(q) ||
        it.pj.toLowerCase().includes(q)
      )
    )
      return false;
    if (pjVal !== "all" && it.pj !== pjVal) return false;
    return true;
  });

  switch (currentSort) {
    case "target-desc":
      list.sort((a, b) => (b.targetVol || 0) - (a.targetVol || 0));
      break;
    case "peak-desc":
      list.sort((a, b) => Math.max(...b.capaianPerBulan) - Math.max(...a.capaianPerBulan));
      break;
    case "name-asc":
      list.sort((a, b) => a.rincian.localeCompare(b.rincian, "id"));
      break;
    default:
      break;
  }

  return list;
}

function renderSparkline(item) {
  const max = Math.max(...item.capaianPerBulan, 1);
  return `
    <div class="sparkline">
      ${item.capaianPerBulan
        .map((v, idx) => {
          const h = Math.max(3, Math.round((v / max) * 100));
          return `<div class="sparkline-bar" style="height:${h}%" data-tooltip="${MONTH_LABELS[idx]}: ${formatPct(v)}"></div>`;
        })
        .join("")}
    </div>
    <div class="sparkline-labels">
      <span>${MONTH_LABELS[0]}</span><span>${MONTH_LABELS[11]}</span>
    </div>
  `;
}

function renderItemCard(item) {
  return `
    <div class="satker-card capaian-card">
      <div class="card-top">
        <div>
          <div class="satker-code">${escapeHtml(item.kode)}</div>
          <div class="satker-name">${escapeHtml(item.rincian)}</div>
        </div>
      </div>

      <div class="card-metrics">
        <div class="metric">
          <span>Target Volume (DIPA)</span>
          <strong>${item.targetVol !== null ? formatInteger(item.targetVol) : "-"} ${escapeHtml(item.satuan || "")}</strong>
        </div>
        <div class="metric">
          <span>Penanggung Jawab</span>
          <strong>${escapeHtml(item.pj)}</strong>
        </div>
      </div>

      <div class="nka-block">
        <div class="nka-label">
          <span>Rencana Capaian per Bulan</span>
          <span class="nka-value">Puncak: ${MONTH_LABELS[item.peakMonthIdx]} (${formatPct(
            item.capaianPerBulan[item.peakMonthIdx],
          )})</span>
        </div>
        ${renderSparkline(item)}
      </div>
    </div>
  `;
}

function renderList() {
  const list = applyFilters();

  if (!list.length) {
    itemGrid.innerHTML = "";
    itemEmpty.style.display = "block";
    return;
  }

  itemEmpty.style.display = "none";
  itemGrid.innerHTML = list.map(renderItemCard).join("");
}

/* =========================================================
   LOADING / ERROR
========================================================= */

function showLoading() {
  loading.style.display = "block";
  itemGrid.style.display = "none";
  errorMessage.style.display = "none";
  itemEmpty.style.display = "none";
}

function hideLoading() {
  loading.style.display = "none";
  itemGrid.style.display = "grid";
  errorMessage.style.display = "none";
}

function showError(message) {
  loading.style.display = "none";
  itemGrid.style.display = "none";
  errorMessage.style.display = "block";
  errorText.textContent = message || "Terjadi kesalahan ketika mengambil data.";
}

/* =========================================================
   EVENT
========================================================= */

refreshBtn.addEventListener("click", () => loadData());

sortSelect.addEventListener("change", () => {
  currentSort = sortSelect.value;
  renderList();
});

pjFilter.addEventListener("change", renderList);

let searchDebounce;
itemSearch.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(renderList, 150);
});

/* =========================================================
   START
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  loadData();
  // Auto-refresh: tiap 2 menit & saat tab kembali dibuka, agar perubahan di spreadsheet ikut tampil
  const AUTO_REFRESH_MS = 120000;
  let lastLoad = Date.now();
  const refresh = () => { lastLoad = Date.now(); loadData(); };
  setInterval(() => { if (!document.hidden) refresh(); }, AUTO_REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - lastLoad > 30000) refresh();
  });
});
