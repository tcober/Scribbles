import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useNotesStore } from "../notes.js";

describe("useNotesStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("createNote sets the active note and resets stale pending images", async () => {
    const created = { id: "n1", title: "Untitled note", markdown: "" };
    window.api.createNote.mockResolvedValueOnce(created);
    const store = useNotesStore();
    store.pendingImages = [{ filename: "stale.png" }];

    const result = await store.createNote();

    expect(result).toEqual(created);
    expect(store.activeNote).toEqual(created);
    expect(store.pendingImages).toEqual([]);
    expect(window.api.createNote).toHaveBeenCalledWith("Untitled note");
  });

  it("appendTranscript inserts a blank line when the body lacks a trailing one", () => {
    const store = useNotesStore();
    store.activeNote = { id: "n1", markdown: "First line." };

    store.appendTranscript("Second line.");

    expect(store.activeNote.markdown).toBe("First line.\n\nSecond line.");
  });

  it("appendTranscript does not double an existing separator", () => {
    const store = useNotesStore();
    store.activeNote = { id: "n1", markdown: "First.\n\n" };

    store.appendTranscript("Second.");

    expect(store.activeNote.markdown).toBe("First.\n\nSecond.");
  });

  it("appendTranscript is a no-op when there is no active note", () => {
    const store = useNotesStore();
    store.appendTranscript("ignored");
    expect(store.activeNote).toBeNull();
  });

  it("removePendingImage deletes on disk before dropping it from the list", async () => {
    window.api.deleteImage.mockResolvedValueOnce(undefined);
    const store = useNotesStore();
    store.activeNote = { id: "n1" };
    store.pendingImages = [{ filename: "a.png" }, { filename: "b.png" }];

    await store.removePendingImage("a.png");

    expect(window.api.deleteImage).toHaveBeenCalledWith({
      noteId: "n1",
      filename: "a.png",
    });
    expect(store.pendingImages).toEqual([{ filename: "b.png" }]);
  });

  it("removePendingImage keeps the image listed when the delete fails", async () => {
    window.api.deleteImage.mockRejectedValueOnce(new Error("disk error"));
    const store = useNotesStore();
    store.activeNote = { id: "n1" };
    store.pendingImages = [{ filename: "a.png" }];

    await expect(store.removePendingImage("a.png")).rejects.toThrow(
      "disk error",
    );
    expect(store.pendingImages).toEqual([{ filename: "a.png" }]);
  });

  it("removePendingImage is a no-op for an unknown filename", async () => {
    const store = useNotesStore();
    store.activeNote = { id: "n1" };
    store.pendingImages = [{ filename: "a.png" }];

    await store.removePendingImage("missing.png");

    expect(window.api.deleteImage).not.toHaveBeenCalled();
    expect(store.pendingImages).toEqual([{ filename: "a.png" }]);
  });
});
