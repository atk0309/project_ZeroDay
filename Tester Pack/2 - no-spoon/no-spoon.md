# 2 — There is no spoon

- **Slug:** `no-spoon`
- **Category:** Entry · **Points:** 10
- **Surface:** `hack.example.com` (or `/c/2` from hub)
- **GIBSON key part:** —

## Premise

The post-signup welcome page greets you by alias and says "look closer." The flag is right there — twice — but invisible to a casual reader.

## What you need

- Browser with view-source.

## Step-by-step solve

1. Visit `http://localhost:3000/c/2`.
2. The visible page reads:
   ```
   welcome, <your-alias>.
   look closer.
   ```
3. Right-click → View Source (or Ctrl+U).
4. Two lines below the `<p>look closer.</p>`:
   - Line 15: `<!-- ZERODAY{...} -->` — the flag in an HTML comment.
   - Line 16: `<div class="invisible">ZERODAY{...}</div>` — and again in a `display: none` div.
5. Either copy works. Submit.

Alternatively in DevTools → Elements panel, expand the body and you'll see the comment + hidden div directly without view-source.

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"no-spoon","flag":"ZERODAY{...}"}'
```

## Common failure modes

- **Reading the rendered page instead of the source** — the `.invisible` class is `display: none`. The browser hides it. View-source / Elements panel shows it.
- **Copy-paste includes the comment delimiters** — make sure you copied just `ZERODAY{...}`, not `<!-- ZERODAY{...} -->`.

## Verification (admin side)

`solve` event in the live feed. Drawer shows `current_ordinal=3`.
