// Cookie consent gate. Loaded on every public (non-admin) HTML response
// via an onSend hook in server.ts. Reads/writes localStorage only —
// nothing about the visitor's choice is sent to or stored on the server.
//
// Wires the optional Microsoft Clarity beacon only when the visitor has
// explicitly accepted AND the operator has set CLARITY_PROJECT_ID
// (server passes it via window.__zdConsent.clarityId; empty = disabled).
//
// Cloudflare Web Analytics is edge-injected by the CF proxy and is not
// gated here — it is cookieless and runs regardless. The banner copy
// and the /privacy page disclose this honestly.

(function () {
  if (window.__zdConsentMounted) return;
  window.__zdConsentMounted = true;

  var STORAGE_KEY = 'zd_cookie_consent';
  var CLARITY_ID_KEY = 'zd_clarity_id';
  var VERSION = 1;
  var cfg = window.__zdConsent || {};
  var clarityId = (cfg.clarityId || '').trim();

  function readChoice() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== VERSION) return null;
      if (parsed.choice !== 'accept' && parsed.choice !== 'reject') return null;
      return parsed.choice;
    } catch (e) { return null; }
  }

  function writeChoice(choice) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        choice: choice, ts: Date.now(), version: VERSION,
      }));
    } catch (e) { /* private mode etc. — banner just keeps reappearing */ }
    // Reject must fully undo optional tracking state — drop the persisted
    // Clarity anon ID so a later Accept gets a fresh identity, not the one
    // that was already shipped to Clarity during the prior Accept.
    if (choice === 'reject') {
      try { localStorage.removeItem(CLARITY_ID_KEY); } catch (e) {}
    }
  }

  function clarityAnonId() {
    // Stable per-browser identifier passed to Clarity as the customId so
    // visits across reloads / tabs / cookie-eviction get merged into one
    // "person" instead of fragmenting into many sessions. Created lazily
    // and only after consent — never set for visitors who rejected.
    try {
      var existing = localStorage.getItem(CLARITY_ID_KEY);
      if (existing) return existing;
    } catch (e) { /* private mode: pass undefined, Clarity falls back to cookie */ }
    var fresh = (window.crypto && window.crypto.randomUUID)
      ? window.crypto.randomUUID()
      : ('a-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
    try { localStorage.setItem(CLARITY_ID_KEY, fresh); } catch (e) {}
    return fresh;
  }

  function loadClarity(id) {
    if (window.__zdClarityLoaded) return;
    window.__zdClarityLoaded = true;
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', id);
    // Queue an identify so when the remote tag finishes loading it tags
    // this person as the same one across reloads / cookie eviction.
    try {
      var anon = clarityAnonId();
      if (anon && window.clarity) window.clarity('identify', anon);
    } catch (e) {}
  }

  function applyAccept() {
    if (clarityId) loadClarity(clarityId);
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'onclick') n.addEventListener('click', attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    if (children) for (var i = 0; i < children.length; i++) {
      var c = children[i];
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }

  function removeBanner() {
    var b = document.getElementById('zd-consent-banner');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  function closeModal() {
    var m = document.getElementById('zd-consent-modal-backdrop');
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  function mountFooterLink() {
    if (document.getElementById('zd-consent-footer-link')) return;
    var link = el('a', {
      id: 'zd-consent-footer-link',
      href: '#',
      onclick: function (ev) { ev.preventDefault(); openModal(); },
    }, ['Cookies']);
    document.body.appendChild(link);
  }

  function openModal() {
    closeModal();
    var current = readChoice();
    // Default optional items to ON when no prior choice exists, so Save-with-
    // no-changes mirrors the banner's Accept button. Only an explicit prior
    // Reject leaves them unchecked.
    var clarityChecked = current !== 'reject';
    var clarityDisabled = !clarityId;

    var clarityLabel = el('label', null, [
      (function () {
        var cb = el('input', { type: 'checkbox', id: 'zd-consent-clarity' });
        if (clarityChecked) cb.checked = true;
        if (clarityDisabled) cb.disabled = true;
        return cb;
      })(),
      document.createTextNode(' Microsoft Clarity'),
    ]);

    var modal = el('div', { id: 'zd-consent-modal' }, [
      el('h2', null, ['Cookie & analytics settings']),
      el('p', null, ['Pick what you want loaded. Your choice is stored in this browser only.']),

      el('h3', null, ['Strictly necessary']),
      el('div', { class: 'zd-consent-row locked' }, [
        el('label', null, [
          (function () { var cb = el('input', { type: 'checkbox' }); cb.checked = true; cb.disabled = true; return cb; })(),
          document.createTextNode(' Authentication cookies'),
        ]),
        el('div', { class: 'zd-consent-desc' }, [
          'player_session, admin_session, and short-lived helpers. Required to log in — cannot be disabled.',
        ]),
      ]),

      el('h3', null, ['Optional']),
      el('div', { class: 'zd-consent-row' }, [
        clarityLabel,
        el('div', { class: 'zd-consent-desc' }, [
          clarityDisabled
            ? 'Anonymous session-replay and heatmaps. Currently not configured on this deployment.'
            : 'Anonymous session-replay and heatmaps from Microsoft Clarity. Helps us improve the site.',
        ]),
      ]),

      el('h3', null, ['Edge-only, not gated here']),
      el('div', { class: 'zd-consent-row locked' }, [
        el('label', null, [
          (function () { var cb = el('input', { type: 'checkbox' }); cb.checked = true; cb.disabled = true; return cb; })(),
          document.createTextNode(' Cloudflare Web Analytics'),
        ]),
        el('div', { class: 'zd-consent-desc' }, [
          'Cookieless edge analytics injected by Cloudflare. Runs regardless of your choice. No personal data collected.',
        ]),
      ]),

      el('p', null, ['We do not sell your data. Ever. There is no ad network. See the ',
        (function () { var a = el('a', { href: '/privacy' }, ['privacy page']); return a; })(),
        ' for details.',
      ]),

      el('div', { class: 'zd-consent-modal-actions' }, [
        el('button', {
          class: 'zd-consent-btn',
          onclick: function () { closeModal(); },
        }, ['Cancel']),
        el('button', {
          class: 'zd-consent-btn primary',
          onclick: function () {
            var cb = document.getElementById('zd-consent-clarity');
            var choice = (cb && cb.checked && !clarityDisabled) ? 'accept' : 'reject';
            writeChoice(choice);
            if (choice === 'accept') applyAccept();
            closeModal();
            removeBanner();
            mountFooterLink();
          },
        }, ['Save']),
      ]),
    ]);

    var backdrop = el('div', {
      id: 'zd-consent-modal-backdrop',
      onclick: function (ev) { if (ev.target === backdrop) closeModal(); },
    }, [modal]);
    document.body.appendChild(backdrop);
  }

  function mountBanner() {
    if (document.getElementById('zd-consent-banner')) return;

    var copy = el('div', { class: 'zd-consent-copy', html:
      'We use cookies and similar tools. <strong>Strictly necessary</strong> cookies keep you logged in. ' +
      'With your consent we also load <strong>Microsoft Clarity</strong> for anonymous session replays so we can improve the site. ' +
      '<strong>Cloudflare Web Analytics</strong> is cookieless and runs at the edge regardless of your choice. ' +
      '<strong>We never sell your data.</strong> ' +
      '<a href="/privacy">Read the privacy page.</a>',
    });

    var actions = el('div', { class: 'zd-consent-actions' }, [
      el('button', {
        class: 'zd-consent-btn',
        onclick: function () { openModal(); },
      }, ['Manage']),
      el('button', {
        class: 'zd-consent-btn',
        onclick: function () {
          writeChoice('reject');
          removeBanner();
          mountFooterLink();
        },
      }, ['Reject']),
      el('button', {
        class: 'zd-consent-btn primary',
        onclick: function () {
          writeChoice('accept');
          applyAccept();
          removeBanner();
          mountFooterLink();
        },
      }, ['Accept']),
    ]);

    var banner = el('div', { id: 'zd-consent-banner', role: 'dialog', 'aria-label': 'Cookie consent' }, [copy, actions]);
    document.body.appendChild(banner);
  }

  function boot() {
    var choice = readChoice();
    if (choice === 'accept') {
      applyAccept();
      mountFooterLink();
    } else if (choice === 'reject') {
      mountFooterLink();
    } else {
      mountBanner();
    }
  }

  // Expose a tiny API so the /privacy page can wire its "Reset consent"
  // button without re-implementing storage details.
  window.__zdConsent.reset = function () {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    try { localStorage.removeItem(CLARITY_ID_KEY); } catch (e) {}
    removeBanner();
    var fl = document.getElementById('zd-consent-footer-link');
    if (fl && fl.parentNode) fl.parentNode.removeChild(fl);
    mountBanner();
  };
  window.__zdConsent.openModal = openModal;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
