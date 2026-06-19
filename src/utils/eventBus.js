// 极简事件总线：订阅 preload 转发的 unified-event，按 type 分发给各组件
const handlers = new Map();

export const eventBus = {
    on(type, handler) {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type).add(handler);
        return () => this.off(type, handler);
    },
    off(type, handler) {
        if (handlers.has(type)) handlers.get(type).delete(handler);
    },
    emit(type, data) {
        if (handlers.has(type)) handlers.get(type).forEach(h => h(data));
    }
};

// 在应用启动时调用一次，把主进程事件接入总线
export function initEventBridge() {
    if (!window.terminalApi) return;
    window.terminalApi.onEvent(({ type, data }) => eventBus.emit(type, data));
}
