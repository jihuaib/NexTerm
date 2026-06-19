<template>
    <div v-if="visible" class="context-menu" :style="menuStyle" @click.stop>
        <slot />
    </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
    visible: { type: Boolean, default: false },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 }
});

const menuStyle = computed(() => ({
    left: `${props.x}px`,
    top: `${props.y}px`
}));
</script>

<style scoped>
.context-menu {
    position: fixed;
    z-index: 120;
    min-width: 136px;
    padding: 5px;
    border: 1px solid var(--nx-border);
    border-radius: 7px;
    background: var(--nx-surface);
    box-shadow: 0 12px 38px rgba(0, 0, 0, 0.36);
}
:deep(button) {
    width: 100%;
    height: 30px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: var(--nx-text);
    cursor: pointer;
    text-align: left;
}
:deep(button:hover) {
    background: var(--nx-surface-2);
    border-color: var(--nx-border);
}
:deep(button:disabled) {
    cursor: default;
    opacity: 0.45;
}
:deep(button:disabled:hover) {
    background: transparent;
    border-color: transparent;
}
</style>
