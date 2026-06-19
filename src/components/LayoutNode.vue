<template>
    <!-- 叶子：渲染窗格 -->
    <PaneFrame v-if="node.type === 'leaf'" :node="node" />

    <!-- 分屏：两个子节点 + 可拖动分隔条 -->
    <div v-else ref="el" class="split" :class="node.dir">
        <div class="cell" :style="cellStyle(0)">
            <LayoutNode :node="node.children[0]" />
        </div>
        <div class="resizer" :class="node.dir" @pointerdown="startResize" />
        <div class="cell" :style="cellStyle(1)">
            <LayoutNode :node="node.children[1]" />
        </div>
    </div>
</template>

<script setup>
    import { ref } from 'vue';
    import PaneFrame from './PaneFrame.vue';

    const props = defineProps({ node: { type: Object, required: true } });
    const el = ref(null);

    function cellStyle(i) {
        // 减去分隔条的一半，避免溢出
        return { flexBasis: `calc(${props.node.sizes[i]}% - 3px)` };
    }

    function startResize(e) {
        e.preventDefault();
        const container = el.value;
        const horizontal = props.node.dir === 'row';
        const rect = container.getBoundingClientRect();

        const onMove = ev => {
            const total = horizontal ? rect.width : rect.height;
            const offset = horizontal ? ev.clientX - rect.left : ev.clientY - rect.top;
            let pct = (offset / total) * 100;
            pct = Math.min(90, Math.max(10, pct));
            props.node.sizes[0] = pct;
            props.node.sizes[1] = 100 - pct;
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }
</script>

<style scoped>
    .split {
        display: flex;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
    }
    .split.row {
        flex-direction: row;
    }
    .split.col {
        flex-direction: column;
    }
    .cell {
        flex-grow: 0;
        flex-shrink: 1;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
    }
    .resizer {
        flex: 0 0 6px;
        background: var(--nx-border-soft);
        transition: background 0.12s;
    }
    .resizer.row {
        cursor: col-resize;
    }
    .resizer.col {
        cursor: row-resize;
    }
    .resizer:hover {
        background: var(--nx-accent);
    }
</style>
