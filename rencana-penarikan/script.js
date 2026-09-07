/* =========================================================
   KONFIGURASI
========================================================= */

const SPREADSHEET_ID = "1N1sUsFn2DiVI_qlgy6ejZtYBLTl3MCEHJzPb90Dqz0U";
const SHEET_GID = "1322919422";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agust", "Sept", "Okt", "Nov", "Des"];
const MONTH_LABELS_FULL = [
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

/* Pemetaan kolom tabel utama (A..X, index 0..23) */
const COL = {
  kode: 0,
  desk1: 3,
  desk2: 4,
  volume: 6,
  satuan: 7,
  harga: 8,
  jumlah: 9,
  blokir: 10,
  monthStart: 12, // M..X = 12 kolom bulan
};

const LEVEL_PATTERNS = [
  { level: 3, re: /^\d{4}\.[A-Z]{2,4}\.\d{2,3}$/i },
  { level: 2, re: /^\d{4}\.[A-Z]{2,4}$/i },
  { level: 0, re: /^\d{3}\.\d{2}\.[A-Z]{2}$/i },
  { level: 1, re: /^\d{4}$/ },
  { level: 6, re: /^\d{6}$/ },
  { level: 4, re: /^\d{3}$/ },
  { level: 5, re: /^[A-Za-z]{1,2}$/ },
];

const LEVEL_LABELS = {
  0: "Program",
  1: "Kegiatan",
  2: "Output",
  3: "Sub Output",
  4: "Komponen",
  5: "Sub Komponen",
  6: "Akun",
  7: "Rincian",
};

/* =========================================================
   DATA GLOBAL
========================================================= */

let treeRoots = [];
let belanjaSummary = []; // [{ code, label, monthly:[12] }]
let cumulativePctRow = new Array(12).fill(0); // baris "Realisasi (%)"
let pelaksanaanRow = new Array(12).fill(0); // baris "Pelaksanaan" (total nominal per bulan)
let overallStats = null; // { pagu, periode, tw }
let currentSort = "original";
let chartCumulative = null;
let chartBelanja = null;
let chartPelaksanaan = null;

/* =========================================================
   ELEMENT
========================================================= */

const refreshBtn = document.getElementById("refreshBtn");
const sortSelect = document.getElementById("sortSelect");
const treeSearch = document.getElementById("treeSearch");
const expandAllBtn = document.getElementById("expandAllBtn");
const collapseAllBtn = document.getElementById("collapseAllBtn");
const treeContainer = document.getElementById("treeContainer");
const treeEmpty = document.getElementById("treeEmpty");
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
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?gid=${SHEET_GID}&headers=0&tqx=out:json`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

    const text = await response.text();
    const json = parseGoogleResponse(text);
    const table = json.table;
    if (!table) throw new Error("Struktur data Google Sheets tidak ditemukan.");

    const rawRows = (table.rows || []).map((r) => (r.c || []).map(cellValue));
    const colLabels = (table.cols || []).map((c) => (c && c.label ? c.label : ""));

    console.groupCollapsed("[dashboard-rencana] Diagnostik data mentah (10 baris pertama)");
    console.log("table.cols labels:", colLabels);
    console.table(rawRows.slice(0, 10));
    console.groupEnd();

    const parsed = parseSheet(rawRows);
    belanjaSummary = parsed.belanjaSummary;
    cumulativePctRow = parsed.cumulativePctRow;
    pelaksanaanRow = parsed.pelaksanaanRow;
    treeRoots = parsed.treeRoots;
    overallStats = parsed.stats;

    renderPeriod();
    renderStats();
    renderCharts();
    renderTree();

    dataStatus.textContent = `${treeRoots.length} program · Update: ${new Date().toLocaleString("id-ID", {
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
========================================================= */

function classifyRow(kodeText) {
  for (const p of LEVEL_PATTERNS) {
    if (p.re.test(kodeText)) return p.level;
  }
  return null;
}

function getMonthlyValues(row) {
  const arr = [];
  for (let i = 0; i < 12; i++) {
    const v = toNumber(row[COL.monthStart + i]);
    arr.push(v || 0);
  }
  return arr;
}

function parseSheet(rows) {
  // ===== Cari baris header tabel utama ("Kode") =====
  let dataStart = 0;
  for (let i = 0; i < rows.length; i++) {
    if (normText(rows[i][COL.kode]).startsWith("kode")) {
      dataStart = i + 1;
      break;
    }
  }

  // Baris header "Kode" & baris pertama blok ringkasan Jenis Belanja
  // ("51-B.Pegawai (R)") ternyata berada di BARIS FISIK YANG SAMA pada
  // sheet ini (kolom A-K untuk header pohon, kolom L+ untuk ringkasan).
  // Jadi batas antara "blok ringkasan" dan "pohon anggaran sungguhan"
  // BUKAN dataStart, melainkan baris pertama yang benar-benar berkode
  // Program/Kegiatan/dst (lolos classifyRow).
  let treeStartIdx = dataStart;
  for (let i = dataStart; i < rows.length; i++) {
    if (classifyRow(textOf(rows[i][COL.kode])) !== null) {
      treeStartIdx = i;
      break;
    }
  }

  // ===== Judul, periode, & Total Pagu =====
  let judul = "";
  let periode = "";
  let twLabel = "";
  let pagu = 0;

  for (let i = 0; i < Math.min(rows.length, treeStartIdx); i++) {
    const row = rows[i];
    if (!row) continue;

    const a0 = textOf(row[0]);
    if (!judul && /rencana penarikan/i.test(a0)) {
      judul = a0;
      const twMatch = a0.match(/TW\s*[IVX]+/i);
      if (twMatch) twLabel = twMatch[0].toUpperCase();
    }
    if (/^kondisi/i.test(a0)) periode = a0;

    const j = toNumber(row[COL.jumlah]);
    if (j !== null && j > pagu) pagu = j;
  }

  // ===== Ringkasan Jenis Belanja & baris Realisasi (%) (blok atas, kolom L) =====
  const belanjaSummary = [];
  let cumulativePctRow = new Array(12).fill(0);
  let pelaksanaanRow = new Array(12).fill(0);

  for (let i = 0; i < Math.min(rows.length, treeStartIdx); i++) {
    const row = rows[i];
    if (!row) continue;
    const label = textOf(row[11]); // kolom L
    if (!label) continue;

    if (/pegawai|barang|modal/i.test(label)) {
      belanjaSummary.push({
        code: (label.match(/5[123]/) || [])[0] || label,
        label: label.replace(/\s*\(R\)\s*$/i, "").trim(),
        monthly: getMonthlyValues(row),
      });
    } else if (/realisasi\s*\(%\)/i.test(label)) {
      cumulativePctRow = getMonthlyValues(row);
    } else if (/pelaksanaan/i.test(label)) {
      pelaksanaanRow = getMonthlyValues(row);
    }
  }

  // ===== Bangun pohon anggaran (sama seperti Daya Serap Anggaran) =====
  const roots = [];
  const stack = [];
  let autoId = 0;

  for (let i = treeStartIdx; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const kodeText = textOf(row[COL.kode]);
    const desk1 = textOf(row[COL.desk1]);
    const desk2 = textOf(row[COL.desk2]);

    if (!kodeText && !desk1 && !desk2) continue;
    if (!kodeText && !desk2 && desk1 && !/^-$/.test(desk1)) continue;
    if (/^total anggaran$/i.test(desk1)) continue;
    if (normText(kodeText) === "kode") continue;

    let level = null;
    let deskripsi = "";

    if (kodeText) {
      level = classifyRow(kodeText);
      deskripsi = desk1;
    } else if (desk1 === "-" && desk2) {
      level = 7;
      deskripsi = desk2;
    }

    if (level === null) continue;

    const node = {
      id: "n" + autoId++,
      level,
      kode: kodeText,
      deskripsi: deskripsi || "(tanpa uraian)",
      volume: toNumber(row[COL.volume]),
      satuan: textOf(row[COL.satuan]),
      harga: toNumber(row[COL.harga]),
      jumlah: toNumber(row[COL.jumlah]) || 0,
      monthly: getMonthlyValues(row),
      children: [],
    };
    node.peakMonthIdx = node.monthly.reduce((best, v, idx) => (v > node.monthly[best] ? idx : best), 0);

    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();

    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);

    stack.push({ level, node });
  }

  // Fallback: kalau baris "Pelaksanaan" tak ditemukan, hitung dari
  // penjumlahan seluruh Jenis Belanja per bulan.
  if (!pelaksanaanRow.some((v) => v > 0) && belanjaSummary.length) {
    pelaksanaanRow = new Array(12).fill(0);
    belanjaSummary.forEach((b) => b.monthly.forEach((v, idx) => (pelaksanaanRow[idx] += v)));
  }

  return {
    treeRoots: roots,
    belanjaSummary,
    cumulativePctRow,
    pelaksanaanRow,
    stats: { pagu, periode, twLabel, judul },
  };
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

function formatRupiah(value) {
  if (value === null || value === undefined || value === "") return "Rp 0";
  return "Rp " + Number(value).toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

function formatRupiahShort(value) {
  if (value === null || value === undefined) return "Rp 0";
  const abs = Math.abs(value);
  if (abs >= 1e9) return "Rp " + (value / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 }) + " M";
  if (abs >= 1e6) return "Rp " + (value / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " Jt";
  return formatRupiah(value);
}

function formatPct(value) {
  if (value === null || value === undefined) return "-";
  return Number(value).toLocaleString("id-ID", { maximumFractionDigits: 2 }) + "%";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* =========================================================
   RENDER: PERIODE & HERO
========================================================= */

function renderPeriod() {
  document.getElementById("periodInfo").textContent = overallStats?.periode || "Periode tidak ditemukan";
  document.getElementById("heroTw").textContent = overallStats?.twLabel ? `· ${overallStats.twLabel} 2026` : "";
}

/* =========================================================
   RENDER: STAT CARDS
========================================================= */

function renderStats() {
  const s = overallStats || { pagu: 0 };

  document.getElementById("totalPagu").textContent = formatRupiah(s.pagu);

  // Total per bulan (jumlah seluruh jenis belanja)
  const totalPerMonth = new Array(12).fill(0);
  belanjaSummary.forEach((b) => b.monthly.forEach((v, idx) => (totalPerMonth[idx] += v)));

  const peakIdx = totalPerMonth.reduce((best, v, idx) => (v > totalPerMonth[best] ? idx : best), 0);
  document.getElementById("peakMonth").textContent = MONTH_LABELS_FULL[peakIdx] || "-";
  document.getElementById("peakMonthSub").textContent = formatRupiah(totalPerMonth[peakIdx]);

  // % kumulatif pada bulan "Kondisi" (kalau ada), fallback ke bulan terakhir yang > 0
  let condMonthIdx = -1;
  if (s.periode) {
    const foundIdx = MONTH_LABELS_FULL.findIndex((m) => new RegExp(m, "i").test(s.periode));
    if (foundIdx >= 0) condMonthIdx = foundIdx;
  }
  if (condMonthIdx === -1) {
    for (let i = 11; i >= 0; i--) {
      if (cumulativePctRow[i] > 0) {
        condMonthIdx = i;
        break;
      }
    }
  }
  const condPct = condMonthIdx >= 0 ? cumulativePctRow[condMonthIdx] : 0;
  document.getElementById("cumulativePct").textContent = formatPct(condPct);
  document.getElementById("cumulativePctSub").textContent =
    condMonthIdx >= 0 ? `s.d. ${MONTH_LABELS_FULL[condMonthIdx]}` : "-";

  document.getElementById("totalProgram").textContent = treeRoots.length;

  const banner = document.getElementById("statsInsightBanner");
  banner.innerHTML = `Rencana penarikan dana tertinggi direncanakan pada bulan <strong>${
    MONTH_LABELS_FULL[peakIdx] || "-"
  }</strong> sebesar <strong>${formatRupiah(totalPerMonth[peakIdx])}</strong>. ${
    condMonthIdx >= 0
      ? `Secara kumulatif, realisasi ditargetkan mencapai <strong>${formatPct(condPct)}</strong> hingga akhir ${
          MONTH_LABELS_FULL[condMonthIdx]
        }.`
      : ""
  }`;
}

/* =========================================================
   RENDER: CHARTS
========================================================= */

function renderCharts() {
  renderChartCumulative();
  renderChartBelanja();
  renderChartPelaksanaan();
}

function renderChartCumulative() {
  const ctx = document.getElementById("chartCumulative");
  if (!ctx) return;

  if (chartCumulative) chartCumulative.destroy();

  chartCumulative = new Chart(ctx, {
    type: "line",
    data: {
      labels: MONTH_LABELS,
      datasets: [
        {
          label: "% Kumulatif",
          data: cumulativePctRow,
          borderColor: "#0066a1",
          backgroundColor: "rgba(0,102,161,0.12)",
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: "#0066a1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${MONTH_LABELS_FULL[c.dataIndex]}: ${formatPct(c.raw)}` } },
      },
      scales: {
        y: { min: 0, max: 100, ticks: { callback: (v) => v + "%", font: { size: 10 } } },
        x: { ticks: { font: { size: 11 } } },
      },
    },
  });

  const midIdx = 5; // Juni, indikasi progres tengah tahun
  document.getElementById("chartCumulativeInsight").innerHTML = `Progres kumulatif ditargetkan mencapai <strong>${formatPct(
    cumulativePctRow[midIdx],
  )}</strong> pada pertengahan tahun (${MONTH_LABELS_FULL[midIdx]}), dan <strong>100%</strong> pada akhir Desember.`;
}

function renderChartBelanja() {
  const ctx = document.getElementById("chartBelanja");
  if (!ctx) return;

  const colors = { "51": "#0066a1", "52": "#159447", "53": "#d69b16" };

  if (chartBelanja) chartBelanja.destroy();

  chartBelanja = new Chart(ctx, {
    type: "bar",
    data: {
      labels: MONTH_LABELS,
      datasets: belanjaSummary.map((b) => ({
        label: b.label,
        data: b.monthly,
        backgroundColor: colors[b.code] || "#7554c7",
        borderRadius: 4,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            title: (items) => (items.length ? MONTH_LABELS_FULL[items[0].dataIndex] : ""),
            label: (c) => `${c.dataset.label}: ${formatRupiah(c.raw)}`,
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { font: { size: 10 } } },
        y: { stacked: true, ticks: { callback: (v) => formatRupiahShort(v), font: { size: 9 } } },
      },
    },
  });

  const insight = document.getElementById("chartBelanjaInsight");
  const pegawai = belanjaSummary.find((b) => b.code === "51");
  if (pegawai) {
    const total = pegawai.monthly.reduce((s, v) => s + v, 0);
    insight.innerHTML = `Belanja Pegawai mendominasi rencana penarikan hampir tiap bulan, dengan total setahun <strong>${formatRupiah(
      total,
    )}</strong>.`;
  }
}

function renderChartPelaksanaan() {
  const ctx = document.getElementById("chartPelaksanaan");
  if (!ctx) return;

  const avg = pelaksanaanRow.reduce((s, v) => s + v, 0) / 12;
  const maxIdx = pelaksanaanRow.reduce((best, v, idx) => (v > pelaksanaanRow[best] ? idx : best), 0);
  const minIdx = pelaksanaanRow.reduce((best, v, idx) => (v < pelaksanaanRow[best] ? idx : best), 0);

  if (chartPelaksanaan) chartPelaksanaan.destroy();

  chartPelaksanaan = new Chart(ctx, {
    type: "bar",
    data: {
      labels: MONTH_LABELS,
      datasets: [
        {
          label: "Rencana Penarikan",
          data: pelaksanaanRow,
          backgroundColor: pelaksanaanRow.map((_, idx) =>
            idx === maxIdx ? "#159447" : idx === minIdx ? "#c0392b" : "#0066a1",
          ),
          borderRadius: 6,
        },
        {
          label: "Rata-rata Bulanan",
          data: new Array(12).fill(avg),
          type: "line",
          borderColor: "#d69b16",
          borderDash: [6, 4],
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            title: (items) => (items.length ? MONTH_LABELS_FULL[items[0].dataIndex] : ""),
            label: (c) => `${c.dataset.label}: ${formatRupiah(c.raw)}`,
          },
        },
      },
      scales: {
        y: { ticks: { callback: (v) => formatRupiahShort(v), font: { size: 10 } } },
        x: { ticks: { font: { size: 11 } } },
      },
    },
  });

  document.getElementById("chartPelaksanaanInsight").innerHTML = `Rencana penarikan tertinggi ada pada bulan <strong>${
    MONTH_LABELS_FULL[maxIdx]
  }</strong> (${formatRupiah(pelaksanaanRow[maxIdx])}), sementara yang terendah pada <strong>${
    MONTH_LABELS_FULL[minIdx]
  }</strong> (${formatRupiah(pelaksanaanRow[minIdx])}). Rata-rata penarikan per bulan sekitar <strong>${formatRupiah(
    avg,
  )}</strong>.`;
}

/* =========================================================
   RENDER: POHON ANGGARAN
========================================================= */

function sortRoots(roots) {
  const list = [...roots];
  switch (currentSort) {
    case "jumlah-desc":
      list.sort((a, b) => (b.jumlah || 0) - (a.jumlah || 0));
      break;
    case "peak-desc":
      list.sort((a, b) => Math.max(...b.monthly) - Math.max(...a.monthly));
      break;
    default:
      break;
  }
  return list;
}

function nodeMatches(node, query) {
  const q = query.toLowerCase();
  return (
    (node.kode && node.kode.toLowerCase().includes(q)) ||
    (node.deskripsi && node.deskripsi.toLowerCase().includes(q))
  );
}

function nodeHasMatch(node, query) {
  if (nodeMatches(node, query)) return true;
  return (node.children || []).some((c) => nodeHasMatch(c, query));
}

function renderSparkline(monthly) {
  const max = Math.max(...monthly, 1);
  return `
    <div class="sparkline">
      ${monthly
        .map((v, idx) => {
          const h = Math.max(3, Math.round((v / max) * 100));
          return `<div class="sparkline-bar" style="height:${h}%" data-tooltip="${MONTH_LABELS_FULL[idx]}: ${formatRupiahShort(v)}"></div>`;
        })
        .join("")}
    </div>
    <div class="sparkline-labels">
      <span>Jan</span><span>Des</span>
    </div>
  `;
}

function renderDetailRow(node) {
  return `
    <div class="detail-row">
      <span class="detail-row-desc">${escapeHtml(node.deskripsi)}</span>
      <span class="detail-row-cell">${node.volume !== null ? node.volume : "-"} ${escapeHtml(node.satuan || "")}</span>
      <span class="detail-row-cell">${node.harga !== null ? formatRupiah(node.harga) : "-"}</span>
      <span class="detail-row-cell">${formatRupiah(node.jumlah)}</span>
    </div>
  `;
}

function renderNode(node, query) {
  if (node.level === 7) return renderDetailRow(node);

  const hasChildren = node.children && node.children.length > 0;
  const forceOpen = !!query && nodeHasMatch(node, query);
  const leafChildren = hasChildren && node.children.every((c) => c.level === 7);

  const childrenHtml = hasChildren
    ? `<div class="tree-children ${leafChildren ? "tree-children-table" : ""}">
        ${
          leafChildren
            ? `<div class="detail-row detail-row-head">
                <span class="detail-row-desc">Uraian</span>
                <span class="detail-row-cell">Volume</span>
                <span class="detail-row-cell">Harga Satuan</span>
                <span class="detail-row-cell">Pagu</span>
              </div>`
            : ""
        }
        ${node.children.map((c) => renderNode(c, query)).join("")}
      </div>`
    : `<div class="tree-children"><div class="tree-empty">Tidak ada rincian lebih lanjut.</div></div>`;

  return `
    <details class="tree-item level-${node.level}" ${forceOpen ? "open" : ""}>
      <summary>
        <div class="tree-summary-left">
          <span class="tree-toggle">▸</span>
          <span class="tree-level-tag">${LEVEL_LABELS[node.level] || ""}</span>
          ${node.kode ? `<span class="tree-kode">${escapeHtml(node.kode)}</span>` : ""}
          <span class="tree-desk">${escapeHtml(node.deskripsi)}</span>
        </div>
        <div class="tree-summary-right">
          <span class="tree-figure"><small>Pagu</small>${formatRupiahShort(node.jumlah)}</span>
          <span class="tree-figure"><small>Puncak</small>${MONTH_LABELS[node.peakMonthIdx]}</span>
        </div>
      </summary>
      <div class="tree-sparkline-wrap">
        ${renderSparkline(node.monthly)}
      </div>
      ${childrenHtml}
    </details>
  `;
}

function renderTree() {
  const query = (treeSearch.value || "").trim();
  let roots = sortRoots(treeRoots);

  if (query) roots = roots.filter((n) => nodeHasMatch(n, query));

  if (!roots.length) {
    treeContainer.innerHTML = "";
    treeEmpty.style.display = "block";
    return;
  }

  treeEmpty.style.display = "none";
  treeContainer.innerHTML = roots.map((n) => renderNode(n, query)).join("");
}

/* =========================================================
   LOADING / ERROR
========================================================= */

function showLoading() {
  loading.style.display = "block";
  treeContainer.style.display = "none";
  errorMessage.style.display = "none";
  treeEmpty.style.display = "none";
}

function hideLoading() {
  loading.style.display = "none";
  treeContainer.style.display = "block";
  errorMessage.style.display = "none";
}

function showError(message) {
  loading.style.display = "none";
  treeContainer.style.display = "none";
  errorMessage.style.display = "block";
  errorText.textContent = message || "Terjadi kesalahan ketika mengambil data.";
}

/* =========================================================
   EVENT
========================================================= */

refreshBtn.addEventListener("click", () => loadData());

sortSelect.addEventListener("change", () => {
  currentSort = sortSelect.value;
  renderTree();
});

let searchDebounce;
treeSearch.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(renderTree, 150);
});

expandAllBtn.addEventListener("click", () => {
  treeContainer.querySelectorAll("details").forEach((d) => (d.open = true));
});

collapseAllBtn.addEventListener("click", () => {
  treeContainer.querySelectorAll("details").forEach((d) => (d.open = false));
});

/* =========================================================
   START
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  loadData();
});
