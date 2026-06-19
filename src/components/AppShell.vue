<template>
    <div class="shell">
        <header class="titlebar">
            <div class="brand">
                <img class="brand__mark" :src="appIcon" alt="" aria-hidden="true" />
                <div class="brand__text">
                    <strong>NexTerm</strong>
                    <span>Remote Access Console</span>
                </div>
            </div>
            <span class="spacer" />
            <div class="titlebar__meta">
                <span>{{ store.sessions.length }} 会话</span>
                <span>{{ openSessionCount }} 连接</span>
            </div>
            <IconButton title="设置" @click="openSettings">
                <Settings :size="16" :stroke-width="1.9" />
            </IconButton>
        </header>

        <div
            class="body"
            :class="{ 'is-resizing-sidebar': resizingSidebar }"
            :style="{ '--session-sidebar-width': `${sidebarWidth}px` }"
        >
            <SessionSidebar />

            <div
                class="sidebar-resizer"
                role="separator"
                aria-orientation="vertical"
                :aria-valuenow="sidebarWidth"
                :aria-valuemin="SIDEBAR_MIN_WIDTH"
                :aria-valuemax="SIDEBAR_MAX_WIDTH"
                title="拖动调整会话区域宽度"
                @pointerdown="startSidebarResize"
                @dblclick="resetSidebarWidth"
            />

            <main class="workspace">
                <WorkspaceLayout />
            </main>
        </div>

        <SettingsPanel v-if="store.settingsOpen" />
        <ToastViewport />
    </div>
</template>

<script setup>
    import { computed, onUnmounted, ref, watch } from 'vue';
    import { Settings } from '@lucide/vue';
    import appIcon from '../../electron/assets/icon.svg';
    import { store, openSettings, updateSettings } from '../store';
    import { collectSessions } from '../layout';
    import IconButton from './ui/IconButton.vue';
    import SessionSidebar from './SessionSidebar.vue';
    import WorkspaceLayout from './WorkspaceLayout.vue';
    import SettingsPanel from './settings/SettingsPanel.vue';
    import ToastViewport from './ui/ToastViewport.vue';

    const SIDEBAR_DEFAULT_WIDTH = 278;
    const SIDEBAR_MIN_WIDTH = 220;
    const SIDEBAR_MAX_WIDTH = 460;

    const resizingSidebar = ref(false);
    const sidebarWidth = ref(readSidebarWidth());
    const openSessionCount = computed(() => collectSessions(store.layout).length);

    let sidebarResizeState = null;

    function clampSidebarWidth(width) {
        return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
    }

    function readSidebarWidth() {
        const configured = Number(store.settings.sidebarWidth);
        if (Number.isFinite(configured) && configured > 0) return clampSidebarWidth(configured);
        return SIDEBAR_DEFAULT_WIDTH;
    }

    function startSidebarResize(event) {
        if (event.button !== 0) return;
        event.preventDefault();

        sidebarResizeState = {
            startX: event.clientX,
            startWidth: sidebarWidth.value
        };
        resizingSidebar.value = true;
        document.body.classList.add('resizing-sidebar');
        event.currentTarget.setPointerCapture?.(event.pointerId);
        window.addEventListener('pointermove', resizeSidebar);
        window.addEventListener('pointerup', stopSidebarResize);
    }

    function resizeSidebar(event) {
        if (!sidebarResizeState) return;
        sidebarWidth.value = clampSidebarWidth(
            sidebarResizeState.startWidth + event.clientX - sidebarResizeState.startX
        );
    }

    function stopSidebarResize() {
        if (!sidebarResizeState) return;
        sidebarResizeState = null;
        resizingSidebar.value = false;
        document.body.classList.remove('resizing-sidebar');
        updateSettings({ sidebarWidth: sidebarWidth.value });
        window.removeEventListener('pointermove', resizeSidebar);
        window.removeEventListener('pointerup', stopSidebarResize);
    }

    function resetSidebarWidth() {
        sidebarWidth.value = SIDEBAR_DEFAULT_WIDTH;
        updateSettings({ sidebarWidth: sidebarWidth.value });
    }

    watch(
        () => store.settings.sidebarWidth,
        width => {
            if (resizingSidebar.value) return;
            const next = clampSidebarWidth(Number(width) || SIDEBAR_DEFAULT_WIDTH);
            if (next !== sidebarWidth.value) sidebarWidth.value = next;
        }
    );

    onUnmounted(() => {
        window.removeEventListener('pointermove', resizeSidebar);
        window.removeEventListener('pointerup', stopSidebarResize);
        document.body.classList.remove('resizing-sidebar');
    });
</script>

<style scoped>
    .shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--nx-bg);
    }
    .titlebar {
        display: flex;
        align-items: center;
        height: 52px;
        padding: 0 14px 0 16px;
        background: var(--nx-titlebar-bg);
        border-bottom: 1px solid var(--nx-border);
        -webkit-app-region: drag;
    }
    .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
    }
    .brand__mark {
        display: block;
        width: 30px;
        height: 30px;
        border-radius: 8px;
        box-shadow: 0 0 0 1px var(--nx-accent-border);
    }
    .brand__text {
        display: flex;
        flex-direction: column;
        gap: 1px;
        line-height: 1.1;
    }
    .brand__text strong {
        font-size: 14px;
        letter-spacing: 0;
    }
    .brand__text span {
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    .spacer {
        flex: 1;
    }
    .titlebar__meta {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--nx-text-dim);
        font-size: 12px;
        margin-right: 10px;
    }
    .titlebar__meta span {
        padding: 3px 8px;
        border: 1px solid var(--nx-border);
        border-radius: 999px;
        background: var(--nx-bg-overlay);
    }
    :deep(.icon-button) {
        margin-left: 6px;
    }
    .body {
        flex: 1;
        display: flex;
        min-height: 0;
    }
    .sidebar-resizer {
        position: relative;
        z-index: 5;
        flex: 0 0 7px;
        width: 7px;
        margin-left: -4px;
        cursor: col-resize;
        touch-action: none;
    }
    .sidebar-resizer::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: 3px;
        width: 1px;
        background: var(--nx-border);
    }
    .sidebar-resizer::after {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: 1px;
        width: 5px;
        background: var(--nx-accent-border-soft);
        opacity: 0;
        transition: opacity 0.12s ease;
    }
    .sidebar-resizer:hover::after,
    .body.is-resizing-sidebar .sidebar-resizer::after {
        opacity: 1;
    }
    .body.is-resizing-sidebar,
    .body.is-resizing-sidebar * {
        cursor: col-resize !important;
        user-select: none;
    }
    :global(body.resizing-sidebar),
    :global(body.resizing-sidebar *) {
        cursor: col-resize !important;
        user-select: none !important;
    }
    .workspace {
        flex: 1;
        display: flex;
        min-width: 0;
        min-height: 0;
        padding: 8px;
        gap: 8px;
        background: var(--nx-bg);
    }

    @media (max-width: 860px) {
        .titlebar__meta {
            display: none;
        }
        .brand__text span {
            display: none;
        }
    }
</style>
