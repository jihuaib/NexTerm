<template>
    <aside class="sidebar" @click="closeAllMenus">
        <nav class="rail" aria-label="资源面板">
            <IconButton
                v-for="panel in panels"
                :key="panel.id"
                :title="panel.label"
                variant="rail"
                :active="activePanel === panel.id"
                @click="activePanel = panel.id"
            >
                <component :is="panel.icon" :size="17" :stroke-width="1.8" />
            </IconButton>
        </nav>

        <div class="panel">
            <div class="head">
                <div>
                    <div class="head__title">{{ activeTitle }}</div>
                    <div class="head__count">{{ activeMeta }}</div>
                </div>
                <div v-if="activePanel === 'sessions'" class="head-actions">
                    <IconButton title="新建文件夹" @click.stop="promptCreateFolder">
                        <FolderPlus :size="17" :stroke-width="1.9" />
                    </IconButton>
                    <IconButton title="新建会话" @click.stop="openDialog()">
                        <Plus :size="17" :stroke-width="1.9" />
                    </IconButton>
                </div>
            </div>

            <template v-if="activePanel === 'sessions'">
                <div class="search">
                    <input v-model.trim="query" placeholder="搜索会话" />
                </div>

                <div class="session-panel">
                    <ResourceTree
                        :nodes="visibleSessionTreeNodes"
                        :selected-id="selectedSessionNodeId"
                        :drop-hover-id="dragHoverFolder"
                        @select="selectSessionNode"
                        @blank-contextmenu="event => openFolderMenu(event)"
                        @blank-drop="dropSessionToRoot"
                        @node-contextmenu="payload => openFolderMenu(payload.event, payload.node)"
                        @node-activate="activateTreeNode"
                        @node-dragstart="startTreeNodeDrag"
                        @node-dragenter="handleNodeDragEnter"
                        @node-dragleave="handleNodeDragLeave"
                        @node-drop="dropSessionToNode"
                    />

                    <EmptyState v-if="treeIsEmpty" :text="emptyText">
                        <button v-if="store.sessions.length === 0" @click="openDialog()">新建</button>
                    </EmptyState>
                </div>
            </template>

            <template v-else-if="activePanel === 'files'">
                <div
                    class="file-panel"
                    :class="{ 'is-file-dragging': fileDragActive }"
                    @dragenter="handleFilePanelDragEnter"
                    @dragover="handleFilePanelDragOver"
                    @dragleave="handleFilePanelDragLeave"
                    @drop="dropLocalFilesToCurrent"
                >
                    <div class="file-toolbar">
                        <select v-model="fileSessionId" :disabled="availableSshSessions.length === 0">
                            <option value="">选择 SSH 会话</option>
                            <option
                                v-for="session in availableSshSessions"
                                :key="session.sessionId"
                                :value="session.sessionId"
                            >
                                {{ session.name }} · {{ session.username || 'ssh' }}@{{ session.host }}
                            </option>
                        </select>
                        <IconButton
                            :title="sftpFollowConsole ? '已跟随控制台目录' : '未跟随控制台目录'"
                            :active="sftpFollowConsole"
                            @click="sftpFollowConsole = !sftpFollowConsole"
                        >
                            <LocateFixed :size="15" :stroke-width="1.9" />
                        </IconButton>
                    </div>
                    <div class="file-actions">
                        <IconButton
                            title="上级目录"
                            :disabled="!fileSessionId || remotePath === '/'"
                            @click="goRemoteParent"
                        >
                            <ArrowUp :size="15" :stroke-width="1.9" />
                        </IconButton>
                        <IconButton title="刷新目录" :disabled="!fileSessionId" @click="refreshRemoteFiles">
                            <RefreshCw :size="15" :stroke-width="1.9" />
                        </IconButton>
                        <IconButton
                            title="上传到当前目录"
                            :disabled="!fileSessionId || sftpUploading"
                            @click="uploadToRemote"
                        >
                            <Upload :size="15" :stroke-width="1.9" />
                        </IconButton>
                        <div class="file-path" :title="remotePath">{{ remotePath }}</div>
                    </div>
                    <ResourceTree
                        v-if="fileSessionId"
                        :nodes="currentRemoteEntries"
                        :selected-id="selectedFileNodeId"
                        :drop-hover-id="fileDropHoverId"
                        @select="selectFileNode"
                        @blank-contextmenu="event => openFileMenu(event)"
                        @node-activate="activateFileNode"
                        @node-contextmenu="payload => openFileMenu(payload.event, payload.node)"
                        @blank-drop="dropLocalFilesToCurrent"
                        @node-dragenter="handleFileNodeDragEnter"
                        @node-dragleave="handleFileNodeDragLeave"
                        @node-drop="dropLocalFilesToNode"
                    />
                    <div
                        v-if="sftpProgress.visible"
                        class="file-progress"
                        :class="{ error: sftpProgress.phase === 'error' }"
                    >
                        <div class="file-progress__line">
                            <span>{{ sftpProgressText }}</span>
                            <strong>{{ sftpProgressPercent }}</strong>
                        </div>
                        <div class="file-progress__bar">
                            <i :style="{ width: `${sftpProgressBarWidth}%` }" />
                        </div>
                    </div>
                    <div v-if="fileDragActive" class="file-drop-overlay">
                        <Upload :size="18" :stroke-width="1.9" />
                        <span>上传到 {{ fileDropTargetPath }}</span>
                    </div>
                    <div v-if="!fileSessionId" class="file-empty">
                        <div class="file-empty__glyph">
                            <span />
                            <span />
                            <span />
                        </div>
                        <h3>等待 SSH 会话</h3>
                        <p>打开 SSH 会话后，这里会显示当前远程目录。</p>
                    </div>
                    <div v-else-if="fileBusy" class="file-loading">
                        {{
                            sftpUploading ? '正在上传文件…' : sftpOperating ? '正在执行文件操作…' : '正在读取远程目录…'
                        }}
                    </div>
                    <div v-else-if="currentRemoteEntries.length === 0" class="file-empty compact">
                        <h3>目录为空</h3>
                        <p>{{ remotePath }}</p>
                    </div>
                </div>
            </template>

            <ScriptWorkbench v-else-if="activePanel === 'scripts'" />
            <div v-else-if="activePanel === 'keychain'" class="security-panel">
                <KeychainSection />
            </div>
            <div v-else-if="activePanel === 'known-host'" class="security-panel">
                <KnownHostsSection />
            </div>
        </div>

        <ContextMenu :visible="folderMenu.visible" :x="folderMenu.x" :y="folderMenu.y">
            <button v-if="contextSession" @click="connectContextSession">
                <Play :size="14" :stroke-width="1.9" />
                <span>连接</span>
            </button>
            <button v-if="contextSession" @click="editContextSession">
                <Pencil :size="14" :stroke-width="1.9" />
                <span>编辑</span>
            </button>
            <button v-if="contextSession" @click="deleteContextSession">
                <Trash2 :size="14" :stroke-width="1.9" />
                <span>删除</span>
            </button>
            <button v-if="!contextSession" @click="createSessionInContext">
                <Plus :size="14" :stroke-width="1.9" />
                <span>新建会话</span>
            </button>
            <button v-if="!contextSession" @click="promptCreateFolder">
                <FolderPlus :size="14" :stroke-width="1.9" />
                <span>新建文件夹</span>
            </button>
            <button v-if="contextFolder" class="danger-menu-item" @click="requestDeleteContextFolder">
                <Trash2 :size="14" :stroke-width="1.9" />
                <span>删除文件夹</span>
            </button>
        </ContextMenu>

        <ContextMenu :visible="fileMenu.visible" :x="fileMenu.x" :y="fileMenu.y">
            <button :disabled="!fileSessionId" @click="openRemoteFolderDialog">
                <FolderPlus :size="14" :stroke-width="1.9" />
                <span>新建目录</span>
            </button>
            <button :disabled="!canRenameSelected" @click="requestRenameRemote">
                <Pencil :size="14" :stroke-width="1.9" />
                <span>重命名</span>
            </button>
            <button :disabled="!canDownloadSelected" @click="downloadSelectedRemote">
                <Download :size="14" :stroke-width="1.9" />
                <span>下载</span>
            </button>
            <button :disabled="!fileSessionId" @click="uploadToRemote">
                <Upload :size="14" :stroke-width="1.9" />
                <span>上传</span>
            </button>
            <button :disabled="!canDeleteSelected" class="danger-menu-item" @click="requestDeleteRemote">
                <Trash2 :size="14" :stroke-width="1.9" />
                <span>删除</span>
            </button>
        </ContextMenu>

        <BaseDialog
            v-if="folderDialogVisible"
            title="新建文件夹"
            :subtitle="folderDialogSubtitle"
            width="360px"
            z-index="130"
            @close="closeFolderDialog"
        >
            <label class="folder-field" :class="{ 'is-invalid': hasFolderFieldError('name') }">
                <span>文件夹名称</span>
                <input
                    ref="folderNameInput"
                    v-model="folderName"
                    placeholder="请输入文件夹名称"
                    :aria-invalid="hasFolderFieldError('name') ? 'true' : 'false'"
                    @input="clearFolderFieldError('name')"
                    @keydown.enter="submitFolderDialog"
                />
            </label>

            <template #footer>
                <button class="ghost" type="button" @click="closeFolderDialog">取消</button>
                <button class="primary" type="button" :disabled="folderSubmitting" @click="submitFolderDialog">
                    {{ folderSubmitting ? '创建中' : '创建' }}
                </button>
            </template>
        </BaseDialog>

        <SessionDialog v-if="dialogVisible" :session="editing" :folder-id="dialogFolderId" @close="closeDialog" />

        <BaseDialog
            v-if="deleteFolderDialogVisible"
            title="删除文件夹"
            :subtitle="deleteFolderSubtitle"
            width="380px"
            z-index="130"
            @close="closeDeleteFolderDialog"
        >
            <p class="delete-folder-copy">删除后，该文件夹、子文件夹以及其中的所有会话连接配置都会被删除。</p>

            <template #footer>
                <button class="ghost" type="button" @click="closeDeleteFolderDialog">取消</button>
                <button class="danger-action" type="button" :disabled="folderDeleting" @click="confirmDeleteFolder">
                    {{ folderDeleting ? '删除中' : '删除' }}
                </button>
            </template>
        </BaseDialog>

        <BaseDialog
            v-if="remoteFolderDialogVisible"
            title="新建远程目录"
            :subtitle="remotePath"
            width="360px"
            z-index="130"
            @close="closeRemoteFolderDialog"
        >
            <label class="folder-field" :class="{ 'is-invalid': hasFileFieldError('folderName') }">
                <span>目录名称</span>
                <input
                    ref="remoteFolderInput"
                    v-model="remoteFolderName"
                    placeholder="请输入目录名称"
                    :aria-invalid="hasFileFieldError('folderName') ? 'true' : 'false'"
                    @input="clearFileFieldError('folderName')"
                    @keydown.enter="confirmCreateRemoteFolder"
                />
            </label>

            <template #footer>
                <button class="ghost" type="button" @click="closeRemoteFolderDialog">取消</button>
                <button class="primary" type="button" :disabled="sftpOperating" @click="confirmCreateRemoteFolder">
                    {{ sftpOperating ? '创建中' : '创建' }}
                </button>
            </template>
        </BaseDialog>

        <BaseDialog
            v-if="remoteRenameDialogVisible"
            title="重命名远程项"
            :subtitle="remoteRenameTarget?.path || ''"
            width="380px"
            z-index="130"
            @close="closeRemoteRenameDialog"
        >
            <label class="folder-field" :class="{ 'is-invalid': hasFileFieldError('renameName') }">
                <span>新名称</span>
                <input
                    ref="remoteRenameInput"
                    v-model="remoteRenameName"
                    placeholder="请输入新名称"
                    :aria-invalid="hasFileFieldError('renameName') ? 'true' : 'false'"
                    @input="clearFileFieldError('renameName')"
                    @keydown.enter="confirmRenameRemote"
                />
            </label>

            <template #footer>
                <button class="ghost" type="button" @click="closeRemoteRenameDialog">取消</button>
                <button class="primary" type="button" :disabled="sftpOperating" @click="confirmRenameRemote">
                    {{ sftpOperating ? '重命名中' : '重命名' }}
                </button>
            </template>
        </BaseDialog>

        <BaseDialog
            v-if="remoteDeleteDialogVisible"
            title="删除远程项"
            :subtitle="remoteDeleteSubtitle"
            width="380px"
            z-index="130"
            @close="closeRemoteDeleteDialog"
        >
            <p class="delete-folder-copy">{{ remoteDeleteCopy }}</p>

            <template #footer>
                <button class="ghost" type="button" @click="closeRemoteDeleteDialog">取消</button>
                <button class="danger-action" type="button" :disabled="sftpOperating" @click="confirmDeleteRemote">
                    {{ sftpOperating ? '删除中' : '删除' }}
                </button>
            </template>
        </BaseDialog>
    </aside>
</template>

<script setup>
    import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
    import {
        ArrowUp,
        Download,
        FileCode,
        Files,
        Fingerprint,
        FolderPlus,
        FolderTree,
        KeyRound,
        LocateFixed,
        Pencil,
        Play,
        Plus,
        RefreshCw,
        Trash2,
        Upload
    } from '@lucide/vue';
    import {
        UNGROUPED_FOLDER_ID,
        createSessionFolder,
        deleteSession,
        deleteSessionFolder,
        getCreateFolderId,
        moveSessionToFolder,
        openSession,
        selectSessionFolder,
        store,
        updateSettings
    } from '../store';
    import { collectSessions } from '../layout';
    import { FILE_ROOT_ID, RESOURCE_NODE_TYPES, normalizeFileEntry } from '../models/resources';
    import { eventBus } from '../utils/eventBus';
    import { notifyError, notifySuccess } from '../services/notify';
    import { useFieldErrors } from '../utils/formErrors';
    import ResourceTree from './resource/ResourceTree.vue';
    import BaseDialog from './ui/BaseDialog.vue';
    import ContextMenu from './ui/ContextMenu.vue';
    import EmptyState from './ui/EmptyState.vue';
    import IconButton from './ui/IconButton.vue';
    import KeychainSection from './settings/KeychainSection.vue';
    import KnownHostsSection from './settings/KnownHostsSection.vue';
    import ScriptWorkbench from './ScriptWorkbench.vue';
    import SessionDialog from './SessionDialog.vue';

    const SAVED_SESSION_DND = 'application/x-nexterm-saved-session';

    const activePanel = ref('sessions');
    const dialogVisible = ref(false);
    const dialogFolderId = ref(null);
    const deleteFolderDialogVisible = ref(false);
    const deleteFolderTarget = ref(null);
    const dragHoverFolder = ref('');
    const editing = ref(null);
    const folderDialogParentId = ref(null);
    const folderDialogVisible = ref(false);
    const folderMenu = ref({ visible: false, x: 0, y: 0, node: null });
    const folderName = ref('');
    const folderNameInput = ref(null);
    const folderSubmitting = ref(false);
    const folderDeleting = ref(false);
    const query = ref('');
    const selectedSessionNodeId = ref('');
    const fileSessionId = ref('');
    const remotePath = ref('/');
    const remoteFileTree = ref(createRemoteRoot('/'));
    const selectedFileNodeId = ref('');
    const sftpFollowConsole = computed({
        get: () => Boolean(store.settings.sftpFollowConsole),
        set: value => updateSettings({ sftpFollowConsole: Boolean(value) })
    });
    const sftpLoading = ref(false);
    const sftpUploading = ref(false);
    const sftpOperating = ref(false);
    const sftpCwdBySession = reactive({});
    const fileDragActive = ref(false);
    const fileDropHoverId = ref('');
    const fileDropTargetDir = ref('');
    const fileMenu = ref({ visible: false, x: 0, y: 0, node: null });
    const remoteFolderDialogVisible = ref(false);
    const remoteFolderName = ref('');
    const remoteFolderInput = ref(null);
    const remoteRenameDialogVisible = ref(false);
    const remoteRenameTarget = ref(null);
    const remoteRenameName = ref('');
    const remoteRenameInput = ref(null);
    const remoteDeleteDialogVisible = ref(false);
    const remoteDeleteTarget = ref(null);
    const sftpProgress = ref({
        visible: false,
        operation: '',
        phase: '',
        remotePath: '',
        name: '',
        transferred: 0,
        total: 0,
        msg: ''
    });
    let offSftpCwd = null;
    let offSftpProgress = null;
    let progressHideTimer = null;
    let fileSessionLoadToken = 0;
    const {
        setFieldError: setFolderFieldError,
        clearFieldError: clearFolderFieldError,
        clearFieldErrors: clearFolderFieldErrors,
        hasFieldError: hasFolderFieldError
    } = useFieldErrors();
    const {
        setFieldError: setFileFieldError,
        clearFieldError: clearFileFieldError,
        clearFieldErrors: clearFileFieldErrors,
        hasFieldError: hasFileFieldError
    } = useFieldErrors();

    const panels = [
        { id: 'sessions', label: '会话集', icon: FolderTree },
        { id: 'files', label: '文件', icon: Files },
        { id: 'scripts', label: '脚本', icon: FileCode },
        { id: 'keychain', label: 'Keychain', icon: KeyRound },
        { id: 'known-host', label: 'Known Host', icon: Fingerprint }
    ];

    const activeTitle = computed(() => panels.find(panel => panel.id === activePanel.value)?.label || '');
    const activeMeta = computed(() => {
        if (activePanel.value === 'sessions')
            return `${store.sessionFolders.length} 文件夹 · ${store.sessions.length} 会话`;
        if (activePanel.value === 'scripts') return `${store.scripts.length} 脚本 · ${store.scriptTasks.length} 任务`;
        if (activePanel.value === 'keychain') return '~/.ssh keys';
        if (activePanel.value === 'known-host') return '~/.ssh/known_hosts';
        return fileSessionId.value ? remotePath.value : '未连接';
    });
    const visibleSessionTreeNodes = computed(() => filterTreeNodes(store.sessionTree.children || [], query.value));
    const availableSshSessions = computed(() =>
        collectSessions(store.layout).filter(session => session.protocol === 'ssh' && session.status === 'connected')
    );
    const currentRemoteEntries = computed(() =>
        (remoteFileTree.value.children || [])
            .filter(entry => store.settings.sftpShowHiddenFiles || !String(entry.name || '').startsWith('.'))
            .map(entry => ({ ...entry, children: [] }))
    );
    const selectedFileNode = computed(
        () => currentRemoteEntries.value.find(entry => entry.id === selectedFileNodeId.value) || null
    );
    const canDownloadSelected = computed(() => Boolean(fileSessionId.value && selectedFileNode.value?.path));
    const canRenameSelected = computed(() => Boolean(fileSessionId.value && selectedFileNode.value?.path));
    const canDeleteSelected = computed(() => Boolean(fileSessionId.value && selectedFileNode.value?.path));
    const fileBusy = computed(() => sftpLoading.value || sftpUploading.value || sftpOperating.value);
    const fileDropTargetPath = computed(() => fileDropTargetDir.value || remotePath.value);
    const sftpProgressBarWidth = computed(() => {
        const total = Number(sftpProgress.value.total) || 0;
        const transferred = Number(sftpProgress.value.transferred) || 0;
        if (!total) return sftpProgress.value.phase === 'done' ? 100 : 0;
        return Math.min(100, Math.max(0, Math.round((transferred / total) * 100)));
    });
    const sftpProgressPercent = computed(() => {
        if (sftpProgress.value.phase === 'error') return '失败';
        if (sftpProgress.value.phase === 'done') return '完成';
        const total = Number(sftpProgress.value.total) || 0;
        if (!total) return '';
        return `${sftpProgressBarWidth.value}%`;
    });
    const sftpProgressText = computed(() => {
        const operation = sftpProgress.value.operation === 'download' ? '下载' : '上传';
        const name = sftpProgress.value.name || basenameFromPath(sftpProgress.value.remotePath) || '';
        if (sftpProgress.value.phase === 'error') return `${operation}失败：${sftpProgress.value.msg || name}`;
        if (sftpProgress.value.phase === 'done') return `${operation}完成：${name}`;
        if (sftpProgress.value.phase === 'start') return `准备${operation}：${name}`;
        return `${operation}中：${name}`;
    });
    const treeIsEmpty = computed(() => visibleSessionTreeNodes.value.length === 0);
    const contextNode = computed(() => folderMenu.value.node);
    const contextSession = computed(() =>
        contextNode.value?.type === RESOURCE_NODE_TYPES.SESSION ? contextNode.value : null
    );
    const contextFolder = computed(() =>
        contextNode.value?.type === RESOURCE_NODE_TYPES.SESSION_FOLDER ? contextNode.value : null
    );
    const deleteFolderSubtitle = computed(() => {
        const target = deleteFolderTarget.value;
        if (!target) return '';
        const count = Number(target.itemCount) || 0;
        return count > 0 ? `${target.name} 内共有 ${count} 个会话。` : target.name;
    });
    const folderDialogSubtitle = computed(() => {
        const parent = folderDialogParentId.value ? store.sessionTree.folderMap?.get(folderDialogParentId.value) : null;
        return parent ? `创建在 ${parent.name} 下。` : '用于整理左侧保存的会话。';
    });
    const remoteDeleteSubtitle = computed(() => remoteDeleteTarget.value?.path || '');
    const remoteDeleteCopy = computed(() => {
        const target = remoteDeleteTarget.value;
        if (!target) return '';
        if (target.type === RESOURCE_NODE_TYPES.FILE_FOLDER) {
            return `删除后，目录 ${target.name} 以及其中的所有文件和子目录都会被删除。`;
        }
        return `删除后，文件 ${target.name} 会从远程主机移除。`;
    });

    const emptyText = computed(() => {
        if (query.value) return '没有匹配结果';
        return '暂无会话';
    });

    function countSessionNodes(nodes) {
        return nodes.reduce((total, node) => {
            if (node.type === RESOURCE_NODE_TYPES.SESSION) return total + 1;
            return total + countSessionNodes(node.children || []);
        }, 0);
    }

    function nodeMatches(node, keyword) {
        if (!keyword) return true;
        if (node.type === RESOURCE_NODE_TYPES.SESSION) {
            return `${node.name} ${node.protocol} ${node.host} ${node.port || ''} ${node.shell || ''} ${node.cwd || ''}`
                .concat(` ${node.username || ''}`)
                .toLowerCase()
                .includes(keyword);
        }
        return String(node.name || '')
            .toLowerCase()
            .includes(keyword);
    }

    function cloneTreeWithCounts(node, children) {
        if (node.type === RESOURCE_NODE_TYPES.SESSION) return { ...node, children: [] };
        return {
            ...node,
            children,
            itemCount: countSessionNodes(children)
        };
    }

    function filterTreeNodes(nodes, rawKeyword) {
        const keyword = String(rawKeyword || '').toLowerCase();
        if (!keyword) return nodes;
        return nodes
            .map(node => {
                const matched = nodeMatches(node, keyword);
                if (node.type === RESOURCE_NODE_TYPES.SESSION) return matched ? cloneTreeWithCounts(node, []) : null;

                const childMatches = filterTreeNodes(node.children || [], keyword);
                if (!matched && childMatches.length === 0) return null;
                const children = matched ? node.children || [] : childMatches;
                return cloneTreeWithCounts(node, children);
            })
            .filter(Boolean);
    }

    function parentRemotePath(filePath) {
        const parts = String(filePath || '/')
            .split('/')
            .filter(Boolean);
        parts.pop();
        return parts.length ? `/${parts.join('/')}` : '/';
    }

    function basenameFromPath(filePath) {
        const parts = String(filePath || '')
            .split('/')
            .filter(Boolean);
        return parts[parts.length - 1] || '';
    }

    function createRemoteRoot(path = '/', entries = []) {
        const root = normalizeFileEntry({
            id: FILE_ROOT_ID,
            type: RESOURCE_NODE_TYPES.FILE_FOLDER,
            resource: 'file',
            name: path,
            path,
            loaded: true,
            children: entries
        });
        root.itemCount = root.children.length;
        return root;
    }

    function resetRemoteTree(path = '/') {
        remotePath.value = path || '/';
        remoteFileTree.value = createRemoteRoot(remotePath.value);
        selectedFileNodeId.value = '';
    }

    async function loadRemoteDirectory(path = '/') {
        if (!fileSessionId.value) return;
        const targetPath = path || '/';
        sftpLoading.value = true;
        try {
            const res = await window.sftpApi.list({
                sessionId: fileSessionId.value,
                path: targetPath
            });
            if (res.status !== 'success') {
                notifyError(res.msg || '读取远程目录失败');
                return;
            }

            const nextPath = res.data.path || targetPath;
            remotePath.value = nextPath;
            remoteFileTree.value = createRemoteRoot(nextPath, res.data.entries);
            selectedFileNodeId.value = '';
        } catch (err) {
            notifyError(err?.message || '读取远程目录失败');
        } finally {
            sftpLoading.value = false;
        }
    }

    async function resolveRemoteStartPath(sessionId) {
        if (!sftpFollowConsole.value) return '/';
        if (sftpCwdBySession[sessionId]) return sftpCwdBySession[sessionId];
        if (!window.sftpApi?.cwd) return '/';

        for (let attempt = 0; attempt < 4; attempt += 1) {
            try {
                const res = await window.sftpApi.cwd({ sessionId });
                if (res.status === 'success' && res.data?.path) {
                    sftpCwdBySession[sessionId] = res.data.path;
                    if (res.data.path !== '/' || attempt === 3) return res.data.path;
                }
            } catch (_err) {
                /* list fallback will show root if cwd cannot be queried */
            }
            await new Promise(resolve => window.setTimeout(resolve, 120));
        }
        return '/';
    }

    function refreshRemoteFiles() {
        loadRemoteDirectory(remotePath.value);
    }

    function goRemoteParent() {
        loadRemoteDirectory(parentRemotePath(remotePath.value));
    }

    async function activateFileNode(node) {
        if (node.type !== RESOURCE_NODE_TYPES.FILE_FOLDER) return;
        await loadRemoteDirectory(node.path);
    }

    function openDialog(session = null, folderIdOverride = undefined) {
        editing.value = session;
        dialogFolderId.value = session
            ? session.folderId || null
            : folderIdOverride !== undefined
              ? folderIdOverride
              : getCreateFolderId();
        dialogVisible.value = true;
    }

    function closeDialog() {
        dialogVisible.value = false;
        editing.value = null;
        dialogFolderId.value = null;
    }

    function connect(session) {
        openSession(session);
    }

    function remove(session) {
        deleteSession(session.id);
    }

    function selectSessionNode(node) {
        selectedSessionNodeId.value = node.id;
        if (node.type === RESOURCE_NODE_TYPES.SESSION) {
            selectSessionFolder(node.folderId || UNGROUPED_FOLDER_ID);
            return;
        }
        if (node.type === RESOURCE_NODE_TYPES.SESSION_FOLDER) selectSessionFolder(node.id);
    }

    function selectFileNode(node) {
        selectedFileNodeId.value = node.id;
    }

    function openFolderMenu(event, node = null) {
        closeFolderMenu();
        closeFileMenu();
        if (node) selectSessionNode(node);
        folderMenu.value = {
            visible: true,
            x: event.clientX,
            y: event.clientY,
            node
        };
    }

    function closeFolderMenu() {
        if (!folderMenu.value.visible) return;
        folderMenu.value = { visible: false, x: 0, y: 0, node: null };
    }

    function openFileMenu(event, node = null) {
        closeFolderMenu();
        if (node) selectFileNode(node);
        fileMenu.value = {
            visible: true,
            x: event.clientX,
            y: event.clientY,
            node
        };
    }

    function closeFileMenu() {
        if (!fileMenu.value.visible) return;
        fileMenu.value = { visible: false, x: 0, y: 0, node: null };
    }

    function closeAllMenus() {
        closeFolderMenu();
        closeFileMenu();
    }

    async function promptCreateFolder() {
        const parentNode = folderMenu.value.node;
        const parentId = parentNode?.type === RESOURCE_NODE_TYPES.SESSION_FOLDER ? parentNode.id : getCreateFolderId();
        closeFolderMenu();
        clearFolderFieldErrors();
        folderDialogParentId.value = parentId;
        folderName.value = '新建文件夹';
        folderDialogVisible.value = true;
        await nextTick();
        folderNameInput.value?.focus();
        folderNameInput.value?.select();
    }

    function closeFolderDialog() {
        if (folderSubmitting.value) return;
        folderDialogVisible.value = false;
        clearFolderFieldErrors();
        folderDialogParentId.value = null;
        folderName.value = '';
    }

    async function submitFolderDialog() {
        clearFolderFieldErrors();
        const trimmed = folderName.value.trim();
        if (!trimmed) {
            setFolderFieldError('name', '文件夹名称不能为空');
            notifyError('文件夹名称不能为空', '表单输入错误');
            return;
        }

        try {
            folderSubmitting.value = true;
            const res = await createSessionFolder(trimmed, folderDialogParentId.value);
            if (res.status === 'success') {
                selectedSessionNodeId.value = res.data.id;
                folderSubmitting.value = false;
                closeFolderDialog();
                notifySuccess('文件夹已创建');
                return;
            }
            notifyError(res.msg || '新建文件夹失败');
        } catch (err) {
            notifyError(err?.message || '新建文件夹失败');
        } finally {
            folderSubmitting.value = false;
        }
    }

    function startSavedSessionDrag(event, session) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(SAVED_SESSION_DND, JSON.stringify({ sessionId: session.id }));
        event.dataTransfer.setData('text/plain', session.name || session.host || 'Local Shell');
    }

    function startTreeNodeDrag({ event, node }) {
        if (node.type !== RESOURCE_NODE_TYPES.SESSION) return;
        startSavedSessionDrag(event, node);
    }

    function readSavedSessionDrag(event) {
        const raw = event.dataTransfer.getData(SAVED_SESSION_DND);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (_err) {
            return null;
        }
    }

    function isSessionDropTarget(node) {
        return node?.type === RESOURCE_NODE_TYPES.SESSION_FOLDER;
    }

    function handleNodeDragEnter(node) {
        if (isSessionDropTarget(node)) dragHoverFolder.value = node.id;
    }

    function handleNodeDragLeave(node) {
        if (dragHoverFolder.value === node.id) dragHoverFolder.value = '';
    }

    async function dropSessionToNode({ event, node }) {
        event.preventDefault();
        event.stopPropagation();
        const payload = readSavedSessionDrag(event);
        dragHoverFolder.value = '';
        if (!payload?.sessionId || !isSessionDropTarget(node)) return;

        const res = await moveSessionToFolder(payload.sessionId, node.id);
        if (res.status !== 'success') notifyError(res.msg || '移动会话失败');
    }

    async function dropSessionToRoot(event) {
        const payload = readSavedSessionDrag(event);
        dragHoverFolder.value = '';
        if (!payload?.sessionId) return;

        const res = await moveSessionToFolder(payload.sessionId, null);
        if (res.status !== 'success') notifyError(res.msg || '移动会话失败');
    }

    function activateTreeNode(node) {
        if (node.type === RESOURCE_NODE_TYPES.SESSION) connect(node);
    }

    function getContextFolderId() {
        if (contextFolder.value) return contextFolder.value.id;
        if (contextSession.value) return contextSession.value.folderId || null;
        return getCreateFolderId();
    }

    function createSessionInContext() {
        const folderId = getContextFolderId();
        closeFolderMenu();
        openDialog(null, folderId);
    }

    function connectContextSession() {
        const session = contextSession.value;
        closeFolderMenu();
        if (session) connect(session);
    }

    function editContextSession() {
        const session = contextSession.value;
        closeFolderMenu();
        if (session) openDialog(session);
    }

    function deleteContextSession() {
        const session = contextSession.value;
        closeFolderMenu();
        if (session) remove(session);
    }

    function requestDeleteContextFolder() {
        const folder = contextFolder.value;
        closeFolderMenu();
        if (!folder) return;
        deleteFolderTarget.value = folder;
        deleteFolderDialogVisible.value = true;
    }

    function closeDeleteFolderDialog() {
        if (folderDeleting.value) return;
        deleteFolderDialogVisible.value = false;
        deleteFolderTarget.value = null;
    }

    async function confirmDeleteFolder() {
        const folder = deleteFolderTarget.value;
        if (!folder) return;

        try {
            folderDeleting.value = true;
            const res = await deleteSessionFolder(folder.id);
            if (res.status === 'success') {
                if (selectedSessionNodeId.value === folder.id) selectedSessionNodeId.value = '';
                folderDeleting.value = false;
                closeDeleteFolderDialog();
                notifySuccess('文件夹已删除');
                return;
            }
            notifyError(res.msg || '删除文件夹失败');
        } catch (err) {
            notifyError(err?.message || '删除文件夹失败');
        } finally {
            folderDeleting.value = false;
        }
    }

    function validateRemoteItemName(value, field) {
        const trimmed = String(value || '').trim();
        if (!trimmed) {
            setFileFieldError(field, '名称不能为空');
            notifyError('名称不能为空', '表单输入错误');
            return '';
        }
        if (trimmed === '.' || trimmed === '..' || trimmed.includes('/')) {
            setFileFieldError(field, '名称不能包含路径分隔符');
            notifyError('名称不能包含路径分隔符', '表单输入错误');
            return '';
        }
        return trimmed;
    }

    async function openRemoteFolderDialog() {
        closeFileMenu();
        if (!fileSessionId.value) {
            notifyError('请选择 SSH 会话');
            return;
        }
        clearFileFieldErrors();
        remoteFolderName.value = '新建目录';
        remoteFolderDialogVisible.value = true;
        await nextTick();
        remoteFolderInput.value?.focus?.();
        remoteFolderInput.value?.select?.();
    }

    function closeRemoteFolderDialog() {
        if (sftpOperating.value) return;
        remoteFolderDialogVisible.value = false;
        remoteFolderName.value = '';
        clearFileFieldErrors();
    }

    async function confirmCreateRemoteFolder() {
        if (!fileSessionId.value || sftpOperating.value) return;
        clearFileFieldErrors();
        const name = validateRemoteItemName(remoteFolderName.value, 'folderName');
        if (!name) return;

        try {
            sftpOperating.value = true;
            const res = await window.sftpApi.mkdir({
                sessionId: fileSessionId.value,
                remoteDir: remotePath.value,
                name
            });
            if (res.status === 'success') {
                sftpOperating.value = false;
                closeRemoteFolderDialog();
                notifySuccess(res.msg || '目录已创建');
                await loadRemoteDirectory(remotePath.value);
                return;
            }
            notifyError(res.msg || '新建目录失败');
        } catch (err) {
            notifyError(err?.message || '新建目录失败');
        } finally {
            sftpOperating.value = false;
        }
    }

    async function requestRenameRemote() {
        closeFileMenu();
        const node = selectedFileNode.value;
        if (!fileSessionId.value || !node?.path) return;
        clearFileFieldErrors();
        remoteRenameTarget.value = node;
        remoteRenameName.value = node.name || basenameFromPath(node.path);
        remoteRenameDialogVisible.value = true;
        await nextTick();
        remoteRenameInput.value?.focus?.();
        remoteRenameInput.value?.select?.();
    }

    function closeRemoteRenameDialog() {
        if (sftpOperating.value) return;
        remoteRenameDialogVisible.value = false;
        remoteRenameTarget.value = null;
        remoteRenameName.value = '';
        clearFileFieldErrors();
    }

    async function confirmRenameRemote() {
        const target = remoteRenameTarget.value;
        if (!fileSessionId.value || !target?.path || sftpOperating.value) return;
        clearFileFieldErrors();
        const name = validateRemoteItemName(remoteRenameName.value, 'renameName');
        if (!name) return;

        try {
            sftpOperating.value = true;
            const res = await window.sftpApi.rename({
                sessionId: fileSessionId.value,
                remotePath: target.path,
                name
            });
            if (res.status === 'success') {
                sftpOperating.value = false;
                selectedFileNodeId.value = res.data?.path ? `sftp:${fileSessionId.value}:${res.data.path}` : '';
                closeRemoteRenameDialog();
                notifySuccess(res.msg || '重命名完成');
                await loadRemoteDirectory(remotePath.value);
                return;
            }
            notifyError(res.msg || '重命名失败');
        } catch (err) {
            notifyError(err?.message || '重命名失败');
        } finally {
            sftpOperating.value = false;
        }
    }

    function requestDeleteRemote() {
        closeFileMenu();
        const node = selectedFileNode.value;
        if (!fileSessionId.value || !node?.path) return;
        remoteDeleteTarget.value = node;
        remoteDeleteDialogVisible.value = true;
    }

    function closeRemoteDeleteDialog() {
        if (sftpOperating.value) return;
        remoteDeleteDialogVisible.value = false;
        remoteDeleteTarget.value = null;
    }

    async function confirmDeleteRemote() {
        const target = remoteDeleteTarget.value;
        if (!fileSessionId.value || !target?.path || sftpOperating.value) return;

        try {
            sftpOperating.value = true;
            const res = await window.sftpApi.remove({
                sessionId: fileSessionId.value,
                remotePath: target.path,
                type: target.type
            });
            if (res.status === 'success') {
                selectedFileNodeId.value = '';
                sftpOperating.value = false;
                closeRemoteDeleteDialog();
                notifySuccess(res.msg || '删除完成');
                await loadRemoteDirectory(remotePath.value);
                return;
            }
            notifyError(res.msg || '删除失败');
        } catch (err) {
            notifyError(err?.message || '删除失败');
        } finally {
            sftpOperating.value = false;
        }
    }

    async function downloadSelectedRemote() {
        const node = selectedFileNode.value;
        if (!fileSessionId.value || !node?.path) return;
        closeFileMenu();
        try {
            const res = await window.sftpApi.download({
                sessionId: fileSessionId.value,
                remotePath: node.path,
                type: node.type
            });
            if (res.data?.canceled) return;
            if (res.status === 'success') notifySuccess(res.msg || '下载完成');
            else notifyError(res.msg || '下载失败');
        } catch (err) {
            notifyError(err?.message || '下载失败');
        }
    }

    function remoteUploadDirForNode(node) {
        if (!node) return remotePath.value;
        if (node?.type === RESOURCE_NODE_TYPES.FILE_FOLDER) return node.path;
        return parentRemotePath(node?.path || remotePath.value);
    }

    async function refreshAfterUpload(remoteDir) {
        if (remoteDir === remotePath.value) refreshRemoteFiles();
    }

    async function uploadLocalPathsToRemote(localPaths, remoteDir) {
        if (!fileSessionId.value) {
            notifyError('请选择 SSH 会话');
            return;
        }
        if (Array.isArray(localPaths) && localPaths.length === 0) {
            notifyError('未找到可上传的本地文件');
            return;
        }

        try {
            sftpUploading.value = true;
            const payload = {
                sessionId: fileSessionId.value,
                remoteDir
            };
            if (Array.isArray(localPaths)) payload.localPaths = localPaths;

            const res = await window.sftpApi.upload(payload);
            if (res.data?.canceled) return;
            if (res.status === 'success') {
                const count = Number(res.data?.count) || localPaths?.length || 0;
                notifySuccess(count > 1 ? `已上传 ${count} 项` : res.msg || '上传完成');
                await refreshAfterUpload(remoteDir);
            } else {
                notifyError(res.msg || '上传失败');
            }
        } catch (err) {
            notifyError(err?.message || '上传失败');
        } finally {
            sftpUploading.value = false;
        }
    }

    async function uploadToRemote() {
        closeFileMenu();
        if (!fileSessionId.value) return;
        await uploadLocalPathsToRemote(null, remoteUploadDirForNode(selectedFileNode.value));
    }

    function hasLocalFileDrag(event) {
        return Array.from(event.dataTransfer?.types || []).includes('Files');
    }

    function getDroppedLocalPaths(event) {
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return [];
        if (window.sftpApi.getDroppedFilePaths) {
            try {
                return window.sftpApi.getDroppedFilePaths(files);
            } catch (_err) {
                return [];
            }
        }
        return files.map(file => file.path).filter(Boolean);
    }

    function resetFileDragState() {
        fileDragActive.value = false;
        fileDropHoverId.value = '';
        fileDropTargetDir.value = '';
    }

    function updateSftpProgress(payload = {}) {
        if (!payload?.sessionId || payload.sessionId !== fileSessionId.value) return;
        if (progressHideTimer) {
            window.clearTimeout(progressHideTimer);
            progressHideTimer = null;
        }
        sftpProgress.value = {
            visible: true,
            operation: payload.operation || '',
            phase: payload.phase || 'active',
            remotePath: payload.remotePath || '',
            name: payload.name || '',
            transferred: Number(payload.transferred) || 0,
            total: Number(payload.total) || 0,
            msg: payload.msg || ''
        };
        if (payload.phase === 'done' || payload.phase === 'error') {
            progressHideTimer = window.setTimeout(() => {
                sftpProgress.value.visible = false;
                progressHideTimer = null;
            }, 1800);
        }
    }

    function prepareLocalFileDrag(event) {
        if (!hasLocalFileDrag(event)) return false;
        event.preventDefault();
        if (!fileSessionId.value) {
            event.dataTransfer.dropEffect = 'none';
            return false;
        }
        event.dataTransfer.dropEffect = 'copy';
        fileDragActive.value = true;
        return true;
    }

    function handleFilePanelDragEnter(event) {
        if (!prepareLocalFileDrag(event)) return;
        if (!fileDropTargetDir.value) fileDropTargetDir.value = remotePath.value;
    }

    function handleFilePanelDragOver(event) {
        prepareLocalFileDrag(event);
    }

    function handleFilePanelDragLeave(event) {
        if (!fileDragActive.value) return;
        if (event.currentTarget.contains(event.relatedTarget)) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const inside =
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom;
        if (inside) return;
        resetFileDragState();
    }

    function handleFileNodeDragEnter(node) {
        if (!fileDragActive.value) return;
        fileDropHoverId.value = node.id;
        fileDropTargetDir.value = remoteUploadDirForNode(node);
    }

    function handleFileNodeDragLeave(node) {
        if (fileDropHoverId.value !== node.id) return;
        fileDropHoverId.value = '';
        fileDropTargetDir.value = remotePath.value;
    }

    async function dropLocalFilesToCurrent(event) {
        if (!hasLocalFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (!fileSessionId.value) {
            resetFileDragState();
            notifyError('请选择 SSH 会话');
            return;
        }

        const localPaths = getDroppedLocalPaths(event);
        const remoteDir = fileDropTargetDir.value || remotePath.value;
        resetFileDragState();
        await uploadLocalPathsToRemote(localPaths, remoteDir);
    }

    async function dropLocalFilesToNode({ event, node }) {
        if (!hasLocalFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const localPaths = getDroppedLocalPaths(event);
        const remoteDir = remoteUploadDirForNode(node);
        resetFileDragState();
        await uploadLocalPathsToRemote(localPaths, remoteDir);
    }

    watch(
        availableSshSessions,
        sessions => {
            if (sessions.some(session => session.sessionId === fileSessionId.value)) return;
            fileSessionId.value = sessions[0]?.sessionId || '';
        },
        { immediate: true }
    );

    watch(fileSessionId, async sessionId => {
        const token = ++fileSessionLoadToken;
        sftpProgress.value.visible = false;
        if (!sessionId) {
            resetRemoteTree('/');
            return;
        }

        const targetPath = await resolveRemoteStartPath(sessionId);
        if (token !== fileSessionLoadToken || sessionId !== fileSessionId.value) return;
        resetRemoteTree(targetPath);
        loadRemoteDirectory(targetPath);
    });

    watch(sftpFollowConsole, async enabled => {
        if (!enabled || !fileSessionId.value) return;
        const sessionId = fileSessionId.value;
        const targetPath = await resolveRemoteStartPath(sessionId);
        if (sessionId !== fileSessionId.value) return;
        if (targetPath && targetPath !== remotePath.value) loadRemoteDirectory(targetPath);
    });

    onMounted(() => {
        offSftpCwd = eventBus.on('sftp:cwd', payload => {
            if (payload?.sessionId && payload.path) sftpCwdBySession[payload.sessionId] = payload.path;
            if (!sftpFollowConsole.value) return;
            if (!payload?.path || payload.sessionId !== fileSessionId.value) return;
            if (payload.path === remotePath.value) return;
            loadRemoteDirectory(payload.path);
        });
        offSftpProgress = eventBus.on('sftp:progress', updateSftpProgress);
    });

    onUnmounted(() => {
        if (offSftpCwd) offSftpCwd();
        if (offSftpProgress) offSftpProgress();
        if (progressHideTimer) window.clearTimeout(progressHideTimer);
    });
</script>

<style scoped>
    .sidebar {
        width: var(--session-sidebar-width, 278px);
        flex-shrink: 0;
        background: var(--nx-surface);
        border-right: 1px solid var(--nx-border);
        display: flex;
        min-height: 0;
    }
    .rail {
        width: 42px;
        flex: 0 0 42px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 10px 6px;
        border-right: 1px solid var(--nx-border);
        background: var(--nx-rail-bg);
    }
    .panel {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }
    .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 62px;
        padding: 12px 12px 9px 14px;
    }
    .head__title {
        color: var(--nx-text);
        font-weight: 700;
        font-size: 14px;
    }
    .head__count {
        margin-top: 3px;
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    .head-actions {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .search {
        padding: 10px 12px;
        border-bottom: 1px solid var(--nx-border);
    }
    .search input {
        width: 100%;
        height: 30px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-bg);
        color: var(--nx-text);
        outline: none;
        padding: 0 10px;
    }
    .search input::placeholder {
        color: var(--nx-text-dim);
    }
    .search input:focus {
        border-color: var(--nx-accent);
    }
    .session-panel {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }
    .security-panel {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 0 12px 14px;
        border-top: 1px solid var(--nx-border);
    }
    .security-panel :deep(.nx-group__head) {
        padding-top: 12px;
    }
    .security-panel :deep(.nx-group) {
        border-bottom: 0;
    }
    .folder-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 16px;
        color: var(--nx-text-dim);
    }
    .folder-field span {
        font-size: 12px;
    }
    .folder-field.is-invalid span {
        color: var(--nx-danger);
    }
    .folder-field input {
        width: 100%;
        height: 34px;
        padding: 0 10px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        outline: none;
        background: var(--nx-bg);
        color: var(--nx-text);
    }
    .folder-field input:focus {
        border-color: var(--nx-accent);
    }
    .folder-field.is-invalid input {
        border-color: var(--nx-danger);
        background: var(--nx-danger-soft);
        box-shadow: 0 0 0 2px var(--nx-danger-ring);
    }
    .folder-field.is-invalid input:focus {
        border-color: var(--nx-danger);
    }
    .delete-folder-copy {
        margin: 0;
        padding: 16px 16px 4px;
        color: var(--nx-text-dim);
        line-height: 1.6;
    }
    .ghost,
    .primary,
    .danger-action {
        height: 32px;
        min-width: 72px;
        padding: 0 14px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        cursor: pointer;
    }
    .ghost {
        background: var(--nx-surface-2);
        color: var(--nx-text);
    }
    .primary {
        border-color: var(--nx-accent);
        background: var(--nx-accent);
        color: var(--nx-accent-text);
    }
    .danger-action {
        border-color: var(--nx-danger);
        background: var(--nx-danger);
        color: #ffffff;
    }
    .primary:disabled,
    .danger-action:disabled {
        opacity: 0.68;
        cursor: default;
    }
    :deep(.danger-menu-item) {
        color: var(--nx-danger);
    }
    .file-panel {
        position: relative;
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }
    .file-panel.is-file-dragging {
        background: var(--nx-accent-softer);
    }
    .file-toolbar {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 6px;
        padding: 8px 8px 0;
    }
    .file-toolbar select {
        min-width: 0;
        height: 30px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-bg);
        color: var(--nx-text);
        outline: none;
        padding: 0 8px;
    }
    .file-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 5px;
        padding: 7px 8px 0;
    }
    .file-path {
        flex: 1 0 100%;
        min-width: 0;
        height: 30px;
        display: flex;
        align-items: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 0 9px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-bg);
        color: var(--nx-text-dim);
        font-family: var(--nx-font-mono);
        font-size: 11px;
    }
    .file-loading {
        padding: 14px;
        color: var(--nx-text-dim);
        font-size: 12px;
    }
    .file-progress {
        margin: 7px 8px 0;
        padding: 7px 8px;
        border: 1px solid var(--nx-border);
        border-radius: 7px;
        background: var(--nx-surface-2);
    }
    .file-progress.error {
        border-color: var(--nx-danger);
        background: var(--nx-danger-soft);
    }
    .file-progress__line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        color: var(--nx-text-dim);
        font-size: 11px;
    }
    .file-progress__line span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .file-progress__line strong {
        flex-shrink: 0;
        color: var(--nx-text);
        font-size: 11px;
    }
    .file-progress__bar {
        margin-top: 6px;
        height: 4px;
        overflow: hidden;
        border-radius: 999px;
        background: var(--nx-control-muted);
    }
    .file-progress__bar i {
        display: block;
        height: 100%;
        min-width: 8px;
        max-width: 100%;
        border-radius: inherit;
        background: var(--nx-accent);
        transition: width 120ms ease;
    }
    .file-progress.error .file-progress__bar i {
        background: var(--nx-danger);
    }
    .file-drop-overlay {
        pointer-events: none;
        position: absolute;
        z-index: 8;
        left: 10px;
        right: 10px;
        bottom: 10px;
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 38px;
        padding: 0 12px;
        border: 1px solid var(--nx-accent-border);
        border-radius: 7px;
        background: var(--nx-surface-raised);
        color: var(--nx-text);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.24);
    }
    .file-drop-overlay span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--nx-font-mono);
        font-size: 11px;
    }
    .file-empty {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 9px;
        text-align: center;
        color: var(--nx-text-dim);
        padding: 28px 14px;
    }
    .file-empty__glyph {
        display: grid;
        gap: 5px;
        width: 54px;
        padding: 11px;
        border: 1px solid var(--nx-border);
        border-radius: 8px;
        background: var(--nx-surface-2);
    }
    .file-empty__glyph span {
        height: 4px;
        border-radius: 999px;
        background: var(--nx-text-dim);
    }
    .file-empty__glyph span:first-child {
        width: 70%;
        background: var(--nx-accent);
    }
    .file-empty h3 {
        margin: 4px 0 0;
        color: var(--nx-text);
        font-size: 14px;
    }
    .file-empty p {
        margin: 0;
        line-height: 1.6;
        font-size: 12px;
    }
    .file-empty.compact {
        justify-content: flex-start;
        padding-top: 28px;
    }
</style>
