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

  const isRecording = computed(() => status.value === "recording");
  const isFormatting = computed(() => status.value === "formatting");
  const isTranscribing = computed(() => pendingTranscriptions.value > 0);

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
    const images = notesStore.pendingImages.slice();
    const context = (note.context || "").trim();

    if (!newRaw && images.length === 0) {
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
        images: images.map(({ filename, url, path, mime }) => ({
          filename,
          url,
          path,
          mime,
        })),
      });
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
      notesStore.clearPendingImages();
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

  // Ask the main process to abort the in-progress format. runFormat's catch then
  // resolves the cancellation back to idle.
  function cancelFormat() {
    if (status.value !== "formatting") return;
    formatProgress.value = { stage: "Cancelling…", detail: "" };
    window.api.cancelFormat();
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
    cancelFormat,
  };
});
