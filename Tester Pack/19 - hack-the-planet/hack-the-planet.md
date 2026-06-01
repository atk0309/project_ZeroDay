# 19 — Hack the planet

- **Slug:** `hack-the-planet`
- **Category:** Final · **Points:** 150
- **Surface:** `gibson.example.com` (or `/c/19` from hub)
- **GIBSON key part:** uses 1 + 2 + 3 (collected from #7, #13, #17)

## Premise

The finale. The page renders a per-player AES-192-CBC ciphertext + IV. Your three GIBSON key fragments concatenate into a 24-byte AES-192 key. Submit the three fragments via `?k1=&k2=&k3=` and the server decrypts the plaintext, revealing the per-player flag inside diegetic prose.

## What you need

- Your three GIBSON fragments from challenges #7, #13, #17. Each is 16 hex chars.
- A browser. (No client-side crypto needed — the server does the decrypt.)

## Step-by-step solve

1. Confirm you have three 16-hex strings written down (32 chars per fragment if your tooling reports characters, but the format is **16 hex** = 8 bytes = 16 chars). Example shapes:
   - Part 1 (from #7 matryoshka): `A1B2C3D4E5F60718`
   - Part 2 (from #13 ports-of-call): `9E7B5C3A11D22F08`
   - Part 3 (from #17 stego-static): `D3FACEB14C0DE5A1`

2. Visit `http://localhost:3000/c/19`. The page shows:
   - A ciphertext blob in hex (per-player; same for you across reloads).
   - An IV in hex (per-player, derived from your `flag_salt`).
   - Three input fields: `key fragment 1`, `key fragment 2`, `key fragment 3`.

3. Paste each fragment into the matching field. The form submits via GET, so you can also use a direct URL:
   ```
   http://localhost:3000/c/19?k1=A1B2C3D4E5F60718&k2=9E7B5C3A11D22F08&k3=D3FACEB14C0DE5A1
   ```

4. On all-three-correct submission, the page replaces the form with:
   ```
   ACCESS GRANTED — WELCOME TO THE COLLECTIVE

   welcome to the collective, <your-alias>.
   ZERODAY{XXXXXXXXXXXXXXXXXXXXXXXX}
   the only way to fight a bad guy with a computer is to be a good guy with a computer.
   ```

5. Copy the flag. Submit.

### Wrong fragments

Each fragment is validated independently. Any wrong field comes back as `key fragment N rejected.` and the page clears that field. The other two stay populated. So you can mix-and-match until all three match.

The compare is case-insensitive and whitespace-tolerant — `a1b2c3d4e5f60718`, `A1 B2 C3 D4 E5 F6 07 18`, and `A1B2C3D4E5F60718` all match.

### Tester sanity check (offline decrypt)

If you want to verify the cipher params are correct independent of the server, the helper in this folder (`tools/aes192_cbc_decrypt.py`) takes the ciphertext + IV + three fragments and prints the plaintext. The server uses the same params:

- **cipher**: AES-192-CBC
- **key**: `bytes.fromhex(k1 || k2 || k3)` — 24 bytes
- **IV**: from the page (already hex-encoded for you)

```bash
cd "Tester Pack/19 - hack-the-planet/tools"
python3 aes192_cbc_decrypt.py \
  --ciphertext <hex-from-page> \
  --iv <hex-from-page> \
  --k1 A1B2C3D4E5F60718 \
  --k2 9E7B5C3A11D22F08 \
  --k3 D3FACEB14C0DE5A1
```

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"hack-the-planet","flag":"ZERODAY{...}"}'
```

After this submit:
- `current_ordinal` advances past 19 (no more challenges).
- `user_progress.completed_at` is set.
- Submit response: `{ "correct": true, "advanced": true, "completed": true, "next": null }`.
- The hub flips your view to a "you've cleared the GIBSON" state.

## Common failure modes

- **Lost a fragment** — replay the relevant challenge. The fragments in `lib/gibson.ts` are static constants, so re-solving #7/#13/#17 reproduces them. (The flags themselves are per-player; the GIBSON fragments are global.)
- **Confusing fragment ordering** — order matters. k1 is from #7, k2 from #13, k3 from #17. Swapping any two breaks the AES key.
- **Submitting a fragment as the flag** — the fragments aren't `ZERODAY{...}`-shaped. The flag comes from the *decrypted plaintext*, line 2.
- **`gibson key parts not all wired (expected 48 hex chars)`** — only happens on a misconfigured deployment where one of the three fragments is still a placeholder. On `dev`/`main` this should never trip; the `/admin/setup` review panel confirms 3/3.

## Verification (admin side)

`solve` event with `payload.completed=true`. Player drawer shows the full 19-cell grid as solved.
