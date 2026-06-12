import { Recorder } from "../utils/recorder.js";
import { useNotesStore } from "../stores/notes.js";
import { useEditorStore } from "../stores/editor.js";

// Owns the imperative recording pipeline that doesn't belong in a reactive
// store: the Recorder (live Web Audio), the promise chain that serializes
// whisper calls, and the rolling carryover context. It pushes results into the
// notes store and reflects status through the editor store.
export function useRecording() {
  const notesStore = useNotesStore();
  const editorStore = useEditorStore();
  const recorder = new Recorder();

  // Serializes transcription so chunks land in order; reset once it fully drains.
  let transcribeChain = Promise.resolve();
  // Tail of the transcript so far, fed into the next chunk as whisper context.
  let carryover = "";

  function handleChunk(wav) {
    editorStore.incTranscriptions();
    transcribeChain = transcribeChain.then(async () => {
      try {
        const text = await window.api.transcribe(wav, { carryover });
        if (!text) return;
        notesStore.appendTranscript(text);
        // Carry the most recent words into the next chunk for cross-chunk context.
        carryover = `${carryover} ${text}`.slice(-600);
        await notesStore.saveActiveNote();
      } catch (error) {
        editorStore.setErrorMessage(error.message || String(error));
      } finally {
        editorStore.decTranscriptions();
      }
    });
  }

  async function startRecording() {
    editorStore.clearError();
    editorStore.setStarting(true);
    editorStore.setSessionStart((notesStore.activeNote?.markdown || "").length);
    carryover = "";
    try {
      await recorder.start({
        onChunk: handleChunk,
        chunkSeconds: 15,
        // Get the first words on screen quickly; later chunks use the full cadence.
        firstChunkSeconds: 5,
      });
      editorStore.setRecording();
    } catch (error) {
      editorStore.recordingFailed(
        `Could not access microphone: ${error.message}`,
      );
    } finally {
      editorStore.setStarting(false);
    }
  }

  async function stopRecording() {
    try {
      await recorder.stop();
    } catch (error) {
      editorStore.recordingFailed(`Recording failed: ${error.message}`);
      return;
    }
    // Leave the "recording" state right away so the button stops feeling stuck.
    // The final chunk finishes transcribing in the background — isTranscribing
    // keeps the footer showing "Transcribing…" until it lands.
    editorStore.setIdle();
    const draining = transcribeChain;
    draining.finally(() => {
      if (transcribeChain === draining) transcribeChain = Promise.resolve();
    });
  }

  async function toggleRecording() {
    if (editorStore.isFormatting) return;
    if (!notesStore.activeNote) await notesStore.createNote();
    if (editorStore.isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  }

  // Lets a format pass await any in-flight transcription before reading the note.
  function drain() {
    return transcribeChain;
  }

  return { toggleRecording, drain };
}
