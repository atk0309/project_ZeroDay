// Challenge 18 helpers — ghost-shell. mitnick.example.com.
//
// Per-player secret derivation + cheat-detect scan. The puzzle plants a
// fake-employee roster on /staff; each player's personal target leaks via the
// avatar `alt` attribute on exactly one row. Submitting *another* player's
// secret triggers the same two-strikes flow as flag-sharing.
//
// Why this differs from #16's shared-canonical pattern: the user wants
// secret-sharing detectable, which means the secret has to be unique per
// player. Per-player flag isolation (lib/flags.ts) is unchanged — the flag
// HMAC keeps its own scope.

import { createHmac } from 'node:crypto';
import { db } from '../db/index.js';
import type { User } from './playerAuth.js';

const SECRET = process.env.FLAG_SECRET ?? 'dev-flag-secret-change-me';

// Curated single-token handles. 32 phreaker/hacker-history handles + 32
// Ghost-in-the-Shell / cyberpunk handles — picks a flavor that lands for
// either reference culture. Lowercase ASCII letters only, no separators
// inside one entry (the secret format uses `-` as the separator, so handles
// can't contain hyphens).
export const HANDLES: readonly string[] = [
  // phreakers, l0pht, LoD/MoD, Hackers (1995), real-world ops
  'condor', 'phiber', 'optik', 'mendax', 'mafiaboy', 'mudge', 'dildog', 'kingpin',
  'bloodaxe', 'lex', 'crunch', 'draper', 'woz', 'dante', 'darkdante', 'shadowhawk',
  'lightning', 'neidorf', 'dade', 'razor', 'blade', 'acidburn', 'cereal', 'plague',
  'nikon', 'lordnikon', 'zerocool', 'crashoverride', 'mouse', 'joey', 'knight', 'jolly',
  // Ghost in the Shell, Neuromancer, the Matrix — cyberpunk-canon callsigns
  'motoko', 'kusanagi', 'batou', 'togusa', 'aramaki', 'ishikawa', 'saito', 'pazu',
  'borma', 'tachikoma', 'laughingman', 'puppetmaster', 'neo', 'trinity', 'morpheus', 'cypher',
  'tank', 'dozer', 'apoc', 'dixie', 'wintermute', 'molly', 'chiba', 'armitage',
  'corto', 'straylight', 'lain', 'iwakura', 'riviera', 'finn', 'pauley', 'ratz',
] as const;

if (HANDLES.length !== 64) {
  throw new Error(`HANDLES must have 64 entries (has ${HANDLES.length}); secret derivation depends on 6-bit indexing.`);
}

// Eight fixed decoy roster entries, identical for every player. The player's
// personal row is rendered as a ninth row alongside these.
export const DECOY_ROSTER: readonly { handle: string; role: string; era: string }[] = [
  { handle: 'gibson',     role: 'mainframe ops',         era: '88-92'  },
  { handle: 'silicon',    role: 'switch tech',           era: '85-89'  },
  { handle: 'turing',     role: 'crypto liaison',        era: '90-95'  },
  { handle: 'eniac',      role: 'records intake',        era: '83-87'  },
  { handle: 'altair',     role: 'comms relay',           era: '86-91'  },
  { handle: 'commodore',  role: 'desktop support',       era: '87-93'  },
  { handle: 'minitel',    role: 'foreign desk',          era: '89-94'  },
  { handle: 'arpanet',    role: 'archives',              era: '82-88'  },
];

// Derives a deterministic per-player secret. The HMAC scope here uses a
// distinct separator string from generateFlag (lib/flags.ts) so the same
// FLAG_SECRET can never produce a flag/secret collision for the same user.
//
//   format: <handle>-<NNNNNN>
//   handle: HANDLES[h[0..3] uint32 BE % 64]
//   NNNNNN: h[4..7] uint32 BE % 1_000_000, zero-padded
//
// Why 6-digit suffix (64 * 1M ≈ 64M space): keeps birthday-bound collisions
// operationally negligible for any plausible cohort size — at 1000 ops the
// expected pair-collision count is ~0.008. Without this headroom
// detectGhostSupplier could mis-attribute a shared submission to whichever
// colliding user the scan returned first, striking an innocent supplier.
export function secretForUser(user: Pick<User, 'flag_salt'>): string {
  const h = createHmac('sha256', SECRET);
  h.update(user.flag_salt);
  h.update('|ghost-shell-secret');
  const digest = h.digest();
  const handleIdx = digest.readUInt32BE(0) % HANDLES.length;
  const suffix = digest.readUInt32BE(4) % 1_000_000;
  return `${HANDLES[handleIdx]}-${suffix.toString().padStart(6, '0')}`;
}

// Loose shape gate for the cheat scan — keeps random gibberish off the
// user-iteration path, mirroring the spirit of cheatDetect.ts's flag-shape
// fast-fail (invariant #12). Allows up to 16 chars in the handle slot for
// future-proofing.
const SECRET_SHAPE = /^[a-z0-9]{3,16}-\d{6}$/;

const otherUsers = db.prepare(`SELECT id, alias, flag_salt FROM users WHERE id != ?`);

export interface GhostSupplier {
  supplierId: number;
  supplierAlias: string;
}

// Reverse-scan: find the user whose secretForUser equals `submitted`. Returns
// null on no match. Used by the ghost-shell handler to detect secret-sharing.
//
// This is a sibling to lib/cheatDetect.ts:detectFlagSupplier with two
// differences: (a) different shape gate (no ZERODAY{...} wrapper); (b)
// equality is plain string compare, not timing-safe — the secret is an
// OSINT-discoverable label, not a credential, so timing leaks nothing
// meaningful.
export function detectGhostSupplier(consumerId: number, submitted: string): GhostSupplier | null {
  const trimmed = submitted.trim().toLowerCase();
  if (!SECRET_SHAPE.test(trimmed)) return null;

  const rows = otherUsers.all(consumerId) as Pick<User, 'id' | 'alias' | 'flag_salt'>[];
  for (const u of rows) {
    if (secretForUser(u) === trimmed) {
      return { supplierId: u.id, supplierAlias: u.alias };
    }
  }
  return null;
}
