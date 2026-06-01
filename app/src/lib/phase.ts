// D-Day phase machine. Reads launch_at and end_at from app_settings.
// Phase drives ALL player-facing routing decisions:
//   uninitialized → friendly "system offline", only /admin works
//   prelaunch     → lobby with countdown, no challenges
//   live          → hub + sequential challenges
//   frozen        → leaderboard read-only, GIBSON locked

import * as settings from './settings.js';

export type Phase = 'uninitialized' | 'prelaunch' | 'live' | 'frozen';

export interface PhaseState {
  phase: Phase;
  launchAt: Date | null;
  endAt: Date | null;
  now: Date;
}

function parseDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function phaseState(now: Date = new Date()): PhaseState {
  const launchAt = parseDate(settings.get('launch_at'));
  const endAt = parseDate(settings.get('end_at'));
  if (!launchAt || !endAt) return { phase: 'uninitialized', launchAt, endAt, now };
  if (now < launchAt) return { phase: 'prelaunch', launchAt, endAt, now };
  if (now < endAt) return { phase: 'live', launchAt, endAt, now };
  return { phase: 'frozen', launchAt, endAt, now };
}

export function phase(now?: Date): Phase {
  return phaseState(now).phase;
}
