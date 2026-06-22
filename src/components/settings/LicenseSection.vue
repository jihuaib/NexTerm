<template>
    <div class="nx-settings license-section">
        <section class="nx-group">
            <div class="nx-group__head">
                <h3>授权状态</h3>
                <p>未激活可试用 30 天，过期后需要导入授权文件。</p>
            </div>

            <div class="license-summary">
                <div class="license-summary__item">
                    <span>状态</span>
                    <strong>{{ statusText }}</strong>
                </div>
                <div class="license-summary__item">
                    <span>{{ store.license.status === 'active' ? '授权有效期' : '试用剩余' }}</span>
                    <strong>{{ remainingText }}</strong>
                </div>
                <div class="license-summary__item">
                    <span>版本</span>
                    <strong>{{ editionText }}</strong>
                </div>
            </div>

            <div v-if="store.license.msg" class="license-note" :class="statusTone">{{ store.license.msg }}</div>
            <div v-if="store.license.licenseError" class="license-note warn">{{ store.license.licenseError }}</div>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>离线激活</h3>
                <p>先导出激活请求文件，在授权端签发后，把授权文件导入本机。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">机器码</div>
                    <div class="nx-row__desc">授权文件会绑定到这台机器。</div>
                </div>
                <div class="nx-row__control nx-row__control--stack license-machine">
                    <input class="nx-input nx-input--mono" readonly :value="store.license.machineId || ''" />
                    <button type="button" class="nx-button" @click="copyMachineId">复制机器码</button>
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">激活请求</div>
                    <div class="nx-row__desc">用于在离线授权端生成授权文件。</div>
                </div>
                <div class="nx-row__control license-actions">
                    <button type="button" class="nx-button" @click="copyRequest">复制请求</button>
                    <button type="button" class="nx-button" @click="exportRequest">保存请求文件</button>
                </div>
            </div>

            <textarea
                v-model="licenseText"
                class="license-text"
                placeholder="粘贴 license.json 内容后点击导入授权"
                spellcheck="false"
            />

            <div class="license-actions license-actions--end">
                <button type="button" class="nx-button" @click="refresh">刷新状态</button>
                <button v-if="store.license.status === 'active'" type="button" class="nx-button danger" @click="removeLicense">
                    移除授权
                </button>
                <button type="button" class="nx-button" @click="importFile">选择授权文件</button>
                <button type="button" class="nx-button primary" :disabled="!licenseText.trim()" @click="importText">
                    导入授权
                </button>
            </div>
        </section>

        <section v-if="store.license.license" class="nx-group">
            <div class="nx-group__head">
                <h3>授权信息</h3>
                <p>当前导入授权文件的摘要。</p>
            </div>
            <dl class="license-detail">
                <div>
                    <dt>授权 ID</dt>
                    <dd>{{ store.license.license.licenseId || '-' }}</dd>
                </div>
                <div>
                    <dt>授权对象</dt>
                    <dd>{{ store.license.license.subject || '-' }}</dd>
                </div>
                <div>
                    <dt>功能</dt>
                    <dd>{{ featureText }}</dd>
                </div>
            </dl>
        </section>
    </div>
</template>

<script setup>
    import { computed, onMounted, ref } from 'vue';
    import { store, refreshLicenseStatus } from '../../store';
    import { notifyError, notifySuccess } from '../../services/notify';

    const licenseText = ref('');

    const statusText = computed(() => {
        if (store.license.status === 'active') return '已激活';
        if (store.license.status === 'trial') return '试用中';
        if (store.license.status === 'time-error') return '时间异常';
        if (store.license.status === 'expired') return '试用已到期';
        return '读取中';
    });
    const statusTone = computed(() => {
        if (store.license.status === 'active') return 'ok';
        if (store.license.status === 'trial') return 'info';
        return 'warn';
    });
    const remainingText = computed(() => {
        if (store.license.status === 'active') {
            const expiresAt = store.license.license?.expiresAt;
            return expiresAt ? new Date(expiresAt).toLocaleDateString() : '永久';
        }
        return `${Number(store.license.daysRemaining ?? 0)} 天`;
    });
    const editionText = computed(() => store.license.license?.edition || (store.license.status === 'active' ? 'Pro' : '试用版'));
    const featureText = computed(() => {
        const features = store.license.license?.features;
        if (!Array.isArray(features) || features.length === 0) return '-';
        return features.includes('*') ? '全部功能' : features.join(', ');
    });

    async function refresh() {
        await refreshLicenseStatus();
    }

    async function writeClipboard(text) {
        if (window.clipboardApi?.writeText) await window.clipboardApi.writeText(text);
        else await navigator.clipboard.writeText(text);
    }

    async function copyMachineId() {
        await writeClipboard(store.license.machineId || '');
        notifySuccess('机器码已复制');
    }

    async function activationRequest() {
        const res = await window.licenseApi.request();
        if (res.status !== 'success') throw new Error(res.msg || '生成激活请求失败');
        return res.data;
    }

    async function copyRequest() {
        try {
            const request = await activationRequest();
            await writeClipboard(JSON.stringify(request, null, 2));
            notifySuccess('激活请求已复制');
        } catch (err) {
            notifyError(err?.message || '复制激活请求失败');
        }
    }

    async function exportRequest() {
        const res = await window.licenseApi.exportRequest();
        if (res.status !== 'success') {
            notifyError(res.msg || '保存激活请求失败');
            return;
        }
        if (!res.data?.canceled) notifySuccess('激活请求文件已保存');
    }

    async function importText() {
        const res = await window.licenseApi.importText(licenseText.value);
        if (res.status !== 'success') {
            notifyError(res.msg || '导入授权失败');
            return;
        }
        store.license = res.data;
        licenseText.value = '';
        notifySuccess('授权已导入');
    }

    async function importFile() {
        const res = await window.licenseApi.importFile();
        if (res.status !== 'success') {
            notifyError(res.msg || '导入授权文件失败');
            return;
        }
        if (!res.data?.canceled) {
            store.license = res.data.status;
            notifySuccess('授权已导入');
        }
    }

    async function removeLicense() {
        const res = await window.licenseApi.remove();
        if (res.status !== 'success') {
            notifyError(res.msg || '移除授权失败');
            return;
        }
        store.license = res.data;
        notifySuccess('授权已移除');
    }

    onMounted(refresh);
</script>

<style scoped>
    .license-summary {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
    }
    .license-summary__item {
        border: 1px solid var(--nx-border);
        background: var(--nx-surface-2);
        border-radius: 8px;
        padding: 10px;
    }
    .license-summary__item span {
        display: block;
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    .license-summary__item strong {
        display: block;
        margin-top: 5px;
        font-size: 14px;
    }
    .license-note {
        margin-top: 10px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        padding: 8px 10px;
        font-size: 12px;
    }
    .license-note.ok {
        color: #34d399;
    }
    .license-note.info {
        color: #38bdf8;
    }
    .license-note.warn {
        color: #fbbf24;
    }
    .license-machine {
        width: min(430px, 100%);
    }
    .license-actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        flex-wrap: wrap;
    }
    .license-actions--end {
        margin-top: 8px;
    }
    .license-text {
        width: 100%;
        min-height: 118px;
        resize: vertical;
        border: 1px solid var(--nx-border);
        border-radius: 8px;
        padding: 10px;
        background: var(--nx-bg);
        color: var(--nx-text);
        font-family: var(--nx-font-mono);
        font-size: 12px;
        outline: none;
    }
    .license-text:focus {
        border-color: var(--nx-accent);
    }
    .license-detail {
        display: grid;
        gap: 8px;
        margin: 0;
    }
    .license-detail div {
        display: grid;
        grid-template-columns: 92px minmax(0, 1fr);
        gap: 10px;
        font-size: 12px;
    }
    .license-detail dt {
        color: var(--nx-text-dim);
    }
    .license-detail dd {
        min-width: 0;
        margin: 0;
        overflow-wrap: anywhere;
    }
    .nx-button.primary {
        border-color: var(--nx-accent);
        background: var(--nx-accent);
        color: var(--nx-accent-text);
    }
    .nx-input--mono {
        width: 100%;
        font-family: var(--nx-font-mono);
        font-size: 11px;
    }
</style>
