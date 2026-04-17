# Changelog

## [1.3.1] — 2026-04-17
- Fix duplicate button links — Squarespace renders each button in both a desktop and mobile container; scoped the button selector to `sqs-button-block-container-system_desktop` to emit each link once

## [1.3.0] — 2026-04-17
- Capture testimonial blockquotes (`blockquote[data-animation-role="quote"]`) as markdown blockquotes (`> text`)
- Capture figcaption attributions (`figcaption.source`) as italic lines immediately below their blockquote (`*— attribution*`)
- Strip decorative curly-quote spans from blockquote text

## [1.2.0]
- Add inline links within paragraph content
- Add button block links (`.sqs-block-button`)
- Add `.md` URL support — requests to `/path.md` are treated as `?format=markdown`
- Fix `.md` extension stripper so the upstream fetch uses the clean path
- Add summary item title extraction for blog/carousel blocks (emitted as `### [Title](url)`)
- Fix summary section formatting

## [1.1.0]
- Add GA4 Measurement Protocol tracking (server-side, fire-and-forget via `ctx.waitUntil`)
- Classify traffic as human / bot / unknown and tag common agent families (ChatGPT, Claude, Googlebot, etc.)

## [1.0.2]
- Move version string to a `MARKDOWN_VERSION` constant; include it in the markdown frontmatter

## [1.0.1]
- Bug fixes to extraction script and test harness

## [1.0.0]
- Initial implementation: Cloudflare Worker that returns `text/markdown` when `?format=markdown` is present
- Extracts title, description, and body content via `HTMLRewriter`
- Transparent proxy pass-through for all other requests
