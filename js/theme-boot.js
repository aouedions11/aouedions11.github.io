/* theme-boot.js — applies the stored or system light/dark preference before the page is painted.
   The other pages carry the same few lines inline in their <head>; the writing page loads them
   from this file because it does not allow inline scripts. js/theme.js handles the toggle button. */
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (t !== 'dark' && t !== 'light') {
      t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage unavailable: the light theme stays */ }
})();
