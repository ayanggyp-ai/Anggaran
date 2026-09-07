(function () {
  var overlay = document.getElementById("pageTransition");
  if (!overlay) return;

  function hideOverlay() {
    overlay.classList.add("is-hidden");
  }

  window.addEventListener("load", function () {
    setTimeout(hideOverlay, 550);
  });

  function navigateWithTransition(url) {
    overlay.classList.remove("is-hidden");
    setTimeout(function () {
      window.location.href = url;
    }, 400);
  }

  document.querySelectorAll("[data-transition-link]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      navigateWithTransition(el.getAttribute("href"));
    });
  });
})();
