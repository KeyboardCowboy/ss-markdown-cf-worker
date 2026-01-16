# Project: Squarespace Markdown Worker

## Overview
Cloudflare Worker that intercepts Squarespace site traffic and, when `?format=markdown` is present, returns a plain Markdown representation of the page for AI ingestion. Non-markdown requests are passed through unchanged.

## Current status
- **Repository initialized**: ✅
- **Worker implemented** (`src/index.js`): ✅
- **Wrangler config** (`wrangler.toml`): ✅
- **Docs**
  - `README.md`: ✅
  - `CLAUDE.md`: ✅
  - `project.md`: ⏳ (this file)

## Milestones
- **M1: Basic markdown endpoint**
  - [x] Detect `?format=markdown`
  - [x] Fetch HTML + Squarespace JSON (`format=json-pretty`)
  - [x] Produce markdown with frontmatter + extracted text
  - [x] Set markdown content-type + caching
- **M2: Content quality improvements (optional)**
  - [ ] Improve content extraction beyond regex (e.g., target known Squarespace content containers)
  - [ ] Preserve basic structure (headings/lists) when possible
  - [ ] Reduce boilerplate/nav/footer noise
- **M3: Operational hardening (optional)**
  - [ ] Better error responses (include which upstream failed)
  - [ ] Add cache key strategy notes (query param behavior, purge approach)
  - [ ] Add observability (minimal logging / sampling)
- **M4: Agent UX (optional)**
  - [ ] Add `?format=markdown&include=...` toggles (frontmatter-only, content-only, etc.)
  - [ ] Add `?format=markdown&maxChars=...` truncation option for small context windows

## Decisions log
- **Intercept mechanism**: query string `format=markdown`
- **Squarespace metadata source**: `format=json-pretty`
- **Cache policy**: `public, max-age=3600`
- **Extraction approach**: regex-based HTML stripping with optional `<article>` focus

## Risks / open questions
- **Squarespace JSON availability**: some pages may not expose `format=json-pretty` consistently.
- **Extraction fidelity**: regex stripping may lose structure and include unwanted site chrome.
- **URL construction**: `json.website.baseUrl` + `json.collection.fullUrl` assumes these fields are present.
- **Routes**: confirm desired domains/patterns in `wrangler.toml` for each environment.

## Next steps (near term)
- [ ] Add a couple of real-world sample URLs and expected output notes (private/internal if needed)
- [ ] Decide whether to prioritize extraction quality (M2) vs operational hardening (M3)
- [ ] Add tracking for `?format=markdown` hits:
  - Option A: client-side GA4 event (works for browsers only)
  - Option B (preferred): server-side GA4 Measurement Protocol event from the Worker (works for agents/crawlers)
  - Required inputs: GA4 Measurement ID (`G-...`) + Measurement Protocol API secret
  - Decide what identifier to use for non-browser agents (synthetic `client_id`, hashed IP, etc.)

## Notes
- Deployed with Wrangler via `npm run deploy`.

