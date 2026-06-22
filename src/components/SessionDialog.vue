<template>
    <BaseDialog
        :title="session ? '编辑会话' : '新建会话'"
        :subtitle="dialogSubtitle"
        width="580px"
        @close="$emit('close')"
    >
        <div class="session-type">
            <SegmentedTabs v-model="form.protocol" :tabs="sessionTypes" aria-label="会话类型" />
        </div>

        <div class="session-form-body">
            <div class="form-grid common-grid">
                <label>
                    <span>名称</span>
                    <input v-model="form.name" :placeholder="namePlaceholder" />
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

            <div v-if="isNetwork" class="form-grid type-grid">
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
                            <option value="session">本次标签保留</option>
                            <option value="persist">永久保存</option>
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

            <div v-else-if="isLocal" class="form-grid type-grid">
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

            <div v-else class="form-grid type-grid">
                <label class="wide serial-path-field" :class="{ 'is-invalid': hasFieldError('serialPath') }">
                    <div class="serial-field-head">
                        <span>串口设备</span>
                        <button
                            class="serial-refresh"
                            type="button"
                            title="刷新串口列表"
                            :disabled="serialPortsLoading"
                            @click="loadSerialPorts"
                        >
                            <RefreshCw :size="14" :stroke-width="2" />
                        </button>
                    </div>
                    <select
                        v-model="form.serialPath"
                        :disabled="serialPortsLoading"
                        @change="clearFieldError('serialPath')"
                    >
                        <option value="">选择串口</option>
                        <option
                            v-if="form.serialPath && !serialPortOptions.some(port => port.path === form.serialPath)"
                            :value="form.serialPath"
                        >
                            {{ form.serialPath }}
                        </option>
                        <option v-for="port in serialPortOptions" :key="port.path" :value="port.path">
                            {{ port.label || port.path }}
                        </option>
                    </select>
                    <input
                        v-model="form.serialPath"
                        placeholder="macOS: /dev/tty.usbserial-*，Windows: COM3"
                        :aria-invalid="hasFieldError('serialPath') ? 'true' : 'false'"
                        @input="clearFieldError('serialPath')"
                    />
                    <small v-if="serialPortsError">{{ serialPortsError }}</small>
                </label>

                <label>
                    <span>波特率</span>
                    <input v-model.number="form.serialBaudRate" type="number" min="1" step="1" />
                </label>

                <label>
                    <span>数据位</span>
                    <select v-model.number="form.serialDataBits">
                        <option :value="5">5</option>
                        <option :value="6">6</option>
                        <option :value="7">7</option>
                        <option :value="8">8</option>
                    </select>
                </label>

                <label>
                    <span>停止位</span>
                    <select v-model.number="form.serialStopBits">
                        <option :value="1">1</option>
                        <option :value="2">2</option>
                    </select>
                </label>

                <label>
                    <span>校验</span>
                    <select v-model="form.serialParity">
                        <option value="none">None</option>
                        <option value="even">Even</option>
                        <option value="odd">Odd</option>
                        <option value="mark">Mark</option>
                        <option value="space">Space</option>
                    </select>
                </label>

                <label class="wide">
                    <span>流控</span>
                    <select v-model="form.serialFlowControl">
                        <option value="none">无</option>
                        <option value="hardware">硬件 RTS/CTS</option>
                        <option value="software">软件 XON/XOFF</option>
                    </select>
                </label>

                <label class="serial-check">
                    <input v-model="form.serialDtr" type="checkbox" />
                    <span>DTR</span>
                </label>

                <label class="serial-check">
                    <input v-model="form.serialRts" type="checkbox" />
                    <span>RTS</span>
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
    import { computed, onMounted, reactive, ref, watch } from 'vue';
    import { Cable, RefreshCw, Server, SquareTerminal } from '@lucide/vue';
    import { getCreateFolderId, saveSession, store } from '../store';
    import {
        defaultPortForProtocol,
        isLocalSessionProtocol,
        isSerialSessionProtocol,
        isSshSessionProtocol,
        getProtocolColorOption,
        getProtocolSessionColor,
        normalizeCredentialSaveMode,
        normalizeSerialBoolean,
        normalizeSerialFlowControl,
        normalizeSerialNumber,
        normalizeSerialParity
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

    function protocolStyle(protocol) {
        const color = getProtocolColorOption(protocol);
        return {
            '--segmented-tab-color': color.swatch,
            '--segmented-tab-bg': color.bg,
            '--segmented-tab-border': color.border,
            '--protocol-color': color.swatch,
            '--protocol-color-bg': color.bg,
            '--protocol-color-border': color.border
        };
    }

    const sessionTypes = [
        { value: 'telnet', label: 'Telnet', icon: Server, style: protocolStyle('telnet') },
        { value: 'ssh', label: 'SSH / SFTP', icon: Server, style: protocolStyle('ssh') },
        { value: 'serial', label: 'Serial', icon: Cable, style: protocolStyle('serial') },
        { value: 'local', label: 'Local Shell', icon: SquareTerminal, style: protocolStyle('local') }
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

    function initialProtocol() {
        return props.session?.protocol || store.settings.defaultProtocol;
    }

    const submitting = ref(false);
    const serialPorts = ref([]);
    const serialPortsLoading = ref(false);
    const serialPortsError = ref('');
    const form = reactive({
        id: props.session?.id,
        name: props.session?.name || '',
        folderId: initialFolderId(),
        protocol: initialProtocol(),
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
        serialPath: props.session?.serialPath || '',
        serialBaudRate: normalizeSerialNumber(
            props.session?.serialBaudRate,
            store.settings.defaultSerialBaudRate || 115200
        ),
        serialDataBits: normalizeSerialNumber(
            props.session?.serialDataBits,
            store.settings.defaultSerialDataBits || 8,
            [5, 6, 7, 8]
        ),
        serialStopBits: normalizeSerialNumber(props.session?.serialStopBits, store.settings.defaultSerialStopBits || 1, [
            1,
            2
        ]),
        serialParity: normalizeSerialParity(props.session?.serialParity || store.settings.defaultSerialParity),
        serialFlowControl: normalizeSerialFlowControl(
            props.session?.serialFlowControl || store.settings.defaultSerialFlowControl
        ),
        serialDtr: normalizeSerialBoolean(props.session?.serialDtr, store.settings.defaultSerialDtr),
        serialRts: normalizeSerialBoolean(props.session?.serialRts, store.settings.defaultSerialRts),
        tags: Array.isArray(props.session?.tags) ? [...props.session.tags] : [],
        description: props.session?.description || ''
    });

    const isLocal = computed(() => isLocalSessionProtocol(form.protocol));
    const isSsh = computed(() => isSshSessionProtocol(form.protocol));
    const isSerial = computed(() => isSerialSessionProtocol(form.protocol));
    const isNetwork = computed(() => !isLocal.value && !isSerial.value);
    const serialPortOptions = computed(() => serialPorts.value);
    const namePlaceholder = computed(() => {
        if (isLocal.value) return '可选，默认显示 Local Shell';
        if (isSerial.value) return '可选，默认显示串口设备';
        return '可选，默认使用主机地址';
    });
    const dialogSubtitle = computed(() => {
        if (isLocal.value) return '本地 Shell 会话配置';
        if (isSerial.value) return '串口终端配置';
        if (isSsh.value) return 'SSH 终端与 SFTP 文件配置';
        return 'Telnet 会话配置';
    });
    const credentialModeDescription = computed(() => {
        const saved =
            form.authType === 'key' ? props.session?.hasSavedPassphrase : props.session?.hasSavedPassword;
        if (form.credentialSaveMode === 'persist') {
            return saved
                ? '已加密保存到本机，之后打开该会话会自动使用；会话文件不保存明文。'
                : '首次连接成功后加密保存到本机，之后打开该会话会自动使用；会话文件不保存明文。';
        }
        if (form.credentialSaveMode === 'session') {
            return '连接时输入的凭据只保留在当前终端标签内，关闭标签或重启应用后会重新询问。';
        }
        return '连接时询问凭据，不写入会话文件；每次新连接都会重新输入。';
    });
    const { setFieldError, clearFieldError, clearFieldErrors, hasFieldError } = useFieldErrors();

    async function loadSerialPorts() {
        if (!window.terminalApi?.listSerialPorts) {
            serialPortsError.value = '当前环境不支持串口枚举';
            return;
        }
        serialPortsLoading.value = true;
        serialPortsError.value = '';
        try {
            const res = await window.terminalApi.listSerialPorts();
            if (res.status === 'success') {
                serialPorts.value = Array.isArray(res.data) ? res.data : [];
                if (!form.serialPath && serialPorts.value[0]?.path) form.serialPath = serialPorts.value[0].path;
            } else {
                serialPortsError.value = res.msg || '串口列表读取失败';
            }
        } catch (err) {
            serialPortsError.value = err?.message || String(err);
        } finally {
            serialPortsLoading.value = false;
        }
    }

    onMounted(() => {
        if (isSerial.value) loadSerialPorts();
    });

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
            if (isSerialSessionProtocol(protocol)) {
                form.serialBaudRate = form.serialBaudRate || store.settings.defaultSerialBaudRate || 115200;
                form.serialDataBits = normalizeSerialNumber(
                    form.serialDataBits,
                    store.settings.defaultSerialDataBits || 8,
                    [5, 6, 7, 8]
                );
                form.serialStopBits = normalizeSerialNumber(form.serialStopBits, store.settings.defaultSerialStopBits || 1, [
                    1,
                    2
                ]);
                form.serialParity = normalizeSerialParity(form.serialParity || store.settings.defaultSerialParity);
                form.serialFlowControl = normalizeSerialFlowControl(
                    form.serialFlowControl || store.settings.defaultSerialFlowControl
                );
                form.serialDtr = normalizeSerialBoolean(form.serialDtr, store.settings.defaultSerialDtr);
                form.serialRts = normalizeSerialBoolean(form.serialRts, store.settings.defaultSerialRts);
                loadSerialPorts();
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
            color: getProtocolSessionColor(form.protocol),
            folderId: form.folderId || null,
            protocol: form.protocol,
            username: String(form.username || '').trim(),
            authType: form.authType,
            credentialSaveMode: isSsh.value ? normalizeCredentialSaveMode(form.credentialSaveMode) : 'prompt',
            privateKeyPath: String(form.privateKeyPath || '').trim(),
            serialPath: String(form.serialPath || '').trim(),
            serialBaudRate: normalizeSerialNumber(form.serialBaudRate, store.settings.defaultSerialBaudRate || 115200),
            serialDataBits: normalizeSerialNumber(form.serialDataBits, store.settings.defaultSerialDataBits || 8, [
                5,
                6,
                7,
                8
            ]),
            serialStopBits: normalizeSerialNumber(form.serialStopBits, store.settings.defaultSerialStopBits || 1, [1, 2]),
            serialParity: normalizeSerialParity(form.serialParity),
            serialFlowControl: normalizeSerialFlowControl(form.serialFlowControl),
            serialDtr: normalizeSerialBoolean(form.serialDtr, store.settings.defaultSerialDtr),
            serialRts: normalizeSerialBoolean(form.serialRts, store.settings.defaultSerialRts),
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
        if (isNetwork.value && !payload.host) {
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
        if (isSerial.value && !payload.serialPath) {
            setFieldError('serialPath', '请选择串口设备');
            notifyError('请选择串口设备', '表单输入错误');
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
        grid-template-columns: minmax(0, 1fr) 160px;
        gap: 14px;
        padding: 0 18px;
    }
    .session-type {
        display: flex;
        padding: 18px 18px 16px;
        border-bottom: 1px solid var(--nx-border-softer);
    }
    .session-form-body {
        height: min(360px, calc(100vh - 250px));
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
    .serial-path-field {
        gap: 8px;
    }
    .serial-field-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 24px;
    }
    .serial-refresh {
        display: grid;
        place-items: center;
        width: 30px;
        min-width: 30px;
        height: 24px;
        padding: 0;
        border: 1px solid var(--nx-border);
        border-radius: 5px;
        background: var(--nx-control-muted);
        color: var(--nx-icon);
        cursor: pointer;
    }
    .serial-refresh:hover:not(:disabled) {
        background: var(--nx-surface-2);
        color: var(--nx-icon);
    }
    .serial-check {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        height: 32px;
    }
    .serial-check input {
        width: 16px;
        height: 16px;
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

    @media (max-width: 620px) {
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
