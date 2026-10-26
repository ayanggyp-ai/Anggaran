/* =========================================================
   KONFIGURASI
   Ubah SPREADSHEET_ID / GID kalau sumber data berubah.
   GID dipakai (bukan nama sheet) karena lebih stabil terhadap
   perubahan nama tab.
========================================================= */

const SPREADSHEET_ID = "1RgVCRkX3GhA7tsxR3QdpGr7jW6wa5DPyRgiVe843ZfQ";
const SHEET_GID = "496275393"; // sebelumnya 1351106632

/* =========================================================
   PEMETAAN KOLOM SHEET (A..M, index 0..12)
   Ubah di sini kalau struktur kolom sheet berubah.
========================================================= */

const COL = {
  kode: 0, // A
  desk1: 3, // D - deskripsi level program/kegiatan/komponen/akun
  desk2: 4, // E - deskripsi rincian item (baris "-")
  volume: 6, // G
  satuan: 7, // H
  harga: 8, // I - harga satuan (baris rincian) / label jenis belanja (blok ringkasan)
  jumlah: 9, // J - pagu / pagu anggaran (blok ringkasan)
  realisasi: 10, // K
  sisa: 11, // L
  pct: 12, // M
};

/* Klasifikasi level kode anggaran, dari yang paling spesifik ke paling umum. */
const LEVEL_PATTERNS = [
  { level: 3, re: /^\d{4}\.[A-Z]{2,4}\.\d{2,3}$/i, label: "Sub Output" }, // 2896.BMA.004
  { level: 2, re: /^\d{4}\.[A-Z]{2,4}$/i, label: "Output" }, // 2896.BMA
  { level: 0, re: /^\d{3}\.\d{2}\.[A-Z]{2}$/i, label: "Program" }, // 054.01.GG
  { level: 1, re: /^\d{4}$/, label: "Kegiatan" }, // 2896
  { level: 6, re: /^\d{6}$/, label: "Akun" }, // 521211
  { level: 4, re: /^\d{3}$/, label: "Komponen" }, // 052
  { level: 5, re: /^[A-Za-z]{1,2}$/, label: "Sub Komponen" }, // A, B
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

let treeRoots = []; // pohon Program -> ... -> Rincian
let overallStats = null; // { pagu, realisasi, sisa, pct, periode }
let belanjaSummary = []; // [{ label, pagu, realisasi, sisa, pct }]
let currentSort = "original";
let chartBelanja = null;
let chartProgram = null;

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
const belanjaGrid = document.getElementById("belanjaGrid");

/* =========================================================
   LOAD GOOGLE SHEETS
========================================================= */

async function loadData() {
  showLoading();

  try {
    // headers=0 memaksa Google Sheets TIDAK melakukan auto-deteksi baris
    // header. Kalau parameter ini ditolak/di-skip oleh Google, request tetap
    // jalan seperti biasa (fallback aman).
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

    // Diagnostik: buka Console (F12) untuk melihat 10 baris pertama data
    // mentah yang benar-benar diterima dari Google Sheets, berguna kalau
    // ada bagian yang gagal terbaca.
    console.groupCollapsed("[dashboard] Diagnostik data mentah (10 baris pertama)");
    console.log("table.cols labels:", colLabels);
    console.table(rawRows.slice(0, 10));
    console.groupEnd();

    treeRoots = buildTree(rawRows);
    belanjaSummary = computeBelanjaFromTree(treeRoots);
    overallStats = extractOverallStats(rawRows, colLabels);

    renderPeriod();
    renderStats();
    renderBelanjaGrid();
    renderCharts();
    renderTree();

    dataStatus.textContent = `${treeRoots.length} program · Update: ${new Date().toLocaleString(
      "id-ID",
      { dateStyle: "medium", timeStyle: "short" },
    )}`;

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
   RINGKASAN JENIS BELANJA (blok kanan atas: kolom I..M, baris 1-4)
========================================================= */

function computeBelanjaFromTree(roots) {
  // Ringkasan per Jenis Belanja dihitung langsung dari kode Akun (6 digit)
  // di seluruh pohon anggaran, dikelompokkan berdasarkan 2 digit pertama
  // sesuai klasifikasi standar Bagan Akun Standar (BAS) pemerintah RI:
  // 51 = Belanja Pegawai, 52 = Belanja Barang, 53 = Belanja Modal.
  // Pendekatan ini lebih andal ketimbang membaca blok ringkasan di sudut
  // sheet, karena blok tsb kerap berupa elemen visual terpisah (text box)
  // yang tidak selalu ikut terbawa saat sheet diekspor sebagai data.
  const NAME_MAP = { 51: "Belanja Pegawai", 52: "Belanja Barang", 53: "Belanja Modal" };

  // Selalu sediakan 3 kategori utama walau nilainya 0, supaya kartu &
  // grafik tetap menampilkan ketiganya secara konsisten (mis. Belanja
  // Modal yang pagunya 0 tidak akan punya baris akun sama sekali di
  // sheet, tapi tetap perlu tampil sebagai "Rp 0").
  const groups = { 51: { pagu: 0, realisasi: 0 }, 52: { pagu: 0, realisasi: 0 }, 53: { pagu: 0, realisasi: 0 } };

  function walk(node) {
    if (node.level === 6 && node.kode && /^\d{6}$/.test(node.kode)) {
      const prefix = node.kode.slice(0, 2);
      if (!groups[prefix]) groups[prefix] = { pagu: 0, realisasi: 0 };
      groups[prefix].pagu += node.jumlah || 0;
      groups[prefix].realisasi += node.realisasi || 0;
    }
    (node.children || []).forEach(walk);
  }

  (roots || []).forEach(walk);

  return Object.keys(groups)
    .sort()
    .map((prefix) => {
      const g = groups[prefix];
      const sisa = Math.max(g.pagu - g.realisasi, 0);
      const pct = g.pagu ? (g.realisasi / g.pagu) * 100 : 0;
      return {
        label: NAME_MAP[prefix] || `Belanja Lainnya (kode ${prefix})`,
        pagu: g.pagu,
        realisasi: g.realisasi,
        sisa,
        pct,
      };
    });
}

/* =========================================================
   TOTAL ANGGARAN & PERIODE
========================================================= */

function extractOverallStats(rows, colLabels) {
  let stats = { pagu: 0, realisasi: 0, sisa: 0, pct: 0, periode: "" };

  function scanRow(row) {
    if (!row) return;

    if (/kondisi/i.test(textOf(row[0]))) {
      stats.periode = textOf(row[0]);
    }

    const hasTotalLabel = row.some((cell) => /^total anggaran$/i.test(textOf(cell)));
    if (hasTotalLabel) {
      // Pakai index kolom J/K/L/M yang tetap (COL.jumlah..pct), BUKAN
      // "beberapa angka terakhir di baris" — sheet ini punya kolom
      // tambahan tersembunyi di kanan (data per-triwulan) yang bisa
      // membuat heuristik "angka terakhir" salah ambil kolom.
      const pagu = toNumber(row[COL.jumlah]);
      if (pagu !== null) {
        stats.pagu = pagu || 0;
        stats.realisasi = toNumber(row[COL.realisasi]) || 0;
        stats.sisa = toNumber(row[COL.sisa]) || 0;
        stats.pct = toPercent(row[COL.pct]) || 0;
      }
    }
  }

  if (colLabels && colLabels.length) scanRow(colLabels);
  for (let i = 0; i < rows.length; i++) scanRow(rows[i]);

  // Fallback: kalau baris "Total Anggaran" tak ditemukan, hitung dari root program
  if (!stats.pagu && treeRoots && treeRoots.length) {
    stats.pagu = treeRoots.reduce((s, n) => s + (n.jumlah || 0), 0);
    stats.realisasi = treeRoots.reduce((s, n) => s + (n.realisasi || 0), 0);
    stats.sisa = stats.pagu - stats.realisasi;
    stats.pct = stats.pagu ? (stats.realisasi / stats.pagu) * 100 : 0;
  }

  return stats;
}

/* =========================================================
   BANGUN POHON ANGGARAN (Program > Kegiatan > Output > Sub Output >
   Komponen > Sub Komponen > Akun > Rincian)
========================================================= */

function classifyRow(kodeText) {
  for (const p of LEVEL_PATTERNS) {
    if (p.re.test(kodeText)) return p.level;
  }
  return null;
}

function buildTree(rows) {
  // cari baris header "Kode" sebagai jangkar mulainya tabel utama
  let dataStart = 0;
  for (let i = 0; i < rows.length; i++) {
    if (normText(rows[i][COL.kode]).startsWith("kode")) {
      dataStart = i + 1;
      break;
    }
  }

  const roots = [];
  const stack = []; // { level, node }
  let autoId = 0;

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    const kodeText = textOf(row[COL.kode]);
    const desk1 = textOf(row[COL.desk1]);
    const desk2 = textOf(row[COL.desk2]);

    // baris kosong total -> lewati
    if (!kodeText && !desk1 && !desk2) continue;

    // baris catatan seperti "POK (08-07-2026)" -> lewati
    if (!kodeText && !desk2 && desk1 && !/^-$/.test(desk1)) continue;
    if (!kodeText && !desk1 && !desk2) continue;
    if (/^total anggaran$/i.test(desk1)) continue;
    if (normText(kodeText) === "kode") continue;

    let level = null;
    let deskripsi = "";

    if (kodeText) {
      level = classifyRow(kodeText);
      deskripsi = desk1;
    } else if (desk1 === "-" && desk2) {
      level = 7; // baris rincian item
      deskripsi = desk2;
    }

    if (level === null) continue; // pola kode tidak dikenali -> lewati dengan aman

    const node = {
      id: "n" + autoId++,
      level,
      kode: kodeText,
      deskripsi: deskripsi || "(tanpa uraian)",
      volume: toNumber(row[COL.volume]),
      satuan: textOf(row[COL.satuan]),
      harga: toNumber(row[COL.harga]),
      jumlah: toNumber(row[COL.jumlah]) || 0,
      realisasi: toNumber(row[COL.realisasi]) || 0,
      sisa: toNumber(row[COL.sisa]) || 0,
      pct: toPercent(row[COL.pct]) || 0,
      children: [],
    };

    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    if (stack.length) {
      stack[stack.length - 1].node.children.push(node);
    } else {
      roots.push(node);
    }

    stack.push({ level, node });
  }

  return roots;
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

// Persentase di gviz kadang berupa pecahan (0.6196) kadang angka biasa (61.96)
function toPercent(v) {
  const n = toNumber(v);
  if (n === null) return null;
  return n <= 1 ? n * 100 : n;
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

function formatPct(value) {
  if (value === null || value === undefined) return "-";
  return Number(value).toLocaleString("id-ID", { maximumFractionDigits: 2 }) + "%";
}

function pctClass(pct) {
  if (pct === null || pct === undefined) return "neutral";
  if (pct >= 90) return "up";
  if (pct >= 50) return "neutral";
  return "down";
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
  document.getElementById("periodInfo").textContent =
    overallStats && overallStats.periode ? overallStats.periode : "Periode tidak ditemukan";
}

/* =========================================================
   RENDER: STAT CARDS
========================================================= */

function renderStats() {
  const s = overallStats || { pagu: 0, realisasi: 0, sisa: 0, pct: 0 };

  document.getElementById("totalPagu").textContent = formatRupiah(s.pagu);
  document.getElementById("totalRealisasi").textContent = formatRupiah(s.realisasi);
  document.getElementById("totalRealisasiPct").textContent = `${formatPct(s.pct)} dari pagu`;
  document.getElementById("totalSisa").textContent = formatRupiah(s.sisa);
  document.getElementById("totalPct").textContent = formatPct(s.pct);
  document.getElementById("totalUpdated").textContent = s.periode || "Realisasi terhadap total pagu";

  const bestBelanja = belanjaSummary.reduce(
    (best, b) => (b.pct !== null && (!best || b.pct > best.pct) ? b : best),
    null,
  );
  const worstBelanja = belanjaSummary.reduce(
    (worst, b) => (b.pct !== null && (!worst || b.pct < worst.pct) ? b : worst),
    null,
  );

  const banner = document.getElementById("statsInsightBanner");
  if (bestBelanja && worstBelanja) {
    banner.innerHTML = `Realisasi anggaran keseluruhan mencapai <strong>${formatPct(
      s.pct,
    )}</strong> dari pagu sebesar <strong>${formatRupiah(s.pagu)}</strong>. Jenis belanja dengan realisasi tertinggi adalah <strong>${escapeHtml(
      bestBelanja.label,
    )}</strong> (${formatPct(bestBelanja.pct)}), sedangkan yang terendah adalah <strong>${escapeHtml(
      worstBelanja.label,
    )}</strong> (${formatPct(worstBelanja.pct)}).`;
  } else {
    banner.textContent = `Realisasi anggaran keseluruhan mencapai ${formatPct(s.pct)} dari total pagu ${formatRupiah(
      s.pagu,
    )}.`;
  }
}

/* =========================================================
   RENDER: KARTU JENIS BELANJA
========================================================= */

function renderBelanjaGrid() {
  if (!belanjaSummary.length) {
    belanjaGrid.innerHTML = `<div class="portal-empty">Data ringkasan jenis belanja tidak ditemukan pada sheet.</div>`;
    return;
  }

  belanjaGrid.innerHTML = belanjaSummary
    .map((b) => {
      const pct = b.pct === null ? 0 : Math.min(100, Math.max(0, b.pct));
      return `
        <div class="belanja-card">
          <div class="belanja-card-top">
            <span class="belanja-label">${escapeHtml(b.label)}</span>
            <span class="pct-badge ${pctClass(b.pct)}">${formatPct(b.pct)}</span>
          </div>

          <div class="belanja-figures">
            <div>
              <small>Pagu</small>
              <strong>${formatRupiah(b.pagu)}</strong>
            </div>
            <div>
              <small>Realisasi</small>
              <strong>${formatRupiah(b.realisasi)}</strong>
            </div>
          </div>

          <div class="progress">
            <div class="progress-bar" style="width:${pct}%;"></div>
          </div>

          <div class="belanja-sisa">Sisa: ${formatRupiah(b.sisa)}</div>
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
  renderChartProgram();
}

function renderChartBelanja() {
  const ctx = document.getElementById("chartBelanja");
  if (!ctx) return;

  const labels = belanjaSummary.map((b) => b.label);
  const pagu = belanjaSummary.map((b) => b.pagu || 0);
  const realisasi = belanjaSummary.map((b) => b.realisasi || 0);

  if (chartBelanja) chartBelanja.destroy();

  chartBelanja = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Pagu", data: pagu, backgroundColor: "#0066a1", borderRadius: 6 },
        { label: "Realisasi", data: realisasi, backgroundColor: "#159447", borderRadius: 6 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: {
          callbacks: { label: (c) => `${c.dataset.label}: ${formatRupiah(c.raw)}` },
        },
      },
      scales: {
        y: { ticks: { callback: (v) => formatRupiahShort(v), font: { size: 10 } } },
        x: { ticks: { font: { size: 11 } } },
      },
    },
  });

  const insight = document.getElementById("chartBelanjaInsight");
  if (labels.length) {
    const idx = pagu.indexOf(Math.max(...pagu));
    insight.innerHTML = `Alokasi pagu terbesar ada pada belanja <strong>${escapeHtml(
      labels[idx] || "-",
    )}</strong> sebesar <strong>${formatRupiah(pagu[idx])}</strong>.`;
  }
}

function renderChartProgram() {
  const ctx = document.getElementById("chartProgram");
  if (!ctx) return;

  const labels = treeRoots.map((n) => n.deskripsi);
  const data = treeRoots.map((n) => n.realisasi || 0);
  const colors = ["#0066a1", "#159447", "#7554c7", "#d69b16", "#c0392b", "#0872ad", "#16804a"];

  if (chartProgram) chartProgram.destroy();

  chartProgram = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data, backgroundColor: labels.map((_, i) => colors[i % colors.length]) }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${formatRupiah(c.raw)}` } },
      },
    },
  });

  const legend = document.getElementById("chartProgramInsight");
  if (labels.length) {
    legend.innerHTML =
      `<div class="chart-legend-custom">` +
      labels
        .map(
          (l, i) =>
            `<span class="chart-legend-item"><span class="chart-legend-dot" style="background:${colors[i % colors.length]}"></span>${escapeHtml(
              l.length > 38 ? l.slice(0, 38) + "…" : l,
            )}</span>`,
        )
        .join("") +
      `</div>`;
  } else {
    legend.textContent = "Belum ada data program.";
  }
}

/* =========================================================
   RENDER: POHON ANGGARAN
========================================================= */

function sortRoots(roots) {
  const list = [...roots];
  switch (currentSort) {
    case "pct-asc":
      list.sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0));
      break;
    case "pct-desc":
      list.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
      break;
    case "sisa-desc":
      list.sort((a, b) => (b.sisa ?? 0) - (a.sisa ?? 0));
      break;
    default:
      break; // urutan asli
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

function renderDetailRow(node) {
  return `
    <div class="detail-row">
      <span class="detail-row-desc">${escapeHtml(node.deskripsi)}</span>
      <span class="detail-row-cell">${node.volume !== null ? formatInteger(node.volume) : "-"} ${escapeHtml(
        node.satuan || "",
      )}</span>
      <span class="detail-row-cell">${node.harga !== null ? formatRupiah(node.harga) : "-"}</span>
      <span class="detail-row-cell">${formatRupiah(node.jumlah)}</span>
      <span class="detail-row-cell">${formatRupiah(node.realisasi)}</span>
      <span class="detail-row-cell pct-badge ${pctClass(node.pct)}">${formatPct(node.pct)}</span>
    </div>
  `;
}

function renderNode(node, query) {
  if (node.level === 7) {
    return renderDetailRow(node);
  }

  const hasChildren = node.children && node.children.length > 0;
  const forceOpen = !!query && nodeHasMatch(node, query) && query.length > 0;
  const pct = node.pct === null ? 0 : Math.min(100, Math.max(0, node.pct));
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
                <span class="detail-row-cell">Realisasi</span>
                <span class="detail-row-cell">%</span>
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
          <span class="tree-figure"><small>Realisasi</small>${formatRupiahShort(node.realisasi)}</span>
          <span class="pct-badge ${pctClass(node.pct)}">${formatPct(node.pct)}</span>
        </div>
      </summary>
      <div class="tree-progress-wrap">
        <div class="progress"><div class="progress-bar" style="width:${pct}%;"></div></div>
      </div>
      ${childrenHtml}
    </details>
  `;
}

function renderTree() {
  const query = (treeSearch.value || "").trim();
  let roots = sortRoots(treeRoots);

  if (query) {
    roots = roots.filter((n) => nodeHasMatch(n, query));
  }

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
  // Auto-refresh: tiap 2 menit & saat tab kembali dibuka, agar perubahan di spreadsheet ikut tampil
  const AUTO_REFRESH_MS = 120000;
  let lastLoad = Date.now();
  const refresh = () => { lastLoad = Date.now(); loadData(); };
  setInterval(() => { if (!document.hidden) refresh(); }, AUTO_REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - lastLoad > 30000) refresh();
  });
});
