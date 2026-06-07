<!-- Editable note title; emits the new title on blur / Enter. -->
<template>
  <div class="title-row">
    <input
      class="title-input"
      v-model="draft"
      @blur="onBlur"
      @keydown.enter="$event.target.blur()"
      placeholder="Untitled note"
    />
  </div>
</template>

<script setup>
import { ref, watch } from "vue";

const props = defineProps({
  title: { type: String, default: "" },
});

const emit = defineEmits(["update"]);

const draft = ref(props.title);

// Reflect external title changes (e.g. switching notes) into the draft, but
// leave in-progress typing alone.
watch(
  () => props.title,
  (val) => {
    if (val !== draft.value) draft.value = val;
  },
);

function onBlur() {
  if (draft.value !== props.title) {
    emit("update", draft.value || "Untitled note");
  }
}
</script>

<style scoped>
.title-row {
  padding: 2.5rem 2rem 0.5rem;
  -webkit-app-region: drag;
}
.title-input {
  -webkit-app-region: no-drag;
  background: transparent;
  border: none;
  font-size: 1.6rem;
  font-weight: 600;
  color: var(--text-bright);
  width: 100%;
  outline: none;
}
</style>
