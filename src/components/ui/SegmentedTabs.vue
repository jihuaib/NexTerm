<template>
    <div class="segmented-tabs" role="tablist" :aria-label="ariaLabel">
        <button
            v-for="tab in tabs"
            :key="tab.value"
            class="segmented-tabs__item"
            :class="{ active: tab.value === modelValue }"
            type="button"
            role="tab"
            :aria-selected="tab.value === modelValue"
            :title="tab.title || tab.label"
            :style="tab.style || null"
            @click="$emit('update:modelValue', tab.value)"
        >
            <component :is="tab.icon" v-if="tab.icon" :size="15" :stroke-width="1.9" />
            <span>{{ tab.label }}</span>
        </button>
    </div>
</template>

<script setup>
    defineProps({
        modelValue: { type: String, required: true },
        tabs: { type: Array, required: true },
        ariaLabel: { type: String, default: '选项卡' }
    });

    defineEmits(['update:modelValue']);
</script>

<style scoped>
    .segmented-tabs {
        display: inline-flex;
        min-width: 0;
        padding: 3px;
        border: 1px solid var(--nx-border);
        border-radius: 8px;
        background: var(--nx-bg);
    }
    .segmented-tabs__item {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-width: 116px;
        height: 32px;
        padding: 0 12px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: var(--segmented-tab-color, var(--nx-text-dim));
        font-weight: 500;
        cursor: pointer;
        outline: none;
    }
    .segmented-tabs__item span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .segmented-tabs__item svg {
        flex-shrink: 0;
        color: currentColor;
    }
    .segmented-tabs__item:hover {
        color: var(--segmented-tab-color, var(--nx-text));
    }
    .segmented-tabs__item.active {
        border-color: var(--segmented-tab-border, var(--nx-accent-border-soft));
        background: var(--segmented-tab-bg, var(--nx-surface));
        color: var(--segmented-tab-color, var(--nx-text));
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
    }
    .segmented-tabs__item:focus-visible {
        border-color: var(--nx-accent);
    }

    @media (max-width: 520px) {
        .segmented-tabs {
            display: flex;
            width: 100%;
        }
        .segmented-tabs__item {
            flex: 1 1 0;
            min-width: 0;
        }
    }
</style>
