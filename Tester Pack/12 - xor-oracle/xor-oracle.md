# 12 — XOR with the oracle

- **Slug:** `xor-oracle`
- **Category:** Crypto · **Points:** 35
- **Surface:** `oracle.example.com` (or `/c/12` from hub)
- **GIBSON key part:** —

## Premise

The oracle XORs a known-format payload with a short repeating key, returns the result as hex. The plaintext **always** starts with `flag=ZERODAY{` (13 chars). The key is 11 bytes — *shorter than the known prefix* — so the player can recover the full key by XOR'ing ciphertext head against known plaintext.

## What you need

- Python 3, OR CyberChef.
- The helper script in this folder (`tools/xor_solve.py`) handles it in one command.

## Step-by-step solve

1. Visit `http://localhost:3000/c/12`. Copy the long uppercase hex blob displayed in the green panel.
2. Decide your tool:

### Option A — the helper script

```bash
cd "Tester Pack/12 - xor-oracle/tools"
python3 xor_solve.py "PASTE_HEX_BLOB_HERE"
```

Output:
```
recovered key: wargames-83
plaintext:
  flag=ZERODAY{XXXXXXXXXXXXXXXXXXXXXXXX}
  sigil=THE-ONLY-WINNING-MOVE
```

The line `flag=...` is your submission. The `sigil` line is a red herring — keep it as flavor or ignore it.

### Option B — CyberChef

1. Paste the hex blob.
2. Add operation: `From Hex` (default delimiter `Auto`).
3. Add: `XOR` with key `wargames-83` (UTF-8).
4. Output is the cleartext.

(The recipe technically requires you to know the key. Use Option A first; it recovers the key automatically.)

### Option C — manual (Python REPL)

```python
import binascii
hex_blob = "PASTE_HEX_HERE"
ct = binascii.unhexlify(hex_blob)
known = b"flag=ZERODAY{"   # 13 bytes — longer than the 11-byte key
key = bytes(c ^ p for c, p in zip(ct[:13], known))[:11]
pt = bytes(c ^ key[i % 11] for i, c in enumerate(ct))
print(pt.decode())
```

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"xor-oracle","flag":"ZERODAY{...}"}'
```

## Common failure modes

- **Assuming the key length is 13** — it's 11. The first 13 bytes of XOR-output give you the key cycle plus the start of the next cycle (key + key[:2]).
- **Stripping the `flag=` prefix and submitting** — submit the *whole flag* including `ZERODAY{...}`. `flag=` is a label, not part of the flag.
- **Hex blob includes whitespace** — if you copy line-wrapped output, strip whitespace first (the helper script handles this).

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=13`.
