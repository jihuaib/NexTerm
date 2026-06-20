<template>
    <div class="nx-settings">
        <section class="nx-group">
            <div class="nx-group__head">
                <h3>新建会话</h3>
                <p>会话创建表单的默认值。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">默认协议</div>
                    <div class="nx-row__desc">新建会话时的默认协议</div>
                </div>
                <div class="nx-row__control">
                    <select
                        class="nx-select"
                        :value="s.defaultProtocol"
                        @change="update({ defaultProtocol: $event.target.value })"
                    >
                        <option value="telnet">Telnet</option>
                        <option value="ssh">SSH / SFTP</option>
                        <option value="local">Local Shell</option>
                    </select>
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">默认 Telnet 端口</div>
                    <div class="nx-row__desc">新建 Telnet 会话时预填的端口</div>
                </div>
                <div class="nx-row__control">
                    <input
                        class="nx-input nx-input--num"
                        type="number"
                        min="1"
                        max="65535"
                        :value="s.defaultPort"
                        @change="update({ defaultPort: clamp($event.target.value) })"
                    />
                </div>
            </div>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>Local Shell</h3>
                <p>本地终端会话的默认启动参数。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">默认本地 Shell</div>
                    <div class="nx-row__desc">Local Shell 会话留空时使用系统默认 Shell</div>
                </div>
                <div class="nx-row__control">
                    <input
                        class="nx-input nx-input--path"
                        :value="s.defaultLocalShell"
                        placeholder="/bin/zsh、powershell.exe、cmd.exe"
                        @change="update({ defaultLocalShell: $event.target.value.trim() })"
                    />
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">默认工作目录</div>
                    <div class="nx-row__desc">新建 Local Shell 会话时预填</div>
                </div>
                <div class="nx-row__control">
                    <input
                        class="nx-input nx-input--path"
                        :value="s.defaultLocalCwd"
                        placeholder="默认使用用户主目录"
                        @change="update({ defaultLocalCwd: $event.target.value.trim() })"
                    />
                </div>
            </div>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>重连</h3>
                <p>远程会话断开后的自动恢复策略。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">断线自动重连</div>
                    <div class="nx-row__desc">仅对 SSH / Telnet 生效，认证失败不会自动重试</div>
                </div>
                <div class="nx-row__control">
                    <button
                        class="nx-toggle"
                        :class="{ on: s.connectionAutoReconnect }"
                        :aria-pressed="s.connectionAutoReconnect ? 'true' : 'false'"
                        @click="update({ connectionAutoReconnect: !s.connectionAutoReconnect })"
                    />
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">重连间隔</div>
                    <div class="nx-row__desc">每次断开后等待的秒数</div>
                </div>
                <div class="nx-row__control">
                    <input
                        class="nx-input nx-input--num"
                        type="number"
                        min="1"
                        max="60"
                        :value="s.connectionReconnectDelay"
                        @change="update({ connectionReconnectDelay: clampDelay($event.target.value) })"
                    />
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">最大重连次数</div>
                    <div class="nx-row__desc">超过次数后保持失败状态，等待手动重连</div>
                </div>
                <div class="nx-row__control">
                    <input
                        class="nx-input nx-input--num"
                        type="number"
                        min="1"
                        max="20"
                        :value="s.connectionReconnectMaxAttempts"
                        @change="update({ connectionReconnectMaxAttempts: clampAttempts($event.target.value) })"
                    />
                </div>
            </div>
        </section>

        <section class="nx-group">
            <div class="nx-group__head">
                <h3>SSH 安全</h3>
                <p>连接 SSH 主机时校验服务端主机指纹。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">known_hosts 校验</div>
                    <div class="nx-row__desc">首次连接记录指纹，后续变化会阻止连接</div>
                </div>
                <div class="nx-row__control">
                    <button
                        class="nx-toggle"
                        :class="{ on: s.sshKnownHostsEnabled }"
                        :aria-pressed="s.sshKnownHostsEnabled ? 'true' : 'false'"
                        @click="update({ sshKnownHostsEnabled: !s.sshKnownHostsEnabled })"
                    />
                </div>
            </div>

            <p class="security-note">已信任主机记录可在主页面 Known Host 中管理。</p>
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
        return Math.min(65535, Math.max(1, Number(v) || 23));
    }

    function clampDelay(v) {
        return Math.min(60, Math.max(1, Number(v) || 3));
    }

    function clampAttempts(v) {
        return Math.min(20, Math.max(1, Number(v) || 5));
    }
</script>

<style scoped>
    .security-note {
        margin: 0;
        padding: 0 0 12px;
        color: var(--nx-text-dim);
        font-size: 11px;
    }
</style>
