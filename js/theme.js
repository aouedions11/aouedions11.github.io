/* theme.js — light/dark toggle shared by every page.
   The inline snippet in <head> applies the stored or system preference before first paint;
   this file wires the toggle button(s) and keeps aria state in sync. */
(function () {
  'use strict';

  var root = document.documentElement;

  function current() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function apply(theme, persist) {
    root.setAttribute('data-theme', theme);
    if (persist) {
      try { localStorage.setItem('theme', theme); } catch (e) { /* storage unavailable */ }
    }
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    });
  }

  apply(current(), false);

  document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      apply(current() === 'dark' ? 'light' : 'dark', true);
    });
  });

  try {
    if (!localStorage.getItem('theme') && window.matchMedia) {
      var media = window.matchMedia('(prefers-color-scheme: dark)');
      if (media.addEventListener) {
        media.addEventListener('change', function (e) { apply(e.matches ? 'dark' : 'light', false); });
      }
    }
  } catch (e) { /* ignore */ }
})();
