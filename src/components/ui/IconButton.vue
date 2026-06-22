<template>
    <button
        class="icon-button"
        :class="[`icon-button--${variant}`, `icon-button--${size}`, { active, danger }]"
        :type="type"
        :title="title"
        :aria-label="title"
        :disabled="disabled"
    >
        <slot />
    </button>
</template>

<script setup>
    defineProps({
        title: { type: String, default: '' },
        variant: { type: String, default: 'default' },
        size: { type: String, default: 'md' },
        active: { type: Boolean, default: false },
        danger: { type: Boolean, default: false },
        disabled: { type: Boolean, default: false },
        type: { type: String, default: 'button' }
    });
</script>

<style scoped>
    .icon-button {
        display: grid;
        place-items: center;
        padding: 0;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-surface-2);
        color: var(--nx-icon);
        cursor: pointer;
        line-height: 1;
    }
    .icon-button--sm {
        width: 24px;
        height: 24px;
        border-radius: 6px;
    }
    .icon-button--md {
        width: 30px;
        height: 30px;
    }
    .icon-button--rail {
        width: 30px;
        height: 30px;
        border-color: transparent;
        background: transparent;
        color: var(--nx-icon);
    }
    .icon-button--ghost {
        border-color: transparent;
        background: var(--nx-bg-overlay);
        color: var(--nx-icon);
    }
    .icon-button--primary,
    .icon-button.active {
        border-color: var(--nx-accent-border);
        background: var(--nx-accent-soft);
        color: var(--nx-icon);
    }
    .icon-button:hover {
        border-color: var(--nx-accent);
        background: var(--nx-accent-hover);
        color: var(--nx-icon);
    }
    .icon-button--rail:hover,
    .icon-button--ghost:hover {
        border-color: var(--nx-border);
        background: var(--nx-surface-2);
        color: var(--nx-icon);
    }
    .icon-button.danger:hover {
        color: var(--nx-icon);
    }
    .icon-button:disabled {
        cursor: not-allowed;
        opacity: 0.48;
    }
    .icon-button:disabled:hover {
        border-color: var(--nx-border);
        background: var(--nx-surface-2);
        color: var(--nx-icon);
    }
</style>
