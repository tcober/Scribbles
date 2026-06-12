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
  // Count (not a flag) of chunks whisper is transcribing — chunks overlap, and it
  // stays > 0 while a just-stopped recording finishes its final chunk.
  const pendingTranscriptions = ref(0);
  // True only while the mic/AudioContext is being acquired, so the record button
  // can react to the click without waiting for getUserMedia.
  const isStarting = ref(false);
  // Offset into the note's markdown where this recording session's raw transcript
  // begins, so a format pass shows Gemma only the new speech.
  const sessionStartIndex = ref(0);
  // Note snapshot from just before the last AI mutation, for one-step undo. Shape:
  // { noteId, markdown, sessionStartIndex }. Cleared on note switch / manual edit.
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

  // Reflect Gemma's live progress while formatting, ignoring late updates that
  // arrive after we leave the state (e.g. post-cancel). Re-subscribed idempotently
  // so duplicate listeners don't pile up across Vite HMR reloads.
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

  // Shared scaffold for the two AI mutations (format, image placement): claim
  // the busy state, run `work(notesStore, note)`, and resolve the outcome —
  // including translating a user-initiated cancel back to idle. Because both
  // passes funnel through here, they serialize against each other and recording.
  async function runAiPass(initialStage, work) {
    const notesStore = useNotesStore();
    const note = notesStore.activeNote;
    if (!note) return;
    if (status.value !== "idle") return;

    // Claim the busy state synchronously, BEFORE any await, so a second trigger
    // can't slip past the guard above — two concurrent Gemma runs mean two model
    // loads and can swap the machine. Do not add an await before this.
    status.value = "formatting";
    formatProgress.value = { stage: initialStage, detail: "" };

    try {
      await work(notesStore, note);
      status.value = "idle";
    } catch (error) {
      // A user-initiated cancel is not an error — leave the note untouched and
      // return to idle quietly. Everything else surfaces as an error.
      if ((error.message || "").includes("FORMAT_CANCELLED")) {
        status.value = "idle";
      } else {
        status.value = "error";
        errorMessage.value = error.message || String(error);
      }
    } finally {
      formatProgress.value = null;
    }
  }

  // Persist an AI-updated note and advance the session marker so the next
  // format pass only sees speech recorded after this point.
  async function persistAiUpdate(notesStore) {
    await notesStore.saveActiveNote();
    await notesStore.refreshNotes();
    sessionStartIndex.value = notesStore.activeNote.markdown.length;
  }

  // Run Gemma over the new raw transcript, merging it into already-formatted
  // content. The one action that coordinates both stores.
  //   drain              — awaits any in-flight transcription so the transcript is complete.
  //   cancelPendingSaves — cancels the container's debounced saves so a stale-context save can't race this.
  async function runFormat({ drain, cancelPendingSaves } = {}) {
    await runAiPass("Starting…", async (notesStore, note) => {
      // A just-stopped recording may still have a final chunk in flight; wait
      // for it so the transcript Gemma sees is complete.
      if (pendingTranscriptions.value > 0 && drain) await drain();

      const full = note.markdown || "";
      const newRaw = full.slice(sessionStartIndex.value).trim();
      if (!newRaw) return;

      // Re-send only a bounded recent slice; the head stays verbatim and is
      // stitched back after Gemma returns, keeping prompt size (and memory) flat.
      const previouslyFormatted = full
        .slice(0, sessionStartIndex.value)
        .trimEnd();
      const { head: formattedHead, tail: formattedTail } =
        splitFormatContext(previouslyFormatted);

      const updated = await window.api.formatNote({
        transcript: newRaw,
        existing: formattedTail,
        context: (note.context || "").trim(),
      });
      snapshotForUndo(note.id, full);
      notesStore.setMarkdown(
        formattedHead ? `${formattedHead}\n\n${updated}` : updated,
      );
      // Context is per-format-run: clear it so the panel collapses and the next
      // run starts fresh.
      notesStore.setContext("");
      cancelPendingSaves?.();
      await persistAiUpdate(notesStore);
    });
  }

  // Splice the pending images into the note without reformatting the prose (the
  // main process captions each and picks where it fits).
  async function placeImages() {
    const images = useNotesStore().pendingImages.slice();
    if (images.length === 0) return;

    await runAiPass("Looking at images…", async (notesStore, note) => {
      const markdown = note.markdown || "";
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
      await persistAiUpdate(notesStore);
      notesStore.clearPendingImages();
    });
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
    if (
      !notesStore.activeNote ||
      notesStore.activeNote.id !== snapshot.noteId
    ) {
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
