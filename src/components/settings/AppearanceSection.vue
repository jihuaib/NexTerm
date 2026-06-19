<template>
    <div class="nx-settings">
        <section class="nx-group">
            <div class="nx-group__head">
                <h3>主题</h3>
                <p>界面外壳和终端配色。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">主题</div>
                    <div class="nx-row__desc">同时应用到界面与终端配色</div>
                </div>
                <div class="nx-row__control">
                    <div class="nx-swatches">
                        <button
                            v-for="t in themes"
                            :key="t.id"
                            class="nx-swatch"
                            :class="{ active: t.id === s.themeId }"
                            :style="{ '--swatch-bg': t.bg, '--swatch-surface': t.surface, '--swatch-accent': t.accent }"
                            @click="update({ themeId: t.id })"
                        >
                            <span class="nx-swatch__chip">
                                <i />
                                <i />
                                <i />
                            </span>
                            <span>{{ t.name }}</span>
                        </button>
                    </div>
                </div>
            </div>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>字体</h3>
                <p>终端字体族和显示大小。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">字号</div>
                    <div class="nx-row__desc">终端文字大小（8-24）</div>
                </div>
                <div class="nx-row__control">
                    <button class="nx-step" @click="stepFont(-1)">-</button>
                    <span class="nx-step__val">{{ s.fontSize }}</span>
                    <button class="nx-step" @click="stepFont(1)">+</button>
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">字体</div>
                    <div class="nx-row__desc">等宽字体，跨平台回退</div>
                </div>
                <div class="nx-row__control">
                    <select
                        class="nx-select"
                        :value="s.fontFamily"
                        @change="update({ fontFamily: $event.target.value })"
                    >
                        <option v-for="f in fonts" :key="f.value" :value="f.value">{{ f.label }}</option>
                    </select>
                </div>
            </div>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>布局</h3>
                <p>主界面区域尺寸。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">会话侧栏宽度</div>
                    <div class="nx-row__desc">左侧会话集合与工作区的初始宽度</div>
                </div>
                <div class="nx-row__control">
                    <input
                        class="nx-input nx-input--num"
                        type="number"
                        min="220"
                        max="460"
                        step="10"
                        :value="s.sidebarWidth"
                        @change="update({ sidebarWidth: clampSidebarWidth($event.target.value) })"
                    />
                </div>
            </div>
        </section>
    </div>
</template>

<script setup>
    import { store, updateSettings } from '../../store';
    import { THEME_LIST, THEMES } from '../../theme/themes';

    const s = store.settings;
    const themes = THEME_LIST.map(t => ({
        ...t,
        bg: THEMES[t.id].app['--nx-bg'],
        surface: THEMES[t.id].app['--nx-surface'],
        accent: THEMES[t.id].app['--nx-accent']
    }));
    const fonts = [
        { label: 'Consolas / Menlo (默认)', value: "'Consolas', 'Menlo', 'DejaVu Sans Mono', monospace" },
        { label: 'Courier New', value: "'Courier New', monospace" },
        { label: 'Cascadia Code', value: "'Cascadia Code', 'Consolas', monospace" },
        { label: 'Monaco', value: "'Monaco', 'Menlo', monospace" }
    ];

    function update(patch) {
        updateSettings(patch);
    }

    function stepFont(delta) {
        update({ fontSize: Math.min(24, Math.max(8, s.fontSize + delta)) });
    }

    function clampSidebarWidth(v) {
        return Math.min(460, Math.max(220, Number(v) || 278));
    }
</script>
