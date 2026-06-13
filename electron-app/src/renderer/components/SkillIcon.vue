<script setup lang="ts">
import { computed } from 'vue'
import { skillIconSrc } from '../lib/skill-icons'

const props = withDefaults(
  defineProps<{
    skillIcon?: string | null
    size?: number
    title?: string | null
  }>(),
  {
    skillIcon: null,
    size: 22,
    title: null
  }
)

const src = computed(() => skillIconSrc(props.skillIcon))
</script>

<template>
  <img
    v-if="src"
    class="skill-icon"
    :src="src"
    :alt="title ?? 'skill'"
    :title="title ?? undefined"
    :width="size"
    :height="size"
    loading="lazy"
    decoding="async"
  />
  <span
    v-else
    class="skill-icon-fallback"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :title="title ?? undefined"
  />
</template>

<style scoped>
.skill-icon {
  display: block;
  flex-shrink: 0;
  border-radius: 3px;
  object-fit: contain;
  background: rgba(24, 24, 27, 0.65);
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.55));
}

.skill-icon-fallback {
  display: block;
  flex-shrink: 0;
  border-radius: 3px;
  background: rgba(63, 63, 70, 0.45);
  opacity: 0.35;
}
</style>
