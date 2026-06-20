<template>
    <div class="nx-settings">
        <section class="nx-group">
            <div class="nx-group__head">
                <h3>Known Host</h3>
                <p>管理 SSH 主机指纹记录。删除后，下次连接会重新信任当前指纹。</p>
            </div>

            <div class="known-hosts__head">
                <div>
                    <strong>{{ entries.length }} 条记录</strong>
                    <span>{{ sourceLabel }}</span>
                </div>
                <button class="nx-button" type="button" :disabled="loading" @click="loadEntries">
                    {{ loading ? '刷新中' : '刷新' }}
                </button>
            </div>

            <div v-if="error" class="known-hosts__empty error">{{ error }}</div>
            <div v-else-if="loading && entries.length === 0" class="known-hosts__empty">正在读取主机指纹</div>
            <div v-else-if="entries.length === 0" class="known-hosts__empty">暂无已信任主机</div>
            <template v-else>
                <article
                    v-for="entry in entries"
                    :key="entry.id"
                    class="known-host"
                    :class="{ selected: contextMenu.visible && contextEntry?.id === entry.id }"
                    @contextmenu.prevent.stop="openEntryMenu($event, entry)"
                    @dblclick="openDetails(entry)"
                >
                    <div class="known-host__row">
                        <div class="known-host__main">
                            <strong>{{ entry.host }}:{{ entry.port }}</strong>
                            <span>{{ hostSummary(entry) }}</span>
                        </div>
                    </div>
                </article>
            </template>
        </section>
        <ContextMenu :visible="contextMenu.visible" :x="contextMenu.x" :y="contextMenu.y">
            <button type="button" @click="openContextDetails">查看详情</button>
            <button type="button" @click="removeContextEntry">重新信任</button>
        </ContextMenu>
        <BaseDialog
            v-if="detailEntry"
            title="Known Host 详情"
            :subtitle="`${detailEntry.host}:${detailEntry.port}`"
            width="460px"
            z-index="140"
            @close="closeDetails"
        >
            <dl class="known-host__detail">
                <div>
                    <dt>主机匹配</dt>
                    <dd>
                        <code :title="detailEntry.hostPattern">
                            {{ detailEntry.hostPattern || `${detailEntry.host}:${detailEntry.port}` }}
                        </code>
                    </dd>
                </div>
                <div>
                    <dt>指纹</dt>
                    <dd>
                        <code :title="detailEntry.fingerprint">{{ detailEntry.fingerprint || '-' }}</code>
                    </dd>
                </div>
                <div>
                    <dt>密钥</dt>
                    <dd>{{ keyDetail(detailEntry) }}</dd>
                </div>
                <div>
                    <dt>来源</dt>
                    <dd>
                        <code :title="detailEntry.sourcePath">{{ sourceDetail(detailEntry) }}</code>
                    </dd>
                </div>
            </dl>

            <template #footer>
                <button class="nx-button" type="button" @click="closeDetails">关闭</button>
            </template>
        </BaseDialog>
    </div>
</template>

<script setup>
    import { computed, onMounted, onUnmounted, ref } from 'vue';
    import { notifyError, notifySuccess } from '../../services/notify';
    import BaseDialog from '../ui/BaseDialog.vue';
    import ContextMenu from '../ui/ContextMenu.vue';

    const entries = ref([]);
    const loading = ref(false);
    const error = ref('');
    const contextMenu = ref({ visible: false, x: 0, y: 0 });
    const contextEntry = ref(null);
    const detailEntry = ref(null);

    const sourceLabel = computed(() => entries.value[0]?.sourcePath || '~/.ssh/known_hosts');

    function hostSummary(entry) {
        const parts = [];
        if (entry.keyType) parts.push(entry.keyType);
        if (entry.lineNumber) parts.push(`第 ${entry.lineNumber} 行`);
        return parts.join(' · ') || 'SSH 主机密钥';
    }

    function keyDetail(entry) {
        const parts = [];
        if (entry.keyType) parts.push(entry.keyType);
        if (entry.marker) parts.push(entry.marker);
        return parts.join(' · ') || '-';
    }

    function sourceDetail(entry) {
        const source = entry.sourcePath || '~/.ssh/known_hosts';
        return entry.lineNumber ? `${source}:${entry.lineNumber}` : source;
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
        if (!window.knownHostsApi?.list) {
            error.value = '当前环境不支持 Known Host 管理';
            return;
        }
        loading.value = true;
        error.value = '';
        try {
            const res = await window.knownHostsApi.list();
            if (res.status !== 'success') {
                error.value = res.msg || '读取 Known Host 失败';
                return;
            }
            entries.value = Array.isArray(res.data) ? res.data : [];
            if (detailEntry.value && !entries.value.some(entry => entry.id === detailEntry.value.id)) {
                detailEntry.value = null;
            }
        } catch (err) {
            error.value = err?.message || '读取 Known Host 失败';
        } finally {
            loading.value = false;
        }
    }

    async function removeEntry(entry) {
        if (!entry || !window.knownHostsApi?.remove) return;
        const res = await window.knownHostsApi.remove({ id: entry.id });
        if (res.status !== 'success') {
            notifyError(res.msg || '删除主机指纹失败');
            return;
        }
        notifySuccess('主机指纹记录已删除，下一次连接会重新信任当前指纹');
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
    .known-hosts__head,
    .known-host__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }
    .known-hosts__head {
        padding: 12px 0;
    }
    .known-hosts__head strong,
    .known-host__main strong {
        display: block;
        font-size: 12px;
    }
    .known-hosts__head span,
    .known-host__main span {
        display: block;
        margin-top: 3px;
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    .known-host {
        margin-top: 6px;
        border: 1px solid var(--nx-border-soft);
        border-radius: 7px;
        background: var(--nx-control-muted);
        cursor: default;
    }
    .known-host.selected {
        border-color: var(--nx-accent-border);
        background: var(--nx-accent-softer);
    }
    .known-host__row {
        min-height: 34px;
        padding: 6px 8px;
    }
    .known-hosts__head .nx-button {
        flex: 0 0 auto;
        white-space: nowrap;
    }
    .known-host__main {
        min-width: 0;
        display: grid;
        gap: 3px;
    }
    .known-host__main strong,
    .known-host__main span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .known-host__detail {
        display: grid;
        gap: 7px;
        margin: 0;
        max-height: min(360px, 62vh);
        overflow-y: auto;
        padding: 14px 16px;
    }
    .known-host__detail div {
        min-width: 0;
    }
    .known-host__detail dt {
        color: var(--nx-text-dim);
        font-size: 10px;
    }
    .known-host__detail dd {
        min-width: 0;
        margin: 2px 0 0;
        color: var(--nx-text);
        font-size: 11px;
    }
    .known-host__detail code {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--nx-text-dim);
        font-family: var(--nx-font-mono);
        font-size: 11px;
    }
    .known-hosts__empty {
        padding: 11px 10px;
        border: 1px dashed var(--nx-border);
        border-radius: 7px;
        color: var(--nx-text-dim);
        font-size: 12px;
    }
    .known-hosts__empty.error {
        border-color: var(--nx-danger);
        color: var(--nx-danger);
        background: var(--nx-danger-soft);
    }

    @media (max-width: 760px) {
        .known-hosts__head {
            align-items: stretch;
            flex-direction: column;
        }
        .known-hosts__head .nx-button {
            width: 100%;
        }
    }
</style>
