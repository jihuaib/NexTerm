<template>
    <div class="nx-settings">
        <section class="nx-group">
            <div class="nx-group__head">
                <h3>Keychain</h3>
                <p>管理 OpenSSH 标准目录里的 SSH 私钥文件。</p>
            </div>

            <div class="keychain-head">
                <div>
                    <strong>{{ entries.length }} 个 SSH Key</strong>
                    <span>{{ sourcePath }}</span>
                </div>
                <button class="nx-button" type="button" :disabled="loading" @click="loadEntries">
                    {{ loading ? '刷新中' : '刷新' }}
                </button>
            </div>

            <div v-if="error" class="keychain-empty error">{{ error }}</div>
            <div v-else-if="loading && entries.length === 0" class="keychain-empty">正在读取 SSH Keys</div>
            <div v-else-if="entries.length === 0" class="keychain-empty">暂无 SSH Key</div>
            <template v-else>
                <article
                    v-for="entry in entries"
                    :key="entry.id"
                    class="keychain-item"
                    :class="{ selected: contextMenu.visible && contextEntry?.id === entry.id }"
                    @contextmenu.prevent.stop="openEntryMenu($event, entry)"
                    @dblclick="openDetails(entry)"
                >
                    <div class="keychain-item__row">
                        <div class="keychain-item__main">
                            <strong>{{ entry.name }}</strong>
                            <span>{{ keySummary(entry) }}</span>
                        </div>
                    </div>
                </article>
            </template>
        </section>
        <ContextMenu :visible="contextMenu.visible" :x="contextMenu.x" :y="contextMenu.y">
            <button type="button" @click="openContextDetails">查看详情</button>
            <button type="button" @click="removeContextEntry">删除</button>
        </ContextMenu>
        <BaseDialog
            v-if="detailEntry"
            title="SSH Key 详情"
            :subtitle="detailEntry.name"
            width="460px"
            z-index="140"
            @close="closeDetails"
        >
            <dl class="keychain-detail">
                <div>
                    <dt>私钥路径</dt>
                    <dd>
                        <code :title="detailEntry.path">{{ detailEntry.path }}</code>
                    </dd>
                </div>
                <div>
                    <dt>公钥路径</dt>
                    <dd>
                        <code :title="detailEntry.publicKeyPath">{{ detailEntry.publicKeyPath || '-' }}</code>
                    </dd>
                </div>
                <div>
                    <dt>指纹</dt>
                    <dd>
                        <code :title="detailEntry.fingerprint">{{ detailEntry.fingerprint || '-' }}</code>
                    </dd>
                </div>
                <div>
                    <dt>文件</dt>
                    <dd>{{ keyFileDetail(detailEntry) }}</dd>
                </div>
            </dl>

            <template #footer>
                <button class="nx-button" type="button" @click="closeDetails">关闭</button>
            </template>
        </BaseDialog>
    </div>
</template>

<script setup>
    import { onMounted, onUnmounted, ref } from 'vue';
    import { notifyError, notifySuccess } from '../../services/notify';
    import BaseDialog from '../ui/BaseDialog.vue';
    import ContextMenu from '../ui/ContextMenu.vue';

    const entries = ref([]);
    const loading = ref(false);
    const sourcePath = ref('~/.ssh');
    const error = ref('');
    const contextMenu = ref({ visible: false, x: 0, y: 0 });
    const contextEntry = ref(null);
    const detailEntry = ref(null);

    function keySummary(entry) {
        const parts = [];
        if (entry.keyType) parts.push(entry.keyType);
        if (entry.mode) parts.push(entry.mode);
        if (entry.publicKeyPath) parts.push('含公钥');
        return parts.join(' · ') || '私钥文件';
    }

    function keyFileDetail(entry) {
        const parts = [];
        if (entry.size) parts.push(formatSize(entry.size));
        if (entry.updatedAt) parts.push(`更新 ${formatTime(entry.updatedAt)}`);
        return parts.join(' · ') || '-';
    }

    function formatSize(value) {
        const size = Number(value) || 0;
        if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
        if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${size} B`;
    }

    function formatTime(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleString();
    }

    function openDetails(entry) {
        detailEntry.value = entry;
        closeEntryMenu();
    }

    function closeDetails() {
        detailEntry.value = null;
    }

    function openEntryMenu(event, entry) {
        contextEntry.value = entry;
        contextMenu.value = {
            visible: true,
            x: event.clientX,
            y: event.clientY
        };
    }

    function closeEntryMenu() {
        if (!contextMenu.value.visible) return;
        contextMenu.value = { visible: false, x: 0, y: 0 };
        contextEntry.value = null;
    }

    function openContextDetails() {
        const entry = contextEntry.value;
        closeEntryMenu();
        if (entry) openDetails(entry);
    }

    async function removeContextEntry() {
        const entry = contextEntry.value;
        closeEntryMenu();
        if (entry) await removeEntry(entry);
    }

    async function loadEntries() {
        if (!window.keychainApi?.list) {
            error.value = '当前环境不支持 Keychain 管理';
            return;
        }
        loading.value = true;
        error.value = '';
        try {
            const res = await window.keychainApi.list();
            if (res.status !== 'success') {
                error.value = res.msg || '读取 Keychain 失败';
                return;
            }
            sourcePath.value = res.data?.sourcePath || '~/.ssh';
            entries.value = Array.isArray(res.data?.entries) ? res.data.entries : [];
            if (detailEntry.value && !entries.value.some(entry => entry.id === detailEntry.value.id)) {
                detailEntry.value = null;
            }
        } catch (err) {
            error.value = err?.message || '读取 Keychain 失败';
        } finally {
            loading.value = false;
        }
    }

    async function removeEntry(entry) {
        if (!entry || !window.keychainApi?.remove) return;
        const res = await window.keychainApi.remove({ id: entry.id });
        if (res.status !== 'success') {
            notifyError(res.msg || '删除 SSH Key 失败');
            return;
        }
        notifySuccess('SSH Key 已删除');
        if (detailEntry.value?.id === entry.id) detailEntry.value = null;
        await loadEntries();
    }

    onMounted(() => {
        document.addEventListener('click', closeEntryMenu);
        window.addEventListener('blur', closeEntryMenu);
        loadEntries();
    });
    onUnmounted(() => {
        document.removeEventListener('click', closeEntryMenu);
        window.removeEventListener('blur', closeEntryMenu);
    });
</script>

<style scoped>
    .keychain-head,
    .keychain-item__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }
    .keychain-head {
        padding: 12px 0;
    }
    .keychain-head strong,
    .keychain-item__main strong {
        display: block;
        font-size: 12px;
    }
    .keychain-head span,
    .keychain-item__main span {
        display: block;
        margin-top: 3px;
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    .keychain-item {
        margin-top: 6px;
        border: 1px solid var(--nx-border-soft);
        border-radius: 7px;
        background: var(--nx-control-muted);
        cursor: default;
    }
    .keychain-item.selected {
        border-color: var(--nx-accent-border);
        background: var(--nx-accent-softer);
    }
    .keychain-item__row {
        min-height: 34px;
        padding: 6px 8px;
    }
    .keychain-head .nx-button {
        flex: 0 0 auto;
        white-space: nowrap;
    }
    .keychain-item__main {
        min-width: 0;
    }
    .keychain-item__main strong,
    .keychain-item__main span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .keychain-detail {
        display: grid;
        gap: 7px;
        margin: 0;
        max-height: min(360px, 62vh);
        overflow-y: auto;
        padding: 14px 16px;
    }
    .keychain-detail div {
        min-width: 0;
    }
    .keychain-detail dt {
        color: var(--nx-text-dim);
        font-size: 10px;
    }
    .keychain-detail dd {
        min-width: 0;
        margin: 2px 0 0;
        color: var(--nx-text);
        font-size: 11px;
    }
    .keychain-detail code {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--nx-text-dim);
        font-family: var(--nx-font-mono);
        font-size: 11px;
    }
    .keychain-empty {
        padding: 11px 10px;
        border: 1px dashed var(--nx-border);
        border-radius: 7px;
        color: var(--nx-text-dim);
        font-size: 12px;
    }
    .keychain-empty.error {
        border-color: var(--nx-danger);
        color: var(--nx-danger);
        background: var(--nx-danger-soft);
    }

    @media (max-width: 760px) {
        .keychain-head,
        .keychain-head {
            align-items: stretch;
            flex-direction: column;
        }
        .keychain-head .nx-button {
            width: 100%;
        }
    }
</style>
