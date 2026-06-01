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

  // The typewriter lines are authored as tiny HTML snippets (only
  // <span class="…"> styling — see the line arrays in recruit-*.ejs) so the
  // phosphor colour classes carry through. The dynamic parts (operator alias /
  // email) are already entity-escaped server-side before they reach the JSON,
  // but we never hand any of that text to innerHTML: each line is parsed in a
  // detached document and rebuilt with createElement + textContent, allowing
  // only <span> and its class attribute. Anything else — other tags,
  // event-handler attributes, <script>, <img onerror=…> — is dropped, so a
  // styled snippet renders while injected markup cannot execute. This keeps
  // the path off the innerHTML sink that CodeQL flags as "DOM text
  // reinterpreted as HTML" (cf. web/static/admin.js, which does the same with
  // createElement/textContent for the live feed).
  const ALLOWED_TAGS = { SPAN: true };

  function appendSafeNodes(target, sourceNode) {
    const kids = sourceNode.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (n.nodeType === 3) {
        // Text node: insert verbatim, never parsed as markup.
        target.appendChild(document.createTextNode(n.nodeValue));
      } else if (n.nodeType === 1 && ALLOWED_TAGS[n.tagName]) {
        const span = document.createElement('span');
        const cls = n.getAttribute('class');
        if (cls) span.setAttribute('class', cls);
        appendSafeNodes(span, n); // recurse so nested styled spans survive
        target.appendChild(span);
      } else if (n.nodeType === 1) {
        // Disallowed element: drop the tag + attributes, keep its text only.
        appendSafeNodes(target, n);
      }
    }
  }

  // Replace target's content with a sanitized render of `html`.
  //
  // DOMParser.parseFromString produces a *detached, inert* document: scripts
  // never execute and event-handler attributes never fire because the result
  // is not part of the live DOM. We never adopt the parsed nodes either —
  // appendSafeNodes walks that inert tree and rebuilds the visible subset from
  // scratch with createElement/createTextNode, copying across only <span> and
  // its class attribute. So even a hostile string (e.g. an alias that somehow
  // dodged the server-side escaping and arrived as raw `<img onerror=…>`) is
  // parsed into a node that is simply *dropped*, never reinterpreted as live HTML.
  //
  // CodeQL's js/xss-through-dom models parseFromString itself as an HTML sink
  // and so still flags the line below. That is a true positive in shape but a
  // false positive in risk: parseFromString is the *recommended* safe way to
  // parse untrusted HTML, and the whitelist rebuild above is the real barrier.
  // Suppressed inline rather than reaching for innerHTML — the genuinely unsafe
  // sink this whole helper exists to avoid.
  function renderSafeHtml(target, html) {
    target.textContent = '';
    const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html'); // codeql[js/xss-through-dom] -- parsed into an inert document, then whitelist-rebuilt (span+class only); injected markup is dropped, never live. See note above.
    appendSafeNodes(target, parsed.body);
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
