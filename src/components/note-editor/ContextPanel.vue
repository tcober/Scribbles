<!-- Per-run context box fed to the next "Format with Gemma" pass. -->
<template>
  <div class="context-panel">
    <div class="context-label">
      Context for the next Format with Gemma run
      <span class="context-hint">
        — cleared after Gemma finishes. Background ("meeting about payments
        rewrite"), jargon ("speaker uses React + tRPC"), or ask Gemma to search
        the web ("look up the latest React 19 release notes and add them").
      </span>
    </div>
    <textarea
      class="context-input"
      :value="context"
      :disabled="isFormatting"
      @input="onInput"
      placeholder="Background, jargon, or things to look up — e.g. 'research gRPC vs REST and add a short comparison'…"
      rows="3"
    />
    <div class="context-foot">
      <span class="context-arrow">↓ used by Format with Gemma below</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  context: { type: String, default: "" },
  isFormatting: { type: Boolean, default: false },
});

const emit = defineEmits(["input"]);

function onInput(event) {
  emit("input", event.target.value);
}
</script>

<style scoped>
.context-panel {
  -webkit-app-region: no-drag;
  margin: 0 2rem 0.75rem;
  padding: 0.65rem 0.85rem 0.45rem;
  background: color-mix(in srgb, var(--success), transparent 92%);
  border: 1px solid color-mix(in srgb, var(--success), transparent 65%);
  border-radius: 8px;
}
.context-label {
  font-size: 0.78rem;
  color: var(--success-text);
  margin-bottom: 0.45rem;
  font-weight: 500;
}
.context-hint {
  color: var(--text-dim);
  font-weight: 400;
}
.context-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-bright);
  padding: 0.5rem 0.65rem;
  font-family: inherit;
  font-size: 0.85rem;
  line-height: 1.45;
  resize: vertical;
  outline: none;
}
.context-input:focus {
  border-color: var(--success);
}
.context-input::placeholder {
  color: var(--text-dim);
}
.context-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.context-foot {
  margin-top: 0.4rem;
  text-align: right;
}
.context-arrow {
  font-size: 0.72rem;
  color: var(--text-dim);
  letter-spacing: 0.02em;
}
</style>
