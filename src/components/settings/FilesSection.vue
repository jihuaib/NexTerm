<template>
    <div class="nx-settings">
        <section class="nx-group">
            <div class="nx-group__head">
                <h3>目录同步</h3>
                <p>文件面板与 SSH 控制台之间的目录关系。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">跟随控制台目录</div>
                    <div class="nx-row__desc">切换 SSH 会话目录时同步 SFTP 当前目录</div>
                </div>
                <div class="nx-row__control">
                    <button
                        class="nx-toggle"
                        :class="{ on: s.sftpFollowConsole }"
                        :aria-pressed="s.sftpFollowConsole ? 'true' : 'false'"
                        @click="update({ sftpFollowConsole: !s.sftpFollowConsole })"
                    ></button>
                </div>
            </div>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>显示</h3>
                <p>SFTP 当前目录列表的显示规则。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">显示隐藏文件</div>
                    <div class="nx-row__desc">显示以点号开头的远程文件和目录</div>
                </div>
                <div class="nx-row__control">
                    <button
                        class="nx-toggle"
                        :class="{ on: s.sftpShowHiddenFiles }"
                        :aria-pressed="s.sftpShowHiddenFiles ? 'true' : 'false'"
                        @click="update({ sftpShowHiddenFiles: !s.sftpShowHiddenFiles })"
                    ></button>
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
</script>
