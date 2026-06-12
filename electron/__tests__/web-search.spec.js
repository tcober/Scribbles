// Tests the web-search pipeline end to end with a stubbed fetch: tool-call
// argument handling, DuckDuckGo HTML parsing (redirect unwrapping, entity
// stripping, result caps), the pre-search heuristics, and block formatting.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  executeToolCall,
  formatPreSearchBlock,
  preSearchFromContext,
} from "../web-search.js";

// One DuckDuckGo-shaped search result the scraper's regex should match.
function resultHtml({ url, title, snippet }) {
  return (
    `<div><a rel="nofollow" class="result__a" href="${url}">${title}</a>` +
    `<a class="result__snippet">${snippet}</a></div>`
  );
}

function stubSearchPage(...results) {
  globalThis.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => results.map(resultHtml).join("\n"),
  });
}

describe("web-search", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("executeToolCall", () => {
    it("rejects tools it does not know", async () => {
      const result = await executeToolCall("rm_rf", {});
      expect(result).toBe("Unknown tool: rm_rf");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("parses JSON-string arguments (Ollama sends both shapes)", async () => {
      stubSearchPage({
        url: "https://example.com",
        title: "Example",
        snippet: "About examples",
      });

      const result = await executeToolCall(
        "web_search",
        '{"query":"example things"}',
      );

      expect(globalThis.fetch.mock.calls[0][0]).toContain(
        encodeURIComponent("example things"),
      );
      expect(result).toContain("[1] Example");
      expect(result).toContain("URL: https://example.com");
    });

    it("treats an unparseable string argument as the query itself", async () => {
      stubSearchPage({
        url: "https://example.com",
        title: "Example",
        snippet: "s",
      });

      await executeToolCall("web_search", "plain text query");

      expect(globalThis.fetch.mock.calls[0][0]).toContain(
        encodeURIComponent("plain text query"),
      );
    });

    it("refuses an empty query without fetching", async () => {
      const result = await executeToolCall("web_search", { query: "   " });
      expect(result).toBe("web_search error: empty query.");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("unwraps DDG redirect links and fixes protocol-relative URLs", async () => {
      stubSearchPage(
        {
          url: "/l/?uddg=https%3A%2F%2Freal-site.com%2Fdocs&rut=abc",
          title: "Wrapped",
          snippet: "s1",
        },
        { url: "//bare-site.com/page", title: "Bare", snippet: "s2" },
      );

      const result = await executeToolCall("web_search", { query: "q" });

      expect(result).toContain("URL: https://real-site.com/docs");
      expect(result).toContain("URL: https://bare-site.com/page");
    });

    it("strips HTML tags and entities from titles and snippets", async () => {
      stubSearchPage({
        url: "https://example.com",
        title: "Tom &amp; Jerry <b>Show</b>",
        snippet: "It&#39;s &lt;great&gt;&nbsp;  fun",
      });

      const result = await executeToolCall("web_search", { query: "q" });

      expect(result).toContain("[1] Tom & Jerry Show");
      expect(result).toContain("It's <great> fun");
    });

    it("caps the formatted output at five results", async () => {
      const many = Array.from({ length: 7 }, (_unused, index) => ({
        url: `https://example.com/${index}`,
        title: `Result ${index}`,
        snippet: "s",
      }));
      stubSearchPage(...many);

      const result = await executeToolCall("web_search", { query: "q" });

      expect(result).toContain("[5]");
      expect(result).not.toContain("[6]");
    });

    it("reports no-result and HTTP-failure outcomes as readable strings", async () => {
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "<html>no results markup</html>",
      });
      expect(await executeToolCall("web_search", { query: "q" })).toBe(
        'web_search("q") returned no results.',
      );

      globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 503 });
      expect(await executeToolCall("web_search", { query: "q" })).toContain(
        "DuckDuckGo returned HTTP 503",
      );
    });
  });

  describe("preSearchFromContext", () => {
    it("returns nothing when the context never asks for a lookup", async () => {
      const searches = await preSearchFromContext(
        "Meeting with the design team about the payments rewrite.",
      );
      expect(searches).toEqual([]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("extracts a focused query from a search-verb sentence", async () => {
      stubSearchPage({
        url: "https://react.dev",
        title: "React 19",
        snippet: "Release notes",
      });

      const searches = await preSearchFromContext(
        "Look up the latest React 19 release notes and add a short summary.",
      );

      expect(searches).toHaveLength(1);
      expect(searches[0].query).toBe("latest React 19 release notes");
      expect(searches[0].hits).toHaveLength(1);
    });

    it("dedupes repeated queries across clauses", async () => {
      stubSearchPage({ url: "https://x.com", title: "X", snippet: "s" });

      const searches = await preSearchFromContext(
        "Search for gRPC benchmarks. Also search for gRPC benchmarks.",
      );

      expect(searches).toHaveLength(1);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("records a per-query error instead of failing the whole pre-search", async () => {
      globalThis.fetch.mockRejectedValue(new Error("offline"));

      const searches = await preSearchFromContext("Research quantum doodads.");

      expect(searches).toEqual([
        { query: "quantum doodads", error: "offline" },
      ]);
    });
  });

  describe("formatPreSearchBlock", () => {
    it("renders hits, failures, and empty searches in one block", () => {
      const block = formatPreSearchBlock([
        {
          query: "good",
          hits: [{ title: "T", url: "https://u", snippet: "S" }],
        },
        { query: "broken", error: "offline" },
        { query: "empty", hits: [] },
      ]);

      expect(block).toContain('Search: "good"');
      expect(block).toContain("[1] T");
      expect(block).toContain("https://u");
      expect(block).toContain("(search failed: offline)");
      expect(block).toContain("(no results)");
    });
  });
});
