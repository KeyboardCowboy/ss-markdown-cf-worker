# CLAUDE.md — Project Context (Squarespace Markdown Worker)

## What this repo is
A Cloudflare Worker that sits in front of a Squarespace site and **returns Markdown** when the incoming request includes `?format=markdown`. Otherwise it **passes traffic through unchanged**.

Primary goal: make it easy for AI agents to ingest a page as plain text/Markdown by requesting the same URL with `format=markdown`.

## Runtime / entrypoints
- **Platform**: Cloudflare Workers
- **Entrypoint**: `src/index.js`
- **Config**: `wrangler.toml`
- **Deploy**: `npm run deploy` (Wrangler)

## Request behavior (high level)
- If `URLSearchParams.get("format") !== "markdown"`:
  - return `fetch(request)` (no modifications)
- If `?format=markdown`:
  - Create a “clean URL” by removing `format`
  - Fetch in parallel:
    - HTML from the clean URL
    - Squarespace JSON using `?format=json-pretty`
  - Extract:
    - `title`, `description`, `url` (from JSON)
    - `content` (text extracted from HTML; scripts/styles stripped; tags removed; whitespace cleaned)
  - Respond as Markdown:
    - Frontmatter: `title`, `description`, `url`
    - `# {title}`
    - content

## Output contract (important)
- **Content-Type**: `text/markdown; charset=utf-8`
- **Caching**: `Cache-Control: public, max-age=3600`
- On error: 500 with plain text message

## Guardrails for changes
- Keep the default path truly “transparent” (no side effects when `format` is not `markdown`).
- Prefer small, testable changes; keep the Worker dependency-free unless there’s a strong reason.
- If you change response shape, update docs (`README.md`) accordingly.

## Common tasks
- Add/adjust extraction logic in `extractTextContent()`
- Adjust frontmatter/markdown assembly in `buildMarkdown()`
- Update routing in `wrangler.toml`

