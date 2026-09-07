/* Placeholder icons, generated programmatically — no external artwork.
   A periwinkle disc (--brand-periwinkle) with a simple pink brain-like blob (--brand-brain) drawn as the
   union of two lobes plus a few "folds", outlined in the brand outline ink. Rasterised into RGBA and
   encoded as PNG with Node's zlib only, so the script needs no image library. Also writes an SVG. */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "icons");
mkdirSync(out, { recursive: true });

const PERI = [0x8e, 0x9d, 0xfa], BRAIN = [0xb8, 0x70, 0x88], CREAM = [0xf8, 0xf0, 0xf0], OUT = [0x1c, 0x1b, 0x18];

/* ---- geometry in a unit square (0..1) ---- */
const lobes = [
  { cx: 0.40, cy: 0.50, r: 0.20 },
  { cx: 0.60, cy: 0.50, r: 0.20 },
  { cx: 0.50, cy: 0.40, r: 0.19 },
  { cx: 0.50, cy: 0.58, r: 0.17 },
];
const folds = [
  [0.50, 0.30, 0.50, 0.72],                 // central fissure
  [0.34, 0.44, 0.44, 0.40],
  [0.56, 0.40, 0.66, 0.44],
  [0.34, 0.58, 0.45, 0.60],
  [0.55, 0.60, 0.66, 0.58],
];
function inBlob(x, y) {
  return lobes.some((l) => (x - l.cx) ** 2 + (y - l.cy) ** 2 <= l.r * l.r);
}
function distSeg(x, y, [ax, ay, bx, by]) {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}
function blobEdge(x, y, eps) {
  // near the outline of the union: inside, but some 4-neighbour at distance eps is outside
  if (!inBlob(x, y)) return false;
  return !inBlob(x + eps, y) || !inBlob(x - eps, y) || !inBlob(x, y + eps) || !inBlob(x, y - eps);
}

function raster(size, maskable) {
  const px = new Uint8Array(size * size * 4);
  const ss = 3; // supersampling per axis
  const discR = maskable ? 0.60 : 0.47;
  const scale = maskable ? 0.72 : 1; // keep the blob inside the maskable safe zone
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < ss; sj++)
        for (let si = 0; si < ss; si++) {
          const x = (i + (si + 0.5) / ss) / size, y = (j + (sj + 0.5) / ss) / size;
          const d = Math.hypot(x - 0.5, y - 0.5);
          let c = null;
          if (maskable || d <= discR) {
            c = PERI;
            if (!maskable && d > discR - 0.012) c = OUT;
            const bx = 0.5 + (x - 0.5) / scale, by = 0.5 + (y - 0.5) / scale;
            if (inBlob(bx, by)) {
              c = BRAIN;
              if (blobEdge(bx, by, 0.012)) c = OUT;
              else if (folds.some((f) => distSeg(bx, by, f) < 0.012)) c = CREAM;
            }
          }
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      const n = ss * ss, o = (j * size + i) * 4;
      if (a) { px[o] = r / (a / 255); px[o + 1] = g / (a / 255); px[o + 2] = b / (a / 255); px[o + 3] = a / n; }
    }
  return px;
}

/* ---- PNG encoder ---- */
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const t = Buffer.from(type, "ascii"), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let j = 0; j < size; j++) { raw[j * (size * 4 + 1)] = 0; Buffer.from(px.buffer, j * size * 4, size * 4).copy(raw, j * (size * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

for (const [name, size, maskable] of [["icon-192.png", 192, false], ["icon-512.png", 512, false], ["icon-maskable-512.png", 512, true]]) {
  writeFileSync(join(out, name), png(size, raster(size, maskable)));
  console.log("wrote", name);
}

/* ---- SVG twin of the same drawing ---- */
const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<circle cx="50" cy="50" r="47" fill="${hex(PERI)}" stroke="${hex(OUT)}" stroke-width="1.2"/>
<g fill="${hex(BRAIN)}" stroke="${hex(OUT)}" stroke-width="1.2" stroke-linejoin="round">
${lobes.map((l) => `<circle cx="${l.cx * 100}" cy="${l.cy * 100}" r="${l.r * 100}"/>`).join("\n")}
</g>
<g fill="${hex(BRAIN)}">${lobes.map((l) => `<circle cx="${l.cx * 100}" cy="${l.cy * 100}" r="${l.r * 100 - 1.2}"/>`).join("")}</g>
<g stroke="${hex(CREAM)}" stroke-width="1.6" stroke-linecap="round" fill="none">
${folds.map(([ax, ay, bx, by]) => `<line x1="${ax * 100}" y1="${ay * 100}" x2="${bx * 100}" y2="${by * 100}"/>`).join("\n")}
</g>
</svg>
`;
writeFileSync(join(out, "icon.svg"), svg);
console.log("wrote icon.svg");
