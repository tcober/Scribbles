<!-- Thumbnail strip of images staged for the next placement pass; emits remove. -->
<template>
  <transition name="fade">
    <div v-if="images.length" class="pending">
      <div class="pending-label">
        Placing {{ images.length
        }}{{ maxImages ? ` / ${maxImages}` : "" }} image{{
          images.length === 1 ? "" : "s"
        }}
        into your notes…
      </div>
      <div class="thumbs">
        <div v-for="image in images" :key="image.filename" class="thumb">
          <img :src="image.url" alt="" />
          <button
            class="thumb-remove"
            @click="emit('remove', image.filename)"
            title="Remove"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
defineProps({
  images: { type: Array, default: () => [] },
  maxImages: { type: Number, default: 0 },
});

const emit = defineEmits(["remove"]);
</script>

<style scoped>
.pending {
  -webkit-app-region: no-drag;
  margin: 0 2rem 0.75rem;
  padding: 0.6rem 0.75rem;
  background: var(--bg-raised);
  border: 1px solid var(--bg-hover);
  border-radius: 8px;
}
.pending-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-bottom: 0.45rem;
}
.thumbs {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.thumb {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-deep);
  border: 1px solid var(--border);
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.thumb-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--overlay-scrim);
  color: white;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0;
}
.thumb-remove:hover {
  background: var(--danger-strong);
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
