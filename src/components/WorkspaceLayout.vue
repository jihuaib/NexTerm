<template>
    <div class="workspace-layout">
        <LayoutNode :node="store.layout" />
    </div>
</template>

<script setup>
import { store } from '../store';
import LayoutNode from './LayoutNode.vue';
</script>

<style scoped>
.workspace-layout {
    width: 100%;
    height: 100%;
    min-height: 0;
    border: 1px solid var(--nx-border);
    border-radius: 8px;
    overflow: hidden;
    background: var(--nx-bg);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.18);
}
</style>
