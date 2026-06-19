// 统一 IPC 返回格式：{ status, msg, data }（对齐 NetNexus）
function successResponse(data = null, msg = '') {
    return { status: 'success', msg, data };
}

function errorResponse(msg = '', data = null) {
    return { status: 'error', msg, data };
}

module.exports = { successResponse, errorResponse };
