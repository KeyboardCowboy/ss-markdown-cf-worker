export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // Only process markdown requests
    if (url.searchParams.get('format') !== 'markdown') {
      return fetch(request);
    }
    
    const cleanURL = new URL(url);
    cleanURL.searchParams.delete('format');
    
    try {
      // Fetch HTML and JSON in parallel
      const [htmlResp, jsonResp] = await Promise.all([
        fetch(cleanURL.toString()),
        fetch(createJsonUrl(cleanURL))
      ]);
      
      const html = await htmlResp.text();
      const json = await jsonResp.json();
      
      // Extract metadata
      const title = json.collection?.title || 'Page';
      const description = json.collection?.seoData?.seoDescription || '';
      const pageUrl = json.website?.baseUrl + (json.collection?.fullUrl || '/');
      
      // Extract text from HTML
      const textContent = extractTextContent(html);
      
      // Build markdown output
      const markdown = buildMarkdown(title, description, pageUrl, textContent);
      
      return new Response(markdown, {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Cache-Control': 'public, max-age=3600'
        }
      });
    } catch (error) {
      return new Response(`Error: ${error.message}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }
};

function createJsonUrl(url) {
  const jsonUrl = new URL(url.href);
  jsonUrl.searchParams.set('format', 'json-pretty');
  return jsonUrl.toString();
}

function extractTextContent(html) {
  let text = html;
  
  // Remove script tags
  const scriptPattern = new RegExp('<script[^>]*>[\\\\s\\\\S]*?<\\\\/script>', 'g');
  text = text.replace(scriptPattern, '');
  
  // Remove style tags
  const stylePattern = new RegExp('<style[^>]*>[\\\\s\\\\S]*?<\\\\/style>', 'g');
  text = text.replace(stylePattern, '');
  
  // Try to extract article content
  const articlePattern = new RegExp('<article[^>]*>[\\\\s\\\\S]*?<\\\\/article>');
  const articleMatch = text.match(articlePattern);
  if (articleMatch) {
    text = articleMatch[0];
  }
  
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, '');
  
  // Decode entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  
  // Clean whitespace
  text = text.replace(/  +/g, ' ');
  text = text.replace(/\\n\\n\\n+/g, '\\n\\n');
  
  return text.trim();
}

function buildMarkdown(title, description, url, content) {
  let markdown = `---
version: "1.0.0"
title: "${title.replace(/"/g, '\\\\"')}"
description: "${description.replace(/"/g, '\\\\"')}"
url: "${url}"
---

# ${title}

`;
  
  if (description) {
    markdown += `> ${description}\\n\\n`;
  }
  
  markdown += content;
  
  return markdown;
}
