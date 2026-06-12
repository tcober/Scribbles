<!-- Presentational editor: composes the title, body, pending images, context
     panel, and toolbar, and handles image drag-and-drop. Props in, events out. -->
<template>
  <div
    class="editor"
    :class="{ dragging: isDragging }"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <NoteTitle :title="note.title" @update="emit('title', $event)" />

    <NoteBody
      :note="note"
      :rendered="rendered"
      :edit-mode="editMode"
      :is-recording="isRecording"
      :is-transcribing="transcribing"
      :is-starting="starting"
      :is-dragging="isDragging"
      @markdown="emit('markdown', $event)"
    />

    <PendingImages
      :images="pendingImages"
      :max-images="maxImages"
      @remove="emit('remove-image', $event)"
    />

    <div v-if="isDragging" class="drop-overlay">
      <div class="drop-message">Drop image to attach</div>
    </div>

    <div class="error" v-if="error">
      <span class="error-message">{{ error }}</span>
      <button class="retry" @click="emit('retry-format')">Try again</button>
    </div>

    <transition name="fade">
      <ContextPanel
        v-if="showContext"
        :context="contextDraft"
        :is-formatting="isFormatting"
        @input="onContextInput"
      />
    </transition>

    <EditorToolbar
      :status="status"
      :edit-mode="editMode"
      :show-context="showContext"
      :has-context="hasContext"
      :is-recording="isRecording"
      :is-transcribing="transcribing"
      :is-starting="starting"
      :is-formatting="isFormatting"
      :format-progress="formatProgress"
      :can-undo="canUndo"
      @attach-images="emit('attach-images', $event)"
      @toggle-edit="toggleEdit"
      @toggle-context="showContext = !showContext"
      @format="emit('format')"
      @cancel-format="emit('cancel-format')"
      @undo="emit('undo')"
      @toggle="emit('toggle')"
    />
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import NoteTitle from "./note-editor/NoteTitle.vue";
import NoteBody from "./note-editor/NoteBody.vue";
import PendingImages from "./note-editor/PendingImages.vue";
import ContextPanel from "./note-editor/ContextPanel.vue";
import EditorToolbar from "./note-editor/EditorToolbar.vue";

const props = defineProps({
  note: { type: Object, required: true },
  rendered: { type: String, default: "" },
  status: { type: String, required: true },
  error: { type: String, default: "" },
  pendingImages: { type: Array, default: () => [] },
  maxImages: { type: Number, default: 0 },
  formatProgress: { type: Object, default: null },
  transcribing: { type: Boolean, default: false },
  starting: { type: Boolean, default: false },
  canUndo: { type: Boolean, default: false },
});

const emit = defineEmits([
  "title",
  "markdown",
  "save",
  "context",
  "toggle",
  "attach-images",
  "remove-image",
  "format",
  "cancel-format",
  "undo",
  "retry-format",
]);

const contextDraft = ref(props.note.context || "");
const showContext = ref(!!(props.note.context && props.note.context.trim()));
const editMode = ref(false);
const isDragging = ref(false);

watch(
  () => props.note.id,
  () => {
    contextDraft.value = props.note.context || "";
    showContext.value = !!(props.note.context && props.note.context.trim());
    editMode.value = false;
  },
);

// Context is per-format-run: when the parent clears it (after a successful
// format), reset the draft and collapse the panel so the next run starts fresh.
watch(
  () => props.note.context,
  (newContext) => {
    const updated = newContext || "";
    if (updated !== contextDraft.value) contextDraft.value = updated;
    if (!updated.trim()) showContext.value = false;
  },
);

const isRecording = computed(() => props.status === "recording");
const isFormatting = computed(() => props.status === "formatting");
const hasContext = computed(
  () => !!(contextDraft.value && contextDraft.value.trim()),
);

function toggleEdit() {
  // Leaving edit mode ("Save") flushes the pending write right away.
  if (editMode.value) emit("save");
  editMode.value = !editMode.value;
}

function onContextInput(value) {
  contextDraft.value = value;
  emit("context", value);
}

function onDragOver(event) {
  if (event.dataTransfer?.types?.includes("Files")) {
    event.preventDefault();
    isDragging.value = true;
  }
}

function onDragLeave(event) {
  if (event.currentTarget === event.target) isDragging.value = false;
}

function onDrop(event) {
  event.preventDefault();
  isDragging.value = false;
  const files = Array.from(event.dataTransfer?.files || []).filter((file) =>
    file.type.startsWith("image/"),
  );
  if (files.length) emit("attach-images", files);
}
</script>

<style scoped>
.editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  position: relative;
  -webkit-app-region: drag;
}

/* Drop overlay */
.drop-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--accent), transparent 92%);
  border: 2px dashed var(--accent-strong);
  border-radius: 12px;
  margin: 1rem;
  z-index: 5;
}
.drop-message {
  color: var(--accent);
  font-size: 1.05rem;
  font-weight: 500;
  background: var(--bg);
  padding: 0.6rem 1.2rem;
  border-radius: 8px;
}

.error {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  background: var(--danger-surface);
  color: var(--danger-text);
  padding: 0.6rem 1rem;
  margin: 0 2rem;
  border-radius: 6px;
  border: 1px solid var(--danger-border);
  font-size: 0.85rem;
}
.error-message {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.error .retry {
  flex-shrink: 0;
  background: none;
  border: 1px solid var(--danger-border);
  border-radius: 4px;
  color: var(--danger-text);
  font-size: 0.8rem;
  padding: 0.2rem 0.6rem;
  cursor: pointer;
  white-space: nowrap;
}
.error .retry:hover {
  background: var(--danger-border);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
