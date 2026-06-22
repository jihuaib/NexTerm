<template>
    <div class="resource-node">
        <button
            class="resource-row"
            :class="{
                active: selectedId === node.id,
                'drop-hover': dropHoverId === node.id,
                virtual: node.virtual,
                leaf: isLeaf,
                session: isSession
            }"
            :style="rowStyle"
            :title="nodeTitle"
            :draggable="isSession"
            @click="$emit('select', node)"
            @dblclick="$emit('node-activate', node)"
            @contextmenu.prevent.stop="$emit('node-contextmenu', { event: $event, node })"
            @dragstart="$emit('node-dragstart', { event: $event, node })"
            @dragenter.prevent="$emit('node-dragenter', node)"
            @dragleave="$emit('node-dragleave', node)"
            @dragover.prevent
            @drop.stop="$emit('node-drop', { event: $event, node })"
        >
            <span
                class="resource-toggle"
                :class="{ hidden: !isBranch }"
                :title="isCollapsed ? '展开' : '折叠'"
                @click.stop="$emit('node-toggle', node)"
                @dblclick.stop
            >
                <ChevronRight v-if="isCollapsed" :size="13" :stroke-width="2" />
                <ChevronDown v-else :size="13" :stroke-width="2" />
            </span>
            <component :is="iconComponent" class="resource-icon" :size="15" :stroke-width="1.8" />
            <span class="resource-name">{{ node.name }}</span>
            <span v-if="isSession" class="resource-protocol" :style="protocolStyle">{{ protocolLabel }}</span>
            <span v-if="showCount" class="resource-count">{{ node.itemCount }}</span>
        </button>

        <ResourceTreeNode
            v-for="child in visibleChildren"
            :key="child.id"
            :node="child"
            :level="level + 1"
            :selected-id="selectedId"
            :drop-hover-id="dropHoverId"
            :collapsed-ids="collapsedIds"
            @select="$emit('select', $event)"
            @node-toggle="$emit('node-toggle', $event)"
            @node-contextmenu="$emit('node-contextmenu', $event)"
            @node-activate="$emit('node-activate', $event)"
            @node-drop="$emit('node-drop', $event)"
            @node-dragstart="$emit('node-dragstart', $event)"
            @node-dragenter="$emit('node-dragenter', $event)"
            @node-dragleave="$emit('node-dragleave', $event)"
        />
    </div>
</template>

<script setup>
    import { computed } from 'vue';
    import {
        Cable,
        ChevronDown,
        ChevronRight,
        File,
        Folder,
        FolderOpen,
        HardDrive,
        Layers,
        Server,
        SquareTerminal
    } from '@lucide/vue';
    import {
        RESOURCE_NODE_TYPES,
        getProtocolColorOption,
        isLocalSessionProtocol,
        isSerialSessionProtocol
    } from '../../models/resources';

    const props = defineProps({
        node: { type: Object, required: true },
        level: { type: Number, default: 0 },
        selectedId: { type: String, default: '' },
        dropHoverId: { type: String, default: '' },
        collapsedIds: { type: Array, default: () => [] }
    });

    defineEmits([
        'select',
        'node-toggle',
        'node-contextmenu',
        'node-activate',
        'node-drop',
        'node-dragstart',
        'node-dragenter',
        'node-dragleave'
    ]);

    const isSession = computed(() => props.node.type === RESOURCE_NODE_TYPES.SESSION);
    const isLeaf = computed(() => isSession.value || props.node.type === RESOURCE_NODE_TYPES.FILE);
    const isBranch = computed(() => !isLeaf.value && (props.node.children || []).length > 0);
    const isCollapsed = computed(() => isBranch.value && props.collapsedIds.includes(props.node.id));
    const visibleChildren = computed(() => (isCollapsed.value ? [] : props.node.children || []));
    const showCount = computed(() => !isLeaf.value && props.node.itemCount !== undefined);
    const protocolStyle = computed(() => {
        const color = getProtocolColorOption(props.node.protocol);
        return {
            '--resource-protocol-color': color.swatch,
            '--resource-protocol-bg': color.bg,
            '--resource-protocol-border': color.border
        };
    });
    const rowStyle = computed(() => ({
        paddingLeft: `${7 + props.level * 14}px`,
        ...(isSession.value ? protocolStyle.value : {})
    }));
    const protocolLabel = computed(() => {
        if (isLocalSessionProtocol(props.node.protocol)) return 'LOCAL';
        if (isSerialSessionProtocol(props.node.protocol)) return 'SERIAL';
        return String(props.node.protocol || 'telnet').toUpperCase();
    });
    const nodeTitle = computed(() => {
        if (isSession.value && isLocalSessionProtocol(props.node.protocol)) return `${props.node.name} - Local Shell`;
        if (isSession.value && isSerialSessionProtocol(props.node.protocol))
            return `${props.node.name} - serial://${props.node.serialPath || ''}`;
        if (isSession.value && props.node.protocol === 'ssh')
            return `${props.node.name} - ssh://${props.node.username ? `${props.node.username}@` : ''}${props.node.host}:${props.node.port}`;
        if (isSession.value)
            return `${props.node.name} - ${props.node.protocol}://${props.node.host}:${props.node.port}`;
        if (props.node.path) return props.node.path;
        return props.node.name;
    });

    const iconComponent = computed(() => {
        if (props.node.icon === 'layers') return Layers;
        if (props.node.icon === 'folder-open') return FolderOpen;
        if (props.node.type === RESOURCE_NODE_TYPES.SESSION && isSerialSessionProtocol(props.node.protocol)) return Cable;
        if (props.node.type === RESOURCE_NODE_TYPES.SESSION && isLocalSessionProtocol(props.node.protocol))
            return SquareTerminal;
        if (props.node.type === RESOURCE_NODE_TYPES.SESSION) return Server;
        if (props.node.type === RESOURCE_NODE_TYPES.FILE) return File;
        if (props.node.type === RESOURCE_NODE_TYPES.FILE_FOLDER) return props.level === 0 ? HardDrive : Folder;
        return Folder;
    });
</script>

<style scoped>
    .resource-row {
        width: max-content;
        min-width: 100%;
        height: 29px;
        display: grid;
        grid-template-columns: 14px 18px max-content auto;
        align-items: center;
        gap: 6px;
        padding-right: 7px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: var(--nx-text-dim);
        text-align: left;
        cursor: pointer;
    }
    .resource-row:hover {
        background: var(--nx-surface-2);
        border-color: var(--nx-border-soft);
        color: var(--nx-text);
    }
    .resource-row.active {
        background: var(--nx-accent-soft);
        border-color: var(--nx-accent-border-soft);
        color: var(--nx-accent);
    }
    .resource-row.session {
        color: var(--resource-protocol-color);
        font-weight: 500;
    }
    .resource-row.session:hover,
    .resource-row.session.active {
        background: var(--resource-protocol-bg);
        border-color: var(--resource-protocol-border);
        color: var(--resource-protocol-color);
    }
    .resource-row.leaf {
        grid-template-columns: 14px 18px max-content;
    }
    .resource-row.leaf.session {
        grid-template-columns: 14px 18px max-content max-content;
    }
    .resource-row.drop-hover {
        background: var(--nx-accent-active);
        border-color: var(--nx-accent);
    }
    .resource-name {
        min-width: max-content;
        white-space: nowrap;
        font-weight: inherit;
    }
    .resource-toggle {
        width: 14px;
        height: 18px;
        display: grid;
        place-items: center;
        color: var(--nx-icon);
        border-radius: 4px;
    }
    .resource-toggle.hidden {
        visibility: hidden;
    }
    .resource-toggle:not(.hidden):hover {
        background: var(--nx-control-muted);
        color: var(--nx-icon);
    }
    .resource-row:not(.session) .resource-icon {
        color: var(--nx-icon);
    }
    .resource-row.session .resource-icon {
        color: var(--resource-protocol-color);
    }
    .resource-protocol {
        align-self: center;
        min-width: 0;
        padding: 1px 5px;
        border: 1px solid var(--resource-protocol-border);
        border-radius: 5px;
        background: var(--resource-protocol-bg);
        color: var(--resource-protocol-color);
        font-size: 10px;
        font-weight: 700;
        line-height: 1.25;
        letter-spacing: 0;
    }
    .resource-count {
        color: var(--nx-text-dim);
        font-size: 11px;
        min-width: 18px;
        text-align: right;
        white-space: nowrap;
    }
    .resource-node {
        width: max-content;
        min-width: 100%;
    }
</style>
