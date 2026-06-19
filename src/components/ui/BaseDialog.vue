<template>
    <div class="dialog-overlay" :style="{ zIndex }" @click.self="$emit('close')">
        <section
            ref="dialogRef"
            class="dialog"
            :class="{ 'is-dragging': dragging }"
            :style="dialogStyle"
            @keydown.esc="$emit('close')"
        >
            <header class="dialog__head" title="拖动移动弹窗" @pointerdown="startDrag">
                <div>
                    <h3>{{ title }}</h3>
                    <p v-if="subtitle">{{ subtitle }}</p>
                </div>
                <IconButton data-no-drag title="关闭" variant="ghost" @click="$emit('close')">
                    <X :size="16" :stroke-width="2" />
                </IconButton>
            </header>

            <div class="dialog__body">
                <slot />
            </div>

            <footer v-if="$slots.footer" class="dialog__footer">
                <slot name="footer" />
            </footer>
        </section>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { X } from '@lucide/vue';
import { useDraggableSurface } from '../../composables/useDraggableSurface';
import IconButton from './IconButton.vue';

const props = defineProps({
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    width: { type: String, default: '420px' },
    zIndex: { type: [String, Number], default: 100 }
});

defineEmits(['close']);

const dialogRef = ref(null);
const { dragging, surfaceStyle, startDrag } = useDraggableSurface(dialogRef);
const dialogStyle = computed(() => ({
    width: props.width,
    ...surfaceStyle.value
}));
</script>

<style scoped>
.dialog-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
    background: rgba(0, 0, 0, 0.68);
}
.dialog {
    max-width: 100%;
    max-height: calc(100vh - 36px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    will-change: transform;
    border: 1px solid var(--nx-border);
    border-radius: 8px;
    background: var(--nx-surface-raised);
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.34);
}
.dialog.is-dragging {
    user-select: none;
}
.dialog__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 18px 14px;
    border-bottom: 1px solid var(--nx-border);
    cursor: move;
    touch-action: none;
    user-select: none;
}
.dialog__head h3 {
    margin: 0;
    font-size: 17px;
    letter-spacing: 0;
}
.dialog__head p {
    margin: 4px 0 0;
    color: var(--nx-text-dim);
    font-size: 12px;
}
.dialog__body {
    min-width: 0;
    overflow: hidden;
}
.dialog__footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 18px 18px;
    border-top: 1px solid var(--nx-border-muted);
    background: var(--nx-surface-raised);
}
</style>
