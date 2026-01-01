<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  x: number;
  y: number;
  iconUrl: string;
  onAsk: () => void;
}>();

const visible = ref(true);

const handleClick = () => {
  visible.value = false;
  props.onAsk();
};
</script>

<template>
  <div
    v-if="visible"
    class="tc-floating-btn"
    :style="{ left: `${props.x}px`, top: `${props.y + 4}px` }"
    @click.stop="handleClick"
  >
    <img :src="props.iconUrl" alt="Ask AI" width="24" height="24" />
  </div>
</template>

<style scoped>
.tc-floating-btn {
  position: fixed;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 200ms ease-out;
  user-select: none;
}

.tc-floating-btn:hover {
  transform: scale(1.15);
}

.tc-floating-btn:active {
  transform: scale(0.9);
}

.tc-floating-btn img {
  flex-shrink: 0;
  pointer-events: none;
}
</style>
