<template>
    <div class="nx-settings">
        <section class="nx-group">
            <div class="nx-group__head">
                <h3>显示</h3>
                <p>终端光标和滚动历史。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">光标闪烁</div>
                    <div class="nx-row__desc">终端光标是否闪烁</div>
                </div>
                <div class="nx-row__control">
                    <button
                        class="nx-toggle"
                        :class="{ on: s.cursorBlink }"
                        @click="update({ cursorBlink: !s.cursorBlink })"
                    />
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">光标样式</div>
                </div>
                <div class="nx-row__control">
                    <select
                        class="nx-select"
                        :value="s.cursorStyle"
                        @change="update({ cursorStyle: $event.target.value })"
                    >
                        <option value="block">块状 block</option>
                        <option value="underline">下划线 underline</option>
                        <option value="bar">竖线 bar</option>
                    </select>
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">回滚行数</div>
                    <div class="nx-row__desc">可向上滚动的历史行数</div>
                </div>
                <div class="nx-row__control">
                    <input
                        class="nx-input nx-input--num"
                        type="number"
                        min="100"
                        max="100000"
                        step="500"
                        :value="s.scrollback"
                        @change="update({ scrollback: clamp($event.target.value) })"
                    />
                </div>
            </div>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>字符串上色</h3>
                <p>控制台常用字符串颜色。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">启用上色</div>
                </div>
                <div class="nx-row__control">
                    <button
                        class="nx-toggle"
                        :class="{ on: s.terminalHighlightEnabled !== false }"
                        @click="update({ terminalHighlightEnabled: s.terminalHighlightEnabled === false })"
                    />
                </div>
            </div>

            <div class="nx-row nx-row--top">
                <div class="nx-row__text">
                    <div class="nx-row__label">规则</div>
                    <div class="nx-row__desc">选中背景仍使用终端选区颜色</div>
                </div>
                <div class="nx-row__control nx-row__control--stack highlight-control">
                    <div class="highlight-rules-head">
                        <span>{{ highlightRules.length }} 条规则</span>
                    </div>
                    <div class="highlight-rules" role="list">
                        <div v-for="rule in highlightRules" :key="rule.id" class="highlight-rule">
                            <button
                                type="button"
                                class="highlight-rule__toggle"
                                :class="{ on: rule.enabled }"
                                :title="rule.enabled ? '已启用' : '已停用'"
                                @click="patchHighlightRule(rule.id, { enabled: !rule.enabled })"
                            />
                            <input
                                class="nx-input highlight-rule__name"
                                :value="rule.label"
                                placeholder="规则名称"
                                @change="patchHighlightRule(rule.id, { label: $event.target.value })"
                            />
                            <input
                                class="nx-input highlight-rule__text"
                                :value="rule.text"
                                placeholder="匹配内容"
                                @change="patchHighlightRule(rule.id, { text: $event.target.value })"
                            />
                            <input
                                class="highlight-rule__color"
                                type="color"
                                :value="rule.color"
                                title="颜色"
                                @input="patchHighlightRule(rule.id, { color: $event.target.value })"
                            />
                            <button
                                type="button"
                                class="highlight-rule__case"
                                :class="{ active: rule.mode === 'regex' }"
                                title="正则匹配"
                                @click="patchHighlightRule(rule.id, { mode: rule.mode === 'regex' ? 'text' : 'regex' })"
                            >
                                .*
                            </button>
                            <button
                                type="button"
                                class="highlight-rule__case"
                                :class="{ active: rule.caseSensitive }"
                                title="区分大小写"
                                @click="patchHighlightRule(rule.id, { caseSensitive: !rule.caseSensitive })"
                            >
                                Aa
                            </button>
                            <button
                                v-if="isBuiltinRule(rule.id)"
                                type="button"
                                class="highlight-rule__icon"
                                title="内置规则不可删除"
                                disabled
                            >
                                <Lock :size="14" :stroke-width="1.9" />
                            </button>
                            <button v-else type="button" class="highlight-rule__icon" title="删除" @click="removeHighlightRule(rule.id)">
                                <Trash2 :size="14" :stroke-width="1.9" />
                            </button>
                        </div>
                    </div>
                    <div class="highlight-actions">
                        <button type="button" class="nx-button highlight-add" @click="addHighlightRule">
                            <Plus :size="14" :stroke-width="1.9" />
                            <span>添加</span>
                        </button>
                        <button type="button" class="nx-button" @click="resetHighlightRules">恢复默认</button>
                    </div>
                </div>
            </div>
        </section>
    </div>
</template>

<script setup>
    import { computed } from 'vue';
    import { Lock, Plus, Trash2 } from '@lucide/vue';
    import { store, updateSettings } from '../../store';
    import {
        createDefaultTerminalHighlightRules,
        isDefaultTerminalHighlightRule,
        normalizeHexColor,
        normalizeTerminalHighlightMode,
        normalizeTerminalHighlightRules
    } from '../../services/terminalHighlightRules';

    const s = store.settings;
    const highlightRules = computed(() => normalizeTerminalHighlightRules(s.terminalHighlightRules));

    function update(patch) {
        updateSettings(patch);
    }

    function clamp(v) {
        return Math.min(100000, Math.max(100, Number(v) || 1000));
    }

    function saveHighlightRules(rules) {
        update({ terminalHighlightRules: rules });
    }

    function patchHighlightRule(id, patch) {
        const rules = highlightRules.value.map(rule =>
            rule.id === id
                ? {
                      ...rule,
                      ...patch,
                      label:
                          patch.label !== undefined
                              ? String(patch.label || '').trim() || rule.label || '自定义规则'
                              : rule.label,
                      color: patch.color !== undefined ? normalizeHexColor(patch.color, rule.color) : rule.color,
                      mode: patch.mode !== undefined ? normalizeTerminalHighlightMode(patch.mode) : rule.mode
                  }
                : rule
        );
        saveHighlightRules(rules);
    }

    function addHighlightRule() {
        saveHighlightRules([
            ...highlightRules.value,
            {
                id: `highlight-${Date.now().toString(36)}`,
                label: '自定义规则',
                text: 'keyword',
                mode: 'text',
                color: '#38bdf8',
                enabled: true,
                caseSensitive: false
            }
        ]);
    }

    function isBuiltinRule(id) {
        return isDefaultTerminalHighlightRule(id);
    }

    function removeHighlightRule(id) {
        if (isBuiltinRule(id)) return;
        saveHighlightRules(highlightRules.value.filter(rule => rule.id !== id));
    }

    function resetHighlightRules() {
        saveHighlightRules(createDefaultTerminalHighlightRules());
    }
</script>

<style scoped>
    .nx-row--top {
        align-items: start;
        grid-template-columns: minmax(130px, 180px) minmax(0, 1fr);
    }
    .highlight-control {
        width: 100%;
        min-width: 0;
    }
    .highlight-rules-head {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        width: 100%;
        min-height: 20px;
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    .highlight-rules {
        width: 100%;
        max-height: 260px;
        overflow-y: auto;
        overflow-x: hidden;
        display: grid;
        gap: 6px;
        padding-right: 4px;
        scrollbar-gutter: stable;
    }
    .highlight-rule {
        display: grid;
        grid-template-columns: 22px minmax(88px, 0.42fr) minmax(150px, 1fr) 34px 30px 30px 30px;
        align-items: center;
        gap: 6px;
        width: 100%;
    }
    .highlight-rule__toggle {
        width: 22px;
        height: 22px;
        border: 1px solid var(--nx-border);
        border-radius: 50%;
        background: transparent;
        cursor: pointer;
        position: relative;
    }
    .highlight-rule__toggle.on {
        border-color: var(--nx-accent);
        background: var(--nx-accent);
    }
    .highlight-rule__toggle.on::after {
        content: '';
        position: absolute;
        inset: 5px;
        border-radius: 50%;
        background: var(--nx-accent-text);
    }
    .highlight-rule__name,
    .highlight-rule__text {
        width: 100%;
        min-width: 0;
    }
    .highlight-rule__name {
        font-weight: 650;
    }
    .highlight-rule__color {
        width: 34px;
        height: 32px;
        padding: 2px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-bg);
        cursor: pointer;
    }
    .highlight-rule__case,
    .highlight-rule__icon {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-surface-2);
        color: var(--nx-text-dim);
        cursor: pointer;
    }
    .highlight-rule__case {
        font-size: 11px;
        font-weight: 700;
    }
    .highlight-rule__icon {
        color: var(--nx-icon);
    }
    .highlight-rule__case.active,
    .highlight-rule__case:hover {
        border-color: var(--nx-accent);
        color: var(--nx-accent);
    }
    .highlight-rule__icon:hover {
        border-color: var(--nx-accent);
        color: var(--nx-icon);
    }
    .highlight-rule__icon:disabled {
        cursor: default;
        opacity: 0.58;
    }
    .highlight-rule__icon:disabled:hover {
        border-color: var(--nx-border);
    }
    .highlight-actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        width: 100%;
    }
    .highlight-add {
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
</style>
