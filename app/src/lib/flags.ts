// Per-(user, challenge) flag generator. HMAC over user.flag_salt + FLAG_SECRET +
// challenge id, base32-ish encoded, wrapped in ZERODAY{...}.
//
// Sharing a flag does NOT share access — user A's flag for challenge N will not
// validate for user B because their flag_salt differs.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { User } from './playerAuth.js';

const SECRET = process.env.FLAG_SECRET ?? 'dev-flag-secret-change-me';

export function generateFlag(user: Pick<User, 'flag_salt'>, challengeId: string): string {
  const h = createHmac('sha256', SECRET);
  h.update(user.flag_salt);
  h.update('|');
  h.update(challengeId);
  // Take 12 bytes → 24 hex chars; uppercase for that retro CTF feel.
  const hex = h.digest('hex').slice(0, 24).toUpperCase();
  return `ZERODAY{${hex}}`;
}

export function verifyFlag(user: Pick<User, 'flag_salt'>, challengeId: string, submitted: string): boolean {
  const expected = generateFlag(user, challengeId);
  const a = Buffer.from(expected);
  const b = Buffer.from(submitted.trim());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
