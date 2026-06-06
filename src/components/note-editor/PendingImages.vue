<template>
  <transition name="fade">
    <div v-if="images.length" class="pending">
      <div class="pending-label">
        {{ images.length }}{{ maxImages ? ` / ${maxImages}` : "" }}
        image{{ images.length === 1 ? "" : "s" }}
        pending — will be placed on next format
      </div>
      <div class="thumbs">
        <div v-for="img in images" :key="img.filename" class="thumb">
          <img :src="img.url" alt="" />
          <button
            class="thumb-remove"
            @click="emit('remove', img.filename)"
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
  background: #161d27;
  border: 1px solid #1f2632;
  border-radius: 8px;
}
.pending-label {
  font-size: 0.75rem;
  color: #8a93a6;
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
  background: #0c0f15;
  border: 1px solid #1c222e;
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
  background: rgba(0, 0, 0, 0.7);
  color: white;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0;
}
.thumb-remove:hover {
  background: #d94848;
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
