// Admin console client glue. All progressive enhancement; every feature has
// a server-rendered fallback that works without JS.
//
// Wires up:
//   • top-bar user menu (dashboard)
//   • mail provider segmented radio + smtp toggle (setup)
//   • per-row hint dropdown menus (dashboard)
//   • player detail drawer with JSON fetch (dashboard)
//   • live-feed polling at 5s intervals (dashboard)

(function () {
  // ── helpers ─────────────────────────────────────────────────────────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function toast(txt, kind) {
    var stack = document.getElementById('toast-stack');
    if (!stack) return;
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || 'cold');
    t.textContent = txt;
    stack.appendChild(t);
    setTimeout(function () { t.remove(); }, 4500);
  }
  function fmtTime(iso) { try { return new Date(iso).toISOString().slice(11, 19); } catch (e) { return ''; } }
  // Escape values destined for innerHTML. Player-controlled fields like
  // attempts.submitted are stored verbatim and an admin opening the drawer
  // would otherwise execute attacker markup in the admin origin (stored XSS).
  function escHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── top-bar user menu ───────────────────────────────────────────────
  var menuBtn = document.getElementById('user-menu-btn');
  var menuList = document.getElementById('user-menu-list');
  if (menuBtn && menuList) {
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      menuList.style.display = (menuList.style.display === 'none' || !menuList.style.display) ? 'block' : 'none';
    });
    document.addEventListener('click', function () { menuList.style.display = 'none'; });
  }

  // ── setup wizard glue ───────────────────────────────────────────────
  var providerButtons = $$('.seg-radio button[data-provider]');
  if (providerButtons.length) {
    var resendFields = $('[data-provider-fields="resend"]');
    var smtpFields = $('[data-provider-fields="smtp"]');
    var hidden = $('input[name="provider"]');
    providerButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = btn.getAttribute('data-provider');
        providerButtons.forEach(function (b) { b.classList.toggle('active', b === btn); });
        if (hidden) hidden.value = v;
        if (resendFields) resendFields.style.display = v === 'resend' ? '' : 'none';
        if (smtpFields)   smtpFields.style.display   = v === 'smtp'   ? '' : 'none';
      });
    });
  }
  $$('.toggle-pill[data-toggle]').forEach(function (t) {
    var input = t.querySelector('input[type="checkbox"]');
    if (input && input.checked) t.classList.add('on');
    t.addEventListener('click', function () {
      if (!input) return;
      input.checked = !input.checked;
      t.classList.toggle('on', input.checked);
    });
  });

  // ── per-row hint dropdown menus ─────────────────────────────────────
  function closeAllHintMenus() {
    $$('[data-hint-menu]').forEach(function (m) { m.style.display = 'none'; });
    var dm = $('[data-drawer-hint-menu]');
    if (dm) dm.style.display = 'none';
  }
  $$('[data-hint-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var key = btn.getAttribute('data-hint-toggle');
      var menu = $('[data-hint-menu="' + key + '"]');
      if (!menu) return;
      var open = menu.style.display !== 'none';
      closeAllHintMenus();
      menu.style.display = open ? 'none' : 'block';
    });
  });
  document.addEventListener('click', closeAllHintMenus);

  // ── player drawer ───────────────────────────────────────────────────
  var drawerRoot = document.getElementById('drawer-root');
  var currentPlayerId = null;
  var currentChallengeId = null;
  var currentOrdinal = null;

  function closeDrawer() {
    if (!drawerRoot) return;
    drawerRoot.hidden = true;
    currentPlayerId = null;
    currentChallengeId = null;
    currentOrdinal = null;
  }

  function renderDrawer(p) {
    if (!drawerRoot) return;
    currentPlayerId = p.id;
    currentChallengeId = p.currentChallenge ? p.currentChallenge.id : null;
    currentOrdinal = p.stage;

    $('[data-drawer-alias]').textContent = p.alias;
    $('[data-drawer-meta]').textContent = (p.email || '') + ' · signed up ' + (p.createdAt ? p.createdAt.slice(0, 10) : '—');

    // 19-cell prog map
    var progmap = $('[data-drawer-progmap]');
    progmap.innerHTML = '';
    for (var i = 1; i <= p.total; i++) {
      var cell = document.createElement('div');
      cell.className = 'prog-cell' + (i < p.stage ? ' done' : i === p.stage ? ' now' : '');
      cell.textContent = String(i);
      progmap.appendChild(cell);
    }
    var desc = $('[data-drawer-progdesc]');
    if (p.currentChallenge) {
      desc.innerHTML = 'currently on <span class="chrome">' + p.currentChallenge.title +
        '</span> · <span class="chrome">' + p.currentChallenge.category +
        '</span> · <span class="chrome">' + p.currentChallenge.points + ' pts</span> if cleared';
    } else {
      desc.textContent = p.completedAt ? 'all 19 trials cleared.' : 'no current challenge.';
    }

    // KV table
    var kv = $('[data-drawer-kv]');
    var rows = [
      ['stage', p.stage + ' of ' + p.total],
      ['solves', p.solves],
      ['admin skips', p.adminSkips],
      ['hints used', p.hintsUsed],
      ['attempts', p.attemptsTotal],
      ['last advance', p.lastAdvanceAt ? p.lastAdvanceAt.replace('T', ' ').slice(0, 16) : '—'],
      ['verified', p.verifiedAt ? 'yes' : 'no'],
      ['flag salt', p.flagSaltPrefix],
    ];
    kv.innerHTML = rows.map(function (r) {
      return '<div class="k">' + r[0] + '</div><div class="v tabular">' + (r[1] == null ? '—' : r[1]) + '</div>';
    }).join('');

    // Integrity panel — only shown if the player has any cheat history.
    var intSection = $('[data-drawer-integrity-section]');
    var intBody = $('[data-drawer-integrity]');
    var hasHistory = !!(p.frozenAt || (p.cheatStrikes && p.cheatStrikes > 0) || (p.strikeHistory && p.strikeHistory.length));
    if (intSection) intSection.hidden = !hasHistory;
    if (intBody) {
      if (!hasHistory) {
        intBody.innerHTML = '';
      } else {
        var status = p.frozenAt
          ? '<span class="warn">frozen</span> · ' + (p.frozenReason || 'unknown') + ' · ' + p.frozenAt.replace('T', ' ').slice(0, 16)
          : '<span class="dim">active</span>';
        var strikeRows = (p.strikeHistory || []).slice(0, 6).map(function (s) {
          var ack = s.acknowledgedAt ? '<span class="dim">ack</span>' : '<span class="amber">unack</span>';
          return '<div class="att-r"><span class="ghost">' + fmtTime(s.detectedAt) + '</span>' +
            '<span>strike ' + s.strikeNumber + ' · ' + s.challengeId + ' · consumer #' + s.consumerId + '</span>' +
            '<b>' + ack + '</b></div>';
        }).join('') || '<div class="dim">no strike rows</div>';
        intBody.innerHTML =
          '<div class="kv"><div class="k">status</div><div class="v">' + status + '</div>' +
          '<div class="k">strikes</div><div class="v tabular">' + (p.cheatStrikes || 0) + ' / 2</div></div>' +
          '<div style="margin-top:10px">' + strikeRows + '</div>' +
          '<div style="display:flex;gap:6px;margin-top:10px">' +
            (p.frozenAt ? '<button class="btn sm" type="button" data-drawer-unfreeze>[ unfreeze ]</button>' : '') +
            ((p.cheatStrikes && p.cheatStrikes > 0) ? '<button class="btn sm warn" type="button" data-drawer-clear-strikes>[ clear strikes ]</button>' : '') +
          '</div>';
      }
    }

    // Recent attempts
    var atts = $('[data-drawer-attempts]');
    if (!p.recentAttempts.length) {
      atts.innerHTML = '<div class="dim">no submits yet</div>';
    } else {
      atts.innerHTML = p.recentAttempts.map(function (a) {
        return '<div class="att-r ' + (a.correct ? 'ok' : 'no') + '">' +
          '<span class="ghost">' + fmtTime(a.createdAt) + '</span>' +
          '<span style="word-break:break-all">t' + (a.ordinal || '?') + ' · ' + escHtml(a.submitted || '') + '</span>' +
          '<b>' + (a.correct ? '✓' : '✗') + '</b></div>';
      }).join('');
    }

    drawerRoot.hidden = false;
  }

  function openDrawer(id) {
    fetch('/admin/api/player/' + id, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(renderDrawer)
      .catch(function (e) { toast('drawer load failed: ' + e.message, 'warn'); });
  }

  // Click anywhere with data-open-drawer
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document) {
      if (t.dataset && t.dataset.openDrawer) { openDrawer(t.dataset.openDrawer); e.preventDefault(); return; }
      if (t.dataset && t.dataset.closeDrawer !== undefined) { closeDrawer(); e.preventDefault(); return; }
      t = t.parentNode;
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawerRoot && !drawerRoot.hidden) closeDrawer();
  });

  // Click on a player row also opens the drawer (unless click is on data-no-drawer column)
  $$('tr[data-player-id]').forEach(function (tr) {
    tr.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== tr) {
        if (t.dataset && t.dataset.noDrawer) return;
        if (t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'FORM' || t.tagName === 'INPUT') return;
        t = t.parentNode;
      }
      openDrawer(tr.dataset.playerId);
    });
  });

  // Drawer hint menu toggle
  var drawerHintToggle = $('[data-drawer-hint-toggle]');
  if (drawerHintToggle) {
    drawerHintToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = $('[data-drawer-hint-menu]');
      if (!menu) return;
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });
  }
  $$('[data-drawer-hint]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!currentPlayerId || !currentChallengeId) return;
      var lvl = btn.getAttribute('data-drawer-hint');
      fetch('/admin/api/player/' + currentPlayerId + '/hint', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_id: currentChallengeId, level: Number(lvl) }),
      }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      }).then(function (j) {
        toast('hint L' + lvl + ' dispatched · mail ' + (j.mailOk ? 'sent' : 'queued'), 'amber');
        closeAllHintMenus();
      }).catch(function (e) { toast('hint failed: ' + e.message, 'warn'); });
    });
  });

  // Drawer integrity actions (unfreeze + clear-strikes). Buttons are
  // dynamically rendered into [data-drawer-integrity], so we delegate the
  // click rather than binding once.
  if (drawerRoot) {
    drawerRoot.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== drawerRoot) {
        if (t.dataset && t.dataset.drawerUnfreeze !== undefined) {
          if (!currentPlayerId) return;
          if (!confirm('unfreeze this player? they will regain access immediately.')) return;
          fetch('/admin/api/player/' + currentPlayerId + '/unfreeze', {
            method: 'POST', credentials: 'same-origin',
          }).then(function (r) { return r.json(); })
            .then(function (j) {
              toast(j.ok ? 'player unfrozen' : 'unfreeze refused', j.ok ? 'amber' : 'warn');
              if (j.ok) openDrawer(currentPlayerId);
            }).catch(function (err) { toast('unfreeze failed: ' + err.message, 'warn'); });
          return;
        }
        if (t.dataset && t.dataset.drawerClearStrikes !== undefined) {
          if (!currentPlayerId) return;
          if (!confirm('clear cheat strikes for this player? unack rows will be marked acknowledged.')) return;
          fetch('/admin/api/player/' + currentPlayerId + '/clear-strikes', {
            method: 'POST', credentials: 'same-origin',
          }).then(function (r) { return r.json(); })
            .then(function (j) {
              toast(j.ok ? 'strikes cleared (' + j.strikesCleared + ')' : 'clear refused', j.ok ? 'amber' : 'warn');
              if (j.ok) openDrawer(currentPlayerId);
            }).catch(function (err) { toast('clear failed: ' + err.message, 'warn'); });
          return;
        }
        t = t.parentNode;
      }
    });
  }

  // Drawer skip
  var drawerSkip = $('[data-drawer-skip]');
  if (drawerSkip) {
    drawerSkip.addEventListener('click', function () {
      if (!currentPlayerId || !currentOrdinal) return;
      if (!confirm('skip stage ' + currentOrdinal + '?')) return;
      fetch('/admin/api/player/' + currentPlayerId + '/skip', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordinal: currentOrdinal }),
      }).then(function (r) { return r.json(); })
        .then(function (j) {
          toast(j.ok ? 'stage skipped · marked ⚠' : 'skip refused', j.ok ? 'amber' : 'warn');
          closeDrawer();
        })
        .catch(function (e) { toast('skip failed: ' + e.message, 'warn'); });
    });
  }

  // ── live feed polling ───────────────────────────────────────────────
  var feedList = $('[data-events-list]');
  if (feedList) {
    var lastId = Number(feedList.dataset.lastId || 0);
    function pollEvents() {
      fetch('/admin/api/events?since=' + lastId, { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (j) {
          if (!j.events || !j.events.length) return;
          j.events.forEach(function (e) {
            if (e.id <= lastId) return;
            lastId = e.id;
            var row = document.createElement('div');
            var kind = e.kind || 'attempt';
            var letter = (kind[0] || '?').toUpperCase();
            row.className = 'feed-row ' + kind + ' new';
            row.dataset.eventId = e.id;
            // Build with DOM APIs + textContent — event payload and alias are
            // attacker-influenced (e.g. inviter_alias_override flows verbatim
            // into invite_sent payload JSON), and innerHTML here would let
            // <img onerror> etc. execute in the admin origin.
            var t = document.createElement('span');
            t.className = 't';
            t.textContent = fmtTime(e.created_at);
            var k = document.createElement('span');
            k.className = 'k';
            k.textContent = letter;
            var body = document.createElement('span');
            body.className = 'body';
            var b = document.createElement('b');
            b.textContent = e.alias || '—';
            body.appendChild(b);
            body.appendChild(document.createTextNode(' ' + (e.payload || kind)));
            var delta = document.createElement('span');
            delta.className = 'delta';
            row.appendChild(t);
            row.appendChild(k);
            row.appendChild(body);
            row.appendChild(delta);
            feedList.insertBefore(row, feedList.firstChild);
          });
          // keep DOM bounded
          while (feedList.children.length > 200) feedList.removeChild(feedList.lastChild);
        })
        .catch(function () { /* swallow — next interval will retry */ });
    }
    setInterval(pollEvents, 5000);
  }

  // ── Email templates workspace (admin/players?tab=emails) ──────────
  // Each card carries data-template-key. The live preview renders the
  // current textarea contents against sample tokens via JS. The
  // [ preview ] button hits a server endpoint that renders against the
  // SAVED template (so it matches what real recipients see). The
  // [ send test ] button dispatches to the admin email.
  var templatesForm = document.querySelector('[data-templates-form]');
  if (templatesForm) {
    var SAMPLES = {
      recruit: {
        alias: 'trinity',
        magic_link: 'https://hack.example.com/auth?token=0xAF21-9C3D-EE77-04B2',
        expires_in: '15 min',
        subjectFallback: '[ZeroDay] transmission received — 15 min'
      },
      invite: {
        inviter_alias: 'morpheus',
        claim_link: 'https://hack.example.com/claim/zd_aZ12k3p9q5x_sample',
        expires_in: '72h',
        note: 'study group · two more from northridge',
        note_block: 'they wrote:\n  study group · two more from northridge\n\n'
      },
      accept_confirm: {
        alias: 'crash.overr',
        slot_number: '042',
        inviter_alias: 'morpheus',
        lobby_link: 'https://hack.example.com/'
      },
      request_received: {
        requester_alias: 'acid_burn',
        requester_email: 'a.burn@example.net',
        invitee_email: 'j.hartwell@example.com',
        reason: 'study group · two more from northridge',
        admin_link: 'https://hack.example.com/admin/players?tab=requests'
      },
      request_approved: {
        requester_alias: 'acid_burn',
        invitee_email: 'j.hartwell@example.com',
        note: 'approved · keep them on track',
        note_block: 'the admin wrote:\n  approved · keep them on track\n\n',
        lobby_link: 'https://hack.example.com/'
      },
      request_denied: {
        requester_alias: 'acid_burn',
        invitee_email: 'j.hartwell@example.com',
        note: 'cohort is at capacity for this trial window',
        lobby_link: 'https://hack.example.com/'
      },
      lobby_flavor: { cd: '02d 14h 33m' }
    };
    function renderTpl(tpl, tokens) {
      return (tpl || '').replace(/\{(\w+)\}/g, function (m, k) {
        return Object.prototype.hasOwnProperty.call(tokens, k) ? tokens[k] : m;
      });
    }
    function renderCard(card) {
      var key = card.getAttribute('data-template-key');
      var tokens = SAMPLES[key] || {};
      var subjEl = card.querySelector('[data-template-input="subject"]');
      var bodyEl = card.querySelector('[data-template-input="body"]');
      var outSubj = card.querySelector('[data-template-subject]');
      var outBody = card.querySelector('[data-template-body]');
      if (outSubj) {
        var tpl = subjEl ? subjEl.value : (tokens.subjectFallback || '');
        outSubj.textContent = renderTpl(tpl, tokens);
      }
      if (outBody && bodyEl) {
        outBody.textContent = renderTpl(bodyEl.value, tokens);
      }
    }
    var cards = templatesForm.querySelectorAll('[data-template-card]');
    cards.forEach(function (card) {
      renderCard(card);
      var inputs = card.querySelectorAll('[data-template-input]');
      inputs.forEach(function (el) {
        el.addEventListener('input', function () { renderCard(card); });
      });
    });

    // Server-rendered preview modal.
    var modal = document.querySelector('[data-template-modal]');
    function openModal(payload, key) {
      if (!modal) return;
      var keyEl = modal.querySelector('[data-template-modal-key]');
      var fromEl = modal.querySelector('[data-template-modal-from]');
      var toEl = modal.querySelector('[data-template-modal-to]');
      var subjEl = modal.querySelector('[data-template-modal-subject]');
      var bodyEl = modal.querySelector('[data-template-modal-body]');
      if (keyEl) keyEl.textContent = key;
      if (fromEl) fromEl.textContent = payload.from || '—';
      if (toEl) toEl.textContent = payload.to || '—';
      if (subjEl) subjEl.textContent = payload.subject || '—';
      if (bodyEl) bodyEl.textContent = payload.body || '—';
      modal.style.display = 'flex';
    }
    function closeModal() { if (modal) modal.style.display = 'none'; }
    if (modal) {
      var closeBtn = modal.querySelector('[data-template-modal-close]');
      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeModal();
      });
    }

    function setStatus(card, text, cls) {
      var el = card.querySelector('[data-template-status]');
      if (!el) return;
      el.textContent = text;
      el.className = 'dim';
      if (cls) el.classList.add(cls);
      el.style.fontSize = '10.5px';
      el.style.letterSpacing = '0.04em';
    }

    cards.forEach(function (card) {
      var key = card.getAttribute('data-template-key');
      var previewBtn = card.querySelector('[data-template-preview]');
      var sendBtn = card.querySelector('[data-template-test-send]');
      if (previewBtn && key !== 'lobby_flavor') {
        previewBtn.addEventListener('click', function () {
          setStatus(card, 'rendering…', null);
          fetch('/admin/players/templates/preview?key=' + encodeURIComponent(key), {
            credentials: 'same-origin'
          })
            .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
            .then(function (data) { setStatus(card, '', null); openModal(data, key); })
            .catch(function (e) { setStatus(card, 'preview failed · ' + e.message, 'warn'); });
        });
      } else if (previewBtn && key === 'lobby_flavor') {
        // Lobby flavor isn't an email — server preview not relevant.
        previewBtn.style.display = 'none';
      }
      if (sendBtn) {
        sendBtn.addEventListener('click', function () {
          if (sendBtn.hasAttribute('disabled')) return;
          // URLSearchParams sets content-type to application/x-www-form-urlencoded
          // automatically; that's the only body parser registered on the server
          // (FormData would send multipart/form-data and arrive as an empty body).
          var body = new URLSearchParams();
          body.append('key', key);
          setStatus(card, 'sending…', null);
          fetch('/admin/players/templates/test-send', {
            method: 'POST', credentials: 'same-origin', body: body
          })
            .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
            .then(function (res) {
              if (res.body && res.body.ok) {
                setStatus(card, '✓ sent to ' + res.body.to + ' via ' + res.body.provider, null);
              } else {
                setStatus(card, '! ' + (res.body && res.body.error ? res.body.error : 'send failed'), 'warn');
              }
            })
            .catch(function (e) { setStatus(card, 'network error · ' + e.message, 'warn'); });
        });
      }
    });
  }
})();
