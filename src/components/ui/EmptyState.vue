<template>
    <div class="empty-state">
        <slot name="icon" />
        <span>{{ text }}</span>
        <slot />
    </div>
</template>

<script setup>
defineProps({
    text: { type: String, required: true }
});
</script>

<style scoped>
.empty-state {
    display: grid;
    place-items: center;
    gap: 10px;
    color: var(--nx-text-dim);
    text-align: center;
    padding: 26px 12px;
    border: 1px dashed var(--nx-border);
    border-radius: 8px;
}
:deep(button) {
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--nx-border);
    border-radius: 7px;
    background: var(--nx-surface-2);
    color: var(--nx-text);
    cursor: pointer;
}
:deep(button:hover) {
    border-color: var(--nx-accent);
    color: var(--nx-accent);
}
</style>
