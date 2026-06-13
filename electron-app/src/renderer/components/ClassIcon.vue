<script setup lang="ts">
import { computed } from 'vue'
import { classDisplayName, classIconSrc } from '../lib/class-icons'

const props = withDefaults(
  defineProps<{
    classId?: number | null
    size?: number
    title?: string | null
  }>(),
  {
    classId: null,
    size: 22,
    title: null
  }
)

const src = computed(() => classIconSrc(props.classId))
const label = computed(() => props.title ?? classDisplayName(props.classId))
</script>

<template>
  <img
    v-if="src"
    class="class-icon"
    :src="src"
    :alt="label ?? 'class'"
    :title="label ?? undefined"
    :width="size"
    :height="size"
    loading="lazy"
    decoding="async"
  />
  <span
    v-else
    class="class-icon-fallback"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :title="label ?? undefined"
  />
</template>

<style scoped>
.class-icon {
  display: block;
  flex-shrink: 0;
  border-radius: 3px;
  object-fit: contain;
  background: transparent;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.55));
}

.class-icon-fallback {
  display: block;
  flex-shrink: 0;
  border-radius: 3px;
  background: rgba(63, 63, 70, 0.45);
  opacity: 0.35;
}
</style>
