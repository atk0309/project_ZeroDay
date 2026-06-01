// Daily 09:00 cron: surfaces stuck players to the admin queue.
// Does NOT auto-send — admin reviews and clicks "send" on the dashboard.
// Skips outside `live` phase.

import cron from 'node-cron';
import { db } from '../db/index.js';
import { phase } from '../lib/phase.js';

const stuck = db.prepare(`
  SELECT u.id, u.alias, p.current_ordinal,
         (julianday('now') - julianday(p.last_advance_at)) * 24 AS hours_stuck
  FROM users u JOIN user_progress p ON p.user_id = u.id
  WHERE u.verified_at IS NOT NULL AND p.completed_at IS NULL
    AND (julianday('now') - julianday(p.last_advance_at)) * 24 > 20
`);

export function startDripCron() {
  cron.schedule('0 9 * * *', () => {
    if (phase() !== 'live') return;
    const rows = stuck.all() as { id: number; alias: string; current_ordinal: number; hours_stuck: number }[];
    if (rows.length === 0) return;
    db.prepare(`INSERT INTO events (kind, payload) VALUES (?, ?)`).run(
      'drip_queued',
      JSON.stringify({ count: rows.length, sample: rows.slice(0, 5) })
    );
  });
}

// Exposed for tests.
export function _stuckCandidates() {
  return stuck.all();
}
