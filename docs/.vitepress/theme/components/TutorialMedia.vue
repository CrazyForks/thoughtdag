<script setup lang="ts">
import { useData, withBase } from 'vitepress';
defineProps<{ clip: string; alt: string }>();
const { lang } = useData();
</script>

<template>
  <figure class="tutorial-media">
    <video controls loop muted playsinline preload="none"
      :aria-label="alt"
      :poster="withBase(`/media/tutorials/${clip}-selected-v1-poster.jpg`)"
      :src="withBase(`/media/tutorials/${clip}-selected-v1.mp4`)"></video>
    <figcaption>
      {{ lang.startsWith('zh') ? '交互示意动画' : 'Illustrated interaction' }} ·
      <a :href="withBase(`/media/tutorials/${clip}-selected-v1.gif`)" download>
        {{ lang.startsWith('zh') ? '下载 GIF' : 'Download GIF' }}
      </a>
    </figcaption>
  </figure>
</template>

<style scoped>
.tutorial-media { margin: 24px 0; }
video { display: block; width: 100%; border: 1px solid var(--vp-c-divider); border-radius: 12px; background: #faf9f6; }
figcaption { margin-top: 8px; color: var(--vp-c-text-2); font-size: 13px; }
</style>
