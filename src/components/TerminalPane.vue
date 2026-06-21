<template>
    <div class="pane">
        <div ref="host" class="xterm-host" @contextmenu.prevent.stop="handleTerminalContextMenu" />
        <div v-if="searchVisible" class="search-panel" @mousedown.stop @keydown.stop>
            <Search :size="14" :stroke-width="1.9" />
            <input
                ref="searchInput"
                v-model="searchTerm"
                placeholder="搜索终端"
                @input="runSearch('next', true)"
                @keydown.enter.prevent="runSearch($event.shiftKey ? 'previous' : 'next')"
                @keydown.esc.prevent="closeSearch"
            />
            <span class="search-count">{{ searchCountLabel }}</span>
            <button type="button" title="上一个" @click="runSearch('previous')">
                <ChevronUp :size="14" :stroke-width="2" />
            </button>
            <button type="button" title="下一个" @click="runSearch('next')">
                <ChevronDown :size="14" :stroke-width="2" />
            </button>
            <button type="button" title="关闭" @click="closeSearch">
                <X :size="14" :stroke-width="2" />
            </button>
        </div>
        <ContextMenu :visible="terminalMenu.visible" :x="terminalMenu.x" :y="terminalMenu.y">
            <button type="button" :disabled="!terminalMenu.canCopy" @click="copySelection">
                <Copy :size="14" :stroke-width="1.9" />
                <span>复制</span>
            </button>
            <button type="button" @click="pasteClipboard">
                <ClipboardPaste :size="14" :stroke-width="1.9" />
                <span>粘贴</span>
            </button>
            <button type="button" @click="openSearchFromMenu">
                <Search :size="14" :stroke-width="1.9" />
                <span>查找</span>
            </button>
        </ContextMenu>
        <div v-if="banner" class="banner" :class="[bannerType, { 'with-search': searchVisible }]">
            <span class="banner__text">{{ banner }}</span>
            <button
                v-if="bannerCanReconnect"
                class="banner__copy"
                type="button"
                title="重新连接"
                @click="reconnectTerminal()"
            >
                <RotateCw :size="13" :stroke-width="2" />
            </button>
            <button v-if="bannerCanCopy" class="banner__copy" type="button" title="复制详情" @click="copyBanner">
                <Copy :size="13" :stroke-width="2" />
            </button>
        </div>
        <BaseDialog
            v-if="authPromptVisible"
            :title="authPromptTitle"
            :subtitle="authPromptSubtitle"
            width="360px"
            :z-index="130"
            @close="cancelAuthPrompt"
        >
            <div class="auth-form">
                <label class="auth-field" :class="{ 'is-invalid': authError }">
                    <span>{{ authPromptLabel }}</span>
                    <input
                        ref="authPasswordInput"
                        v-model="authPassword"
                        type="password"
                        autocomplete="current-password"
                        :aria-invalid="authError ? 'true' : 'false'"
                        @input="authError = ''"
                        @keydown.enter.prevent="submitAuthPrompt"
                    />
                    <small v-if="authError">{{ authError }}</small>
                </label>
            </div>

            <template #footer>
                <button class="auth-button ghost" type="button" @click="cancelAuthPrompt">取消</button>
                <button class="auth-button primary" type="button" :disabled="authSubmitting" @click="submitAuthPrompt">
                    {{ authSubmitting ? '连接中' : '连接' }}
                </button>
            </template>
        </BaseDialog>
    </div>
</template>

<script setup>
    import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
    import { ChevronDown, ChevronUp, ClipboardPaste, Copy, RotateCw, Search, X } from '@lucide/vue';
    import { store, setSessionStatus } from '../store';
    import { isLocalSessionProtocol, isSerialSessionProtocol, isSshSessionProtocol } from '../models/resources';
    import { notifyError, notifySuccess } from '../services/notify';
    import {
        activateTerminalView,
        clearTerminalSearch,
        findTerminalNext,
        findTerminalPrevious,
        fitTerminalView,
        focusTerminalView,
        getTerminalViewSize,
        mountTerminalView,
        scheduleTerminalViewFit,
        setTerminalSelectionHandler,
        onTerminalViewStatus,
        setTerminalShortcutHandler,
        updateTerminalViewSettings
    } from '../services/terminalViews';
    import BaseDialog from './ui/BaseDialog.vue';
    import ContextMenu from './ui/ContextMenu.vue';

    const props = defineProps({
        session: { type: Object, required: true },
        active: { type: Boolean, default: true }
    });

    const host = ref(null);
    const banner = ref('');
    const bannerType = ref('info');
    const currentStatus = ref(props.session.status || 'connecting');
    const bannerCanCopy = computed(() => banner.value && (bannerType.value === 'err' || bannerType.value === 'warn'));
    const bannerCanReconnect = computed(
        () => ['closed', 'error'].includes(currentStatus.value) && !authPromptVisible.value
    );
    const authPromptVisible = ref(false);
    const authPromptKind = ref('password');
    const authPassword = ref('');
    const authError = ref('');
    const authSubmitting = ref(false);
    const authPasswordInput = ref(null);
    const terminalMenu = ref({ visible: false, x: 0, y: 0, canCopy: false });
    const searchVisible = ref(false);
    const searchInput = ref(null);
    const searchTerm = ref('');
    const searchResult = ref({ found: false, resultIndex: 0, resultCount: 0 });
    const authPromptSubtitle = computed(() => {
        const user = props.session.username ? `${props.session.username}@` : '';
        return `${user}${props.session.host}:${props.session.port || 22}`;
    });
    const authPromptTitle = computed(() => (authPromptKind.value === 'passphrase' ? 'SSH 私钥口令' : 'SSH 密码'));
    const authPromptLabel = computed(() => (authPromptKind.value === 'passphrase' ? '私钥口令' : '密码'));
    const searchCountLabel = computed(() => {
        if (!searchTerm.value) return '';
        const count = Number(searchResult.value.resultCount) || 0;
        if (!count) return '无匹配';
        const index = Math.max(1, Number(searchResult.value.resultIndex) + 1);
        return `${index}/${count}`;
    });

    let view = null;
    let resizeObserver = null;
    let stopStatusListener = null;
    let autoCopyTimer = null;
    let autoReconnectTimer = null;
    let autoReconnectAttempts = Number(props.session.reconnectAttempts) || 0;
    let suppressAutoReconnect = false;
    let lastAutoCopiedSelection = '';

    function doFit() {
        fitTerminalView(view);
    }

    function scheduleFit(options = {}) {
        scheduleTerminalViewFit(view, options);
    }

    function activateVisibleTerminal(options = {}) {
        if (!view || !props.active) return;
        activateTerminalView(view);
        if (options.focus) focusTerminalView(view);
    }

    function handleSurfaceResize() {
        closeTerminalMenu();
        scheduleFit();
    }

    function handleWindowFocus() {
        activateVisibleTerminal();
    }

    function handleVisibilityChange() {
        if (document.visibilityState === 'visible') activateVisibleTerminal();
    }

    onMounted(async () => {
        view = mountTerminalView(props.session, store.settings, host.value);
        setTerminalShortcutHandler(view, handleTerminalShortcut);
        setTerminalSelectionHandler(view, handleTerminalSelectionChange);
        stopStatusListener = onTerminalViewStatus(view, (status, msg) => {
            currentStatus.value = status;
            setSessionStatus(props.session.sessionId, status);
            showStatus(status, msg);
            if (status === 'connected') {
                clearAutoReconnect();
                autoReconnectAttempts = 0;
                props.session.reconnectAttempts = 0;
                clearPromptModeSecrets();
            }
            const retryKind = retrySecretKind(status, msg);
            if (retryKind) {
                props.session.connectionStarted = false;
                if (retryKind === 'password') props.session.password = '';
                if (retryKind === 'passphrase') props.session.passphrase = '';
                openAuthPrompt(msg, retryKind);
                return;
            }
            scheduleAutoReconnect(status, msg);
        });
        doFit();
        focusTerminalView(view);
        showStatus(view.status, view.statusMsg);

        // 自适应大小
        resizeObserver = new ResizeObserver(() => scheduleFit());
        resizeObserver.observe(host.value);
        document.addEventListener('click', closeTerminalMenu);
        window.addEventListener('blur', closeTerminalMenu);
        window.addEventListener('resize', handleSurfaceResize);
        window.addEventListener('focus', handleWindowFocus);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // 首次挂载才发起连接；运行中会话拖到新窗格时复用原 sessionId。
        if (!props.session.connectionStarted) {
            await startConnectFlow();
        } else if (props.session.status && props.session.status !== 'connected') {
            showStatus(props.session.status);
        }
    });

    function isPasswordAuthSession() {
        return isSshSessionProtocol(props.session.protocol) && (props.session.authType || 'password') === 'password';
    }

    function normalizeKeyName(key = '') {
        const value = String(key || '').trim();
        if (!value) return '';
        if (value === ' ') return 'SPACE';
        return value.length === 1 ? value.toUpperCase() : value.toUpperCase();
    }

    function isMacPlatform() {
        return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '');
    }

    function shortcutMatches(event, shortcut) {
        const raw = String(shortcut || '').trim();
        if (!raw) return false;

        const tokens = raw
            .split('+')
            .map(token => token.trim())
            .filter(Boolean);
        const key = tokens.pop();
        if (!key) return false;

        const wantsCmdOrCtrl = tokens.some(token => /^cmdorctrl$/i.test(token));
        const wantsCtrl = tokens.some(token => /^ctrl|control$/i.test(token));
        const wantsMeta = tokens.some(token => /^cmd|command|meta$/i.test(token));
        const wantsShift = tokens.some(token => /^shift$/i.test(token));
        const wantsAlt = tokens.some(token => /^alt|option$/i.test(token));
        const isMac = isMacPlatform();

        const expectedCtrl = wantsCtrl || (wantsCmdOrCtrl && !isMac);
        const expectedMeta = wantsMeta || (wantsCmdOrCtrl && isMac);

        return (
            Boolean(event.ctrlKey) === expectedCtrl &&
            Boolean(event.metaKey) === expectedMeta &&
            Boolean(event.shiftKey) === wantsShift &&
            Boolean(event.altKey) === wantsAlt &&
            normalizeKeyName(event.key) === normalizeKeyName(key)
        );
    }

    function handleTerminalShortcut(event) {
        if (event.type !== 'keydown' || authPromptVisible.value) return true;
        if (shortcutMatches(event, store.settings.terminalSearchShortcut ?? 'CmdOrCtrl+F')) {
            event.preventDefault();
            openSearch();
            return false;
        }
        if (shortcutMatches(event, store.settings.terminalCopyShortcut)) {
            event.preventDefault();
            void copySelection();
            return false;
        }
        if (shortcutMatches(event, store.settings.terminalPasteShortcut)) {
            event.preventDefault();
            void pasteClipboard();
            return false;
        }
        return true;
    }

    function handleTerminalSelectionChange(text) {
        if (!store.settings.terminalSelectToCopy) return;
        const selected = String(text || '');
        if (!selected || selected === lastAutoCopiedSelection) return;
        if (autoCopyTimer) window.clearTimeout(autoCopyTimer);
        autoCopyTimer = window.setTimeout(async () => {
            const latest = selectedTerminalText();
            if (!latest || latest === lastAutoCopiedSelection) return;
            try {
                await writeClipboardText(latest);
                lastAutoCopiedSelection = latest;
            } catch (_err) {
                /* silent: automatic copy should not interrupt selection */
            }
        }, 160);
    }

    function needsInitialSecretPrompt() {
        return isPasswordAuthSession() && !String(props.session.password || '');
    }

    function retrySecretKind(status, msg = '') {
        if (status !== 'error') return '';
        const text = String(msg || '');
        if (isPasswordAuthSession() && /SSH 认证失败|密码为空/i.test(text)) return 'password';
        if (
            isSshSessionProtocol(props.session.protocol) &&
            (props.session.authType || 'password') === 'key' &&
            /passphrase|口令|私钥|private key|encrypted|decrypt/i.test(text)
        ) {
            return 'passphrase';
        }
        return '';
    }

    function clearPromptModeSecrets() {
        if (props.session.credentialSaveMode !== 'prompt') return;
        props.session.password = '';
        props.session.passphrase = '';
    }

    function isRemoteSession() {
        return props.session.protocol === 'ssh' || props.session.protocol === 'telnet' || props.session.protocol === 'serial';
    }

    function isNonRetryableConnectionError(msg = '') {
        return /认证失败|主机指纹校验失败|known_hosts|密码为空|配置无效|已取消/i.test(String(msg || ''));
    }

    function clearAutoReconnect() {
        if (!autoReconnectTimer) return;
        window.clearTimeout(autoReconnectTimer);
        autoReconnectTimer = null;
    }

    function shouldAutoReconnect(status, msg = '') {
        if (suppressAutoReconnect) return false;
        if (!store.settings.connectionAutoReconnect) return false;
        if (!isRemoteSession()) return false;
        if (props.session.manualDisconnect) return false;
        if (!props.session.connectionStarted) return false;
        if (status !== 'closed' && status !== 'error') return false;
        if (isNonRetryableConnectionError(msg)) return false;
        const maxAttempts = Math.max(1, Number(store.settings.connectionReconnectMaxAttempts) || 5);
        return autoReconnectAttempts < maxAttempts;
    }

    function scheduleAutoReconnect(status, msg = '') {
        if (!shouldAutoReconnect(status, msg) || autoReconnectTimer) return;
        const delay = Math.max(1, Number(store.settings.connectionReconnectDelay) || 3);
        const maxAttempts = Math.max(1, Number(store.settings.connectionReconnectMaxAttempts) || 5);
        autoReconnectAttempts += 1;
        props.session.reconnectAttempts = autoReconnectAttempts;
        const base = msg || (status === 'error' ? '连接失败' : '连接已关闭');
        showStatus(status, `${base}，${delay} 秒后自动重连（${autoReconnectAttempts}/${maxAttempts}）`);
        autoReconnectTimer = window.setTimeout(() => {
            autoReconnectTimer = null;
            reconnectTerminal({ automatic: true });
        }, delay * 1000);
    }

    async function startConnectFlow() {
        if (needsInitialSecretPrompt()) {
            openAuthPrompt('', 'password');
            return;
        }
        await connectTerminal();
    }

    function openAuthPrompt(message = '', kind = 'password') {
        authSubmitting.value = false;
        authPromptKind.value = kind;
        authPassword.value = '';
        authError.value = message || '';
        authPromptVisible.value = true;
        showStatus('info', kind === 'passphrase' ? '请输入 SSH 私钥口令' : '请输入 SSH 密码');
        nextTick(() => authPasswordInput.value?.focus?.());
    }

    function cancelAuthPrompt() {
        if (authSubmitting.value) return;
        authPromptVisible.value = false;
        authPassword.value = '';
        authError.value = '';
        setSessionStatus(props.session.sessionId, 'closed');
        showStatus('closed', authPromptKind.value === 'passphrase' ? '已取消 SSH 私钥口令输入' : '已取消 SSH 密码输入');
    }

    async function submitAuthPrompt() {
        if (authSubmitting.value) return;
        if (!authPassword.value) {
            authError.value = authPromptKind.value === 'passphrase' ? '请输入 SSH 私钥口令' : '请输入 SSH 密码';
            nextTick(() => authPasswordInput.value?.focus?.());
            return;
        }

        authSubmitting.value = true;
        if (authPromptKind.value === 'passphrase') props.session.passphrase = authPassword.value;
        else props.session.password = authPassword.value;
        authPromptVisible.value = false;
        await connectTerminal();
        authSubmitting.value = false;
    }

    async function connectTerminal() {
        clearAutoReconnect();
        props.session.manualDisconnect = false;
        props.session.connectionStarted = true;
        showStatus('connecting');
        const size = getTerminalViewSize(view);
        const payload = {
            sessionId: props.session.sessionId,
            name: props.session.name,
            protocol: props.session.protocol,
            host: props.session.host,
            port: props.session.port,
            username: props.session.username,
            authType: props.session.authType,
            profileId: props.session.profileId,
            credentialSaveMode: props.session.credentialSaveMode,
            password: props.session.password,
            privateKeyPath: props.session.privateKeyPath,
            passphrase: props.session.passphrase,
            sshKnownHostsEnabled: store.settings.sshKnownHostsEnabled,
            shell: props.session.shell,
            cwd: props.session.cwd,
            serialPath: props.session.serialPath,
            serialBaudRate: props.session.serialBaudRate,
            serialDataBits: props.session.serialDataBits,
            serialStopBits: props.session.serialStopBits,
            serialParity: props.session.serialParity,
            serialFlowControl: props.session.serialFlowControl,
            serialDtr: props.session.serialDtr,
            serialRts: props.session.serialRts,
            cols: size.cols,
            rows: size.rows
        };
        let res;
        try {
            res = await connectWithTimeout(payload);
        } catch (err) {
            res = { status: 'error', msg: err?.message || String(err) };
        }
        if (res.status === 'error') {
            setSessionStatus(props.session.sessionId, 'error');
            showStatus('error', res.msg);
            const retryKind = retrySecretKind('error', res.msg);
            if (retryKind) {
                props.session.connectionStarted = false;
                if (retryKind === 'password') props.session.password = '';
                if (retryKind === 'passphrase') props.session.passphrase = '';
                openAuthPrompt(res.msg, retryKind);
                return;
            }
            if (needsInitialSecretPrompt()) props.session.connectionStarted = false;
        }
    }

    function connectWithTimeout(payload) {
        const isLocal = isLocalSessionProtocol(payload.protocol);
        const isSerial = isSerialSessionProtocol(payload.protocol);
        const timeoutMs = isLocal || isSerial ? 12_000 : 20_000;
        const timeoutMsg = isLocal
            ? '本地 Shell 启动超时，请检查 node-pty 是否已按当前 Electron 版本重编，或尝试设置 NEXTERM_PTY_BACKEND=winpty 后重启。'
            : isSerial
              ? '串口打开超时，请确认设备已连接且未被其他程序占用。'
            : '连接请求超时，请稍后重试。';
        let timer = null;
        return Promise.race([
            window.terminalApi.connect(payload),
            new Promise((_, reject) => {
                timer = window.setTimeout(() => reject(new Error(timeoutMsg)), timeoutMs);
            })
        ]).finally(() => {
            if (timer) window.clearTimeout(timer);
        });
    }

    async function reconnectTerminal(options = {}) {
        clearAutoReconnect();
        if (!options.automatic) {
            autoReconnectAttempts = 0;
            props.session.reconnectAttempts = 0;
        }
        props.session.manualDisconnect = false;
        props.session.connectionStarted = false;
        suppressAutoReconnect = true;
        try {
            await window.terminalApi.disconnect(props.session.sessionId);
        } catch (_err) {
            /* session may already be closed */
        } finally {
            suppressAutoReconnect = false;
        }
        await startConnectFlow();
    }

    function showStatus(status, msg) {
        currentStatus.value = status;
        const isLocal = isLocalSessionProtocol(props.session.protocol);
        const isSerial = isSerialSessionProtocol(props.session.protocol);
        const map = {
            connecting: [
                'info',
                isLocal
                    ? '正在启动本地 Shell …'
                    : isSerial
                      ? `正在打开串口 ${props.session.serialPath || ''} …`
                    : `正在连接 ${props.session.host}:${props.session.port} …`
            ],
            connected: ['ok', ''],
            closed: ['warn', msg || '连接已关闭'],
            error: ['err', msg || '连接错误']
        };
        const [type, text] = map[status] || ['info', ''];
        bannerType.value = type;
        banner.value = text;
        if (status === 'connected') {
            setTimeout(() => {
                if (bannerType.value === 'ok') banner.value = '';
            }, 800);
        }
    }

    async function openSearch() {
        searchVisible.value = true;
        await nextTick();
        searchInput.value?.focus?.();
        searchInput.value?.select?.();
        if (searchTerm.value) runSearch('next', true);
    }

    function openSearchFromMenu() {
        closeTerminalMenu();
        void openSearch();
    }

    function closeSearch() {
        searchVisible.value = false;
        clearTerminalSearch(view);
        focusTerminalView(view);
    }

    function runSearch(direction = 'next', incremental = false) {
        const term = searchTerm.value.trim();
        if (!term) {
            searchResult.value = { found: false, resultIndex: 0, resultCount: 0 };
            clearTerminalSearch(view);
            return;
        }
        searchResult.value =
            direction === 'previous'
                ? findTerminalPrevious(view, term, { incremental })
                : findTerminalNext(view, term, { incremental });
    }

    async function copyBanner() {
        try {
            await writeClipboardText(banner.value);
            notifySuccess('详情已复制');
        } catch (err) {
            notifyError(err?.message || '复制失败');
        }
    }

    function selectedTerminalText() {
        return view?.term?.getSelection?.() || '';
    }

    function terminalMenuTriggerMatches(event) {
        const trigger = store.settings.terminalContextMenuTrigger || 'shift';
        if (trigger === 'none') return false;
        if (trigger === 'shift') return event.shiftKey;
        if (trigger === 'ctrl') return event.ctrlKey;
        if (trigger === 'alt') return event.altKey;
        if (trigger === 'meta') return event.metaKey;
        return false;
    }

    function shouldOpenTerminalMenu(event) {
        if (store.settings.terminalRightClickAction === 'menu') return true;
        return terminalMenuTriggerMatches(event);
    }

    function openTerminalMenuAt(event) {
        terminalMenu.value = {
            visible: true,
            x: event.clientX,
            y: event.clientY,
            canCopy: Boolean(selectedTerminalText())
        };
    }

    async function handleTerminalContextMenu(event) {
        if (shouldOpenTerminalMenu(event)) {
            openTerminalMenuAt(event);
            return;
        }
        if (store.settings.terminalRightClickAction === 'paste') {
            await pasteClipboard();
        }
    }

    function closeTerminalMenu() {
        if (!terminalMenu.value.visible) return;
        terminalMenu.value = { visible: false, x: 0, y: 0, canCopy: false };
    }

    async function readClipboardText() {
        if (window.clipboardApi?.readText) return window.clipboardApi.readText();
        return navigator.clipboard.readText();
    }

    async function writeClipboardText(text) {
        if (window.clipboardApi?.writeText) {
            await window.clipboardApi.writeText(text);
            return;
        }
        await navigator.clipboard.writeText(String(text || ''));
    }

    async function copySelection() {
        const text = selectedTerminalText();
        closeTerminalMenu();
        if (!text) {
            notifyError('没有可复制的选中文本', '复制失败');
            return;
        }
        try {
            await writeClipboardText(text);
            notifySuccess('已复制');
        } catch (err) {
            notifyError(err?.message || '复制失败');
        } finally {
            focusTerminalView(view);
        }
    }

    async function pasteClipboard() {
        closeTerminalMenu();
        try {
            const text = await readClipboardText();
            if (!text) {
                notifyError('剪贴板为空', '粘贴失败');
                return;
            }
            window.terminalApi.sendInput(props.session.sessionId, text);
            focusTerminalView(view);
        } catch (err) {
            notifyError(err?.message || '粘贴失败');
        }
    }

    // 设置热更新（主题/字号/字体/光标/回滚行数）
    watch(
        () => ({ ...store.settings }),
        (cur, prev) => {
            updateTerminalViewSettings(view, cur, prev);
        },
        { deep: true }
    );

    watch(
        () => props.active,
        active => {
            if (!active || !view) return;
            nextTick(() => {
                requestAnimationFrame(() => {
                    activateVisibleTerminal({ focus: true });
                });
            });
        }
    );

    onBeforeUnmount(() => {
        setTerminalShortcutHandler(view, null);
        setTerminalSelectionHandler(view, null);
        if (autoCopyTimer) window.clearTimeout(autoCopyTimer);
        clearAutoReconnect();
        if (stopStatusListener) stopStatusListener();
        if (resizeObserver) resizeObserver.disconnect();
        document.removeEventListener('click', closeTerminalMenu);
        window.removeEventListener('blur', closeTerminalMenu);
        window.removeEventListener('resize', handleSurfaceResize);
        window.removeEventListener('focus', handleWindowFocus);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    });
</script>

<style scoped>
    .pane {
        position: absolute;
        inset: 0;
        padding: 8px;
        background: var(--nx-bg);
    }
    .xterm-host {
        width: 100%;
        height: 100%;
        overflow: hidden;
    }
    .search-panel {
        position: absolute;
        top: 12px;
        right: 14px;
        z-index: 5;
        display: grid;
        grid-template-columns: 16px minmax(120px, 220px) minmax(42px, auto) 26px 26px 26px;
        align-items: center;
        gap: 6px;
        min-height: 34px;
        padding: 4px 5px 4px 9px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-surface-raised);
        color: var(--nx-text-dim);
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.22);
    }
    .search-panel input {
        min-width: 0;
        height: 24px;
        border: 1px solid var(--nx-border-soft);
        border-radius: 5px;
        background: var(--nx-bg);
        color: var(--nx-text);
        outline: none;
        padding: 0 7px;
        font-size: 12px;
    }
    .search-panel input:focus {
        border-color: var(--nx-accent);
    }
    .search-panel button {
        display: grid;
        place-items: center;
        width: 26px;
        height: 24px;
        border: 1px solid transparent;
        border-radius: 5px;
        background: transparent;
        color: var(--nx-text-dim);
        cursor: pointer;
    }
    .search-panel button:hover {
        border-color: var(--nx-border);
        background: var(--nx-surface-2);
        color: var(--nx-text);
    }
    .search-count {
        min-width: 42px;
        color: var(--nx-text-dim);
        font-size: 11px;
        text-align: center;
        white-space: nowrap;
    }
    .banner {
        position: absolute;
        top: 12px;
        right: 14px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) repeat(2, auto);
        align-items: start;
        gap: 8px;
        max-width: min(560px, calc(100% - 28px));
        padding: 7px 8px 7px 10px;
        border: 1px solid var(--nx-border);
        border-radius: 6px;
        font-size: 12px;
        pointer-events: auto;
        user-select: text;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    }
    .banner.with-search {
        top: 56px;
    }
    .banner__text {
        min-width: 0;
        overflow-wrap: anywhere;
        line-height: 1.45;
    }
    .banner__copy {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: currentColor;
        cursor: pointer;
        opacity: 0.78;
        user-select: none;
    }
    .banner__copy:hover {
        border-color: currentColor;
        opacity: 1;
    }
    .banner.info {
        background: var(--nx-surface-raised);
        color: var(--nx-text);
    }
    .banner.warn {
        background: var(--nx-warning-soft);
        color: var(--nx-warning);
    }
    .banner.err {
        background: var(--nx-danger-soft);
        color: var(--nx-danger);
    }
    .auth-form {
        padding: 18px;
    }
    .auth-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        color: var(--nx-text-dim);
    }
    .auth-field span {
        font-size: 12px;
    }
    .auth-field input {
        width: 100%;
        height: 34px;
        padding: 0 10px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-bg);
        color: var(--nx-text);
        outline: none;
    }
    .auth-field input:focus {
        border-color: var(--nx-accent);
    }
    .auth-field small {
        color: var(--nx-danger);
        font-size: 12px;
        line-height: 1.4;
    }
    .auth-field.is-invalid span {
        color: var(--nx-danger);
    }
    .auth-field.is-invalid input {
        border-color: var(--nx-danger);
        background: var(--nx-danger-soft);
        box-shadow: 0 0 0 2px var(--nx-danger-ring);
    }
    .auth-button {
        height: 32px;
        min-width: 72px;
        padding: 0 14px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        cursor: pointer;
    }
    .auth-button.ghost {
        background: var(--nx-surface-2);
        color: var(--nx-text);
    }
    .auth-button.primary {
        border-color: var(--nx-accent);
        background: var(--nx-accent);
        color: var(--nx-accent-text);
    }
    .auth-button:hover {
        filter: brightness(1.06);
    }
    .auth-button:disabled {
        cursor: not-allowed;
        opacity: 0.62;
    }
</style>
