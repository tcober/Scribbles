import { describe, it, expect } from "vitest";

import {
  RECENT_NOTES_CHARS,
  chunkText,
  insertImagesAtBlocks,
  splitBlocksWithOffsets,
  splitRecentNotes,
  stripConversational,
} from "../text-utils.js";

describe("splitBlocksWithOffsets", () => {
  it("splits on blank lines and records end offsets", () => {
    const markdown = "# Title\n\nFirst para.\n\nSecond para.";
    const blocks = splitBlocksWithOffsets(markdown);

    expect(blocks.map((block) => block.text)).toEqual([
      "# Title",
      "First para.",
      "Second para.",
    ]);
    // Each end offset points just past the block's last character.
    for (const block of blocks) {
      expect(
        markdown.slice(block.endIndex - block.text.length, block.endIndex),
      ).toBe(block.text);
    }
  });

  it("keeps multi-line blocks (lists, code) together", () => {
    const markdown = "- one\n- two\n- three\n\nAfter.";
    const blocks = splitBlocksWithOffsets(markdown);
    expect(blocks[0].text).toBe("- one\n- two\n- three");
    expect(blocks[1].text).toBe("After.");
  });

  it("ignores trailing whitespace-only runs", () => {
    const blocks = splitBlocksWithOffsets("Body.\n\n   \n");
    expect(blocks.map((block) => block.text)).toEqual(["Body."]);
  });

  it("returns nothing for empty input", () => {
    expect(splitBlocksWithOffsets("")).toEqual([]);
    expect(splitBlocksWithOffsets(null)).toEqual([]);
  });
});

describe("insertImagesAtBlocks", () => {
  const markdown = "# Title\n\nFirst para.\n\nSecond para.";
  const blocks = splitBlocksWithOffsets(markdown);

  it("inserts an image after the chosen block and leaves the prose unchanged", () => {
    const out = insertImagesAtBlocks(markdown, blocks, [
      { caption: "a diagram", url: "note-image://n/a.png", after: 2 },
    ]);

    expect(out).toBe(
      "# Title\n\nFirst para.\n\n![a diagram](note-image://n/a.png)\n\nSecond para.",
    );
    // Every original character survives, in order.
    expect(out.replace("\n\n![a diagram](note-image://n/a.png)", "")).toBe(
      markdown,
    );
  });

  it("appends when the target block is out of range, zero, or missing", () => {
    for (const after of [0, 99, undefined, null]) {
      const out = insertImagesAtBlocks(markdown, blocks, [
        { caption: "cap", url: "u", after },
      ]);
      expect(out).toBe(`${markdown}\n\n![cap](u)`);
    }
  });

  it("keeps input order for multiple images after the same block", () => {
    const out = insertImagesAtBlocks(markdown, blocks, [
      { caption: "one", url: "u1", after: 1 },
      { caption: "two", url: "u2", after: 1 },
    ]);
    expect(out).toBe(
      "# Title\n\n![one](u1)\n\n![two](u2)\n\nFirst para.\n\nSecond para.",
    );
  });

  it("appends every image when notes are empty (no blocks)", () => {
    const out = insertImagesAtBlocks(
      "",
      [],
      [{ caption: "only", url: "u", after: 0 }],
    );
    expect(out).toBe("![only](u)");
  });

  it("falls back to a generic caption and strips brackets", () => {
    const out = insertImagesAtBlocks(markdown, blocks, [
      { caption: "", url: "u1", after: 1 },
      { caption: "has [brackets]\nand newline", url: "u2", after: 0 },
    ]);
    expect(out).toContain("![image](u1)");
    expect(out).toContain("![has brackets and newline](u2)");
  });
});

describe("chunkText", () => {
  it("returns the trimmed text as a single chunk when under the target", () => {
    expect(chunkText("  short text  ", 100)).toEqual(["short text"]);
  });

  it("splits long text on sentence boundaries without losing content", () => {
    const sentences = Array.from(
      { length: 10 },
      (_unused, index) => `Sentence number ${index} has a few words.`,
    );
    const text = sentences.join(" ");

    const chunks = chunkText(text, 100);

    expect(chunks.length).toBeGreaterThan(1);
    // Every sentence survives intact, in order, in exactly one chunk.
    const rejoined = chunks.join(" ");
    let cursor = 0;
    for (const sentence of sentences) {
      const found = rejoined.indexOf(sentence, cursor);
      expect(found).toBeGreaterThanOrEqual(cursor);
      cursor = found + sentence.length;
    }
  });

  it("packs sentences up to the target instead of one chunk per sentence", () => {
    const sentences = Array.from({ length: 10 }, () => "Tiny sentence here.");
    const chunks = chunkText(sentences.join(" "), 60);

    // Several sentences share each chunk — far fewer chunks than sentences.
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(sentences.length);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(60);
    }
  });

  it("hard-cuts a run-on with no punctuation so no chunk exceeds the target", () => {
    const runOn = "word".repeat(120); // 480 chars, no sentence breaks
    const chunks = chunkText(runOn, 100);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
    expect(chunks.join("")).toBe(runOn);
  });

  it("treats paragraphs as boundaries before sentences", () => {
    const first = "First paragraph here.";
    const second = "Second paragraph here.";
    const chunks = chunkText(`${first}\n\n${second}`, 30);
    expect(chunks).toEqual([first, second]);
  });
});

describe("stripConversational", () => {
  it("unwraps an outer code fence around the whole document", () => {
    const fenced = "```markdown\n# Notes\n\nBody.\n```";
    expect(stripConversational(fenced)).toBe("# Notes\n\nBody.");
  });

  it("strips stacked lead-in pleasantries", () => {
    const reply = "Sure! Here are your formatted notes:\n\n# Standup";
    expect(stripConversational(reply)).toBe("# Standup");
  });

  it("strips stacked trailing offers of help", () => {
    const reply =
      "# Standup\n\n- item\n\nHope this helps!\n\nLet me know if you need anything else.";
    expect(stripConversational(reply)).toBe("# Standup\n\n- item");
  });

  it("leaves clean markdown untouched", () => {
    const clean = "# Notes\n\nJust the content, nothing chatty.";
    expect(stripConversational(clean)).toBe(clean);
  });

  it("only strips trailing fluff, never the same phrase mid-document", () => {
    const body =
      "# Notes\n\nLet me know if the deploy breaks again.\n\nMore notes after.";
    expect(stripConversational(body)).toBe(body);
  });
});

describe("splitRecentNotes", () => {
  it("returns everything as tail while under the per-pass bound", () => {
    const notes = "# Short\n\nNot much yet.";
    expect(splitRecentNotes(notes)).toEqual({ head: "", tail: notes });
  });

  it("starts the tail at a heading so a pass gets a coherent section", () => {
    const settled = "x".repeat(RECENT_NOTES_CHARS + 200);
    const recent = "# Recent\n\nLatest words.";
    const { head, tail } = splitRecentNotes(`${settled}\n${recent}`);

    expect(tail).toBe(recent);
    expect(head).toBe(settled);
  });

  it("falls back to a paragraph break when there is no heading", () => {
    const settled = "y".repeat(RECENT_NOTES_CHARS + 200);
    const recent = "A fresh paragraph of recent prose.";
    const { tail } = splitRecentNotes(`${settled}\n\n${recent}`);

    expect(tail).toBe(recent);
  });

  it("hard-cuts at the bound when there is no clean boundary at all", () => {
    const notes = "z".repeat(RECENT_NOTES_CHARS + 300);
    const { head, tail } = splitRecentNotes(notes);

    expect(tail.length).toBe(RECENT_NOTES_CHARS);
    expect(head.length).toBe(300);
    expect(head + tail).toBe(notes);
  });
});
