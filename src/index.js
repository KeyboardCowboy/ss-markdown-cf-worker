const MARKDOWN_VERSION = "1.1.0";
const BR_TOKEN = "__SSMD_BR__";

/**
 * Cloudflare Worker entrypoint.
 *
 * Behavior:
 * - If `?format=markdown` is NOT present, we transparently proxy the request.
 * - If `?format=markdown` IS present, we fetch the page HTML, extract a simplified
 *   markdown representation, and return `text/markdown`.
 *
 * `env` contains Wrangler bindings (vars/secrets). `ctx.waitUntil()` lets us
 * fire-and-forget background work (like analytics) without delaying responses.
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only process markdown requests; all other traffic is passed through unchanged.
    const isMarkdownFormat =
      url.searchParams.get("format") === "markdown" ||
      url.pathname.endsWith(".md");
    if (!isMarkdownFormat) {
      return fetch(request);
    }

    // Build a "clean" URL by removing `format=markdown` before fetching the upstream page.
    // This avoids interfering with Squarespace rendering/caching.
    const cleanURL = new URL(url);
    cleanURL.searchParams.delete("format");

    try {
      // In tests, allow injecting HTML directly to avoid network fetches
      const html =
        env && typeof env.TEST_HTML === "string" && env.TEST_HTML.length
          ? env.TEST_HTML
          : await (
              await fetch(new Request(cleanURL.toString(), request))
            ).text();

      // Convert upstream HTML into structured pieces we can format into Markdown.
      const pageData = await extractPageDataFromHtml(html, cleanURL.toString());

      const title = pageData.title || "Page";
      const description = pageData.description || "";
      const pageUrl = pageData.url || cleanURL.toString();
      const content = pageData.content || "";

      // Assemble the final Markdown response (frontmatter + title + content).
      const markdown = buildMarkdown(title, description, pageUrl, content);

      // Optional GA4 Measurement Protocol tracking (server-side; works for agents/bots too)
      if (env?.GA4_MEASUREMENT_ID && env?.GA4_API_SECRET) {
        // Best-effort classifier based on request headers (UA + browser-only headers).
        const traffic = classifyTraffic(request);

        // GA4 requires a client_id. We generate an anonymous one per request.
        // (If you want stable IDs later, we can hash IP/UA with a secret salt.)
        const clientId =
          globalThis.crypto && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : String(Date.now());

        // Measurement Protocol payload: https://developers.google.com/analytics/devguides/collection/protocol/ga4
        const eventBody = {
          client_id: clientId,
          events: [
            {
              name: "markdown_request",
              params: {
                page_location: pageUrl,
                page_title: title,
                format: "markdown",
                traffic_type: traffic.trafficType, // human|bot|unknown
                agent_family: traffic.agentFamily, // chatgpt|claude|googlebot|...
              },
            },
          ],
        };

        // Fire-and-forget so analytics never slows down the markdown response.
        const p = sendGa4Event(env, eventBody).catch(() => {});
        if (ctx?.waitUntil) ctx.waitUntil(p);
      }

      return new Response(markdown, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch (error) {
      return new Response(`Error: ${error.message}`, {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }
  },
};

/**
 * Send a GA4 Measurement Protocol event.
 *
 * This is intentionally "best effort": if it fails, we ignore the error to avoid
 * impacting the primary markdown response.
 *
 * Secrets/vars used:
 * - env.GA4_MEASUREMENT_ID (e.g. "G-XXXXXXX")
 * - env.GA4_API_SECRET (measurement protocol secret)
 */
function sendGa4Event(env, body) {
  const measurementId = String(env.GA4_MEASUREMENT_ID || "");
  const apiSecret = String(env.GA4_API_SECRET || "");
  if (!measurementId || !apiSecret) return Promise.resolve();

  // Construct the Measurement Protocol endpoint.
  const endpoint =
    `https://www.google-analytics.com/mp/collect` +
    `?measurement_id=${encodeURIComponent(measurementId)}` +
    `&api_secret=${encodeURIComponent(apiSecret)}`;

  // POST JSON payload to GA4.
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(() => {});
}

/**
 * Classify inbound traffic as "human", "bot", or "unknown", and (best-effort)
 * label common agent families from the User-Agent string.
 *
 * Notes:
 * - This is heuristic-based and can be spoofed.
 * - We do NOT send the raw user-agent to GA4 by default (privacy-friendly).
 */
function classifyTraffic(request) {
  const uaRaw = request.headers.get("user-agent") || "";
  const ua = uaRaw.toLowerCase();

  // Common browser-only headers (strong "human" hint)
  const hasBrowserHints =
    request.headers.has("sec-ch-ua") ||
    request.headers.has("sec-fetch-site") ||
    request.headers.has("sec-fetch-mode") ||
    request.headers.has("sec-fetch-user");

  // Strong "bot" hint: many crawlers/agents include recognizable substrings in UA.
  const botUaPatterns = [
    "bot",
    "spider",
    "crawler",
    "slurp",
    "facebookexternalhit",
    "discordbot",
    "twitterbot",
    "linkedinbot",
    "slackbot",
    "telegrambot",
    "whatsapp",
    "gptbot",
    "google-extended",
    "googlebot",
    "bingbot",
    "yandexbot",
    "duckduckbot",
    "claudebot",
    "chatgpt-user",
    "openai",
    "anthropic",
  ];

  const isBot = botUaPatterns.some((p) => ua.includes(p));

  // Map UA substrings to a small set of agent families for easier reporting in GA4.
  let agentFamily = "unknown";
  if (
    ua.includes("chatgpt-user") ||
    ua.includes("openai") ||
    ua.includes("gptbot")
  )
    agentFamily = "chatgpt";
  else if (ua.includes("claudebot") || ua.includes("anthropic"))
    agentFamily = "claude";
  else if (ua.includes("googlebot") || ua.includes("google-extended"))
    agentFamily = "googlebot";
  else if (ua.includes("bingbot")) agentFamily = "bingbot";
  else if (ua.includes("yandexbot")) agentFamily = "yandexbot";
  else if (ua.includes("duckduckbot")) agentFamily = "duckduckgo";
  else if (ua.includes("facebookexternalhit")) agentFamily = "facebook";
  else if (ua.includes("twitterbot")) agentFamily = "twitter";
  else if (ua.includes("linkedinbot")) agentFamily = "linkedin";
  else if (ua.includes("discordbot")) agentFamily = "discord";
  else if (ua.includes("slackbot")) agentFamily = "slack";
  else if (ua.includes("telegrambot")) agentFamily = "telegram";

  // Final classification:
  // - bots win if we recognize bot substrings
  // - otherwise if we see modern browser-only headers, call it "human"
  let trafficType = "unknown";
  if (isBot) trafficType = "bot";
  else if (hasBrowserHints) trafficType = "human";

  return { trafficType, agentFamily };
}

/**
 * Extracts a minimal, readable representation of a Squarespace page from raw HTML.
 *
 * We use Cloudflare's `HTMLRewriter` to "stream-parse" the HTML and collect:
 * - `description` from `<meta name="description">`
 * - `canonical` URL from `<link rel="canonical">`
 * - `titleParts` by grabbing H1 text in the main content sections
 * - `blocks` of content (h2/h3/p/li) from within the main content wrapper
 *
 * The output is a structured object that we later convert to Markdown.
 */
async function extractPageDataFromHtml(html, fallbackUrl) {
  const state = {
    description: "",
    canonical: "",
    titleParts: [],
    collectingTitle: true,

    blocks: [],
    current: null,

    // context
    inLiDepth: 0,
    linkStack: [],
  };

  // Start capturing a new "block" (paragraph, heading, list item).
  const beginBlock = (kind) => {
    state.current = { kind, text: "" };
  };

  // Append text into the current block, with special handling for links.
  // When inside an <a>, we temporarily collect link text into linkStack
  // so we can emit a single markdown link like: [text](href).
  const appendToCurrent = (s) => {
    if (!state.current) return;

    if (state.linkStack.length) {
      state.linkStack[state.linkStack.length - 1].text += s;
      return;
    }

    state.current.text += s;
  };

  // Finish the current block: normalize whitespace and store it if non-empty.
  const endBlock = () => {
    if (!state.current) return;

    const kind = state.current.kind;
    const text =
      kind === "h2" || kind === "h3" || kind === "li"
        ? normalizeInlineText(state.current.text)
        : normalizeBlockText(state.current.text);

    if (text) state.blocks.push({ kind, text });
    state.current = null;
  };

  // Begin link capture. We resolve relative URLs against the canonical/fallback URL.
  const pushLink = (href) => {
    const base = state.canonical || fallbackUrl;
    let resolved = href || "";
    try {
      resolved = new URL(href, base).toString();
    } catch {
      // leave as-is
    }
    state.linkStack.push({ href: resolved, text: "" });
  };

  // End link capture and append the markdown form into the current block.
  const popLinkToCurrent = () => {
    const link = state.linkStack.pop();
    if (!link) return;

    const text = normalizeInlineText(link.text) || link.href || "";
    if (!text) return;

    appendToCurrent(`[${text}](${link.href})`);
  };

  // We allow multiple H1 fragments to build a title until we start hitting real content.
  const stopCollectingTitleIfNeeded = () => {
    if (state.collectingTitle) state.collectingTitle = false;
  };

  // HTMLRewriter "watches" for matching elements and calls handlers as it parses HTML.
  const rewriter = new HTMLRewriter()
    // metadata
    .on('meta[name="description"]', {
      element(el) {
        if (!state.description) {
          state.description = normalizeInlineText(
            el.getAttribute("content") || ""
          );
        }
      },
    })
    .on('link[rel="canonical"]', {
      element(el) {
        if (!state.canonical) {
          state.canonical = normalizeInlineText(el.getAttribute("href") || "");
        }
      },
    })

    // title: collect H1 pieces from within the actual page sections
    .on("main#page article#sections h1", {
      text(t) {
        if (!state.collectingTitle) return;
        const cleaned = normalizeInlineText(t.text);
        if (cleaned) state.titleParts.push(cleaned);
      },
    })

    // block collection (only from the main page sections content wrappers)
    .on("main#page article#sections .content-wrapper h2", {
      element(el) {
        if (state.inLiDepth) return;
        stopCollectingTitleIfNeeded();
        beginBlock("h2");
        el.onEndTag(() => endBlock());
      },
      text(t) {
        if (!state.current || state.current.kind !== "h2") return;
        appendToCurrent(t.text);
      },
    })
    .on("main#page article#sections .content-wrapper h3", {
      element(el) {
        if (state.inLiDepth) return;
        stopCollectingTitleIfNeeded();
        beginBlock("h3");
        el.onEndTag(() => endBlock());
      },
      text(t) {
        if (!state.current || state.current.kind !== "h3") return;
        appendToCurrent(t.text);
      },
    })
    .on("main#page article#sections .content-wrapper p", {
      element(el) {
        // don't double-capture list item text (Squarespace often wraps li text in p)
        if (state.inLiDepth) return;
        stopCollectingTitleIfNeeded();
        beginBlock("p");
        el.onEndTag(() => endBlock());
      },
      text(t) {
        if (!state.current || state.current.kind !== "p") return;
        appendToCurrent(t.text);
      },
    })
    .on("main#page article#sections .content-wrapper li", {
      element(el) {
        stopCollectingTitleIfNeeded();
        state.inLiDepth += 1;
        beginBlock("li");
        el.onEndTag(() => {
          endBlock();
          state.inLiDepth -= 1;
        });
      },
      text(t) {
        if (!state.current || state.current.kind !== "li") return;
        appendToCurrent(t.text);
      },
    })

    // inline formatting inside content area
    .on("main#page article#sections .content-wrapper br", {
      element() {
        // HTMLRewriter doesn't give us literal "<br>" text; we insert a marker token
        // and later convert it to "\n" in normalizeBlockText().
        appendToCurrent(BR_TOKEN);
      },
    })
    .on("main#page article#sections .content-wrapper strong", {
      element(el) {
        appendToCurrent("**");
        el.onEndTag(() => appendToCurrent("**"));
      },
    })
    .on("main#page article#sections .content-wrapper em", {
      element(el) {
        appendToCurrent("*");
        el.onEndTag(() => appendToCurrent("*"));
      },
    })
    .on("main#page article#sections .content-wrapper a", {
      element(el) {
        const href = el.getAttribute("href") || "";
        pushLink(href);
        el.onEndTag(() => popLinkToCurrent());
      },
      // IMPORTANT: no text() handler here, otherwise link text is captured twice.
      // The surrounding h2/h3/p/li text() handlers flow through appendToCurrent(),
      // which routes into linkStack when inside a link.
    });

  // Run the rewriter to trigger handlers; output is ignored.
  await rewriter.transform(new Response(html)).text();

  // Convert captured state into the final return structure.
  const title = dedupeAndJoinTitle(state.titleParts);
  const blocksMd = blocksToMarkdown(state.blocks);

  return {
    title,
    description: state.description,
    url: state.canonical || fallbackUrl,
    content: blocksMd,
  };
}

/**
 * Given multiple title fragments (often repeated in Squarespace sections),
 * normalize + dedupe them while preserving order, then join into one string.
 */
function dedupeAndJoinTitle(parts) {
  const cleaned = parts.map((p) => normalizeInlineText(p)).filter(Boolean);

  // Order-preserving de-dupe.
  const uniq = [];
  for (const p of cleaned) {
    if (!uniq.includes(p)) uniq.push(p);
  }

  return uniq.join(" ").trim();
}

/**
 * Convert our structured blocks into a Markdown string.
 * - headings become ## / ###
 * - list items become "- ..."
 * - paragraphs are emitted as-is
 *
 * We also manage blank lines so lists stay tight but blocks are readable.
 */
function blocksToMarkdown(blocks) {
  const lines = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];

    // Map block type to markdown line(s).
    if (b.kind === "h2") lines.push(`## ${b.text}`);
    else if (b.kind === "h3") lines.push(`### ${b.text}`);
    else if (b.kind === "li") lines.push(`- ${b.text}`);
    else lines.push(b.text);

    // Add blank line between non-list blocks; keep list items tight
    const next = blocks[i + 1];
    if (!next) continue;
    const isList = b.kind === "li";
    const nextIsList = next.kind === "li";
    if (!(isList && nextIsList)) lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * Decode a handful of common HTML entities to plain text.
 * This keeps output readable without pulling in a full HTML entity library.
 */
function decodeHtmlEntities(s) {
  const str = String(s || "");
  if (!str.includes("&")) return str;

  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => {
      const cp = parseInt(hex, 16);
      if (!Number.isFinite(cp)) return m;
      try {
        return String.fromCodePoint(cp);
      } catch {
        return m;
      }
    })
    .replace(/&#([0-9]+);/g, (m, dec) => {
      const cp = parseInt(dec, 10);
      if (!Number.isFinite(cp)) return m;
      try {
        return String.fromCodePoint(cp);
      } catch {
        return m;
      }
    });
}

/**
 * Normalize "inline" strings (titles, headings, list text):
 * - decode HTML entities
 * - collapse whitespace to single spaces
 * - trim
 */
function normalizeInlineText(text) {
  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
}

/**
 * Normalize block text (paragraphs) while preserving intentional line breaks.
 * We use BR_TOKEN markers (inserted during HTMLRewriter parsing) to represent <br>.
 */
function normalizeBlockText(text) {
  let t = decodeHtmlEntities(text).replace(/\r/g, "");

  // Collapse formatting whitespace/newlines to spaces first.
  t = t.replace(/\s+/g, " ").trim();

  // Convert explicit <br> markers into newlines.
  t = t.replace(new RegExp(`\\s*${BR_TOKEN}\\s*`, "g"), "\n");

  // Clean up excessive newlines.
  t = t.replace(/\n{3,}/g, "\n\n");

  return t.trim();
}

/**
 * Build the final markdown response string:
 * - YAML frontmatter
 * - H1 title
 * - optional blockquote description
 * - main extracted content
 */
function buildMarkdown(title, description, url, content) {
  let markdown = `---
version: "${MARKDOWN_VERSION}"
title: "${String(title).replace(/"/g, '\\"')}"
description: "${String(description).replace(/"/g, '\\"')}"
url: "${String(url)}"
---

# ${title}

`;

  if (description) {
    // Render description as a blockquote for quick context at the top.
    markdown += `> ${description}\n\n`;
  }

  markdown += content;

  return markdown;
}
