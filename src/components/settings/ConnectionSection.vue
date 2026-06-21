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
                        <option value="serial">Serial</option>
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
                <h3>Serial</h3>
                <p>新建串口会话时预填的通信参数。</p>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">默认波特率</div>
                    <div class="nx-row__desc">常见设备使用 115200 或 9600</div>
                </div>
                <div class="nx-row__control">
                    <input
                        class="nx-input nx-input--num"
                        type="number"
                        min="1"
                        :value="s.defaultSerialBaudRate"
                        @change="update({ defaultSerialBaudRate: clampBaud($event.target.value) })"
                    />
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">数据位 / 停止位</div>
                    <div class="nx-row__desc">默认 8N1：8 数据位、无校验、1 停止位</div>
                </div>
                <div class="nx-row__control serial-defaults">
                    <select
                        class="nx-select"
                        :value="s.defaultSerialDataBits"
                        @change="update({ defaultSerialDataBits: clampDataBits($event.target.value) })"
                    >
                        <option value="5">5</option>
                        <option value="6">6</option>
                        <option value="7">7</option>
                        <option value="8">8</option>
                    </select>
                    <select
                        class="nx-select"
                        :value="s.defaultSerialStopBits"
                        @change="update({ defaultSerialStopBits: clampStopBits($event.target.value) })"
                    >
                        <option value="1">1</option>
                        <option value="2">2</option>
                    </select>
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">校验 / 流控</div>
                    <div class="nx-row__desc">按设备手册选择 parity 和 flow control</div>
                </div>
                <div class="nx-row__control serial-defaults">
                    <select
                        class="nx-select"
                        :value="s.defaultSerialParity"
                        @change="update({ defaultSerialParity: normalizeParity($event.target.value) })"
                    >
                        <option value="none">None</option>
                        <option value="even">Even</option>
                        <option value="odd">Odd</option>
                        <option value="mark">Mark</option>
                        <option value="space">Space</option>
                    </select>
                    <select
                        class="nx-select"
                        :value="s.defaultSerialFlowControl"
                        @change="update({ defaultSerialFlowControl: normalizeFlowControl($event.target.value) })"
                    >
                        <option value="none">无</option>
                        <option value="hardware">RTS/CTS</option>
                        <option value="software">XON/XOFF</option>
                    </select>
                </div>
            </div>

            <div class="nx-row">
                <div class="nx-row__text">
                    <div class="nx-row__label">控制线</div>
                    <div class="nx-row__desc">打开串口后设置 DTR / RTS 状态</div>
                </div>
                <div class="nx-row__control serial-toggles">
                    <button
                        class="nx-toggle"
                        :class="{ on: s.defaultSerialDtr }"
                        :aria-pressed="s.defaultSerialDtr ? 'true' : 'false'"
                        title="DTR"
                        @click="update({ defaultSerialDtr: !s.defaultSerialDtr })"
                    />
                    <button
                        class="nx-toggle"
                        :class="{ on: s.defaultSerialRts }"
                        :aria-pressed="s.defaultSerialRts ? 'true' : 'false'"
                        title="RTS"
                        @click="update({ defaultSerialRts: !s.defaultSerialRts })"
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
                    <div class="nx-row__desc">对 SSH / Telnet / Serial 生效，认证失败不会自动重试</div>
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
                <h3>端口转发机制</h3>
                <p>Direct 不依赖 SSH，可选 TCP / UDP；SSH 模式复用已连接会话，断开 SSH 时会自动停止对应规则。</p>
            </div>

            <div class="forward-flow-grid">
                <div class="forward-flow">
                    <div class="forward-flow__title">
                        <Network :size="15" :stroke-width="1.9" />
                        <span>Direct</span>
                    </div>
                    <div class="forward-flow__path">
                        <span><Laptop :size="15" :stroke-width="1.9" /> 本机监听</span>
                        <ArrowRight :size="14" :stroke-width="1.9" />
                        <span><Route :size="15" :stroke-width="1.9" /> TCP / UDP</span>
                        <ArrowRight :size="14" :stroke-width="1.9" />
                        <span><Globe2 :size="15" :stroke-width="1.9" /> 目标端口</span>
                    </div>
                    <p>本机收到的 TCP 连接或 UDP 数据报直接转到目标 host:port，不建立 SSH 隧道。</p>
                </div>

                <div class="forward-flow">
                    <div class="forward-flow__title">
                        <Network :size="15" :stroke-width="1.9" />
                        <span>SSH Local</span>
                    </div>
                    <div class="forward-flow__path">
                        <span><Laptop :size="15" :stroke-width="1.9" /> 本机监听</span>
                        <ArrowRight :size="14" :stroke-width="1.9" />
                        <span><Server :size="15" :stroke-width="1.9" /> SSH</span>
                        <ArrowRight :size="14" :stroke-width="1.9" />
                        <span><Globe2 :size="15" :stroke-width="1.9" /> 远端目标</span>
                    </div>
                    <p>访问本机 TCP 端口，流量经 SSH 到远端网络里的目标地址。</p>
                </div>

                <div class="forward-flow">
                    <div class="forward-flow__title">
                        <Network :size="15" :stroke-width="1.9" />
                        <span>SSH Remote</span>
                    </div>
                    <div class="forward-flow__path">
                        <span><Globe2 :size="15" :stroke-width="1.9" /> 远端监听</span>
                        <ArrowRight :size="14" :stroke-width="1.9" />
                        <span><Server :size="15" :stroke-width="1.9" /> SSH</span>
                        <ArrowRight :size="14" :stroke-width="1.9" />
                        <span><Laptop :size="15" :stroke-width="1.9" /> 本机目标</span>
                    </div>
                    <p>远端主机开放 TCP 监听端口，进入的流量经 SSH 回到本机目标地址。</p>
                </div>

                <div class="forward-flow">
                    <div class="forward-flow__title">
                        <Network :size="15" :stroke-width="1.9" />
                        <span>SOCKS5</span>
                    </div>
                    <div class="forward-flow__path">
                        <span><Laptop :size="15" :stroke-width="1.9" /> 本机代理</span>
                        <ArrowRight :size="14" :stroke-width="1.9" />
                        <span><Server :size="15" :stroke-width="1.9" /> SSH</span>
                        <ArrowRight :size="14" :stroke-width="1.9" />
                        <span><Globe2 :size="15" :stroke-width="1.9" /> 动态目标</span>
                    </div>
                    <p>应用使用本机 SOCKS5 代理，每次连接的目标由代理请求动态决定。</p>
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
    import { ArrowRight, Globe2, Laptop, Network, Route, Server } from '@lucide/vue';
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

    function clampBaud(v) {
        return Math.max(1, Number(v) || 115200);
    }

    function clampDataBits(v) {
        const next = Number(v);
        return [5, 6, 7, 8].includes(next) ? next : 8;
    }

    function clampStopBits(v) {
        const next = Number(v);
        return [1, 2].includes(next) ? next : 1;
    }

    function normalizeParity(v) {
        return ['none', 'even', 'odd', 'mark', 'space'].includes(v) ? v : 'none';
    }

    function normalizeFlowControl(v) {
        return ['none', 'hardware', 'software'].includes(v) ? v : 'none';
    }
</script>

<style scoped>
    .serial-defaults {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
    }
    .serial-toggles {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
    }
    .forward-flow-grid {
        display: grid;
        gap: 10px;
        padding: 0 0 12px;
    }
    .forward-flow {
        display: grid;
        gap: 8px;
        padding: 10px;
        border: 1px solid var(--nx-border-soft);
        border-radius: 7px;
        background: var(--nx-control-muted);
    }
    .forward-flow__title {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: var(--nx-text);
        font-weight: 700;
        font-size: 12px;
    }
    .forward-flow__path {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    .forward-flow__path span {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-height: 24px;
        padding: 0 7px;
        border: 1px solid var(--nx-border);
        border-radius: 6px;
        background: var(--nx-bg);
        color: var(--nx-text);
        white-space: nowrap;
    }
    .forward-flow p {
        margin: 0;
        color: var(--nx-text-dim);
        font-size: 11px;
        line-height: 1.55;
    }
    .security-note {
        margin: 0;
        padding: 0 0 12px;
        color: var(--nx-text-dim);
        font-size: 11px;
    }
</style>
