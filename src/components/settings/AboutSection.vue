<template>
    <div class="about">
        <div class="logo">NexTerm</div>
        <p class="ver">版本 {{ currentVersion }} · 基础版</p>
        <p class="desc">跨平台远程接入终端。当前支持 SSH、Telnet、Local Shell、SFTP 文件面板与终端日志。</p>
        <ul class="roadmap">
            <li>规划中：串口</li>
            <li>规划中：隧道转发</li>
            <li>规划中：更多会话导入格式</li>
        </ul>
    </div>
</template>

<script setup>
    import { onMounted, ref } from 'vue';

    const currentVersion = ref('读取中');

    onMounted(async () => {
        try {
            const resp = await window.updaterApi?.getCurrentVersion?.();
            currentVersion.value = resp?.status === 'success' ? resp.data : '未知';
        } catch (_err) {
            currentVersion.value = '未知';
        }
    });
</script>

<style scoped>
    .about {
        padding-top: 10px;
    }
    .logo {
        font-size: 24px;
        font-weight: 700;
        letter-spacing: 1px;
    }
    .ver {
        color: var(--nx-text-dim);
        margin: 4px 0 16px;
    }
    .desc {
        line-height: 1.6;
    }
    .roadmap {
        margin-top: 14px;
        padding-left: 18px;
        color: var(--nx-text-dim);
        line-height: 1.9;
    }
</style>
