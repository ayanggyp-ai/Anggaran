/* =========================================================
   KONFIGURASI
   3 sumber data berbeda — masing-masing memakai spreadsheet ID
   & gid yang SAMA dengan dashboard detailnya masing-masing.
   Ganti nilainya kalau sheet sumber berubah.
========================================================= */

const SOURCES = {
  dayaSerap: { id: "1RgVCRkX3GhA7tsxR3QdpGr7jW6wa5DPyRgiVe843ZfQ", gid: "496275393" },
  perjadin: { id: "1d61tdWssNIBiUh4sgK32V_K4vtYZhIzIO7W-lh1uFu0", gid: "1945885825" },
  rencana: { id: "1N1sUsFn2DiVI_qlgy6ejZtYBLTl3MCEHJzPb90Dqz0U", gid: "1051439658" },
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agust", "Sept", "Okt", "Nov", "Des"];
const MONTH_LABELS_FULL = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const NAME_MAP = { 51: "Belanja Pegawai", 52: "Belanja Barang", 53: "Belanja Modal" };
const PIE_COLORS = { 51: "#0066a1", 52: "#159447", 53: "#d69b16" };

/* =========================================================
   ELEMENT
========================================================= */

const refreshBtn = document.getElementById("refreshBtn");
const dataStatus = document.getElementById("dataStatus");
const errorMessage = document.getElementById("errorMessage");
const errorText = document.getElementById("errorText");

let chartBelanjaPie = null;
let chartMonthly = null;

/* =========================================================
   LOAD (3 sheet sekaligus)
========================================================= */

async function loadData() {
  errorMessage.style.display = "none";
  dataStatus.textContent = "Memuat data...";

  const results = await Promise.allSettled([
    fetchSheetRows(SOURCES.dayaSerap.id, SOURCES.dayaSerap.gid),
    fetchSheetRows(SOURCES.perjadin.id, SOURCES.perjadin.gid),
    fetchSheetRows(SOURCES.rencana.id, SOURCES.rencana.gid),
  ]);

  const [dayaSerapRes, perjadinRes, rencanaRes] = results;
  const failures = [];

  // ===== Panel 1: Daya Serap Anggaran =====
  if (dayaSerapRes.status === "fulfilled") {
    try {
      renderDayaSerap(parseDayaSerap(dayaSerapRes.value));
    } catch (e) {
      console.error("[dashboard-utama] Gagal memproses Daya Serap:", e);
      failures.push("Daya Serap Anggaran");
    }
  } else {
    console.error("[dashboard-utama] Gagal mengambil Daya Serap:", dayaSerapRes.reason);
    failures.push("Daya Serap Anggaran");
  }

  // ===== Panel 2: Perjalanan Dinas =====
  if (perjadinRes.status === "fulfilled") {
    try {
      renderPerjadin(parsePerjadinAkun(perjadinRes.value));
    } catch (e) {
      console.error("[dashboard-utama] Gagal memproses Perjadin:", e);
      failures.push("Perjalanan Dinas");
    }
  } else {
    console.error("[dashboard-utama] Gagal mengambil Perjadin:", perjadinRes.reason);
    failures.push("Perjalanan Dinas");
  }

  // ===== Panel 3 & Grafik: Rencana Penarikan =====
  if (rencanaRes.status === "fulfilled") {
    try {
      const parsed = parseRencanaPenarikan(rencanaRes.value);
      renderPieChart(parsed.belanjaSummary);
      renderMonthlyChart(parsed.pelaksanaanRow);
    } catch (e) {
      console.error("[dashboard-utama] Gagal memproses Rencana Penarikan:", e);
      failures.push("Rencana Penarikan");
    }
  } else {
    console.error("[dashboard-utama] Gagal mengambil Rencana Penarikan:", rencanaRes.reason);
    failures.push("Rencana Penarikan");
  }

  document.getElementById("periodInfo").textContent = `Update: ${new Date().toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  })}`;

  if (failures.length) {
    dataStatus.textContent = `Sebagian data gagal dimuat (${failures.join(", ")})`;
    errorMessage.style.display = "block";
    errorText.textContent = `Gagal memuat: ${failures.join(", ")}. Coba muat ulang, atau cek koneksi ke Google Sheets.`;
  } else {
    dataStatus.textContent = "Semua data berhasil dimuat";
  }
}

/* =========================================================
   FETCH & PARSE DASAR (sama dengan dashboard lain)
========================================================= */

async function fetchSheetRows(spreadsheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?gid=${gid}&headers=0&tqx=out:json&_=${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });
    console.log("[dashboard v2] data diambil", new Date().toLocaleTimeString("id-ID"), url);
  if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
  const text = await response.text();
  const json = parseGoogleResponse(text);
  const table = json.table;
  if (!table) throw new Error("Struktur data Google Sheets tidak ditemukan.");
  return (table.rows || []).map((r) => (r.c || []).map(cellValue));
}

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

function textOf(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[\u200B\u200C\u200D\uFEFF]/g, "").trim();
}

function normText(v) {
  return textOf(v).toLowerCase();
}

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

/* =========================================================
   PARSE: DAYA SERAP ANGGARAN
   Ambil baris "Total Anggaran" — Jumlah(J)=index9, Realisasi(K)=index10,
   %(M)=index12. Sudah terverifikasi benar di dashboard Daya Serap.
========================================================= */

function parseDayaSerap(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const hasTotal = row.some((c) => /^total anggaran$/i.test(textOf(c)));
    if (hasTotal) {
      const pagu = toNumber(row[9]) || 0;
      const realisasi = toNumber(row[10]) || 0;
      const pct = toNumber(row[12]) || (pagu ? (realisasi / pagu) * 100 : 0);
      return { pagu, realisasi, pct };
    }
  }
  return { pagu: 0, realisasi: 0, pct: 0 };
}

/* =========================================================
   PARSE: PERJALANAN DINAS
   Ringkasan per Akun ada di blok atas (sebelum header "Kode"),
   kolom Detil berisi teks "524111-..." dst, Pagu = Detil+2,
   Sisa = Pagu+1 (offset tetap, terverifikasi dari data mentah).
========================================================= */

function parsePerjadinAkun(rows) {
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (row.some((c) => normText(c).startsWith("kode"))) {
      headerIdx = i;
      break;
    }
  }

  const headerRow = headerIdx >= 0 ? rows[headerIdx] : [];
  let detilCol = -1;
  for (let c = 0; c < headerRow.length; c++) {
    if (normText(headerRow[c]) === "detil") {
      detilCol = c;
      break;
    }
  }
  if (detilCol === -1) detilCol = 2; // fallback posisi terverifikasi
  const paguCol = detilCol + 2;
  const sisaCol = paguCol + 1;

  const akunSummary = [];
  const scanLimit = headerIdx >= 0 ? headerIdx : Math.min(rows.length, 10);
  for (let i = 0; i < scanLimit; i++) {
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

  return akunSummary;
}

/* =========================================================
   PARSE: RENCANA PENARIKAN
   Label Jenis Belanja & "Pelaksanaan" ada di kolom L (index 11),
   nilai bulanan di kolom M..X (index 12..23). Terverifikasi benar
   di dashboard Rencana Penarikan.
========================================================= */

function getMonthlyValues(row) {
  const arr = [];
  for (let i = 0; i < 12; i++) arr.push(toNumber(row[12 + i]) || 0);
  return arr;
}

function parseRencanaPenarikan(rows) {
  const belanjaSummary = [];
  let pelaksanaanRow = new Array(12).fill(0);

  const scanLimit = Math.min(rows.length, 20);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i];
    if (!row) continue;
    const label = textOf(row[11]);
    if (!label) continue;

    if (/pegawai|barang|modal/i.test(label)) {
      const code = (label.match(/5[123]/) || [])[0] || label;
      belanjaSummary.push({
        code,
        label: NAME_MAP[code] || label.replace(/\s*\(R\)\s*$/i, "").trim(),
        monthly: getMonthlyValues(row),
      });
    } else if (/pelaksanaan/i.test(label)) {
      pelaksanaanRow = getMonthlyValues(row);
    }
  }

  if (!pelaksanaanRow.some((v) => v > 0) && belanjaSummary.length) {
    pelaksanaanRow = new Array(12).fill(0);
    belanjaSummary.forEach((b) => b.monthly.forEach((v, idx) => (pelaksanaanRow[idx] += v)));
  }

  return { belanjaSummary, pelaksanaanRow };
}

/* =========================================================
   FORMAT
========================================================= */

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
   RENDER: PANEL 1 - DAYA SERAP ANGGARAN
========================================================= */

function renderDayaSerap(d) {
  const el = document.getElementById("recapDayaSerap");
  const pct = d.pagu ? Math.min(100, Math.max(0, (d.realisasi / d.pagu) * 100)) : 0;

  el.innerHTML = `
    <div class="recap-tile">
      <div class="recap-tile-top">
        <div class="recap-tile-icon blue">▦</div>
        <div class="recap-tile-content">
          <span class="recap-tile-label">Pagu Anggaran</span>
          <span class="recap-tile-value">${formatRupiah(d.pagu)}</span>
        </div>
      </div>
    </div>
    <div class="recap-tile">
      <div class="recap-tile-top">
        <div class="recap-tile-icon green">↗</div>
        <div class="recap-tile-content">
          <span class="recap-tile-label">Realisasi</span>
          <span class="recap-tile-value">${formatRupiah(d.realisasi)}</span>
        </div>
      </div>
      <div class="recap-tile-progress">
        <div class="progress"><div class="progress-bar" style="width:${pct}%;"></div></div>
      </div>
    </div>
    <div class="recap-tile">
      <div class="recap-tile-top">
        <div class="recap-tile-icon gold">%</div>
        <div class="recap-tile-content">
          <span class="recap-tile-label">% Realisasi</span>
          <span class="recap-tile-value">${formatPct(d.pct)}</span>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================
   RENDER: PANEL 2 - PERJALANAN DINAS
========================================================= */

function renderPerjadin(akunList) {
  const el = document.getElementById("recapPerjadin");

  if (!akunList.length) {
    el.innerHTML = `<div class="recap-loading">Ringkasan akun tidak ditemukan.</div>`;
    return;
  }

  const totalPagu = akunList.reduce((s, a) => s + a.pagu, 0);
  const totalSisa = akunList.reduce((s, a) => s + a.sisa, 0);
  const totalPct = totalPagu ? Math.min(100, Math.max(0, ((totalPagu - totalSisa) / totalPagu) * 100)) : 0;

  const summaryTile = `
    <div class="recap-tile">
      <div class="recap-tile-top">
        <div class="recap-tile-icon blue">▦</div>
        <div class="recap-tile-content">
          <span class="recap-tile-label">Total Pagu Perjadin</span>
          <span class="recap-tile-value">${formatRupiah(totalPagu)}</span>
          <span class="recap-tile-sub">Sisa ${formatRupiah(totalSisa)} · ${formatPct(totalPct)} terpakai</span>
        </div>
      </div>
      <div class="recap-tile-progress">
        <div class="progress"><div class="progress-bar" style="width:${totalPct}%;"></div></div>
      </div>
    </div>
  `;

  const colors = ["orange", "red", "purple", "blue"];
  const akunTiles = akunList
    .map((a, idx) => {
      const terpakai = a.pagu - a.sisa;
      const pct = a.pagu ? Math.min(100, Math.max(0, (terpakai / a.pagu) * 100)) : 0;
      return `
        <div class="recap-tile">
          <div class="recap-tile-top">
            <div class="recap-tile-icon ${colors[idx % colors.length]}">✈</div>
            <div class="recap-tile-content">
              <span class="recap-tile-label">${escapeHtml(a.label)}</span>
              <span class="recap-tile-value">${formatRupiah(a.pagu)}</span>
              <span class="recap-tile-sub">Sisa ${formatRupiah(a.sisa)} · ${formatPct(pct)} terpakai</span>
            </div>
          </div>
          <div class="recap-tile-progress">
            <div class="progress"><div class="progress-bar" style="width:${pct}%;"></div></div>
          </div>
        </div>
      `;
    })
    .join("");

  el.innerHTML = summaryTile + akunTiles;
}

/* =========================================================
   RENDER: PANEL 3 - PIE CHART RENCANA PENARIKAN
========================================================= */

function renderPieChart(belanjaSummary) {
  const ctx = document.getElementById("chartBelanjaPie");
  if (!ctx) return;

  const NAME_ORDER = ["51", "52", "53"];
  const byCode = {};
  belanjaSummary.forEach((b) => (byCode[b.code] = b));
  const list = NAME_ORDER.map((code) => byCode[code] || { code, label: NAME_MAP[code], monthly: new Array(12).fill(0) });

  const totals = list.map((b) => b.monthly.reduce((s, v) => s + v, 0));
  const labels = list.map((b) => b.label);

  if (chartBelanjaPie) chartBelanjaPie.destroy();

  chartBelanjaPie = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data: totals, backgroundColor: list.map((b) => PIE_COLORS[b.code] || "#7554c7") }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${formatRupiah(c.raw)}` } },
      },
    },
  });

  const legend = document.getElementById("pieLegend");
  const grandTotal = totals.reduce((s, v) => s + v, 0) || 1;
  legend.innerHTML = list
    .map((b, idx) => {
      const pct = (totals[idx] / grandTotal) * 100;
      return `<span class="chart-legend-item"><span class="chart-legend-dot" style="background:${
        PIE_COLORS[b.code] || "#7554c7"
      }"></span>${escapeHtml(b.label)} (${formatPct(pct)})</span>`;
    })
    .join("");
}

/* =========================================================
   RENDER: GRAFIK BULANAN (RENCANA PENARIKAN)
========================================================= */

function renderMonthlyChart(pelaksanaanRow) {
  const ctx = document.getElementById("chartMonthly");
  if (!ctx) return;

  const avg = pelaksanaanRow.reduce((s, v) => s + v, 0) / 12;
  const maxIdx = pelaksanaanRow.reduce((best, v, idx) => (v > pelaksanaanRow[best] ? idx : best), 0);
  const minIdx = pelaksanaanRow.reduce((best, v, idx) => (v < pelaksanaanRow[best] ? idx : best), 0);

  if (chartMonthly) chartMonthly.destroy();

  chartMonthly = new Chart(ctx, {
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

  document.getElementById("chartMonthlyInsight").innerHTML = `Rencana penarikan tertinggi ada pada bulan <strong>${
    MONTH_LABELS_FULL[maxIdx]
  }</strong> (${formatRupiah(pelaksanaanRow[maxIdx])}), terendah pada <strong>${
    MONTH_LABELS_FULL[minIdx]
  }</strong> (${formatRupiah(pelaksanaanRow[minIdx])}).`;
}

/* =========================================================
   EVENT & START
========================================================= */

refreshBtn.addEventListener("click", () => loadData());

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
