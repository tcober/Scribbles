import { describe, it, expect, beforeEach } from "vitest";
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
    notes.pendingImages = [{ filename: "a.png", url: "u", path: "/p", mime: "image/png" }];
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
    notes.pendingImages = [{ filename: "a.png", url: "u", path: "/p", mime: "image/png" }];
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
    notes.pendingImages = [{ filename: "a.png", url: "u", path: "/p", mime: "image/png" }];
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
    notes.pendingImages = [{ filename: "a.png", url: "u", path: "/p", mime: "image/png" }];
    window.api.placeImages.mockResolvedValueOnce("# A\n\nBody.\n\n![x](u)");
    await editor.placeImages();
    expect(editor.canUndo).toBe(true);

    editor.clearFormatSnapshot();

    expect(editor.canUndo).toBe(false);
  });
});
