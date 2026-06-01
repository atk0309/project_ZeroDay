#!/usr/bin/env python3
"""
Solver for ZeroDay challenge #17 (stego-static).

Decodes the LSB payload from the per-player static.png:
  - Walks pixels in row-major order.
  - For each pixel uses channels R, G, B (skips A).
  - Bit 0 (LSB) of each channel carries one payload bit.
  - Bit order within payload bytes: MSB first.
  - Frame: [16-bit big-endian length-in-bytes][payload bytes].

Matches tools/stego-encode.py in the repo (the authoring codec).

Usage:
    python3 stego_decode.py path/to/static.png
"""

import struct
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    path = sys.argv[1]

    try:
        from PIL import Image  # type: ignore
    except ImportError:
        print(
            "error: this script needs Pillow. install it with:\n"
            "  pip install pillow",
            file=sys.stderr,
        )
        return 2

    img = Image.open(path).convert("RGBA")
    pixels = img.load()
    width, height = img.size

    bits: list[int] = []
    for y in range(height):
        for x in range(width):
            r, g, b, _a = pixels[x, y]
            bits.append(r & 1)
            bits.append(g & 1)
            bits.append(b & 1)

    # Need at least 16 bits for the length header.
    if len(bits) < 16:
        print("error: image too small to carry a payload header.", file=sys.stderr)
        return 2

    def bits_to_bytes(bs: list[int]) -> bytes:
        # MSB-first within each payload byte.
        n = len(bs) // 8
        out = bytearray(n)
        for i in range(n):
            v = 0
            for k in range(8):
                v = (v << 1) | bs[i * 8 + k]
            out[i] = v
        return bytes(out)

    header = bits_to_bytes(bits[:16])
    (length,) = struct.unpack(">H", header)

    needed_bits = length * 8
    if 16 + needed_bits > len(bits):
        print(
            f"error: declared length {length} but image only carries "
            f"{(len(bits) - 16) // 8} bytes of payload capacity.",
            file=sys.stderr,
        )
        return 2

    payload = bits_to_bytes(bits[16 : 16 + needed_bits])
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError:
        print("error: payload bytes were not valid utf-8. raw bytes:", file=sys.stderr)
        print(payload.hex(), file=sys.stderr)
        return 2

    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
