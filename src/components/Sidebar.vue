<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <span class="brand">Notes</span>
      <button class="new" :disabled="disabled" @click="emit('create')" title="New note">+ New</button>
    </div>

    <div class="list">
      <div
        v-for="note in notes"
        :key="note.id"
        class="item"
        :class="{ active: note.id === activeId }"
        @click="!disabled && emit('select', note.id)"
      >
        <div class="title">{{ note.title || 'Untitled note' }}</div>
        <div class="meta">
          <span>{{ formatDate(note.updatedAt) }}</span>
          <button
            class="trash"
            :disabled="disabled"
            title="Delete note"
            @click.stop="emit('delete', note.id)"
          >×</button>
        </div>
      </div>
      <div v-if="!notes.length" class="empty">No notes yet</div>
    </div>

    <button class="reveal" @click="emit('reveal')">Show in Finder</button>
  </aside>
</template>

<script setup>
defineProps({
  notes: { type: Array, required: true },
  activeId: { type: String, default: null },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['select', 'create', 'delete', 'reveal']);

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
</script>

<style scoped>
.sidebar {
  width: 260px;
  background: #0c0f15;
  border-right: 1px solid #1c222e;
  display: flex;
  flex-direction: column;
  -webkit-app-region: drag;
}
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1rem 0.75rem;
  padding-top: 2.5rem;
}
.brand {
  font-weight: 600;
  color: #e8ecf4;
}
.new {
  -webkit-app-region: no-drag;
  background: #1f2632;
  color: #c9d3e6;
  border: 1px solid #2a3242;
  padding: 0.3rem 0.65rem;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.85rem;
}
.new:hover:not(:disabled) {
  background: #2a3242;
}
.new:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.list {
  flex: 1;
  overflow-y: auto;
  padding: 0.4rem;
  -webkit-app-region: no-drag;
}
.item {
  padding: 0.6rem 0.7rem;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 2px;
}
.item:hover {
  background: #161b25;
}
.item.active {
  background: #1d2531;
}
.title {
  color: #d5dbe8;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.2rem;
  font-size: 0.75rem;
  color: #6e7689;
}
.trash {
  background: transparent;
  border: none;
  color: #6e7689;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.25rem;
}
.trash:hover:not(:disabled) {
  color: #ff7676;
}
.empty {
  text-align: center;
  color: #5a6276;
  font-size: 0.85rem;
  padding: 2rem 0;
}
.reveal {
  -webkit-app-region: no-drag;
  margin: 0.5rem;
  padding: 0.45rem;
  background: transparent;
  color: #6e7689;
  border: 1px solid #1c222e;
  border-radius: 5px;
  font-size: 0.8rem;
  cursor: pointer;
}
.reveal:hover {
  color: #c9d3e6;
  background: #161b25;
}
</style>
