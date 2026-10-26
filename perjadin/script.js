/* =========================================================
   KONFIGURASI

   Ganti 2 baris di bawah ini saja untuk pindah sumber data.
   Sheet pribadi (lebih lengkap, kolom beda struktur):
     SPREADSHEET_ID = "1WwyFmUIdKsN5hLTUuIyO5K16TXJHgvCmGn2aceDxpTo"
     SHEET_GID      = "1864198830"
========================================================= */

const SPREADSHEET_ID = "1d61tdWssNIBiUh4sgK32V_K4vtYZhIzIO7W-lh1uFu0";
const SHEET_GID = "1945885825";

const MONTH_ORDER = [
  "januari",
  "februari",
  "maret",
  "april",
  "mei",
  "juni",
  "juli",
  "agustus",
  "september",
  "oktober",
  "november",
  "desember",
];
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

/* =========================================================
   DATA GLOBAL
========================================================= */

let allGroups = [];
let akunSummary = [];
let overallStats = null;
let currentSort = "original";
let chartMonth = null;
let chartPerson = null;

/* =========================================================
   ELEMENT
========================================================= */

const refreshBtn = document.getElementById("refreshBtn");
const sortSelect = document.getElementById("sortSelect");
const itemSearch = document.getElementById("itemSearch");
const statusFilter = document.getElementById("statusFilter");
const expandAllBtn = document.getElementById("expandAllBtn");
const collapseAllBtn = document.getElementById("collapseAllBtn");
const groupContainer = document.getElementById("groupContainer");
const groupEmpty = document.getElementById("groupEmpty");
const loading = document.getElementById("loading");
const errorMessage = document.getElementById("errorMessage");
const errorText = document.getElementById("errorText");
const dataStatus = document.getElementById("dataStatus");
const akunGrid = document.getElementById("akunGrid");

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

    console.groupCollapsed("[dashboard-perjadin] Diagnostik data mentah (12 baris pertama)");
    console.log("table.cols labels:", colLabels);
    console.table(rawRows.slice(0, 12));
    console.groupEnd();

    const parsed = parseSheet(rawRows);
    allGroups = parsed.groups;
    akunSummary = parsed.akunSummary;
    overallStats = parsed.stats;

    renderPeriod();
    renderStats();
    renderAkunGrid();
    renderCharts();
    renderGroups();

    dataStatus.textContent = `${allGroups.length} kegiatan · Update: ${new Date().toLocaleString("id-ID", {
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

// Banyak sel pada sheet ini berisi karakter zero-width space (\u200B)
// alih-alih benar-benar kosong — perlakukan sebagai string kosong.
function textOf(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[\u200B\u200C\u200D\uFEFF]/g, "").trim();
}

function normText(v) {
  return textOf(v).toLowerCase();
}

/* =========================================================
   PARSING UTAMA
   Kolom dipetakan lewat pencocokan TEKS header ("Kode", "Akun", "Pagu",
   dst), bukan index tetap — sheet ini terbukti punya kolom kosong/
   tersembunyi yang menggeser posisi kolom sesungguhnya.
========================================================= */

function findHeaderRowIndex(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (normText(row[c]).startsWith("kode")) return i;
    }
  }
  return -1;
}

function findColExact(row, texts) {
  for (let c = 0; c < row.length; c++) {
    if (texts.includes(normText(row[c]))) return c;
  }
  return -1;
}

function findColContains(row, substrings) {
  for (let c = 0; c < row.length; c++) {
    const t = normText(row[c]);
    if (t && substrings.some((s) => t.includes(s))) return c;
  }
  return -1;
}

function parseSheet(rows) {
  const headerIdx = findHeaderRowIndex(rows);
  const headerRow = headerIdx >= 0 ? rows[headerIdx] : [];

  const kodeCol = findColExact(headerRow, ["kode kegiatan-komponen", "kode"]);
  const detilCol = findColExact(headerRow, ["detil"]);
  const namaCol = findColExact(headerRow, ["nama"]);
  const tujuanCol = findColExact(headerRow, ["tujuan"]);
  const acaraCol = findColContains(headerRow, ["tugas", "acara", "iku"]);
  const bulanCol = findColExact(headerRow, ["bulan"]);
  const tglCol = findColExact(headerRow, ["tgl", "tanggal"]);
  const statusCol = findColExact(headerRow, ["status"]);

  // "Akun", "Pagu", "Sisa", "Total Biaya", "KKP/CMS" TIDAK berlabel teks
  // sama sekali di sheet ini (terverifikasi dari data mentah). Gunakan
  // offset tetap relatif terhadap kolom yang terbukti ketemu lewat teks.
  let akunCol = findColExact(headerRow, ["akun"]);
  if (akunCol === -1 && kodeCol >= 0) akunCol = kodeCol + 1;

  let paguCol = findColExact(headerRow, ["pagu"]);
  if (paguCol === -1 && detilCol >= 0) paguCol = detilCol + 2;

  let sisaCol = findColExact(headerRow, ["sisa"]);
  if (sisaCol === -1 && paguCol >= 0) sisaCol = paguCol + 1;

  let biayaCol = findColContains(headerRow, ["biaya"]);
  if (biayaCol === -1 && tglCol >= 0) biayaCol = tglCol + 1;

  let kkpCol = findColContains(headerRow, ["kkp", "cms"]);
  if (kkpCol === -1 && biayaCol >= 0) kkpCol = biayaCol + 1;

  // ===== Periode / Last Update =====
  let periode = "";
  for (let i = 0; i < Math.min(rows.length, headerIdx >= 0 ? headerIdx : 10); i++) {
    const row = rows[i];
    if (!row) continue;
    const t = textOf(row[0]);
    if (/last update/i.test(t)) {
      periode = t;
      break;
    }
  }

  // ===== Ringkasan per Jenis Akun (blok atas, sebelum header) =====
  const akunSummary = [];
  if (detilCol >= 0 && paguCol >= 0) {
    for (let i = 0; i < Math.min(rows.length, headerIdx >= 0 ? headerIdx : 10); i++) {
      const row = rows[i];
      if (!row) continue;
      const label = textOf(row[detilCol]);
      if (/^\d{6}-/.test(label)) {
        akunSummary.push({
          label,
          pagu: toNumber(row[paguCol]) || 0,
          sisa: toNumber(row[sisaCol]) || 0,
        });
      }
    }
  }

  // ===== Bangun daftar kegiatan (group) + perjalanan (trip) =====
  const groups = [];
  let currentGroup = null;
  const dataStart = headerIdx >= 0 ? headerIdx + 1 : 0;

  const monthCounts = {};
  const personCounts = {};
  let totalTrips = 0;
  let realisasiCount = 0;
  let rencanaCount = 0;

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const kode = kodeCol >= 0 ? textOf(row[kodeCol]) : "";

    if (kode) {
      currentGroup = {
        kode,
        akun: akunCol >= 0 ? textOf(row[akunCol]) : "",
        detil: detilCol >= 0 ? textOf(row[detilCol]) : "",
        pagu: paguCol >= 0 ? toNumber(row[paguCol]) || 0 : 0,
        sisa: sisaCol >= 0 ? toNumber(row[sisaCol]) || 0 : 0,
        trips: [],
      };
      groups.push(currentGroup);
    }

    const nama = namaCol >= 0 ? textOf(row[namaCol]) : "";
    if (nama && currentGroup) {
      const bulanRaw = bulanCol >= 0 ? textOf(row[bulanCol]) : "";
      const status = statusCol >= 0 ? textOf(row[statusCol]) || "-" : "-";

      currentGroup.trips.push({
        nama,
        tujuan: tujuanCol >= 0 ? textOf(row[tujuanCol]) : "",
        acara: acaraCol >= 0 ? textOf(row[acaraCol]) : "",
        bulan: bulanRaw,
        tgl: tglCol >= 0 ? textOf(row[tglCol]) : "",
        biaya: biayaCol >= 0 ? toNumber(row[biayaCol]) || 0 : 0,
        kkp: kkpCol >= 0 ? toNumber(row[kkpCol]) : null,
        status,
      });

      totalTrips++;
      if (/realisasi/i.test(status)) realisasiCount++;
      else if (/rencana/i.test(status)) rencanaCount++;

      if (bulanRaw) monthCounts[normText(bulanRaw)] = (monthCounts[normText(bulanRaw)] || 0) + 1;
      personCounts[nama] = (personCounts[nama] || 0) + 1;
    }
  }

  const totalPagu = groups.reduce((s, g) => s + (g.pagu || 0), 0);
  const totalSisa = groups.reduce((s, g) => s + (g.sisa || 0), 0);

  return {
    groups,
    akunSummary,
    stats: {
      periode,
      totalPagu,
      totalSisa,
      totalTrips,
      realisasiCount,
      rencanaCount,
      monthCounts,
      personCounts,
    },
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

function formatInteger(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("id-ID", { maximumFractionDigits: 0 });
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

function statusClass(status) {
  return /realisasi/i.test(status) ? "up" : /rencana/i.test(status) ? "neutral" : "down";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* =========================================================
   RENDER: PERIODE
========================================================= */

function renderPeriod() {
  document.getElementById("periodInfo").textContent = overallStats?.periode || "Periode tidak ditemukan";
}

/* =========================================================
   RENDER: STAT CARDS
========================================================= */

function renderStats() {
  const s = overallStats || { totalPagu: 0, totalSisa: 0, totalTrips: 0, realisasiCount: 0, rencanaCount: 0 };

  document.getElementById("totalPagu").textContent = formatRupiah(s.totalPagu);
  document.getElementById("totalSisa").textContent = formatRupiah(s.totalSisa);
  document.getElementById("totalTrips").textContent = formatInteger(s.totalTrips);
  document.getElementById("realisasiRencana").textContent = `${s.realisasiCount} / ${s.rencanaCount}`;

  const banner = document.getElementById("statsInsightBanner");
  const pctTerpakai = s.totalPagu ? ((s.totalPagu - s.totalSisa) / s.totalPagu) * 100 : 0;
  banner.innerHTML = `Dari total pagu perjalanan dinas <strong>${formatRupiah(
    s.totalPagu,
  )}</strong>, sekitar <strong>${pctTerpakai.toLocaleString("id-ID", {
    maximumFractionDigits: 1,
  })}%</strong> sudah terpakai. Tercatat <strong>${s.totalTrips} perjalanan</strong>, dengan <strong>${
    s.realisasiCount
  } sudah direalisasikan</strong> dan ${s.rencanaCount} masih berupa rencana.`;
}

/* =========================================================
   RENDER: RINGKASAN AKUN
========================================================= */

function renderAkunGrid() {
  if (!akunSummary.length) {
    akunGrid.innerHTML = `<div class="portal-empty">Ringkasan per akun tidak ditemukan pada sheet.</div>`;
    return;
  }

  akunGrid.innerHTML = akunSummary
    .map((a) => {
      const terpakai = a.pagu - a.sisa;
      const pct = a.pagu ? Math.min(100, Math.max(0, (terpakai / a.pagu) * 100)) : 0;
      return `
        <div class="belanja-card">
          <div class="belanja-card-top">
            <span class="belanja-label">${escapeHtml(a.label)}</span>
            <span class="pct-badge ${pct >= 90 ? "down" : pct >= 50 ? "neutral" : "up"}">${pct.toLocaleString(
              "id-ID",
              { maximumFractionDigits: 1 },
            )}% terpakai</span>
          </div>

          <div class="belanja-figures">
            <div>
              <small>Pagu</small>
              <strong>${formatRupiah(a.pagu)}</strong>
            </div>
            <div>
              <small>Sisa</small>
              <strong>${formatRupiah(a.sisa)}</strong>
            </div>
          </div>

          <div class="progress">
            <div class="progress-bar" style="width:${pct}%;"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

/* =========================================================
   RENDER: CHARTS
========================================================= */

function renderCharts() {
  renderChartMonth();
  renderChartPerson();
}

function renderChartMonth() {
  const ctx = document.getElementById("chartMonth");
  if (!ctx) return;

  const counts = overallStats?.monthCounts || {};
  const data = MONTH_ORDER.map((m) => counts[m] || 0);

  if (chartMonth) chartMonth.destroy();

  chartMonth = new Chart(ctx, {
    type: "bar",
    data: {
      labels: MONTH_LABELS,
      datasets: [{ label: "Jumlah Perjalanan", data, backgroundColor: "#0066a1", borderRadius: 6 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.raw} perjalanan` } },
      },
      scales: {
        y: { ticks: { stepSize: 1, font: { size: 10 } } },
        x: { ticks: { font: { size: 11 } } },
      },
    },
  });

  const peakIdx = data.reduce((best, v, idx) => (v > data[best] ? idx : best), 0);
  document.getElementById("chartMonthInsight").innerHTML = data[peakIdx]
    ? `Bulan dengan perjalanan dinas terbanyak adalah <strong>${
        ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"][peakIdx]
      }</strong> (${data[peakIdx]} perjalanan).`
    : "Belum ada data bulan perjalanan.";
}

function renderChartPerson() {
  const ctx = document.getElementById("chartPerson");
  if (!ctx) return;

  const counts = overallStats?.personCounts || {};
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const labels = sorted.map(([name]) => (name.length > 22 ? name.slice(0, 22) + "…" : name));
  const data = sorted.map(([, count]) => count);

  if (chartPerson) chartPerson.destroy();

  chartPerson = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Jumlah Perjalanan", data, backgroundColor: "#159447", borderRadius: 6 }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.raw} perjalanan` } },
      },
      scales: {
        x: { ticks: { stepSize: 1, font: { size: 10 } } },
        y: { ticks: { font: { size: 10 } } },
      },
    },
  });

  if (sorted.length) {
    document.getElementById("chartPersonInsight").innerHTML = `<strong>${escapeHtml(
      sorted[0][0],
    )}</strong> tercatat paling sering bertugas (${sorted[0][1]} perjalanan).`;
  } else {
    document.getElementById("chartPersonInsight").textContent = "Belum ada data personil.";
  }
}

/* =========================================================
   RENDER: DAFTAR KEGIATAN & PERJALANAN
========================================================= */

function applyFilters() {
  const q = (itemSearch.value || "").trim().toLowerCase();
  const statusVal = statusFilter.value;

  let list = allGroups.filter((g) => {
    const groupMatch =
      g.kode.toLowerCase().includes(q) || g.detil.toLowerCase().includes(q) || g.akun.toLowerCase().includes(q);
    const tripMatch = g.trips.some(
      (t) => t.nama.toLowerCase().includes(q) || t.tujuan.toLowerCase().includes(q),
    );
    if (q && !groupMatch && !tripMatch) return false;

    if (statusVal !== "all") {
      const hasStatus = g.trips.some((t) => new RegExp(`^${statusVal}$`, "i").test(t.status));
      if (!hasStatus) return false;
    }

    return true;
  });

  switch (currentSort) {
    case "pagu-desc":
      list.sort((a, b) => (b.pagu || 0) - (a.pagu || 0));
      break;
    case "trips-desc":
      list.sort((a, b) => b.trips.length - a.trips.length);
      break;
    default:
      break;
  }

  return list;
}

function renderTripRow(t) {
  return `
    <div class="detail-row perjadin-row">
      <span class="detail-row-desc">${escapeHtml(t.nama)}</span>
      <span class="detail-row-cell perjadin-cell-left">${escapeHtml(t.tujuan || "-")}</span>
      <span class="detail-row-cell perjadin-cell-left">${escapeHtml(t.acara || "-")}</span>
      <span class="detail-row-cell perjadin-cell-left">${escapeHtml(t.bulan || "-")}${t.tgl ? ` (${escapeHtml(t.tgl)})` : ""}</span>
      <span class="detail-row-cell">${formatRupiah(t.biaya)}</span>
      <span class="detail-row-cell pct-badge ${statusClass(t.status)}">${escapeHtml(t.status)}</span>
    </div>
  `;
}

function renderGroup(g) {
  const pct = g.pagu ? Math.min(100, Math.max(0, ((g.pagu - g.sisa) / g.pagu) * 100)) : 0;

  return `
    <details class="tree-item level-0">
      <summary>
        <div class="tree-summary-left">
          <span class="tree-toggle">▸</span>
          <span class="tree-kode">${escapeHtml(g.kode)}</span>
          <span class="tree-desk">${escapeHtml(g.detil || "(tanpa detil)")}</span>
        </div>
        <div class="tree-summary-right">
          <span class="tree-figure"><small>Akun</small>${escapeHtml(g.akun || "-")}</span>
          <span class="tree-figure"><small>Pagu</small>${formatRupiahShort(g.pagu)}</span>
          <span class="tree-figure"><small>Perjalanan</small>${g.trips.length}</span>
        </div>
      </summary>
      <div class="tree-progress-wrap">
        <div class="progress"><div class="progress-bar" style="width:${pct}%;"></div></div>
      </div>
      <div class="tree-children tree-children-table">
        ${
          g.trips.length
            ? `<div class="detail-row detail-row-head perjadin-row">
                <span class="detail-row-desc">Nama</span>
                <span class="detail-row-cell perjadin-cell-left">Tujuan</span>
                <span class="detail-row-cell perjadin-cell-left">Acara</span>
                <span class="detail-row-cell perjadin-cell-left">Waktu</span>
                <span class="detail-row-cell">Biaya</span>
                <span class="detail-row-cell">Status</span>
              </div>
              ${g.trips.map(renderTripRow).join("")}`
            : `<div class="tree-empty">Belum ada perjalanan tercatat untuk kegiatan ini.</div>`
        }
      </div>
    </details>
  `;
}

function renderGroups() {
  const list = applyFilters();

  if (!list.length) {
    groupContainer.innerHTML = "";
    groupEmpty.style.display = "block";
    return;
  }

  groupEmpty.style.display = "none";
  groupContainer.innerHTML = list.map(renderGroup).join("");
}

/* =========================================================
   LOADING / ERROR
========================================================= */

function showLoading() {
  loading.style.display = "block";
  groupContainer.style.display = "none";
  errorMessage.style.display = "none";
  groupEmpty.style.display = "none";
}

function hideLoading() {
  loading.style.display = "none";
  groupContainer.style.display = "flex";
  errorMessage.style.display = "none";
}

function showError(message) {
  loading.style.display = "none";
  groupContainer.style.display = "none";
  errorMessage.style.display = "block";
  errorText.textContent = message || "Terjadi kesalahan ketika mengambil data.";
}

/* =========================================================
   EVENT
========================================================= */

refreshBtn.addEventListener("click", () => loadData());

sortSelect.addEventListener("change", () => {
  currentSort = sortSelect.value;
  renderGroups();
});

statusFilter.addEventListener("change", renderGroups);

let searchDebounce;
itemSearch.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(renderGroups, 150);
});

expandAllBtn.addEventListener("click", () => {
  groupContainer.querySelectorAll("details").forEach((d) => (d.open = true));
});

collapseAllBtn.addEventListener("click", () => {
  groupContainer.querySelectorAll("details").forEach((d) => (d.open = false));
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
