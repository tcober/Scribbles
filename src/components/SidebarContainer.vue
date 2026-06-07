<template>
  <Sidebar
    :notes="notesStore.notes"
    :active-id="notesStore.activeId"
    :disabled="editorStore.isRecording"
    @select="onSelect"
    @create="onCreate"
    @delete="onDelete"
    @reveal="onReveal"
  />
</template>

<script setup>
import Sidebar from "./Sidebar.vue";
import { useNotesStore } from "../stores/notes.js";
import { useEditorStore } from "../stores/editor.js";

const notesStore = useNotesStore();
const editorStore = useEditorStore();

// Block navigation while recording so an in-flight chunk can't land in (or a
// delete can't remove) the wrong note mid-session.
function onSelect(id) {
  if (editorStore.isRecording) return;
  notesStore.selectNote(id);
}

function onCreate() {
  if (editorStore.isRecording) return;
  notesStore.createNote();
}

function onDelete(id) {
  if (editorStore.isRecording) return;
  notesStore.deleteNote(id);
}

async function onReveal() {
  try {
    await window.api.revealNotesFolder();
  } catch (err) {
    editorStore.setErrorMessage(err?.message || String(err));
    console.error("revealNotesFolder failed:", err);
  }
}
</script>
