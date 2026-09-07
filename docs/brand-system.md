# Free the Brain — Brand System

*Derived 2026-09-07 from FtB's own artwork in `data/brand/` — the logo, the "This is you" image, and the 2019 five-pager. Everything here is traced, sampled or chosen from those three files; nothing is drawn new and nothing is borrowed from outside. The vector mark and the icon set live in `data/brand/derived/`; the site's copies are in `site/assets/`.*

## 1. The story in two frames

The logo is a hand-drawn brain in dusty pink with a heavy black outline, "FREE THE BRAIN" in chunky cream display letters across it, on a periwinkle field with concentric light rings. The second image is the same brain alone on slate grey, captioned "THIS IS YOU." Read together: *this is you* — a brain carrying too much — and *free the brain* — the app carries it instead. The tagline follows directly:

> **This is you. Let it think about something else.**

## 2. Palette

Sampled from the assets. Hex values are the ones in use across `client/`, `site/` and the icons; do not re-sample per surface.

| Token | Hex | Source | Use |
|---|---|---|---|
| `periwinkle` | `#8e9dfa` | logo background; the five-pager's page field samples at `#8999fb`, close enough to share the token | app icon field, splash, site hero, primary buttons on the site, the *Send* button in the app |
| `ring` | `#b0c8f8` | the concentric rings | rings on the icon background and hero, hover states, loading motif |
| `brain` | `#b87088` | the brain fill (median sampled `#bd7589`) | the mark's fill; accent in monochrome contexts; the covenant rule on the site |
| `brain-highlight` | `#e6adbf` | the glossy strokes on the gyri | third layer of the mark only; never a UI colour |
| `outline` | `#1c1b18` | the black line — identical to the widget's `--ink` | the mark's lines; text on periwinkle; the dark button in the hero |
| `cream` | `#f8f0f0` | the logo lettering | lettering on periwinkle in the *logo* and splash; text on the dark hero button |
| `slate` | `#b0bcc8` | "This is you" background | onboarding, about and empty-state surfaces |
| `stripe-1` | `#c3cbfc` | five-pager page 1, mid stripe | stripe motif |
| `stripe-2` | `#ced6fd` | five-pager page 1, light stripe | stripe motif |
| `stripe-white` | `#ffffff` | five-pager page 1, white stripe | stripe motif |

**Contrast note.** Cream on periwinkle is about 2.1:1 — fine for the logo's lettering (it has a black stroke), not fine for text. On any periwinkle surface, *text* is `outline` (`#1c1b18`, about 7:1). The site's hero heading is therefore ink, not cream; only the logo itself keeps cream letters.

## 3. The mark

**The brain alone is the mark.** The wordmark is illegible below about 200 px wide, so the icon, the favicon, the header mark and the social image all use the brain with no lettering. The full logo (brain + lettering + rings) is reserved for the splash screen and large print, and is used as the JPEG until a vector of the lettering exists.

Three layers, traced with potrace from `the_soul_by_freethebrain.jpg` at 4× and stacked bottom-up:

1. **fill** — the silhouette, `brain`;
2. **highlight** — the glossy strokes, `brain-highlight`;
3. **lines** — the outer outline and the gyri, `outline`.

Files in `data/brand/derived/`:

| File | What | Where it is used |
|---|---|---|
| `brain-mark.svg` | the three-layer mark, viewBox 2432×1784 (aspect 1.36:1) | site hero and header; onboarding; empty states |
| `brain-silhouette.svg` | fill layer only, `fill="currentColor"` so CSS recolours it | monochrome contexts: ring animation, watermarks, print |
| `favicon.svg` | periwinkle disc + silhouette with a dark stroke, no interior lines (16 KB) | browser tab |
| `icon-192.png`, `icon-512.png`, `icon-1024.png` | the mark on a full-bleed periwinkle disc with one faint ring | PWA manifest, Play listing icon (512), stores (1024) |
| `adaptive-icon-foreground-1024.png` | the mark alone on transparent, sized to the 66/108 safe zone | Android adaptive icon foreground |
| `adaptive-icon-background-1024.png` | periwinkle with three rings | Android adaptive icon background (optional layer) |
| `feature-graphic-1024x500.png` | periwinkle field, the stripe motif, the mark centred on a plain disc, no text | Google Play feature graphic; social preview |

Rules:

- The brain always faces left, as drawn. Never mirror it.
- Never put the brain on the pink; it sits on periwinkle, cream, paper, or slate.
- Never add text inside the brain except the original lettering in the full logo.
- The interior lines are the mark's texture; below about 48 px they turn to noise, so small sizes use the favicon composition (silhouette + outline stroke).
- Do not draw a new brain. If the trace needs improving, retrace from the same source with the script in this session's notes (`potrace`, 4× bicubic upscale, luminance threshold 112 for lines, 168 for highlights).

## 4. The stripe motif

Page 1 of the five-pager is a periwinkle page crossed by broad diagonal bands in three tints — `stripe-1`, `stripe-2` and white — running from lower-left to upper-right at roughly 14° off horizontal. It is the brand's one pattern.

Rule: **stripes are a divider, never a background for text.** On the site it is a 56 px band between the hero and the content, and again above the footer (`.stripes` in `site/styles.css` — a `repeating-linear-gradient` at −14°). On the feature graphic the stripes cross the whole field and the brain sits on a plain periwinkle disc in front of them, so nothing busy touches the mark. In the app the motif is allowed on the splash and the onboarding cards; nowhere else.

## 5. Type

The logo's lettering is a heavy, rounded, condensed display face. Three open-licence candidates were rendered as "Free the Brain" beside the logo:

- **Luckiest Guy** (Apache 2.0) — the closest match to the logo's hand-lettered caps, but caps-only, and its bouncing baseline reads as a second logo when the two sit together.
- **Titan One** (OFL) — right weight, but wider and rounder than the logo; it drifts toward toy-shop.
- **Lilita One** (OFL) — the same heavy rounded weight and condensed proportions, has a lowercase, stays calm at heading sizes, and is 12 KB as woff2.

**Decision: Lilita One** for headings, the tagline and the wordmark-in-text. The tagline is sentence case, which rules out the caps-only face on its own. It is self-hosted at `site/fonts/LilitaOne-Regular.woff2` with its OFL licence beside it; nothing is loaded from Google Fonts at runtime. Fallback stack: `"Arial Rounded MT Bold", "Trebuchet MS", ui-rounded, system-ui, sans-serif`.

**UI text stays the system sans** — `-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif` — in the app and in the site's body copy. Legibility on a phone is not negotiable, and the display face is for saying the name, not for reading a task list.

## 6. Voice

From the five-pager's stated values — *curiosity, honesty, style* — turned into rules for copy:

- **Plain.** Short words, short sentences, no product-speak. "Type the task the way it came to you," not "frictionless capture experience."
- **Brief.** Say it once. A feature gets a heading and two sentences.
- **Curious.** The tone of someone who finds the problem interesting rather than someone selling the cure.
- **Honest.** Say what is not done: "in closed testing", "placeholder until the domain is live", "not guaranteed on the phone apps yet". Never claim a document, feature or connection exists when it is only planned.

Second person, present tense. "You judge" rather than "the user judges". No exclamation marks. No emoji.

## 7. Where brand colour is, and is not, allowed in the app

The working surface — the task list, the row editor, the queue, the radar — keeps the widget's warm paper theme (`--bg #fbfaf8` / dark `#14130f`) and its category hue system untouched. The hues are the signature there, and everything else stays quiet so they can be.

Brand colour lives at the edges:

| Allowed | Not allowed |
|---|---|
| App icon, splash, onboarding, empty-state illustration | Row backgrounds, category chips, status colours |
| The *Send* button (periwinkle) — the one place brand and tool meet; drop it if it shouts | Headings inside the working surface in the display face |
| Ring animation on send and on the splash | Stripes anywhere on the working surface |
| The site: hero, buttons, dividers, footer | Body copy on periwinkle in cream |

Motion is one motif: the rings. A slow breathe on the splash and the site hero (disabled under `prefers-reduced-motion`), a single ring expanding out of *Send* when a batch lands. Nothing else moves.

## 8. Source files and provenance

- `data/brand/FreetheBrain Logo.jpg` — 750×600, the full logo.
- `data/brand/the_soul_by_freethebrain.jpg` — 1000×800, the brain alone; the trace source.
- `data/brand/5-pager - FreetheBrain - InDesign.pdf` — 2019 show pitch; page 1 is the stripe source, page 2 carries a circular periwinkle badge with the brain. Pages 2 onward contain personal contact details and are **not** to be reproduced or quoted on any public surface.
- Fonts: Lilita One © 2011 Juan Montoreano, SIL Open Font License 1.1 (`site/fonts/LilitaOne-OFL.txt`).
