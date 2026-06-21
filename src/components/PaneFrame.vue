<template>
    <div class="pane" :class="{ active: node.id === store.activePaneId }" @mousedown="focus">
        <header
            class="group-head"
            :class="{ 'group-head--target': groupDropActive }"
            @dragenter.stop="onGroupDragEnter"
            @dragover.stop="onGroupDragOver"
            @dragleave.stop="onGroupDragLeave"
            @drop.stop="onGroupDrop"
        >
            <div v-if="sessions.length" class="tabs">
                <button
                    v-for="session in sessions"
                    :key="session.sessionId"
                    class="tab"
                    :class="{ active: session.sessionId === activeSessionId }"
                    :style="tabStyle(session)"
                    draggable="true"
                    :title="tabTitle(session)"
                    @click="activateTab(session.sessionId)"
                    @dragstart.stop="startOpenSessionDrag($event, session)"
                    @dragend="onDragEnd"
                >
                    <span class="dot" :class="session.status" />
                    <span class="tab__title">{{ tabLabel(session) }}</span>
                    <span
                        class="tab__close"
                        title="关闭标签"
                        @mousedown.stop
                        @dragstart.stop.prevent
                        @click.stop="closeTab(session.sessionId)"
                    >
                        <X :size="13" :stroke-width="2" />
                    </span>
                </button>
            </div>
            <div v-else class="tabs-empty">空标签组</div>

            <span class="head-spacer" />
            <button class="ph-btn" title="新建右侧标签组" @click.stop="split('row')">
                <Columns2 :size="15" :stroke-width="1.9" />
            </button>
            <button class="ph-btn" title="新建下方标签组" @click.stop="split('col')">
                <Rows2 :size="15" :stroke-width="1.9" />
            </button>
            <button class="ph-btn close" title="关闭标签组" @click.stop="close">
                <X :size="15" :stroke-width="2" />
            </button>
        </header>

        <div
            class="pane__body"
            @dragenter="onBodyDragEnter"
            @dragover="onBodyDragOver"
            @dragleave="onBodyDragLeave"
            @drop="onBodyDrop"
        >
            <TerminalPane
                v-for="session in sessions"
                v-show="session.sessionId === activeSessionId"
                :key="session.sessionId"
                :session="session"
                :active="session.sessionId === activeSessionId"
            />

            <div v-if="sessions.length === 0" class="empty">
                <div class="empty__terminal" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                </div>
                <h2>空标签组</h2>
                <p>双击左侧会话，或把标签拖到上方标签栏。</p>
                <button v-if="!isOnlyPane" class="ph-btn close-empty" title="关闭标签组" @click.stop="close">
                    关闭标签组
                </button>
            </div>

            <div v-if="edgeDrop" class="edge-marker" :class="edgeDrop" />
        </div>
    </div>
</template>

<script setup>
    import { computed, ref } from 'vue';
    import { Columns2, Rows2, X } from '@lucide/vue';
    import {
        store,
        setActivePane,
        splitPaneEmpty,
        closePane,
        moveOpenSessionIntoPane,
        activateGroupTab,
        closeGroupTab
    } from '../store';
    import { getSessionColorOption, isLocalSessionProtocol, isSerialSessionProtocol } from '../models/resources';
    import { collectSessions, getLeafSessions } from '../layout';
    import TerminalPane from './TerminalPane.vue';

    const props = defineProps({ node: { type: Object, required: true } });
    const edgeDrop = ref('');
    const groupDropActive = ref(false);

    const sessions = computed(() => getLeafSessions(props.node));
    const duplicateSessionIndexes = computed(() => {
        const groups = new Map();
        for (const session of collectSessions(store.layout, [])) {
            const key = session.profileId || session.sessionId;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(session);
        }

        const indexes = new Map();
        groups.forEach(group => {
            if (group.length <= 1) return;
            group.forEach((session, index) => indexes.set(session.sessionId, index + 1));
        });
        return indexes;
    });
    const activeSessionId = computed(() => {
        const active = sessions.value.find(s => s.sessionId === props.node.activeSessionId) || sessions.value[0];
        return active ? active.sessionId : null;
    });
    const isOnlyPane = computed(() => store.layout.type === 'leaf' && store.layout.id === props.node.id);

    function focus() {
        setActivePane(props.node.id);
    }

    function tabTitle(session) {
        if (isLocalSessionProtocol(session.protocol)) return `${session.name} - Local Shell`;
        if (isSerialSessionProtocol(session.protocol)) return `${session.name} - serial://${session.serialPath || ''}`;
        if (session.protocol === 'ssh')
            return `${session.name} - ssh://${session.username ? `${session.username}@` : ''}${session.host}:${session.port}`;
        return `${session.name} - ${session.host}:${session.port}`;
    }
    function tabLabel(session) {
        const duplicateIndex = duplicateSessionIndexes.value.get(session.sessionId);
        return duplicateIndex ? `${duplicateIndex}. ${session.name}` : session.name;
    }
    function tabStyle(session) {
        const color = getSessionColorOption(session.color);
        return {
            '--session-tab-bg': color.bg,
            '--session-tab-active-bg': color.activeBg,
            '--session-tab-border': color.border
        };
    }
    function split(dir) {
        splitPaneEmpty(props.node.id, dir);
    }
    function close() {
        closePane(props.node.id);
    }
    function activateTab(sessionId) {
        activateGroupTab(props.node.id, sessionId);
    }
    function closeTab(sessionId) {
        closeGroupTab(props.node.id, sessionId);
    }

    function startOpenSessionDrag(event, session) {
        const payload = {
            type: 'open-session',
            sourcePaneId: props.node.id,
            sessionId: session.sessionId
        };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-nexterm-open-session', JSON.stringify(payload));
        event.dataTransfer.setData('text/plain', session.name);
    }

    function hasOpenTabDrag(event) {
        return Array.from(event.dataTransfer?.types || []).includes('application/x-nexterm-open-session');
    }

    function getOpenTabPayload(event) {
        const raw = event.dataTransfer.getData('application/x-nexterm-open-session');
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (_err) {
            return null;
        }
    }

    function isSelfTabDrag(event) {
        return getOpenTabPayload(event)?.sourcePaneId === props.node.id;
    }

    function edgeFromEvent(event) {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const edgeX = Math.min(72, rect.width * 0.16);
        const edgeY = Math.min(58, rect.height * 0.16);
        const distances = [
            ['left', x],
            ['right', rect.width - x],
            ['top', y],
            ['bottom', rect.height - y]
        ];

        const edgeHit = x < edgeX || x > rect.width - edgeX || y < edgeY || y > rect.height - edgeY;
        if (!edgeHit) return '';

        distances.sort((a, b) => a[1] - b[1]);
        return distances[0][0];
    }

    function clearDrop() {
        edgeDrop.value = '';
        groupDropActive.value = false;
    }

    function onGroupDragEnter(event) {
        if (!hasOpenTabDrag(event)) return;
        if (isSelfTabDrag(event)) {
            groupDropActive.value = false;
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        groupDropActive.value = true;
        edgeDrop.value = '';
    }

    function onGroupDragOver(event) {
        if (!hasOpenTabDrag(event)) return;
        if (isSelfTabDrag(event)) {
            groupDropActive.value = false;
            event.dataTransfer.dropEffect = 'none';
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        groupDropActive.value = true;
        edgeDrop.value = '';
    }

    function onGroupDragLeave(event) {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        groupDropActive.value = false;
    }

    function onGroupDrop(event) {
        const payload = getOpenTabPayload(event);
        clearDrop();
        if (!payload || payload.sourcePaneId === props.node.id) return;
        event.preventDefault();
        moveOpenSessionIntoPane(props.node.id, payload, 'center');
    }

    function onBodyDragEnter(event) {
        if (!hasOpenTabDrag(event)) return;
        const edge = edgeFromEvent(event);
        if (!edge) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        edgeDrop.value = edge;
        groupDropActive.value = false;
    }

    function onBodyDragOver(event) {
        if (!hasOpenTabDrag(event)) return;
        const edge = edgeFromEvent(event);
        edgeDrop.value = edge;
        groupDropActive.value = false;
        if (!edge) {
            event.dataTransfer.dropEffect = 'none';
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }

    function onBodyDragLeave(event) {
        const rect = event.currentTarget.getBoundingClientRect();
        const outside =
            event.clientX <= rect.left ||
            event.clientX >= rect.right ||
            event.clientY <= rect.top ||
            event.clientY >= rect.bottom;
        if (outside) edgeDrop.value = '';
    }

    function onBodyDrop(event) {
        const payload = getOpenTabPayload(event);
        const edge = edgeFromEvent(event);
        clearDrop();
        if (!payload || !edge) return;
        event.preventDefault();
        moveOpenSessionIntoPane(props.node.id, payload, edge);
    }

    function onDragEnd() {
        clearDrop();
    }
</script>

<style scoped>
    .pane {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--nx-bg);
        border: 1px solid transparent;
        overflow: hidden;
    }
    .pane.active {
        border-color: var(--nx-accent);
        box-shadow: inset 0 0 0 1px var(--nx-accent-border-soft);
    }
    .group-head {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 38px;
        padding: 5px 7px 0;
        background: var(--nx-titlebar-bg);
        border-bottom: 1px solid var(--nx-border);
        transition:
            background 0.12s ease,
            box-shadow 0.12s ease;
    }
    .group-head--target {
        background: var(--nx-accent-soft);
        box-shadow: inset 0 -2px 0 var(--nx-accent);
    }
    .tabs {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        min-width: 0;
        overflow-x: auto;
        align-self: stretch;
    }
    .tabs-empty {
        display: flex;
        align-items: center;
        height: 28px;
        padding: 0 10px;
        border: 1px dashed var(--nx-border);
        border-radius: 7px 7px 0 0;
        color: var(--nx-text-dim);
        font-size: 12px;
    }
    .tab {
        display: flex;
        align-items: center;
        gap: 6px;
        max-width: 190px;
        min-width: 116px;
        height: 32px;
        padding: 0 7px 0 9px;
        border: 1px solid var(--session-tab-border, transparent);
        border-bottom: none;
        border-radius: 7px 7px 0 0;
        background: var(--session-tab-bg, var(--nx-control-muted));
        color: var(--nx-text);
        cursor: grab;
    }
    .tab.active {
        background: var(--session-tab-active-bg, var(--nx-bg));
        border-color: var(--session-tab-border, var(--nx-border));
        color: var(--nx-text);
    }
    .tab:active {
        cursor: grabbing;
    }
    .tab__title {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: left;
    }
    .tab__close {
        display: grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border-radius: 5px;
        color: var(--nx-text-dim);
        cursor: default;
        flex: 0 0 auto;
    }
    .tab__close:hover {
        background: var(--nx-surface-2);
        color: var(--nx-danger);
    }
    .head-spacer {
        flex: 1;
    }
    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--nx-text-dim);
        flex-shrink: 0;
    }
    .dot.connected {
        background: var(--nx-success);
    }
    .dot.connecting {
        background: var(--nx-warning);
    }
    .dot.error,
    .dot.closed {
        background: var(--nx-danger);
    }
    .ph-btn {
        border: 1px solid transparent;
        background: transparent;
        color: var(--nx-text-dim);
        cursor: pointer;
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border-radius: 6px;
        line-height: 1;
        flex: 0 0 auto;
    }
    .ph-btn:hover {
        border-color: var(--nx-border);
        background: var(--nx-surface-2);
        color: var(--nx-text);
    }
    .ph-btn.close:hover {
        color: var(--nx-danger);
    }
    .pane__body {
        position: relative;
        flex: 1;
        min-height: 0;
    }
    .empty {
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 10px;
        align-items: center;
        justify-content: center;
        padding: 28px;
        text-align: center;
        color: var(--nx-text-dim);
        background: var(--nx-bg);
    }
    .empty__terminal {
        display: grid;
        grid-template-columns: repeat(3, 24px);
        gap: 8px;
        padding: 14px;
        border: 1px solid var(--nx-border);
        border-radius: 8px;
        background: var(--nx-control-muted);
    }
    .empty__terminal span {
        height: 4px;
        border-radius: 999px;
        background: var(--nx-text-dim);
    }
    .empty__terminal span:nth-child(1) {
        background: var(--nx-accent);
    }
    .empty__terminal span:nth-child(2) {
        background: var(--nx-success);
    }
    .empty h2 {
        margin: 4px 0 0;
        color: var(--nx-text);
        font-size: 18px;
        line-height: 1.2;
        letter-spacing: 0;
    }
    .empty p {
        margin: 0;
        line-height: 1.6;
    }
    .close-empty {
        width: auto;
        padding: 0 12px;
        border: 1px solid var(--nx-border);
        background: var(--nx-surface-2);
    }
    .edge-marker {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 7;
    }
    .edge-marker::after {
        content: '';
        position: absolute;
        border: 2px solid var(--nx-accent);
        background: var(--nx-accent-active);
        box-shadow: inset 0 0 0 1px var(--nx-accent-border-soft);
    }
    .edge-marker.left::after {
        inset: 8px auto 8px 8px;
        width: min(34%, 220px);
    }
    .edge-marker.right::after {
        inset: 8px 8px 8px auto;
        width: min(34%, 220px);
    }
    .edge-marker.top::after {
        inset: 8px 8px auto;
        height: min(30%, 150px);
    }
    .edge-marker.bottom::after {
        inset: auto 8px 8px;
        height: min(30%, 150px);
    }
</style>
