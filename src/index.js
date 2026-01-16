export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Only process markdown requests
    if (url.searchParams.get("format") !== "markdown") {
      return fetch(request);
    }

    const cleanURL = new URL(url);
    cleanURL.searchParams.delete("format");

    try {
      // In tests, allow injecting HTML directly to avoid network fetches
      const html =
        env && typeof env.TEST_HTML === "string" && env.TEST_HTML.length
          ? env.TEST_HTML
          : await (await fetch(new Request(cleanURL.toString(), request))).text();

      const pageData = await extractPageDataFromHtml(html, cleanURL.toString());

      const title = pageData.title || "Page";
      const description = pageData.description || "";
      const pageUrl = pageData.url || cleanURL.toString();
      const content = pageData.content || "";

      const markdown = buildMarkdown(title, description, pageUrl, content);

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

const BR_TOKEN = "__SSMD_BR__";

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

  const beginBlock = (kind) => {
    state.current = { kind, text: "" };
  };

  const appendToCurrent = (s) => {
    if (!state.current) return;

    if (state.linkStack.length) {
      state.linkStack[state.linkStack.length - 1].text += s;
      return;
    }

    state.current.text += s;
  };

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

  const popLinkToCurrent = () => {
    const link = state.linkStack.pop();
    if (!link) return;

    const text = normalizeInlineText(link.text) || link.href || "";
    if (!text) return;

    appendToCurrent(`[${text}](${link.href})`);
  };

  const stopCollectingTitleIfNeeded = () => {
    if (state.collectingTitle) state.collectingTitle = false;
  };

  const rewriter = new HTMLRewriter()
    // metadata
    .on('meta[name="description"]', {
      element(el) {
        if (!state.description) {
          state.description = normalizeInlineText(el.getAttribute("content") || "");
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

  const title = dedupeAndJoinTitle(state.titleParts);
  const blocksMd = blocksToMarkdown(state.blocks);

  return {
    title,
    description: state.description,
    url: state.canonical || fallbackUrl,
    content: blocksMd,
  };
}

function dedupeAndJoinTitle(parts) {
  const cleaned = parts.map((p) => normalizeInlineText(p)).filter(Boolean);

  const uniq = [];
  for (const p of cleaned) {
    if (!uniq.includes(p)) uniq.push(p);
  }

  return uniq.join(" ").trim();
}

function blocksToMarkdown(blocks) {
  const lines = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];

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

function normalizeInlineText(text) {
  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
}

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

function buildMarkdown(title, description, url, content) {
  let markdown = `---
version: "1.0.1"
title: "${String(title).replace(/"/g, '\\"')}"
description: "${String(description).replace(/"/g, '\\"')}"
url: "${String(url)}"
---

# ${title}

`;

  if (description) {
    markdown += `> ${description}\n\n`;
  }

  markdown += content;

  return markdown;
}
