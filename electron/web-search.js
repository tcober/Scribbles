// Web search for the format pass: the tool definition Gemma can call, a
// heuristic pre-search for models whose template can't call tools, and a
// DuckDuckGo-scraping backend with result formatting.

export const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the public web (DuckDuckGo) for current information. Returns up to 5 results with title, URL, and snippet. ONLY use this when the user's background context explicitly asks you to search, look up, research, fetch, find, or supplement the notes with external information. Do not call it otherwise.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A concise search query, like what you would type into a search engine.",
        },
      },
      required: ["query"],
    },
  },
};

// Phrases in the user's context that mean "go search for something" — used to
// fire pre-searches for models whose Ollama template doesn't expose tool
// calling (e.g. some custom Gemma builds).
const SEARCH_TRIGGER_RE =
  /\b(?:search(?:\s+(?:for|the\s+web|online))?|look(?:\s+(?:up|into))?|looked\s+up|research|google|fetch|pull\s+up|find\s+(?:info|information|details|out\s+(?:about|what))|check\s+(?:what|whether|if)|investigate|cite\s+sources?\s+for|reference|what\s+is|who\s+is|tell\s+me\s+about)\b/i;

// Try to extract a focused query from a sentence that contains a search verb.
// Falls back to the whole sentence if the heuristic doesn't fire.
function extractQueryFromSentence(sentence) {
  const trimmed = sentence.trim().replace(/[.!?]+$/, "");
  const match = trimmed.match(
    /(?:search(?:\s+(?:for|the\s+web|online))?|look(?:\s+(?:up|into))?|research|google|fetch|pull\s+up|find\s+(?:info|information|details)\s+(?:on|about|for)|investigate|cite\s+sources?\s+for|reference|what\s+is|who\s+is|tell\s+me\s+about)\s+(.+?)(?:\s+and\s+(?:add|summarize|include|then)\b.*)?$/i,
  );
  const raw = match ? match[1] : trimmed;
  // Strip leading articles and trailing instruction-y tails.
  return raw
    .replace(/^(?:the|an|a)\s+/i, "")
    .replace(/\s+then\s+.+$/i, "")
    .replace(/\s+and\s+(?:add|summarize|include).*$/i, "")
    .trim()
    .slice(0, 200);
}

export async function preSearchFromContext(context) {
  if (!context || !SEARCH_TRIGGER_RE.test(context)) return [];

  // Break into clauses on sentence boundaries OR explicit "and"/"then" joins,
  // then pick the ones that contain a search verb.
  const clauses = context
    .split(/(?<=[.!?])\s+|\n+|;\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  const queries = [];
  const seen = new Set();
  for (const clause of clauses) {
    if (!SEARCH_TRIGGER_RE.test(clause)) continue;
    const query = extractQueryFromSentence(clause);
    if (!query || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    queries.push(query);
    if (queries.length >= 3) break;
  }
  if (!queries.length) return [];

  const out = [];
  for (const query of queries) {
    try {
      const hits = await webSearch(query, 4);
      out.push({ query, hits });
    } catch (err) {
      out.push({ query, error: err.message });
    }
  }
  return out;
}

export function formatPreSearchBlock(searches) {
  const lines = [
    "Web search results (run on your behalf because the context asked for lookups — use these to supplement the notes, and cite each source you use inline as a Markdown link):",
    "",
  ];
  for (const { query, hits, error } of searches) {
    lines.push(`Search: "${query}"`);
    if (error) {
      lines.push(`  (search failed: ${error})`);
    } else if (!hits || !hits.length) {
      lines.push("  (no results)");
    } else {
      for (let index = 0; index < hits.length; index++) {
        const hit = hits[index];
        lines.push(`  [${index + 1}] ${hit.title}`);
        lines.push(`      ${hit.url}`);
        if (hit.snippet) lines.push(`      ${hit.snippet}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export async function executeToolCall(name, rawArgs) {
  if (name !== "web_search") return `Unknown tool: ${name}`;

  // Ollama may return arguments as an object or as a JSON string.
  let args = rawArgs;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = { query: args };
    }
  }
  const query = String(args?.query || "")
    .trim()
    .slice(0, 250);
  if (!query) return "web_search error: empty query.";

  try {
    const hits = await webSearch(query, 5);
    if (!hits.length) return `web_search("${query}") returned no results.`;
    return hits
      .map(
        (hit, index) =>
          `[${index + 1}] ${hit.title}\nURL: ${hit.url}\n${hit.snippet}`,
      )
      .join("\n\n");
  } catch (err) {
    return `web_search("${query}") failed: ${err.message}`;
  }
}

async function webSearch(query, maxResults = 5) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });
  if (!res.ok) throw new Error(`DuckDuckGo returned HTTP ${res.status}`);
  const html = await res.text();

  const results = [];
  const resultPattern =
    /<a\s+[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a\s+[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while (
    (match = resultPattern.exec(html)) !== null &&
    results.length < maxResults
  ) {
    let href = match[1];
    // DDG wraps results in a /l/?uddg=<encoded> redirect — unwrap to the real URL.
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith("//")) href = "https:" + href;
    const title = stripHtml(match[2]);
    const snippet = stripHtml(match[3]);
    if (title && href) results.push({ title, url: href, snippet });
  }
  return results;
}

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
