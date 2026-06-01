// ZeroDay recruit flow — vanilla JS
//   - TypedBlock: types out lines from data-lines (JSON array of HTML strings).
//   - boot stage on the post-pill screen; reveals the email card on done.
//   - goodbye-memory: tracks visit count in localStorage and swaps copy.

(function () {
  const GOODBYE_KEY = 'zeroday_goodbye_visits';

  function readLines(el) {
    const raw = el.getAttribute('data-lines') || '[]';
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (_e) {
      return [];
    }
  }

  // The typewriter lines are authored as tiny HTML snippets — only
  // <span class="…"> styling, see the line arrays in recruit-*.ejs — so the
  // phosphor colour classes carry through. The dynamic parts (operator alias /
  // email) are already entity-escaped server-side before they reach the JSON,
  // but we never feed any of that text to an HTML parser. renderSafeHtml below
  // scans the snippet by hand and builds the DOM with createElement /
  // createTextNode / setAttribute('class', …) only — no innerHTML, no
  // DOMParser, no insertAdjacentHTML. <span> open/close tags become real
  // spans; every other tag is dropped (its inner text survives as a plain text
  // node, so it can never execute); all text is entity-decoded through a fixed
  // table. There is therefore no "DOM text reinterpreted as HTML" sink for an
  // attacker to reach — that is both the security property and why CodeQL's
  // js/xss-through-dom no longer fires here (cf. web/static/admin.js, which
  // likewise builds its live feed from createElement/textContent).

  // The recruit lore only uses these, and the server-side escaper emits only
  // the five XML entities, so a fixed table is sufficient and predictable.
  const ENTITIES = {
    '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"',
    '&#39;': "'", '&apos;': "'", '&nbsp;': ' '
  };
  function decodeEntities(s) {
    return s.replace(/&(?:lt|gt|amp|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] || m);
  }

  function appendText(parent, raw) {
    if (raw) parent.appendChild(document.createTextNode(decodeEntities(raw)));
  }

  function classOf(attrs) {
    const m = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    if (!m) return null;
    return decodeEntities(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]);
  }

  // Replace target's content with a safe render of `html`. The snippet is
  // walked left-to-right: text runs become text nodes, <span> tags push/pop
  // real elements, and any other tag is skipped (keeping only its text).
  // Partial input from the per-char typewriter is tolerated — an unterminated
  // trailing tag is simply dropped, matching the old innerHTML behaviour.
  function renderSafeHtml(target, html) {
    target.textContent = '';
    const src = String(html || '');
    const stack = [target];
    let i = 0;
    while (i < src.length) {
      const lt = src.indexOf('<', i);
      if (lt === -1) {
        appendText(stack[stack.length - 1], src.slice(i));
        break;
      }
      if (lt > i) appendText(stack[stack.length - 1], src.slice(i, lt));
      const gt = src.indexOf('>', lt);
      if (gt === -1) break; // unterminated tag at end of a partial slice → drop it
      const tag = src.slice(lt, gt + 1);
      const m = /^<\s*(\/?)\s*span\b([^>]*)>$/i.exec(tag);
      if (m && m[1]) {
        if (stack.length > 1) stack.pop(); // </span>
      } else if (m) {
        const span = document.createElement('span');
        const cls = classOf(m[2]);
        if (cls) span.setAttribute('class', cls);
        stack[stack.length - 1].appendChild(span);
        stack.push(span);
      }
      // Non-span tags fall through: dropped, their following text stays text.
      i = gt + 1;
    }
    if (!target.firstChild) target.appendChild(document.createTextNode(' '));
  }

  // Type one block of lines. Each line is an HTML snippet; rendered through
  // renderSafeHtml (whitelist of <span class="…">) so the design's phosphor
  // styling carries through without ever touching innerHTML.
  function runTypedBlock(host, opts = {}) {
    const lines = readLines(host);
    const speed = Number(host.dataset.speed) || opts.speed || 22;
    const lineDelay = Number(host.dataset.lineDelay) || opts.lineDelay || 200;
    const startDelay = Number(host.dataset.startDelay) || opts.startDelay || 0;

    host.textContent = '';
    const completedHolder = document.createElement('div');
    completedHolder.className = 'typed-completed';
    const currentHolder = document.createElement('div');
    currentHolder.className = 'typed-current';
    const currentSpan = document.createElement('span');
    const caret = document.createElement('span');
    caret.className = 'caret-slim';
    currentHolder.appendChild(currentSpan);
    currentHolder.appendChild(caret);
    host.appendChild(completedHolder);
    host.appendChild(currentHolder);

    let cancelled = false;
    let currentLine = 0;
    let charIdx = 0;
    let timer = null;

    function done() {
      if (cancelled) return;
      cancelled = true;
      currentHolder.remove();
      host.dispatchEvent(new CustomEvent('typedblock:done', { bubbles: true }));
    }

    function commitLine(text) {
      const div = document.createElement('div');
      renderSafeHtml(div, text);
      completedHolder.appendChild(div);
    }

    function tickLine() {
      if (cancelled) return;
      const text = lines[currentLine] || '';
      if (charIdx <= text.length) {
        renderSafeHtml(currentSpan, text.slice(0, charIdx));
        charIdx++;
        timer = setTimeout(tickLine, speed);
      } else {
        commitLine(text);
        currentSpan.textContent = ' ';
        currentLine++;
        charIdx = 0;
        if (currentLine >= lines.length) {
          done();
        } else {
          timer = setTimeout(tickLine, lineDelay);
        }
      }
    }

    function fastForward() {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      while (currentLine < lines.length) {
        commitLine(lines[currentLine]);
        currentLine++;
      }
      done();
    }

    timer = setTimeout(tickLine, startDelay);
    return { fastForward };
  }

  function initTypedBlocks() {
    document.querySelectorAll('.typed-block').forEach((el) => {
      if (el.dataset.typed === '1') return;
      if (el.dataset.noAuto === '1') return;
      el.dataset.typed = '1';
      runTypedBlock(el);
    });
  }

  // ── Boot → email transition ─────────────────────────────────
  function initBootStage() {
    const root = document.querySelector('[data-flow="boot-email"]');
    if (!root) return;
    const bootStage = root.querySelector('.boot-stage');
    const emailStage = root.querySelector('.email-stage');
    const skipBtn = root.querySelector('[data-skip="boot"]');
    const chromeHostBoot = root.querySelector('[data-chrome="boot"]');
    const chromeHostInbox = root.querySelector('[data-chrome="inbox"]');
    const typed = bootStage && bootStage.querySelector('.typed-block');
    if (!typed) return;

    typed.dataset.typed = '1';
    const ctrl = runTypedBlock(typed);
    typed.addEventListener('typedblock:done', () => {
      if (skipBtn) skipBtn.style.display = 'none';
      if (bootStage) bootStage.classList.add('is-hidden');
      if (emailStage) {
        emailStage.classList.remove('is-hidden');
        emailStage.classList.add('fade-in');
      }
      if (chromeHostBoot) chromeHostBoot.classList.add('is-hidden');
      if (chromeHostInbox) chromeHostInbox.classList.remove('is-hidden');
      startEmailCountdown(root);
    });

    if (skipBtn) {
      skipBtn.addEventListener('click', () => ctrl.fastForward());
    }
  }

  function startEmailCountdown(root) {
    const target = root.querySelector('[data-countdown]');
    if (!target) return;
    let total = Number(target.dataset.countdown) || 15 * 60;
    function tick() {
      const mm = String(Math.floor(total / 60)).padStart(2, '0');
      const ss = String(total % 60).padStart(2, '0');
      root.querySelectorAll('[data-countdown-out]').forEach((el) => {
        el.textContent = mm + ':' + ss;
      });
      if (total <= 0) {
        clearInterval(handle);
        return;
      }
      total -= 1;
    }
    tick();
    const handle = setInterval(tick, 1000);
  }

  // ── Goodbye memory ─────────────────────────────────────────
  function initGoodbye() {
    const root = document.querySelector('[data-flow="goodbye"]');
    if (!root) return;
    let n = parseInt(localStorage.getItem(GOODBYE_KEY) || '0', 10);
    if (!Number.isFinite(n) || n < 0) n = 0;
    n += 1;
    localStorage.setItem(GOODBYE_KEY, String(n));

    const visitBadge = root.querySelector('[data-visit-badge]');
    if (visitBadge) visitBadge.textContent = '#' + String(n).padStart(3, '0');

    const variants = root.querySelectorAll('[data-visit]');
    let chosen = null;
    variants.forEach((el) => {
      const range = el.dataset.visit;
      const matches =
        (range === '1' && n === 1) ||
        (range === '2' && n === 2) ||
        (range === '3+' && n >= 3);
      if (matches && !chosen) {
        chosen = el;
        el.classList.remove('is-hidden');
      } else {
        el.classList.add('is-hidden');
      }
    });
    if (!chosen) return;

    const typed = chosen.querySelector('.typed-block');
    if (typed) {
      typed.dataset.typed = '1';
      runTypedBlock(typed);
      typed.addEventListener('typedblock:done', () => {
        const actions = root.querySelector('[data-goodbye-actions="' + (n >= 2 ? 'returning' : 'first') + '"]');
        if (actions) {
          actions.classList.remove('is-hidden');
          actions.classList.add('fade-in');
        }
      });
    }

    const forgetBtn = root.querySelector('[data-action="forget"]');
    if (forgetBtn) {
      forgetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        localStorage.removeItem(GOODBYE_KEY);
        if (visitBadge) visitBadge.textContent = '#000';
        forgetBtn.disabled = true;
        forgetBtn.textContent = '[ forgotten ]';
      });
    }
  }

  // ── Form-input gating: enable [ jack in ] only when valid ──
  function initFormGate() {
    document.querySelectorAll('[data-gate-form]').forEach((form) => {
      const submit = form.querySelector('button[type=submit]');
      if (!submit) return;
      function check() {
        submit.disabled = !form.checkValidity();
      }
      form.addEventListener('input', check);
      check();
    });
  }

  function init() {
    initBootStage();
    initGoodbye();
    initTypedBlocks();
    initFormGate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
