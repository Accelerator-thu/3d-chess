// Apply the theme before first paint; shares the main site's preference key.
(function () {
  var t = null;
  try { t = localStorage.getItem("wc-color-theme"); } catch (e) { /* storage blocked */ }
  if (t !== "dark" && t !== "light") {
    t = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.dataset.theme = t;
})();
