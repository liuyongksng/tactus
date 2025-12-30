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
  width: 32px;
  height: 32px;
  background: #ffffff;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transition: all 200ms ease-out;
  user-select: none;
}

.tc-floating-btn:hover {
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.tc-floating-btn:active {
  transform: scale(0.95);
}

.tc-floating-btn img {
  flex-shrink: 0;
  pointer-events: none;
}
</style>
