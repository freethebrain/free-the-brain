/* Native asset sources for @capacitor/assets, drawn from the same brain mark as public/icons/icon.svg:
     assets/icon-only.png          1024²  the disc icon (legacy launcher, iOS later)
     assets/icon-foreground.png    1024²  adaptive-icon foreground: the brain blob alone, transparent
                                          field, scaled into the 66/108 safe zone
     assets/icon-background.png    1024²  adaptive-icon background: solid brand periwinkle #8e9dfa
     assets/splash.png             2732²  periwinkle field, mark centred
     assets/splash-dark.png        2732²  the same (the brand field is the brand field in both themes)
   and, outside the tool's remit, the status-bar notification icon Android wants white-on-alpha:
     android/app/src/main/res/drawable-*dpi/ic_stat_notify.png  (24/36/48/72/96 px)

   Then: npx capacitor-assets generate --android   (see docs/android-release.md, step 3)

   Uses sharp, which @capacitor/assets brings in; `npm run icons:native` from client/. */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const assets = join(root, "assets");
const res = join(root, "android", "app", "src", "main", "res");
mkdirSync(assets, { recursive: true });

const PERI = "#8e9dfa", BRAIN = "#b87088", CREAM = "#f8f0f0", OUT = "#1c1b18";

/* the same geometry as scripts/gen-icons.mjs, in a 100×100 box */
const lobes = [
  { cx: 40, cy: 50, r: 20 },
  { cx: 60, cy: 50, r: 20 },
  { cx: 50, cy: 40, r: 19 },
  { cx: 50, cy: 58, r: 17 },
];
const folds = [
  [50, 30, 50, 72],
  [34, 44, 44, 40],
  [56, 40, 66, 44],
  [34, 58, 45, 60],
  [55, 60, 66, 58],
];

/** The brain blob: outline, fill, folds — as an SVG group. `fill`/`fold` let the notification icon reuse it. */
function blob({ fill = BRAIN, stroke = OUT, fold = CREAM, strokeW = 1.2, foldW = 1.6 } = {}) {
  return (
    `<g fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" stroke-linejoin="round">` +
    lobes.map((l) => `<circle cx="${l.cx}" cy="${l.cy}" r="${l.r}"/>`).join("") +
    `</g><g fill="${fill}">` +
    lobes.map((l) => `<circle cx="${l.cx}" cy="${l.cy}" r="${l.r - strokeW}"/>`).join("") +
    `</g><g stroke="${fold}" stroke-width="${foldW}" stroke-linecap="round" fill="none">` +
    folds.map(([ax, ay, bx, by]) => `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>`).join("") +
    `</g>`
  );
}
const svg = (body, size = 100) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${body}</svg>`);
/** scale a 100-box group about its centre */
const centred = (inner, k) => `<g transform="translate(50 50) scale(${k}) translate(-50 -50)">${inner}</g>`;

async function png(svgBuf, size, file) {
  await sharp(svgBuf, { density: 300 }).resize(size, size).png().toFile(file);
  console.log("wrote", file.replace(root + "/", ""));
}

/* 1. the disc icon — icon.svg's drawing */
await png(svg(`<circle cx="50" cy="50" r="47" fill="${PERI}" stroke="${OUT}" stroke-width="1.2"/>` + blob()), 1024, join(assets, "icon-only.png"));

/* 2. adaptive foreground: blob alone on transparency, inside the safe zone (66/108 of the canvas).
      The blob spans 60 of 100 → ×0.9 keeps it within the 61%-diameter safe circle with a margin. */
await png(svg(centred(blob(), 0.9)), 1024, join(assets, "icon-foreground.png"));

/* 3. adaptive background: solid periwinkle */
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: PERI } }).png().toFile(join(assets, "icon-background.png"));
console.log("wrote assets/icon-background.png");

/* 4. splash: periwinkle field with the mark at ~28% of the short side; the plugin centre-crops it. */
const splash = svg(`<rect width="100" height="100" fill="${PERI}"/>` + centred(blob(), 0.5));
await png(splash, 2732, join(assets, "splash.png"));
await png(splash, 2732, join(assets, "splash-dark.png"));

/* 5. notification small icon: Android renders only the alpha, tinted by iconColor. Draw the blob
      white with the folds and outline transparent, at each density of a 24dp icon. */
const statSvg = svg(centred(blob({ fill: "#ffffff", stroke: "none", fold: "#000000", strokeW: 0, foldW: 3 }), 1.0));
for (const [dir, px] of [["mdpi", 24], ["hdpi", 36], ["xhdpi", 48], ["xxhdpi", 72], ["xxxhdpi", 96]]) {
  const raw = await sharp(statSvg, { density: 300 }).resize(px, px).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = raw;
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255; // black folds → 0
    data[i + 3] = Math.round(data[i + 3] * lum);
    data[i] = data[i + 1] = data[i + 2] = 255;
  }
  const out = join(res, "drawable-" + dir);
  mkdirSync(out, { recursive: true });
  const file = join(out, "ic_stat_notify.png");
  writeFileSync(file, await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer());
  console.log("wrote", file.replace(root + "/", ""));
}
