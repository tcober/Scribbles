import { describe, it, expect, vi } from "vitest";

// paths.js imports `app` from electron, which isn't available under the test
// runner; assertSafeId never touches it, so a minimal stub is enough.
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp" },
}));

const { assertSafeId } = await import("../paths.js");

describe("assertSafeId", () => {
  it("accepts a normal UUID and returns it", () => {
    const id = "3f0c2b1a-4d5e-6789-abcd-ef0123456789";
    expect(assertSafeId(id)).toBe(id);
  });

  it("rejects path-traversal and separator characters", () => {
    expect(() => assertSafeId("..")).toThrow();
    expect(() => assertSafeId("../secret")).toThrow();
    expect(() => assertSafeId("foo/bar")).toThrow();
    expect(() => assertSafeId("foo\\bar")).toThrow();
  });

  it("rejects empty and non-string ids", () => {
    expect(() => assertSafeId("")).toThrow();
    expect(() => assertSafeId(undefined)).toThrow();
    expect(() => assertSafeId(null)).toThrow();
    expect(() => assertSafeId(42)).toThrow();
  });
});
