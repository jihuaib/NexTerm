<template>
    <Teleport to="body">
        <TransitionGroup name="toast" tag="div" class="toast-viewport" aria-live="polite">
            <section
                v-for="item in notifications"
                :key="item.id"
                class="toast"
                :class="`toast--${item.type}`"
                :role="item.type === 'error' ? 'alert' : 'status'"
            >
                <component :is="iconFor(item.type)" class="toast__icon" :size="17" :stroke-width="2" />
                <div class="toast__copy">
                    <strong v-if="item.title">{{ item.title }}</strong>
                    <span>{{ item.message }}</span>
                </div>
                <button class="toast__close" type="button" title="关闭" @click="dismissNotification(item.id)">
                    <X :size="14" :stroke-width="2" />
                </button>
            </section>
        </TransitionGroup>
    </Teleport>
</template>

<script setup>
    import { CircleAlert, CircleCheck, Info, X } from '@lucide/vue';
    import { dismissNotification, notifications } from '../../services/notify';

    function iconFor(type) {
        if (type === 'success') return CircleCheck;
        if (type === 'error') return CircleAlert;
        return Info;
    }
</script>

<style scoped>
    .toast-viewport {
        position: fixed;
        z-index: 500;
        top: 64px;
        right: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: min(360px, calc(100vw - 32px));
        pointer-events: none;
    }
    .toast {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: flex-start;
        gap: 10px;
        min-height: 44px;
        padding: 11px 10px 11px 12px;
        border: 1px solid var(--nx-border);
        border-radius: 8px;
        background: var(--nx-surface-raised);
        color: var(--nx-text);
        box-shadow: 0 14px 38px rgba(0, 0, 0, 0.34);
        pointer-events: auto;
    }
    .toast__icon {
        margin-top: 1px;
        color: var(--nx-accent);
    }
    .toast--success .toast__icon {
        color: #3fbf73;
    }
    .toast--error {
        border-color: var(--nx-danger-border);
    }
    .toast--error .toast__icon {
        color: var(--nx-danger);
    }
    .toast__copy {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
        line-height: 1.35;
        user-select: text;
    }
    .toast__copy strong {
        font-size: 12px;
        letter-spacing: 0;
    }
    .toast__copy span {
        color: var(--nx-text-dim);
        font-size: 12px;
        overflow-wrap: anywhere;
    }
    .toast__close {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: var(--nx-text-dim);
        cursor: pointer;
    }
    .toast__close:hover {
        border-color: var(--nx-border);
        color: var(--nx-text);
    }
    .toast-enter-active,
    .toast-leave-active {
        transition:
            opacity 0.16s ease,
            transform 0.16s ease;
    }
    .toast-enter-from,
    .toast-leave-to {
        opacity: 0;
        transform: translateY(-8px);
    }

    @media (max-width: 560px) {
        .toast-viewport {
            top: 58px;
            right: 10px;
            left: 10px;
            width: auto;
        }
    }
</style>
