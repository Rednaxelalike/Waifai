/**
 * Renders the Waifai mark to PNG at the sizes a PWA install needs.
 *
 * Hand-rolled because the project has no image toolchain and adding one to
 * produce four static files would be a poor trade. The mark is simple enough
 * to evaluate analytically: a superellipse, two circular arcs and a dot, all
 * sampled 4x4 per pixel.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: node make-icons.mjs <public-dir>');

/* -- geometry, in the same 64-unit space as the SVG mark ------------------- */

const ARC_OUTER = { cx: 32, cy: 43.52, r: 23, chordY: 27.5, x0: 15.5, x1: 48.5, alpha: 0.42 };
const ARC_INNER = { cx: 32, cy: 44.54, r: 14.6, chordY: 34.4, x0: 21.5, x1: 42.5, alpha: 0.74 };
const STROKE = 4.4;
const DOT = { cx: 32, cy: 44.4, r: 4.6 };

const TOP = [0x4a, 0x90, 0xee];
const MID = [0x2a, 0x6f, 0xd0];
const BOT = [0x15, 0x3b, 0x78];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function baseColor(y) {
  const t = Math.min(1, Math.max(0, y / 64));
  const [from, to, k] = t < 0.5 ? [TOP, MID, t / 0.5] : [MID, BOT, (t - 0.5) / 0.5];
  return [lerp(from[0], to[0], k), lerp(from[1], to[1], k), lerp(from[2], to[2], k)];
}

/** Superellipse: the shape iOS actually uses, not a rounded rectangle. */
function inSquircle(x, y) {
  const nx = Math.abs((x - 32) / 30);
  const ny = Math.abs((y - 32) / 30);
  return nx ** 5 + ny ** 5 <= 1;
}

function onArc(x, y, arc) {
  const half = STROKE / 2;
  // Round caps first - they are the only part that lives past the chord.
  for (const ex of [arc.x0, arc.x1]) {
    if ((x - ex) ** 2 + (y - arc.chordY) ** 2 <= half * half) return true;
  }
  if (y > arc.chordY) return false;
  const d = Math.hypot(x - arc.cx, y - arc.cy);
  return Math.abs(d - arc.r) <= half;
}

/** Colour and alpha of one sample point, composited front to back. */
function sample(x, y, fullBleed) {
  const covered = fullBleed || inSquircle(x, y);
  if (!covered) return [0, 0, 0, 0];

  let [r, g, b] = baseColor(y);

  // Specular sweep over the top third.
  const gloss = Math.max(0, 1 - y / 33) * 0.34;
  if (gloss > 0) {
    r = lerp(r, 255, gloss);
    g = lerp(g, 255, gloss);
    b = lerp(b, 255, gloss);
  }

  // Bloom behind the dot, then the marks themselves.
  const bloom = Math.max(0, 1 - Math.hypot(x - DOT.cx, y - DOT.cy) / 16) * 0.3;
  if (bloom > 0) {
    r = lerp(r, 255, bloom);
    g = lerp(g, 255, bloom);
    b = lerp(b, 255, bloom);
  }

  for (const arc of [ARC_OUTER, ARC_INNER]) {
    if (onArc(x, y, arc)) {
      r = lerp(r, 255, arc.alpha);
      g = lerp(g, 255, arc.alpha);
      b = lerp(b, 255, arc.alpha);
    }
  }

  if ((x - DOT.cx) ** 2 + (y - DOT.cy) ** 2 <= DOT.r * DOT.r) {
    r = 255;
    g = 255;
    b = 255;
  }

  return [r, g, b, 255];
}

/* -- raster ---------------------------------------------------------------- */

const SS = 4; // samples per axis

function render(size, { fullBleed = false, inset = 1, shiftY = 0 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = 64 / size;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (px + (sx + 0.5) / SS) * scale;
          const uy = (py + (sy + 0.5) / SS) * scale;
          // `inset` shrinks the artwork toward the centre for maskable icons,
          // whose outer ring gets cropped to whatever shape the OS wants.
          const gx = 32 + (ux - 32) / inset;
          const gy = 32 + (uy - 32) / inset + shiftY;
          const [sr, sg, sb, sa] = sample(gx, gy, fullBleed);
          const w = sa / 255;
          r += sr * w;
          g += sg * w;
          b += sb * w;
          a += sa;
        }
      }
      const n = SS * SS;
      const alpha = a / n;
      const wsum = alpha / 255 || 1;
      const i = (py * size + px) * 4;
      rgba[i] = Math.round(r / n / wsum);
      rgba[i + 1] = Math.round(g / n / wsum);
      rgba[i + 2] = Math.round(b / n / wsum);
      rgba[i + 3] = Math.round(alpha);
    }
  }
  return rgba;
}

/* -- PNG ------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(name, size, opts) {
  const file = join(OUT, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png(size, render(size, opts)));
  console.log(`wrote ${name} (${size}x${size})`);
}

write('apple-touch-icon.png', 180);
write('icon-192.png', 192);
write('icon-512.png', 512);
write('icon-maskable-512.png', 512, { fullBleed: true, inset: 0.7, shiftY: 5 });
