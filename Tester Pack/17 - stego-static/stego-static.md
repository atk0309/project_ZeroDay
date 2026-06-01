# 17 — Stego in the static

- **Slug:** `stego-static`
- **Category:** Meta · **Points:** 50
- **Surface:** `example.com/c/17` (ordinal-gated on the same host as #1)
- **GIBSON key part:** **3 of 3**

## Premise

A noisy CRT-static PNG. The flag and GIBSON key part 3 are encoded in the RGB low-bits (LSB stego) of every pixel.

## What you need

- The decoder script in this folder (`tools/stego_decode.py`), OR the repo's authoring tool at `tools/stego-encode.py` (which has a `decode` subcommand).
- Python 3 with `pillow` (`pip install pillow`) — or any LSB-aware stego tool.

## LSB protocol (for reference)

- Walk pixels in row-major order.
- For each pixel use channels R, G, B (skip A).
- Bit 0 (the LSB) of each channel byte holds one payload bit.
- Bit order within a payload byte: MSB first.
- Frame: `[16-bit big-endian length-in-bytes][payload bytes]`.

This matches the project's `tools/stego-encode.py` codec.

## Step-by-step solve

1. Visit `http://localhost:3000/c/17`. Page is intentionally bare: a CRT-static image inside a black frame, plus the line "two things are in there. one you submit, one you keep."
2. Save the static image:
   ```bash
   curl -b "PLAYER_COOKIE=<your-cookie>" \
     -o static.png http://localhost:3000/c/17/static.png
   ```
3. Decode the LSB payload using **either** approach below.

### Option A — the helper in this folder

```bash
cd "Tester Pack/17 - stego-static/tools"
python3 stego_decode.py /path/to/static.png
```

Output:
```
flag=ZERODAY{XXXXXXXXXXXXXXXXXXXXXXXX}
gibson_key_part_3=D3FACEB14C0DE5A1
```

### Option B — the project's reference codec

```bash
python3 tools/stego-encode.py decode --image static.png
```

Same output. (This is what challenge hint L5 points at.)

### Option C — manual

Read the PNG, walk RGB channels, pull bit 0, MSB-first within each payload byte, framed by a 16-bit big-endian length:

```python
from PIL import Image
img = Image.open("static.png").convert("RGBA")
bits = []
for y in range(img.height):
    for x in range(img.width):
        r, g, b, a = img.getpixel((x, y))
        for ch in (r, g, b):
            bits.append(ch & 1)

# First 16 bits = payload byte length (big-endian, MSB-first within byte)
def take_bytes(bits, n):
    out = bytearray()
    for i in range(n):
        v = 0
        for k in range(8):
            v = (v << 1) | bits[i * 8 + k]
        out.append(v)
    return bytes(out)

length = (bits[0] << 15 | bits[1] << 14 | bits[2] << 13 | bits[3] << 12 |
          bits[4] << 11 | bits[5] << 10 | bits[6] << 9  | bits[7] << 8  |
          bits[8] << 7  | bits[9] << 6  | bits[10] << 5 | bits[11] << 4 |
          bits[12] << 3 | bits[13] << 2 | bits[14] << 1 | bits[15])
payload = take_bytes(bits[16:], length)
print(payload.decode("utf-8"))
```

4. Two lines come out. Submit the flag. **Save** the GIBSON fragment for #19.

## Submit

```bash
curl -X POST http://localhost:3000/api/submit \
  -H 'Content-Type: application/json' \
  -b "PLAYER_COOKIE=<your-cookie>" \
  -d '{"challenge_id":"stego-static","flag":"ZERODAY{...}"}'
```

## GIBSON key fragment

Format: 16 hex chars. **Save it.** This is the third and final fragment. Combined with parts 1 (#7) and 2 (#13), it forms the 24-byte AES-192 key for challenge #19.

## Common failure modes

- **Treating the cover as random noise** — it's per-player. Two testers get different `static.png` files (the salt-derived flag varies, so the LSB content varies).
- **Reading bytes LSB-first within each byte** — the protocol is **MSB-first** within payload bytes, but **bit 0 (LSB)** within each cover-channel byte. Two different conventions; getting them swapped scrambles the output.
- **Including the alpha channel** — skip channel index 3. Only R, G, B carry payload bits.
- **Submitting the GIBSON fragment as a flag** — the fragment is 16 hex (no `ZERODAY{}` wrapper). Submit only the line starting with `flag=`.

## Verification (admin side)

`solve` event. Drawer shows `current_ordinal=18`.
