import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { marked } from "marked";

import { MAX_IMAGES_PER_FORMAT } from "../utils/constants.js";
import { plain } from "../utils/plain.js";
import { useEditorStore } from "./editor.js";

// The "content" store: the note collection, the loaded active note, and the
// images staged for the next format pass. It owns every notes/images IPC call.
// Runtime state (recording/formatting status, errors) lives in the editor store.
export const useNotesStore = defineStore("notes", () => {
  const notes = ref([]);
  const activeNote = ref(null);
  // Images attached since the last format pass. Cleared after Gemma places them.
  const pendingImages = ref([]);

  const activeId = computed(() => activeNote.value?.id ?? null);
  const renderedMarkdown = computed(() =>
    activeNote.value ? marked.parse(activeNote.value.markdown || "") : "",
  );
  const canAttachMore = computed(
    () => pendingImages.value.length < MAX_IMAGES_PER_FORMAT,
  );

  async function refreshNotes() {
    notes.value = await window.api.listNotes();
  }

  async function selectNote(id) {
    activeNote.value = await window.api.loadNote(id);
    clearPendingImages();
    useEditorStore().clearFormatSnapshot();
  }

  async function createNote(title = "Untitled note") {
    const created = await window.api.createNote(title);
    await refreshNotes();
    activeNote.value = created;
    clearPendingImages();
    useEditorStore().clearFormatSnapshot();
    return created;
  }

  async function deleteNote(id) {
    await window.api.deleteNote(id);
    if (activeNote.value?.id === id) {
      activeNote.value = null;
      clearPendingImages();
    }
    useEditorStore().clearFormatSnapshot();
    await refreshNotes();
  }

  // Persist the active note as plain data (stripped of Vue reactivity for IPC).
  async function saveActiveNote() {
    if (!activeNote.value) return;
    await window.api.saveNote(plain(activeNote.value));
  }

  async function saveTitle(title) {
    if (!activeNote.value) return;
    activeNote.value.title = title;
    await saveActiveNote();
    await refreshNotes();
  }

  // Mutate the active note's content in memory. Persisting is the caller's job
  // (the editor container debounces saves), so these stay synchronous.
  function setMarkdown(markdown) {
    if (!activeNote.value) return;
    activeNote.value.markdown = markdown;
  }

  function setContext(context) {
    if (!activeNote.value) return;
    activeNote.value.context = context;
  }

  // Append freshly transcribed text, inserting a blank line when the existing
  // body doesn't already end with one so sections stay separated.
  function appendTranscript(text) {
    if (!activeNote.value || !text) return;
    const body = activeNote.value.markdown || "";
    const separator = body && !body.endsWith("\n\n") ? "\n\n" : "";
    activeNote.value.markdown = body + separator + text;
  }

  function addPendingImage(image) {
    pendingImages.value.push(image);
  }

  async function removePendingImage(filename) {
    if (!activeNote.value) return;
    const exists = pendingImages.value.some(
      (image) => image.filename === filename,
    );
    if (!exists) return;
    // Delete on disk first; only drop it from the list once that succeeds, so a
    // failed delete leaves the UI consistent with what's actually stored.
    await window.api.deleteImage({
      noteId: activeNote.value.id,
      filename,
    });
    pendingImages.value = pendingImages.value.filter(
      (image) => image.filename !== filename,
    );
  }

  function clearPendingImages() {
    pendingImages.value = [];
  }

  return {
    notes,
    activeNote,
    pendingImages,
    activeId,
    renderedMarkdown,
    canAttachMore,
    refreshNotes,
    selectNote,
    createNote,
    deleteNote,
    saveActiveNote,
    saveTitle,
    setMarkdown,
    setContext,
    appendTranscript,
    addPendingImage,
    removePendingImage,
    clearPendingImages,
  };
});
