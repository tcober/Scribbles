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
    @title="notesStore.saveTitle"
    @markdown="onMarkdown"
    @context="onContext"
    @toggle="recording.toggleRecording"
    @attach-images="attachImages"
    @remove-image="notesStore.removePendingImage"
    @format="onFormat"
    @cancel-format="editorStore.cancelFormat"
  />

  <div v-else class="empty">
    <h1>Scribbles</h1>
    <p>Create a new note and hit <strong>Start listening</strong>.</p>
    <p>
      Audio is transcribed locally. Drop in up to
      {{ MAX_IMAGES_PER_FORMAT }} images and Gemma 4 will place them in the right
      spots when it formats.
    </p>
    <button class="primary" @click="notesStore.createNote()">+ New note</button>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from "vue";
import NoteEditor from "./NoteEditor.vue";
import { MAX_IMAGES_PER_FORMAT } from "../utils/constants.js";
import { fileToDataUrl } from "../utils/fileToDataUrl.js";
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
  clearTimeout(markdownSaveTimer);
  markdownSaveTimer = setTimeout(() => notesStore.saveActiveNote(), 400);
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

async function attachImages(files) {
  const remaining = MAX_IMAGES_PER_FORMAT - notesStore.pendingImages.length;
  if (remaining <= 0) {
    editorStore.setErrorMessage(
      `You can attach up to ${MAX_IMAGES_PER_FORMAT} images per format.`,
    );
    return;
  }

  const incoming = Array.from(files).filter(
    (file) => file && file.type?.startsWith("image/"),
  );
  if (incoming.length > remaining) {
    editorStore.setErrorMessage(
      `Only ${remaining} more image${remaining === 1 ? "" : "s"} can be added (limit ${MAX_IMAGES_PER_FORMAT} per format).`,
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
    } catch (err) {
      editorStore.setErrorMessage(`Could not attach image: ${err.message}`);
    }
  }
}

// Paste a screenshot anywhere to attach it. Named (not inline) so the same
// reference can be removed on unmount.
function handlePaste(event) {
  if (!event.clipboardData) return;
  const items = Array.from(event.clipboardData.items).filter((item) =>
    item.type.startsWith("image/"),
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
