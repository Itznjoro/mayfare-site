(function () {
  'use strict';

  function getInitials(fullName) {
    if (!fullName) return '?';
    var parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function formatJoinedDate(isoString) {
    if (!isoString) return '';
    var d = new Date(isoString);
    return 'Joined ' + d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  // Derive a display "handle" from the Telegram username if set, otherwise
  // fall back to the part of the email before the @ — always something
  // reasonable to show, never "undefined".
  function getHandle(user) {
    if (user.telegram) return user.telegram.replace(/^@/, '');
    return user.email.split('@')[0];
  }

  function populateSidebar(user) {
    var nameEl = document.getElementById('sidebarUserName');
    var avatarEl = document.getElementById('sidebarAvatarInitials');
    if (nameEl) nameEl.textContent = user.fullName;
    if (avatarEl) avatarEl.textContent = getInitials(user.fullName);
  }

  function populateProfilePage(user) {
    var nameEl = document.getElementById('profileName');
    var avatarEl = document.getElementById('profileAvatarInitials');
    var handleEl = document.getElementById('profileHandle');
    var emailEl = document.getElementById('profileEmail');
    var email2FAEl = document.getElementById('profileEmail2FA');
    var emailResetEl = document.getElementById('profileEmailReset');
    var joinedEl = document.getElementById('profileJoined');
    var telegramLink = document.getElementById('profileTelegramLink');
    var telegramText = document.getElementById('profileTelegramText');

    if (!nameEl) return; // not on the profile page

    var handle = getHandle(user);

    if (avatarEl) avatarEl.textContent = getInitials(user.fullName);
    nameEl.textContent = user.fullName;
    if (handleEl) handleEl.textContent = '@' + handle;
    if (emailEl) emailEl.textContent = user.email;
    if (email2FAEl) email2FAEl.textContent = user.email;
    if (emailResetEl) emailResetEl.textContent = user.email;
    if (joinedEl) joinedEl.textContent = formatJoinedDate(user.createdAt);

    if (user.telegram) {
      var cleanHandle = user.telegram.replace(/^@/, '');
      if (telegramLink) {
        telegramLink.href = 'https://t.me/' + cleanHandle;
        telegramLink.style.display = '';
      }
      if (telegramText) telegramText.textContent = '@' + cleanHandle;
    } else if (telegramLink) {
      // No Telegram on file — hide the row rather than show a broken/fake link.
      telegramLink.style.display = 'none';
    }
  }

  fetch('/api/auth/me')
    .then(function (res) {
      if (res.status === 401) {
        // Not logged in — this page is protected, send them to log in.
        // (../login.html because every dashboard page lives one level
        // deeper, under /pages/.)
        window.location.href = '../login.html';
        return null;
      }
      if (!res.ok) throw new Error('auth check failed: ' + res.status);
      return res.json();
    })
    .then(function (data) {
      if (!data) return; // redirect already in progress
      var user = data.user;
      window.__mayfareUser = user;
      populateSidebar(user);
      populateProfilePage(user);
      document.dispatchEvent(new CustomEvent('mayfare:user-ready', { detail: user }));
    })
    .catch(function (err) {
      // If we can't even reach the API, don't lock the user out of a page
      // they might already be looking at — just log it. The dashboard will
      // simply show placeholder values until this succeeds.
      console.warn('Could not load account info:', err.message);
    });
})();
