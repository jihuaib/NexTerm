import { createApp } from 'vue';
import App from './App.vue';
import './styles/tokens.css';
import './styles/forms.css';
import '@xterm/xterm/css/xterm.css';
import { ensureRuntimeApis } from './runtimeApis';
import { initEventBridge } from './utils/eventBus';
import { initScriptTaskEvents, loadPortForwards, loadScripts, loadSettings, loadSessionFolders, loadSessions } from './store';

ensureRuntimeApis();
initEventBridge();
initScriptTaskEvents();

Promise.all([loadSettings(), loadSessionFolders(), loadSessions(), loadScripts(), loadPortForwards()]).finally(() => {
    createApp(App).mount('#app');
});
