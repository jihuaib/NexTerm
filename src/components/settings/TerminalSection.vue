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
                    <button class="nx-toggle" :class="{ on: s.cursorBlink }" @click="update({ cursorBlink: !s.cursorBlink })"></button>
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">光标样式</div>
                </div>
                <div class="nx-row__control">
                    <select class="nx-select" :value="s.cursorStyle" @change="update({ cursorStyle: $event.target.value })">
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
    </div>
</template>

<script setup>
import { store, updateSettings } from '../../store';

const s = store.settings;

function update(patch) {
    updateSettings(patch);
}

function clamp(v) {
    return Math.min(100000, Math.max(100, Number(v) || 1000));
}
</script>
