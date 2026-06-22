<template>
    <div class="command-set-bar" @click.stop="closeMenu">
        <button class="command-add" type="button" title="新建指令集" @click.stop="openCreateDialog">
            <Plus :size="13" :stroke-width="2" />
        </button>
        <div class="command-list" aria-label="指令集">
            <button
                v-for="commandSet in store.commandSets"
                :key="commandSet.id"
                class="command-chip"
                type="button"
                :style="commandSetStyle(commandSet)"
                :title="commandSetTitle(commandSet)"
                @click.stop="runCommandSet(commandSet)"
                @contextmenu.prevent.stop="openMenu($event, commandSet)"
            >
                <span class="command-chip__swatch" />
                <span class="command-chip__name">{{ commandSet.name }}</span>
            </button>
            <span v-if="store.commandSets.length === 0" class="command-empty">指令集</span>
        </div>

        <ContextMenu :visible="menu.visible" :x="menu.x" :y="menu.y">
            <button type="button" :disabled="!contextCommandSet" @click="runContextCommandSet">
                <SendHorizontal :size="14" :stroke-width="1.9" />
                <span>发送</span>
            </button>
            <button type="button" :disabled="!contextCommandSet" @click="editContextCommandSet">
                <Pencil :size="14" :stroke-width="1.9" />
                <span>编辑</span>
            </button>
            <button type="button" :disabled="!contextCommandSet" class="danger-menu-item" @click="deleteContextCommandSet">
                <Trash2 :size="14" :stroke-width="1.9" />
                <span>删除</span>
            </button>
        </ContextMenu>

        <BaseDialog
            v-if="dialogVisible"
            :title="form.id ? '编辑指令集' : '新建指令集'"
            width="520px"
            @close="closeDialog"
        >
            <div class="command-dialog">
                <label>
                    <span>名称</span>
                    <input v-model="form.name" placeholder="指令集名称" />
                </label>
                <label>
                    <span>命令</span>
                    <textarea v-model="form.commandsText" spellcheck="false" />
                </label>
                <div class="command-color-field">
                    <span>颜色</span>
                    <div class="command-swatches">
                        <button
                            v-for="color in COMMAND_SET_COLOR_OPTIONS"
                            :key="color.id"
                            type="button"
                            :class="{ active: form.color === color.id }"
                            :style="swatchStyle(color)"
                            :title="color.label"
                            @click="form.color = color.id"
                        >
                            <i />
                        </button>
                    </div>
                </div>
            </div>

            <template #footer>
                <button class="ghost" type="button" @click="closeDialog">取消</button>
                <button class="primary" type="button" @click="saveDialog">保存</button>
            </template>
        </BaseDialog>
    </div>
</template>

<script setup>
    import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
    import { Pencil, Plus, SendHorizontal, Trash2 } from '@lucide/vue';
    import {
        deleteCommandSet,
        saveCommandSet,
        sendCommandSetToSession,
        store
    } from '../store';
    import {
        COMMAND_SET_COLOR_OPTIONS,
        commandSetCommandsToText,
        getCommandSetColorOption,
        normalizeCommandSetCommands
    } from '../services/commandSets';
    import { notifyError, notifySuccess } from '../services/notify';
    import BaseDialog from './ui/BaseDialog.vue';
    import ContextMenu from './ui/ContextMenu.vue';

    const props = defineProps({
        session: { type: Object, required: true }
    });
    const emit = defineEmits(['sent']);

    const dialogVisible = ref(false);
    const form = reactive(defaultForm());
    const menu = reactive({ visible: false, x: 0, y: 0, commandSetId: '' });

    const contextCommandSet = computed(() => store.commandSets.find(item => item.id === menu.commandSetId) || null);

    onMounted(() => {
        document.addEventListener('click', closeMenu);
    });

    onBeforeUnmount(() => {
        document.removeEventListener('click', closeMenu);
    });

    function defaultForm() {
        return {
            id: '',
            name: '新建指令集',
            color: COMMAND_SET_COLOR_OPTIONS[0].id,
            commandsText: ''
        };
    }

    function setForm(commandSet = null) {
        Object.assign(form, defaultForm(), {
            ...(commandSet || {}),
            commandsText: commandSetCommandsToText(commandSet?.commands || [])
        });
    }

    function commandSetStyle(commandSet) {
        const color = getCommandSetColorOption(commandSet.color);
        return {
            '--command-color': color.swatch,
            '--command-bg': color.bg,
            '--command-border': color.border
        };
    }

    function swatchStyle(color) {
        return {
            '--command-color': color.swatch,
            '--command-bg': color.bg,
            '--command-border': color.border
        };
    }

    function commandSetTitle(commandSet) {
        const commands = normalizeCommandSetCommands(commandSet.commands);
        return [commandSet.name, ...commands].join('\n');
    }

    function closeMenu() {
        menu.visible = false;
    }

    function openMenu(event, commandSet) {
        menu.commandSetId = commandSet.id;
        menu.x = event.clientX;
        menu.y = event.clientY;
        menu.visible = true;
    }

    function openCreateDialog() {
        closeMenu();
        setForm();
        dialogVisible.value = true;
    }

    function closeDialog() {
        dialogVisible.value = false;
    }

    function editContextCommandSet() {
        if (!contextCommandSet.value) return;
        setForm(contextCommandSet.value);
        closeMenu();
        dialogVisible.value = true;
    }

    async function saveDialog() {
        const commands = normalizeCommandSetCommands(form.commandsText);
        if (!form.name.trim()) {
            notifyError('指令集名称不能为空', '表单输入错误');
            return;
        }
        if (!commands.length) {
            notifyError('请至少填写一条指令', '表单输入错误');
            return;
        }
        const res = await saveCommandSet({
            id: form.id,
            name: form.name,
            color: form.color,
            commands
        });
        if (res.status !== 'success') {
            notifyError(res.msg || '保存指令集失败');
            return;
        }
        dialogVisible.value = false;
        notifySuccess('指令集已保存');
    }

    function runCommandSet(commandSet) {
        const res = sendCommandSetToSession(commandSet, props.session.sessionId);
        if (res.status !== 'success') {
            notifyError(res.msg || '发送指令失败');
            return;
        }
        emit('sent');
        notifySuccess(`已发送 ${res.data?.count || 0} 条指令`);
    }

    function runContextCommandSet() {
        if (!contextCommandSet.value) return;
        const commandSet = contextCommandSet.value;
        closeMenu();
        runCommandSet(commandSet);
    }

    async function deleteContextCommandSet() {
        if (!contextCommandSet.value) return;
        const id = contextCommandSet.value.id;
        closeMenu();
        const res = await deleteCommandSet(id);
        if (res.status !== 'success') {
            notifyError(res.msg || '删除指令集失败');
            return;
        }
        notifySuccess('指令集已删除');
    }
</script>

<style scoped>
    .command-set-bar {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 6px;
        user-select: none;
    }
    .command-add {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        width: 22px;
        height: 20px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 5px;
        background: rgba(255, 255, 255, 0.04);
        color: var(--nx-icon);
        cursor: pointer;
    }
    .command-add:hover {
        border-color: var(--nx-icon);
        background: var(--nx-accent-softer);
    }
    .command-list {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 5px;
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
    }
    .command-list::-webkit-scrollbar {
        display: none;
        width: 0;
        height: 0;
    }
    .command-chip {
        flex: 0 0 auto;
        max-width: 180px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 20px;
        padding: 0 8px 0 6px;
        border: 1px solid var(--command-border);
        border-radius: 6px;
        background: var(--command-bg);
        color: var(--command-color);
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
    }
    .command-chip:hover {
        background: rgba(255, 255, 255, 0.08);
    }
    .command-chip__swatch {
        flex: 0 0 auto;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--command-color);
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.06);
    }
    .command-chip__name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .command-empty {
        color: rgba(255, 255, 255, 0.34);
        font-size: 11px;
        white-space: nowrap;
    }
    .command-dialog {
        display: grid;
        gap: 12px;
        padding: 16px;
    }
    .command-dialog label,
    .command-color-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        color: var(--nx-text-dim);
        font-size: 12px;
    }
    .command-dialog input,
    .command-dialog textarea {
        width: 100%;
        min-width: 0;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-bg);
        color: var(--nx-text);
        outline: none;
    }
    .command-dialog input {
        height: 32px;
        padding: 0 9px;
    }
    .command-dialog textarea {
        min-height: 150px;
        resize: vertical;
        padding: 8px;
        font-family: var(--nx-font-mono);
        font-size: 12px;
        line-height: 1.5;
        white-space: pre;
    }
    .command-dialog input:focus,
    .command-dialog textarea:focus {
        border-color: var(--nx-accent);
    }
    .command-swatches {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
    }
    .command-swatches button {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid var(--command-border);
        border-radius: 7px;
        background: var(--command-bg);
        cursor: pointer;
    }
    .command-swatches button.active {
        box-shadow: 0 0 0 2px var(--command-border);
    }
    .command-swatches i {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--command-color);
    }
    .ghost,
    .primary {
        height: 30px;
        padding: 0 12px;
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
    }
    :deep(.danger-menu-item) {
        color: var(--nx-danger);
    }
</style>
