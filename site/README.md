# Free the Brain — marketing site

Plain static HTML and CSS. No framework, no dependencies, no runtime JavaScript. The only tooling is `build.mjs`, a dependency-free Node script that inlines the shared header, head and footer into the four pages; its output is committed, so the site deploys as-is.

## Pages

| File | What |
|---|---|
| `index.html` | Landing: the traced mark, the tagline, three feature blocks, the covenant, the Play button (placeholder) and the web-app link. |
| `privacy.html` | Plain-language privacy policy, written to satisfy the Google Play privacy-policy URL requirement. |
| `support.html` | Contact and the first questions. |
| `connect-your-ai.html` | Adding the MCP server as a custom connector in Claude and in ChatGPT; the covenant in one paragraph. |

## Editing

Edit `src/pages/*.html` and `src/partials/*.html`, then:

```sh
node build.mjs      # writes index.html, privacy.html, support.html, connect-your-ai.html
```

Each page starts with `<!-- @page title="…" description="…" -->`; partials are pulled in with `<!-- @include head -->` etc. `{{active:NAME}}` marks the current nav link. Styles are in `styles.css` (brand tokens per `docs/brand-system.md`), the display face is self-hosted in `fonts/`, and images are in `assets/` (copies of `data/brand/derived/`).

## Placeholders to replace before launch

- `https://app.freethebrain.app` — the web app (header, hero, footer, support). The domain is a placeholder.
- `https://mcp.freethebrain.app/mcp` — the MCP server URL on the Connect page.
- `privacy@freethebrain.app`, `support@freethebrain.app` — contact addresses.
- The "Get it on Google Play" button is a disabled placeholder; swap it for the real badge and store link once the listing is live.
- `https://freethebrain.app` in the canonical and Open Graph tags (`src/partials/head.html`).

Every placeholder in the visible copy is marked with a dashed outline (`.placeholder`) so it cannot ship unnoticed.

## Cloudflare Pages settings

| Setting | Value |
|---|---|
| Production branch | `main` |
| Root directory | `site` |
| Build command | *(none)* |
| Build output directory | `/` (that is, `site/` itself) |
| Custom domain | `freethebrain.app` (the app is on `app.` and is deployed separately from `client/`) |

`_headers` sets a strict Content-Security-Policy (no scripts, everything same-origin), caching for fonts and assets, and the usual hardening headers. Cloudflare Pages serves `src/` and `build.mjs` too; they are harmless, but a `_redirects` rule can hide them if wanted.

## Checks

Screenshots at 390 px and 1280 px are in `docs/screenshots/site-*.png`. Lighthouse expectations: no third-party requests, one preloaded 12 KB font, one 156 KB SVG in the hero (brotli takes it to about 40 KB on Pages), no layout shift (the hero image carries width and height).
