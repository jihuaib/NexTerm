<template>
    <div class="overlay" @click.self="close">
        <div ref="panelRef" class="panel" :class="{ 'is-dragging': dragging }" :style="surfaceStyle">
            <nav class="cats">
                <div class="cats__title" title="拖动移动弹窗" @pointerdown="startDrag">设置</div>
                <button
                    v-for="cat in categories"
                    :key="cat.id"
                    class="cat"
                    :class="{ active: cat.id === activeId }"
                    @click="activeId = cat.id"
                >
                    <span class="cat__icon">
                        <component :is="cat.icon" :size="16" :stroke-width="1.9" />
                    </span>
                    <span>{{ cat.label }}</span>
                </button>
            </nav>

            <section class="content">
                <header class="content__head" title="拖动移动弹窗" @pointerdown="startDrag">
                    <div>
                        <h2>{{ active.label }}</h2>
                        <p>{{ active.desc }}</p>
                    </div>
                    <button class="close" data-no-drag title="关闭" @click="close">✕</button>
                </header>
                <div class="content__body">
                    <component :is="active.component" />
                </div>
            </section>
        </div>
    </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { closeSettings } from '../../store';
import { useDraggableSurface } from '../../composables/useDraggableSurface';
import { SETTINGS_CATEGORIES } from '../../settings/registry';

const categories = SETTINGS_CATEGORIES;
const activeId = ref(categories[0].id);
const active = computed(() => categories.find(c => c.id === activeId.value));
const panelRef = ref(null);
const { dragging, surfaceStyle, startDrag } = useDraggableSurface(panelRef);

function close() {
    closeSettings();
}
</script>

<style scoped>
.overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.68);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 18px;
}
.panel {
    width: 760px;
    height: 540px;
    max-width: 94vw;
    max-height: 90vh;
    display: flex;
    will-change: transform;
    background: var(--nx-surface-raised);
    border: 1px solid var(--nx-border);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.36);
}
.panel.is-dragging {
    user-select: none;
}
.cats {
    width: 190px;
    flex-shrink: 0;
    background: var(--nx-rail-bg);
    border-right: 1px solid var(--nx-border);
    padding: 14px 9px;
}
.cats__title {
    font-weight: 700;
    padding: 4px 10px 13px;
    color: var(--nx-text);
    cursor: move;
    touch-action: none;
    user-select: none;
}
.cat {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    min-height: 36px;
    padding: 0 10px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--nx-text);
    border-radius: 7px;
    cursor: pointer;
    text-align: left;
}
.cat:hover {
    background: var(--nx-surface-2);
    border-color: var(--nx-border);
}
.cat.active {
    background: var(--nx-accent-soft);
    border-color: var(--nx-accent-border);
    color: var(--nx-accent);
}
.cat__icon {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    color: inherit;
}
.content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.content__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 18px;
    padding: 18px 22px 16px;
    border-bottom: 1px solid var(--nx-border);
    cursor: move;
    touch-action: none;
    user-select: none;
}
.content__head h2 {
    margin: 0;
    font-size: 17px;
    letter-spacing: 0;
}
.content__head p {
    margin: 4px 0 0;
    color: var(--nx-text-dim);
    font-size: 12px;
}
.close {
    border: 1px solid transparent;
    background: transparent;
    color: var(--nx-text-dim);
    cursor: pointer;
    font-size: 15px;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    line-height: 1;
}
.close:hover {
    border-color: var(--nx-border);
    background: var(--nx-surface-2);
    color: var(--nx-text);
}
.content__body {
    flex: 1;
    overflow-y: auto;
    padding: 6px 22px 22px;
}

@media (max-width: 680px) {
    .panel {
        flex-direction: column;
    }
    .cats {
        width: 100%;
        display: flex;
        gap: 6px;
        overflow-x: auto;
        border-right: none;
        border-bottom: 1px solid var(--nx-border);
    }
    .cats__title {
        display: none;
    }
    .cat {
        width: auto;
        white-space: nowrap;
    }
}
</style>
