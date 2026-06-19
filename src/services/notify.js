import { reactive } from 'vue';

const DEFAULT_DURATION = 3600;
const MAX_ITEMS = 4;

let nextId = 1;

export const notifications = reactive([]);

export function dismissNotification(id) {
    const index = notifications.findIndex(item => item.id === id);
    if (index < 0) return;
    const [item] = notifications.splice(index, 1);
    if (item.timer) window.clearTimeout(item.timer);
}

export function notify({ type = 'info', title = '', message = '', duration = DEFAULT_DURATION } = {}) {
    const text = String(message || title || '').trim();
    if (!text) return null;

    const item = {
        id: `notice-${Date.now().toString(36)}-${nextId++}`,
        type,
        title: title ? String(title) : '',
        message: text,
        timer: null
    };

    notifications.unshift(item);
    while (notifications.length > MAX_ITEMS) {
        dismissNotification(notifications[notifications.length - 1].id);
    }

    if (duration > 0) {
        item.timer = window.setTimeout(() => dismissNotification(item.id), duration);
    }

    return item.id;
}

export function notifyError(message, title = '操作失败') {
    return notify({ type: 'error', title, message, duration: 4600 });
}

export function notifySuccess(message, title = '') {
    return notify({ type: 'success', title, message, duration: 2600 });
}
