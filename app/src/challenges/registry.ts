// The single source of truth for the 19 challenges. Order = play order.
// Each challenge's individual handler module is imported in index.ts.

export interface ChallengeMeta {
  id: string;
  ordinal: number;
  title: string;
  category: 'Entry' | 'Web' | 'Crypto' | 'Net' | 'Logic' | 'Meta' | 'OSINT' | 'Final';
  points: number;
  subdomain: string;
  embedsKeyPart?: 1 | 2 | 3; // GIBSON key fragments
}

export const challenges: ChallengeMeta[] = [
  { id: 'white-rabbit',      ordinal:  1, title: 'Follow the white rabbit',  category: 'Entry',  points:  10, subdomain: 'example.com' },
  { id: 'no-spoon',          ordinal:  2, title: 'There is no spoon',         category: 'Entry',  points:  10, subdomain: 'hack.example.com' },
  { id: 'caesars-ghost',     ordinal:  3, title: "Caesar's ghost",            category: 'Crypto', points:  15, subdomain: 'oracle.example.com' },
  { id: 'cookie-flip',       ordinal:  4, title: "Zero Cool's cookie",        category: 'Web',    points:  20, subdomain: 'zero.example.com' },
  { id: 'headers',           ordinal:  5, title: "The headers don't lie",     category: 'Web',    points:  20, subdomain: 'zero.example.com' },
  { id: 'dns-whispers',      ordinal:  6, title: 'DNS whispers',              category: 'Net',    points:  20, subdomain: 'wopr.example.com' },
  { id: 'matryoshka',        ordinal:  7, title: 'Matryoshka',                category: 'Crypto', points:  25, subdomain: 'oracle.example.com', embedsKeyPart: 1 },
  { id: 'gibson-404',        ordinal:  8, title: "Gibson's 404",              category: 'Web',    points:  25, subdomain: 'gibson.example.com' },
  { id: 'client-cinema',     ordinal:  9, title: 'Client-side cinema',        category: 'Web',    points:  30, subdomain: 'zero.example.com' },
  { id: 'method-madness',    ordinal: 10, title: 'Method in the madness',     category: 'Net',    points:  30, subdomain: 'wopr.example.com' },
  { id: 'regex-runes',       ordinal: 11, title: 'Regex runes',               category: 'Logic',  points:  30, subdomain: 'oracle.example.com' },
  { id: 'xor-oracle',        ordinal: 12, title: 'XOR with the oracle',       category: 'Crypto', points:  35, subdomain: 'oracle.example.com' },
  { id: 'ports-of-call',     ordinal: 13, title: 'Ports of call',             category: 'Net',    points:  35, subdomain: 'wopr.example.com', embedsKeyPart: 2 },
  { id: 'shall-we-play',     ordinal: 14, title: 'Shall we play a game?',     category: 'Logic',  points:  35, subdomain: 'wopr.example.com' },
  { id: 'crack-wopr',        ordinal: 15, title: 'Crack the WOPR',            category: 'Crypto', points:  40, subdomain: 'wopr.example.com' },
  { id: 'git-archaeology',   ordinal: 16, title: 'Git archaeology',           category: 'Logic',  points:  40, subdomain: 'hack.example.com' },
  { id: 'stego-static',      ordinal: 17, title: 'Stego in the static',       category: 'Meta',   points:  50, subdomain: 'example.com',      embedsKeyPart: 3 },
  { id: 'ghost-shell',       ordinal: 18, title: 'Ghost in the shell',        category: 'OSINT',  points:  50, subdomain: 'mitnick.example.com' },
  { id: 'hack-the-planet',   ordinal: 19, title: 'Hack the planet',           category: 'Final',  points: 150, subdomain: 'gibson.example.com' },
];

export function totalChallenges(): number {
  return challenges.length;
}

export function challengeByOrdinal(n: number): ChallengeMeta | undefined {
  return challenges.find((c) => c.ordinal === n);
}

export function challengeById(id: string): ChallengeMeta | undefined {
  return challenges.find((c) => c.id === id);
}
