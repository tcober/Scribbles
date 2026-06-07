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
});
