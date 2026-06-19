// 统一事件发送器：主进程 -> 渲染进程，统一走 'unified-event' 频道
class EventDispatcher {
    constructor() {
        this.webContents = null;
    }

    setWebContents(webContents) {
        this.webContents = webContents;
    }

    canEmit() {
        return this.webContents && !this.webContents.isDestroyed();
    }

    emit(type, data) {
        if (!this.canEmit()) return;
        try {
            this.webContents.send('unified-event', { type, data });
        } catch (err) {
            // 窗口已销毁等情况静默忽略
        }
    }

    cleanup() {
        this.webContents = null;
    }
}

module.exports = EventDispatcher;
