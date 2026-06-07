<!-- Footer toolbar: status pill plus the attach / undo / edit / context /
     format / record controls. Props in, events out. -->
<template>
  <footer class="footer">
    <div
      class="status-pill"
      :class="[status, { transcribing: showTranscribing }]"
    >
      <span class="dot" />
      <div class="status-text">
        <span class="label">{{ statusLabel }}</span>
        <span v-if="progressDetail" class="detail" :title="progressDetail">
          {{ progressDetail }}
        </span>
      </div>
    </div>

    <div class="actions">
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        hidden
        @change="onFilesPicked"
      />
      <button
        class="ghost"
        :disabled="isFormatting || isRecording"
        @click="openFilePicker"
        title="Attach images — Gemma slots them in without changing your text"
      >
        Attach images
      </button>

      <button
        v-if="canUndo"
        class="ghost"
        :disabled="isFormatting || isRecording"
        @click="emit('undo')"
        title="Undo the last format / image placement"
      >
        Undo
      </button>

      <button
        class="ghost"
        :class="{ active: editMode }"
        :disabled="isFormatting"
        @click="emit('toggle-edit')"
        :title="editMode ? 'Save and switch to preview' : 'Edit raw Markdown'"
      >
        {{ editMode ? "Save" : "Edit" }}
      </button>

      <div
        class="gemma-group"
        :class="{ 'has-context': hasContext, open: showContext }"
      >
        <button
          class="context-toggle"
          :class="{ active: showContext, filled: hasContext }"
          :disabled="isFormatting"
          @click="emit('toggle-context')"
          :title="
            hasContext
              ? 'Context will be sent with the next format'
              : 'Add context for the next format'
          "
        >
          <span v-if="hasContext" class="ctx-dot" />
          + Context
        </button>
        <button
          v-if="!isFormatting"
          class="format"
          :disabled="formatDisabled"
          :title="
            isRecording
              ? 'Stop listening before formatting'
              : hasContext
                ? 'Format with Gemma (using your context)'
                : 'Format with Gemma'
          "
          @click="emit('format')"
        >
          Format with Gemma
        </button>
        <button
          v-else
          class="cancel"
          title="Stop formatting"
          @click="emit('cancel-format')"
        >
          <span class="spinner" />
          Cancel
        </button>
      </div>

      <button
        class="record"
        :class="{ recording: isRecording }"
        :disabled="recordDisabled"
        :title="isFormatting ? 'Wait for Gemma to finish' : 'Toggle listening'"
        @click="emit('toggle')"
      >
        <span class="rec-dot" v-if="isRecording" />
        {{ recordLabel }}
      </button>
    </div>
  </footer>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  status: { type: String, required: true },
  editMode: { type: Boolean, default: false },
  showContext: { type: Boolean, default: false },
  hasContext: { type: Boolean, default: false },
  isRecording: { type: Boolean, default: false },
  isTranscribing: { type: Boolean, default: false },
  isStarting: { type: Boolean, default: false },
  isFormatting: { type: Boolean, default: false },
  formatProgress: { type: Object, default: null },
  canUndo: { type: Boolean, default: false },
});

const emit = defineEmits([
  "attach-images",
  "toggle-edit",
  "toggle-context",
  "format",
  "cancel-format",
  "undo",
  "toggle",
]);

const fileInput = ref(null);

const statusLabel = computed(() => {
  if (props.isStarting) return "Starting…";
  switch (props.status) {
    case "recording":
      return "Listening…";
    case "formatting":
      return props.formatProgress?.stage || "Gemma 4 is formatting";
    case "error":
      return "Error";
    default:
      return props.isTranscribing ? "Transcribing…" : "Ready";
  }
});

// Pulse the dot while a stopped recording's final chunk is still transcribing.
const showTranscribing = computed(
  () =>
    props.isTranscribing &&
    props.status !== "recording" &&
    props.status !== "formatting",
);

// A tiny live snippet of what Gemma is currently producing, shown under the
// status label so a slow format clearly looks like progress, not a hang. While
// recording, surface "Transcribing…" when a chunk is in flight.
const progressDetail = computed(() => {
  if (props.status === "formatting") return props.formatProgress?.detail || "";
  if (props.status === "recording" && props.isTranscribing)
    return "Transcribing…";
  return "";
});

const recordLabel = computed(() => {
  if (props.isStarting) return "Starting…";
  return props.isRecording ? "Stop listening" : "Start listening";
});
const recordDisabled = computed(() => props.isFormatting || props.isStarting);
const formatDisabled = computed(
  () => props.isRecording || props.isFormatting || props.isTranscribing,
);

function openFilePicker() {
  fileInput.value?.click();
}

function onFilesPicked(event) {
  const files = Array.from(event.target.files || []);
  if (files.length) emit("attach-images", files);
  event.target.value = "";
}
</script>

<style scoped>
.footer {
  -webkit-app-region: no-drag;
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 2rem;
  background: linear-gradient(to top, var(--bg) 70%, transparent);
  border-top: 1px solid var(--border);
}
.actions {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}
.status-pill {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
  font-size: 0.85rem;
  min-width: 0;
}
.status-pill .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--bg-disabled);
  flex-shrink: 0;
}
.status-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}
.status-text .detail {
  color: var(--text-dim);
  font-size: 0.72rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  max-width: 22rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-pill.recording .dot {
  background: var(--danger);
  animation: pulse 1.2s ease-in-out infinite;
}
.status-pill.formatting .dot {
  background: var(--warning);
  animation: pulse 1.2s ease-in-out infinite;
}
.status-pill.transcribing .dot {
  background: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}
.status-pill.error .dot {
  background: var(--danger);
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.ghost {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--bg-active);
  border-radius: 999px;
  padding: 0.55rem 1rem;
  font-size: 0.85rem;
  cursor: pointer;
}
.ghost:hover:not(:disabled) {
  background: var(--bg-raised);
}
.ghost.active {
  background: var(--accent-surface);
  border-color: var(--accent-strong);
  color: var(--accent-text);
}
.ghost:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Visual pairing: Context feeds into Format with Gemma. */
.gemma-group {
  display: inline-flex;
  align-items: stretch;
  border-radius: 999px;
  padding: 3px;
  background: var(--success-surface);
  border: 1px solid var(--success-border);
  gap: 0;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}
.gemma-group.has-context {
  background: color-mix(in srgb, var(--success), transparent 84%);
  border-color: color-mix(in srgb, var(--success), transparent 40%);
}
.gemma-group.open {
  border-color: color-mix(in srgb, var(--success), transparent 15%);
}

.context-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: transparent;
  color: var(--success-text);
  border: none;
  border-radius: 999px;
  padding: 0.4rem 0.85rem;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
}
.context-toggle:hover:not(:disabled) {
  background: color-mix(in srgb, var(--success), transparent 82%);
  color: var(--success-text);
}
.context-toggle.active,
.context-toggle.filled {
  background: color-mix(in srgb, var(--success), transparent 78%);
  color: var(--success-text);
}
.context-toggle:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.ctx-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success-bright);
  box-shadow: 0 0 0 2px
    color-mix(in srgb, var(--success-bright), transparent 75%);
}

.format {
  background: var(--success);
  color: white;
  border: none;
  border-radius: 999px;
  padding: 0.55rem 1.1rem;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
}
.format:hover:not(:disabled) {
  background: var(--success-bright);
}
.format:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Shown in place of Format while a format is running — click to abort. */
.cancel {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  background: color-mix(in srgb, var(--danger), transparent 84%);
  color: var(--danger-text);
  border: 1px solid color-mix(in srgb, var(--danger), transparent 45%);
  border-radius: 999px;
  padding: 0.55rem 1.1rem;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.cancel:hover {
  background: color-mix(in srgb, var(--danger), transparent 72%);
  color: var(--danger-text);
}
.spinner {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--danger), transparent 65%);
  border-top-color: var(--danger-text);
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.record {
  background: var(--accent-strong);
  color: white;
  border: none;
  border-radius: 999px;
  padding: 0.7rem 1.5rem;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.record:hover:not(:disabled) {
  background: var(--accent);
}
.record:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.record.recording {
  background: var(--danger-strong);
}
.record.recording:hover {
  background: var(--danger-hover);
}
.rec-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: white;
  animation: pulse 1.2s ease-in-out infinite;
}
</style>
