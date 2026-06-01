// GIBSON key fragments. Three 16-hex-char halves combine into a 48-hex (24-byte)
// AES-192 key that the final challenge (#19, hack-the-planet) reconstructs and
// uses to decrypt a payload.
//
// Authoring contract: the handlers for #7 (matryoshka), #13 (ports-of-call), and
// #17 (stego-static) each surface ONE fragment to the player on solve. The
// player is expected to remember/note the fragments and paste all three into
// #19's reconstruction prompt. The constants live here so #19 (future PR) reads
// the same canonical values that the embedding handlers serve.

import { challenges, type ChallengeMeta } from '../challenges/registry.js';

export type GibsonKeyPart = 1 | 2 | 3;

export const GIBSON_KEY_PARTS: Record<GibsonKeyPart, string> = {
  1: 'A1B2C3D4E5F60718',  // 16 hex (8 bytes) — wired by #7 matryoshka
  2: '9E7B5C3A11D22F08',  // 16 hex (8 bytes) — wired by #13 ports-of-call
  3: 'D3FACEB14C0DE5A1', // 16 hex (8 bytes) — wired by #17 stego-static
};

// A part is "wired" when its value is a real 16-hex string, not the
// __PLACEHOLDER_KN__ sentinel left in the table for parts not yet authored.
export function isKeyPartWired(n: GibsonKeyPart): boolean {
  return /^[0-9A-Fa-f]{16}$/.test(GIBSON_KEY_PARTS[n]);
}

export interface GibsonKeyPartStatus {
  n: GibsonKeyPart;
  wired: boolean;
  ordinal: number | null;
  challengeId: string | null;
}

export interface GibsonKeyStatus {
  total: number;
  wired: number;
  parts: GibsonKeyPartStatus[];
  pendingOrdinals: number[];
  wiredOrdinals: number[];
}

// Computed snapshot of GIBSON key wiring, joined against the challenge registry
// via the `embedsKeyPart` field. The /admin/setup review panel reads this so
// the "N of 3 wired" line stays in sync with the constants and the registry —
// no human edits required when a placeholder gets filled in.
export function gibsonKeyStatus(): GibsonKeyStatus {
  const parts: GibsonKeyPartStatus[] = ([1, 2, 3] as GibsonKeyPart[]).map((n) => {
    const meta: ChallengeMeta | undefined = challenges.find((c) => c.embedsKeyPart === n);
    return {
      n,
      wired: isKeyPartWired(n),
      ordinal: meta?.ordinal ?? null,
      challengeId: meta?.id ?? null,
    };
  });
  const wired = parts.filter((p) => p.wired).length;
  const pendingOrdinals = parts
    .filter((p) => !p.wired && p.ordinal !== null)
    .map((p) => p.ordinal as number);
  const wiredOrdinals = parts
    .filter((p) => p.wired && p.ordinal !== null)
    .map((p) => p.ordinal as number);
  return { total: parts.length, wired, parts, pendingOrdinals, wiredOrdinals };
}

// CRT-styled HTML fragment for embedding the key part in a challenge solve
// page. Returns just the inner block — the caller wraps with their own page
// chrome.
export function renderKeyFragment(n: GibsonKeyPart): string {
  return `<div class="gibson-fragment" style="margin:1.4rem 0;padding:.8rem 1rem;border:1px dashed #9cf;background:#001a26;color:#9cf;font-family:'Courier New',monospace;">
  <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#5a8;">gibson key fragment ${n} of 3</div>
  <div style="margin-top:.4rem;font-size:1.1rem;letter-spacing:.06em;color:#fff;">${GIBSON_KEY_PARTS[n]}</div>
  <div style="margin-top:.4rem;font-size:11px;color:#688;">memorize this. you will need all three at the planet.</div>
</div>`;
}
