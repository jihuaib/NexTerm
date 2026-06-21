<template>
    <div class="forward-panel">
        <div class="forward-form">
            <label class="wide">
                <span>模式</span>
                <select v-model="form.type" @change="applyTypeDefaults">
                    <option value="direct">Direct</option>
                    <option value="local">SSH Local</option>
                    <option value="remote">SSH Remote</option>
                    <option value="dynamic">SOCKS5</option>
                </select>
            </label>

            <label v-if="requiresSsh" class="wide">
                <span>SSH 会话</span>
                <select v-model="form.sessionId" :disabled="connectedSessions.length === 0">
                    <option value="">选择已连接 SSH</option>
                    <option v-for="session in connectedSessions" :key="session.sessionId" :value="session.sessionId">
                        {{ session.targetLabel || session.name }}
                    </option>
                </select>
            </label>

            <label v-if="form.type === 'direct'">
                <span>协议</span>
                <select v-model="form.transport">
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                </select>
            </label>

            <label>
                <span>名称</span>
                <input v-model="form.name" placeholder="可选" />
            </label>

            <label>
                <span>监听地址</span>
                <input v-model="form.bindHost" placeholder="127.0.0.1" />
            </label>

            <label>
                <span>监听端口</span>
                <input v-model.number="form.bindPort" type="number" min="1" max="65535" step="1" />
            </label>

            <template v-if="form.type !== 'dynamic'">
                <label>
                    <span>目标地址</span>
                    <input v-model="form.targetHost" placeholder="127.0.0.1" />
                </label>

                <label>
                    <span>目标端口</span>
                    <input v-model.number="form.targetPort" type="number" min="1" max="65535" step="1" />
                </label>
            </template>

            <button
                class="primary wide"
                type="button"
                :disabled="starting || (requiresSsh && connectedSessions.length === 0)"
                @click="submit"
            >
                <Play :size="15" :stroke-width="1.9" />
                <span>{{ starting ? '启动中' : '启动转发' }}</span>
            </button>
        </div>

        <div class="forward-list">
            <div v-if="store.portForwards.length === 0" class="forward-empty">
                <Network :size="20" :stroke-width="1.8" />
                <span>暂无端口转发</span>
            </div>

            <article
                v-for="forward in store.portForwards"
                :key="forward.id"
                class="forward-item"
                :class="forward.status"
            >
                <div class="forward-item__head">
                    <div>
                        <strong>{{ forward.name || modeLabel(forward.type) }}</strong>
                        <span>{{ statusLabel(forward.status) }}</span>
                    </div>
                    <div class="forward-item__actions">
                        <button
                            v-if="forward.status === 'active' || forward.status === 'starting'"
                            type="button"
                            title="停止"
                            @click="stop(forward)"
                        >
                            <Square :size="14" :stroke-width="2" />
                        </button>
                        <button v-else type="button" title="启动" @click="restart(forward)">
                            <Play :size="14" :stroke-width="2" />
                        </button>
                        <button type="button" title="删除" @click="remove(forward)">
                            <Trash2 :size="14" :stroke-width="2" />
                        </button>
                    </div>
                </div>
                <div class="forward-map">{{ mappingText(forward) }}</div>
                <div class="forward-session">{{ sessionLabel(forward.sessionId) }}</div>
                <div v-if="forward.msg" class="forward-msg">{{ forward.msg }}</div>
            </article>
        </div>
    </div>
</template>

<script setup>
    import { computed, reactive, ref, watch } from 'vue';
    import { Network, Play, Square, Trash2 } from '@lucide/vue';
    import {
        createPortForwardDraft,
        deletePortForward,
        getConnectedSessions,
        startPortForward,
        stopPortForward,
        store
    } from '../store';
    import { notifyError, notifySuccess } from '../services/notify';

    const starting = ref(false);
    const form = reactive(createPortForwardDraft({ bindPort: 8080, targetPort: 80 }));
    const connectedSessions = computed(() => getConnectedSessions().filter(session => session.protocol === 'ssh'));
    const requiresSsh = computed(() => form.type !== 'direct');

    watch(
        connectedSessions,
        sessions => {
            if (!requiresSsh.value) return;
            if (form.sessionId && sessions.some(session => session.sessionId === form.sessionId)) return;
            form.sessionId = sessions[0]?.sessionId || '';
        },
        { immediate: true }
    );

    function portIsValid(value) {
        const port = Number(value);
        return Number.isInteger(port) && port >= 1 && port <= 65535;
    }

    function applyTypeDefaults() {
        form.bindHost = form.bindHost || '127.0.0.1';
        if (!portIsValid(form.bindPort)) form.bindPort = form.type === 'dynamic' ? 1080 : 8080;
        if (!requiresSsh.value) {
            form.sessionId = '';
            form.transport = form.transport === 'udp' ? 'udp' : 'tcp';
        } else {
            form.transport = 'tcp';
            if (!form.sessionId) form.sessionId = connectedSessions.value[0]?.sessionId || '';
        }
        if (form.type === 'dynamic') {
            form.targetHost = '';
            form.targetPort = null;
            return;
        }
        form.targetHost = form.targetHost || '127.0.0.1';
        if (!portIsValid(form.targetPort)) form.targetPort = 80;
    }

    function validate() {
        if (requiresSsh.value && !form.sessionId) return '请选择已连接 SSH 会话';
        if (!form.bindHost.trim()) return '监听地址不能为空';
        if (!portIsValid(form.bindPort)) return '监听端口必须是 1-65535';
        if (form.type === 'dynamic') return '';
        if (!form.targetHost.trim()) return '目标地址不能为空';
        if (!portIsValid(form.targetPort)) return '目标端口必须是 1-65535';
        return '';
    }

    async function submit() {
        const error = validate();
        if (error) {
            notifyError(error, '端口转发');
            return;
        }
        starting.value = true;
        try {
            const res = await startPortForward({ ...form });
            if (res.status === 'success') {
                notifySuccess(res.msg || '端口转发已启动');
                Object.assign(
                    form,
                    createPortForwardDraft({
                        sessionId: form.sessionId,
                        type: form.type,
                        transport: form.transport,
                        bindHost: form.bindHost,
                        bindPort: form.bindPort,
                        targetHost: form.targetHost,
                        targetPort: form.targetPort
                    })
                );
                return;
            }
            notifyError(res.msg || '启动端口转发失败');
        } catch (err) {
            notifyError(err?.message || '启动端口转发失败');
        } finally {
            starting.value = false;
        }
    }

    async function restart(forward) {
        const res = await startPortForward(forward);
        if (res.status === 'success') notifySuccess(res.msg || '端口转发已启动');
        else notifyError(res.msg || '启动端口转发失败');
    }

    async function stop(forward) {
        const res = await stopPortForward(forward.id);
        if (res.status === 'success') notifySuccess(res.msg || '端口转发已停止');
        else notifyError(res.msg || '停止端口转发失败');
    }

    async function remove(forward) {
        await deletePortForward(forward.id);
        notifySuccess('端口转发已删除');
    }

    function modeLabel(type) {
        if (type === 'local') return 'SSH Local';
        if (type === 'remote') return 'SSH Remote';
        if (type === 'dynamic') return 'SOCKS5';
        if (type === 'direct') return 'Direct';
        return '端口转发';
    }

    function statusLabel(status) {
        if (status === 'active') return '运行中';
        if (status === 'starting') return '启动中';
        if (status === 'error') return '异常';
        return '已停止';
    }

    function mappingText(forward) {
        const bind = `${forward.bindHost}:${forward.bindPort}`;
        if (forward.type === 'dynamic') return `${bind} SOCKS5`;
        const target = `${forward.targetHost}:${forward.targetPort}`;
        if (forward.type === 'direct') return `${bind} ${String(forward.transport || 'tcp').toUpperCase()} => ${target}`;
        return forward.type === 'remote' ? `${bind} <= ${target}` : `${bind} => ${target}`;
    }

    function sessionLabel(sessionId) {
        if (!sessionId) return 'Direct · 不使用 SSH';
        const session = connectedSessions.value.find(item => item.sessionId === sessionId);
        return session ? session.targetLabel || session.name : 'SSH 会话未连接';
    }
</script>

<style scoped>
    .forward-panel {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        border-top: 1px solid var(--nx-border);
        overflow-y: auto;
    }
    .forward-form {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 10px;
        padding: 10px 10px 12px;
        border-bottom: 1px solid var(--nx-border);
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-width: 0;
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    label.wide,
    button.wide {
        grid-column: 1 / -1;
    }
    input,
    select {
        width: 100%;
        height: 30px;
        min-width: 0;
        padding: 0 8px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-bg);
        color: var(--nx-text);
        outline: none;
    }
    input:focus,
    select:focus {
        border-color: var(--nx-accent);
    }
    .primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        height: 32px;
        border: 1px solid var(--nx-accent);
        border-radius: 7px;
        background: var(--nx-accent);
        color: var(--nx-accent-text);
        cursor: pointer;
    }
    .primary:disabled {
        opacity: 0.62;
        cursor: not-allowed;
    }
    .forward-list {
        display: grid;
        gap: 8px;
        padding: 10px;
    }
    .forward-empty {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 0 10px;
        border: 1px dashed var(--nx-border);
        border-radius: 7px;
        color: var(--nx-text-dim);
        font-size: 12px;
    }
    .forward-item {
        display: grid;
        gap: 7px;
        padding: 9px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-bg);
    }
    .forward-item.active {
        border-color: var(--nx-success);
    }
    .forward-item.error {
        border-color: var(--nx-danger);
        background: var(--nx-danger-soft);
    }
    .forward-item__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .forward-item__head strong {
        display: block;
        color: var(--nx-text);
        font-size: 12px;
    }
    .forward-item__head span,
    .forward-session,
    .forward-msg {
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    .forward-item__actions {
        display: flex;
        gap: 5px;
        flex-shrink: 0;
    }
    .forward-item__actions button {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: 1px solid var(--nx-border);
        border-radius: 6px;
        background: var(--nx-control-muted);
        color: var(--nx-text);
        cursor: pointer;
    }
    .forward-item__actions button:hover {
        border-color: var(--nx-accent);
        color: var(--nx-accent);
    }
    .forward-map {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--nx-text);
        font-family: var(--nx-font-mono);
        font-size: 11px;
    }
</style>
