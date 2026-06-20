<template>
    <BaseDialog
        :title="session ? '编辑会话' : '新建会话'"
        :subtitle="dialogSubtitle"
        width="460px"
        @close="$emit('close')"
    >
        <div class="session-type">
            <SegmentedTabs v-model="form.protocol" :tabs="sessionTypes" aria-label="会话类型" />
        </div>

        <div class="session-form-body">
            <div class="form-grid common-grid">
                <label>
                    <span>名称</span>
                    <input
                        v-model="form.name"
                        :placeholder="isLocal ? '可选，默认显示 Local Shell' : '可选，默认使用主机地址'"
                    />
                </label>

                <label>
                    <span>文件夹</span>
                    <select v-model="form.folderId">
                        <option :value="null">未分组</option>
                        <option v-for="folder in folderOptions" :key="folder.id" :value="folder.id">
                            {{ folder.label }}
                        </option>
                    </select>
                </label>
            </div>

            <div v-if="!isLocal" class="form-grid type-grid">
                <label :class="{ 'is-invalid': hasFieldError('host') }">
                    <span>主机</span>
                    <input
                        v-model="form.host"
                        placeholder="192.168.1.1 或 towel.blinkenlights.nl"
                        :aria-invalid="hasFieldError('host') ? 'true' : 'false'"
                        @input="clearFieldError('host')"
                    />
                </label>

                <label>
                    <span>端口</span>
                    <input v-model.number="form.port" type="number" min="1" max="65535" />
                </label>

                <template v-if="isSsh">
                    <label :class="{ 'is-invalid': hasFieldError('username') }">
                        <span>用户名</span>
                        <input
                            v-model="form.username"
                            placeholder="root 或远程用户"
                            :aria-invalid="hasFieldError('username') ? 'true' : 'false'"
                            @input="clearFieldError('username')"
                        />
                    </label>

                    <label>
                        <span>认证</span>
                        <select v-model="form.authType">
                            <option value="password">密码</option>
                            <option value="key">私钥</option>
                            <option value="agent">SSH Agent / 免密</option>
                        </select>
                    </label>

                    <label v-if="form.authType !== 'agent'">
                        <span>凭据处理</span>
                        <select v-model="form.credentialSaveMode">
                            <option value="prompt">每次询问</option>
                            <option value="session">本次会话保留</option>
                        </select>
                    </label>

                    <div v-if="form.authType === 'password'" class="credential-note wide">
                        {{ credentialModeDescription }}
                    </div>

                    <template v-else-if="form.authType === 'key'">
                        <label class="wide" :class="{ 'is-invalid': hasFieldError('privateKeyPath') }">
                            <span>私钥路径</span>
                            <input
                                v-model="form.privateKeyPath"
                                placeholder="例如 ~/.ssh/id_rsa 或 /Users/me/.ssh/id_ed25519"
                                :aria-invalid="hasFieldError('privateKeyPath') ? 'true' : 'false'"
                                @input="clearFieldError('privateKeyPath')"
                            />
                        </label>
                        <div class="credential-note wide">{{ credentialModeDescription }}</div>
                    </template>
                </template>
            </div>

            <div v-else class="form-grid type-grid">
                <label class="wide">
                    <span>Shell</span>
                    <input
                        v-model="form.shell"
                        placeholder="默认使用系统 Shell，例如 /bin/zsh、powershell.exe、cmd.exe"
                    />
                </label>

                <label class="wide">
                    <span>工作目录</span>
                    <input v-model="form.cwd" placeholder="默认使用用户主目录" />
                </label>
            </div>
        </div>

        <template #footer>
            <button class="ghost" type="button" @click="$emit('close')">取消</button>
            <button class="primary" type="button" :disabled="submitting" @click="submit">
                {{ submitting ? '保存中' : '保存' }}
            </button>
        </template>
    </BaseDialog>
</template>

<script setup>
    import { computed, reactive, ref, watch } from 'vue';
    import { Server, SquareTerminal } from '@lucide/vue';
    import { getCreateFolderId, saveSession, store } from '../store';
    import {
        defaultPortForProtocol,
        isLocalSessionProtocol,
        isSshSessionProtocol,
        normalizeCredentialSaveMode
    } from '../models/resources';
    import { notifyError, notifySuccess } from '../services/notify';
    import { useFieldErrors } from '../utils/formErrors';
    import BaseDialog from './ui/BaseDialog.vue';
    import SegmentedTabs from './ui/SegmentedTabs.vue';

    const props = defineProps({
        session: { type: Object, default: null },
        folderId: { type: String, default: null }
    });
    const emit = defineEmits(['close']);

    const sessionTypes = [
        { value: 'telnet', label: 'Telnet', icon: Server },
        { value: 'ssh', label: 'SSH / SFTP', icon: Server },
        { value: 'local', label: 'Local Shell', icon: SquareTerminal }
    ];

    const folderOptions = computed(() => {
        const byId = new Map(store.sessionFolders.map(folder => [folder.id, folder]));
        function folderLabel(folder) {
            const names = [folder.name];
            let parent = folder.parentId ? byId.get(folder.parentId) : null;
            while (parent) {
                names.unshift(parent.name);
                parent = parent.parentId ? byId.get(parent.parentId) : null;
            }
            return names.join(' / ');
        }
        return store.sessionFolders.map(folder => ({
            id: folder.id,
            label: folderLabel(folder)
        }));
    });

    function initialFolderId() {
        if (props.session) return props.session.folderId || null;
        return props.folderId || getCreateFolderId();
    }

    const submitting = ref(false);
    const form = reactive({
        id: props.session?.id,
        name: props.session?.name || '',
        folderId: initialFolderId(),
        protocol: props.session?.protocol || store.settings.defaultProtocol,
        host: props.session?.host || '',
        port:
            props.session?.port ||
            defaultPortForProtocol(
                props.session?.protocol || store.settings.defaultProtocol,
                store.settings.defaultPort
            ),
        username: props.session?.username || '',
        authType: props.session?.authType || (props.session?.privateKeyPath ? 'key' : 'password'),
        credentialSaveMode: normalizeCredentialSaveMode(props.session?.credentialSaveMode),
        privateKeyPath: props.session?.privateKeyPath || '',
        shell: props.session?.shell || (!props.session ? store.settings.defaultLocalShell : ''),
        cwd: props.session?.cwd || (!props.session ? store.settings.defaultLocalCwd : ''),
        tags: Array.isArray(props.session?.tags) ? [...props.session.tags] : [],
        description: props.session?.description || ''
    });

    const isLocal = computed(() => isLocalSessionProtocol(form.protocol));
    const isSsh = computed(() => isSshSessionProtocol(form.protocol));
    const dialogSubtitle = computed(() => {
        if (isLocal.value) return '本地 Shell 会话配置';
        if (isSsh.value) return 'SSH 终端与 SFTP 文件配置';
        return 'Telnet 会话配置';
    });
    const credentialModeDescription = computed(() => {
        if (form.credentialSaveMode === 'session') {
            return '连接时输入的凭据只保留在当前终端标签内，关闭标签或重启应用后会重新询问。';
        }
        return '连接时询问凭据，不写入会话文件；每次新连接都会重新输入。';
    });
    const { setFieldError, clearFieldError, clearFieldErrors, hasFieldError } = useFieldErrors();

    watch(
        () => form.protocol,
        protocol => {
            clearFieldErrors();
            if (form.port === null || form.port === undefined || form.port === '') {
                form.port = defaultPortForProtocol(protocol, store.settings.defaultPort);
            }
            if (protocol === 'ssh' && (!form.port || Number(form.port) === store.settings.defaultPort)) {
                form.port = 22;
            }
            if (isLocalSessionProtocol(protocol)) {
                if (!form.shell) form.shell = store.settings.defaultLocalShell || '';
                if (!form.cwd) form.cwd = store.settings.defaultLocalCwd || '';
            }
        }
    );

    watch(
        () => form.authType,
        authType => {
            clearFieldErrors();
            if (authType === 'agent') form.credentialSaveMode = 'prompt';
        }
    );

    function buildPayload() {
        const base = {
            id: form.id,
            name: String(form.name || '').trim(),
            folderId: form.folderId || null,
            protocol: form.protocol,
            username: String(form.username || '').trim(),
            authType: form.authType,
            credentialSaveMode: isSsh.value ? normalizeCredentialSaveMode(form.credentialSaveMode) : 'prompt',
            privateKeyPath: String(form.privateKeyPath || '').trim(),
            tags: Array.isArray(form.tags) ? [...form.tags] : [],
            description: String(form.description || '')
        };

        if (isLocal.value) {
            return {
                ...base,
                host: '',
                port: null,
                shell: String(form.shell || '').trim(),
                cwd: String(form.cwd || '').trim()
            };
        }

        return {
            ...base,
            host: String(form.host || '').trim(),
            port: Number(form.port) || defaultPortForProtocol(form.protocol, store.settings.defaultPort),
            shell: '',
            cwd: ''
        };
    }

    async function submit() {
        if (submitting.value) return;
        clearFieldErrors();

        const payload = buildPayload();
        if (!isLocal.value && !payload.host) {
            setFieldError('host', '请填写主机地址');
            notifyError('请填写主机地址', '表单输入错误');
            return;
        }
        if (isSsh.value && !payload.username) {
            setFieldError('username', '请填写 SSH 用户名');
            notifyError('请填写 SSH 用户名', '表单输入错误');
            return;
        }
        if (isSsh.value && payload.authType === 'key' && !payload.privateKeyPath) {
            setFieldError('privateKeyPath', '请填写私钥路径');
            notifyError('请填写私钥路径', '表单输入错误');
            return;
        }
        submitting.value = true;
        try {
            const res = await saveSession(payload);
            if (res.status === 'success') {
                notifySuccess('会话已保存');
                emit('close');
            } else {
                notifyError(res.msg || '保存失败');
            }
        } catch (err) {
            notifyError(err?.message || String(err), '保存失败');
        } finally {
            submitting.value = false;
        }
    }
</script>

<style scoped>
    .form-grid {
        display: grid;
        grid-template-columns: 1fr 128px;
        gap: 14px;
        padding: 0 18px;
    }
    .session-type {
        display: flex;
        padding: 18px 18px 16px;
        border-bottom: 1px solid var(--nx-border-softer);
    }
    .session-form-body {
        height: min(252px, calc(100vh - 250px));
        min-height: 220px;
        overflow-y: auto;
        overscroll-behavior: contain;
    }
    .common-grid {
        padding-top: 18px;
    }
    .type-grid {
        padding-top: 14px;
        padding-bottom: 18px;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        color: var(--nx-text-dim);
    }
    label.wide {
        grid-column: 1 / -1;
    }
    label span {
        font-size: 12px;
    }
    label.is-invalid span {
        color: var(--nx-danger);
    }
    label small {
        color: var(--nx-danger);
        font-size: 11px;
    }
    .credential-note {
        grid-column: 1 / -1;
        padding: 9px 10px;
        border: 1px solid var(--nx-border-soft);
        border-radius: 7px;
        background: var(--nx-control-muted);
        color: var(--nx-text-dim);
        font-size: 12px;
        line-height: 1.45;
    }
    input,
    select {
        width: 100%;
        height: 34px;
        padding: 0 10px;
        background: var(--nx-bg);
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        color: var(--nx-text);
        outline: none;
    }
    input:focus,
    select:focus {
        border-color: var(--nx-accent);
    }
    label.is-invalid input,
    label.is-invalid select {
        border-color: var(--nx-danger);
        background: var(--nx-danger-soft);
        box-shadow: 0 0 0 2px var(--nx-danger-ring);
    }
    label.is-invalid input:focus,
    label.is-invalid select:focus {
        border-color: var(--nx-danger);
    }
    button {
        height: 32px;
        min-width: 72px;
        padding: 0 14px;
        border-radius: 7px;
        cursor: pointer;
        border: 1px solid var(--nx-border);
    }
    .ghost {
        background: var(--nx-surface-2);
        color: var(--nx-text);
    }
    .primary {
        background: var(--nx-accent);
        color: var(--nx-accent-text);
        border-color: var(--nx-accent);
    }
    .ghost:hover {
        border-color: var(--nx-text-dim);
    }
    .primary:hover {
        filter: brightness(1.06);
    }
    button:disabled {
        cursor: not-allowed;
        opacity: 0.62;
    }

    @media (max-width: 520px) {
        .session-form-body {
            height: min(420px, calc(100vh - 230px));
        }
        .form-grid {
            grid-template-columns: 1fr;
        }
        label.wide {
            grid-column: auto;
        }
    }
</style>
