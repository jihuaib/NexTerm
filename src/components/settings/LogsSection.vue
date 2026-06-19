<template>
    <div class="nx-settings">
        <section class="nx-group">
            <div class="nx-group__head">
                <h3>写入</h3>
                <p>终端缓冲区输出的本地日志策略。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">缓冲区日志</div>
                    <div class="nx-row__desc">将终端输出写入本地日志文件</div>
                </div>
                <div class="nx-row__control">
                    <button
                        class="nx-toggle"
                        :class="{ on: s.terminalLogEnabled }"
                        :aria-pressed="s.terminalLogEnabled ? 'true' : 'false'"
                        @click="update({ terminalLogEnabled: !s.terminalLogEnabled })"
                    ></button>
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">日志目录</div>
                    <div class="nx-row__desc">默认保存到应用 userData/logs 目录</div>
                </div>
                <div class="nx-row__control nx-row__control--wide">
                    <input
                        class="nx-input nx-input--path"
                        :value="s.terminalLogDirectory"
                        placeholder="默认目录"
                        @change="update({ terminalLogDirectory: $event.target.value.trim() })"
                    />
                    <button class="nx-button" type="button" @click="chooseLogDirectory">选择</button>
                </div>
            </div>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>格式</h3>
                <p>文件命名和每行内容的模板。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">日志文件格式</div>
                    <div class="nx-row__desc">支持 date、time、session、protocol、host、user、id</div>
                </div>
                <div class="nx-row__control nx-row__control--stack">
                    <select class="nx-select nx-select--wide" :value="s.terminalLogFileFormat" @change="applyFileFormat($event.target.value)">
                        <option v-for="option in fileFormatOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                        </option>
                        <option v-if="!hasFileFormatPreset" :value="s.terminalLogFileFormat">当前自定义</option>
                    </select>
                    <input
                        class="nx-input nx-input--format"
                        :value="s.terminalLogFileFormat"
                        @change="update({ terminalLogFileFormat: normalizeFormat($event.target.value, defaultFileFormat) })"
                    />
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">日志行格式</div>
                    <div class="nx-row__desc">支持 datetime、time、session、protocol、host、user、text</div>
                </div>
                <div class="nx-row__control nx-row__control--stack">
                    <select class="nx-select nx-select--wide" :value="s.terminalLogLineFormat" @change="applyLineFormat($event.target.value)">
                        <option v-for="option in lineFormatOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                        </option>
                        <option v-if="!hasLineFormatPreset" :value="s.terminalLogLineFormat">当前自定义</option>
                    </select>
                    <input
                        class="nx-input nx-input--format"
                        :value="s.terminalLogLineFormat"
                        @change="update({ terminalLogLineFormat: normalizeFormat($event.target.value, defaultLineFormat) })"
                    />
                </div>
            </div>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>内容</h3>
                <p>写入前的终端控制序列处理。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">清理控制字符</div>
                    <div class="nx-row__desc">写入日志前移除 ANSI 颜色与光标控制序列</div>
                </div>
                <div class="nx-row__control">
                    <button
                        class="nx-toggle"
                        :class="{ on: s.terminalLogStripAnsi }"
                        :aria-pressed="s.terminalLogStripAnsi ? 'true' : 'false'"
                        @click="update({ terminalLogStripAnsi: !s.terminalLogStripAnsi })"
                    ></button>
                </div>
            </div>
        </section>
    </div>
</template>

<script setup>
import { computed } from 'vue';
import { store, updateSettings } from '../../store';
import { notifyError } from '../../services/notify';

const s = store.settings;
const defaultFileFormat = '{date}/{time}-{session}-{id}.log';
const defaultLineFormat = '{text}';
const fileFormatOptions = [
    { label: '按日期目录', value: defaultFileFormat },
    { label: '按协议主机', value: '{date}/{protocol}-{host}-{id}.log' },
    { label: '按会话目录', value: '{session}/{date}-{time}.log' }
];
const lineFormatOptions = [
    { label: '原始输出', value: defaultLineFormat },
    { label: '时间 + 内容', value: '[{datetime}] {text}' },
    { label: '会话 + 内容', value: '[{datetime}] [{session}] {text}' }
];
const hasFileFormatPreset = computed(() => fileFormatOptions.some(option => option.value === s.terminalLogFileFormat));
const hasLineFormatPreset = computed(() => lineFormatOptions.some(option => option.value === s.terminalLogLineFormat));

function update(patch) {
    updateSettings(patch);
}

function normalizeFormat(value, fallback) {
    return String(value || '').trim() || fallback;
}

function applyFileFormat(value) {
    update({ terminalLogFileFormat: normalizeFormat(value, defaultFileFormat) });
}

function applyLineFormat(value) {
    update({ terminalLogLineFormat: normalizeFormat(value, defaultLineFormat) });
}

async function chooseLogDirectory() {
    if (!window.settingsApi?.selectLogDirectory) {
        notifyError('当前环境不支持选择目录');
        return;
    }
    try {
        const res = await window.settingsApi.selectLogDirectory();
        if (res.status !== 'success') {
            notifyError(res.msg || '选择日志目录失败');
            return;
        }
        if (!res.data?.canceled && res.data?.path) update({ terminalLogDirectory: res.data.path });
    } catch (err) {
        notifyError(err?.message || '选择日志目录失败');
    }
}
</script>
