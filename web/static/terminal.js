// Countdown ticker. Reads data-target ISO from #countdown.
// Uses Date.now() each tick (not raw setInterval count) so tab-suspend doesn't drift.
(function () {
  const cd = document.getElementById('countdown');
  if (!cd) return;
  const target = cd.dataset.target;
  if (!target) return;
  const targetMs = new Date(target).getTime();
  if (!Number.isFinite(targetMs)) return;

  const slots = {
    d: cd.querySelector('[data-cd="d"]'),
    h: cd.querySelector('[data-cd="h"]'),
    m: cd.querySelector('[data-cd="m"]'),
    s: cd.querySelector('[data-cd="s"]'),
  };
  const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

  function tick() {
    const ms = targetMs - Date.now();
    if (ms <= 0) {
      // Phase rollover — reload to let server re-render.
      window.location.reload();
      return;
    }
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (slots.d) slots.d.textContent = pad(d);
    if (slots.h) slots.h.textContent = pad(h);
    if (slots.m) slots.m.textContent = pad(m);
    if (slots.s) slots.s.textContent = pad(s);
    if (cd.dataset.phase === 'live' && ms < 24 * 3600 * 1000) cd.classList.add('urgent');
  }
  tick();
  setInterval(tick, 1000);
})();

// Live leaderboard polling.
(function () {
  const board = document.getElementById('leaderboard-body');
  if (!board) return;
  async function refresh() {
    try {
      const r = await fetch('/api/leaderboard');
      if (!r.ok) return;
      const data = await r.json();
      const html = data.rows.map((row) => {
        const skip = row.admin_skips > 0 ? ' <span class="warn">⚠</span>' : '';
        const stage = row.stage ?? 1;
        return `<tr><td>${escape(row.alias)}${skip}</td>
          <td>${stage}/${data.total}</td>
          <td>${row.points || 0}</td>
          <td>${row.hints || 0}</td>
          <td>${row.last_advance_at ?? ''}</td></tr>`;
      }).join('');
      board.innerHTML = html;
    } catch (e) { /* swallow */ }
  }
  function escape(s) {
    return String(s).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }
  refresh();
  setInterval(refresh, 10_000);
})();

// Lobby fake-log ticker.
(function () {
  const log = document.getElementById('lobby-log');
  if (!log) return;
  const lines = JSON.parse(log.dataset.lines || '[]');
  if (!Array.isArray(lines) || lines.length === 0) return;
  let i = 0;
  function emit() {
    const line = document.createElement('div');
    line.textContent = lines[i % lines.length].split('{cd}').join(randCount());
    line.classList.add('flicker');
    log.appendChild(line);
    while (log.children.length > 12) log.removeChild(log.firstChild);
    i++;
  }
  function randCount() {
    const m = 60 + Math.floor(Math.random() * 60);
    const s = Math.floor(Math.random() * 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  emit();
  setInterval(emit, 1800 + Math.random() * 1800);
})();
