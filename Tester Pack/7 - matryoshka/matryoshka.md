# 7 — Matryoshka

- **Slug:** `matryoshka`
- **Category:** Crypto · **Points:** 25
- **Surface:** `oracle.example.com` (or `/c/7` from hub)
- **GIBSON key part:** **1 of 3**

## Premise

The oracle hands you an opaque blob — a string under four nested encodings. The innermost cleartext contains both the flag and the first GIBSON key fragment.

**Encoding order** (outside → in): `base64 → reverse-string → ROT13 → base64 → cleartext`.

## What you need

- CyberChef (recommended — chain operations in one go), OR
- Any base64 tool + ROT13 + string reversal (browser console works).

## Step-by-step solve

1. Visit `http://localhost:3000/c/7`. The page shows a single long blob inside the green panel.
2. Copy the blob string.
3. Decode in this exact order:

### CyberChef recipe

```
From Base64
Reverse → "Character"
ROT13
From Base64
```

Paste the blob in the input. Output:

```
flag=ZERODAY{XXXXXXXXXXXXXXXXXXXXXXXX}
gibson_key_part_1=A1B2C3D4E5F60718
```

### Manual / Node.js / browser console

```js
const blob = "PASTE_BLOB_HERE";
const step1 = atob(blob);                                // base64 → text
const step2 = [...step1].reverse().join('');             // reverse string
const step3 = step2.replace(/[A-Za-z]/g, c => {          // ROT13
  const b = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b);
});
const cleartext = atob(step3);                           // base64 → text
console.log(cleartext);
```

4. Two lines come out. Line 1 is the flag (submit it). Line 2 is **GIBSON key part 1** — write it down. You'll need it again for challenge #19.

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"matryoshka","flag":"ZERODAY{...}"}'
```

## GIBSON key fragment

Save this somewhere persistent (sticky note, text file). Format: 16 hex characters. Example shape: `A1B2C3D4E5F60718`. **Don't lose it.**

After all 19 are solved you'll need parts 1 + 2 + 3 concatenated as a 24-byte AES-192 key.

## Common failure modes

- **Wrong decode order** — running ROT13 before reversing won't recover anything. The order is fixed.
- **Pasting with line breaks** — base64 implementations vary on whether they tolerate `\n` mid-string. CyberChef does; some bash one-liners don't. Strip whitespace first.
- **Submitting the GIBSON fragment as a flag** — the fragment is 16 hex (no `ZERODAY{}` wrapper). Submit only the line starting with `flag=`.

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=8`.
