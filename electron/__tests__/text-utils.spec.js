import { describe, it, expect } from "vitest";

import { splitBlocksWithOffsets, insertImagesAtBlocks } from "../text-utils.js";

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
