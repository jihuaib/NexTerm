import AppearanceSection from '../components/settings/AppearanceSection.vue';
import TerminalSection from '../components/settings/TerminalSection.vue';
import ConnectionSection from '../components/settings/ConnectionSection.vue';
import FilesSection from '../components/settings/FilesSection.vue';
import LogsSection from '../components/settings/LogsSection.vue';
import ScriptsSection from '../components/settings/ScriptsSection.vue';
import ShortcutsSection from '../components/settings/ShortcutsSection.vue';
import UpdateSection from '../components/settings/UpdateSection.vue';
import LicenseSection from '../components/settings/LicenseSection.vue';
import AboutSection from '../components/settings/AboutSection.vue';
import {
    FileCode,
    FileText,
    FolderOpen,
    Info,
    Keyboard,
    KeyRound,
    Network,
    Palette,
    RefreshCw,
    SquareTerminal
} from '@lucide/vue';

// 设置分类注册表：新增一类 = 写一个 section 组件 + 在此加一行
export const SETTINGS_CATEGORIES = [
    { id: 'appearance', label: '外观', desc: '主题、字体与布局', icon: Palette, component: AppearanceSection },
    { id: 'terminal', label: '终端', desc: '光标与滚动历史', icon: SquareTerminal, component: TerminalSection },
    { id: 'shortcuts', label: '快捷键', desc: '终端复制、粘贴与右键操作', icon: Keyboard, component: ShortcutsSection },
    { id: 'connection', label: '连接', desc: '默认值、重连与 SSH 安全', icon: Network, component: ConnectionSection },
    { id: 'files', label: '文件', desc: 'SFTP 文件面板与远程目录行为', icon: FolderOpen, component: FilesSection },
    { id: 'scripts', label: '脚本', desc: 'term API 与执行语法', icon: FileCode, component: ScriptsSection },
    { id: 'logs', label: '日志', desc: '终端缓冲区日志写入与格式', icon: FileText, component: LogsSection },
    { id: 'update', label: '更新', desc: '版本检查、下载与安装', icon: RefreshCw, component: UpdateSection },
    { id: 'license', label: '授权', desc: '试用期、离线激活与授权文件', icon: KeyRound, component: LicenseSection },
    { id: 'about', label: '关于', desc: '版本与后续能力规划', icon: Info, component: AboutSection }
];
