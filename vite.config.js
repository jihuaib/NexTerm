import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

function normalizeModuleId(id) {
    return id.split('\\').join('/');
}

function manualChunks(id) {
    const normalizedId = normalizeModuleId(id);
    if (!normalizedId.includes('/node_modules/')) return undefined;
    if (normalizedId.includes('/node_modules/@vue/') || normalizedId.includes('/node_modules/vue/')) {
        return 'vue-vendor';
    }
    if (normalizedId.includes('/node_modules/@xterm/')) {
        return 'xterm-vendor';
    }
    if (normalizedId.includes('/node_modules/@lucide/vue/')) {
        return 'icons-vendor';
    }
    return 'vendor';
}

// base 设为相对路径，保证 Electron 生产环境用 file:// 加载 dist/index.html 时资源可用
export default defineConfig({
    base: './',
    plugins: [vue()],
    server: {
        port: 5273,
        strictPort: true,
        host: '127.0.0.1',
        watch: {
            ignored: ['**/release/**']
        }
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            output: {
                manualChunks
            }
        }
    }
});
