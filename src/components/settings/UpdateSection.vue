<template>
    <div class="nx-settings update-section">
        <section class="nx-group">
            <div class="nx-group__head">
                <h3>版本</h3>
                <p>当前应用版本与更新状态。</p>
            </div>

            <div class="update-summary">
                <div class="update-summary__item">
                    <span>当前版本</span>
                    <strong>{{ currentVersion }}</strong>
                </div>
                <div class="update-summary__item">
                    <span>更新状态</span>
                    <strong>{{ updateStatusText }}</strong>
                </div>
            </div>

            <div v-if="isDownloading" class="update-progress">
                <div class="update-progress__line">
                    <span>下载中</span>
                    <strong>{{ downloadPercent }}%</strong>
                </div>
                <div class="update-progress__bar">
                    <i :style="{ width: downloadPercent + '%' }" />
                </div>
            </div>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>操作</h3>
                <p>手动检查版本，发现更新后下载并重启安装。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">检查更新</div>
                    <div class="nx-row__desc">{{ latestVersionText }}</div>
                </div>
                <div class="nx-row__control update-actions">
                    <button
                        class="nx-button"
                        type="button"
                        :disabled="isChecking || isDownloading"
                        @click="checkForUpdates"
                    >
                        <RefreshCw :size="14" :stroke-width="2" />
                        {{ isChecking ? '检查中' : '检查更新' }}
                    </button>
                    <button class="nx-button" type="button" :disabled="!canDownload" @click="downloadUpdate">
                        <Download :size="14" :stroke-width="2" />
                        下载更新
                    </button>
                    <button
                        class="nx-button nx-button--danger"
                        type="button"
                        :disabled="!updateDownloaded"
                        @click="installUpdate"
                    >
                        <RotateCcw :size="14" :stroke-width="2" />
                        重启安装
                    </button>
                </div>
            </div>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>自动更新</h3>
                <p>发现更新后可自动下载，安装仍由用户确认。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">启动时检查更新</div>
                    <div class="nx-row__desc">打包应用启动后自动检查 GitHub Release</div>
                </div>
                <div class="nx-row__control">
                    <button
                        class="nx-toggle"
                        :class="{ on: s.updateAutoCheckOnStartup }"
                        :aria-pressed="s.updateAutoCheckOnStartup ? 'true' : 'false'"
                        @click="update({ updateAutoCheckOnStartup: !s.updateAutoCheckOnStartup })"
                    />
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">自动下载更新</div>
                    <div class="nx-row__desc">发现新版本后自动下载，安装仍需手动确认</div>
                </div>
                <div class="nx-row__control">
                    <button
                        class="nx-toggle"
                        :class="{ on: s.updateAutoDownload }"
                        :aria-pressed="s.updateAutoDownload ? 'true' : 'false'"
                        @click="update({ updateAutoDownload: !s.updateAutoDownload })"
                    />
                </div>
            </div>
        </section>
    </div>
</template>

<script setup>
    import { computed, onMounted, onUnmounted, ref } from 'vue';
    import { Download, RefreshCw, RotateCcw } from '@lucide/vue';
    import { eventBus } from '../../utils/eventBus';
    import { store, updateSettings } from '../../store';
    import { notify, notifyError, notifySuccess } from '../../services/notify';

    const s = store.settings;
    const currentVersion = ref('读取中');
    const latestVersion = ref('');
    const updateStatusText = ref('未检查');
    const updateAvailable = ref(false);
    const updateDownloaded = ref(false);
    const isChecking = ref(false);
    const isDownloading = ref(false);
    const downloadProgress = ref({ percent: 0 });

    const downloadPercent = computed(() => Math.min(100, Math.max(0, Math.round(downloadProgress.value.percent || 0))));
    const canDownload = computed(() => updateAvailable.value && !isDownloading.value && !updateDownloaded.value);
    const latestVersionText = computed(() =>
        latestVersion.value ? `发现版本 ${latestVersion.value}` : '检查 GitHub Release 中的最新版本'
    );

    function update(patch) {
        updateSettings(patch);
    }

    function getResponseData(resp) {
        if (!resp) return null;
        if (resp.status === 'success') return resp.data;
        return resp;
    }

    async function loadCurrentVersion() {
        try {
            if (!window.updaterApi?.getCurrentVersion) {
                currentVersion.value = '未知';
                return;
            }
            const resp = await window.updaterApi.getCurrentVersion();
            const data = getResponseData(resp);
            currentVersion.value = typeof data === 'string' ? data : '未知';
        } catch (_err) {
            currentVersion.value = '未知';
        }
    }

    async function checkForUpdates() {
        if (!window.updaterApi?.checkForUpdates) {
            notifyError('当前环境不支持更新检查');
            return;
        }
        isChecking.value = true;
        updateStatusText.value = '检查中';
        try {
            const resp = await window.updaterApi.checkForUpdates();
            if (resp?.status !== 'success') {
                updateStatusText.value = '检查失败';
                return;
            }
            const info = resp.data?.updateInfo;
            if (info?.version) latestVersion.value = info.version;
        } catch (err) {
            updateStatusText.value = '检查失败';
            notifyError(err?.message || '检查更新失败');
        } finally {
            isChecking.value = false;
        }
    }

    async function downloadUpdate() {
        if (!window.updaterApi?.downloadUpdate) {
            notifyError('当前环境不支持更新下载');
            return;
        }
        try {
            const resp = await window.updaterApi.downloadUpdate();
            if (resp?.status !== 'success') notifyError(resp?.msg || '下载更新失败');
        } catch (err) {
            notifyError(err?.message || '下载更新失败');
        }
    }

    async function installUpdate() {
        if (!window.updaterApi?.quitAndInstall) {
            notifyError('当前环境不支持更新安装');
            return;
        }
        try {
            const resp = await window.updaterApi.quitAndInstall();
            if (resp?.status !== 'success') notifyError(resp?.msg || '安装更新失败');
        } catch (err) {
            notifyError(err?.message || '安装更新失败');
        }
    }

    function handleUpdateStatus(payload = {}) {
        const wrapped = payload.status === 'success' ? payload.data : payload;
        const { type, data = {} } = wrapped || {};

        switch (type) {
            case 'checking-for-update':
                isChecking.value = true;
                updateStatusText.value = '检查中';
                break;
            case 'update-available':
                isChecking.value = false;
                updateAvailable.value = true;
                updateDownloaded.value = false;
                latestVersion.value = data.version || latestVersion.value;
                updateStatusText.value = data.version ? `发现新版本 ${data.version}` : '发现新版本';
                notify({ type: 'info', message: updateStatusText.value, duration: 3600 });
                break;
            case 'update-not-available':
                isChecking.value = false;
                updateAvailable.value = false;
                updateDownloaded.value = false;
                updateStatusText.value = '已是最新版本';
                notifySuccess('当前已是最新版本');
                break;
            case 'download-started':
                isDownloading.value = true;
                downloadProgress.value = { percent: 0 };
                updateStatusText.value = '下载中';
                break;
            case 'download-progress':
                isDownloading.value = true;
                downloadProgress.value = data;
                updateStatusText.value = `下载中 ${downloadPercent.value}%`;
                break;
            case 'update-downloaded':
                isDownloading.value = false;
                updateDownloaded.value = true;
                updateStatusText.value = '下载完成';
                notifySuccess('更新下载完成，可以重启安装');
                break;
            case 'update-error':
                isChecking.value = false;
                isDownloading.value = false;
                updateStatusText.value = '更新失败';
                notifyError(data.error || '更新过程中发生错误');
                break;
        }
    }

    let offUpdater = null;

    onMounted(() => {
        loadCurrentVersion();
        offUpdater = eventBus.on('updater:update-status', handleUpdateStatus);
    });

    onUnmounted(() => {
        if (offUpdater) offUpdater();
    });
</script>

<style scoped>
    .update-summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        padding: 14px 0 10px;
    }
    .update-summary__item {
        min-width: 0;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-surface-2);
        padding: 12px;
    }
    .update-summary__item span {
        display: block;
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    .update-summary__item strong {
        display: block;
        margin-top: 6px;
        font-size: 16px;
        color: var(--nx-text);
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .update-actions {
        flex-wrap: wrap;
    }
    .update-actions .nx-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
    .nx-button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
    .nx-button--danger:not(:disabled):hover {
        border-color: var(--nx-danger);
        color: var(--nx-danger);
    }
    .update-progress {
        margin: 4px 0 12px;
    }
    .update-progress__line {
        display: flex;
        justify-content: space-between;
        color: var(--nx-text-dim);
        font-size: 11px;
        margin-bottom: 6px;
    }
    .update-progress__bar {
        height: 7px;
        border-radius: 999px;
        overflow: hidden;
        background: var(--nx-border);
    }
    .update-progress__bar i {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: var(--nx-accent);
        transition: width 0.18s;
    }

    @media (max-width: 760px) {
        .update-summary {
            grid-template-columns: 1fr;
        }
    }
</style>
