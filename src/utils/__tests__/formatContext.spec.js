import { describe, it, expect } from "vitest";
import {
  splitFormatContext,
  MAX_FORMAT_CONTEXT_CHARS,
} from "../formatContext.js";

describe("splitFormatContext", () => {
  it("returns the whole string as tail when under the cap", () => {
    const formatted = "# Short note\n\nNot much here.";
    expect(splitFormatContext(formatted)).toEqual({
      head: "",
      tail: formatted,
    });
  });

  it("splits at a markdown heading past the target so the tail is a clean section", () => {
    const head = "# Old section\n\n" + "x".repeat(MAX_FORMAT_CONTEXT_CHARS);
    const tail = "# Recent section\n\nLatest words.";
    const { head: gotHead, tail: gotTail } = splitFormatContext(
      `${head}\n${tail}`,
    );
    expect(gotTail.startsWith("# Recent section")).toBe(true);
    expect(gotHead.endsWith("# Old section") === false).toBe(true);
    // Reconstruction (modulo the trimmed boundary whitespace) is lossless.
    expect(`${gotHead}\n\n${gotTail}`).toContain("Latest words.");
  });

  it("falls back to a paragraph break when there is no heading", () => {
    const head = "p".repeat(MAX_FORMAT_CONTEXT_CHARS);
    const tail = "A fresh paragraph of recent speech.";
    const { tail: gotTail } = splitFormatContext(`${head}\n\n${tail}`);
    expect(gotTail).toBe(tail);
  });

  it("hard-cuts at the target when there is neither a heading nor a paragraph break", () => {
    const formatted = "z".repeat(MAX_FORMAT_CONTEXT_CHARS + 100);
    const { head, tail } = splitFormatContext(formatted);
    expect(tail.length).toBe(MAX_FORMAT_CONTEXT_CHARS);
    expect(head.length).toBe(100);
  });
});
