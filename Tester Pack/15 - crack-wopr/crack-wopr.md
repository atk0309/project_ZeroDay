# 15 — Crack the WOPR

- **Slug:** `crack-wopr`
- **Category:** Crypto · **Points:** 40
- **Surface:** `wopr.example.com` (or `/c/15` from hub)
- **GIBSON key part:** —

## Premise

A login prompt with a published SHA-256 digest. The hash is `sha256("joshua")` — Falken's son in *WarGames*, the WOPR's backdoor password. Two solve paths: brute-force or watch the movie.

## What you need

- *EITHER* hashcat / John the Ripper + a small wordlist, *OR* knowledge of *WarGames* (1983), *OR* an online SHA-256 reverse lookup.

## Step-by-step solve

1. Visit `http://localhost:3000/c/15`. The page shows:
   - A login prompt asking for one name.
   - A SHA-256 digest (the "shadow record"):
     ```
     <64 hex chars — sha256("joshua")>
     ```
   - A hint: "the system reads from the falken family register. spouse. son. dog. maze. the names are short. the names are old."

### Path A — film knowledge

In *WarGames* (1983), Joshua is Falken's deceased son. The WOPR's backdoor password is "joshua". Submit `?login=joshua`.

### Path B — brute force with a wordlist

```bash
# Make a tiny wordlist drawn from Falken family lore + WarGames vocabulary
cat > falken.txt <<'EOF'
joshua
jennifer
falken
david
malvin
mcKittrick
patricia
helen
beringer
helen
EOF

# Crack with hashcat (mode 1400 = sha256)
hashcat -m 1400 -a 0 -o cracked.txt <DIGEST> falken.txt

cat cracked.txt
# <DIGEST>:joshua
```

Or with John the Ripper:
```bash
echo "<DIGEST>" > hash.txt
john --format=raw-sha256 --wordlist=falken.txt hash.txt
john --show --format=raw-sha256 hash.txt
```

### Path C — reverse lookup

Paste the digest into any online "SHA-256 lookup" service (the hash is canonical, not salted). It returns "joshua".

2. Once you know the answer, submit:
   ```bash
   curl -b "PLAYER_COOKIE=<your-cookie>" \
     'http://localhost:3000/c/15?login=joshua'
   ```
3. Response:
   ```
   > GREETINGS, PROFESSOR FALKEN.
   > shall we play a game?

   ZERODAY{...}
   ```

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"crack-wopr","flag":"ZERODAY{...}"}'
```

## Common failure modes

- **Trying capitalized or shifted forms** — exact-match `joshua` only. Lowercase. No quotes.
- **Confusing this with Falken himself** — the password belongs to Joshua, not Stephen Falken.
- **No rate limit** — by design. Brute-force-friendly.

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=16`.
