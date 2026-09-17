/**
 * Renders the Waifai mark to PNG at the sizes a PWA install needs.
 *
 * Hand-rolled because the project has no image toolchain and adding one to
 * produce four static files would be a poor trade. The mark is simple enough
 * to evaluate analytically: a superellipse plate, three circular tubes and a
 * bead, all sampled 4x4 per pixel.
 *
 * The geometry and the colour ramps below are the same numbers public/icon.svg
 * and `WaifaiBrandMark` in src/components/icons.tsx carry. Change the mark and
 * all three have to move together; then re-run:
 *
 *   node packages/web/tools/make-icons.mjs packages/web/public
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: node make-icons.mjs <public-dir>');

/* -- the mark, in the same 64-unit space as the SVG ------------------------ */

const C = { x: 32, y: 39.6 };
const THETA = 108; // half-sweep of every band, in degrees from straight up
const ARCS = [
  { r: 7, w: 5.6, core: 0.9 },
  { r: 16.5, w: 6.6, core: 1.05 },
  { r: 27.1, w: 7.8, core: 1.25 },
];
const DOT = { x: 32, y: 50.1, r: 5.2 };
const SPEC = { x: 30.3, y: 48.1, r: 1.45, color: '#FFFEF6' };
const GLOW = { sd: 2, opacity: 0.32, color: '#FF7A06' };
const CORE = { blur: 0.7, opacity: 0.8, color: '#FFFBE6' };

/** The tube's cross-section, from its inner edge (-1) to its outer edge (+1). */
const TUBE = [
  [-1, '#B22405'],
  [-0.62, '#E85C05'],
  [-0.3, '#FF9410'],
  [-0.1, '#FFD558'],
  [0, '#FFF6CE'],
  [0.1, '#FFD055'],
  [0.34, '#FF8C0C'],
  [0.68, '#E04A04'],
  [1, '#A81F04'],
];
/** The bead: a sphere, lit from up and to the left. */
const BEAD = {
  cx: 30.4,
  cy: 48.3,
  r: 7.6,
  stops: [
    [0, '#FFFDF0'],
    [0.26, '#FFDD62'],
    [0.55, '#FF9412'],
    [0.82, '#EF5605'],
    [1, '#A81F04'],
  ],
};
/** Which way is up - the one thing a cross-section cannot say for itself. */
const SHEEN = {
  y1: 8.65,
  y2: 55.4,
  stops: [
    [0, '#FFFFFF', 0.34],
    [0.34, '#FFFFFF', 0.06],
    [0.55, '#FFFFFF', 0],
    [0.76, '#8A1A00', 0.12],
    [1, '#6B1200', 0.34],
  ],
};

const PLATE = [
  [0, '#26282D'],
  [0.55, '#17181C'],
  [1, '#0D0E11'],
];

/* -- colour ---------------------------------------------------------------- */

const hex = (s) => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Sample a list of [offset, colour, alpha?] stops at `t`, as the SVG would. */
function ramp(stops, t) {
  if (t <= stops[0][0]) return [...hex(stops[0][1]), stops[0][2] ?? 1];
  for (let i = 1; i < stops.length; i++) {
    const [o1, c1, a1 = 1] = stops[i];
    if (t > o1) continue;
    const [o0, c0, a0 = 1] = stops[i - 1];
    const k = o1 === o0 ? 0 : (t - o0) / (o1 - o0);
    const [r0, g0, b0] = hex(c0);
    const [r1, g1, b1] = hex(c1);
    return [lerp(r0, r1, k), lerp(g0, g1, k), lerp(b0, b1, k), lerp(a0, a1, k)];
  }
  const last = stops[stops.length - 1];
  return [...hex(last[1]), last[2] ?? 1];
}

/** Composite one [r, g, b, a] over an opaque [r, g, b]. */
function over([r, g, b, a], dst) {
  if (a <= 0) return dst;
  return [lerp(dst[0], r, a), lerp(dst[1], g, a), lerp(dst[2], b, a)];
}

/* -- blur ------------------------------------------------------------------ */

/*
 * The two feGaussianBlurs the SVG uses are the one thing here that is not a
 * closed form. They do not have to be: both are blurs of a shape whose edge is
 * locally straight at this scale, and blurring a straight edge is exactly the
 * normal CDF. So a blurred solid is phi(-d/sigma) off its edge, and a blurred
 * band of width w is the difference of two of them - no convolution needed.
 */
function erf(x) {
  const sign = Math.sign(x);
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return sign * y;
}

const phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

/* -- geometry -------------------------------------------------------------- */

const SWEEP = (THETA * Math.PI) / 180;
/* Where each band stops, and so where the stroke puts its round cap. */
const CAPS = ARCS.map((a) => ({ dx: a.r * Math.sin(SWEEP), y: C.y - a.r * Math.cos(SWEEP) }));

/**
 * Distance from a point to one band's centreline.
 *
 * Inside the swept angle that is just |distance from the arcs' centre - r|;
 * past the ends it is the distance to the nearer cap centre, which is the
 * round cap the stroke would have drawn.
 */
function toCentreline(x, y, i) {
  const dx = x - C.x;
  const dy = y - C.y;
  // Measured from straight up, so the sweep is symmetric about zero.
  if (Math.abs(Math.atan2(dx, -dy)) <= SWEEP) return Math.abs(Math.hypot(dx, dy) - ARCS[i].r);
  const cap = CAPS[i];
  return Math.min(
    Math.hypot(x - (C.x - cap.dx), y - cap.y),
    Math.hypot(x - (C.x + cap.dx), y - cap.y),
  );
}

/** Signed distance to the surface of the whole mark: at or below 0 is inside. */
function toSurface(x, y) {
  let best = Math.hypot(x - DOT.x, y - DOT.y) - DOT.r;
  for (let i = 0; i < ARCS.length; i++) {
    best = Math.min(best, toCentreline(x, y, i) - ARCS[i].w / 2);
  }
  return best;
}

/** Superellipse: the shape iOS actually uses, not a rounded rectangle. */
function inSquircle(x, y) {
  const nx = Math.abs((x - 32) / 30);
  const ny = Math.abs((y - 32) / 30);
  return nx ** 5 + ny ** 5 <= 1;
}

/* -- shading --------------------------------------------------------------- */

/**
 * Colour and alpha of one sample point, composited front to back: the plate,
 * the bloom, then whichever band or the bead the point falls inside, then the
 * sheen and the filament over the top of that.
 */
function sample(x, y, fullBleed) {
  const covered = fullBleed || inSquircle(x, y);
  if (!covered) return [0, 0, 0, 0];

  let rgb = ramp(PLATE, Math.min(1, Math.max(0, (y - 2) / 60))).slice(0, 3);

  // Bloom: the mark, blurred, showing everywhere the mark itself is not.
  const surface = toSurface(x, y);
  if (surface > 0) {
    const a = GLOW.opacity * phi(-surface / GLOW.sd);
    if (a > 0.002) rgb = over([...hex(GLOW.color), a], rgb);
    return [...rgb, 255];
  }

  // Inside the mark. The bead sits in front of the innermost band.
  const inBead = Math.hypot(x - DOT.x, y - DOT.y) <= DOT.r;
  if (inBead) {
    rgb = ramp(BEAD.stops, Math.min(1, Math.hypot(x - BEAD.cx, y - BEAD.cy) / BEAD.r)).slice(0, 3);
  } else {
    // Innermost band first, the same order the SVG draws them in.
    for (let i = 0; i < ARCS.length; i++) {
      const a = ARCS[i];
      if (toCentreline(x, y, i) > a.w / 2) continue;
      // The cross-section, read the way the radial gradient reads it: by how
      // far off the tube's own radius the point sits.
      const s = Math.max(-1, Math.min(1, (Math.hypot(x - C.x, y - C.y) - a.r) / (a.w / 2)));
      rgb = ramp(TUBE, s).slice(0, 3);
      // The filament: a hairline stroke down the centreline, blurred.
      const d = Math.abs(s) * (a.w / 2);
      const t = phi((a.core / 2 - d) / CORE.blur) + phi((a.core / 2 + d) / CORE.blur) - 1;
      if (t > 0.004) rgb = over([...hex(CORE.color), CORE.opacity * t], rgb);
      break;
    }
  }

  rgb = over(ramp(SHEEN.stops, (y - SHEEN.y1) / (SHEEN.y2 - SHEEN.y1)), rgb);

  if (inBead && Math.hypot(x - SPEC.x, y - SPEC.y) <= SPEC.r) rgb = hex(SPEC.color);

  return [...rgb, 255];
}

/* -- raster ---------------------------------------------------------------- */

const SS = 4; // samples per axis

function render(size, { fullBleed = false, inset = 1 } = {}) {
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
          const gy = 32 + (uy - 32) / inset;
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

/* The mark is drawn to the edge of its own 64-unit box, so on a plate it wants
   the same 0.8 it gets in icon.svg - and less again where the OS will crop. */
write('apple-touch-icon.png', 180, { inset: 0.8 });
write('icon-192.png', 192, { inset: 0.8 });
write('icon-512.png', 512, { inset: 0.8 });
write('icon-maskable-512.png', 512, { fullBleed: true, inset: 0.66 });
