# Squarespace Markdown Worker

A Cloudflare Worker that **intercepts requests to a Squarespace-backed site** and, when the request includes `?format=markdown`, returns a **plain Markdown representation** of the page for AI agents and other tools to ingest.

When `format` is not `markdown`, the Worker **passes the request through unchanged**.

## How it works

- **Normal traffic**: if `format !== markdown`, the Worker returns `fetch(request)` (no behavior change).
- **Markdown traffic**: if `?format=markdown` is present:
  - Removes `format` from the URL to create a “clean” page URL
  - Fetches in parallel:
    - The page HTML at the clean URL
    - Squarespace JSON for the same page using `?format=json-pretty`
  - Builds a Markdown response:
    - YAML frontmatter: `title`, `description`, `url`
    - `# {title}` heading
    - Extracted text content from HTML (scripts/styles stripped, tags removed, whitespace cleaned)
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

## Configuration

Worker entrypoint is `src/index.js`.

Routes are defined in `wrangler.toml` (example configured for the `goldenhistorytours.com` zone and `*.goldenhistorytours.com/*` route pattern).

## Notes / caveats

- The HTML-to-text extraction is intentionally simple (regex-based). It aims for **readable text for ingestion**, not perfect fidelity.
- The Worker relies on Squarespace’s `format=json-pretty` output being available for the target site/page.

