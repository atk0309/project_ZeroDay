#!/usr/bin/env python3
"""
ZeroDay challenge #17 (stego-static) — authoring helper + reference codec.

The runtime handler in app/src/challenges/handlers/stego-static.ts encodes the
per-player payload into the cover PNG at request time. This script ships
alongside it for two reasons:

  1. generate-cover  — produce the committed cover image at assets/c17/cover.png.
                       Run once at authoring time; the output is checked in.
  2. encode / decode — reference codec, bit-for-bit compatible with the TS
                       runtime. Used to playtest, and (as decode) the canonical
                       reference for an operator who wants to verify the puzzle
                       byte-by-byte.

LSB protocol (must match app/src/challenges/handlers/stego-static.ts):

  - Walk pixels in row-major order (top-left to bottom-right).
  - For each pixel, consume R, G, B in that order; skip A on RGBA covers.
  - Within each channel byte, set bit 0 (LSB) to the next payload bit.
  - Bit order within a payload byte: MSB first.
  - Frame: [16-bit big-endian length-in-bytes][payload bytes].
           Length excludes the 2-byte header. Max payload 65535 bytes.

Requires Pillow:  pip install Pillow
"""

from __future__ import annotations

import argparse
import os
import random
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow is required. Install with: pip install Pillow", file=sys.stderr)
    sys.exit(1)


HEADER_BYTES = 2  # 16-bit big-endian length prefix


def _bits_msb_first(data: bytes):
    for byte in data:
        for shift in (7, 6, 5, 4, 3, 2, 1, 0):
            yield (byte >> shift) & 1


def _pack_frame(payload: bytes) -> bytes:
    if len(payload) > 0xFFFF:
        raise ValueError(f"payload too large: {len(payload)} > 65535 bytes")
    return len(payload).to_bytes(2, "big") + payload


def _channels_per_pixel(mode: str) -> int:
    if mode == "RGB":
        return 3
    if mode == "RGBA":
        return 3  # A is skipped
    raise ValueError(f"unsupported mode {mode!r}; convert to RGB or RGBA first")


def encode_lsb(cover: Image.Image, payload: bytes) -> Image.Image:
    """Embed `payload` into the LSBs of cover's RGB channels. Returns a new image."""
    if cover.mode not in ("RGB", "RGBA"):
        cover = cover.convert("RGB")
    frame = _pack_frame(payload)
    rgb_bytes_available = cover.width * cover.height * _channels_per_pixel(cover.mode)
    bits_needed = len(frame) * 8
    if bits_needed > rgb_bytes_available:
        raise ValueError(
            f"cover too small: need {bits_needed} bits, have {rgb_bytes_available}"
        )

    out = cover.copy()
    pixels = out.load()
    bits = _bits_msb_first(frame)
    done = False
    for y in range(out.height):
        if done:
            break
        for x in range(out.width):
            px = list(pixels[x, y])
            for ch in range(3):
                try:
                    b = next(bits)
                except StopIteration:
                    done = True
                    break
                px[ch] = (px[ch] & 0xFE) | b
            pixels[x, y] = tuple(px)
            if done:
                break
    return out


def decode_lsb(image: Image.Image) -> bytes:
    """Extract a framed payload from `image`. Returns the inner bytes."""
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGB")
    pixels = image.load()

    def stream_bits():
        for y in range(image.height):
            for x in range(image.width):
                px = pixels[x, y]
                for ch in range(3):
                    yield px[ch] & 1

    bits = stream_bits()

    def take_byte() -> int:
        b = 0
        for _ in range(8):
            b = (b << 1) | next(bits)
        return b

    length = (take_byte() << 8) | take_byte()
    out = bytearray()
    for _ in range(length):
        out.append(take_byte())
    return bytes(out)


def cmd_generate_cover(args: argparse.Namespace) -> int:
    rng = random.Random(args.seed)
    size = args.size
    img = Image.new("RGB", (size, size))
    pixels = img.load()
    # CRT-static look: noisy mid-gray, channels independent. Range 96-160 keeps
    # the image clearly noisy without going pitch-black or blown-out, so LSB
    # flips remain visually invisible.
    for y in range(size):
        for x in range(size):
            r = rng.randint(96, 160)
            g = rng.randint(96, 160)
            b = rng.randint(96, 160)
            pixels[x, y] = (r, g, b)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, format="PNG")
    print(f"wrote {out_path} ({size}x{size}, seed={args.seed!r})")
    return 0


def cmd_encode(args: argparse.Namespace) -> int:
    cover = Image.open(args.cover)
    payload = args.payload.encode("utf-8")
    out = encode_lsb(cover, payload)
    out.save(args.out, format="PNG")
    print(f"encoded {len(payload)} bytes -> {args.out}")
    return 0


def cmd_decode(args: argparse.Namespace) -> int:
    img = Image.open(args.image)
    payload = decode_lsb(img)
    sys.stdout.buffer.write(payload)
    if not payload.endswith(b"\n"):
        sys.stdout.buffer.write(b"\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="stego-encode",
        description="Cover generation + LSB codec for ZeroDay challenge #17.",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_gen = sub.add_parser("generate-cover", help="produce a noisy cover PNG")
    p_gen.add_argument("--out", required=True, help="output PNG path")
    p_gen.add_argument("--seed", default="zeroday-17", help="rng seed")
    p_gen.add_argument("--size", type=int, default=256, help="square size in px")
    p_gen.set_defaults(func=cmd_generate_cover)

    p_enc = sub.add_parser("encode", help="embed a payload into a cover")
    p_enc.add_argument("--cover", required=True)
    p_enc.add_argument("--payload", required=True, help="UTF-8 string to embed")
    p_enc.add_argument("--out", required=True)
    p_enc.set_defaults(func=cmd_encode)

    p_dec = sub.add_parser("decode", help="extract the framed payload from an image")
    p_dec.add_argument("--image", required=True)
    p_dec.set_defaults(func=cmd_decode)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
