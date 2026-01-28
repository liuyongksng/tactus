<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  iconUrl: string;
}>();

const emit = defineEmits<{
  click: [];
}>();

// 位置状态
const posY = ref(50); // 百分比位置
const isDragging = ref(false);
const startY = ref(0);
const startPosY = ref(0);
const isHovering = ref(false);

// 拖动处理
const onMouseDown = (e: MouseEvent) => {
  isDragging.value = true;
  startY.value = e.clientY;
  startPosY.value = posY.value;
  e.preventDefault();
};

const onMouseMove = (e: MouseEvent) => {
  if (!isDragging.value) return;
  
  const deltaY = e.clientY - startY.value;
  const windowHeight = window.innerHeight;
  const deltaPercent = (deltaY / windowHeight) * 100;
  
  let newPosY = startPosY.value + deltaPercent;
  // 限制在 10% - 90% 范围内
  newPosY = Math.max(10, Math.min(90, newPosY));
  posY.value = newPosY;
};

const onMouseUp = () => {
  isDragging.value = false;
};

// 触摸事件处理
const onTouchStart = (e: TouchEvent) => {
  isDragging.value = true;
  startY.value = e.touches[0].clientY;
  startPosY.value = posY.value;
};

const onTouchMove = (e: TouchEvent) => {
  if (!isDragging.value) return;
  
  const deltaY = e.touches[0].clientY - startY.value;
  const windowHeight = window.innerHeight;
  const deltaPercent = (deltaY / windowHeight) * 100;
  
  let newPosY = startPosY.value + deltaPercent;
  newPosY = Math.max(10, Math.min(90, newPosY));
  posY.value = newPosY;
};

const onTouchEnd = () => {
  isDragging.value = false;
};

// 点击处理（区分拖动和点击）
const handleClick = () => {
  if (Math.abs(posY.value - startPosY.value) < 2) {
    emit('click');
  }
};

// 悬停处理
const onMouseEnter = () => {
  isHovering.value = true;
};

const onMouseLeave = () => {
  isHovering.value = false;
};

onMounted(() => {
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('touchmove', onTouchMove);
  document.addEventListener('touchend', onTouchEnd);
});

onUnmounted(() => {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  document.removeEventListener('touchmove', onTouchMove);
  document.removeEventListener('touchend', onTouchEnd);
});
</script>

<template>
  <div
    class="side-floating-ball"
    :class="{ 'is-dragging': isDragging, 'is-hovering': isHovering }"
    :style="{ top: `${posY}%` }"
    @mousedown="onMouseDown"
    @touchstart="onTouchStart"
    @click="handleClick"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <div class="ball-container">
      <div class="ball-inner">
        <img :src="props.iconUrl" alt="Tactus" width="28" height="28" />
      </div>
    </div>
    <div class="ball-tooltip">Tactus</div>
  </div>
</template>

<style>
.side-floating-ball {
  position: fixed !important;
  right: 0 !important;
  transform: translateY(-50%);
  z-index: 2147483647;
  cursor: grab;
  user-select: none;
  display: flex;
  align-items: center;
  transition: right 200ms ease-out;
}

.side-floating-ball.is-dragging {
  cursor: grabbing;
}

.ball-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}

.ball-inner {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border-radius: 8px 0 0 8px;
  transition: all 200ms ease-out;
}

.ball-inner img {
  pointer-events: none;
}

.side-floating-ball:hover .ball-inner {
  transform: scale(1.1);
}

.side-floating-ball:active .ball-inner {
  transform: scale(0.95);
}

.ball-tooltip {
  position: absolute;
  right: 52px;
  top: 4px;
  background: #FAFAF8;
  color: #1A1A1A;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  font-family: "Source Sans 3", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  letter-spacing: 0.02em;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: translateX(8px);
  transition: all 200ms ease-out;
  border: 1px solid #E8E4DF;
  box-shadow: 0 4px 12px rgba(26, 26, 26, 0.08);
}

.side-floating-ball:hover .ball-tooltip {
  opacity: 1;
  transform: translateX(0);
}

/* 拖动时隐藏提示 */
.side-floating-ball.is-dragging .ball-tooltip {
  opacity: 0;
}
</style>
