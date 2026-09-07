(function () {
  var track = document.getElementById("track");
  var viewport = document.getElementById("viewport");
  var dotsWrap = document.getElementById("dots");
  var prevBtn = document.getElementById("prevBtn");
  var nextBtn = document.getElementById("nextBtn");
  var slides = Array.prototype.slice.call(track.children);
  var count = slides.length;

  var AUTOPLAY_MS = 6000;
  document.documentElement.style.setProperty("--autoplay-duration", AUTOPLAY_MS + "ms");

  var current = 0;
  var autoplayTimer = null;

  // ===== Buat titik navigasi =====
  var dotEls = slides.map(function (_, i) {
    var dot = document.createElement("button");
    dot.type = "button";
    dot.className = "dot";
    dot.setAttribute("aria-label", "Ke slide " + (i + 1));
    var fill = document.createElement("span");
    fill.className = "dot-fill";
    dot.appendChild(fill);
    dot.addEventListener("click", function () {
      goTo(i, true);
    });
    dotsWrap.appendChild(dot);
    return dot;
  });

  function render() {
    track.style.transform = "translateX(-" + current * 100 + "%)";

    dotEls.forEach(function (dot, i) {
      dot.classList.remove("is-active", "is-done");
      if (i < current) dot.classList.add("is-done");
      if (i === current) dot.classList.add("is-active");
    });
  }

  function goTo(index, isManual) {
    current = (index + count) % count;
    render();
    restartAutoplay();
  }

  function next() {
    goTo(current + 1);
  }

  function prev() {
    goTo(current - 1);
  }

  function restartAutoplay() {
    if (autoplayTimer) clearTimeout(autoplayTimer);
    autoplayTimer = setTimeout(next, AUTOPLAY_MS);
  }

  // ===== Kontrol manual =====
  nextBtn.addEventListener("click", function () {
    next();
  });
  prevBtn.addEventListener("click", function () {
    prev();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight") next();
    if (e.key === "ArrowLeft") prev();
  });

  // ===== Swipe (mobile / trackpad drag) =====
  var touchStartX = null;
  viewport.addEventListener(
    "touchstart",
    function (e) {
      touchStartX = e.touches[0].clientX;
    },
    { passive: true },
  );
  viewport.addEventListener(
    "touchend",
    function (e) {
      if (touchStartX === null) return;
      var dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 50) {
        if (dx < 0) next();
        else prev();
      }
      touchStartX = null;
    },
    { passive: true },
  );

  // ===== Jeda autoplay saat pointer di atas slideshow, lanjut saat keluar =====
  viewport.addEventListener("mouseenter", function () {
    if (autoplayTimer) clearTimeout(autoplayTimer);
  });
  viewport.addEventListener("mouseleave", function () {
    restartAutoplay();
  });

  // ===== Reset transisi saat resize (hindari lompatan visual) =====
  window.addEventListener("resize", render);

  render();
  restartAutoplay();
})();
