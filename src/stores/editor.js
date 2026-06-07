import { defineStore } from "pinia";
import { ref, computed } from "vue";

import { splitFormatContext } from "../utils/formatContext.js";
import { useNotesStore } from "./notes.js";

// The "runtime" store: the idle|recording|formatting|error state machine plus
// everything that drives the two AI engines (whisper transcription, Gemma
// formatting). It owns the transcribe/format/cancel/checkLlm IPC calls. Note
// content lives in the notes store; this store coordinates with it for formats.
export const useEditorStore = defineStore("editor", () => {
  const status = ref("idle"); // idle | recording | formatting | error
  const errorMessage = ref("");
  const llmStatus = ref(null);
  // Live progress for the current format: { stage, detail }. Null when idle.
  const formatProgress = ref(null);
  // Number of audio chunks currently being transcribed by whisper. A counter
  // (not a flag) because chunks overlap — it stays > 0 while a just-stopped
  // recording finishes its final chunk.
  const pendingTranscriptions = ref(0);
  // True only while the mic/AudioContext is being acquired, so the record button
  // can react to the click immediately instead of waiting for getUserMedia.
  const isStarting = ref(false);
  // Offset into the active note's markdown where the current recording session's
  // raw transcript begins. Written when recording starts, read + reset by a
  // format pass so Gemma only sees the new speech.
  const sessionStartIndex = ref(0);
  // Snapshot of the note taken just before the last AI mutation (format or image
  // placement) so it can be undone in one step. Shape: { noteId, markdown,
  // sessionStartIndex }. Invalidated on note switch and manual edits.
  const lastFormatSnapshot = ref(null);

  const isRecording = computed(() => status.value === "recording");
  const isFormatting = computed(() => status.value === "formatting");
  const isTranscribing = computed(() => pendingTranscriptions.value > 0);
  // Undo is offered only while a snapshot exists AND still belongs to the note on
  // screen — switching notes or editing by hand invalidates it.
  const canUndo = computed(() => {
    const snapshot = lastFormatSnapshot.value;
    return !!snapshot && useNotesStore().activeId === snapshot.noteId;
  });

  // --- status / error mutators (consumed mainly by the recording composable) ---
  function setRecording() {
    status.value = "recording";
  }
  function setIdle() {
    status.value = "idle";
  }
  function recordingFailed(message) {
    status.value = "error";
    errorMessage.value = message;
  }
  function setStarting(value) {
    isStarting.value = value;
  }
  function setSessionStart(index) {
    sessionStartIndex.value = index;
  }
  function setErrorMessage(message) {
    errorMessage.value = message;
  }
  function clearError() {
    errorMessage.value = "";
  }
  function incTranscriptions() {
    pendingTranscriptions.value++;
  }
  function decTranscriptions() {
    pendingTranscriptions.value--;
  }

  async function checkLlm() {
    llmStatus.value = await window.api.checkLlm();
  }

  // Reflect Gemma's live progress while a format runs. Ignore late updates that
  // arrive after we've left the formatting state (e.g. post-cancel). Held in a
  // closure variable (not reactive state) and re-subscribed idempotently so
  // duplicate listeners don't pile up across Vite HMR reloads.
  let unsubscribe = null;
  function subscribeFormatProgress() {
    unsubscribe?.();
    unsubscribe = window.api.onFormatProgress((payload) => {
      if (status.value === "formatting") formatProgress.value = payload;
    });
  }
  function unsubscribeFormatProgress() {
    unsubscribe?.();
    unsubscribe = null;
  }

  // Run Gemma over the new raw transcript + any pending images, integrating with
  // already-formatted content. The one action that coordinates both stores.
  //   drain             — awaits any in-flight transcription (owned by the
  //                       recording composable) so the transcript is complete.
  //   cancelPendingSaves — clears the editor container's debounced save timers
  //                       so a queued stale-context save can't race this format.
  async function runFormat({ drain, cancelPendingSaves } = {}) {
    const notesStore = useNotesStore();
    const note = notesStore.activeNote;
    if (!note) return;
    if (status.value !== "idle") return;

    // Claim the formatting state synchronously, BEFORE any await, so a second
    // trigger can't slip past the guard above while we wait below — two
    // concurrent Gemma generations would mean two model loads and can swap the
    // machine. Do not introduce an await before this assignment.
    status.value = "formatting";
    formatProgress.value = { stage: "Starting…", detail: "" };

    // A just-stopped recording may still have a final chunk in flight; wait for
    // it so the transcript Gemma sees is complete.
    if (pendingTranscriptions.value > 0 && drain) await drain();

    const full = note.markdown || "";
    const newRaw = full.slice(sessionStartIndex.value).trim();
    const previouslyFormatted = full.slice(0, sessionStartIndex.value).trimEnd();
    const context = (note.context || "").trim();

    if (!newRaw) {
      status.value = "idle";
      formatProgress.value = null;
      return;
    }

    // Only re-send a bounded recent slice of the formatted note. Everything
    // before the split stays verbatim and is stitched back on after Gemma
    // returns, so the prompt size (and memory) stays flat no matter how long.
    const { head: formattedHead, tail: formattedTail } =
      splitFormatContext(previouslyFormatted);

    try {
      const updated = await window.api.formatNote({
        transcript: newRaw,
        existing: formattedTail,
        context,
      });
      snapshotForUndo(note.id, full);
      notesStore.setMarkdown(
        formattedHead ? `${formattedHead}\n\n${updated}` : updated,
      );
      // Context is per-format-run: clear it so the panel collapses and the next
      // run starts fresh.
      notesStore.setContext("");
      cancelPendingSaves?.();
      await notesStore.saveActiveNote();
      await notesStore.refreshNotes();
      sessionStartIndex.value = notesStore.activeNote.markdown.length;
      status.value = "idle";
    } catch (err) {
      // A user-initiated cancel is not an error — leave the note untouched and
      // return to idle quietly. Everything else surfaces as an error.
      if ((err.message || "").includes("FORMAT_CANCELLED")) {
        status.value = "idle";
      } else {
        status.value = "error";
        errorMessage.value = err.message || String(err);
      }
    } finally {
      formatProgress.value = null;
    }
  }

  // Place the pending images into the note without reformatting the prose: the
  // main process captions each image (vision) and picks where it fits, then
  // splices the image lines in so the existing text is left exactly as it was.
  // Reuses the formatting status/progress/cancel plumbing (only one LLM run at a
  // time), so it serializes against record + format the same way runFormat does.
  async function placeImages() {
    const notesStore = useNotesStore();
    const note = notesStore.activeNote;
    if (!note) return;
    if (status.value !== "idle") return;
    const images = notesStore.pendingImages.slice();
    if (images.length === 0) return;

    // Claim the busy state synchronously, BEFORE any await, so a second trigger
    // can't start a concurrent run. Do not introduce an await before this.
    status.value = "formatting";
    formatProgress.value = { stage: "Looking at images…", detail: "" };

    const markdown = note.markdown || "";
    try {
      const updated = await window.api.placeImages({
        markdown,
        images: images.map(({ filename, url, path, mime }) => ({
          filename,
          url,
          path,
          mime,
        })),
      });
      snapshotForUndo(note.id, markdown);
      notesStore.setMarkdown(updated);
      await notesStore.saveActiveNote();
      await notesStore.refreshNotes();
      sessionStartIndex.value = notesStore.activeNote.markdown.length;
      notesStore.clearPendingImages();
      status.value = "idle";
    } catch (err) {
      if ((err.message || "").includes("FORMAT_CANCELLED")) {
        status.value = "idle";
      } else {
        status.value = "error";
        errorMessage.value = err.message || String(err);
      }
    } finally {
      formatProgress.value = null;
    }
  }

  // Ask the main process to abort the in-progress format or placement run.
  // runFormat/placeImages' catch then resolves the cancellation back to idle.
  function cancelFormat() {
    if (status.value !== "formatting") return;
    formatProgress.value = { stage: "Cancelling…", detail: "" };
    window.api.cancelFormat();
  }

  // Record the pre-change note so the last AI mutation can be undone in one step.
  function snapshotForUndo(noteId, markdown) {
    lastFormatSnapshot.value = {
      noteId,
      markdown,
      sessionStartIndex: sessionStartIndex.value,
    };
  }

  // Restore the note to its state just before the last format/placement.
  async function undoLastFormat() {
    const snapshot = lastFormatSnapshot.value;
    if (!snapshot) return;
    const notesStore = useNotesStore();
    if (!notesStore.activeNote || notesStore.activeNote.id !== snapshot.noteId) {
      lastFormatSnapshot.value = null;
      return;
    }
    notesStore.setMarkdown(snapshot.markdown);
    sessionStartIndex.value = snapshot.sessionStartIndex;
    lastFormatSnapshot.value = null;
    await notesStore.saveActiveNote();
    await notesStore.refreshNotes();
  }

  // Drop the undo snapshot — called when it no longer maps to "the last AI
  // change" (note switch, manual edit).
  function clearFormatSnapshot() {
    lastFormatSnapshot.value = null;
  }

  return {
    status,
    errorMessage,
    llmStatus,
    formatProgress,
    pendingTranscriptions,
    isStarting,
    sessionStartIndex,
    isRecording,
    isFormatting,
    isTranscribing,
    canUndo,
    setRecording,
    setIdle,
    recordingFailed,
    setStarting,
    setSessionStart,
    setErrorMessage,
    clearError,
    incTranscriptions,
    decTranscriptions,
    checkLlm,
    subscribeFormatProgress,
    unsubscribeFormatProgress,
    runFormat,
    placeImages,
    cancelFormat,
    undoLastFormat,
    clearFormatSnapshot,
  };
});
