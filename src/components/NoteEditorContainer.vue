<!-- Container: binds the notes + editor stores to NoteEditor and owns the
     view-side concerns — debounced saves, image attaching, paste-to-attach. -->
<template>
  <NoteEditor
    v-if="notesStore.activeNote"
    :note="notesStore.activeNote"
    :rendered="notesStore.renderedMarkdown"
    :status="editorStore.status"
    :error="editorStore.errorMessage"
    :pending-images="notesStore.pendingImages"
    :max-images="MAX_IMAGES_PER_FORMAT"
    :format-progress="editorStore.formatProgress"
    :transcribing="editorStore.isTranscribing"
    :starting="editorStore.isStarting"
    :can-undo="editorStore.canUndo"
    @title="notesStore.saveTitle"
    @markdown="onMarkdown"
    @save="onSave"
    @context="onContext"
    @toggle="recording.toggleRecording"
    @attach-images="attachImages"
    @remove-image="notesStore.removePendingImage"
    @format="onFormat"
    @cancel-format="editorStore.cancelFormat"
    @undo="editorStore.undoLastFormat"
    @retry-format="onRetryFormat"
  />

  <div v-else class="empty">
    <h1>Scribbles</h1>
    <p>Create a new note and hit <strong>Start listening</strong>.</p>
    <p>
      Audio is transcribed locally. Drop in up to
      {{ MAX_IMAGES_PER_FORMAT }} images and Gemma 4 will slot them into the
      right spots — without touching the rest of your notes.
    </p>
    <button class="primary" @click="notesStore.createNote()">+ New note</button>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from "vue";
import NoteEditor from "./NoteEditor.vue";
import { MAX_IMAGES_PER_FORMAT } from "../utils/constants.js";
import { fileToDataUrl } from "../utils/fileToDataUrl.js";
import { isImageFile, isImageType } from "../utils/images.js";
import { useNotesStore } from "../stores/notes.js";
import { useEditorStore } from "../stores/editor.js";
import { useRecording } from "../composables/useRecording.js";

const notesStore = useNotesStore();
const editorStore = useEditorStore();
const recording = useRecording();

// Debounced persistence: mutate the note in memory immediately so the editor
// stays responsive, then coalesce disk writes. Timers live here (a view-
// interaction concern), not in the store.
let markdownSaveTimer = null;
function onMarkdown(markdown) {
  notesStore.setMarkdown(markdown);
  // A manual edit means the undo snapshot no longer maps to "the last format".
  editorStore.clearFormatSnapshot();
  clearTimeout(markdownSaveTimer);
  markdownSaveTimer = setTimeout(() => notesStore.saveActiveNote(), 400);
}

// "Save" on the editor toolbar flushes the pending debounced write immediately
// so the word is truthful, rather than waiting out the 400ms timer.
function onSave() {
  clearTimeout(markdownSaveTimer);
  notesStore.saveActiveNote();
}

let contextSaveTimer = null;
function onContext(context) {
  notesStore.setContext(context);
  clearTimeout(contextSaveTimer);
  contextSaveTimer = setTimeout(() => notesStore.saveActiveNote(), 400);
}

function cancelPendingSaves() {
  clearTimeout(markdownSaveTimer);
  clearTimeout(contextSaveTimer);
}

// Hand the format pass our drain getter (so it can wait on any in-flight
// transcription) and a way to cancel queued debounced saves of stale context.
function onFormat() {
  editorStore.runFormat({ drain: recording.drain, cancelPendingSaves });
}

function onRetryFormat() {
  editorStore.setIdle();
  editorStore.clearError();
  editorStore.runFormat({ drain: recording.drain, cancelPendingSaves });
}

async function attachImages(files) {
  // Placement is an LLM run; don't stage into a note that's mid record/format.
  if (editorStore.status !== "idle") return;

  const remaining = MAX_IMAGES_PER_FORMAT - notesStore.pendingImages.length;
  if (remaining <= 0) {
    editorStore.setErrorMessage(
      `You can place up to ${MAX_IMAGES_PER_FORMAT} images at a time.`,
    );
    return;
  }

  const incoming = Array.from(files).filter(isImageFile);
  if (incoming.length > remaining) {
    editorStore.setErrorMessage(
      `Only ${remaining} more image${remaining === 1 ? "" : "s"} can be added (${MAX_IMAGES_PER_FORMAT} at a time).`,
    );
  }
  const accepted = incoming.slice(0, remaining);

  if (!notesStore.activeNote) await notesStore.createNote();
  for (const file of accepted) {
    try {
      const dataUrl = await fileToDataUrl(file);
      const image = await window.api.addImage({
        noteId: notesStore.activeNote.id,
        dataUrl,
      });
      notesStore.addPendingImage(image);
    } catch (error) {
      editorStore.setErrorMessage(`Could not attach image: ${error.message}`);
    }
  }

  // Immediately find a home for the freshly attached images, leaving the rest of
  // the note untouched. placeImages reads the pending list and clears it on done.
  if (notesStore.pendingImages.length) await editorStore.placeImages();
}

// Paste a screenshot anywhere to attach it. Named (not inline) so the same
// reference can be removed on unmount.
function handlePaste(event) {
  if (!event.clipboardData) return;
  const items = Array.from(event.clipboardData.items).filter((item) =>
    isImageType(item.type),
  );
  if (!items.length) return;
  const files = items.map((item) => item.getAsFile()).filter(Boolean);
  if (files.length) attachImages(files);
}

onMounted(() => {
  window.addEventListener("paste", handlePaste);
});

onBeforeUnmount(() => {
  window.removeEventListener("paste", handlePaste);
  cancelPendingSaves();
});
</script>

<style scoped>
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--text-muted);
  gap: 0.6rem;
}
.empty h1 {
  color: var(--text-bright);
  margin-bottom: 0.5rem;
}
.empty .primary {
  margin-top: 1.5rem;
  padding: 0.7rem 1.4rem;
  font-size: 1rem;
  background: var(--accent-strong);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.empty .primary:hover {
  background: var(--accent);
}
</style>
