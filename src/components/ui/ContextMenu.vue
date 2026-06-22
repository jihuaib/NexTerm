<template>
    <div v-if="visible" ref="menuRef" class="context-menu" :style="menuStyle" @click.stop>
        <slot />
    </div>
</template>

<script setup>
    import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

    const props = defineProps({
        visible: { type: Boolean, default: false },
        x: { type: Number, default: 0 },
        y: { type: Number, default: 0 }
    });

    const menuRef = ref(null);
    const menuStyle = reactive({
        left: '0px',
        top: '0px'
    });

    function positionMenu() {
        const margin = 8;
        const menu = menuRef.value;
        const width = menu?.offsetWidth || 136;
        const height = menu?.offsetHeight || 30;
        const viewportWidth = window.innerWidth || width + margin * 2;
        const viewportHeight = window.innerHeight || height + margin * 2;
        const maxLeft = Math.max(margin, viewportWidth - width - margin);
        const maxTop = Math.max(margin, viewportHeight - height - margin);
        menuStyle.left = `${Math.max(margin, Math.min(props.x, maxLeft))}px`;
        menuStyle.top = `${Math.max(margin, Math.min(props.y, maxTop))}px`;
    }

    watch(
        () => [props.visible, props.x, props.y],
        () => {
            if (!props.visible) return;
            menuStyle.left = `${props.x}px`;
            menuStyle.top = `${props.y}px`;
            nextTick(positionMenu);
        },
        { immediate: true }
    );

    onMounted(() => {
        window.addEventListener('resize', positionMenu);
    });

    onBeforeUnmount(() => {
        window.removeEventListener('resize', positionMenu);
    });
</script>

<style scoped>
    .context-menu {
        position: fixed;
        z-index: 120;
        min-width: 136px;
        max-width: calc(100vw - 16px);
        max-height: calc(100vh - 16px);
        overflow-y: auto;
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
    :deep(button svg) {
        flex-shrink: 0;
        color: var(--nx-icon);
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
