<template>
  <div class="app">
    <SidebarContainer />

    <main class="main">
      <header
        v-if="editorStore.llmStatus && !editorStore.llmStatus.ok"
        class="warning"
      >
        Cannot reach Ollama. Start it (menubar app or <code>ollama serve</code>)
        and pull the model:
        <code>ollama pull {{ editorStore.llmStatus?.model || "gemma4" }}</code
        >.
      </header>
      <header
        v-else-if="editorStore.llmStatus && !editorStore.llmStatus.hasModel"
        class="warning"
      >
        Ollama is running but model
        <code>{{ editorStore.llmStatus.model }}</code> is not installed. Pull it:
        <code>ollama pull {{ editorStore.llmStatus.model }}</code
        >.
      </header>

      <NoteEditorContainer />
    </main>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from "vue";
import SidebarContainer from "./components/SidebarContainer.vue";
import NoteEditorContainer from "./components/NoteEditorContainer.vue";
import { useNotesStore } from "./stores/notes.js";
import { useEditorStore } from "./stores/editor.js";

const notesStore = useNotesStore();
const editorStore = useEditorStore();

onMounted(async () => {
  await notesStore.refreshNotes();
  await editorStore.checkLlm();
  // Subscribe once here at the app root; the store keeps the unsubscribe and
  // re-subscribes idempotently to survive Vite HMR.
  editorStore.subscribeFormatProgress();
});

onBeforeUnmount(() => {
  editorStore.unsubscribeFormatProgress();
});
</script>

<style scoped>
.app {
  display: flex;
  height: 100vh;
}
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.warning {
  background: #3a2418;
  color: #f3c98b;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid #5a3a22;
  font-size: 0.85rem;
}
.warning code {
  background: #2a1810;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
}
</style>
