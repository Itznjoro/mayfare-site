(function () {
  'use strict';

  // NOTE: 'mayfare_logged_in' is a TEMPORARY client-side placeholder until real
  // server-side sessions are implemented. It should be replaced with an actual
  // auth check (e.g. a call to /api/auth/me) once the backend exists.
  function isLoggedIn() {
    return localStorage.getItem('mayfare_logged_in') === '1';
  }

  // ---- Mobile sidebar menu toggle ----
  (function mobileMenu() {
    var sidebar = document.querySelector('aside');
    var openBtn = document.querySelector('button[aria-label="Open menu"]');
    if (!sidebar || !openBtn) return;

    var overlay = document.createElement('div');
    overlay.className = 'dashboard-mobile-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:40;display:none;';
    document.body.appendChild(overlay);

    function openMenu() {
      sidebar.classList.remove('-translate-x-full');
      sidebar.classList.add('translate-x-0');
      overlay.style.display = 'block';
    }
    function closeMenu() {
      sidebar.classList.add('-translate-x-full');
      sidebar.classList.remove('translate-x-0');
      overlay.style.display = 'none';
    }

    openBtn.addEventListener('click', openMenu);
    overlay.addEventListener('click', closeMenu);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });
  })();

  // ---- Logo: routes to the dashboard overview if logged in, homepage otherwise ----
  (function logoRouting() {
    var logoLink = document.querySelector('aside a[href="/"]');
    if (!logoLink) return;
    if (isLoggedIn()) {
      logoLink.setAttribute('href', 'app.html');
    }
    // else: leave as "/" (existing homepage behavior), unchanged.
  })();

  // ---- Sign Out ----
  (function signOut() {
    var buttons = document.querySelectorAll('aside button');
    var signOutBtn = Array.prototype.filter.call(buttons, function (b) {
      return b.textContent.trim().indexOf('Sign Out') !== -1;
    })[0];
    if (!signOutBtn) return;
    signOutBtn.addEventListener('click', function () {
      localStorage.removeItem('mayfare_logged_in');
      window.location.href = '../index.html';
    });
  })();

  // ---- Light / dark theme toggle ----
  // Note: every page already ships a small inline script (from the original Next.js
  // export) that applies the saved theme from localStorage['theme'] before first paint,
  // so there's no flash of the wrong theme. This just syncs the button's icon/label to
  // match on load, and handles the click to toggle + persist under that same key.
  (function themeToggle() {
    var html = document.documentElement;
    var toggleBtn = document.querySelector('button[aria-label^="Switch to"]');
    if (!toggleBtn) return;

    var moonPath = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />';
    var sunPath =
      '<circle cx="12" cy="12" r="4" />' +
      '<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />';

    function syncButton(theme) {
      var svg = toggleBtn.querySelector('svg');
      if (svg) svg.innerHTML = theme === 'dark' ? sunPath : moonPath;
      toggleBtn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      toggleBtn.setAttribute('title', theme === 'dark' ? 'Light theme (D)' : 'Dark theme (D)');
    }

    syncButton(html.classList.contains('dark') ? 'dark' : 'light');

    toggleBtn.addEventListener('click', function () {
      var next = html.classList.contains('dark') ? 'light' : 'dark';
      html.classList.remove('light', 'dark');
      html.classList.add(next);
      html.style.colorScheme = next;
      syncButton(next);
      localStorage.setItem('theme', next);
    });
  })();

})();
