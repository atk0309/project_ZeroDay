# 3 — Caesar's ghost

- **Slug:** `caesars-ghost`
- **Category:** Crypto · **Points:** 15
- **Surface:** `oracle.example.com` (or `/c/3` from hub)
- **GIBSON key part:** —

## Premise

The oracle speaks in a classical cipher. The page shows a quote and a flag — both ROT13-encoded.

## What you need

- ROT13 decoder (CyberChef "ROT13" recipe, browser extension, or a one-liner).

## Step-by-step solve

1. Visit `http://localhost:3000/c/3`.
2. The page shows:
   ```
   > intercepted transmission, encoding unknown
   Gur neg bs qrprcgvba vf va pbaivapvat crbcyr lbh'er fbzrbar ryfr.
   MREBQNL{XXXXXXXXXXXXXXXXXXXXXXXX}
   ```
3. The first line is the Mitnick quote ROT13'd: `The art of deception is in convincing people you're someone else.` — confirms it's ROT13.
4. Apply ROT13 to the **second** line.
5. Result: `ZERODAY{...}` (the punctuation `{}` survives ROT13 because they aren't letters).

### One-liners

```bash
# Bash + tr (ROT13 is its own inverse)
echo "MREBQNL{XXXXXXXXXXXXXXXXXXXXXXXX}" | tr 'A-Za-z' 'N-ZA-Mn-za-m'

# Python
python3 -c "import codecs; print(codecs.decode('MREBQNL{...}', 'rot_13'))"

# Browser console
"MREBQNL{...}".replace(/[A-Za-z]/g, c => {
  const b = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b);
});
```

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"caesars-ghost","flag":"ZERODAY{...}"}'
```

## Common failure modes

- **Decoding the quote instead of the flag** — the quote is the *teaching example*. The flag is the line below it.
- **Caesar shift other than 13** — only ROT13 (shift = 13) applies; the canonical hint is the symmetric quote-then-flag layout.

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=4`.
