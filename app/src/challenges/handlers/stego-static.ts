// Challenge 17 — Stego in the static. Meta. example.com.
// Embeds GIBSON key part 3 of 3.
//
// Mechanic: the page serves a noisy "CRT static" PNG. The image's RGB low-bits
// encode `flag=ZERODAY{...}\ngibson_key_part_3=<hex>` — both halves of the
// puzzle in one stego payload (matryoshka pattern, not ports-of-call's
// renderKeyFragment block, because the *prize* of stego is the extracted key).
//
// LSB protocol (kept in sync with tools/stego-encode.py):
//   - Walk pixels in row-major order; for each pixel use R, G, B, skip A.
//   - Bit 0 (LSB) of each channel byte holds one payload bit.
//   - Bit order within a payload byte: MSB first.
//   - Frame: [16-bit big-endian length-in-bytes][payload bytes].
//
// Two paths on this host (example.com is shared with #1 white-rabbit, but the
// host dispatcher in server.ts ordinal-gates which handler runs):
//   GET /              → CRT-styled landing referencing the image
//   GET /static.png    → per-player LSB-encoded PNG
//   anything else      → 404 in voice
//
// When entered via the hub at /c/17/<sub>, the wildcard rewrite in routes/hub.ts
// strips the prefix so this handler sees the same shape it sees on example.com.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

import type { ChallengeModule } from '../types.js';
import { GIBSON_KEY_PARTS } from '../../lib/gibson.js';

const here = dirname(fileURLToPath(import.meta.url));
// app/src/challenges/handlers/ → repo root is four ups
const COVER_PATH = join(here, '..', '..', '..', '..', 'assets', 'c17', 'cover.png');

// Parse once at module load. The .data buffer is RGBA stride-4 regardless of
// the source PNG's color type — pngjs normalises on read.
const COVER = PNG.sync.read(readFileSync(COVER_PATH));
const COVER_PIXELS = COVER.width * COVER.height;
const COVER_RGB_BYTES = COVER_PIXELS * 3; // capacity if A is skipped

export function encodeLsb(coverData: Buffer, payload: Buffer): Buffer {
  if (payload.length > 0xffff) {
    throw new Error(`stego payload too large: ${payload.length} > 65535`);
  }
  const bitsNeeded = (payload.length + 2) * 8;
  if (bitsNeeded > COVER_RGB_BYTES) {
    throw new Error(`cover too small: need ${bitsNeeded} bits, have ${COVER_RGB_BYTES}`);
  }
  const out = Buffer.from(coverData); // clone
  const frame = Buffer.alloc(2 + payload.length);
  frame.writeUInt16BE(payload.length, 0);
  payload.copy(frame, 2);

  let bitIndex = 0;
  const totalBits = frame.length * 8;
  // Walk pixels: 4 bytes per pixel (RGBA), modify R,G,B (offsets 0,1,2), skip A.
  for (let p = 0; p < COVER_PIXELS && bitIndex < totalBits; p++) {
    const base = p * 4;
    for (let ch = 0; ch < 3 && bitIndex < totalBits; ch++) {
      const byteIdx = bitIndex >> 3;
      const bitInByte = 7 - (bitIndex & 7); // MSB first
      const bit = (frame[byteIdx] >> bitInByte) & 1;
      out[base + ch] = (out[base + ch] & 0xfe) | bit;
      bitIndex++;
    }
  }
  return out;
}

function buildPng(payload: Buffer): Buffer {
  const png = new PNG({ width: COVER.width, height: COVER.height });
  png.data = encodeLsb(COVER.data, payload);
  return PNG.sync.write(png);
}

const landingHtml = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>example.com — channel hold</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.6;max-width:760px;margin:0 auto;}
  h1{font-weight:normal;letter-spacing:.04em;color:#9cf;}
  pre{font-size:1.02rem;}
  .frame{margin:1.6rem 0;padding:.8rem;background:#001;border:1px solid #033;display:inline-block;}
  img{display:block;image-rendering:pixelated;width:256px;height:256px;}
  .dim{color:#586;}
  a{color:#9cf;}
</style></head><body>
<h1>example.com — channel hold</h1>
<pre>
  > the carrier is up. nothing on this frequency but snow.
  > the static remembers.
  > look beneath the noise. some pixels lie a little.
</pre>
<div class="frame">
  <img src="static.png" alt="static">
</div>
<pre class="dim">
  > two things are in there. one you submit, one you keep.
  > save the image. read its low bits. the second line is gibson's.
</pre>
</body></html>`;

const notFoundHtml = `<!doctype html>
<html><head><title>—</title><style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;}
  .dim{color:#586;}
</style></head><body>
<pre class="dim">
  > dead air on this frequency.
</pre>
</body></html>`;

function pathOf(rawUrl: string | undefined): string {
  const url = rawUrl ?? '/';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

export const handler: ChallengeModule = {
  hints: {
    hint1: 'the carrier is open but the static is not random.',
    hint2: 'what you see is the cover. what you want is what is underneath.',
    hint3: 'this is steganography. the lowest bit of each colour channel carries one bit of the message.',
    hint4: 'walk the pixels in reading order. for each pixel take R, G, B (skip alpha). the first sixteen bits, MSB-first big-endian, are the byte length of the payload.',
    hint5: 'tools/stego-encode.py decode --image static.png — second line of the output is your gibson key fragment.',
  },

  async page(req, reply, { flag }) {
    const path = pathOf(req.url);
    if (path === '/static.png') {
      const payload = Buffer.from(
        `flag=${flag}\ngibson_key_part_3=${GIBSON_KEY_PARTS[3]}\n`,
        'utf8',
      );
      reply
        .type('image/png')
        .header('cache-control', 'no-store')
        .send(buildPng(payload));
      return;
    }
    // Hub entry (/c/17 with no subpath leaves req.url as /c/17) and host-routed
    // root (/) both render the landing.
    if (path === '/' || path === '/c/17' || path === '') {
      reply.type('text/html').send(landingHtml);
      return;
    }
    reply.code(404).type('text/html').send(notFoundHtml);
  },
};
