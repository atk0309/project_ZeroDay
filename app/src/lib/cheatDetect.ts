// Flag-supplier reverse lookup. Used by the submit handler on a wrong submit
// to figure out whether the wrong flag actually belongs to *another*
// operator (i.e. someone shared their flag).
//
// Cheap path: fast-fail on shape — `ZERODAY{[A-F0-9]{24}}`. 99% of wrong
// submits are random gibberish or partially-typed and get rejected without
// touching the DB.
//
// Expensive path (only on shape-matching wrongs): iterate all users and run
// the existing timing-safe `verifyFlag` for each. At realistic operator
// counts this is microseconds per submit.

import { db } from '../db/index.js';
import { verifyFlag } from './flags.js';
import type { User } from './playerAuth.js';

const FLAG_SHAPE = /^ZERODAY\{[A-F0-9]{24}\}$/;

const otherUsers = db.prepare(`SELECT id, alias, flag_salt FROM users WHERE id != ?`);

export interface FlagSupplier {
  supplierId: number;
  supplierAlias: string;
}

export function detectFlagSupplier(
  submitted: string,
  challengeId: string,
  excludeUserId: number,
): FlagSupplier | null {
  const trimmed = submitted.trim();
  if (!FLAG_SHAPE.test(trimmed)) return null;

  const rows = otherUsers.all(excludeUserId) as Pick<User, 'id' | 'alias' | 'flag_salt'>[];
  for (const u of rows) {
    if (verifyFlag(u, challengeId, trimmed)) {
      return { supplierId: u.id, supplierAlias: u.alias };
    }
  }
  return null;
}
