import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

import { useEditorStore } from "../editor.js";
import { useNotesStore } from "../notes.js";

describe("useEditorStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("runFormat sends only transcript/existing/context — never images", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "raw speech", context: "" };
    notes.pendingImages = [
      { filename: "a.png", url: "u", path: "/p", mime: "image/png" },
    ];
    editor.sessionStartIndex = 0;
    window.api.formatNote.mockResolvedValueOnce("formatted notes");

    await editor.runFormat({});

    expect(window.api.formatNote).toHaveBeenCalledWith({
      transcript: "raw speech",
      existing: "",
      context: "",
    });
    expect(notes.activeNote.markdown).toBe("formatted notes");
    // Format no longer consumes the pending images.
    expect(notes.pendingImages).toHaveLength(1);
    expect(editor.status).toBe("idle");
  });

  it("placeImages inserts the returned markdown, clears pending, and arms undo", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "# A\n\nBody." };
    notes.pendingImages = [
      { filename: "a.png", url: "u", path: "/p", mime: "image/png" },
    ];
    window.api.placeImages.mockResolvedValueOnce("# A\n\nBody.\n\n![x](u)");

    await editor.placeImages();

    expect(window.api.placeImages).toHaveBeenCalledWith({
      markdown: "# A\n\nBody.",
      images: [{ filename: "a.png", url: "u", path: "/p", mime: "image/png" }],
    });
    expect(notes.activeNote.markdown).toBe("# A\n\nBody.\n\n![x](u)");
    expect(notes.pendingImages).toEqual([]);
    expect(editor.status).toBe("idle");
    expect(editor.canUndo).toBe(true);
  });

  it("undoLastFormat restores the pre-placement markdown and disarms undo", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "# A\n\nBody." };
    notes.pendingImages = [
      { filename: "a.png", url: "u", path: "/p", mime: "image/png" },
    ];
    window.api.placeImages.mockResolvedValueOnce("# A\n\nBody.\n\n![x](u)");
    await editor.placeImages();

    await editor.undoLastFormat();

    expect(notes.activeNote.markdown).toBe("# A\n\nBody.");
    expect(editor.canUndo).toBe(false);
  });

  it("a manual edit (clearFormatSnapshot) invalidates undo", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "# A\n\nBody." };
    notes.pendingImages = [
      { filename: "a.png", url: "u", path: "/p", mime: "image/png" },
    ];
    window.api.placeImages.mockResolvedValueOnce("# A\n\nBody.\n\n![x](u)");
    await editor.placeImages();
    expect(editor.canUndo).toBe(true);

    editor.clearFormatSnapshot();

    expect(editor.canUndo).toBe(false);
  });

  it("runFormat surfaces a model failure as an error and leaves the note alone", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "raw speech" };
    window.api.formatNote.mockRejectedValueOnce(new Error("model exploded"));

    await editor.runFormat({});

    expect(editor.status).toBe("error");
    expect(editor.errorMessage).toBe("model exploded");
    expect(editor.formatProgress).toBeNull();
    expect(notes.activeNote.markdown).toBe("raw speech");
    expect(editor.canUndo).toBe(false);
    expect(window.api.saveNote).not.toHaveBeenCalled();
  });

  it("runFormat treats a user cancel as a quiet return to idle", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "raw speech" };
    window.api.formatNote.mockRejectedValueOnce(new Error("FORMAT_CANCELLED"));

    await editor.runFormat({});

    expect(editor.status).toBe("idle");
    expect(editor.errorMessage).toBe("");
    expect(editor.formatProgress).toBeNull();
    expect(notes.activeNote.markdown).toBe("raw speech");
    expect(editor.canUndo).toBe(false);
  });

  it("a second trigger cannot start while a format is in flight", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "raw speech" };
    let finishFormat;
    window.api.formatNote.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFormat = resolve;
      }),
    );

    const firstRun = editor.runFormat({});
    expect(editor.status).toBe("formatting");
    await editor.runFormat({});
    await editor.placeImages();

    expect(window.api.formatNote).toHaveBeenCalledTimes(1);
    expect(window.api.placeImages).not.toHaveBeenCalled();

    finishFormat("done");
    await firstRun;
    expect(editor.status).toBe("idle");
  });

  it("runFormat skips the model when there is no new speech", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "already formatted   " };
    editor.sessionStartIndex = "already formatted".length;

    await editor.runFormat({});

    expect(window.api.formatNote).not.toHaveBeenCalled();
    expect(editor.status).toBe("idle");
    expect(editor.formatProgress).toBeNull();
  });

  it("runFormat sends only the recent tail and stitches the head back verbatim", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    // Old content well past the context cap, then a heading splitFormatContext
    // will pick as the tail boundary.
    const oldContent = "A".repeat(2100);
    const recentSection = "# Recent\n\ntail text";
    const formatted = `${oldContent}\n${recentSection}`;
    notes.activeNote = { id: "n1", markdown: `${formatted}\n\nnew speech` };
    editor.sessionStartIndex = formatted.length;
    window.api.formatNote.mockResolvedValueOnce("MERGED");

    await editor.runFormat({});

    // Gemma only saw the tail section, not the 2100-char head.
    expect(window.api.formatNote).toHaveBeenCalledWith({
      transcript: "new speech",
      existing: recentSection,
      context: "",
    });
    // The head survives byte-for-byte in front of the merged result.
    expect(notes.activeNote.markdown).toBe(`${oldContent}\n\nMERGED`);
    expect(editor.sessionStartIndex).toBe(notes.activeNote.markdown.length);
  });

  it("runFormat drains in-flight transcription so late words make the prompt", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "hello" };
    editor.pendingTranscriptions = 1;
    const drain = vi.fn(async () => {
      notes.activeNote.markdown += " world";
    });
    window.api.formatNote.mockResolvedValueOnce("done");

    await editor.runFormat({ drain });

    expect(drain).toHaveBeenCalledTimes(1);
    expect(window.api.formatNote).toHaveBeenCalledWith({
      transcript: "hello world",
      existing: "",
      context: "",
    });
  });

  it("runFormat does not drain when nothing is transcribing", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "hello" };
    const drain = vi.fn();
    window.api.formatNote.mockResolvedValueOnce("done");

    await editor.runFormat({ drain });

    expect(drain).not.toHaveBeenCalled();
  });

  it("runFormat clears the context and cancels queued saves before persisting", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "speech", context: " my ctx " };
    const cancelPendingSaves = vi.fn();
    window.api.formatNote.mockResolvedValueOnce("formatted");

    await editor.runFormat({ cancelPendingSaves });

    expect(window.api.formatNote).toHaveBeenCalledWith({
      transcript: "speech",
      existing: "",
      context: "my ctx",
    });
    expect(notes.activeNote.context).toBe("");
    expect(cancelPendingSaves).toHaveBeenCalledTimes(1);
    // The stale-context save was cancelled before the fresh save went out.
    expect(cancelPendingSaves.mock.invocationCallOrder[0]).toBeLessThan(
      window.api.saveNote.mock.invocationCallOrder[0],
    );
  });

  it("placeImages is a no-op when nothing is staged", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "body" };

    await editor.placeImages();

    expect(window.api.placeImages).not.toHaveBeenCalled();
    expect(editor.status).toBe("idle");
  });

  it("placeImages keeps the staged images when the user cancels", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "body" };
    notes.pendingImages = [{ filename: "a.png", url: "u" }];
    window.api.placeImages.mockRejectedValueOnce(new Error("FORMAT_CANCELLED"));

    await editor.placeImages();

    expect(editor.status).toBe("idle");
    expect(notes.pendingImages).toHaveLength(1);
    expect(notes.activeNote.markdown).toBe("body");
  });

  it("placeImages surfaces a placement failure without dropping the images", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "body" };
    notes.pendingImages = [{ filename: "a.png", url: "u" }];
    window.api.placeImages.mockRejectedValueOnce(new Error("vision down"));

    await editor.placeImages();

    expect(editor.status).toBe("error");
    expect(editor.errorMessage).toBe("vision down");
    expect(notes.pendingImages).toHaveLength(1);
  });

  it("canUndo turns off when a different note is on screen", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "body" };
    notes.pendingImages = [{ filename: "a.png", url: "u" }];
    window.api.placeImages.mockResolvedValueOnce("body\n\n![a](u)");
    await editor.placeImages();
    expect(editor.canUndo).toBe(true);

    notes.activeNote = { id: "n2", markdown: "other note" };

    expect(editor.canUndo).toBe(false);
  });

  it("undoLastFormat on a different note drops the snapshot without touching it", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "body" };
    notes.pendingImages = [{ filename: "a.png", url: "u" }];
    window.api.placeImages.mockResolvedValueOnce("body\n\n![a](u)");
    await editor.placeImages();
    window.api.saveNote.mockClear();

    notes.activeNote = { id: "n2", markdown: "other note" };
    await editor.undoLastFormat();

    expect(notes.activeNote.markdown).toBe("other note");
    expect(window.api.saveNote).not.toHaveBeenCalled();
    // The stale snapshot is gone for good — back on n1 there is nothing to undo.
    notes.activeNote = { id: "n1", markdown: "body\n\n![a](u)" };
    expect(editor.canUndo).toBe(false);
  });

  it("undoLastFormat restores the session marker along with the markdown", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "body" };
    notes.pendingImages = [{ filename: "a.png", url: "u" }];
    editor.sessionStartIndex = 4;
    window.api.placeImages.mockResolvedValueOnce("body\n\n![a](u)");
    await editor.placeImages();
    expect(editor.sessionStartIndex).toBe("body\n\n![a](u)".length);

    await editor.undoLastFormat();

    expect(editor.sessionStartIndex).toBe(4);
  });

  it("cancelFormat only fires while a format is actually running", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "speech" };

    editor.cancelFormat();
    expect(window.api.cancelFormat).not.toHaveBeenCalled();

    let finishFormat;
    window.api.formatNote.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFormat = resolve;
      }),
    );
    const running = editor.runFormat({});
    editor.cancelFormat();

    expect(window.api.cancelFormat).toHaveBeenCalledTimes(1);
    expect(editor.formatProgress).toEqual({ stage: "Cancelling…", detail: "" });

    finishFormat("done");
    await running;
  });

  it("format progress only lands while formatting, and resubscribing detaches the old listener", async () => {
    const notes = useNotesStore();
    const editor = useEditorStore();
    notes.activeNote = { id: "n1", markdown: "speech" };
    let progressCallback;
    const unsubscribe = vi.fn();
    window.api.onFormatProgress.mockImplementation((callback) => {
      progressCallback = callback;
      return unsubscribe;
    });

    editor.subscribeFormatProgress();
    progressCallback({ stage: "Stale…", detail: "" });
    expect(editor.formatProgress).toBeNull(); // idle → ignored

    let finishFormat;
    window.api.formatNote.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFormat = resolve;
      }),
    );
    const running = editor.runFormat({});
    progressCallback({ stage: "Writing…", detail: "tail" });
    expect(editor.formatProgress).toEqual({
      stage: "Writing…",
      detail: "tail",
    });
    finishFormat("done");
    await running;

    editor.subscribeFormatProgress();
    expect(unsubscribe).toHaveBeenCalledTimes(1); // old listener detached

    editor.unsubscribeFormatProgress();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});
