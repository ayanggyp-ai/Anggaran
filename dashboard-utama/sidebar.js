(function () {
  var btn = document.getElementById("hamburgerBtn");
  var sidebar = document.getElementById("appSidebar");
  var overlay = document.getElementById("sidebarOverlay");
  var closeBtn = document.getElementById("sidebarCloseBtn");
  var desktopQuery = window.matchMedia("(min-width: 901px)");

  // =========================================================
  // SATU VARIABEL STATUS SIDEBAR ("open" / "collapsed")
  // Ini satu-satunya sumber kebenaran soal sidebar sedang tampil atau
  // tidak. Lebar konten (padding-left body) berubah SEKETIKA mengikuti
  // status ini (tanpa animasi CSS), jadi begitu status berubah, ukuran
  // container sudah final dan chart bisa langsung di-resize dengan
  // benar — tidak perlu menebak durasi animasi lagi. Animasi halus
  // tetap ada, tapi cuma untuk geser panel sidebar-nya sendiri.
  // =========================================================
  var sidebarStatus = null; // diisi di bawah, tergantung ukuran layar saat load

  function isDesktop() {
    return desktopQuery.matches;
  }

  // Default: terbuka di desktop, tertutup di mobile (overlay tidak
  // boleh langsung menutupi layar begitu halaman dimuat di HP).
  sidebarStatus = isDesktop() ? "open" : "collapsed";

  function resizeAllCharts() {
    if (window.Chart && window.Chart.instances) {
      Object.values(window.Chart.instances).forEach(function (chart) {
        if (chart && typeof chart.resize === "function") {
          try {
            chart.resize();
          } catch (e) {
            /* chart mungkin sedang dalam proses redraw, aman diabaikan */
          }
        }
      });
    }
  }

  function applyStatus() {
    if (!sidebar) return;
    var open = sidebarStatus === "open";

    if (isDesktop()) {
      sidebar.classList.toggle("is-collapsed", !open);
      document.body.classList.toggle("sidebar-collapsed-layout", !open);
      sidebar.classList.remove("is-open");
      if (overlay) overlay.classList.remove("is-visible");
    } else {
      sidebar.classList.toggle("is-open", open);
      if (overlay) overlay.classList.toggle("is-visible", open);
      sidebar.classList.remove("is-collapsed");
      document.body.classList.remove("sidebar-collapsed-layout");
    }

    // Lebar konten (padding-left body) sudah berubah SEKETIKA lewat
    // class di atas (tidak dianimasikan) begitu baris ini dijalankan,
    // jadi resize chart langsung dipanggil sekarang — tidak perlu
    // setTimeout menebak durasi animasi.
    resizeAllCharts();
    // Satu kali cadangan lewat requestAnimationFrame untuk jaga-jaga
    // kalau browser belum sempat commit layout barunya di frame ini.
    requestAnimationFrame(resizeAllCharts);
  }

  function openSidebar() {
    sidebarStatus = "open";
    applyStatus();
  }

  function closeSidebar() {
    sidebarStatus = "collapsed";
    applyStatus();
  }

  function toggleSidebar() {
    sidebarStatus = sidebarStatus === "open" ? "collapsed" : "open";
    applyStatus();
  }

  if (btn) btn.addEventListener("click", toggleSidebar);
  if (overlay) overlay.addEventListener("click", closeSidebar);
  if (closeBtn) closeBtn.addEventListener("click", closeSidebar);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !isDesktop() && sidebarStatus === "open") closeSidebar();
  });

  // Kalau ukuran layar berpindah lintas breakpoint (mis. resize window
  // atau putar orientasi HP), terapkan ulang status yang sama supaya
  // tidak nyangkut dalam kondisi campuran desktop/mobile.
  desktopQuery.addEventListener("change", function () {
    // Saat berpindah lintas breakpoint (resize window / putar HP),
    // kembalikan ke default yang sesuai untuk ukuran layar barunya,
    // bukan mempertahankan status dari mode sebelumnya.
    sidebarStatus = isDesktop() ? "open" : "collapsed";
    applyStatus();
  });

  // Terapkan status awal saat halaman pertama kali dimuat.
  applyStatus();

  // Tandai link halaman aktif berdasarkan atribut data-page pada <body>.
  var current = document.body.getAttribute("data-page");
  if (current) {
    document.querySelectorAll(".sidebar-link").forEach(function (link) {
      if (link.getAttribute("data-page") === current) {
        link.classList.add("active");
      }
    });
  }
})();
