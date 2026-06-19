<template>
    <div
        class="resource-tree"
        @contextmenu.prevent.stop="$emit('blank-contextmenu', $event)"
        @dragover.prevent
        @drop.prevent.stop="$emit('blank-drop', $event)"
    >
        <div class="resource-tree__content">
            <ResourceTreeNode
                v-for="node in nodes"
                :key="node.id"
                :node="node"
                :level="0"
                :selected-id="selectedId"
                :drop-hover-id="dropHoverId"
                @select="$emit('select', $event)"
                @node-contextmenu="payload => $emit('node-contextmenu', payload)"
                @node-activate="$emit('node-activate', $event)"
                @node-drop="payload => $emit('node-drop', payload)"
                @node-dragstart="payload => $emit('node-dragstart', payload)"
                @node-dragenter="$emit('node-dragenter', $event)"
                @node-dragleave="$emit('node-dragleave', $event)"
            />
        </div>
    </div>
</template>

<script setup>
import ResourceTreeNode from './ResourceTreeNode.vue';

defineProps({
    nodes: { type: Array, default: () => [] },
    selectedId: { type: String, default: '' },
    dropHoverId: { type: String, default: '' }
});

defineEmits([
    'select',
    'blank-contextmenu',
    'blank-drop',
    'node-contextmenu',
    'node-activate',
    'node-drop',
    'node-dragstart',
    'node-dragenter',
    'node-dragleave'
]);
</script>

<style scoped>
.resource-tree {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 8px 7px;
    border-bottom: 1px solid var(--nx-border);
}
.resource-tree__content {
    width: max-content;
    min-width: 100%;
    display: grid;
    align-content: start;
    gap: 3px;
}
</style>
