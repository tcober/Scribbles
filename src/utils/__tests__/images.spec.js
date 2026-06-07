import { describe, it, expect } from "vitest";

import { isImageType, isImageFile } from "../images.js";

describe("isImageType", () => {
  it("accepts image MIME types", () => {
    expect(isImageType("image/png")).toBe(true);
    expect(isImageType("image/jpeg")).toBe(true);
  });

  it("rejects non-image and malformed types", () => {
    expect(isImageType("text/plain")).toBe(false);
    expect(isImageType("application/pdf")).toBe(false);
    expect(isImageType("")).toBe(false);
    expect(isImageType(undefined)).toBe(false);
    expect(isImageType(null)).toBe(false);
  });
});

describe("isImageFile", () => {
  it("accepts a File-like object with an image type", () => {
    expect(isImageFile({ type: "image/gif" })).toBe(true);
  });

  it("rejects a non-image file and missing entries", () => {
    expect(isImageFile({ type: "text/plain" })).toBe(false);
    expect(isImageFile(null)).toBe(false);
    expect(isImageFile(undefined)).toBe(false);
  });
});
