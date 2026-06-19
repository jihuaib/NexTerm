import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// base 设为相对路径，保证 Electron 生产环境用 file:// 加载 dist/index.html 时资源可用
export default defineConfig({
    base: './',
    plugins: [vue()],
    server: {
        port: 5273,
        strictPort: true,
        host: '127.0.0.1'
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true
    }
});
