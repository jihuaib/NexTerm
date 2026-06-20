<template>
    <div class="script-workbench" @click.left="closeMenus">
        <div class="script-toolbar">
            <IconButton title="新建脚本" size="sm" @click="openCreateDialog">
                <Plus :size="14" :stroke-width="1.9" />
            </IconButton>
            <IconButton title="导入脚本" size="sm" @click="importScriptFiles">
                <Upload :size="14" :stroke-width="1.9" />
            </IconButton>
            <IconButton title="导出脚本" size="sm" :disabled="!selectedScript" @click="exportSelectedScript">
                <Download :size="14" :stroke-width="1.9" />
            </IconButton>
        </div>

        <section class="script-list">
            <button
                v-for="script in store.scripts"
                :key="script.id"
                type="button"
                class="script-row"
                :class="{ 'is-active': script.id === selectedScriptId }"
                @click="selectedScriptId = script.id"
                @contextmenu.prevent.stop="openScriptMenu($event, script)"
            >
                <span>
                    <strong>{{ script.name }}</strong>
                    <small>{{ languageLabel(script.languageId) }}</small>
                </span>
            </button>
            <div v-if="store.scripts.length === 0" class="script-empty">暂无脚本</div>
        </section>

        <section class="script-runner">
            <div v-if="selectedScript" class="script-preview">
                <div class="preview-head">
                    <strong>{{ selectedScript.name }}</strong>
                    <span>{{ languageLabel(selectedScript.languageId) }}</span>
                </div>
                <p v-if="selectedScript.description">{{ selectedScript.description }}</p>
                <pre>{{ selectedScript.content }}</pre>
            </div>
            <div v-else class="script-empty compact">选择脚本后执行</div>
        </section>

        <section class="task-list">
            <header>
                <strong>任务</strong>
                <span>{{ store.scriptTasks.length }} 条</span>
            </header>
            <div v-if="store.scriptTasks.length === 0" class="task-empty">暂无任务</div>
            <article
                v-for="task in store.scriptTasks"
                :key="task.id"
                class="task-item"
                :class="`is-${task.status}`"
                @contextmenu.prevent.stop="openTaskMenu($event, task)"
            >
                <div class="task-main">
                    <strong>{{ task.scriptName }}</strong>
                    <span>{{ taskStatusLabel(task) }}</span>
                </div>
                <div class="task-meta">
                    <span>{{ task.sessionName }}</span>
                    <span v-if="task.exitCode !== null && task.exitCode !== undefined">退出码 {{ task.exitCode }}</span>
                </div>
                <div class="task-actions">
                    <button
                        type="button"
                        :disabled="task.status === 'running' || task.status === 'paused'"
                        title="再次执行"
                        @click="rerunTask(task)"
                    >
                        <RotateCw :size="13" :stroke-width="2" />
                    </button>
                    <button type="button" :disabled="task.status !== 'running'" title="暂停" @click="pauseTask(task)">
                        <Pause :size="13" :stroke-width="2" />
                    </button>
                    <button type="button" :disabled="task.status !== 'paused'" title="继续" @click="resumeTask(task)">
                        <Play :size="13" :stroke-width="2" />
                    </button>
                    <button
                        type="button"
                        :disabled="task.status !== 'running' && task.status !== 'paused'"
                        title="停止"
                        @click="stopTask(task)"
                    >
                        <CircleStop :size="13" :stroke-width="2" />
                    </button>
                </div>
            </article>
        </section>

        <ContextMenu :visible="scriptMenu.visible" :x="scriptMenu.x" :y="scriptMenu.y">
            <button type="button" :disabled="!canRunContextScript" @click="runContextScript">
                <Play :size="14" :stroke-width="1.9" />
                <span>执行</span>
            </button>
            <button type="button" :disabled="!contextScript" @click="editContextScript">
                <Pencil :size="14" :stroke-width="1.9" />
                <span>编辑</span>
            </button>
            <button type="button" :disabled="!contextScript" class="danger-menu-item" @click="deleteContextScript">
                <Trash2 :size="14" :stroke-width="1.9" />
                <span>删除</span>
            </button>
        </ContextMenu>

        <ContextMenu :visible="taskMenu.visible" :x="taskMenu.x" :y="taskMenu.y">
            <button type="button" :disabled="!canRerunContextTask" @click="rerunContextTask">
                <RotateCw :size="14" :stroke-width="1.9" />
                <span>再次执行</span>
            </button>
            <button type="button" :disabled="!contextTask" class="danger-menu-item" @click="deleteContextTask">
                <Trash2 :size="14" :stroke-width="1.9" />
                <span>删除任务</span>
            </button>
        </ContextMenu>

        <BaseDialog
            v-if="scriptDialogVisible"
            :title="scriptForm.id ? '编辑脚本' : '新建脚本'"
            width="560px"
            @close="closeScriptDialog"
        >
            <div class="script-dialog">
                <label>
                    <span>名称</span>
                    <input v-model="scriptForm.name" placeholder="脚本名称" />
                </label>
                <label>
                    <span>语言</span>
                    <select v-model="scriptForm.languageId">
                        <option v-for="language in SCRIPT_LANGUAGES" :key="language.id" :value="language.id">
                            {{ language.label }}
                        </option>
                    </select>
                </label>
                <label v-if="scriptForm.languageId === 'custom'">
                    <span>执行命令</span>
                    <input v-model="scriptForm.command" placeholder="ruby {file}" />
                </label>
                <label>
                    <span>描述</span>
                    <input v-model="scriptForm.description" placeholder="可选" />
                </label>
                <label class="script-editor">
                    <span>脚本</span>
                    <textarea v-model="scriptForm.content" spellcheck="false" />
                </label>
            </div>

            <template #footer>
                <button class="ghost" type="button" @click="closeScriptDialog">取消</button>
                <button class="primary" type="button" @click="saveScriptDialog">保存</button>
            </template>
        </BaseDialog>

        <BaseDialog v-if="runDialogVisible" title="执行脚本" width="420px" @close="closeRunDialog">
            <div class="run-dialog">
                <div v-if="selectedScript" class="run-summary">
                    <strong>{{ selectedScript.name }}</strong>
                    <span>{{ languageLabel(selectedScript.languageId) }}</span>
                </div>
                <label>
                    <span>目标窗口</span>
                    <select v-model="targetSessionId" :disabled="connectedSessions.length === 0">
                        <option value="">选择已连接窗口</option>
                        <option
                            v-for="session in connectedSessions"
                            :key="session.sessionId"
                            :value="session.sessionId"
                        >
                            {{ session.targetLabel || session.name }}
                        </option>
                    </select>
                </label>
                <div v-if="connectedSessions.length === 0" class="script-empty compact">暂无已连接窗口</div>
            </div>

            <template #footer>
                <button class="ghost" type="button" @click="closeRunDialog">取消</button>
                <button class="primary" type="button" :disabled="!canRun" @click="confirmRunScript">执行</button>
            </template>
        </BaseDialog>
    </div>
</template>

<script setup>
    import { computed, reactive, ref, watch } from 'vue';
    import { CircleStop, Download, Pause, Pencil, Play, Plus, RotateCw, Trash2, Upload } from '@lucide/vue';
    import {
        deleteScript,
        deleteScriptTask,
        exportScripts as exportScriptLibrary,
        getConnectedSessions,
        importScripts as importScriptLibrary,
        pauseScriptTask as pauseScriptTaskInStore,
        resumeScriptTask as resumeScriptTaskInStore,
        rerunScriptTask as rerunScriptTaskInStore,
        runScriptOnSession,
        saveScript,
        stopScriptTask as stopScriptTaskInStore,
        store
    } from '../store';
    import { DEFAULT_SCRIPT_LANGUAGE, SCRIPT_LANGUAGES, getScriptLanguage } from '../services/terminalScriptRunner';
    import { notifyError, notifySuccess } from '../services/notify';
    import BaseDialog from './ui/BaseDialog.vue';
    import ContextMenu from './ui/ContextMenu.vue';
    import IconButton from './ui/IconButton.vue';

    const selectedScriptId = ref('');
    const targetSessionId = ref('');
    const scriptDialogVisible = ref(false);
    const runDialogVisible = ref(false);
    const scriptForm = reactive(defaultScript());
    const scriptMenu = reactive({ visible: false, x: 0, y: 0, scriptId: '' });
    const taskMenu = reactive({ visible: false, x: 0, y: 0, taskId: '' });

    const selectedScript = computed(() => store.scripts.find(script => script.id === selectedScriptId.value) || null);
    const contextScript = computed(() => store.scripts.find(script => script.id === scriptMenu.scriptId) || null);
    const contextTask = computed(() => store.scriptTasks.find(task => task.id === taskMenu.taskId) || null);
    const connectedSessions = computed(() => getConnectedSessions());
    const canRunContextScript = computed(() => canRunScript(contextScript.value));
    const canRerunContextTask = computed(() => {
        const task = contextTask.value;
        return Boolean(task && task.status !== 'running' && task.status !== 'paused');
    });
    const canOpenRunDialog = computed(() => {
        return canRunScript(selectedScript.value);
    });
    const canRun = computed(
        () =>
            Boolean(canOpenRunDialog.value && targetSessionId.value) &&
            connectedSessions.value.some(session => session.sessionId === targetSessionId.value)
    );

    function defaultScript() {
        return {
            id: '',
            name: '新建脚本',
            languageId: DEFAULT_SCRIPT_LANGUAGE,
            command: '',
            content: '',
            description: ''
        };
    }

    function setForm(script = null) {
        Object.assign(scriptForm, defaultScript(), script || {});
    }

    function languageLabel(languageId) {
        return getScriptLanguage(languageId).label;
    }

    function canRunScript(script) {
        return (
            Boolean(script) &&
            Boolean(script.content.trim()) &&
            (script.languageId !== 'custom' || Boolean(script.command.trim()))
        );
    }

    function openCreateDialog() {
        closeMenus();
        setForm();
        scriptDialogVisible.value = true;
    }

    function closeMenus() {
        scriptMenu.visible = false;
        taskMenu.visible = false;
    }

    function openScriptMenu(event, script) {
        selectedScriptId.value = script.id;
        taskMenu.visible = false;
        scriptMenu.scriptId = script.id;
        scriptMenu.x = event.clientX;
        scriptMenu.y = event.clientY;
        scriptMenu.visible = true;
    }

    function openTaskMenu(event, task) {
        scriptMenu.visible = false;
        taskMenu.taskId = task.id;
        taskMenu.x = event.clientX;
        taskMenu.y = event.clientY;
        taskMenu.visible = true;
    }

    function editContextScript() {
        if (!contextScript.value) return;
        setForm(contextScript.value);
        closeMenus();
        scriptDialogVisible.value = true;
    }

    function runContextScript() {
        if (!canRunContextScript.value || !contextScript.value) return;
        selectedScriptId.value = contextScript.value.id;
        openRunDialog();
    }

    function closeScriptDialog() {
        scriptDialogVisible.value = false;
    }

    function openRunDialog() {
        closeMenus();
        if (!canOpenRunDialog.value) return;
        if (!connectedSessions.value.some(session => session.sessionId === targetSessionId.value)) {
            targetSessionId.value = connectedSessions.value[0]?.sessionId || '';
        }
        runDialogVisible.value = true;
    }

    function closeRunDialog() {
        runDialogVisible.value = false;
    }

    async function saveScriptDialog() {
        if (!scriptForm.name.trim()) {
            notifyError('脚本名称不能为空', '表单输入错误');
            return;
        }
        const res = await saveScript(scriptForm);
        if (res.status !== 'success') {
            notifyError(res.msg || '保存脚本失败');
            return;
        }
        selectedScriptId.value = res.data.id;
        scriptDialogVisible.value = false;
        notifySuccess('脚本已保存');
    }

    async function removeSelectedScript() {
        if (!selectedScript.value) return;
        const removedId = selectedScript.value.id;
        const res = await deleteScript(removedId);
        if (res.status !== 'success') {
            notifyError(res.msg || '删除脚本失败');
            return;
        }
        const next = store.scripts.find(script => script.id !== removedId) || null;
        selectedScriptId.value = next?.id || '';
        notifySuccess('脚本已删除');
    }

    async function deleteContextScript() {
        if (!contextScript.value) return;
        selectedScriptId.value = contextScript.value.id;
        closeMenus();
        await removeSelectedScript();
    }

    async function confirmRunScript() {
        if (!selectedScript.value) return;
        const res = await runScriptOnSession(selectedScript.value, targetSessionId.value);
        if (res.status !== 'success') {
            notifyError(res.msg || '执行脚本失败');
            return;
        }
        runDialogVisible.value = false;
        notifySuccess('脚本已发送到终端');
    }

    async function importScriptFiles() {
        const res = await importScriptLibrary();
        if (res.status !== 'success') {
            notifyError(res.msg || '导入脚本失败');
            return;
        }
        if (res.data?.canceled) return;
        notifySuccess(res.msg || '脚本已导入');
    }

    async function exportSelectedScript() {
        if (!selectedScript.value) return;
        const res = await exportScriptLibrary([selectedScript.value.id]);
        if (res.status !== 'success') {
            notifyError(res.msg || '导出脚本失败');
            return;
        }
        if (res.data?.canceled) return;
        notifySuccess(res.msg || '脚本已导出');
    }

    async function stopTask(task) {
        const res = await stopScriptTaskInStore(task);
        if (res.status !== 'success') notifyError(res.msg || '停止任务失败');
    }

    async function pauseTask(task) {
        const res = await pauseScriptTaskInStore(task);
        if (res.status !== 'success') notifyError(res.msg || '暂停任务失败');
    }

    async function resumeTask(task) {
        const res = await resumeScriptTaskInStore(task);
        if (res.status !== 'success') notifyError(res.msg || '继续任务失败');
    }

    async function rerunTask(task) {
        const res = await rerunScriptTaskInStore(task);
        if (res.status !== 'success') {
            notifyError(res.msg || '再次执行失败');
            return;
        }
        notifySuccess('脚本已重新发送到终端');
    }

    async function removeTask(task) {
        const res = await deleteScriptTask(task);
        if (res.status !== 'success') {
            notifyError(res.msg || '删除任务失败');
            return;
        }
        notifySuccess('任务已删除');
    }

    async function deleteContextTask() {
        if (!contextTask.value) return;
        const task = contextTask.value;
        closeMenus();
        await removeTask(task);
    }

    async function rerunContextTask() {
        if (!canRerunContextTask.value || !contextTask.value) return;
        const task = contextTask.value;
        closeMenus();
        await rerunTask(task);
    }

    function taskStatusLabel(task) {
        if (task.status === 'running') return '运行中';
        if (task.status === 'paused') return '已暂停';
        if (task.status === 'stopped') return '已停止';
        if (task.status === 'failed') return '失败';
        if (task.status === 'completed') return '完成';
        return '等待中';
    }

    watch(
        () => store.scripts.map(script => script.id).join('|'),
        () => {
            if (selectedScriptId.value && store.scripts.some(script => script.id === selectedScriptId.value)) return;
            selectedScriptId.value = store.scripts[0]?.id || '';
        },
        { immediate: true }
    );

    watch(
        connectedSessions,
        sessions => {
            if (sessions.some(session => session.sessionId === targetSessionId.value)) return;
            targetSessionId.value = sessions[0]?.sessionId || '';
        },
        { immediate: true }
    );
</script>

<style scoped>
    .script-workbench {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
    .script-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px;
        border-bottom: 1px solid var(--nx-border);
    }
    .script-list {
        flex: 0 0 188px;
        min-height: 120px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px;
        overflow: auto;
        border-bottom: 1px solid var(--nx-border);
    }
    .script-row {
        min-height: 44px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 7px 8px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-surface-2);
        color: var(--nx-text);
        cursor: pointer;
        text-align: left;
    }
    .script-row:hover {
        border-color: var(--nx-accent);
    }
    .script-row.is-active {
        border-color: var(--nx-accent-border);
        background: var(--nx-accent-soft);
    }
    .script-row span {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    .script-row strong,
    .script-row small {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .script-row strong {
        font-size: 12px;
    }
    .script-row small {
        color: var(--nx-text-dim);
        font-size: 10px;
    }
    .script-runner {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px;
        overflow: hidden;
    }
    .script-dialog input,
    .script-dialog select,
    .script-dialog textarea,
    .run-dialog select {
        width: 100%;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-bg);
        color: var(--nx-text);
        outline: none;
    }
    .script-dialog input,
    .script-dialog select,
    .run-dialog select {
        min-width: 0;
        height: 30px;
        padding: 0 8px;
    }
    .script-preview {
        min-height: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 6px;
        overflow: hidden;
    }
    .preview-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 22px;
    }
    .preview-head strong {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
    }
    .preview-head span,
    .script-preview p {
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    .script-preview p {
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .script-preview pre {
        flex: 1;
        min-height: 72px;
        margin: 0;
        padding: 8px;
        overflow: auto;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-bg);
        color: var(--nx-text);
        font-family: var(--nx-font-mono);
        font-size: 11px;
        line-height: 1.5;
        white-space: pre;
    }
    .script-empty,
    .task-empty {
        display: grid;
        place-items: center;
        min-height: 80px;
        border: 1px dashed var(--nx-border);
        border-radius: 7px;
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    .script-empty.compact {
        flex: 1;
        min-height: 72px;
    }
    .task-list {
        flex: 0 0 170px;
        min-height: 150px;
        display: flex;
        flex-direction: column;
        gap: 7px;
        padding: 8px;
        border-top: 1px solid var(--nx-border);
        overflow: auto;
    }
    .task-list header,
    .task-main,
    .task-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .task-list header strong {
        font-size: 12px;
    }
    .task-list header span,
    .task-main span,
    .task-meta {
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    .task-item {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-surface-raised);
    }
    .task-item.is-running {
        border-color: var(--nx-warning);
    }
    .task-item.is-paused {
        border-color: var(--nx-accent);
    }
    .task-item.is-completed {
        border-color: var(--nx-success);
    }
    .task-item.is-failed,
    .task-item.is-stopped {
        border-color: var(--nx-danger-border);
    }
    .task-main strong,
    .task-meta span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .task-main strong {
        color: var(--nx-text);
        font-size: 12px;
    }
    .task-actions {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 5px;
    }
    .task-actions button {
        height: 26px;
        display: grid;
        place-items: center;
        padding: 0;
        border: 1px solid var(--nx-border);
        border-radius: 6px;
        background: var(--nx-surface-2);
        color: var(--nx-text);
        cursor: pointer;
    }
    .task-actions button:hover {
        border-color: var(--nx-accent);
        color: var(--nx-accent);
    }
    .task-actions button:disabled {
        cursor: not-allowed;
        opacity: 0.42;
    }
    :deep(.danger-menu-item) {
        color: var(--nx-danger);
    }
    :deep(.danger-menu-item:hover) {
        border-color: var(--nx-danger-border);
        background: var(--nx-danger-soft);
        color: var(--nx-danger);
    }
    .script-dialog {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px 18px;
    }
    .run-dialog {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 14px 18px;
    }
    .run-summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-surface-2);
    }
    .run-summary strong {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
    }
    .run-summary span {
        flex-shrink: 0;
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    .script-dialog label,
    .run-dialog label {
        display: flex;
        flex-direction: column;
        gap: 5px;
        color: var(--nx-text-dim);
        font-size: 12px;
    }
    .script-dialog textarea {
        min-height: 220px;
        resize: vertical;
        padding: 8px;
        font-family: var(--nx-font-mono);
        font-size: 12px;
        line-height: 1.5;
        white-space: pre;
    }
    .script-dialog input:focus,
    .script-dialog select:focus,
    .script-dialog textarea:focus,
    .run-dialog select:focus {
        border-color: var(--nx-accent);
    }
    .ghost,
    .primary {
        height: 30px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        cursor: pointer;
    }
    .ghost {
        background: var(--nx-surface-2);
        color: var(--nx-text);
    }
    .primary {
        border-color: var(--nx-accent);
        background: var(--nx-accent);
        color: var(--nx-accent-text);
        padding: 0 12px;
    }
    .primary:disabled {
        cursor: not-allowed;
        opacity: 0.56;
    }
</style>
