# Squarespace Markdown Worker

A Cloudflare Worker that **intercepts requests to a Squarespace-backed site** and, when the request includes `?format=markdown`, returns a **plain Markdown representation** of the page for AI agents and other tools to ingest.

When `format` is not `markdown`, the Worker **passes the request through unchanged**.

## How it works

- **Normal traffic**: if `format !== markdown`, the Worker returns `fetch(request)` (no behavior change).
- **Markdown traffic**: if `?format=markdown` is present:
  - Removes `format` from the URL to create a “clean” page URL
  - Fetches the page HTML at the clean URL
  - Builds a Markdown response:
    - YAML frontmatter: `title`, `description`, `url` (derived from HTML metadata where available)
    - `# {title}` heading
    - Extracted text content from HTML using Cloudflare `HTMLRewriter` focused on Squarespace content containers
  - Responds with:
    - `Content-Type: text/markdown; charset=utf-8`
    - `Cache-Control: public, max-age=3600`

## Usage

Request any page with the query string:

- `https://your-site.example/some-page?format=markdown`

The Worker will return Markdown instead of HTML.

## Deploy

This repo uses Wrangler.

- Install dependencies:

```bash
npm install
```

- Deploy:

```bash
npm run deploy
```

## Testing (local markdown generation)

There’s a small local test harness that runs the Worker in **Miniflare** and generates markdown from a local HTML file.
It injects the HTML into the Worker via the `TEST_HTML` binding (so the Worker doesn’t make any upstream network requests during this test).

### Files

- `test/page.html`: input HTML (gitignored)
- `test/output.md`: generated output (gitignored)

### Run

1. Put some HTML you want to test into `test/page.html`
2. Run:

```bash
npm run test:generate
```

3. Inspect the output at `test/output.md`

## Configuration

Worker entrypoint is `src/index.js`.

Routes are defined in `wrangler.toml` (example configured for the `goldenhistorytours.com` zone and `*.goldenhistorytours.com/*` route pattern).

## Google Analytics (GA4) tracking (optional)

This Worker can optionally send a **server-side GA4 Measurement Protocol** event when `?format=markdown` is requested. This works for **bots/agents** as well as browsers.

### What gets tracked

- **Event name**: `markdown_request`
- **Event params**:
  - `page_location`: canonical URL (or fallback URL)
  - `page_title`: extracted title
  - `format`: `"markdown"`
  - `traffic_type`: `"human" | "bot" | "unknown"` (best-effort heuristic)
  - `agent_family`: `"chatgpt" | "claude" | "googlebot" | ... | "unknown"` (best-effort heuristic)

### Configure secrets (Wrangler)

Set these as **secrets** (nothing is committed to git):

```bash
npx wrangler secret put GA4_API_SECRET
npx wrangler secret put GA4_MEASUREMENT_ID
```

To generate the API secret value in GA4:
- Go to **Google Analytics → Admin → Data streams → (your Web stream) → Measurement Protocol API secrets**
- Create a new secret (e.g. “Cloudflare Worker”) and copy its value into `GA4_API_SECRET`

If the secrets are not set, analytics is skipped and the Worker behaves normally.

## Notes / caveats

- The HTML-to-Markdown extraction is intentionally simple. It uses Cloudflare `HTMLRewriter` and targets common Squarespace section/content selectors; it aims for **readable text for ingestion**, not perfect fidelity.
- If the site’s markup differs from the expected Squarespace structure, extraction quality may vary.

