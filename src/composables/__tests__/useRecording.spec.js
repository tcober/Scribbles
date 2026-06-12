// Tests the recording pipeline: chunk serialization, carryover context, error
// recovery, and the status handshakes with the editor store. The Recorder
// (live Web Audio) is mocked; chunks are fired by hand via its onChunk hook.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

import { useRecording } from "../useRecording.js";
import { useNotesStore } from "../../stores/notes.js";
import { useEditorStore } from "../../stores/editor.js";

const { recorderInstances } = vi.hoisted(() => ({ recorderInstances: [] }));

vi.mock("../../utils/recorder.js", () => ({
  Recorder: class {
    constructor() {
      this.onChunk = null;
      this.start = vi.fn(async ({ onChunk }) => {
        this.onChunk = onChunk;
      });
      this.stop = vi.fn(async () => {});
      recorderInstances.push(this);
    }
  },
}));

// Build the composable plus handles to its mocked Recorder and the two stores.
function setup({ markdown = "" } = {}) {
  const notes = useNotesStore();
  const editor = useEditorStore();
  notes.activeNote = { id: "n1", markdown };
  const recording = useRecording();
  return { recording, recorder: recorderInstances.at(-1), notes, editor };
}

describe("useRecording", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    recorderInstances.length = 0;
  });

  it("toggleRecording starts the recorder and marks the session start", async () => {
    const { recording, recorder, editor } = setup({ markdown: "existing" });

    await recording.toggleRecording();

    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(editor.isRecording).toBe(true);
    expect(editor.isStarting).toBe(false);
    expect(editor.sessionStartIndex).toBe("existing".length);
  });

  it("toggleRecording creates a note first when none is active", async () => {
    const notes = useNotesStore();
    window.api.createNote.mockResolvedValueOnce({ id: "fresh", markdown: "" });
    const recording = useRecording();

    await recording.toggleRecording();

    expect(window.api.createNote).toHaveBeenCalled();
    expect(notes.activeNote.id).toBe("fresh");
  });

  it("toggleRecording is a no-op while a format is running", async () => {
    const { recording, recorder, editor } = setup();
    editor.status = "formatting";

    await recording.toggleRecording();

    expect(recorder.start).not.toHaveBeenCalled();
  });

  it("a microphone failure surfaces as a recording error, not a hang", async () => {
    const { recording, recorder, editor } = setup();
    recorder.start.mockRejectedValueOnce(new Error("denied"));

    await recording.toggleRecording();

    expect(editor.status).toBe("error");
    expect(editor.errorMessage).toBe("Could not access microphone: denied");
    expect(editor.isStarting).toBe(false);
  });

  it("chunks transcribe strictly in order even when fired back to back", async () => {
    const { recording, recorder, notes } = setup();
    await recording.toggleRecording();

    let finishFirst;
    window.api.transcribe
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce("second words");

    recorder.onChunk("wav-1");
    recorder.onChunk("wav-2");
    await Promise.resolve(); // let the chain pick up the first chunk

    // The second chunk waits in the chain until the first lands.
    expect(window.api.transcribe).toHaveBeenCalledTimes(1);

    finishFirst("first words");
    await recording.drain();

    expect(window.api.transcribe).toHaveBeenCalledTimes(2);
    expect(notes.activeNote.markdown).toBe("first words\n\nsecond words");
  });

  it("feeds the previous transcript back as carryover for the next chunk", async () => {
    const { recording, recorder } = setup();
    await recording.toggleRecording();
    window.api.transcribe
      .mockResolvedValueOnce("first words")
      .mockResolvedValueOnce("second words");

    recorder.onChunk("wav-1");
    await recording.drain();
    recorder.onChunk("wav-2");
    await recording.drain();

    expect(window.api.transcribe.mock.calls[0][1]).toEqual({ carryover: "" });
    expect(window.api.transcribe.mock.calls[1][1].carryover).toContain(
      "first words",
    );
  });

  it("caps the carryover at its rolling window", async () => {
    const { recording, recorder } = setup();
    await recording.toggleRecording();
    window.api.transcribe
      .mockResolvedValueOnce("x".repeat(900))
      .mockResolvedValueOnce("more");

    recorder.onChunk("wav-1");
    await recording.drain();
    recorder.onChunk("wav-2");
    await recording.drain();

    expect(
      window.api.transcribe.mock.calls[1][1].carryover.length,
    ).toBeLessThanOrEqual(600);
  });

  it("an empty transcription appends nothing and saves nothing", async () => {
    const { recording, recorder, notes } = setup({ markdown: "body" });
    await recording.toggleRecording();
    window.api.transcribe.mockResolvedValueOnce("");

    recorder.onChunk("wav-1");
    await recording.drain();

    expect(notes.activeNote.markdown).toBe("body");
    expect(window.api.saveNote).not.toHaveBeenCalled();
  });

  it("a failed chunk reports the error and lets later chunks continue", async () => {
    const { recording, recorder, notes, editor } = setup();
    await recording.toggleRecording();
    window.api.transcribe
      .mockRejectedValueOnce(new Error("whisper crashed"))
      .mockResolvedValueOnce("recovered words");

    recorder.onChunk("wav-1");
    recorder.onChunk("wav-2");
    await recording.drain();

    expect(editor.errorMessage).toBe("whisper crashed");
    expect(editor.isTranscribing).toBe(false);
    expect(notes.activeNote.markdown).toBe("recovered words");
  });

  it("stopping returns to idle immediately while the last chunk finishes", async () => {
    const { recording, recorder, editor, notes } = setup();
    await recording.toggleRecording();

    let finishLast;
    window.api.transcribe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLast = resolve;
        }),
    );
    recorder.onChunk("wav-final");

    await recording.toggleRecording(); // stop

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(editor.isRecording).toBe(false);
    // The footer can still show "Transcribing…" for the in-flight chunk.
    expect(editor.isTranscribing).toBe(true);

    finishLast("last words");
    await recording.drain();
    expect(editor.isTranscribing).toBe(false);
    expect(notes.activeNote.markdown).toBe("last words");
  });
});
