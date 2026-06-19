<template>
    <div class="nx-settings">
        <section class="nx-group">
            <div class="nx-group__head">
                <h3>终端</h3>
                <p>终端显示区内的复制与粘贴快捷键。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">查找终端</div>
                    <div class="nx-row__desc">打开当前终端的搜索框</div>
                </div>
                <div class="nx-row__control">
                    <select
                        class="nx-select nx-select--shortcut"
                        :value="s.terminalSearchShortcut"
                        @change="update({ terminalSearchShortcut: $event.target.value })"
                    >
                        <option v-for="option in searchOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                        </option>
                    </select>
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">复制选中内容</div>
                    <div class="nx-row__desc">只复制终端中已选中的文本</div>
                </div>
                <div class="nx-row__control">
                    <select
                        class="nx-select nx-select--shortcut"
                        :value="s.terminalCopyShortcut"
                        @change="update({ terminalCopyShortcut: $event.target.value })"
                    >
                        <option v-for="option in copyOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                        </option>
                    </select>
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">粘贴剪贴板</div>
                    <div class="nx-row__desc">读取系统剪贴板并发送到当前会话</div>
                </div>
                <div class="nx-row__control">
                    <select
                        class="nx-select nx-select--shortcut"
                        :value="s.terminalPasteShortcut"
                        @change="update({ terminalPasteShortcut: $event.target.value })"
                    >
                        <option v-for="option in pasteOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                        </option>
                    </select>
                </div>
            </div>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>鼠标</h3>
                <p>终端显示区的选中复制、右键粘贴和菜单触发方式。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">选中自动复制</div>
                    <div class="nx-row__desc">鼠标选中文本后自动写入系统剪贴板</div>
                </div>
                <div class="nx-row__control">
                    <button
                        class="nx-toggle"
                        :class="{ on: s.terminalSelectToCopy }"
                        :aria-pressed="s.terminalSelectToCopy ? 'true' : 'false'"
                        @click="update({ terminalSelectToCopy: !s.terminalSelectToCopy })"
                    ></button>
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">普通右键</div>
                    <div class="nx-row__desc">右键终端空白或文本区域时执行的默认动作</div>
                </div>
                <div class="nx-row__control">
                    <select
                        class="nx-select nx-select--shortcut"
                        :value="s.terminalRightClickAction"
                        @change="update({ terminalRightClickAction: $event.target.value })"
                    >
                        <option value="paste">直接粘贴</option>
                        <option value="menu">打开菜单</option>
                    </select>
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">右键菜单打开方式</div>
                    <div class="nx-row__desc">当普通右键用于粘贴时，可用这里的方式打开复制/粘贴菜单</div>
                </div>
                <div class="nx-row__control">
                    <select
                        class="nx-select nx-select--shortcut"
                        :value="s.terminalContextMenuTrigger"
                        @change="update({ terminalContextMenuTrigger: $event.target.value })"
                    >
                        <option value="shift">Shift + 右键</option>
                        <option value="ctrl">Ctrl + 右键</option>
                        <option value="alt">Alt/Option + 右键</option>
                        <option value="meta">Command/Meta + 右键</option>
                        <option value="none">不启用</option>
                    </select>
                </div>
            </div>
        </section>
    </div>
</template>

<script setup>
import { store, updateSettings } from '../../store';

const s = store.settings;
const searchOptions = [
    { label: 'Cmd/Ctrl + F', value: 'CmdOrCtrl+F' },
    { label: 'Cmd/Ctrl + Shift + F', value: 'CmdOrCtrl+Shift+F' },
    { label: 'Alt/Option + F', value: 'Alt+F' },
    { label: '禁用', value: '' }
];
const copyOptions = [
    { label: 'Cmd/Ctrl + Shift + C', value: 'CmdOrCtrl+Shift+C' },
    { label: 'Cmd/Ctrl + C', value: 'CmdOrCtrl+C' },
    { label: 'Ctrl + Insert', value: 'Ctrl+Insert' },
    { label: '禁用', value: '' }
];
const pasteOptions = [
    { label: 'Cmd/Ctrl + Shift + V', value: 'CmdOrCtrl+Shift+V' },
    { label: 'Cmd/Ctrl + V', value: 'CmdOrCtrl+V' },
    { label: 'Shift + Insert', value: 'Shift+Insert' },
    { label: '禁用', value: '' }
];

function update(patch) {
    updateSettings(patch);
}
</script>
