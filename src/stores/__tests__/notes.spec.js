import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useNotesStore } from "../notes.js";
import { useEditorStore } from "../editor.js";

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

  it("selectNote loads the note and resets pending images and the undo snapshot", async () => {
    const store = useNotesStore();
    const editor = useEditorStore();
    // Arm an undo snapshot on the current note, then re-select it.
    store.activeNote = { id: "n1", markdown: "body" };
    store.pendingImages = [{ filename: "a.png", url: "u" }];
    window.api.placeImages.mockResolvedValueOnce("body\n\n![a](u)");
    await editor.placeImages();
    store.pendingImages = [{ filename: "stale.png" }];
    expect(editor.canUndo).toBe(true);

    const loaded = { id: "n1", markdown: "fresh from disk" };
    window.api.loadNote.mockResolvedValueOnce(loaded);
    await store.selectNote("n1");

    expect(window.api.loadNote).toHaveBeenCalledWith("n1");
    expect(store.activeNote).toEqual(loaded);
    expect(store.pendingImages).toEqual([]);
    // Same id, but the snapshot was cleared on switch — undo no longer offered.
    expect(editor.canUndo).toBe(false);
  });

  it("deleteNote clears the active note only when it was the one deleted", async () => {
    const store = useNotesStore();

    store.activeNote = { id: "n1", markdown: "body" };
    store.pendingImages = [{ filename: "a.png" }];
    await store.deleteNote("n1");
    expect(window.api.deleteNote).toHaveBeenCalledWith("n1");
    expect(store.activeNote).toBeNull();
    expect(store.pendingImages).toEqual([]);

    store.activeNote = { id: "n2", markdown: "other" };
    await store.deleteNote("n3");
    expect(store.activeNote).toEqual({ id: "n2", markdown: "other" });
  });

  it("saveTitle updates the note, persists it, and refreshes the list", async () => {
    const store = useNotesStore();
    store.activeNote = { id: "n1", title: "Old", markdown: "body" };

    await store.saveTitle("New title");

    expect(store.activeNote.title).toBe("New title");
    expect(window.api.saveNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "n1", title: "New title" }),
    );
    expect(window.api.listNotes).toHaveBeenCalled();
  });

  it("saveActiveNote ships a reactivity-free copy across the bridge", async () => {
    const store = useNotesStore();
    store.activeNote = { id: "n1", markdown: "body" };

    await store.saveActiveNote();

    const sent = window.api.saveNote.mock.calls[0][0];
    expect(sent).toEqual({ id: "n1", markdown: "body" });
    // A structured clone, not the live reactive proxy.
    expect(sent).not.toBe(store.activeNote);
  });

  it("renderedMarkdown tracks the active note's markdown", () => {
    const store = useNotesStore();
    expect(store.renderedMarkdown).toBe("");

    store.activeNote = { id: "n1", markdown: "# Hello" };
    expect(store.renderedMarkdown).toContain("<h1>Hello</h1>");

    store.activeNote.markdown = "plain text";
    expect(store.renderedMarkdown).toContain("<p>plain text</p>");
  });

  it("canAttachMore flips off once the per-format image cap is reached", () => {
    const store = useNotesStore();
    expect(store.canAttachMore).toBe(true);

    store.pendingImages = [{}, {}, {}];
    expect(store.canAttachMore).toBe(false);
  });
});
