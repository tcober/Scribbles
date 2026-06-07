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
        :disabled="isFormatting"
        @click="openFilePicker"
        title="Attach images"
      >
        Attach images
      </button>

      <button
        class="ghost"
        :class="{ active: editMode }"
        :disabled="isFormatting"
        @click="emit('toggle-edit')"
        :title="editMode ? 'Switch to preview' : 'Edit raw Markdown'"
      >
        {{ editMode ? "Preview" : "Edit" }}
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
});

const emit = defineEmits([
  "attach-images",
  "toggle-edit",
  "toggle-context",
  "format",
  "cancel-format",
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
  background: linear-gradient(to top, #10131a 70%, rgba(16, 19, 26, 0));
  border-top: 1px solid #1c222e;
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
  color: #8a93a6;
  font-size: 0.85rem;
  min-width: 0;
}
.status-pill .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4a5468;
  flex-shrink: 0;
}
.status-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}
.status-text .detail {
  color: #5f6a7e;
  font-size: 0.72rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  max-width: 22rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-pill.recording .dot {
  background: #ff5d5d;
  animation: pulse 1.2s ease-in-out infinite;
}
.status-pill.formatting .dot {
  background: #f5c14c;
  animation: pulse 1.2s ease-in-out infinite;
}
.status-pill.transcribing .dot {
  background: #6aa0ff;
  animation: pulse 1.2s ease-in-out infinite;
}
.status-pill.error .dot {
  background: #ff5d5d;
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
  color: #c9d3e6;
  border: 1px solid #2a3242;
  border-radius: 999px;
  padding: 0.55rem 1rem;
  font-size: 0.85rem;
  cursor: pointer;
}
.ghost:hover:not(:disabled) {
  background: #1d2531;
}
.ghost.active {
  background: #1f2a3d;
  border-color: #4c8bf5;
  color: #b8cffd;
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
  background: #1a2520;
  border: 1px solid #2a3a30;
  gap: 0;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}
.gemma-group.has-context {
  background: rgba(94, 166, 107, 0.16);
  border-color: rgba(94, 166, 107, 0.6);
}
.gemma-group.open {
  border-color: rgba(94, 166, 107, 0.85);
}

.context-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: transparent;
  color: #b6c9bc;
  border: none;
  border-radius: 999px;
  padding: 0.4rem 0.85rem;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
}
.context-toggle:hover:not(:disabled) {
  background: rgba(94, 166, 107, 0.18);
  color: #d9ecdf;
}
.context-toggle.active,
.context-toggle.filled {
  background: rgba(94, 166, 107, 0.22);
  color: #d9ecdf;
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
  background: #6fc07d;
  box-shadow: 0 0 0 2px rgba(111, 192, 125, 0.25);
}

.format {
  background: #5ea66b;
  color: white;
  border: none;
  border-radius: 999px;
  padding: 0.55rem 1.1rem;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
}
.format:hover:not(:disabled) {
  background: #6fc07d;
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
  background: rgba(217, 72, 72, 0.16);
  color: #f0a3a3;
  border: 1px solid rgba(217, 72, 72, 0.55);
  border-radius: 999px;
  padding: 0.55rem 1.1rem;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.cancel:hover {
  background: rgba(217, 72, 72, 0.28);
  color: #ffc0c0;
}
.spinner {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid rgba(240, 163, 163, 0.35);
  border-top-color: #f0a3a3;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.record {
  background: #4c8bf5;
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
  background: #6aa0ff;
}
.record:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.record.recording {
  background: #d94848;
}
.record.recording:hover {
  background: #e76060;
}
.rec-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: white;
  animation: pulse 1.2s ease-in-out infinite;
}
</style>
