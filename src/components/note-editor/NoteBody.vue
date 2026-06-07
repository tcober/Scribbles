<template>
  <textarea
    v-if="editMode"
    ref="textareaRef"
    class="editor-textarea"
    :value="markdownDraft"
    @input="onInput"
    placeholder="Write or edit your note in Markdown…"
    spellcheck="true"
  />
  <div class="preview" :class="{ dim: isDragging }" v-else-if="note.markdown">
    <!-- Renders the user's own local notes, parsed from Markdown by `marked`; no third-party/remote input. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div class="markdown" v-html="rendered" />
    <div v-if="isRecording" class="caret"></div>
  </div>
  <div
    class="preview listening"
    :class="{ dim: isDragging }"
    v-else-if="isRecording || isStarting || isTranscribing"
  >
    <p class="listening-line">
      <span class="caret" />
      <span>{{ isTranscribing ? "Transcribing…" : "Listening…" }}</span>
    </p>
    <p class="hint">
      Your transcript will appear here as you speak — the first words take a few
      seconds.
    </p>
  </div>
  <div class="preview empty" :class="{ dim: isDragging }" v-else>
    <p>
      This note is empty. Hit <strong>Start listening</strong> below, or drop an
      image to get started.
    </p>
    <p class="hint">
      Speech becomes a transcript live. Drag-and-drop or paste images; Gemma 4
      places them where they fit when it formats.
    </p>
  </div>
</template>

<script setup>
import { ref, watch } from "vue";

const props = defineProps({
  note: { type: Object, required: true },
  rendered: { type: String, default: "" },
  editMode: { type: Boolean, default: false },
  isRecording: { type: Boolean, default: false },
  isTranscribing: { type: Boolean, default: false },
  isStarting: { type: Boolean, default: false },
  isDragging: { type: Boolean, default: false },
});

const emit = defineEmits(["markdown"]);

const markdownDraft = ref(props.note.markdown || "");
const textareaRef = ref(null);
let lastSeenMarkdown = props.note.markdown || "";

watch(
  () => props.note.id,
  () => {
    markdownDraft.value = props.note.markdown || "";
    lastSeenMarkdown = markdownDraft.value;
  },
);

// Keep markdownDraft in sync when the parent updates note.markdown (recording
// chunks, format pass, etc). While the user is editing, only append the new tail
// so we don't clobber their in-progress edits.
watch(
  () => props.note.markdown,
  (newVal) => {
    const updated = newVal || "";
    if (props.editMode && updated.startsWith(lastSeenMarkdown)) {
      const tail = updated.slice(lastSeenMarkdown.length);
      if (tail) {
        const el = textareaRef.value;
        const atEnd = el && el.selectionStart === markdownDraft.value.length;
        markdownDraft.value = markdownDraft.value + tail;
        if (atEnd) {
          // Keep the caret at the end so streaming feels natural.
          focusEnd();
        }
      }
    } else {
      markdownDraft.value = updated;
    }
    lastSeenMarkdown = updated;
  },
);

// When the parent flips us into edit mode, seed the textarea from the latest
// markdown and drop the caret in.
watch(
  () => props.editMode,
  (on) => {
    if (!on) return;
    markdownDraft.value = props.note.markdown || "";
    lastSeenMarkdown = markdownDraft.value;
    requestAnimationFrame(() => textareaRef.value?.focus());
  },
);

function focusEnd() {
  requestAnimationFrame(() => {
    const el = textareaRef.value;
    if (!el) return;
    el.selectionStart = el.selectionEnd = markdownDraft.value.length;
    el.scrollTop = el.scrollHeight;
  });
}

function onInput(event) {
  const value = event.target.value;
  markdownDraft.value = value;
  // Set lastSeenMarkdown before emitting so the watcher (which fires when the
  // parent reflects the change back) sees a no-op diff.
  lastSeenMarkdown = value;
  emit("markdown", value);
}
</script>

<style scoped>
.preview {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.5rem 2rem 1rem;
  -webkit-app-region: no-drag;
}
.preview.empty {
  color: var(--text-dim);
}
.preview.listening {
  color: var(--text-muted);
}
.listening-line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text);
  font-weight: 500;
}
/* Dimmed while a file is being dragged over the editor. */
.preview.dim {
  opacity: 0.4;
}
.editor-textarea {
  -webkit-app-region: no-drag;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.5rem 2rem 1rem;
  background: transparent;
  border: none;
  color: var(--text-bright);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92rem;
  line-height: 1.55;
  resize: none;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.editor-textarea::placeholder {
  color: var(--text-dim);
}
.preview .hint {
  font-size: 0.85rem;
  color: var(--text-dim);
  margin-top: 0.3rem;
}
.caret {
  display: inline-block;
  width: 8px;
  height: 1.1rem;
  vertical-align: text-bottom;
  background: var(--accent);
  margin-left: 2px;
  animation: blink 1s steps(2, start) infinite;
}
@keyframes blink {
  to {
    visibility: hidden;
  }
}
</style>
