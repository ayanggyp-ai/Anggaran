/* =========================================================
   KONFIGURASI
========================================================= */

const SPREADSHEET_ID = "1qSGptetXzJGEqpKa4KbHIjMiSxv4QxAFzN4sRX8_NBk";
const SHEET_GID = "1858913275"; // sebelumnya 1691939996

const NAME_MAP = { 51: "Belanja Pegawai", 52: "Belanja Barang", 53: "Belanja Modal" };

/* =========================================================
   DATA GLOBAL
========================================================= */

let allItems = []; // daftar per Rincian Output (RO)
let belanjaSummary = []; // ringkasan per jenis belanja
let overallStats = null; // { target, realisasi, deviasi, pct, periode, bulan, sesuaiCount, total }
let currentSort = "deviasi-desc";
let chartBelanja = null;
let chartTopDeviasi = null;

/* =========================================================
   ELEMENT
========================================================= */

const refreshBtn = document.getElementById("refreshBtn");
const sortSelect = document.getElementById("sortSelect");
const itemSearch = document.getElementById("itemSearch");
const statusFilter = document.getElementById("statusFilter");
const belanjaFilter = document.getElementById("belanjaFilter");
const itemGrid = document.getElementById("itemGrid");
const itemEmpty = document.getElementById("itemEmpty");
const loading = document.getElementById("loading");
const errorMessage = document.getElementById("errorMessage");
const errorText = document.getElementById("errorText");
const dataStatus = document.getElementById("dataStatus");
const belanjaGrid = document.getElementById("belanjaGrid");

/* =========================================================
   LOAD GOOGLE SHEETS
========================================================= */

async function loadData() {
  showLoading();

  try {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?gid=${SHEET_GID}&headers=0&tqx=out:json&_=${Date.now()}`;

    const response = await fetch(url, { cache: "no-store" });
    console.log("[dashboard v2] data diambil", new Date().toLocaleTimeString("id-ID"), url);

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}`);
    }

    const text = await response.text();
    const json = parseGoogleResponse(text);
    const table = json.table;

    if (!table) {
      throw new Error("Struktur data Google Sheets tidak ditemukan.");
    }

    const rawRows = (table.rows || []).map((r) => (r.c || []).map(cellValue));
    const colLabels = (table.cols || []).map((c) => (c && c.label ? c.label : ""));

    // Diagnostik: buka Console (F12) untuk melihat data mentah kalau
    // suatu saat ada bagian yang gagal terbaca.
    console.groupCollapsed("[dashboard-deviasi] Diagnostik data mentah (12 baris pertama)");
    console.log("table.cols labels:", colLabels);
    console.table(rawRows.slice(0, 12));
    console.groupEnd();

    const parsed = parseSheet(rawRows, colLabels);
    belanjaSummary = parsed.belanjaSummary;
    allItems = parsed.items;
    overallStats = parsed.stats;

    renderPeriod();
    renderStats();
    renderBelanjaGrid();
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

  if (start === -1 || end === -1) {
    throw new Error("Format response Google Sheets tidak valid.");
  }

  const jsonText = text.substring(start + 1, end);
  const json = JSON.parse(jsonText);

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
   Pendekatan: cocokkan TEKS header ("Kode", "Target", dst) untuk
   menemukan index kolom, alih-alih mengasumsikan index tetap.
   Ini jauh lebih tahan terhadap pergeseran kolom akibat merge cell
   atau kolom tersembunyi pada sheet.
========================================================= */

function findHeaderRowIndex(rows) {
  // Hanya "Kode" & "Rincian Output (RO)" yang benar-benar tersimpan sebagai
  // teks header pada sheet ini — kolom Jenis Belanja/Target/Realisasi/
  // Deviasi/% tidak berlabel teks sama sekali, jadi jangan disyaratkan.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (normText(row[0]) === "kode") return i;
  }
  return -1;
}

function mapColumnsFromHeader(headerRow) {
  const wants = {
    kode: ["kode"],
    rincian: ["rincian output (ro)", "rincian output", "uraian"],
    jenisBelanja: ["jenis belanja"],
    target: ["target"],
    realisasi: ["realisasi"],
    deviasi: ["deviasi"],
    pctDeviasi: ["% deviasi", "%deviasi", "% deviasi "],
  };

  const map = {};
  headerRow.forEach((cell, idx) => {
    const t = normText(cell);
    Object.keys(wants).forEach((key) => {
      if (map[key] === undefined && wants[key].includes(t)) {
        map[key] = idx;
      }
    });
  });
  return map;
}

// Kolom Status ("Sesuai"/"Deviasi") & Catatan biasanya hanya diberi label
// SEKALI di baris judul paling atas (mis. "Progres", "Catatan"), lalu
// dipakai bersama untuk beberapa blok tabel di bawahnya. Jadi kita cari
// teksnya di SELURUH baris, bukan hanya baris header tabel utama.
function findGlobalColumn(rows, colLabels, labelTexts) {
  const targets = labelTexts.map((t) => t.toLowerCase());

  if (colLabels) {
    for (let c = 0; c < colLabels.length; c++) {
      if (targets.includes(normText(colLabels[c]))) return c;
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (targets.includes(normText(row[c]))) return c;
    }
  }

  return -1;
}

// Fallback kalau kolom status tidak berlabel: cari kolom yang selalu
// berisi teks "Sesuai" / "Deviasi" pada baris-baris data.
function guessStatusColumn(rows, startIdx, colCount) {
  const counts = {};
  for (let i = startIdx; i < Math.min(rows.length, startIdx + 40); i++) {
    const row = rows[i];
    if (!row) continue;
    for (let c = 0; c < colCount; c++) {
      const t = normText(row[c]);
      if (t === "sesuai" || t === "deviasi") {
        counts[c] = (counts[c] || 0) + 1;
      }
    }
  }
  let best = -1;
  let bestCount = 0;
  Object.keys(counts).forEach((c) => {
    if (counts[c] > bestCount) {
      bestCount = counts[c];
      best = Number(c);
    }
  });
  return bestCount > 0 ? best : -1;
}

function toBelanjaCode(text) {
  const m = String(text).match(/5[123]/);
  return m ? m[0] : null;
}

function parseSheet(rows, colLabels) {
  const headerIdx = findHeaderRowIndex(rows);

  // Kolom Jenis Belanja/Target/Realisasi/Deviasi/% tidak berlabel teks sama
  // sekali pada sheet ini, jadi dipetakan lewat OFFSET TETAP dari posisi
  // kolom "Kode" & "Rincian Output (RO)" (terverifikasi dari data mentah):
  // Kode, Rincian, JenisBelanja, Target, Realisasi, Deviasi, %Deviasi.
  const kodeCol = headerIdx >= 0 ? 0 : 0;
  const rincianCol = kodeCol + 1;
  const jenisCol = kodeCol + 2;
  const targetCol = kodeCol + 3;
  const realisasiCol = kodeCol + 4;
  const deviasiCol = kodeCol + 5;
  const pctCol = kodeCol + 6;

  const maxCol = pctCol + 1;

  let statusCol = findGlobalColumn(rows, colLabels, ["progres", "status"]);
  if (statusCol === -1) statusCol = guessStatusColumn(rows, headerIdx >= 0 ? headerIdx : 0, maxCol + 4);
  if (statusCol === -1) statusCol = pctCol + 1; // fallback offset tetap

  let catatanCol = findGlobalColumn(rows, colLabels, ["catatan"]);
  if (catatanCol === -1) catatanCol = pctCol + 2; // fallback offset tetap

  // ===== Ringkasan Jenis Belanja (blok atas) =====
  // Label "51-Pegawai/52-Barang/53-Modal" TIDAK tersimpan sebagai teks di
  // kolom manapun (sama seperti kasus dashboard Daya Serap sebelumnya).
  // Satu-satunya penanda yang bisa diandalkan adalah POSISI: blok ini
  // selalu berupa 3 baris tepat SEBELUM baris header "Kode", urutannya
  // tetap Pegawai(51) -> Barang(52) -> Modal(53).
  const belanjaSummary = [];
  if (headerIdx >= 3) {
    const codes = ["51", "52", "53"];
    for (let k = 0; k < 3; k++) {
      const row = rows[headerIdx - 3 + k];
      if (!row) continue;
      const code = codes[k];
      belanjaSummary.push({
        code,
        label: NAME_MAP[code],
        target: toNumber(row[targetCol]) || 0,
        realisasi: toNumber(row[realisasiCol]) || 0,
        deviasi: toNumber(row[deviasiCol]) || 0,
        pct: toNumber(row[pctCol]) || 0,
        status: statusCol >= 0 ? textOf(row[statusCol]) : "",
      });
    }
  }

  // ===== Daftar per Rincian Output (RO) =====
  const items = [];
  if (headerIdx >= 0) {
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const kode = textOf(row[kodeCol]);
      const rincian = textOf(row[rincianCol]);

      if (!kode && !rincian) continue; // baris kosong pemisah
      if (/^total$/i.test(rincian)) break; // baris Total = akhir daftar
      if (!kode) continue; // baris tanpa kode kemungkinan bukan data output

      const jenisCode = toBelanjaCode(textOf(row[jenisCol])) || textOf(row[jenisCol]);

      items.push({
        kode,
        rincian: rincian || "(tanpa uraian)",
        jenisCode,
        jenisLabel: NAME_MAP[jenisCode] || `Belanja ${jenisCode || "-"}`,
        target: toNumber(row[targetCol]) || 0,
        realisasi: toNumber(row[realisasiCol]) || 0,
        deviasi: toNumber(row[deviasiCol]) || 0,
        pct: toNumber(row[pctCol]) || 0,
        status: statusCol >= 0 ? textOf(row[statusCol]) || "-" : "-",
        catatan: catatanCol >= 0 ? textOf(row[catatanCol]) : "",
      });
    }
  }

  // ===== Baris Total & periode =====
  let stats = {
    target: 0,
    realisasi: 0,
    deviasi: 0,
    pct: 0,
    bulan: "",
    kondisi: "",
    sesuaiCount: 0,
    total: items.length,
  };

  stats.sesuaiCount = items.filter((it) => /sesuai/i.test(it.status)).length;

  const stripPrefix = (s) => textOf(s).replace(/^:\s*/, "");

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const labelA = textOf(row[0]);
    if (/^bulan pelaporan$/i.test(labelA)) {
      stats.bulan = stripPrefix(row[1]);
    }
    if (/^kondisi$/i.test(labelA)) {
      stats.kondisi = stripPrefix(row[1]);
    }

    if (normText(row[rincianCol]) === "total") {
      const target = toNumber(row[targetCol]);
      const realisasi = toNumber(row[realisasiCol]);
      if (target !== null || realisasi !== null) {
        stats.target = target || 0;
        stats.realisasi = realisasi || 0;
      }
    }
  }

  if (!stats.target && belanjaSummary.length) {
    stats.target = belanjaSummary.reduce((s, b) => s + b.target, 0);
    stats.realisasi = belanjaSummary.reduce((s, b) => s + b.realisasi, 0);
  }

  stats.deviasi = stats.realisasi - stats.target;
  stats.pct = stats.target ? (stats.deviasi / stats.target) * 100 : 0;

  return { belanjaSummary, items, stats };
}

/* =========================================================
   FORMAT NUMBER
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

function toPercent(v) {
  const n = toNumber(v);
  if (n === null) return null;
  return Math.abs(n) <= 1 ? n * 100 : n;
}

function formatInteger(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number(value).toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

function formatRupiah(value) {
  if (value === null || value === undefined || value === "") return "Rp 0";
  const sign = value < 0 ? "-" : "";
  return sign + "Rp " + Math.abs(Number(value)).toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

function formatRupiahShort(value) {
  if (value === null || value === undefined) return "Rp 0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e9) return sign + "Rp " + (abs / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 }) + " M";
  if (abs >= 1e6) return sign + "Rp " + (abs / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " Jt";
  return formatRupiah(value);
}

function formatPct(value) {
  if (value === null || value === undefined) return "-";
  return Number(value).toLocaleString("id-ID", { maximumFractionDigits: 2 }) + "%";
}

function statusClass(status) {
  return /sesuai/i.test(status) ? "up" : "down";
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
  const s = overallStats;
  const parts = [];
  if (s && s.bulan) parts.push(`Bulan ${s.bulan}`);
  if (s && s.kondisi) parts.push(s.kondisi);
  document.getElementById("periodInfo").textContent = parts.length ? parts.join(" · ") : "Periode tidak ditemukan";
}

/* =========================================================
   RENDER: STAT CARDS
========================================================= */

function renderStats() {
  const s = overallStats || { target: 0, realisasi: 0, deviasi: 0, pct: 0, sesuaiCount: 0, total: 0 };

  document.getElementById("totalTarget").textContent = formatRupiah(s.target);
  document.getElementById("totalRealisasi").textContent = formatRupiah(s.realisasi);
  document.getElementById("totalRealisasiPct").textContent = `${formatPct(
    s.target ? (s.realisasi / s.target) * 100 : 0,
  )} dari target`;
  document.getElementById("totalDeviasi").textContent = formatRupiah(s.deviasi);
  document.getElementById("totalDeviasiPct").textContent = `${formatPct(Math.abs(s.pct))} dari target`;
  document.getElementById("totalSesuai").textContent = `${s.sesuaiCount} / ${s.total}`;
  document.getElementById("totalSesuaiSub").textContent = `output berstatus "Sesuai"`;

  const banner = document.getElementById("statsInsightBanner");
  const deviasiCount = s.total - s.sesuaiCount;
  const arah = s.deviasi >= 0 ? "melebihi" : "di bawah";
  banner.innerHTML = `Realisasi total <strong>${formatRupiah(
    s.realisasi,
  )}</strong> ${arah} target sebesar <strong>${formatRupiah(Math.abs(s.deviasi))}</strong> (${formatPct(
    Math.abs(s.pct),
  )}). Dari ${s.total} Rincian Output, <strong>${deviasiCount} output</strong> tercatat mengalami deviasi dari target bulanan.`;
}

/* =========================================================
   RENDER: KARTU JENIS BELANJA
========================================================= */

function renderBelanjaGrid() {
  const NAME_ORDER = ["51", "52", "53"];
  const byCode = {};
  belanjaSummary.forEach((b) => (byCode[b.code] = b));

  const list = NAME_ORDER.map(
    (code) =>
      byCode[code] || {
        code,
        label: NAME_MAP[code],
        target: 0,
        realisasi: 0,
        deviasi: 0,
        pct: 0,
        status: "Sesuai",
      },
  );

  belanjaGrid.innerHTML = list
    .map((b) => {
      const progress = b.target ? Math.min(100, Math.max(0, (b.realisasi / b.target) * 100)) : 0;
      return `
        <div class="belanja-card">
          <div class="belanja-card-top">
            <span class="belanja-label">${escapeHtml(b.label)}</span>
            <span class="pct-badge ${statusClass(b.status)}">${escapeHtml(b.status || "-")}</span>
          </div>

          <div class="belanja-figures">
            <div>
              <small>Target</small>
              <strong>${formatRupiah(b.target)}</strong>
            </div>
            <div>
              <small>Realisasi</small>
              <strong>${formatRupiah(b.realisasi)}</strong>
            </div>
          </div>

          <div class="progress">
            <div class="progress-bar ${statusClass(b.status) === "down" ? "bar-warning" : ""}" style="width:${progress}%;"></div>
          </div>

          <div class="belanja-sisa">Deviasi: ${formatRupiah(b.deviasi)} (${formatPct(b.pct)})</div>
        </div>
      `;
    })
    .join("");
}

/* =========================================================
   RENDER: CHARTS
========================================================= */

function renderCharts() {
  renderChartBelanja();
  renderChartTopDeviasi();
}

function renderChartBelanja() {
  const ctx = document.getElementById("chartBelanja");
  if (!ctx) return;

  const NAME_ORDER = ["51", "52", "53"];
  const byCode = {};
  belanjaSummary.forEach((b) => (byCode[b.code] = b));
  const list = NAME_ORDER.map((code) => byCode[code] || { label: NAME_MAP[code], target: 0, realisasi: 0 });

  const labels = list.map((b) => b.label);
  const target = list.map((b) => b.target || 0);
  const realisasi = list.map((b) => b.realisasi || 0);

  if (chartBelanja) chartBelanja.destroy();

  chartBelanja = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Target", data: target, backgroundColor: "#0066a1", borderRadius: 6 },
        { label: "Realisasi", data: realisasi, backgroundColor: "#159447", borderRadius: 6 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatRupiah(c.raw)}` } },
      },
      scales: {
        y: { ticks: { callback: (v) => formatRupiahShort(v), font: { size: 10 } } },
        x: { ticks: { font: { size: 11 } } },
      },
    },
  });

  const insight = document.getElementById("chartBelanjaInsight");
  const worst = list.reduce((w, b) => {
    const dev = Math.abs((b.realisasi || 0) - (b.target || 0));
    const wDev = w ? Math.abs((w.realisasi || 0) - (w.target || 0)) : -1;
    return dev > wDev ? b : w;
  }, null);
  if (worst) {
    insight.innerHTML = `Selisih target-realisasi terbesar ada pada <strong>${escapeHtml(
      worst.label,
    )}</strong> sebesar <strong>${formatRupiah(Math.abs((worst.realisasi || 0) - (worst.target || 0)))}</strong>.`;
  }
}

function renderChartTopDeviasi() {
  const ctx = document.getElementById("chartTopDeviasi");
  if (!ctx) return;

  const top = [...allItems]
    .filter((it) => it.target || it.realisasi)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 6);

  const labels = top.map((it) => (it.rincian.length > 28 ? it.rincian.slice(0, 28) + "…" : it.rincian));
  const data = top.map((it) => Math.abs(it.pct));

  if (chartTopDeviasi) chartTopDeviasi.destroy();

  chartTopDeviasi = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "% Deviasi",
          data,
          backgroundColor: top.map((it) => (statusClass(it.status) === "down" ? "#c0392b" : "#0066a1")),
          borderRadius: 6,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${formatPct(c.raw)}` } },
      },
      scales: {
        x: { ticks: { callback: (v) => v + "%", font: { size: 10 } } },
        y: { ticks: { font: { size: 10 } } },
      },
    },
  });

  const insight = document.getElementById("chartTopDeviasiInsight");
  if (top.length) {
    insight.innerHTML = `Deviasi tertinggi ada pada <strong>${escapeHtml(top[0].rincian)}</strong> sebesar <strong>${formatPct(
      Math.abs(top[0].pct),
    )}</strong>.`;
  } else {
    insight.textContent = "Belum ada data output.";
  }
}

/* =========================================================
   RENDER: DAFTAR OUTPUT
========================================================= */

function applyFilters() {
  const q = (itemSearch.value || "").trim().toLowerCase();
  const statusVal = statusFilter.value;
  const belanjaVal = belanjaFilter.value;

  let list = allItems.filter((it) => {
    if (q && !(it.kode.toLowerCase().includes(q) || it.rincian.toLowerCase().includes(q))) return false;
    if (statusVal !== "all" && !new RegExp(`^${statusVal}$`, "i").test(it.status)) return false;
    if (belanjaVal !== "all" && it.jenisCode !== belanjaVal) return false;
    return true;
  });

  switch (currentSort) {
    case "deviasi-desc":
      list.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
      break;
    case "deviasi-asc":
      list.sort((a, b) => Math.abs(a.pct) - Math.abs(b.pct));
      break;
    case "target-desc":
      list.sort((a, b) => b.target - a.target);
      break;
    default:
      break;
  }

  return list;
}

function renderItemCard(item) {
  const progress = item.target ? Math.min(100, Math.max(0, (item.realisasi / item.target) * 100)) : 0;
  const cls = statusClass(item.status);

  return `
    <div class="satker-card deviasi-card">
      <div class="card-top">
        <div>
          <div class="satker-code">${escapeHtml(item.kode)} · ${escapeHtml(item.jenisLabel)}</div>
          <div class="satker-name">${escapeHtml(item.rincian)}</div>
        </div>
        <div class="pct-badge ${cls}">${escapeHtml(item.status)}</div>
      </div>

      <div class="nka-block">
        <div class="nka-label">
          <span>Realisasi vs Target</span>
          <span class="nka-value">${formatRupiahShort(item.realisasi)} / ${formatRupiahShort(item.target)}</span>
        </div>
        <div class="progress">
          <div class="progress-bar ${cls === "down" ? "bar-warning" : ""}" style="width:${progress}%;"></div>
        </div>
      </div>

      <div class="card-metrics">
        <div class="metric">
          <span>Deviasi</span>
          <strong>${formatRupiah(item.deviasi)}</strong>
        </div>
        <div class="metric">
          <span>% Deviasi</span>
          <strong>${formatPct(Math.abs(item.pct))}</strong>
        </div>
      </div>

      ${item.catatan ? `<div class="deviasi-note">📝 ${escapeHtml(item.catatan)}</div>` : ""}
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

statusFilter.addEventListener("change", renderList);
belanjaFilter.addEventListener("change", renderList);

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
