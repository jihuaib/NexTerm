import { reactive } from 'vue';

export function useFieldErrors() {
    const fieldErrors = reactive({});

    function setFieldError(field, message = true) {
        if (!field) return;
        fieldErrors[field] = message || true;
    }

    function clearFieldError(field) {
        if (!field) return;
        delete fieldErrors[field];
    }

    function clearFieldErrors() {
        Object.keys(fieldErrors).forEach(field => {
            delete fieldErrors[field];
        });
    }

    function hasFieldError(field) {
        return Boolean(fieldErrors[field]);
    }

    return {
        fieldErrors,
        setFieldError,
        clearFieldError,
        clearFieldErrors,
        hasFieldError
    };
}
