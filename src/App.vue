<template>
  <div class="app-root">
    <MaterialViewer />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import MaterialViewer from './views/MaterialViewer/MaterialViewer.vue'

const threeHost = ref<HTMLElement | null>(null)

</script>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 100vh;
}

.three-mount {
  flex: 1;
  min-height: 200px;
  width: 100%;
}
</style>
