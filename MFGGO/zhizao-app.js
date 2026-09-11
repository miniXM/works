import { canViewTaskHistoryReport, renderTaskHistoryReport, mountTaskHistoryReport, renderTaskHistoryTimeline } from './task-history-ui.js';
import { canManageOrganization, openOrganizationDialog as openOrganizationStructure, closeOrganizationDialog } from './organization-ui.js';
import { enterpriseCan, platformCan, ENTERPRISE_ROLE_LABELS, PLATFORM_ROLE_LABELS } from './access-policy.js';
import { openProfileDialog, openPlatformAdministratorsDialog, openEnterpriseOwnerDialog, openOrganizationSwitchDialog, closeAccessDialog } from './access-ui.js';
import { createIcons, createElement, ChevronDown, ChevronRight, ArrowLeft, Link, Copy, UserRound, CalendarDays, ListTodo, Plus, Workflow, Trash2, ArchiveRestore } from 'lucide';
import { openRecycleBin as openTaskRecycleBin, closeRecycleBin as closeTaskRecycleBin, confirmTaskRecycle } from './task-recycle-ui.js';
import { renderProjectListsSection, mountProjectListsSection, closeProjectListEditor } from './project-lists-ui.js';
import { renderProjectLinksSection, mountProjectLinksSection } from './project-links-ui.js';
import { renderSharedTaskCustomers, mountSharedTaskCustomers } from './task-shared-customers-ui.js';
import { renderCommunicationList, mountCommunicationList } from './communication-ui.js';
import { renderOrganizationChart, mountOrganizationChart } from './organization-chart.js';
import { renderAutomation, mountAutomation, canManageAutomation } from './automation-ui.js';

const canOpenTaskRecycleBin = store => enterpriseCan(store, 'project.delete') || enterpriseCan(store, 'task.delete');

const memberCan = enterpriseCan;
const platformAllowed = (store, permission) => platformCan({ role: store.platformRole, permissions: store.platformPermissions }, permission);
const platformViewAllowed = (store, view) => view === 'platform-overview'
  || (view === 'organizations' && ['organization.read', 'organization.create'].some(key => platformAllowed(store, key)))
  || (view === 'platform-users' && platformAllowed(store, 'user.read'))
  || (view === 'platform-audit' && platformAllowed(store, 'audit.read'));
const enterpriseViewAllowed = (store, view) => view === 'automation' ? canManageAutomation(store) : view === 'organization' || (store.modules[view] !== false && enterpriseCan(store, ({ projects: 'project.read', workspace: 'document.read', parts: 'part.read', communication: 'communication.read', chat: 'chat.read', tasks: 'task.read', stats: 'stats.read' })[view] || 'project.read'));

export const NAV_ITEMS = [
  { id: 'projects', label: '项目管理', icon: '▦', iconClass: 'icon-projects' },
  { id: 'automation', label: '自动化功能', icon: '⌘', iconClass: 'icon-automation' },
  { id: 'workspace', label: '制表中心', icon: '▤', iconClass: 'icon-workspace' },
  { id: 'parts', label: '零件中心', icon: '◇', iconClass: 'icon-parts' },
  { id: 'communication', label: '项目沟通', icon: '◌', iconClass: 'icon-communication' },
  { id: 'chat', label: '聊天信息', icon: '▣', iconClass: 'icon-chat' },
  { id: 'tasks', label: '我的任务', icon: '✓', iconClass: 'icon-tasks' },
  { id: 'stats', label: '统计', icon: '⌁', iconClass: 'icon-stats' },
  { id: 'organization', label: '组织架构', icon: '<i data-lucide="workflow"></i>', iconClass: 'icon-organization' }
];

export const PLATFORM_NAV_ITEMS = [
  { id: 'platform-overview', label: '平台总览', icon: '▥', iconClass: 'icon-overview' },
  { id: 'organizations', label: '企业管理', icon: '◇', iconClass: 'icon-organizations' },
  { id: 'platform-users', label: '用户管理', icon: '♙', iconClass: 'icon-users' },
  { id: 'platform-audit', label: '平台审计', icon: '≡', iconClass: 'icon-audit' }
];

export const PROJECT_COLUMNS = [
  { id: '立项沟通', label: '立项沟通' },
  { id: '询盘发布', label: '询盘发布' },
  { id: '内部报价', label: '内部报价' },
  { id: '对外报价', label: '对外报价' },
  { id: '订单发布/待办', label: '订单发布/待办' },
  { id: '已排产/处理中', label: '已排产/处理中' },
  { id: '异常/优先处理', label: '异常/优先处理' },
  { id: '已到货/质检', label: '已到货/质检' },
  { id: '发货', label: '发货' },
  { id: '订单结束/已完成', label: '订单结束/已完成' }
];

const PROJECT_STATUSES = ['未开始', '进行中', '已暂停', '已完成'];

export const PROJECT_BOARD_STAGES = PROJECT_COLUMNS.map(({ id, label }) => ({ id, label }));
const PROJECT_BOARD_STAGE_IDS = new Set(PROJECT_BOARD_STAGES.map(stage => stage.id));

// Tasks use the same lifecycle nodes as projects. Keep the legacy values in a
// compatibility set so older imports/snapshots can still be displayed and
// migrated when the user moves a card to a real project node.
const LEGACY_TASK_STATUS_OPTIONS = ['待处理', '进行中', '阻塞', '已完成'];
const TASK_NODE_STATUS_OPTIONS = PROJECT_COLUMNS.map(({ id }) => id);

export function taskBoardStatus(task = {}) {
  const value = String(task.status || '').trim();
  if (PROJECT_BOARD_STAGE_IDS.has(value)) return value;
  // Older standalone tasks stored a generic status such as "进行中" while
  // their actual workflow node lived in stage. Prefer that explicit node so
  // imported/history records do not all collapse into one board column.
  const legacyStage = String(task.stage || '').trim();
  // If status is missing, legacy, or otherwise unknown, a valid stage is the
  // only explicit workflow signal available. Keep a formal status canonical
  // once a card has been moved through the board, even when its old stage/tag
  // still contains the previous node.
  if ((!value || !PROJECT_BOARD_STAGE_IDS.has(value)) && PROJECT_BOARD_STAGE_IDS.has(legacyStage)) return legacyStage;
  if (!value || value === '待处理') return '立项沟通';
  if (value === '进行中') return '已排产/处理中';
  if (value === '阻塞') return '异常/优先处理';
  if (value === '已完成') return '订单结束/已完成';
  const mapped = projectBoardStage({ stage: value });
  return PROJECT_BOARD_STAGE_IDS.has(mapped) ? mapped : '立项沟通';
}

export function taskBoardProgress(task = {}) {
  const stage = taskBoardStatus(task);
  const index = PROJECT_COLUMNS.findIndex(item => item.id === stage);
  if (index < 0) return Math.max(0, Math.min(100, Number(task.progress) || 0));
  if (PROJECT_COLUMNS.length <= 1) return 0;
  return Math.round(index / (PROJECT_COLUMNS.length - 1) * 100);
}

function taskNodeProgress(status) {
  const index = PROJECT_COLUMNS.findIndex(item => item.id === String(status || '').trim());
  if (index < 0) return null;
  if (PROJECT_COLUMNS.length <= 1) return 0;
  return Math.round(index / (PROJECT_COLUMNS.length - 1) * 100);
}

// The task endpoint is scoped to the current executor, but keep the client
// boundary explicit as well. This prevents a stale/older API process from
// leaking unassigned records into "我的任务" while a session is being
// refreshed. Project root tasks are included once the current user claims
// them; the project board remains their canonical editing surface.
export function filterMyTasks(tasks = [], userId = '') {
  const currentUserId = String(userId || '').trim();
  if (!currentUserId) return [];
  return (Array.isArray(tasks) ? tasks : []).filter(task => (
    String(task?.assigneeUserId || '').trim() === currentUserId
  ));
}

// Task permissions are returned by newer API snapshots when available. Older
// snapshots do not carry them, so keep a conservative client-side derivation:
// project members can read/comment/claim an empty slot, while only the current
// task executor can edit, advance, attach, or hand off work. The local check is
// intentionally an upper bound even when an API capability says true; the
// server remains authoritative, but stale capability payloads must not expose a
// misleading control to a different executor.
const TASK_CAPABILITY_ALIASES = Object.freeze({
  canView: ['canView', 'view', 'read', 'task.read'],
  canComment: ['canComment', 'comment', 'commentCreate', 'task.comment', 'task.comment.create'],
  canClaim: ['canClaim', 'claim', 'claimTask', 'task.claim'],
  canChangeStatus: ['canChangeStatus', 'changeStatus', 'statusUpdate', 'updateStatus', 'task.status.update'],
  canManageAttachments: ['canManageAttachments', 'manageAttachments', 'attachmentWrite', 'uploadAttachments', 'task.attachments.write'],
  canTransferAssignee: ['canTransferAssignee', 'transferAssignee', 'assign', 'handoff', 'handover', 'task.assign', 'task.assignee.update'],
  canManageSubtasks: ['canManageSubtasks', 'manageSubtasks', 'subtaskWrite', 'task.subtask.write'],
  canEdit: ['canEdit', 'edit', 'write', 'task.write']
});

function normalizedCapabilityKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_.:/-]+/g, '');
}

function capabilityBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 0) return Boolean(value);
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'allow', 'allowed', 'granted', 'enabled', '1'].includes(normalized)) return true;
  if (['false', 'no', 'deny', 'denied', 'disabled', '0'].includes(normalized)) return false;
  return null;
}

function lookupTaskCapability(source, aliases, seen = new Set(), depth = 0) {
  if (source === null || source === undefined || depth > 4) return { found: false, value: false };
  const aliasKeys = aliases.map(normalizedCapabilityKey);
  const direct = capabilityBoolean(source);
  if (direct !== null) return { found: true, value: direct };
  if (Array.isArray(source)) {
    const values = source.map(normalizedCapabilityKey);
    const found = aliasKeys.some(alias => values.some(value => value === alias || value.endsWith(alias)));
    return found ? { found: true, value: true } : { found: false, value: false };
  }
  if (typeof source !== 'object') return { found: false, value: false };
  if (seen.has(source)) return { found: false, value: false };
  seen.add(source);
  for (const [key, value] of Object.entries(source)) {
    const normalized = normalizedCapabilityKey(key);
    if (aliasKeys.includes(normalized) || aliasKeys.some(alias => normalized.endsWith(alias))) {
      const resolved = capabilityBoolean(value);
      if (resolved !== null) return { found: true, value: resolved };
      if (Array.isArray(value)) return { found: true, value: value.length > 0 };
    }
  }
  // Capability payloads in the wild have appeared under one of these nested
  // keys (for example { permissions: { task: { write: true } } }). Restrict
  // recursion to known containers so arbitrary task metadata is never treated
  // as an authorization signal.
  const nestedKeys = ['capabilities', 'permissions', 'permission', 'actions', 'allowed', 'task', 'subtask', 'operations'];
  for (const key of nestedKeys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const result = lookupTaskCapability(source[key], aliases, seen, depth + 1);
    if (result.found) return result;
  }
  return { found: false, value: false };
}

function firstTaskCapability(sources, key) {
  const aliases = TASK_CAPABILITY_ALIASES[key] || [key];
  for (const source of sources) {
    const result = lookupTaskCapability(source, aliases);
    if (result.found) return result;
  }
  return { found: false, value: false };
}

function explicitAssigneeId(source) {
  if (!source || !Object.hasOwn(source, 'assigneeUserId')) return null;
  return String(source.assigneeUserId ?? '').trim();
}

function resolveProjectExecutorId(rootTask, project) {
  const rootAssigneeId = explicitAssigneeId(rootTask);
  if (rootAssigneeId !== null) return rootAssigneeId;
  const projectExecutorId = project && Object.hasOwn(project, 'executorUserId')
    ? String(project.executorUserId ?? '').trim()
    : null;
  if (projectExecutorId !== null) return projectExecutorId;
  const legacyAssigneeId = project && Object.hasOwn(project, 'assigneeUserId')
    ? String(project.assigneeUserId ?? '').trim()
    : null;
  return legacyAssigneeId ?? '';
}

/**
 * Resolve task-detail affordances from an API snapshot and the current user.
 * This is exported so a host/integration can verify the same matrix used by
 * the popup without mounting a DOM. Sensitive capabilities are always bounded
 * by the local executor check; explicit API flags can further restrict them.
 */
export function deriveTaskCapabilities(store = {}, detail = {}, options = {}) {
  const task = detail?.task || detail || {};
  const project = options.project
    || (store.projects || []).find(item => String(item?.id || '') === String(task.projectId || ''))
    || null;
  const rootTask = (!options.subtaskContext?.subtaskId && project?.rootTaskId)
    ? (store.tasks || []).find(item => String(item?.id || '') === String(project.rootTaskId))
    : null;
  const projectMembers = Array.isArray(options.projectMembers)
    ? options.projectMembers
    : (Array.isArray(store.projectMembers) ? store.projectMembers : []);
  const currentUserId = String(store.user?.id || store.user?.userId || '').trim();
  const projectId = String(task.projectId || project?.id || '').trim();
  const taskId = String(task.id || '').trim();
  // The task/detail snapshot is the freshest source. Project cards are cached
  // separately and may still contain the previous executor for one render
  // after a release or handoff.
  const projectExecutorId = resolveProjectExecutorId(rootTask, project);
  const taskAssigneeId = explicitAssigneeId(task);
  const assigneeId = taskAssigneeId !== null
    ? taskAssigneeId
    : (!options.subtaskContext?.subtaskId ? projectExecutorId : '');
  const isCurrentExecutor = Boolean(currentUserId && assigneeId && currentUserId === assigneeId);
  const currentMember = projectMembers.find(member => String(member?.id || '') === currentUserId) || null;
  const membershipKnown = projectMembers.length > 0;
  // The project list is already filtered by the API for ordinary members.
  // When a card is rendered before its member list is fetched, its presence in
  // that list is therefore enough to distinguish a project participant from a
  // random enterprise user. The server remains authoritative for the action.
  const projectVisible = Boolean(projectId && (
    project
      || (store.projects || []).some(item => String(item?.id || '') === projectId)
  ));
  const isProjectParticipant = !projectId
    || Boolean(currentMember)
    || (!membershipKnown && Boolean(
      projectVisible
      || isCurrentExecutor
      || String(project?.ownerUserId || project?.managerUserId || '') === currentUserId
      || ['owner', 'admin'].includes(store.role)
    ));
  const explicitSources = [
    options.capabilities,
    options.permissions,
    detail?.capabilities,
    detail?.permissions,
    detail?.taskCapabilities,
    task?.capabilities,
    task?.permissions,
    project?.capabilities,
    project?.permissions
  ].filter(source => source !== undefined && source !== null);
  const explicit = key => firstTaskCapability(explicitSources, key);
  const bounded = (key, localValue) => {
    const result = explicit(key);
    // Nested task detail responses carry an authoritative capability snapshot
    // calculated against the exact subtask assignee. The parent project
    // member list can be stale or intentionally omit the current user, so do
    // not downgrade an explicitly granted nested capability on the client.
    if (options.subtaskContext?.subtaskId && result.found) return Boolean(result.value);
    return result.found ? Boolean(localValue && result.value) : Boolean(localValue);
  };
  const permissive = (key, fallback) => {
    const result = explicit(key);
    return result.found ? Boolean(result.value) : Boolean(fallback);
  };
  const localCanTransfer = Boolean(isCurrentExecutor && projectId && (projectMembers.length || projectVisible));
  const local = {
    canView: isProjectParticipant || isCurrentExecutor,
    canComment: isProjectParticipant || isCurrentExecutor,
    canClaim: Boolean(projectId && !assigneeId && isProjectParticipant),
    canChangeStatus: isCurrentExecutor,
    canManageAttachments: isCurrentExecutor,
    canTransferAssignee: localCanTransfer,
    canManageSubtasks: isCurrentExecutor || Boolean(options.subtaskContext?.subtaskId && explicit('canEdit').found && explicit('canEdit').value),
    canEdit: isCurrentExecutor
  };
  return {
    ...Object.fromEntries(Object.keys(local).map(key => [
      key,
      bounded(key, local[key])
    ])),
    canDelete: permissive('canDelete', memberCan(store, 'task.delete') && (!projectId || Boolean(options.subtaskContext?.subtaskId))),
    canViewCustomers: permissive('canViewCustomers', memberCan(store, 'customer.read')),
    // Member operations come from the current task executor or an explicit
    // organization grant; project creator/role labels do not confer access.
    canManageProjectMembers: permissive('canManageProjectMembers', isCurrentExecutor || (store.role !== 'owner' && memberCan(store, 'project.members.manage') && isProjectParticipant)),
    currentUserId,
    assigneeId,
    projectId,
    taskId,
    isCurrentExecutor,
    isProjectParticipant,
    currentMember,
    projectMembers
  };
}

function canCurrentUserExecuteProject(store = {}, project = {}) {
  const currentUserId = String(store.user?.id || store.user?.userId || '').trim();
  const rootTask = (store.tasks || []).find(task => String(task?.id || '') === String(project?.rootTaskId || ''));
  const executorId = resolveProjectExecutorId(rootTask, project);
  return Boolean(currentUserId && executorId && currentUserId === executorId);
}

function taskPriorityClass(priority) {
  const value = String(priority || '普通').trim();
  return value === '紧急' ? 'urgent' : value === '高' ? 'high' : 'normal';
}

function projectBoardStage(project) {
  const value = String(project?.stage || '').trim();
  if (PROJECT_BOARD_STAGE_IDS.has(value)) return value;
  if (!value || /待处理|未开始|立项|沟通/.test(value)) return '立项沟通';
  if (/询盘|询价/.test(value)) return '询盘发布';
  if (/内部报价|成本核算/.test(value)) return '内部报价';
  if (/对外报价|正式报价/.test(value)) return '对外报价';
  if (/订单|待办/.test(value)) return '订单发布/待办';
  if (/排产|加工|生产|进行中/.test(value)) return '已排产/处理中';
  if (/异常|阻塞|暂停|挂起|优先/.test(value)) return '异常/优先处理';
  if (/到货|质检|检验/.test(value)) return '已到货/质检';
  if (/发货|发运|物流/.test(value)) return '发货';
  if (/完成|结束|归档|交付|结案/.test(value)) return '订单结束/已完成';
  const status = String(project?.status || '').trim();
  if (PROJECT_BOARD_STAGE_IDS.has(status)) return status;
  if (status === '进行中') return '已排产/处理中';
  if (status === '阻塞') return '异常/优先处理';
  if (status === '已完成') return '订单结束/已完成';
  return '立项沟通';
}

function normalizeProjectStatus(value) {
  const stage = String(value || '').trim();
  if (PROJECT_STATUSES.includes(stage)) return stage;
  if (/暂停|挂起/.test(stage)) return '已暂停';
  if (/完成|结束|归档|交付/.test(stage)) return '已完成';
  if (!stage || /未开始|待办|立项/.test(stage)) return '未开始';
  return '进行中';
}

export const TASKS = [];
let OFFICE_DOCUMENTS = [];
const CHAT_ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.step,.stp,.iges,.igs,.dxf,.dwg,.txt,.csv';
// Task attachments are collaboration files rather than project master data.
// Keep the picker aligned with the server's extension allow-list, including
// common CAD, media and text formats used during manufacturing hand-off.
const TASK_ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.step,.stp,.iges,.igs,.stl,.obj,.glb,.gltf,.3mf,.dxf,.dwg,.txt,.md,.json,.xml,.csv,.log,.mp4,.mov,.webm,.mp3,.wav';
const STORAGE_FILE_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.bmp,.avif,.heic,.tif,.tiff,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.step,.stp,.iges,.igs,.stl,.obj,.glb,.gltf,.3mf,.dxf,.dwg,.txt,.md,.json,.xml,.csv,.log,.mp4,.mov,.webm,.mp3,.wav';
const STORAGE_FILE_MAX_BYTES = 50 * 1024 * 1024;
const CHAT_SYNC_INTERVAL_MS = 8000;

export function createCloudStore() {
  return { authenticated: false, platformAdmin: false, role: '', consoleMode: 'enterprise', currentView: 'projects', query: '', selectedPart: '', selectedChat: '', selectedCommunication: '', communicationProject: '', communicationQuery: '', communicationDraft: '', communicationDraftAttachments: [], communicationUploading: false, communicationSending: false, chatFilter: 'all', chatScope: 'all', chatQuery: '', chatDraft: '', chatDraftAttachments: [], chatUploading: false, chatSending: false, projects: [], parts: [], tasks: [], conversations: [], messages: {}, projectRelated: {}, stats: null, members: [], quotes: [], fairItems: [], organizations: [], platformUsers: [], platformAudit: [], storageFiles: [], storageScope: 'personal', storageProjectId: '', storageQuery: '', storageLoading: false, storagePendingFiles: [], storageLoadedKey: '', workspaceFiles: [], workspaceStarted: false, workspaceMode: '', workspaceStatus: '', workspaceStatusTone: '', pendingWorkspaceFiles: [], bomProjectId: '', modules: Object.fromEntries(NAV_ITEMS.map(item => [item.id, true])), apiToken: '', user: null, organization: null, nav: NAV_ITEMS.map(item => ({ ...item })) };
}

export function filterProjects(projects, query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return projects;
  return projects.filter(project => [project.title, project.owner, project.tag].some(value => String(value).toLowerCase().includes(normalized)));
}

export function getProgressTone(progress) {
  const value = Number(progress) || 0;
  return value >= 100 ? 'done' : value <= 0 ? 'idle' : 'active';
}

export function getViewTitle(view) {
  return [...NAV_ITEMS, ...PLATFORM_NAV_ITEMS].find(item => item.id === view)?.label || '项目管理';
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

function initials(value) { return String(value || '').slice(0, 1); }

function formatConversationTime(value) {
  if (!value) return '暂无消息';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function filterProjectCommunications(conversations = [], { projectId = '', query = '' } = {}) {
  const normalized = String(query || '').trim().toLowerCase();
  return conversations.filter(conversation => conversation.projectId
    && (!projectId || conversation.projectId === projectId)
    && (!normalized || [conversation.title, conversation.projectTitle, conversation.preview, conversation.lastSender].some(value => String(value || '').toLowerCase().includes(normalized))));
}

export function filterChatConversations(conversations = [], { filter = 'all', scope = 'all', query = '' } = {}) {
  const normalized = String(query || '').trim().toLowerCase();
  return conversations.filter(conversation => {
    const stateMatches = filter === 'unread' ? Number(conversation.unreadCount || 0) > 0
      : filter === 'mentions' ? Number(conversation.mentionCount || 0) > 0
        : filter === 'later' ? Boolean(conversation.savedForLater) : true;
    const scopeMatches = scope === 'enterprise' ? !conversation.projectId
      : scope === 'projects' ? Boolean(conversation.projectId)
        : scope.startsWith('project:') ? conversation.projectId === scope.slice(8) : true;
    const queryMatches = !normalized || [conversation.title, conversation.projectTitle, conversation.preview, conversation.lastSender].some(value => String(value || '').toLowerCase().includes(normalized));
    return stateMatches && scopeMatches && queryMatches;
  });
}

function hasLaterConversationMessage(previous, incoming) {
  if (!incoming) return false;
  const previousCount = Number(previous?.messageCount || 0);
  const incomingCount = Number(incoming.messageCount || 0);
  if (incomingCount !== previousCount) return incomingCount > previousCount;
  const previousTime = Date.parse(previous?.lastMessageAt || '');
  const incomingTime = Date.parse(incoming.lastMessageAt || '');
  return Number.isFinite(incomingTime) && (!Number.isFinite(previousTime) || incomingTime > previousTime);
}

export function conversationHasNewMessages(previous, incoming) {
  if (hasLaterConversationMessage(previous, incoming)) return true;
  return Boolean(previous) && (String(previous.preview || '') !== String(incoming.preview || '') || String(previous.lastSender || '') !== String(incoming.lastSender || ''));
}

export function mergeConversationMessages(existing = [], incoming = []) {
  const mergedMessages = new Map();
  (Array.isArray(incoming) ? incoming : []).forEach(message => {
    if (message?.id) mergedMessages.set(message.id, message);
  });
  (Array.isArray(existing) ? existing : []).forEach(message => {
    if (message?.id && !mergedMessages.has(message.id)) mergedMessages.set(message.id, message);
  });
  return [...mergedMessages.values()].sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')) || String(left.id || '').localeCompare(String(right.id || '')));
}

function formatFileSize(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function formatCents(value, currency = 'CNY') {
  const amount = (Number(value) || 0) / 100;
  try { return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${currency} ${amount.toFixed(2)}`; }
}

/**
 * Compatibility export for callers that already have a project snapshot.
 * The actual conversion lives in getTaskRelatedContent so the popup and
 * external callers cannot drift into two different resource contracts.
 */
export function buildRelatedContent(related = {}, projectId = '') {
  return getTaskRelatedContent({}, projectId, related);
}

export function renderTaskShortcutMenu({ taskId = '', projectId = '', title = '', projectRoot = false, capabilities = null, canRecycleProject = Boolean(capabilities?.canRecycleProject) } = {}) {
  const attrs = `data-task-shortcuts-menu data-task-id="${esc(taskId)}" data-project-id="${esc(projectId)}" data-task-title="${esc(title)}"`;
  const actionIcons = { 'copy-link': 'link', 'copy-task': 'copy', 'set-assignee': 'user-round', 'set-status': 'workflow', 'set-due': 'calendar-days', 'add-subtask': 'plus', 'view-subtasks': 'list-todo', recycle: 'trash-2' };
  const actionButton = (action, label, allowed = true, className = '') => `<button type="button" data-task-shortcut="${action}" role="menuitem"${className ? ` class="${className}"` : ''}${allowed ? '' : ' disabled aria-disabled="true" title="当前账号没有此操作权限"'}><i data-lucide="${actionIcons[action]}" aria-hidden="true"></i><span>${label}</span></button>`;
  const hasCapabilitySnapshot = capabilities && typeof capabilities === 'object';
  const canEdit = !hasCapabilitySnapshot || Boolean(capabilities.canEdit);
  const canTransfer = !hasCapabilitySnapshot || Boolean(capabilities.canTransferAssignee || capabilities.canClaim);
  const canOrganize = projectRoot ? canRecycleProject : Boolean(capabilities?.canDelete);
  const copyAction = projectRoot ? '' : actionButton('copy-task', '复制任务', canEdit);
  const organizeActions = canOrganize ? `<hr role="separator">${actionButton('recycle', '移入回收站', true, 'danger')}` : '';
  return `<div class="task-shortcut-menu" ${attrs} role="menu" aria-label="任务快捷操作" popover="manual" hidden>${actionButton('copy-link', '复制任务链接')}${copyAction}<hr role="separator">${actionButton('set-assignee', '设置负责人', canTransfer)}${actionButton('set-status', '更改状态', Boolean(capabilities?.canChangeStatus))}${actionButton('set-due', '设置时间', canEdit)}<hr role="separator">${actionButton('add-subtask', '添加子任务', Boolean(capabilities?.canManageSubtasks))}${actionButton('view-subtasks', '查看子任务')}${organizeActions}</div>`;
}

function renderProjectCard(project, store = {}) {
  const dueAt = String(project.dueAt || '').trim();
  const rootTask = (store.tasks || []).find(task => String(task?.id || '') === String(project?.rootTaskId || ''));
  const executorId = resolveProjectExecutorId(rootTask, project);
  const executor = (store.members || []).find(member => String(member?.id || '') === executorId);
  const executorName = executor?.displayName || executor?.username || project.executor || '未分配';
  const avatarLetter = executorName === '未分配' ? '—' : String(executorName).slice(0, 1);
  const canExecute = canCurrentUserExecuteProject(store, project);
  const taskCapabilities = deriveTaskCapabilities(store, {
    task: { id: project.rootTaskId || '', projectId: project.id || '', assigneeUserId: executorId, dueAt }
  }, { project });
  const draggable = Boolean(project.rootTaskId && canExecute);
  taskCapabilities.canRecycleProject = enterpriseCan(store, 'project.delete');
  const editAttrs = canExecute ? '' : ' disabled aria-disabled="true" title="只有当前负责人可以编辑项目"';
  return `<article class="project-card" data-project-card data-project-id="${esc(project.id || '')}" data-project-open="${esc(project.id || project.title)}" draggable="${draggable}" tabindex="0" aria-grabbed="false"><div class="project-card-title"><span class="project-card-grip" aria-hidden="true">⠿</span><div class="project-card-copy"><b title="${esc(project.title)}">${esc(project.title || '未命名项目')}</b><small class="project-card-subline"><span>${executorName !== '未分配' ? esc(executorName) : '未分配'}</span></small></div><div class="project-card-actions"><button type="button" class="project-card-assignee ${executor ? '' : 'is-empty'}" data-task-shortcuts-trigger data-task-id="${esc(project.rootTaskId || '')}" data-project-id="${esc(project.id || '')}" aria-expanded="false" aria-haspopup="menu" title="${esc(executorName)} 的任务快捷操作" aria-label="${esc(executorName)} 的任务快捷操作"><span class="member-avatar tiny">${esc(avatarLetter)}</span></button><button type="button" class="project-card-edit" aria-label="编辑项目" title="编辑项目" data-action="edit-project" data-project-id="${esc(project.id || '')}"${editAttrs}>✎</button></div></div>${dueAt ? `<footer><span>截止日期</span><time datetime="${esc(dueAt)}">${esc(dueAt)}</time></footer>` : ''}${renderTaskShortcutMenu({ taskId: project.rootTaskId || '', projectId: project.id || '', title: project.title || '', projectRoot: Boolean(project.rootTaskId), capabilities: taskCapabilities })}</article>`;
}

function renderProjects(store) {
  const filtered = filterProjects(store.projects || [], store.query);
  const columns = PROJECT_BOARD_STAGES.map(stage => {
    const projects = filtered.filter(project => projectBoardStage(project) === stage.id);
    return `<section class="kanban-column" data-project-stage="${esc(stage.id)}"><header><b>${esc(stage.label)}</b><span>${projects.length}</span></header><div class="kanban-items" data-project-dropzone>${projects.map(project => renderProjectCard(project, store)).join('')}</div><button class="add-column-button" data-create-project-stage="${esc(stage.id)}" type="button">＋ 新增</button></section>`;
  }).join('');
  return `<section class="view projects-view project-board-home"><div class="project-board-toolbar"><div><h2>项目管理</h2><span>${filtered.length}${filtered.length !== (store.projects || []).length ? ` / ${(store.projects || []).length}` : ''} 个项目</span></div><div class="view-actions">${renderTaskRecycleEntry(store)}<button class="primary-button" data-action="create-project">＋ 新建项目</button></div></div><div class="kanban-scroll"><div class="kanban-board">${columns}</div></div></section>`;
}

function renderTaskRecycleEntry(store) {
  return canOpenTaskRecycleBin(store) ? '<button type="button" class="outline-button task-recycle-entry" data-action="task-recycle-bin"><i data-lucide="archive-restore" aria-hidden="true"></i>回收站</button>' : '';
}

const STORAGE_SCOPE_LABELS = Object.freeze({ personal: '个人空间', enterprise: '企业空间' });

export function filterStorageFiles(files = [], { query = '', projectId = '', projects = [] } = {}) {
  const normalized = String(query || '').trim().toLowerCase();
  const projectTitles = new Map((Array.isArray(projects) ? projects : []).map(project => [String(project?.id || ''), project?.title || '']));
  return (Array.isArray(files) ? files : []).filter(file => {
    if (projectId && String(file?.projectId || '') !== String(projectId)) return false;
    if (!normalized) return true;
    return [file?.name, file?.ownerDisplayName, file?.ownerUsername, file?.extension, file?.projectTitle, projectTitles.get(String(file?.projectId || ''))]
      .some(value => String(value || '').toLowerCase().includes(normalized));
  });
}

function storageFileIcon(file = {}) {
  const kind = String(file.previewKind || '').toLowerCase();
  if (kind === 'image') return 'IMG';
  if (kind === 'pdf') return 'PDF';
  if (kind === 'office') return String(file.extension || 'DOC').toUpperCase().slice(0, 4);
  if (kind === 'cad') return 'CAD';
  if (kind === 'video') return 'VID';
  if (kind === 'audio') return 'AUD';
  if (kind === 'text') return 'TXT';
  if (['zip', 'rar', '7z'].includes(String(file.extension || '').toLowerCase())) return 'ZIP';
  return String(file.extension || 'FILE').toUpperCase().slice(0, 4) || 'FILE';
}

function storageFileDate(value) {
  if (!value) return '暂无时间';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN');
}

function renderStoragePendingFile(file) {
  const preview = file.previewUrl
    ? `<img src="${esc(file.previewUrl)}" alt="${esc(file.name)}" loading="lazy">`
    : `<span class="storage-pending-icon" aria-hidden="true">${esc(file.extension || 'FILE').toUpperCase().slice(0, 5)}</span>`;
  return `<article class="storage-pending-file" data-storage-pending-id="${esc(file.id)}"><div class="storage-pending-preview">${preview}</div><div class="storage-pending-copy"><b title="${esc(file.name)}">${esc(file.name)}</b><small>${esc(formatFileSize(file.sizeBytes))} · ${esc(STORAGE_SCOPE_LABELS[file.scope] || '待上传')}</small></div><button type="button" class="storage-icon-button danger" data-storage-pending-remove="${esc(file.id)}" aria-label="移除 ${esc(file.name)}" title="移除 ${esc(file.name)}">×</button></article>`;
}

export function renderStorageSpace(store = {}) {
  const scope = store.storageScope === 'enterprise' ? 'enterprise' : 'personal';
  const projects = Array.isArray(store.projects) ? store.projects : [];
  const projectName = projectId => projects.find(project => String(project.id) === String(projectId))?.title || '未关联项目';
  const files = filterStorageFiles(store.storageFiles, { query: store.storageQuery, projects });
  const pending = Array.isArray(store.storagePendingFiles) ? store.storagePendingFiles : [];
  const canDeleteFile = file => file?.ownerUserId === store.user?.id || enterpriseCan(store, 'storage.enterprise.delete');
  const projectSelect = `<label class="storage-project-select"><span>归属项目</span><select data-storage-project aria-label="归属项目" ${scope === 'personal' ? 'disabled' : ''}><option value="">不关联项目</option>${projects.map(project => `<option value="${esc(project.id)}" ${String(project.id) === String(store.storageProjectId || '') ? 'selected' : ''}>${esc(project.title)}</option>`).join('')}</select></label>`;
  const pendingMarkup = pending.length ? `<section class="storage-pending-block"><header><div><b>待上传文件</b><small>${pending.length}</small></div><button type="button" class="storage-text-button" data-storage-pending-clear ${store.storageUploading ? 'disabled' : ''}>清空</button></header><div class="storage-pending-list">${pending.map(renderStoragePendingFile).join('')}</div><footer><span>文件只会在点击上传后写入${scope === 'enterprise' ? '企业' : '个人'}空间</span><button type="button" class="primary-button" data-storage-pending-submit ${store.storageUploading ? 'disabled' : ''}><span aria-hidden="true">↑</span>${store.storageUploading ? '正在上传…' : `上传 ${pending.length} 个文件`}</button></footer></section>` : '';
  const fileRows = files.map(file => `<article class="storage-file-row" data-storage-file-id="${esc(file.id)}"><div class="storage-file-ident"><span class="storage-file-icon kind-${esc(file.previewKind || 'file')}">${esc(storageFileIcon(file))}</span><div class="storage-file-main"><b title="${esc(file.name)}">${esc(file.name)}</b><small>${esc(STORAGE_SCOPE_LABELS[file.scope] || file.scope || '文件')} · ${esc(file.projectId ? projectName(file.projectId) : file.scope === 'enterprise' ? '企业公共文件' : '个人文件')}</small></div></div><span class="storage-file-owner">${esc(file.ownerDisplayName || file.ownerUsername || '我')}</span><span class="storage-file-size">${esc(formatFileSize(file.sizeBytes))}</span><time>${esc(storageFileDate(file.updatedAt || file.createdAt))}</time><div class="storage-file-actions"><button type="button" class="storage-row-button" data-storage-file-preview="${esc(file.id)}" title="预览 ${esc(file.name)}">预览</button><button type="button" class="storage-row-button" data-storage-file-download="${esc(file.id)}" title="下载 ${esc(file.name)}">下载</button>${canDeleteFile(file) ? `<button type="button" class="storage-row-button danger" data-storage-file-delete="${esc(file.id)}" title="删除 ${esc(file.name)}">删除</button>` : ''}</div></article>`).join('');
  const listMarkup = store.storageLoading ? '<div class="storage-empty"><b>正在加载文件</b><span>请稍候…</span></div>' : fileRows || '<div class="storage-empty"><span class="storage-empty-icon" aria-hidden="true">＋</span><b>这里还没有文件</b><span>上传图纸、报价资料或协作文件后，它们会按空间归类。</span></div>';
  return `<section class="view storage-view"><div class="storage-head"><div><span class="eyebrow">FILE SPACE</span><h2>文件空间</h2><p>个人文件仅自己可见；企业公共文件对全体成员可见，关联项目后仅项目成员可见。</p></div><div class="storage-head-actions">${projectSelect}<button type="button" class="primary-button" data-action="storage-upload"><span aria-hidden="true">＋</span>上传文件</button><input type="file" data-storage-file-input accept="${STORAGE_FILE_ACCEPT}" multiple hidden></div></div><div class="storage-scope-tabs" role="tablist" aria-label="文件空间范围"><button type="button" class="${scope === 'personal' ? 'active' : ''}" data-storage-scope="personal" role="tab" aria-selected="${scope === 'personal'}"><span class="storage-scope-icon">⌂</span><span><b>个人空间</b><small>仅自己可见</small></span></button><button type="button" class="${scope === 'enterprise' ? 'active' : ''}" data-storage-scope="enterprise" role="tab" aria-selected="${scope === 'enterprise'}"><span class="storage-scope-icon">▦</span><span><b>企业空间</b><small>公共或按项目共享</small></span></button></div><div class="storage-toolbar"><label class="storage-search"><span aria-hidden="true">⌕</span><input data-storage-search value="${esc(store.storageQuery || '')}" placeholder="搜索文件名或项目" aria-label="搜索文件名或项目"></label><span class="storage-count">${files.length} 个文件</span></div>${pendingMarkup}<div class="storage-file-list"><header class="storage-file-list-head"><span>文件</span><span>所有者</span><span>大小</span><span>更新时间</span><span>操作</span></header>${listMarkup}</div></section>`;
}

function renderEmbeddedWorkspace(store, { background = false } = {}) {
  const projectId = store.bomProjectId || '';
  const src = `./workspace.html${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`;
  if (background) return `<iframe class="embedded-workspace-frame workspace-background-frame" src="${src}" title="3D 项目清单后台解析" loading="eager" aria-hidden="true" tabindex="-1"></iframe>`;
  return `<section class="view embedded-workspace-view"><iframe class="embedded-workspace-frame" src="${src}" title="制表中心 2D 图纸标注与 FAIR 工作台" loading="eager"></iframe></section>`;
}

function workspaceFileKind(name) {
  const extension = String(name || '').split('.').pop()?.toLowerCase();
  if (extension === 'pdf') return 'PDF';
  if (extension === 'zip') return 'ZIP';
  return 'CAD';
}

export function getWorkspaceLaunchMode(files = []) {
  const accepted = Array.isArray(files) ? files : [];
  return accepted.length && accepted.every(file => /\.pdf$/i.test(String(file?.name || ''))) ? 'pdf' : 'background';
}

export function renderWorkspace(store) {
  if (store.workspaceStarted && store.workspaceMode === 'pdf') return renderEmbeddedWorkspace(store);
  const projectId = store.bomProjectId || '';
  const files = Array.isArray(store.workspaceFiles) ? store.workspaceFiles : [];
  const backgroundProcessing = Boolean(store.workspaceStarted && store.workspaceMode === 'background');
  const fileList = files.map((file, index) => `<div class="workspace-upload-file"><span>${workspaceFileKind(file.name)}</span><b title="${esc(file.name)}">${esc(file.name)}</b><small>${formatFileSize(file.size)}</small><button type="button" data-workspace-file-remove="${index}" aria-label="移除 ${esc(file.name)}" title="移除文件">×</button></div>`).join('');
  const cubeIcon = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m24 5 16 9v19l-16 10L8 33V14Z"/><path d="m8 14 16 10 16-10M24 24v19"/></svg>';
  const brepIcon = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m24 5 16 9v19l-16 10L8 33V14Z"/><path d="m8 14 16 10 16-10M24 24v19"/><path d="m16 18 8-5 8 5v10l-8 5-8-5Z"/></svg>';
  const tableIcon = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="8" width="34" height="32" rx="2"/><path d="M7 19h34M7 30h34M18 8v32M30 8v32"/></svg>';
  const defaultStatus = files.length ? projectId ? `已选择 ${files.length} 个文件，将生成并导入当前项目清单` : `已选择 ${files.length} 个文件，请选择导入项目` : '原始图纸和模型仅在浏览器本地解析，生成结果同步到项目任务';
  const statusText = store.workspaceStatus || defaultStatus;
  const statusTone = store.workspaceStatusTone ? ` is-${esc(store.workspaceStatusTone)}` : '';
  const backgroundFrame = backgroundProcessing ? renderEmbeddedWorkspace(store, { background: true }) : '';
  return `<section class="view quote-workspace-entry"><section class="workspace-hero"><p>上传 STEP 或项目压缩包，3D 零件在当前页面后台生成 BOM、制造数据和报价基础，并直接同步到所选项目任务；只有 2D PDF 图纸会进入气泡标注与 FAIR 检验流程。</p><div class="workspace-process" aria-label="本地解析流程"><div class="process-step"><span class="process-icon blue">${cubeIcon}</span><b>CAD / STEP</b></div><i class="process-connector"><span>后台解析</span></i><div class="process-step"><span class="process-icon purple">${brepIcon}</span><b>B-REP DATA</b></div><i class="process-connector"><span>自动同步</span></i><div class="process-step"><span class="process-icon green">${tableIcon}</span><b>项目 BOM</b></div></div></section><section class="upload-card"><header class="workspace-upload-head"><h2>导入项目清单</h2></header><div class="workspace-project-row"><label><b>导入项目：</b><select data-workspace-project aria-label="导入项目" ${backgroundProcessing ? 'disabled' : ''}><option value="">选择或创建项目</option>${(store.projects || []).map(project => `<option value="${esc(project.id)}" ${String(project.id) === String(projectId) ? 'selected' : ''}>${esc(project.title)}</option>`).join('')}</select></label><button type="button" class="primary-button" data-action="new-project" ${backgroundProcessing ? 'disabled' : ''}>新建项目</button></div><label class="cloud-dropzone ${backgroundProcessing ? 'is-processing' : ''}" data-workspace-dropzone><input type="file" data-workspace-upload accept=".step,.stp,.igs,.iges,.brep,.pdf,.zip" multiple ${backgroundProcessing ? 'disabled' : ''}><span class="upload-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v4h14v-4"/></svg></span><b>${backgroundProcessing ? '正在后台解析 3D 文件' : '点击或拖拽文件上传'}</b><small>STEP、STP、IGES、BREP、PDF、ZIP · 最大 50MB</small><em>3D / ZIP 留在本页生成项目 BOM，PDF 进入标注与 FAIR</em></label><div class="workspace-upload-list">${fileList}</div><footer class="upload-footer"><span class="workspace-generation-status${statusTone}" data-workspace-status aria-live="polite">${esc(statusText)}</span><button type="button" class="primary-button workspace-start-button" data-action="start-workspace-analysis" ${files.length && projectId && !backgroundProcessing ? '' : 'disabled'}>${backgroundProcessing ? '正在生成项目清单…' : '生成项目清单'}</button></footer></section>${backgroundFrame}</section>`;
}

function partField(value, fallback = '待补充') {
  const present = String(value ?? '').trim();
  return present ? `<b>${esc(present)}</b>` : `<b class="part-missing">${fallback}</b>`;
}

function partCompleteness(part) {
  const missing = [part.size, part.volume, part.material, part.finish].filter(value => !String(value ?? '').trim()).length;
  return { missing, complete: missing === 0 };
}

const PART_MATERIAL_OPTIONS = ['Aluminum 6061', 'Aluminum 5052', 'Aluminum 7075', 'Stainless Steel 304', 'Stainless Steel 316', 'Steel 1018', 'Brass C360', 'POM (Delrin)', '自定义'];
const PART_FINISH_OPTIONS = ['As Machined', 'Anodizing (Clear)', 'Anodizing (Black)', 'Hard Anodizing', 'Powder Coating', 'Passivation', 'Polishing', '自定义'];

function partSelectOptions(values, selectedValue) {
  const selected = String(selectedValue ?? '').trim();
  // Keep legacy or externally supplied values visible instead of silently
  // falling back to "请选择" when the option list has not caught up yet.
  const choices = selected && !values.includes(selected) ? [selected, ...values] : values;
  return `<option value="" ${selected ? '' : 'selected'}>请选择</option>${choices.map(value => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join('')}`;
}

export function renderParts(store) {
  const parts = store.parts || [];
  const selected = parts.find(part => part.id === store.selectedPart) || parts[0];
  if (!selected) return `<section class="view parts-view"><div class="parts-empty"><b>还没有零件</b><span>选择所属项目并录入零件；需要解析 STEP 时可进入制表中心。</span></div></section>`;
  const completeness = partCompleteness(selected);
  const listMarkup = parts.map(part => { const state = partCompleteness(part); return `<button class="part-list-item ${part.id===selected.id?'active':''}" data-part-id="${esc(part.id)}"><b>${esc(part.name)}</b><small>${esc(part.project || '未分组')} · ${esc(part.order || '未分组')} · ${esc(part.format || 'STEP')}</small><time>${esc(part.uploaded || '')}</time><span class="part-list-state ${state.complete ? 'complete' : ''}">${state.complete ? '✓' : '!'}</span></button>`; }).join('');
  const cell = (label, value) => `<div class="parts-info-cell"><span>${label}</span><strong>${esc(value || '待补充')}</strong></div>`;
  return `<section class="view parts-view"><div class="split-card"><aside class="parts-list"><div class="split-heading"><div class="split-heading-top"><h2>零件清单 <span>${parts.length}</span></h2></div><div class="search-inline"><span>⌕</span><input data-part-search placeholder="按零件名搜索"></div></div><div class="parts-list-body">${listMarkup}</div></aside><article class="part-detail"><header class="detail-header"><div><h2>${esc(selected.name)} <em>${esc(selected.format || 'STEP')}</em></h2><p>上传于 ${esc(selected.uploaded || '未知时间')}</p></div></header><section class="part-preview"><div class="preview-title"><b>零件预览</b></div><div class="preview-empty"><div class="preview-cube"><i></i><i></i><i></i></div></div></section><section class="detail-section"><h3>基本信息</h3><div class="parts-info-grid">${cell('零件名', selected.name)}${cell('格式', selected.format)}${cell('所属项目', selected.project)}${cell('订单号', selected.order)}${cell('上传时间', selected.uploaded)}</div></section><section class="detail-section"><h3>尺寸体积</h3><div class="parts-info-grid parts-info-grid-three">${cell('尺寸 (mm)', selected.size)}${cell('体积 (mm³)', selected.volume)}${cell('数量', selected.quantity || 1)}</div></section><section class="detail-section"><h3>材料工艺</h3><div class="parts-info-grid parts-info-grid-two">${cell('材料', selected.material)}${cell('表面处理', selected.finish)}</div></section></article></div></section>`;
}

export function renderCommunication(store) {
  return renderCommunicationList(store);
}

function renderChat(store) {
  const allConversations = store.conversations || [];
  const conversations = filterChatConversations(allConversations, { filter: store.chatFilter, scope: store.chatScope, query: store.chatQuery });
  // Keep the detail pane aligned with the active list filters. Previously a
  // conversation selected under “全部” could remain visible on the right
  // after switching to “未读/@我的/稍后处理”, even though it disappeared
  // from the left list.
  const selected = conversations.find(item => item.id === store.selectedChat) || conversations[0] || null;
  // The detail pane must never keep an ID that is hidden by the active
  // filters. Besides making the empty state misleading, a stale ID caused a
  // message typed after a no-results search to be sent into the old thread.
  if (selected?.id !== store.selectedChat) store.selectedChat = selected?.id || '';
  const messages = selected ? store.messages[selected.id] : [];
  const tabs = [
    ['all', '全部', allConversations.length],
    ['unread', '未读', allConversations.filter(item => item.unreadCount > 0).length],
    ['mentions', '@我的', allConversations.filter(item => item.mentionCount > 0).length],
    ['later', '稍后处理', allConversations.filter(item => item.savedForLater).length]
  ];
  const listMarkup = conversations.length ? conversations.map(chat => `<button class="chat-list-item ${chat.id===selected?.id?'active':''} ${chat.unreadCount ? 'unread' : ''}" data-chat-id="${esc(chat.id)}"><span class="avatar ${chat.projectId ? 'orange' : 'blue'}">${esc(initials(chat.projectTitle || chat.title))}</span><div><b>${esc(chat.title)}</b><small><span>${esc(chat.projectTitle || store.organization?.name || '企业会话')}</span>${chat.preview ? ` · ${esc(chat.preview)}` : ' · 暂无消息'}</small></div><time>${esc(formatConversationTime(chat.lastMessageAt || chat.createdAt))}</time>${chat.unreadCount ? `<em title="${chat.unreadCount} 条未读">${chat.unreadCount > 99 ? '99+' : chat.unreadCount}</em>` : chat.savedForLater ? '<i title="稍后处理">稍后</i>' : ''}</button>`).join('') : `<div class="communication-list-empty"><b>${allConversations.length ? '没有匹配的会话' : '还没有会话'}</b><span>${allConversations.length ? '调整筛选条件或搜索关键词' : '新建企业频道后，当前企业成员都可以查看和参与'}</span>${allConversations.length ? '<button class="small-outline" data-action="clear-chat-filters">清除筛选</button>' : '<button class="small-outline" data-action="create-chat-conversation">＋ 新建企业频道</button>'}</div>`;
  const messageMarkup = !selected ? '<div class="communication-detail-empty"><span>▣</span><b>选择或新建企业频道</b><span>企业频道面向当前企业成员可见，创建后即可开始沟通</span><button class="primary-button" data-action="create-chat-conversation">＋ 新建企业频道</button></div>'
    : !Array.isArray(messages) ? '<div class="communication-loading">正在加载消息...</div>'
      : messages.length ? `<div class="chat-date">最近</div>${messages.map(message => {
        const mine = message.mine || message.userId === store.user?.id;
        const attachments = (message.attachments || []).map(attachment => `<button class="chat-message-attachment" data-chat-attachment-download="${esc(attachment.id)}" data-chat-attachment-name="${esc(attachment.name)}" title="下载 ${esc(attachment.name)}"><span>▱</span><b>${esc(attachment.name)}</b><small>${esc(formatFileSize(attachment.sizeBytes))}</small></button>`).join('');
        return `<div class="message-row ${mine ? 'mine' : ''}"><span class="avatar ${mine ? 'blue' : 'gray'}">${esc(initials(message.displayName || message.username))}</span><div><small>${esc(message.displayName || message.username || '成员')} · ${esc(new Date(message.createdAt).toLocaleString('zh-CN'))}</small>${message.body ? `<p>${esc(message.body)}</p>` : ''}${attachments ? `<div class="chat-message-attachments">${attachments}</div>` : ''}</div></div>`;
      }).join('')}` : '<div class="communication-thread-empty"><b>还没有消息</b><span>写下第一条消息开始讨论</span></div>';
  const draftAttachments = (store.chatDraftAttachments || []).map(attachment => `<div class="chat-draft-attachment"><span>▱</span><b title="${esc(attachment.name)}">${esc(attachment.name)}</b><small>${esc(formatFileSize(attachment.sizeBytes))}</small><button data-action="remove-chat-attachment" data-chat-attachment-id="${esc(attachment.id)}" title="移除附件" aria-label="移除 ${esc(attachment.name)}">×</button></div>`).join('');
  return `<section class="view chat-view"><input type="file" data-chat-attachment-input accept="${CHAT_ATTACHMENT_ACCEPT}" multiple hidden><div class="split-card chat-card"><aside class="chat-list"><div class="split-heading chat-heading"><div class="split-heading-top"><h2>聊天信息 <span>${allConversations.length}</span></h2><button type="button" class="small-outline" data-action="create-chat-conversation" aria-label="新建企业频道">＋ 新建</button></div><nav class="chat-filter-tabs" aria-label="会话状态筛选">${tabs.map(([id,label,count]) => `<button class="${store.chatFilter===id?'active':''}" data-chat-filter="${id}">${label}${count ? `<em>${count}</em>` : ''}</button>`).join('')}</nav><label class="communication-search chat-search"><span>⌕</span><input data-chat-search value="${esc(store.chatQuery || '')}" placeholder="搜索会话或消息"></label><select data-chat-scope aria-label="按企业或项目筛选"><option value="all" ${store.chatScope==='all'?'selected':''}>全部会话</option><option value="enterprise" ${store.chatScope==='enterprise'?'selected':''}>企业会话</option><option value="projects" ${store.chatScope==='projects'?'selected':''}>全部项目会话</option>${store.projects.map(project => `<option value="project:${esc(project.id)}" ${store.chatScope===`project:${project.id}`?'selected':''}>${esc(project.title)}</option>`).join('')}</select></div><div class="chat-list-body">${listMarkup}</div></aside><article class="chat-detail"><header>${selected ? `<div><h2>${esc(selected.title)}</h2><small>${esc(selected.projectTitle || store.organization?.name || '企业会话')}</small></div><button class="chat-later-button ${selected.savedForLater ? 'active' : ''}" data-action="toggle-chat-later" title="${selected.savedForLater ? '移出稍后处理' : '稍后处理'}" aria-label="${selected.savedForLater ? '移出稍后处理' : '稍后处理'}">⚑</button>` : '<h2>企业频道</h2>'}</header><div class="chat-messages" data-chat-messages>${messageMarkup}</div><footer class="chat-compose"><div class="chat-draft-attachments">${draftAttachments}</div><textarea id="chatInput" rows="2" maxlength="4000" placeholder="${selected ? '输入消息，Enter 发送 / Ctrl + Enter 换行' : '请先新建或选择企业频道'}">${esc(store.chatDraft || '')}</textarea><div class="chat-compose-actions"><div><button class="chat-tool-button" data-action="attach-chat-file" title="添加附件" aria-label="添加附件" ${store.chatUploading || store.chatDraftAttachments.length >= 5 ? 'disabled' : ''}>📎</button></div>${store.chatUploading ? '<span>上传中...</span>' : store.chatSending ? '<span>发送中...</span>' : ''}<button class="primary-button" data-action="send-chat" ${store.chatUploading || store.chatSending ? 'disabled' : ''}>发送</button></div></footer></article></div></section>`;
}

function renderTasks(store) {
  // The API already scopes this list to the current executor. Keep the client
  // boundary as a second guard while rendering, so clearing an assignee in a
  // task detail cannot leave a stale row visible until the next refresh.
  const source = filterMyTasks(store.tasks || [], store.user?.id);
  const query = String(store.query || '').trim().toLowerCase();
  const filtered = query
    ? source.filter(task => [task.title, task.stage, task.owner, task.description, task.status, task.priority]
      .some(value => String(value || '').toLowerCase().includes(query)))
    : source;
  const projectById = new Map((store.projects || []).map(project => [String(project.id || ''), project]));
  const rows = filtered.map(task => {
    const taskId = String(task.id || '');
    const projectId = String(task.projectId || '');
    const project = projectById.get(projectId)
      || (store.projects || []).find(item => String(item.rootTaskId || '') === taskId);
    const stage = taskBoardStatus(task);
    const owner = (store.members || []).find(member => String(member.id) === String(task.assigneeUserId || ''));
    const ownerName = owner?.displayName || owner?.username || task.owner || '未分配';
    const priority = String(task.priority || '普通').trim() || '普通';
    const description = String(task.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const progress = taskBoardProgress(task);
    const rawStatus = String(task.status || '').trim();
    const status = LEGACY_TASK_STATUS_OPTIONS.includes(rawStatus)
      ? rawStatus
      : stage === '订单结束/已完成' ? '已完成' : stage === '异常/优先处理' ? '阻塞' : '进行中';
    const statusClass = status === '已完成' ? 'done' : status === '阻塞' ? 'blocked' : status === '待处理' ? 'pending' : 'active';
    return `<tr class="my-task-row task-priority-${taskPriorityClass(priority)}" data-action="open-my-task" data-my-task-row data-task-id="${esc(taskId)}" data-project-id="${esc(project?.id || projectId)}" tabindex="0" aria-label="打开任务 ${esc(task.title || '未命名任务')}"><td><div class="task-table-title"><b title="${esc(task.title)}">${esc(task.title || '未命名任务')}</b>${project ? `<small title="${esc(project.title)}">${esc(project.title)}</small>` : description ? `<small title="${esc(description)}">${esc(description)}</small>` : ''}</div></td><td><span class="task-table-stage" title="${esc(stage)}"><i aria-hidden="true"></i>${esc(stage)}</span></td><td><span class="task-table-owner"><i class="member-avatar tiny" aria-hidden="true">${esc(String(ownerName).slice(0, 1))}</i>${esc(ownerName)}</span></td><td><div class="task-table-progress" role="img" aria-label="进度 ${progress}%"><i><span style="width:${progress}%"></span></i><output>${progress}%</output></div></td><td><em class="task-table-status ${statusClass}">${esc(status)}</em></td></tr>`;
  }).join('');
  const taskActions = `<div class="view-actions">${renderTaskRecycleEntry(store)}<button class="outline-button" data-action="import-tasks" title="从 JSON、CSV 或 Excel 导入任务">⇧ 导入任务</button><button class="primary-button" data-action="create-task">＋ 新建任务</button></div>`;
  const body = rows || '<tr><td colspan="5"><div class="task-empty-compact"><b>还没有已认领的任务</b><span>在项目管理中打开任务并认领后，会显示在这里。</span></div></td></tr>';
  return `<section class="view tasks-view task-list-view"><div class="view-intro"><div><h2>我的任务</h2><p>只显示当前账号已经认领或分配的任务。</p></div>${taskActions}</div><div class="table-card task-list-card"><header class="table-card-head"><h2>任务清单</h2><span>${filtered.length}${filtered.length !== source.length ? ` / ${source.length}` : ''} 项</span></header><div class="task-table-wrap"><table class="task-table my-task-table"><thead><tr><th>任务</th><th>所属阶段</th><th>负责人</th><th>进度</th><th>状态</th></tr></thead><tbody>${body}</tbody></table></div></div></section>`;
}

function renderStats(store) {
  const stats = store.stats || {};
  const stageCounts = PROJECT_BOARD_STAGES.map(stage => ({ ...stage, count: store.projects.filter(project => projectBoardStage(project) === stage.id).length }));
  const maxCount = Math.max(1, ...stageCounts.map(item => item.count));
  return `<section class="view stats-view"><div class="view-intro"><div><h2>统计</h2><p>查看当前企业项目、报价、生产和交付的实时指标。</p></div><span class="audit-count">${esc(store.organization?.name || '当前企业')}</span></div><div class="stats-grid"><article><span>项目总数</span><b>${stats.projects ?? store.projects.length}</b><em>${stats.tasks ?? 0} 项任务</em></article><article><span>报价总额</span><b>¥${((stats.quoteTotalCents || 0) / 100).toLocaleString('zh-CN',{minimumFractionDigits:2})}</b><em>${stats.quotes ?? 0} 份报价</em></article><article><span>零件总数</span><b>${stats.parts ?? store.parts.length}</b><em>${stats.fairItems ?? 0} 项 FAIR</em></article><article><span>任务完成率</span><b>${stats.completionRate ?? 0}%</b><em>${stats.completedTasks ?? 0} 项已完成</em></article></div><section class="chart-card"><header><h3>项目阶段分布</h3><span>${store.projects.length} 个真实项目</span></header><div class="bar-chart">${stageCounts.map(item => `<div class="bar-column"><span style="height:${item.count ? Math.max(8, Math.round(item.count / maxCount * 100)) : 0}%" title="${esc(item.label)}：${item.count}"></span><small>${esc(item.label)}</small><em>${item.count}</em></div>`).join('')}</div></section></section>`;
}

function renderPlatformOverview(store) {
  const activeProjects = store.projects.filter(project => project.status !== 'closed').length;
  return `<section class="view platform-view"><div class="view-intro"><div><span class="eyebrow">PLATFORM CONSOLE</span><h2>平台总览</h2><p>从平台层查看全部入驻企业、用户和业务运行情况。</p></div><button class="primary-button" data-view-jump="organizations">管理企业</button></div><div class="stats-grid"><article><span>入驻企业</span><b>${store.organizations.length}</b><em>正常运营</em></article><article><span>平台用户</span><b>${store.organizations.reduce((sum, item) => sum + Number(item.memberCount || 0), 0)}</b><em>当前已激活</em></article><article><span>企业项目</span><b>${store.organizations.reduce((sum, item) => sum + Number(item.projectCount || 0), 0)}</b><em>${activeProjects} 个当前企业项目</em></article><article><span>数据隔离</span><b>正常</b><em>组织级租户边界</em></article></div><section class="chart-card platform-health"><header><div><h3>企业运行概览</h3><span>按租户汇总，不展示企业敏感明细</span></div></header>${store.organizations.map(org => `<div class="health-row"><span class="tenant-logo">${initials(org.name)}</span><div><b>${esc(org.name)}</b><small>${org.projectCount} 个项目 · ${org.memberCount} 位成员</small></div><em>运行正常</em></div>`).join('')}</section></section>`;
}

function renderOrganizations(store) {
  const moduleLabels = { projects: '项目管理', workspace: '制表中心', parts: '零件中心', communication: '项目沟通', chat: '聊天信息', tasks: '我的任务', stats: '统计' };
  return `<section class="view platform-view"><div class="view-intro"><div><h2>企业管理</h2><p>管理平台内的租户企业、启用状态和企业功能模块。</p></div><button class="primary-button" data-action="create-organization">＋ 新建企业</button></div><div class="table-card"><header class="table-card-head"><h2>全部企业</h2><span>${store.organizations.length} 家</span></header><div class="task-table-wrap"><table class="task-table"><thead><tr><th>企业</th><th>标识</th><th>成员</th><th>项目</th><th>已开通模块</th><th>操作</th></tr></thead><tbody>${store.organizations.map(org => `<tr><td><b>${esc(org.name)}</b></td><td>${esc(org.slug)}</td><td>${org.memberCount}</td><td>${org.projectCount}</td><td><div class="module-pills">${Object.entries(org.modules || {}).filter(([key, enabled]) => key !== 'bom' && enabled).map(([key]) => `<em>${moduleLabels[key] || key}</em>`).join('') || '<em>仅基础空间</em>'}</div></td><td><button class="small-outline" data-organization-id="${esc(org.id)}" data-action="configure-organization">配置模块</button> <button class="small-outline" data-organization-id="${esc(org.id)}" data-action="enter-enterprise">进入企业</button></td></tr>`).join('')}</tbody></table></div></div></section>`;
}

function renderPlatformUsers(store) {
  const users = store.platformUsers || [];
  return `<section class="view platform-view"><div class="view-intro"><div><h2>用户管理</h2><p>查看跨企业账号归属、角色与启用状态。</p></div></div><div class="table-card"><header class="table-card-head"><h2>平台用户</h2><span>${users.length} 位</span></header><div class="task-table-wrap"><table class="task-table"><thead><tr><th>用户</th><th>账号</th><th>所属企业</th><th>企业角色</th><th>状态</th></tr></thead><tbody>${users.map(member => `<tr><td><b>${esc(member.displayName)}</b></td><td>@${esc(member.username)}</td><td>${esc((member.organizations || []).join('、') || '未加入企业')}</td><td>${esc((member.roles || []).join('、') || '无')}</td><td><em class="status-tag">正常</em></td></tr>`).join('') || '<tr><td colspan="5">暂无平台用户</td></tr>'}</tbody></table></div></div></section>`;
}

function renderPlatformPlaceholder(title, text) {
  return `<section class="view platform-view"><div class="view-intro"><div><h2>${title}</h2><p>${text}</p></div></div><div class="empty-platform"><span>◫</span><b>平台级能力已独立分区</b><p>后续可在这里接入跨企业审计、告警和平台配置。</p></div></section>`;
}

function renderPlatformAudit(store) {
  const events = store.platformAudit || [];
  return `<section class="view platform-view"><div class="view-intro"><div><span class="eyebrow">SECURITY / AUDIT</span><h2>平台审计</h2><p>跨企业查看登录、成员、模块和业务操作记录。</p></div><span class="audit-count">${events.length} 条记录</span></div><div class="table-card"><div class="task-table-wrap"><table class="task-table"><thead><tr><th>时间</th><th>企业</th><th>操作者</th><th>动作</th><th>对象</th><th>详情</th></tr></thead><tbody>${events.map(event => `<tr><td>${esc(new Date(event.createdAt).toLocaleString('zh-CN'))}</td><td><b>${esc(event.organizationName)}</b></td><td>@${esc(event.username)}</td><td><em class="status-tag">${esc(event.action)}</em></td><td>${esc(event.entityType)}</td><td>${esc(Object.entries(event.metadata || {}).map(([key,value]) => `${key}: ${value}`).join(' · '))}</td></tr>`).join('') || '<tr><td colspan="6">暂无审计记录</td></tr>'}</tbody></table></div></div></section>`;
}

function renderView(store) {
  switch (store.currentView) {
    case 'automation': return renderAutomation(store);
    case 'platform-overview': return renderPlatformOverview(store);
    case 'organizations': return renderOrganizations(store);
    case 'platform-users': return renderPlatformUsers(store);
    case 'platform-audit': return renderPlatformAudit(store);
    case 'workspace': return renderWorkspace(store);
    case 'bom': return renderWorkspace(store);
    case 'parts': return renderParts(store);
    case 'communication': return renderCommunication(store);
    case 'chat': return renderChat(store);
    case 'tasks': return renderTasks(store);
    case 'organization': return renderOrganizationChart(store);
    case 'stats': return canViewTaskHistoryReport(store) ? `${renderStats(store)}${renderTaskHistoryReport(store)}` : '<p role="status">当前账号无权查看管理统计</p>';
    default: return renderProjects(store);
  }
}

function showToast(message) {
  const toast = document.querySelector('#cloudToast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function openProjectDialog(submit, defaultStage = '立项沟通') {
  document.querySelector('#projectDialog')?.remove();
  const host = document.createElement('div');
  host.id = 'projectDialog';
  host.className = 'project-dialog-backdrop';
  host.innerHTML = `<section class="project-dialog" role="dialog" aria-modal="true" aria-labelledby="projectDialogTitle"><header><div><small>NEW PROJECT</small><h2 id="projectDialogTitle">新建项目</h2></div><button type="button" data-project-dialog-close aria-label="关闭">×</button></header><form><label>项目名称<input name="title" maxlength="160" placeholder="输入项目名称" required></label><label>所在阶段<select name="stage">${PROJECT_BOARD_STAGES.map(stage => `<option value="${esc(stage.id)}" ${stage.id === defaultStage ? 'selected' : ''}>${esc(stage.label)}</option>`).join('')}</select></label><footer><button type="button" class="outline-button" data-project-dialog-close>取消</button><button type="submit" class="primary-button">创建项目</button></footer></form></section>`;
  document.body.appendChild(host);
  host.querySelector('option[value="手工录入"]')?.remove();
  const close = () => host.remove();
  host.querySelectorAll('[data-project-dialog-close]').forEach(button => button.addEventListener('click', close));
  host.addEventListener('click', event => { if (event.target === host) close(); });
  host.querySelector('form').addEventListener('submit', event => { event.preventDefault(); const form = new FormData(event.currentTarget); submit(String(form.get('title') || '').trim(), String(form.get('stage') || defaultStage)); close(); });
  host.querySelector('input').focus();
}

function openEditProjectDialog(project, submit) {
  const host = document.createElement('div'); host.className = 'project-dialog-backdrop';
  const currentStage = projectBoardStage(project);
  const stages = PROJECT_BOARD_STAGE_IDS.has(currentStage) ? PROJECT_BOARD_STAGES : [...PROJECT_BOARD_STAGES, { id: currentStage, label: currentStage }];
  host.innerHTML = `<section class="project-dialog" role="dialog" aria-modal="true"><header><div><small>EDIT PROJECT</small><h2>编辑项目</h2></div><button type="button" data-close>×</button></header><form><label>项目名称<input name="title" value="${esc(project.title)}" required></label><label>所在阶段<select name="stage">${stages.map(stage => `<option value="${esc(stage.id)}" ${stage.id===currentStage?'selected':''}>${esc(stage.label)}</option>`).join('')}</select></label><footer><button type="button" class="outline-button" data-close>取消</button><button type="submit" class="primary-button">保存项目</button></footer></form></section>`;
  document.body.appendChild(host); const close = () => host.remove(); host.querySelectorAll('[data-close]').forEach(button => button.onclick = close); host.querySelector('form').onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); submit({ title: data.get('title'), stage: data.get('stage') }); close(); }; host.querySelector('input').focus();
}

function openCommunicationDialog(store, submit, defaults = {}) {
  document.querySelector('#communicationDialog')?.remove();
  const host = document.createElement('div');
  host.id = 'communicationDialog';
  host.className = 'project-dialog-backdrop';
  const preferredProjectId = defaults.projectId || store.communicationProject || store.projects[0]?.id || '';
  host.innerHTML = `<section class="project-dialog communication-dialog" role="dialog" aria-modal="true" aria-labelledby="communicationDialogTitle"><header><div><small>PROJECT DISCUSSION</small><h2 id="communicationDialogTitle">发起项目沟通</h2></div><button type="button" data-close aria-label="关闭">×</button></header><form><label>关联项目<select name="projectId" required><option value="">选择项目</option>${store.projects.map(project => `<option value="${esc(project.id)}" ${project.id === preferredProjectId ? 'selected' : ''}>${esc(project.title)}</option>`).join('')}</select></label><label>沟通主题<input name="title" maxlength="160" placeholder="例如：确认图纸版本与交付日期" required></label><label>第一条消息<textarea name="body" rows="5" maxlength="4000" placeholder="记录问题、决策或需要成员确认的内容" required></textarea></label><footer><button type="button" class="outline-button" data-close>取消</button><button type="submit" class="primary-button">发起沟通</button></footer></form></section>`;
  document.body.appendChild(host);
  const close = () => host.remove();
  host.querySelectorAll('[data-close]').forEach(button => button.onclick = close);
  host.addEventListener('click', event => { if (event.target === host) close(); });
  host.querySelector('form').onsubmit = event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    submit({ projectId: String(form.get('projectId') || ''), title: String(form.get('title') || '').trim(), body: String(form.get('body') || '').trim() });
    close();
  };
  host.querySelector('input').focus();
}

function openChatConversationDialog(submit) {
  document.querySelector('#chatConversationDialog')?.remove();
  const host = document.createElement('div');
  host.id = 'chatConversationDialog';
  host.className = 'project-dialog-backdrop';
  host.innerHTML = `<section class="project-dialog" role="dialog" aria-modal="true" aria-labelledby="chatConversationDialogTitle" aria-describedby="chatConversationVisibility"><header><div><small>ENTERPRISE CHANNEL</small><h2 id="chatConversationDialogTitle">新建企业频道</h2></div><button type="button" data-chat-conversation-dialog-close aria-label="关闭">×</button></header><form><label>频道名称<input name="title" maxlength="160" placeholder="例如：生产排期协同" required></label><p id="chatConversationVisibility" class="muted-note">频道创建后，当前企业的全部成员均可查看和参与。</p><footer><button type="button" class="outline-button" data-chat-conversation-dialog-close>取消</button><button type="submit" class="primary-button">创建频道</button></footer></form></section>`;
  document.body.appendChild(host);
  const close = () => host.remove();
  host.querySelectorAll('[data-chat-conversation-dialog-close]').forEach(button => button.addEventListener('click', close));
  host.addEventListener('click', event => { if (event.target === host) close(); });
  host.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get('title') || '').trim();
    if (!title) return;
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      if (await submit(title)) close();
      else submitButton.disabled = false;
    } catch (error) {
      submitButton.disabled = false;
      showToast(error.message || '企业频道创建失败');
    }
  });
  host.querySelector('input').focus();
}

function openOrganizationDialog(submit, candidates = []) {
  document.querySelector('#organizationDialog')?.remove();
  const host = document.createElement('div'); host.id = 'organizationDialog'; host.className = 'project-dialog-backdrop';
  const modules = [['projects','项目管理'],['workspace','制表中心'],['parts','零件中心'],['communication','项目沟通'],['chat','聊天信息'],['tasks','我的任务'],['stats','统计']];
  host.innerHTML = `<section class="project-dialog" role="dialog" aria-modal="true"><header><div><small>NEW ORGANIZATION</small><h2>新建企业</h2></div><button type="button" data-close>×</button></header><form><label>企业名称<input name="name" maxlength="120" placeholder="例如：苏州精密制造有限公司" required></label><label>企业标识<input name="slug" maxlength="80" pattern="[a-z0-9-]+" placeholder="例如：suzhou-precision" required></label><p class="muted-note">初始开通功能</p>${modules.map(([key,label]) => `<label class="module-toggle"><input type="checkbox" name="${key}" checked> <span>${label}</span></label>`).join('')}<footer><button type="button" class="outline-button" data-close>取消</button><button type="submit" class="primary-button">创建企业</button></footer></form></section>`;
  host.querySelector('[name="slug"]').closest('label').insertAdjacentHTML('afterend', `<label>企业主管理<select name="ownerUserId" required><option value="">选择已有账号</option>${candidates.map(member => `<option value="${esc(member.id)}">${esc(member.displayName)} (@${esc(member.username)})</option>`).join('')}</select></label>`);
  document.body.appendChild(host);
  const close = () => host.remove();
  host.querySelectorAll('[data-close]').forEach(button => button.onclick = close);
  host.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget), button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      if (await submit({ name: String(form.get('name') || '').trim(), slug: String(form.get('slug') || '').trim().toLowerCase(), ownerUserId: form.get('ownerUserId'), modules: Object.fromEntries(modules.map(([key]) => [key, form.has(key)])) })) close();
    } finally { button.disabled = false; }
  };
  host.querySelector('input').focus();
}

function openTaskDialog(store, submit, defaults = {}, existing = null) {
  const host = document.createElement('div'); host.className = 'project-dialog-backdrop';
  const members = store.members?.length ? store.members : [{ id: store.user?.id || '', displayName: store.user?.displayName || '我', username: store.user?.username || 'admin' }];
  const value = (key, fallback = '') => existing?.[key] ?? defaults[key] ?? fallback;
  const currentUserId = String(store.user?.id || store.user?.userId || '').trim();
  // New standalone tasks belong to their creator by default. Existing tasks
  // keep their persisted assignee, while the empty option remains available
  // for an intentional release.
  const defaultAssigneeId = existing
    ? String(value('assigneeUserId') || '').trim()
    : (members.some(member => String(member?.id || '').trim() === currentUserId) ? currentUserId : '');
  const status = taskBoardStatus({ status: value('status', '立项沟通') });
  // Standalone tasks are intentionally not assignable to a project. Project
  // cards already have their one canonical root task and are edited from the
  // project detail popup; keeping a project selector here recreates the old
  // nested-task path that the API deliberately removed.
  host.innerHTML = `<section class="project-dialog task-dialog" role="dialog" aria-modal="true"><header><div><small>${existing ? 'EDIT TASK' : 'NEW TASK'}</small><h2>${existing ? '编辑任务' : '新建任务'}</h2></div><button type="button" data-close aria-label="关闭">×</button></header><form><label>任务名称<input name="title" maxlength="160" value="${esc(value('title'))}" placeholder="例如：确认客户图纸版本" required></label><label>任务描述<textarea name="description" rows="4" maxlength="4000" placeholder="补充背景、交付标准或协作信息">${esc(value('description'))}</textarea></label><label>分组 / 标签<input name="stage" maxlength="80" value="${esc(value('stage', '未分组'))}" placeholder="例如：客户沟通、设计评审"></label><div class="dialog-grid"><label>负责人<select name="assigneeUserId"><option value="" ${defaultAssigneeId ? '' : 'selected'}>未分配</option>${members.map(member => `<option value="${esc(member.id)}" ${defaultAssigneeId && String(member?.id || '').trim() === defaultAssigneeId ? 'selected' : ''}>${esc(member.displayName || member.username)}</option>`).join('')}</select></label><label>优先级<select name="priority">${['普通','高','紧急'].map(item => `<option ${item === value('priority', '普通') ? 'selected' : ''}>${item}</option>`).join('')}</select></label></div><div class="dialog-grid"><label>开始日期<input name="startAt" type="date" value="${esc(value('startAt'))}"></label><label>截止日期<input name="dueAt" type="date" value="${esc(value('dueAt'))}"></label></div><label>状态<select name="status">${TASK_NODE_STATUS_OPTIONS.map(item => `<option value="${esc(item)}" ${item === status ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select></label><footer><button type="button" class="outline-button" data-close>取消</button><button type="submit" class="primary-button">${existing ? '保存任务' : '创建任务'}</button></footer></form></section>`;
  document.body.appendChild(host); const close = () => host.remove(); host.querySelectorAll('[data-close]').forEach(button => button.onclick = close); host.addEventListener('click', event => { if (event.target === host) close(); }); host.querySelector('form').onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); submit({ title: String(data.get('title') || '').trim(), description: String(data.get('description') || '').trim(), stage: String(data.get('stage') || '').trim() || '未分组', assigneeUserId: data.get('assigneeUserId') === '__automation__' ? undefined : String(data.get('assigneeUserId') || ''), priority: data.get('priority'), startAt: data.get('startAt'), dueAt: data.get('dueAt'), status: data.get('status') }); close(); }; host.querySelector('input').focus();
  if (!existing) { const select = host.querySelector('[name="assigneeUserId"]'); select.add(new Option('按自动化规则分配', '__automation__', true, true), 0); select.value = '__automation__'; }
}

async function writeClipboardText(value) {
  const text = String(value || '');
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
    input.remove();
    return Boolean(copied);
  } catch {
    return false;
  }
}

function openTaskDueDialog(store, task, onSaved) {
  if (!task?.id) return showToast('任务不存在或已无权访问');
  const project = (store.projects || []).find(item => String(item?.id || '') === String(task.projectId || ''))
    || (store.projects || []).find(item => String(item?.rootTaskId || '') === String(task.id || ''))
    || null;
  if (!deriveTaskCapabilities(store, { task }, { project }).canEdit) {
    return showToast('只有当前负责人可以修改时间');
  }
  document.querySelector('[data-task-due-dialog]')?.closest('.project-dialog-backdrop')?.remove();
  const host = document.createElement('div');
  host.className = 'project-dialog-backdrop';
  host.innerHTML = `<section class="project-dialog task-due-dialog" data-task-due-dialog role="dialog" aria-modal="true" aria-labelledby="taskDueDialogTitle"><header><h2 id="taskDueDialogTitle">设置时间</h2><button type="button" data-task-due-close aria-label="关闭">×</button></header><form><div class="dialog-grid"><label>开始日期<input type="date" name="startAt" value="${esc(task.startAt || '')}"></label><label>截止日期<input type="date" name="dueAt" value="${esc(task.dueAt || '')}"></label></div><footer><button type="button" class="outline-button" data-task-dates-clear>清除时间</button><button type="button" class="outline-button" data-task-due-close>取消</button><button type="submit" class="primary-button">保存</button></footer></form></section>`;
  document.body.appendChild(host);
  const close = () => host.remove();
  host.querySelectorAll('[data-task-due-close]').forEach(button => button.addEventListener('click', close));
  host.addEventListener('click', event => { if (event.target === host) close(); });
  host.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  host.querySelector('[data-task-dates-clear]').addEventListener('click', () => {
    host.querySelectorAll('input').forEach(input => { input.value = ''; input.setCustomValidity(''); });
  });
  host.querySelectorAll('input').forEach(input => input.addEventListener('input', () => host.querySelector('[name="dueAt"]').setCustomValidity('')));
  host.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startAt = String(form.get('startAt') || '');
    const dueAt = String(form.get('dueAt') || '');
    if (startAt && dueAt && startAt > dueAt) {
      const field = host.querySelector('[name="dueAt"]');
      field.setCustomValidity('截止日期不能早于开始日期'); field.reportValidity(); return;
    }
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    const result = await apiRequest(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'PUT', body: JSON.stringify({ startAt, dueAt }) }, store.apiToken);
    submit.disabled = false;
    if (!result.response?.ok || !result.body?.task) return showToast(result.body?.message || '时间保存失败');
    Object.assign(task, result.body.task);
    if (result.body.project) {
      const project = (store.projects || []).find(item => item.id === result.body.project.id);
      if (project) Object.assign(project, result.body.project);
    }
    close();
    onSaved?.(result.body);
    showToast(startAt || dueAt ? '时间已更新' : '时间已清除');
  });
  host.querySelector('input')?.focus();
}

function openTaskStatusDialog(store, task, onSaved) {
  if (!deriveTaskCapabilities(store, { task }).canChangeStatus) return showToast('只有当前负责人可以更改状态');
  const host = document.createElement('div');
  host.className = 'project-dialog-backdrop';
  host.innerHTML = `<section class="project-dialog task-status-dialog" data-task-status-dialog role="dialog" aria-modal="true" aria-labelledby="taskStatusDialogTitle"><header><h2 id="taskStatusDialogTitle">更改状态</h2><button type="button" data-close aria-label="关闭">×</button></header><form><label>状态<select name="status">${TASK_NODE_STATUS_OPTIONS.map(status => `<option value="${esc(status)}" ${status === taskBoardStatus(task) ? 'selected' : ''}>${esc(status)}</option>`).join('')}</select></label><footer><button type="button" class="outline-button" data-close>取消</button><button type="submit" class="primary-button">保存</button></footer></form></section>`;
  document.body.appendChild(host);
  const close = () => host.remove();
  host.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', close));
  host.addEventListener('click', event => { if (event.target === host) close(); });
  host.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  host.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = host.querySelector('[type="submit"]'); submit.disabled = true;
    const status = String(new FormData(event.currentTarget).get('status'));
    const result = await apiRequest(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'PUT', body: JSON.stringify({ status }) }, store.apiToken);
    submit.disabled = false;
    if (!result.response?.ok || !result.body?.task) return showToast(result.body?.message || '状态保存失败');
    close(); onSaved(result.body); showToast('状态已更新');
  });
  host.querySelector('select').focus();
}

function openTaskConvertDialog(store, task, { mode = 'convert', onComplete } = {}) {
  if (!task?.id) return showToast('任务不存在或已无权访问');
  const project = (store.projects || []).find(item => String(item?.id || '') === String(task.projectId || ''))
    || (store.projects || []).find(item => String(item?.rootTaskId || '') === String(task.id || ''))
    || null;
  if (!deriveTaskCapabilities(store, { task }, { project }).canEdit) {
    return showToast('只有当前负责人可以整理任务');
  }
  if (task.projectId) return showToast('项目根任务不能转化或跨项目移动，请在项目看板中调整节点');
  const projects = (store.projects || []).filter(project => project.rootTaskId);
  const standalone = (store.tasks || []).filter(item => item.id && item.id !== task.id);
  const candidates = [
    ...projects.map(project => ({ id: project.rootTaskId, label: `${project.title}（项目任务）` })),
    ...(mode === 'convert' ? standalone.map(item => ({ id: item.id, label: `${item.title}（独立任务）` })) : [])
  ];
  if (!candidates.length) return showToast('暂无可用的目标任务');
  document.querySelector('[data-task-convert-dialog]')?.remove();
  const host = document.createElement('div');
  host.className = 'project-dialog-backdrop';
  const title = mode === 'move' ? '跨项目移动' : '转化为子任务';
  const label = mode === 'move' ? '目标项目' : '父任务';
  host.innerHTML = `<section class="project-dialog task-convert-dialog" data-task-convert-dialog role="dialog" aria-modal="true" aria-labelledby="taskConvertDialogTitle"><header><div><small>TASK ORGANIZE</small><h2 id="taskConvertDialogTitle">${title}</h2></div><button type="button" data-task-convert-close aria-label="关闭">×</button></header><form><label>${label}<select name="parentTaskId" required>${candidates.map((item, index) => `<option value="${esc(item.id)}" ${index === 0 ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label><p class="muted-note">将保留任务标题、备注、优先级和截止日期；原独立任务完成转换后会移入回收站。</p><footer><button type="button" class="outline-button" data-task-convert-close>取消</button><button type="submit" class="primary-button">确认${title}</button></footer></form></section>`;
  document.body.appendChild(host);
  const close = () => host.remove();
  host.querySelectorAll('[data-task-convert-close]').forEach(button => button.addEventListener('click', close));
  host.addEventListener('click', event => { if (event.target === host) close(); });
  host.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]');
    const parentTaskId = String(new FormData(event.currentTarget).get('parentTaskId') || '');
    if (!parentTaskId) return;
    button.disabled = true;
    const source = task;
    const payload = {
      title: source.title || '未命名任务',
      description: source.description || '',
      priority: source.priority || '普通',
      dueAt: source.dueAt || '',
      status: source.status && ['待处理', '进行中', '已完成'].includes(source.status) ? source.status : '待处理'
    };
    const created = await apiRequest(`/api/tasks/${encodeURIComponent(parentTaskId)}/subtasks`, { method: 'POST', body: JSON.stringify(payload) }, store.apiToken);
    if (!created.response?.ok || !created.body?.subtask) {
      button.disabled = false;
      return showToast(created.body?.message || '任务转换失败');
    }
    const removed = await apiRequest(`/api/tasks/${encodeURIComponent(source.id)}`, { method: 'DELETE' }, store.apiToken);
    if (!removed.response?.ok) {
      button.disabled = false;
      return showToast(`子任务已创建，但原任务未移除：${removed.body?.message || '请手动处理'}`);
    }
    store.tasks = (store.tasks || []).filter(item => item.id !== source.id);
    close();
    onComplete?.(created.body.subtask);
    renderShellAfterTaskAction(store);
    showToast(mode === 'move' ? '任务已移动到目标项目' : '任务已转化为子任务');
  });
  host.querySelector('select')?.focus();
}

// The helper is replaced by initCloudApp's render closure when available.
function renderShellAfterTaskAction(store) {
  const content = document.querySelector('#cloudContent');
  if (content && typeof store?.renderShell === 'function') store.renderShell();
}

const TASK_IMPORT_FIELDS = [
  { key: 'title', label: '任务名称', aliases: ['title', 'name', 'task', 'taskname', '任务', '任务名称', '标题'], required: true },
  { key: 'description', label: '描述', aliases: ['description', 'desc', 'note', '备注', '描述', '说明'] },
  { key: 'stage', label: '分组 / 标签', aliases: ['stage', 'group', 'list', 'column', '分组', '标签', '阶段'] },
  { key: 'owner', label: '负责人', aliases: ['owner', 'assignee', 'executor', '负责人', '执行者', '责任人'] },
  { key: 'priority', label: '优先级', aliases: ['priority', 'level', '优先级'] },
  { key: 'status', label: '状态', aliases: ['status', 'state', '状态', '节点', '项目节点'] },
  { key: 'startAt', label: '开始日期', aliases: ['startat', 'start', 'startdate', '开始日期', '开始时间'] },
  { key: 'dueAt', label: '截止日期', aliases: ['dueat', 'due', 'duedate', 'deadline', '截止日期', '截止时间'] }
];

function normalizeImportHeader(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_\-./\\（）()]+/g, '');
}

function parseCsvText(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && (char === ',' || char === '\t')) { row.push(cell); cell = ''; continue; }
    if (!quoted && (char === '\n' || char === '\r')) { if (char === '\r' && next === '\n') index += 1; row.push(cell); cell = ''; if (row.some(value => String(value).trim())) rows.push(row); row = []; continue; }
    cell += char;
  }
  row.push(cell); if (row.some(value => String(value).trim())) rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows.shift().map((value, index) => String(value || `字段${index + 1}`).trim());
  return { headers, rows: rows.map(values => Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? '').trim()]))) };
}

async function parseTaskImportFile(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'json') {
    const value = JSON.parse(await file.text());
    const records = Array.isArray(value) ? value : Array.isArray(value?.tasks) ? value.tasks : Array.isArray(value?.data) ? value.data : Array.isArray(value?.items) ? value.items : Array.isArray(value?.results) ? value.results : [];
    if (!records.length || typeof records[0] !== 'object') throw new Error('JSON 中没有可导入的任务数组');
    const headers = [...new Set(records.flatMap(record => Object.keys(record)))];
    return { headers, rows: records.map(record => Object.fromEntries(headers.map(header => [header, record[header] ?? '']))) };
  }
  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') return parseCsvText(await file.text());
  if (extension === 'xlsx' || extension === 'xls') {
    const excelModule = await import('exceljs');
    const ExcelJS = excelModule.default || excelModule;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('Excel 中没有工作表');
    const headerValues = sheet.getRow(1).values.slice(1).map((value, index) => String(value ?? `字段${index + 1}`).trim());
    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = row.values.slice(1);
      if (!values.some(value => String(value ?? '').trim())) return;
      rows.push(Object.fromEntries(headerValues.map((header, index) => [header, values[index] ?? ''])));
    });
    return { headers: headerValues, rows };
  }
  throw new Error('仅支持 JSON、CSV、TSV 或 Excel 文件');
}

function autoTaskImportMapping(headers) {
  const normalized = headers.map(header => [header, normalizeImportHeader(header)]);
  return Object.fromEntries(TASK_IMPORT_FIELDS.map(field => {
    const match = normalized.find(([, value]) => field.aliases.some(alias => normalizeImportHeader(alias) === value));
    return [field.key, match?.[0] || ''];
  }));
}

function taskImportValue(row, mapping, key) {
  const source = mapping[key];
  return source ? row[source] : '';
}

function renderTaskImportPreview(host, state) {
  const preview = host.querySelector('[data-task-import-preview]');
  if (!preview) return;
  const titleField = state.mapping.title;
  if (!titleField) { preview.innerHTML = '<p class="muted-note">请先映射“任务名称”字段。</p>'; return; }
  const rows = state.rows.slice(0, 8);
  preview.innerHTML = rows.length ? `<table class="task-import-preview-table"><thead><tr><th>任务名称</th><th>分组</th><th>负责人</th><th>状态</th><th>截止日期</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(taskImportValue(row, state.mapping, 'title'))}</td><td>${esc(taskImportValue(row, state.mapping, 'stage') || '未分组')}</td><td>${esc(taskImportValue(row, state.mapping, 'owner') || '当前用户')}</td><td>${esc(taskImportValue(row, state.mapping, 'status') || '待处理')}</td><td>${esc(taskImportValue(row, state.mapping, 'dueAt') || '未设置')}</td></tr>`).join('')}</tbody></table><small class="task-import-count">预览 ${rows.length} 条，共 ${state.rows.length} 条</small>` : '<p class="muted-note">文件中没有数据行。</p>';
}

function openTaskImportDialog(store, options = {}) {
  document.querySelector('#taskImportDialog')?.remove();
  const host = document.createElement('div');
  host.id = 'taskImportDialog'; host.className = 'project-dialog-backdrop';
  const state = { headers: [], rows: [], mapping: {} };
  host.innerHTML = `<section class="project-dialog task-import-dialog" role="dialog" aria-modal="true" aria-labelledby="taskImportTitle"><header><div><small>IMPORT TASKS</small><h2 id="taskImportTitle">导入通用任务</h2></div><button type="button" data-close aria-label="关闭">×</button></header><div class="task-import-body"><label class="task-import-file"><span>选择 JSON、CSV 或 Excel 文件</span><input type="file" data-task-import-file accept=".json,.csv,.tsv,.xlsx,.xls"></label><p class="muted-note" data-task-import-status>支持一行一个任务；导入后仍可在任务详情中继续编辑。</p><div data-task-import-mapping class="task-import-mapping" hidden></div><div data-task-import-preview class="task-import-preview"></div></div><footer><button type="button" class="outline-button" data-close>取消</button><button type="button" class="primary-button" data-task-import-submit disabled>开始导入</button></footer></section>`;
  document.body.appendChild(host);
  const close = () => host.remove();
  host.querySelectorAll('[data-close]').forEach(button => button.onclick = close);
  host.addEventListener('click', event => { if (event.target === host) close(); });
  const fileInput = host.querySelector('[data-task-import-file]');
  const mappingHost = host.querySelector('[data-task-import-mapping]');
  const status = host.querySelector('[data-task-import-status]');
  const submitButton = host.querySelector('[data-task-import-submit]');
  const renderMapping = () => {
    mappingHost.hidden = !state.rows.length;
    if (!state.rows.length) return;
    mappingHost.innerHTML = `<div class="task-import-mapping-head"><b>字段匹配</b><span>已自动识别，可手动调整</span></div><div class="task-import-mapping-grid">${TASK_IMPORT_FIELDS.map(field => `<label>${field.label}${field.required ? '<i>*</i>' : ''}<select data-task-import-field="${field.key}"><option value="">不导入</option>${state.headers.map(header => `<option value="${esc(header)}" ${state.mapping[field.key] === header ? 'selected' : ''}>${esc(header)}</option>`).join('')}</select></label>`).join('')}</div>`;
    renderTaskImportPreview(host, state);
    submitButton.disabled = !state.mapping.title;
  };
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    submitButton.disabled = true; status.textContent = `正在读取 ${file.name}…`;
    try {
      const parsed = await parseTaskImportFile(file);
      state.headers = parsed.headers; state.rows = parsed.rows; state.mapping = autoTaskImportMapping(state.headers);
      if (!state.rows.length) throw new Error('文件中没有可导入的数据行');
      status.textContent = `已读取 ${state.rows.length} 条任务，请确认字段匹配。`;
      renderMapping();
    } catch (error) { state.headers = []; state.rows = []; state.mapping = {}; mappingHost.hidden = true; renderTaskImportPreview(host, state); status.textContent = error.message || '文件读取失败'; }
  };
  host.addEventListener('change', event => {
    const select = event.target.closest('[data-task-import-field]');
    if (!select) return;
    state.mapping[select.dataset.taskImportField] = select.value;
    submitButton.disabled = !state.mapping.title;
    renderTaskImportPreview(host, state);
  });
  submitButton.onclick = async () => {
    if (!state.mapping.title) return showToast('请映射任务名称字段');
    submitButton.disabled = true; status.textContent = '正在创建任务…';
    const members = store.members || [];
    const normalizeChoice = (value, values, fallback) => { const text = String(value || '').trim(); const hit = values.find(item => item === text || item.includes(text) || text.includes(item)); return hit || fallback; };
    const memberFor = value => { const text = String(value || '').trim().toLowerCase(); return members.find(member => [member.id, member.username, member.displayName].some(candidate => String(candidate || '').trim().toLowerCase() === text)) || members.find(member => member.id === store.user?.id) || members[0]; };
    let success = 0, failed = 0;
    for (const row of state.rows) {
      const title = String(taskImportValue(row, state.mapping, 'title') || '').trim();
      if (!title) { failed += 1; continue; }
      const member = memberFor(taskImportValue(row, state.mapping, 'owner'));
      const rawStatus = taskImportValue(row, state.mapping, 'status');
      const stage = String(taskImportValue(row, state.mapping, 'stage') || '未分组').trim() || '未分组';
      const payload = { title, description: String(taskImportValue(row, state.mapping, 'description') || '').trim(), stage, assigneeUserId: member?.id || '', priority: normalizeChoice(taskImportValue(row, state.mapping, 'priority'), ['普通', '高', '紧急'], '普通'), status: normalizeChoice(rawStatus, TASK_NODE_STATUS_OPTIONS, taskBoardStatus({ status: rawStatus, stage })), startAt: String(taskImportValue(row, state.mapping, 'startAt') || '').trim() || null, dueAt: String(taskImportValue(row, state.mapping, 'dueAt') || '').trim() || null };
      const result = await apiRequest('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }, store.apiToken);
      if (!result.response?.ok) { failed += 1; continue; }
      success += 1;
      store.tasks = [result.body.task, ...(store.tasks || [])];
    }
    if (success && typeof options.onImported === 'function') options.onImported();
    if (failed) { status.textContent = `已导入 ${success} 条，${failed} 条失败（缺少任务名称或数据无效）。`; submitButton.disabled = false; }
    else { close(); showToast(`已导入 ${success} 条任务`); }
  };
}

// Public status options are the project lifecycle nodes. Legacy values are
// accepted only by the normalizer/import compatibility path below.
const TASK_STATUS_OPTIONS = TASK_NODE_STATUS_OPTIONS;

const TASK_RELATED_KINDS = Object.freeze({
  part: { label: '零件', icon: '◇' },
  quote: { label: 'BOM / 报价', icon: '¥' },
  fair: { label: 'FAIR', icon: '✓' },
  document: { label: '文档', icon: '▤' },
  communication: { label: '项目沟通', icon: '◌' },
  file: { label: '关联文件', icon: '▱' }
});

const RELATED_STATUS_LABELS = {
  draft: '草稿', pending: '待复核', pass: '合格', fail: '不合格',
  sent: '已发送', accepted: '已接受', rejected: '已拒绝'
};
const FAIR_STATUS_LABELS = { pending: '待复核', pass: '合格', fail: '不合格' };

function relatedMeta(...values) {
  return values.map(value => String(value ?? '').trim()).filter(Boolean).join(' · ');
}

/**
 * Build the project-scoped resources shown in a task detail.  Keeping this
 * as data (kind/id/title/meta) lets the modal expose a stable click contract
 * without knowing how each host view opens its records.
 */
export function getTaskRelatedContent(store = {}, projectId = '', relatedSnapshot = null, taskAttachments = []) {
  const id = String(projectId || '').trim();
  if (!id) return [];
  // A snapshot is authoritative, including empty arrays returned when a
  // module is disabled or the current role cannot read it. Falling back to
  // the broad store is only allowed when no snapshot was supplied at all.
  const snapshot = relatedSnapshot || store.projectRelated?.[id] || null;
  const snapshotProjectId = String(snapshot?.projectId || snapshot?.project?.id || '').trim();
  if (snapshot && snapshotProjectId && snapshotProjectId !== id) return [];
  const source = key => snapshot
    ? (Array.isArray(snapshot[key]) ? snapshot[key] : [])
    : (store[key] || []);
  const belongsToProject = item => String(item?.projectId || '').trim() === id;
  const parts = source('parts').filter(belongsToProject);
  const quotes = source('quotes').filter(belongsToProject);
  const fairItems = source('fairItems').filter(belongsToProject);
  const documents = (snapshot && Array.isArray(snapshot.documents) ? snapshot.documents : (OFFICE_DOCUMENTS || []))
    .filter(item => belongsToProject(item) && item.scope !== '回收站');
  const conversations = source('conversations').filter(belongsToProject);
  const partById = new Map(parts.map(item => [item.id, item]));
  const kind = (name, item, title, meta, extra = {}) => ({
    kind: name,
    id: String(item.id || ''),
    title: String(title || '未命名内容'),
    meta: String(meta || ''),
    label: TASK_RELATED_KINDS[name].label,
    icon: TASK_RELATED_KINDS[name].icon,
    projectId: id,
    record: item,
    ...extra
  });
  const fileResources = [
    ...(Array.isArray(taskAttachments) ? taskAttachments : []).map(item => ({ item, source: 'task-attachment' }))
  ]
    .map(({ item, source }) => kind('file', item, item.name || item.title, relatedMeta(item.extension || item.mimeType, formatFileSize(item.sizeBytes)), { attachment: item, source }))
    .filter(item => item.id);
  return [
    ...parts.map(item => kind('part', item, item.name, relatedMeta(item.format, item.quantity ? `${item.quantity} 件` : ''))),
    ...quotes.map(item => kind('quote', item, item.quoteNo || '未命名报价', relatedMeta(RELATED_STATUS_LABELS[item.status] || item.status || '草稿', formatCents(item.totalCents, item.currency || 'CNY'), Array.isArray(item.lines) ? `${item.lines.length} 项` : ''))),
    ...fairItems.map(item => kind('fair', item, item.characteristic || '未命名检验项', relatedMeta(RELATED_STATUS_LABELS[item.status] || item.status || '待复核', item.nominal, item.tolerance, partById.get(item.partId)?.name), { partId: item.partId || '' })),
    ...documents.map(item => kind('document', item, item.title, relatedMeta(String(item.fileType || '').toUpperCase(), item.permission))),
    ...conversations.map(item => kind('communication', item, item.title || '项目沟通', relatedMeta(Number(item.messageCount || 0) ? `${item.messageCount} 条消息` : '暂无消息', item.preview))),
    ...fileResources
  ].filter(item => item.id);
}

export function getProjectBomRows(relatedSnapshot = {}, quoteId = '') {
  const parts = Array.isArray(relatedSnapshot.parts) ? relatedSnapshot.parts : [];
  const quotes = Array.isArray(relatedSnapshot.quotes) ? relatedSnapshot.quotes : [];
  const latestQuote = quoteId
    ? quotes.find(quote => String(quote.id) === String(quoteId)) || null
    : quotes.slice().sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0))[0] || null;
  const lines = Array.isArray(latestQuote?.lines) ? latestQuote.lines : [];
  const lineByPartId = new Map(lines.filter(line => line.partId).map(line => [String(line.partId), line]));
  const lineByName = new Map(lines.map(line => [String(line.name || '').trim().toLowerCase(), line]));
  const matchedLineIds = new Set();
  const rows = parts.map(part => {
    const line = lineByPartId.get(String(part.id)) || lineByName.get(String(part.name || '').trim().toLowerCase()) || null;
    if (line?.id) matchedLineIds.add(String(line.id));
    const quantity = Math.max(1, Number(line?.quantity ?? part.quantity) || 1);
    const unitPriceCents = Math.max(0, Number(line?.unitPriceCents) || 0);
    return {
      id: String(part.id || ''),
      kind: 'part',
      name: String(part.name || line?.name || '未命名零件'),
      previewUrl: String(part.previewUrl || part.thumbnailUrl || ''),
      format: String(part.format || ''),
      dimensions: String(part.size || part.dimensions || ''),
      material: String(part.material || line?.material || ''),
      process: String(line?.process || ''),
      quantity,
      unitPriceCents,
      subtotalCents: Math.max(0, Number(line?.subtotalCents) || quantity * unitPriceCents),
      quoteId: String(latestQuote?.id || ''),
      currency: String(latestQuote?.currency || 'CNY')
    };
  });
  for (const line of lines) {
    if (line?.id && matchedLineIds.has(String(line.id))) continue;
    if (line?.partId && parts.some(part => String(part.id) === String(line.partId))) continue;
    const quantity = Math.max(1, Number(line?.quantity) || 1);
    const unitPriceCents = Math.max(0, Number(line?.unitPriceCents) || 0);
    rows.push({
      id: String(latestQuote?.id || line?.id || ''),
      kind: 'quote',
      name: String(line?.name || '未命名零件'),
      previewUrl: '',
      format: '',
      dimensions: '',
      material: String(line?.material || ''),
      process: String(line?.process || ''),
      quantity,
      unitPriceCents,
      subtotalCents: Math.max(0, Number(line?.subtotalCents) || quantity * unitPriceCents),
      quoteId: String(latestQuote?.id || ''),
      currency: String(latestQuote?.currency || 'CNY')
    });
  }
  return rows;
}

function sanitizeRichHtml(value) {
  const raw = String(value ?? '');
  if (!raw) return '';
  // Plain-text descriptions from older tasks should remain readable when the
  // editor is upgraded to rich text.
  if (!/<[a-z][\s\S]*>/i.test(raw)) return esc(raw).replace(/\r?\n/g, '<br>');
  if (typeof DOMParser === 'undefined') return esc(raw);
  const documentNode = new DOMParser().parseFromString(raw, 'text/html');
  const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'A', 'IMG', 'SPAN']);
  const allowedAttributes = new Set(['href', 'target', 'rel', 'src', 'alt', 'title', 'data-pending-attachment', 'data-task-pending-attachment', 'data-task-attachment-id']);
  const walk = node => {
    [...node.children].forEach(child => {
      if (!allowedTags.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        return;
      }
      [...child.attributes].forEach(attribute => {
        const name = attribute.name.toLowerCase();
        const valueText = attribute.value || '';
        if (!allowedAttributes.has(name) || name.startsWith('on') || (name === 'href' && !/^(?:https?:|mailto:|#)/i.test(valueText)) || (name === 'src' && !/^(?:https?:|blob:|data:image\/(?:png|jpe?g|gif|webp);)/i.test(valueText))) child.removeAttribute(attribute.name);
      });
      if (child.tagName === 'A') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noreferrer noopener'); }
      if (child.tagName === 'SPAN' && child.hasAttribute('data-task-pending-attachment')) {
        child.className = 'task-rich-attachment-marker';
        child.setAttribute('contenteditable', 'false');
      }
      if (child.tagName === 'SPAN' && child.hasAttribute('data-task-attachment-id')) {
        child.className = 'task-rich-attachment-link';
        child.setAttribute('contenteditable', 'false');
      }
      walk(child);
    });
  };
  walk(documentNode.body);
  return documentNode.body.innerHTML.slice(0, 200000);
}

function richDescriptionMarkup(value) {
  return sanitizeRichHtml(value);
}

function summarizeRichText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRichDescription(value) {
  const html = sanitizeRichHtml(value);
  if (!html) return '';
  // contenteditable emits <br> for an untouched/cleared editor. Treat empty
  // block markup as an empty description so it does not create a fake change.
  const text = html
    .replace(/<br\s*\/?>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  if (!text && !/<img\b|data-task-(?:pending-attachment|attachment-id)\b/i.test(html)) return '';
  return html;
}

export function normalizeProjectTaskStatus(status) {
  const value = String(status || '').trim();
  if (TASK_STATUS_OPTIONS.includes(value)) return value;
  // Keep this exported helper backwards-compatible for consumers that still
  // render a legacy task snapshot; the task board itself maps these values to
  // lifecycle nodes through taskBoardStatus().
  if (LEGACY_TASK_STATUS_OPTIONS.includes(value)) return value;
  return '待处理';
}

export function openTaskDetail(store, detail, options = {}) {
  if (!detail?.task?.id) {
    showToast('任务详情加载失败');
    return null;
  }
  if (!options.keepParent) document.querySelectorAll('[data-task-detail-host]').forEach(node => node.remove());
  const host = document.createElement('div');
  host.id = options.keepParent ? `taskDetail-${Date.now()}` : 'taskDetail';
  host.dataset.taskDetailHost = 'true';
  host.className = 'task-detail-backdrop';
  const taskSessionToken = store.apiToken;
  const subtaskContext = options.subtaskContext || null;
  const taskIdForSubtasks = String(subtaskContext?.rootTaskId || detail.task.id);
  const taskSubtaskBasePath = `/api/tasks/${encodeURIComponent(taskIdForSubtasks)}/subtasks`;
  const taskResourcePath = subtaskContext?.subtaskId
    ? `${taskSubtaskBasePath}/${encodeURIComponent(subtaskContext.subtaskId)}`
    : `/api/tasks/${encodeURIComponent(detail.task.id)}`;
  const taskCommentPath = `${taskResourcePath}/comments`;
  const taskAttachmentPath = `${taskResourcePath}/attachments`;
  const taskAttachmentApiPath = taskAttachmentPath.replace(/^\/api/, '');
  const project = (store.projects || []).find(item => item.id === detail.task.projectId);
  const projectBreadcrumb = project && (detail.task.parentSubtaskId || String(project.title || '').trim() !== String(options.parentTitle || '').trim())
    ? `<button type="button" data-task-breadcrumb-project title="${esc(project.title)}">${esc(project.title)}</button><i data-lucide="chevron-right" aria-hidden="true"></i>` : '';
  const taskBreadcrumbMarkup = subtaskContext?.subtaskId
    ? `<nav class="task-detail-navigation" aria-label="任务层级"><button type="button" class="task-detail-parent-button" data-task-detail-parent aria-label="返回上级"><i data-lucide="arrow-left" aria-hidden="true"></i>返回上级</button><span class="task-detail-breadcrumb">${projectBreadcrumb}<button type="button" data-task-detail-parent title="${esc(options.parentTitle || '上级任务')}">${esc(options.parentTitle || '上级任务')}</button><i data-lucide="chevron-right" aria-hidden="true"></i><strong aria-current="page" title="${esc(detail.task.title || '')}">${esc(detail.task.title || '未命名任务')}</strong></span></nav>`
    : '';
  const onRelatedContent = typeof options.onRelatedContent === 'function' ? options.onRelatedContent : null;
  let attachments = Array.isArray(detail.attachments) ? detail.attachments.slice() : [];
  let projectMembers = Array.isArray(options.projectMembers) ? options.projectMembers.slice() : [];
  let members = (project?.id ? projectMembers : (store.members || [])).slice();
  if (!project?.id && !members.length && store.user?.id) members = [{ id: store.user.id, displayName: store.user.displayName || store.user.username, username: store.user.username }];
  const taskAssigneeMember = (store.members || []).find(member => member.id === detail.task.assigneeUserId);
  const initialAssignee = members.find(member => member.id === detail.task.assigneeUserId)
    || taskAssigneeMember
    || null;
  const getTaskCapabilities = () => deriveTaskCapabilities(store, detail, {
    project,
    projectMembers,
    subtaskContext,
    capabilities: options.capabilities,
    permissions: options.permissions
  });
  let taskCapabilities = getTaskCapabilities();
  const canSaveTaskField = (key, value) => {
    const capabilities = getTaskCapabilities();
    if (key === 'assigneeUserId') {
      const requested = String(value || '').trim();
      const currentAssignee = String(detail.task.assigneeUserId || '').trim();
      const selfClaim = capabilities.canClaim && !currentAssignee && requested === capabilities.currentUserId;
      return Boolean(selfClaim || capabilities.canTransferAssignee);
    }
    if (key === 'status') return capabilities.canChangeStatus;
    return capabilities.canEdit;
  };
  let resources = project?.id ? [] : getTaskRelatedContent(store, detail.task.projectId, options.related || null, attachments);
  let subtasks = Array.isArray(detail.subtasks)
    ? detail.subtasks.slice().sort((left, right) => Number(left.position || 0) - Number(right.position || 0) || String(left.createdAt || '').localeCompare(String(right.createdAt || '')))
    : [];
  let subtaskBusy = false;
  let pendingTaskAttachments = [];
  let taskAttachmentUploading = false;
  let taskAttachmentPreviewClose = null;
  let noteEditorOpen = false;
  // Keep the client-side gate aligned with the API and chat/document limits.
  const taskAttachmentMaxBytes = 50 * 1024 * 1024;
  const taskAttachmentFileKey = file => `${String(file?.name || '')}\u0000${Number(file?.size ?? file?.sizeBytes ?? 0)}`;
  const isTaskImageFile = file => /^image\//i.test(String(file?.type || '')) || /\.(?:jpe?g|png|gif|webp|bmp|avif)$/i.test(String(file?.name || ''));
  const taskAttachmentFileType = fileName => {
    const extension = String(fileName || '').split('.').pop()?.trim().slice(0, 6).toUpperCase();
    return extension && extension !== String(fileName || '').toUpperCase() ? extension : 'FILE';
  };
  const taskAttachmentPreviewKind = attachment => {
    const mimeType = String(attachment?.mimeType || attachment?.mime_type || attachment?.type || '').toLowerCase();
    const extension = String(attachment?.name || '').split('.').pop()?.toLowerCase() || '';
    const serialized = (() => { try { return JSON.stringify(attachment || {}).toLowerCase(); } catch { return ''; } })();
    if (mimeType.startsWith('image/') || /^(?:jpe?g|png|gif|webp)$/.test(extension)) return 'image';
    if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf';
    if (mimeType.startsWith('text/') || ['txt', 'md', 'json', 'xml', 'csv', 'log'].includes(extension)) return 'text';
    if (mimeType.startsWith('video/') || ['mp4', 'mov', 'webm'].includes(extension) || /(?:video\/|\.mp4(?:["'\\}]|$)|\.mov(?:["'\\}]|$)|\.webm(?:["'\\}]|$))/.test(serialized)) return 'video';
    if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'ogg'].includes(extension)) return 'audio';
    return '';
  };
  const createPendingTaskAttachment = file => ({
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    name: String(file?.name || '未命名文件'),
    sizeBytes: Number(file?.size || 0),
    previewUrl: isTaskImageFile(file) && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : ''
  });
  const releasePendingTaskAttachmentPreview = item => {
    if (item?.previewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(item.previewUrl);
  };
  const releasePendingTaskAttachmentPreviews = () => {
    pendingTaskAttachments.forEach(releasePendingTaskAttachmentPreview);
    pendingTaskAttachments = [];
  };
  const fieldLabels = { title: '标题', description: '备注', customerProfile: '客户画像', customerManagement: '客户管理', projectList: '项目清单', stage: '标签', owner: '负责人', assigneeUserId: '负责人', progress: '进度', status: '状态', priority: '优先级', startAt: '开始日期', dueAt: '截止日期', tag: '标签', step: '步骤' };
  const activityText = item => {
    const metadata = item.metadata || {};
    const changed = metadata.changed || {};
    const changeText = Object.entries(changed)
      .filter(([key]) => !['assigneeUserId', 'progress', 'step'].includes(key))
      .slice(0, 2)
      .map(([key, value]) => `将${fieldLabels[key] || key}改为“${value?.to ?? ''}”`)
      .join('，');
    const actionLabels = {
      'task.create': `创建了任务${metadata.title ? `“${metadata.title}”` : ''}`,
      'project.create': `创建了项目${metadata.title ? `“${metadata.title}”` : ''}`,
      'part.create': `创建了零件${metadata.name ? `“${metadata.name}”` : ''}`,
      'part.update': `更新了零件${metadata.name ? `“${metadata.name}”` : ''}${changeText ? `：${changeText}` : ''}`,
      'quote.create': `创建了报价${metadata.quoteNo ? `“${metadata.quoteNo}”` : ''}`,
      'quote.update': `更新了报价${metadata.quoteNo ? `“${metadata.quoteNo}”` : ''}`,
      'project_list.create': `创建了项目清单${metadata.title ? `“${metadata.title}”` : ''}`,
      'project_list.update': `更新了项目清单${metadata.title ? `“${metadata.title}”` : ''}`,
      'project_list.select': '切换了项目清单',
      'fair.create': `创建了 FAIR 检验项${metadata.characteristic ? `“${metadata.characteristic}”` : ''}`,
      'fair.update': `更新了 FAIR 检验项${metadata.characteristic ? `“${metadata.characteristic}”` : ''}${metadata.status ? `（${metadata.status}）` : ''}`,
      'document.create': `创建了文档${metadata.title ? `“${metadata.title}”` : ''}`,
      'document.upload': `上传了文档${metadata.title ? `“${metadata.title}”` : ''}`,
      'document.update': `重命名了文档${metadata.changed?.title?.to ? `为“${metadata.changed.title.to}”` : ''}`,
      'document.trash': `将文档移入了回收站${metadata.title ? `：“${metadata.title}”` : ''}`,
      'document.restore': `恢复了文档${metadata.title ? `“${metadata.title}”` : ''}`,
      'document.delete': `彻底删除了文档${metadata.title ? `“${metadata.title}”` : ''}`,
      'conversation.create': `创建了项目沟通${metadata.title ? `“${metadata.title}”` : ''}`,
      'message.create': `发送了项目沟通消息${metadata.body ? `：“${metadata.body}”` : ''}`,
      'project.member.add': `添加了项目成员${metadata.userName ? `“${metadata.userName}”` : ''}`,
      'project.member.remove': `移出了项目成员${metadata.userName ? `“${metadata.userName}”` : ''}`,
      'task.attachment.upload': `上传了任务附件${metadata.name ? `“${metadata.name}”` : ''}`,
      'task.attachment.delete': `删除了任务附件${metadata.name ? `“${metadata.name}”` : ''}`,
      'storage.file.upload': `上传了企业文件${metadata.name ? `“${metadata.name}”` : ''}`,
      'storage.file.delete': `删除了企业文件${metadata.name ? `“${metadata.name}”` : ''}`
    };
    if (actionLabels[item.action]) return actionLabels[item.action];
    // Comment audit rows are represented by the actual comment below. Keep
    // them out of the activity stream so one comment is not shown twice.
    if (item.action === 'task.comment.create' || item.action === 'project.comment.create') return '';
    if (item.action === 'task.update' && !changeText) return '';
    if (!changeText) return item.action?.endsWith('.update') ? '更新了信息' : '记录了操作';
    return changeText;
  };
  let saveChain = Promise.resolve();
  let taskDetailClosed = false;
  let disposeProjectLists = () => {};
  let disposeSharedCustomers = () => {};
  let disposeProjectLinks = () => {};
  let disposeParticipantMenu = () => {};
  const close = async () => {
    if (taskDetailClosed) return;
    taskDetailClosed = true;
    const sharedCustomerSave = disposeSharedCustomers();
    disposeProjectLists();
    disposeProjectLinks();
    disposeParticipantMenu();
    document.removeEventListener('keydown', escape);
    if (typeof taskAttachmentPreviewClose === 'function') taskAttachmentPreviewClose();
    releasePendingTaskAttachmentPreviews();
    host.remove();
    // A property change can still be on the wire when the user closes the
    // dialog. Repaint the project card only after that queued save settles.
    await saveChain;
    await sharedCustomerSave;
    if (typeof options.onClose === 'function') return options.onClose();
  };
  const escape = event => {
    if (event.key !== 'Escape') return;
    if (typeof taskAttachmentPreviewClose === 'function') { taskAttachmentPreviewClose(); return; }
    const picker = host.querySelector('[data-assignee-picker]');
    if (picker?.classList.contains('open')) { picker.classList.remove('open'); return; }
    // Dialogs opened from this task detail are mounted after it on <body>.
    // Close the topmost child dialog first so Escape never leaves a child
    // dialog behind after its parent has been dismissed.
    const nestedDialog = [...document.querySelectorAll('body > .project-dialog-backdrop')]
      .reverse()
      .find(item => host.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (nestedDialog) {
      const closeButton = nestedDialog.querySelector('[data-task-attachment-preview-close], [data-project-member-picker-close], [data-subtask-dialog-close], [data-close]');
      if (closeButton) closeButton.click();
      else nestedDialog.remove();
      return;
    }
    close();
  };
  const syncTask = updated => {
    Object.assign(detail.task, updated);
    const taskIndex = (store.tasks || []).findIndex(item => item.id === updated.id);
    const currentUserId = String(store.user?.id || '').trim();
    const belongsToCurrentUser = Boolean(currentUserId)
      && String(updated.assigneeUserId || '').trim() === currentUserId;
    if (taskIndex >= 0) {
      if (belongsToCurrentUser) Object.assign(store.tasks[taskIndex], updated);
      else store.tasks.splice(taskIndex, 1);
    } else if (belongsToCurrentUser) {
      // A project root starts unassigned and therefore was absent from the
      // hydrated list. Add it as soon as the current user claims it so the
      // task table updates immediately when the detail closes.
      store.tasks = [updated, ...(store.tasks || [])];
    }
  };
  const syncProjectBoardCard = updatedProject => {
    if (!updatedProject?.id) return;
    const card = [...document.querySelectorAll('[data-project-card][data-project-id]')]
      .find(item => String(item.dataset.projectId) === String(updatedProject.id));
    const stage = projectBoardStage(updatedProject);
    const column = [...document.querySelectorAll('[data-project-stage]')]
      .find(item => item.dataset.projectStage === stage);
    const dropzone = column?.querySelector('[data-project-dropzone]');
    if (card) {
      const replacement = document.createElement('template');
      replacement.innerHTML = renderProjectCard(updatedProject, store);
      const nextCard = replacement.content.firstElementChild;
      card.replaceWith(nextCard);
      if (dropzone && nextCard.parentElement !== dropzone) dropzone.appendChild(nextCard);
    }
    document.querySelectorAll('[data-project-stage]').forEach(item => {
      const zone = item.querySelector('[data-project-dropzone]');
      const count = item.querySelector('header span');
      if (zone && count) count.textContent = String(zone.querySelectorAll('[data-project-card]').length);
    });
  };
  const saveFields = payload => {
    const persist = async () => {
    if (store.apiToken !== taskSessionToken) return false;
    const unauthorizedField = Object.entries(payload || {}).find(([key, value]) => !canSaveTaskField(key, value));
    if (unauthorizedField) {
      const [key] = unauthorizedField;
      showToast(key === 'assigneeUserId'
        ? '只有当前负责人可以交接任务，未分配任务可由参与者认领'
        : '只有当前负责人可以编辑此任务');
      return false;
    }
    const changed = {};
    for (const [key, nextValue] of Object.entries(payload)) {
      if (key === 'assigneeUserId') {
        const nextAssignee = members.find(member => member.id === nextValue);
        const nextName = nextAssignee?.displayName || nextAssignee?.username || '未分配';
        if ((detail.task.assigneeUserId || '') !== nextValue) changed.assigneeUserId = { from: detail.task.assigneeUserId || '', to: nextValue };
        if (detail.task.owner !== nextName) changed.owner = { from: detail.task.owner || '', to: nextName };
        continue;
      }
      const previousValue = detail.task[key] ?? '';
      if (previousValue !== nextValue) changed[key] = { from: previousValue, to: nextValue ?? '' };
    }
    if (!Object.keys(changed).length) return true;
    const persistedPayload = subtaskContext?.subtaskId
      ? Object.fromEntries(Object.entries(payload)
        .map(([key, value]) => [key === 'stage' ? 'status' : key, value])
        .filter(([key]) => ['title', 'description', 'status', 'priority', 'assigneeUserId', 'startAt', 'dueAt'].includes(key)))
      : payload;
    const result = await apiRequest(taskResourcePath, { method: 'PUT', body: JSON.stringify(persistedPayload) }, store.apiToken);
    if (store.apiToken !== taskSessionToken) return false;
    if (!result.response?.ok) {
      if ([403, 409].includes(result.response?.status)) await refreshTaskExecution();
      showToast(result.body?.message || '任务保存失败');
      return false;
    }
    if (subtaskContext?.subtaskId) {
      if (!result.response?.ok || !result.body?.subtask) { showToast(result.body?.message || '子任务保存失败'); return false; }
      const updatedSubtask = result.body.subtask;
      Object.assign(detail.task, {
        title: updatedSubtask.title,
        description: updatedSubtask.description || '',
        stage: updatedSubtask.status || '待处理',
        owner: updatedSubtask.assigneeDisplayName || updatedSubtask.assigneeUsername || '',
        assigneeUserId: updatedSubtask.assigneeUserId || '',
        status: updatedSubtask.status || '待处理',
        priority: updatedSubtask.priority || '普通',
        startAt: updatedSubtask.startAt || '',
        dueAt: updatedSubtask.dueAt || ''
      });
      refreshNoteSummary();
      await refreshTaskExecution();
      return true;
    }
    if (!result.response?.ok) { showToast(result.body.message || '任务保存失败'); return false; }
    syncTask(result.body.task);
    refreshNoteSummary();
    if (result.body.project) {
      const updatedProject = result.body.project;
      const storeProject = store.projects.find(item => item.id === updatedProject.id);
      if (storeProject) Object.assign(storeProject, updatedProject);
      if (project && project !== storeProject) Object.assign(project, updatedProject);
      syncProjectBoardCard(updatedProject);
    }
    if (Object.keys(changed).length) {
      detail.activities = [{ id: `local-${Date.now()}`, action: 'task.update', username: store.user?.username || store.user?.displayName || '我', metadata: { changed }, createdAt: new Date().toISOString() }, ...(detail.activities || [])];
      const activeFeed = host.querySelector('[data-task-feed].active')?.dataset.taskFeed || 'all';
      host.querySelector('[data-task-feed-list]').innerHTML = feedMarkup(activeFeed);
    }
    await refreshTaskExecution();
    showToast('任务已保存'); return true;
    };
    const queuedSave = saveChain.then(persist, persist);
    saveChain = queuedSave.catch(() => undefined);
    return queuedSave;
  };
  const feedMarkup = filter => {
    if (filter === 'history') return renderTaskHistoryTimeline(detail.history || []);
    const comments = [
      ...(detail.comments || []),
      ...(detail.projectComments || [])
    ].map(item => ({ type: 'comment', body: item.body, username: item.displayName || item.username, createdAt: item.createdAt }));
    const activities = (detail.activities || []).map(item => {
      const attachmentActivity = String(item.action || '').startsWith('task.attachment.');
      return { type: attachmentActivity ? 'attachment' : 'activity', body: activityText(item), username: item.displayName || item.username || '系统', createdAt: item.createdAt, attachmentId: item.entityId || item.metadata?.attachmentId || '', attachmentName: item.metadata?.name || '' };
    }).filter(item => item.body);
    const selectedRows = filter === 'comments'
      ? comments
      : filter === 'attachments'
        ? activities.filter(item => item.type === 'attachment')
        : [...comments, ...activities];
    const rows = selectedRows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return rows.length ? rows.map(item => `<article class="task-feed-row type-${item.type}"><span class="member-avatar small">${esc(String(item.username || '系').slice(0, 1))}</span><div><p>${item.type === 'comment' ? `<b>${esc(item.username || '系统')}</b>${esc(item.body)}` : item.type === 'attachment' ? `<span><b>${esc(item.username || '系统')}</b> ${esc(item.body)}</span>${item.attachmentId ? `<button type="button" class="task-feed-attachment-link" data-task-feed-attachment="${esc(item.attachmentId)}">${esc(item.attachmentName || '打开附件')}</button>` : ''}` : `<span><b>${esc(item.username || '系统')}</b> ${esc(item.body)}</span>`}</p><time>${new Date(item.createdAt).toLocaleString('zh-CN')}</time></div></article>`).join('') : '<div class="task-feed-empty">还没有动态</div>';
  };
  const attachmentItemMarkup = attachment => `<article class="task-attachment-item" data-task-attachment-id="${esc(attachment.id)}"><span class="task-attachment-icon" aria-hidden="true">${esc(taskAttachmentFileType(attachment.name))}</span><div class="task-attachment-copy"><b title="${esc(attachment.name)}">${esc(attachment.name)}</b><small>${esc(formatFileSize(attachment.sizeBytes))} · ${esc(attachment.uploaderDisplayName || attachment.uploaderUsername || '上传者')}</small></div>${taskAttachmentPreviewKind(attachment) ? `<button type="button" class="task-attachment-icon-button" data-task-attachment-preview="${esc(attachment.id)}" title="预览 ${esc(attachment.name)}" aria-label="预览 ${esc(attachment.name)}">⌕</button>` : ''}<button type="button" class="task-attachment-icon-button" data-task-attachment-download="${esc(attachment.id)}" title="下载 ${esc(attachment.name)}" aria-label="下载 ${esc(attachment.name)}">↓</button><button type="button" class="task-attachment-icon-button danger" data-task-attachment-delete="${esc(attachment.id)}" title="删除 ${esc(attachment.name)}" aria-label="删除 ${esc(attachment.name)}">×</button></article>`;
  const pendingAttachmentItemMarkup = pending => {
    const preview = pending.previewUrl
      ? `<img src="${esc(pending.previewUrl)}" alt="${esc(pending.name)}" loading="lazy">`
      : `<span class="task-attachment-pending-icon" aria-hidden="true">${esc(taskAttachmentFileType(pending.name))}</span>`;
    return `<article class="task-attachment-pending-item" data-task-pending-attachment-id="${esc(pending.id)}"><div class="task-attachment-pending-preview">${preview}</div><div class="task-attachment-copy"><b title="${esc(pending.name)}">${esc(pending.name)}</b><small>${esc(formatFileSize(pending.sizeBytes))} · 待上传</small></div><button type="button" class="task-attachment-icon-button danger" data-task-attachment-pending-delete="${esc(pending.id)}" title="移除 ${esc(pending.name)}" aria-label="移除 ${esc(pending.name)}" ${taskAttachmentUploading ? 'disabled' : ''}>×</button></article>`;
  };
  const attachmentListMarkup = () => {
    const pendingMarkup = pendingTaskAttachments.length
      ? `<div class="task-attachment-pending-block"><div class="task-attachment-pending-list">${pendingTaskAttachments.map(pendingAttachmentItemMarkup).join('')}</div><button type="button" class="task-attachment-clear" data-task-attachment-clear ${taskAttachmentUploading ? 'disabled' : ''}>清空</button></div>`
      : '';
    // Existing task attachments belong to the activity/feed, not this
    // composer. Only files queued for the next send are previewed here.
    return pendingMarkup;
  };
  // Attachments belong to the comment composer.  Keeping the drop target and
  // pending/uploaded list here makes the collaboration rail read like a chat
  // thread instead of a second document-management panel.
  let syncCommentSendState = () => {};
  const taskAttachmentSectionMarkup = () => `<div class="task-comment-attachment-zone" data-task-attachments-section data-task-attachment-dropzone${canManageAttachments ? '' : ' hidden aria-hidden="true"'}><input type="file" data-task-attachment-input accept="${TASK_ATTACHMENT_ACCEPT}" multiple hidden ${canManageAttachments ? '' : 'disabled'}><p class="task-attachment-drop-hint" data-task-attachment-drop-hint>可粘贴图片、拖动文件到输入框，或点击附件按钮</p><p class="task-attachment-status" data-task-attachment-status aria-live="polite" hidden></p><div class="task-attachment-list" data-task-attachments-list>${attachmentListMarkup()}</div></div>`;
  const renderTaskAttachments = () => {
    const section = host.querySelector('[data-task-attachments-section]');
    if (!section) return;
    const canManage = getTaskCapabilities().canManageAttachments;
    const count = section.querySelector('[data-task-attachment-count]');
    if (count) count.textContent = String(attachments.length + pendingTaskAttachments.length);
    const list = section.querySelector('[data-task-attachments-list]');
    if (list) list.innerHTML = attachmentListMarkup();
    const status = section.querySelector('[data-task-attachment-status]');
    if (status) {
      status.textContent = taskAttachmentUploading ? '正在上传文件，请稍候…' : pendingTaskAttachments.length ? `${pendingTaskAttachments.length} 个文件待上传，确认无误后点击上传。` : '';
      status.hidden = !taskAttachmentUploading && !pendingTaskAttachments.length;
    }
    section.hidden = !canManage || (!taskAttachmentUploading && !pendingTaskAttachments.length);
    section.setAttribute('aria-hidden', String(!canManage));
    section.classList.toggle('has-files', Boolean(taskAttachmentUploading || pendingTaskAttachments.length));
    syncCommentSendState();
  };
  const subtaskAssigneeLabel = subtask => {
    if (subtask?.assigneeDisplayName || subtask?.assigneeUsername) return subtask.assigneeDisplayName || subtask.assigneeUsername;
    const member = members.find(item => item.id === subtask?.assigneeUserId);
    return member?.displayName || member?.username || '未分配';
  };
  const subtaskPriorityClass = priority => taskPriorityClass(priority || '普通');
  const subtaskCanEdit = subtask => {
    if (!subtask?.id) return false;
    // Editing follows the subtask executor; deletion is independently delegated.
    const subtaskDetail = {
      task: {
        ...subtask,
        id: subtask.id,
        projectId: detail.task.projectId || null,
        assigneeUserId: subtask.assigneeUserId || '',
        status: subtask.status || (subtask.completed ? '已完成' : '待处理')
      },
      capabilities: subtask.capabilities
    };
    return Boolean(deriveTaskCapabilities(store, subtaskDetail, {
      project,
      projectMembers,
      subtaskContext: { rootTaskId: taskIdForSubtasks, subtaskId: subtask.id },
      capabilities: subtask.capabilities
    }).canEdit);
  };
  const subtaskCanDelete = subtask => Boolean(subtask?.id && (typeof subtask.capabilities?.canDelete === 'boolean'
    ? subtask.capabilities.canDelete : memberCan(store, 'task.delete')));
  const subtaskSummary = () => {
    const total = subtasks.length;
    const completed = subtasks.filter(item => item.completed || item.status === '已完成').length;
    return { total, completed, remaining: Math.max(0, total - completed) };
  };
  const subtaskListMarkup = () => {
    const summary = subtaskSummary();
    const canWriteSubtasks = Boolean(getTaskCapabilities().canManageSubtasks);
    const rows = subtasks.length
      ? subtasks.map(subtask => {
        const completed = Boolean(subtask.completed || subtask.status === '已完成');
        const assignee = subtaskAssigneeLabel(subtask);
        const meta = [assignee !== '未分配' ? assignee : '', subtask.dueAt ? `截止 ${subtask.dueAt}` : '', subtask.priority && subtask.priority !== '普通' ? subtask.priority : ''].filter(Boolean).join(' · ');
        const canEdit = subtaskCanEdit(subtask);
        const canDelete = subtaskCanDelete(subtask);
        return `<article class="task-subtask-row ${completed ? 'is-complete' : ''}" data-subtask-id="${esc(subtask.id)}"><input class="task-subtask-complete" data-subtask-complete type="checkbox" ${completed ? 'checked' : ''} ${canEdit ? '' : 'disabled'} aria-label="${completed ? '标记子任务为未完成' : '标记子任务为完成'}" title="${canEdit ? (completed ? '标记为未完成' : '标记为完成') : '只有当前子任务负责人可以修改完成状态'}"><button type="button" class="task-subtask-main" data-subtask-open title="打开子任务详情"><b>${esc(subtask.title || '未命名子任务')}</b>${meta ? `<small>${esc(meta)}</small>` : '<small>未分配负责人</small>'}</button><button type="button" class="task-subtask-delete" data-subtask-delete title="删除子任务" aria-label="删除子任务" ${canDelete ? '' : 'hidden disabled'}>×</button></article>`;
      }).join('')
      : '<div class="task-subtask-empty"><div><b>暂无子任务</b><p>把任务拆成可执行的小步骤，方便协作和跟踪。</p></div></div>';
    return `<section class="task-detail-section task-subtasks-section" data-task-subtasks-section><header class="task-subtasks-header"><h3>子任务 <small data-subtask-count>${summary.completed}/${summary.total}</small></h3><button type="button" class="task-subtask-add" data-subtask-add ${canWriteSubtasks ? '' : 'hidden disabled'}>＋ 添加子任务</button></header><div class="task-subtask-list" data-subtask-list>${rows}</div></section>`;
  };
  const renderSubtasks = () => {
    const section = host.querySelector('[data-task-subtasks-section]');
    if (!section) return;
    const summary = subtaskSummary();
    const count = section.querySelector('[data-subtask-count]');
    if (count) count.textContent = `${summary.completed}/${summary.total}`;
    const list = section.querySelector('[data-subtask-list]');
    if (list) {
      const next = document.createElement('template');
      next.innerHTML = subtaskListMarkup();
      const nextSection = next.content.firstElementChild;
      list.replaceWith(nextSection.querySelector('[data-subtask-list]'));
      section.querySelector('.task-subtasks-header')?.replaceWith(nextSection.querySelector('.task-subtasks-header'));
      applyTaskCapabilityState?.();
    }
  };
  const relatedContentMarkup = () => resources.length
    ? `<div class="task-related-list">${resources.map(item => `<button type="button" class="task-related-item" data-task-related data-related-kind="${esc(item.kind)}" data-related-id="${esc(item.id)}" title="打开${esc(item.label)}：${esc(item.title)}"><span class="task-related-icon" aria-hidden="true">${esc(item.icon)}</span><span class="task-related-copy"><b>${esc(item.title)}</b>${item.meta ? `<small>${esc(item.label)} · ${esc(item.meta)}</small>` : `<small>${esc(item.label)}</small>`}</span><span class="task-related-open" aria-hidden="true">›</span></button>`).join('')}</div>`
    : '<div class="task-related-empty"><span class="task-related-empty-icon" aria-hidden="true">＋</span><div><b>暂无关联内容</b><p>项目中的零件、报价、FAIR、文档、文件和沟通会显示在这里。</p></div></div>';
  const renderRelatedContent = () => {
    if (project?.id) return;
    resources = getTaskRelatedContent(store, detail.task.projectId, options.related || null, attachments);
    const section = host.querySelector('[data-task-related-section]');
    if (!section) return;
    const count = section.querySelector('[data-task-related-count]');
    const body = section.querySelector('[data-task-related-list]');
    if (count) count.textContent = String(resources.length);
    if (body) body.innerHTML = relatedContentMarkup();
    bindRelatedContent();
  };
  // Legacy project records kept the board node in project.stage while the
  // root task still used a generic four-state value. Display the visible card
  // node until the next workflow selection writes the new shared status.
  const taskStatus = subtaskContext?.subtaskId ? taskBoardStatus(detail.task) : (project?.id ? projectBoardStage(project) : taskBoardStatus(detail.task));
  const currentAssigneeMember = () => members.find(member => member.id === detail.task.assigneeUserId)
    || (store.members || []).find(member => member.id === detail.task.assigneeUserId)
    || null;
  const projectRoleLabel = () => '参与者';
  const uniqueParticipants = list => list.filter((member, index, items) => member?.id && items.findIndex(item => item.id === member.id) === index);
  const participantMembersForDetail = assigneeOverride => {
    const assignee = assigneeOverride === undefined ? currentAssigneeMember() : assigneeOverride;
    // Subtasks are nested work items: their right-side participant panel must
    // describe the subtask itself, not copy every participant from the parent
    // project/root task. Keep the full project member list only for the
    // assignee picker so the subtask can still be assigned to an eligible
    // project member.
    if (subtaskContext?.subtaskId) return assignee ? [assignee] : [];
    return projectMembers.length ? projectMembers : (assignee ? [assignee] : []);
  };
  // Project participants use one consistent display label. The underlying
  // project role remains available for permission checks and management.
  const participantRoleText = member => subtaskContext?.subtaskId ? '负责人' : '参与者';
  const participantMarkupFor = list => list.length
    ? list.map(member => {
      const name = member.displayName || member.username || '成员';
      const role = participantRoleText(member);
      return `<div class="task-participant-item"><button type="button" class="task-participant" data-project-member-id="${esc(member.id)}" title="${esc(name)} · ${esc(role)}" aria-expanded="false" aria-label="${esc(name)}的参与者设置"><span class="member-avatar" aria-hidden="true">${esc(String(name).slice(0, 1))}</span><span><b>${esc(name)}</b><small>${esc(role)}</small></span></button></div>`;
    }).join('')
    : '<div class="task-participants-empty">暂无参与者</div>';
  const participantMembers = uniqueParticipants(participantMembersForDetail());
  // The project popup no longer renders the legacy note controls
  // (data-task-note-panel / data-task-rich-editor), but description data and
  // persistence remain available for older records and standalone tasks.
  // Priority and tag controls (data-task-field="priority" / "stage") are also
  // intentionally hidden from this project popup; their stored values remain
  // supported by the task API.
  taskCapabilities = getTaskCapabilities();
  const canClaimTask = Boolean(taskCapabilities.canClaim);
  const canChangeStatus = Boolean(taskCapabilities.canChangeStatus);
  const canManageAttachments = Boolean(taskCapabilities.canManageAttachments);
  const canTransferAssignee = Boolean(taskCapabilities.canTransferAssignee);
  const canEditTask = Boolean(taskCapabilities.canEdit);
  const canManageProjectMembers = Boolean(!subtaskContext?.subtaskId && project?.id && taskCapabilities.canManageProjectMembers);
  const participantPanelTitle = subtaskContext?.subtaskId ? '负责人' : '参与者';
  const participantMarkup = participantMarkupFor(participantMembers);
  const statusControlAttrs = canChangeStatus ? '' : 'disabled aria-disabled="true" title="只有当前负责人可以变更任务状态"';
  const assigneeControlAttrs = canTransferAssignee ? '' : 'title="只有当前负责人可以交接任务"';
  const titleControlAttrs = canEditTask ? '' : 'readonly aria-readonly="true" title="只有当前负责人可以编辑任务"';
  const dueControlAttrs = canEditTask ? '' : 'disabled aria-disabled="true" title="只有当前负责人可以修改截止时间"';
  const richToolbar = `<div class="task-rich-toolbar" role="toolbar" aria-label="备注格式"><button type="button" data-rich-command="bold" title="加粗"><b>B</b></button><button type="button" data-rich-command="italic" title="斜体"><i>I</i></button><button type="button" data-rich-command="underline" title="下划线"><u>U</u></button><button type="button" data-rich-command="insertUnorderedList" title="项目符号">•</button><button type="button" data-rich-command="createLink" title="插入链接">链</button></div>`;
  const noteSummaryText = summarizeRichText(detail.task.description) || '待添加';
  const customerProfileMarkup = subtaskContext?.subtaskId || !taskCapabilities.canViewCustomers
    ? ''
    : `<div><label>客户画像</label><input data-task-field="customerProfile" maxlength="200" value="${esc(detail.task.customerProfile || '')}" placeholder="待添加"></div>`;
  const customerManagementMarkup = subtaskContext?.subtaskId || !taskCapabilities.canViewCustomers
    ? ''
    : `<div><label>客户管理</label><input data-task-field="customerManagement" maxlength="200" value="${esc(detail.task.customerManagement || '')}" placeholder="待添加"></div>`;
  const projectListMarkup = project?.id && enterpriseCan(store, 'project.list.read')
    ? renderProjectListsSection(store, project) : '';
  const linkedProjectBack = options.returnProjectTitle
    ? `<button type="button" class="task-detail-parent-button" data-task-project-back title="返回${esc(options.returnProjectTitle)}">‹ 返回上级</button>` : '';
  host.innerHTML = `<section class="project-task-modal" role="dialog" aria-modal="true" aria-labelledby="taskDetailTitle">
    <header class="task-detail-topbar"><div class="task-detail-topbar-left"><span class="task-type-badge"><b>任务</b></span><input id="taskDetailTitle" class="task-detail-title" name="title" maxlength="160" value="${esc(detail.task.title)}" aria-label="任务名称" ${titleControlAttrs}>${linkedProjectBack}</div><nav><button type="button" data-copy-task-link title="复制任务链接" aria-label="复制任务链接">↗</button><button type="button" data-close-task-detail title="关闭" aria-label="关闭">×</button></nav></header>
    <div class="task-detail-layout"><main class="task-detail-main"><div class="task-detail-main-inner">
      ${taskBreadcrumbMarkup}
      <section class="task-property-list">
        <div><label>状态</label><select data-task-field="status" data-task-status ${statusControlAttrs}>${TASK_NODE_STATUS_OPTIONS.map(value => `<option value="${esc(value)}" ${taskStatus === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></div>
        <div><label>负责人</label><div class="task-assignee-control"><div class="assignee-picker" data-assignee-picker><button type="button" class="assignee-picker-trigger" data-assignee-trigger aria-haspopup="listbox" aria-expanded="false" ${assigneeControlAttrs}><span class="member-avatar small" data-assignee-avatar>${esc(String(initialAssignee?.displayName || initialAssignee?.username || '未').slice(0, 1))}</span><b data-assignee-name>${esc(initialAssignee?.displayName || initialAssignee?.username || '未分配')}</b><i>⌄</i></button><div class="assignee-picker-popover"><div class="assignee-picker-search"><span>⌕</span><input type="search" data-assignee-search placeholder="搜索成员" autocomplete="off" ${canTransferAssignee ? '' : 'disabled'}></div><div class="assignee-picker-list" role="listbox"><button type="button" role="option" data-assignee-id="" data-assignee-label="未分配" aria-selected="${initialAssignee ? 'false' : 'true'}" ${canTransferAssignee ? '' : 'disabled'}><span class="member-avatar">—</span><span><b>未分配</b><small>负责人为空</small></span><i>✓</i></button>${members.map(member => { const name = member.displayName || member.username; return `<button type="button" role="option" data-assignee-id="${esc(member.id)}" data-assignee-label="${esc(name)}" aria-selected="${member.id === initialAssignee?.id}" ${canTransferAssignee ? '' : 'disabled'}><span class="member-avatar">${esc(String(name).slice(0, 1))}</span><span><b>${esc(name)}</b><small>@${esc(member.username || '')}</small></span><i>✓</i></button>`; }).join('')}</div><p class="assignee-picker-empty">没有匹配的成员</p></div></div><button type="button" class="task-claim-button" data-task-claim ${canClaimTask ? '' : 'hidden'}>认领任务</button></div></div>
        <div><label>截止时间</label><div class="task-due-control" data-task-due-trigger><input data-task-field="dueAt" type="date" value="${esc(detail.task.dueAt || '')}" aria-label="截止时间" ${dueControlAttrs}></div></div>
        ${customerProfileMarkup}
        ${customerManagementMarkup}
        ${subtaskContext?.subtaskId ? renderSharedTaskCustomers(store) : ''}
        ${projectListMarkup}
      </section>
       ${subtaskListMarkup()}
       ${project?.id ? renderProjectLinksSection(store, project) : `<section class="task-detail-section task-related-section" data-task-related-section><h3>关联内容 <small data-task-related-count>${resources.length}</small></h3><div data-task-related-list>${relatedContentMarkup()}</div></section>`}
     </div></main><aside class="task-detail-aside">
       <section class="task-participants" data-task-participants><header class="task-participants-head"><h3>${participantPanelTitle} <small data-project-member-count>${participantMembers.length}</small></h3><div class="task-participants-actions">${canManageOrganization(store) ? '<button type="button" class="task-member-add" data-organization-open>组织架构</button>' : ''}${canManageProjectMembers ? '<button type="button" class="task-member-add" data-project-member-add>＋ 添加参与者</button>' : ''}</div></header><div class="task-participant-list" data-project-member-list>${participantMarkup}</div><div class="participant-inline-menu" data-participant-menu hidden></div></section>
       <section class="task-feed"><nav><button class="active" data-task-feed="all">所有动态</button><button data-task-feed="comments">仅评论</button><button data-task-feed="attachments">仅附件</button><button data-task-feed="history">执行履历</button></nav><div data-task-feed-list>${feedMarkup('all')}</div></section>
        <form class="task-comment-compose" data-task-comment>${taskAttachmentSectionMarkup()}<textarea name="body" rows="3" maxlength="4000" placeholder="请输入评论，Enter 发送 / Ctrl + Enter 换行" ${taskCapabilities.canComment ? '' : 'disabled aria-disabled="true"'}></textarea><footer><button type="button" class="task-comment-attachment" data-task-comment-attachment title="添加附件" aria-label="添加附件" ${canManageAttachments ? '' : 'hidden disabled'}>📎 附件</button><span>支持粘贴或拖动文件</span><button type="submit" class="task-comment-send-button" ${taskCapabilities.canComment ? '' : 'disabled aria-disabled="true"'}>发送</button></footer></form>
     </aside></div>
  </section>`;
  document.body.appendChild(host);
  const dropdownIcon = createElement(ChevronDown, { stroke: '#536173', 'stroke-width': 2 }).outerHTML;
  const taskNavigation = host.querySelector('.task-detail-navigation');
  if (taskNavigation) createIcons({ icons: { ArrowLeft, ChevronRight }, root: taskNavigation });
  host.style.setProperty('--task-dropdown-icon', `url("data:image/svg+xml,${encodeURIComponent(dropdownIcon)}")`);
  disposeProjectLists = mountProjectListsSection(host, store, project, { apiRequest, showToast });
  if (subtaskContext?.subtaskId) disposeSharedCustomers = mountSharedTaskCustomers(host, store, taskIdForSubtasks, { apiRequest, showToast });
  const closeForProjectNavigation = async () => {
    if (taskDetailClosed || !host.isConnected || store.apiToken !== taskSessionToken) return false;
    await close();
    return true;
  };
  disposeProjectLinks = mountProjectLinksSection(host, store, project, {
    apiRequest, showToast,
    onOpenProject: projectId => options.onOpenProject?.(projectId, closeForProjectNavigation)
  });
  host.querySelector('[data-task-project-back]')?.addEventListener('click', () => { void options.onReturnProject?.(closeForProjectNavigation); });
  host.querySelector('[data-task-due-trigger]')?.addEventListener('click', event => {
    const input = event.currentTarget.querySelector('input[type="date"]');
    if (!input || input.disabled) return;
    try { input.showPicker?.(); } catch { input.focus(); }
  });
  const applyTaskCapabilityState = () => {
    taskCapabilities = getTaskCapabilities();
    const statusControl = host.querySelector('[data-task-status]');
    if (statusControl) {
      statusControl.disabled = !taskCapabilities.canChangeStatus;
      statusControl.setAttribute('aria-disabled', String(!taskCapabilities.canChangeStatus));
      if (taskCapabilities.canChangeStatus) statusControl.removeAttribute('title');
      else statusControl.title = '只有当前负责人可以变更任务状态';
    }
    const titleControl = host.querySelector('.task-detail-title');
    if (titleControl) {
      titleControl.readOnly = !taskCapabilities.canEdit;
      titleControl.setAttribute('aria-readonly', String(!taskCapabilities.canEdit));
    }
    host.querySelectorAll('[data-task-field]:not([data-task-status])').forEach(control => {
      if (control.matches('[contenteditable="true"], [data-task-rich-editor]')) control.contentEditable = String(taskCapabilities.canEdit);
      else if (control.type === 'text' || control.tagName === 'TEXTAREA') control.readOnly = !taskCapabilities.canEdit;
      else control.disabled = !taskCapabilities.canEdit;
      control.setAttribute('aria-disabled', String(!taskCapabilities.canEdit));
      if (['customerProfile', 'customerManagement'].includes(control.dataset.taskField)) {
        control.closest('.task-property-list > div')?.toggleAttribute('hidden', !taskCapabilities.canViewCustomers);
        if (!taskCapabilities.canViewCustomers) { control.value = ''; control.disabled = true; }
      }
    });
    host.querySelector('[data-project-member-add]')?.toggleAttribute('hidden', !taskCapabilities.canManageProjectMembers);
    const assigneeTrigger = host.querySelector('[data-assignee-trigger]');
    if (assigneeTrigger) {
      assigneeTrigger.title = taskCapabilities.canTransferAssignee ? '切换负责人' : '只有当前负责人可以交接任务';
      if (!taskCapabilities.canTransferAssignee) {
        host.querySelector('[data-assignee-picker]')?.classList.remove('open');
        assigneeTrigger.setAttribute('aria-expanded', 'false');
      }
    }
    host.querySelectorAll('[data-assignee-search], [data-assignee-id]').forEach(control => {
      control.disabled = !taskCapabilities.canTransferAssignee;
    });
    const claimButton = host.querySelector('[data-task-claim]');
    if (claimButton) claimButton.hidden = !taskCapabilities.canClaim;
    const attachmentInput = host.querySelector('[data-task-attachment-input]');
    if (attachmentInput) attachmentInput.disabled = !taskCapabilities.canManageAttachments;
    const attachmentSection = host.querySelector('[data-task-attachments-section]');
    if (attachmentSection && !taskAttachmentUploading && !pendingTaskAttachments.length) {
      attachmentSection.hidden = true;
      attachmentSection.setAttribute('aria-hidden', String(!taskCapabilities.canManageAttachments));
    }
    const attachmentButton = host.querySelector('[data-task-comment-attachment]');
    if (attachmentButton) {
      attachmentButton.hidden = !taskCapabilities.canManageAttachments;
      attachmentButton.disabled = !taskCapabilities.canManageAttachments;
    }
    const commentInput = host.querySelector('[data-task-comment] textarea');
    if (commentInput) commentInput.disabled = !taskCapabilities.canComment;
    const commentSubmit = host.querySelector('[data-task-comment] [type="submit"]');
    if (commentSubmit) commentSubmit.disabled = !taskCapabilities.canComment;
    host.querySelector('[data-subtask-add]')?.toggleAttribute('hidden', !taskCapabilities.canManageSubtasks);
    host.querySelectorAll('[data-subtask-delete]').forEach(button => {
      const row = button.closest('[data-subtask-id]');
      const subtask = row ? subtasks.find(item => String(item.id) === String(row.dataset.subtaskId)) : null;
      const canDelete = Boolean(subtask && subtaskCanDelete(subtask));
      button.hidden = !canDelete;
      button.disabled = !canDelete;
    });
    host.querySelectorAll('[data-subtask-complete]').forEach(control => {
      const row = control.closest('[data-subtask-id]');
      const subtask = row ? subtasks.find(item => String(item.id) === String(row.dataset.subtaskId)) : null;
      const canEdit = Boolean(subtask && subtaskCanEdit(subtask));
      control.disabled = !canEdit;
    });
    syncCommentSendState();
  };
  applyTaskCapabilityState();
  const refreshTaskExecution = async () => {
    if (store.apiToken !== taskSessionToken) return false;
    const refreshed = await apiRequest(`${taskResourcePath}/detail`, {}, taskSessionToken);
    if (taskDetailClosed || !host.isConnected || store.apiToken !== taskSessionToken) return false;
    if (!refreshed.response?.ok || !refreshed.body?.task) {
      // A failed re-read must not leave pre-handoff capabilities enabled.
      detail.capabilities = false;
      options.capabilities = false;
      applyTaskCapabilityState();
      showToast('任务权限同步失败，请重新打开任务');
      return false;
    }
    Object.assign(detail.task, refreshed.body.task);
    for (const key of ['customerProfile', 'customerManagement']) {
      if (!Object.hasOwn(refreshed.body.task, key)) delete detail.task[key];
    }
    detail.capabilities = refreshed.body.capabilities;
    options.capabilities = refreshed.body.capabilities;
    detail.history = refreshed.body.history || [];
    detail.activities = refreshed.body.activities || [];
    subtasks = refreshed.body.subtasks || [];
    detail.subtasks = subtasks;
    renderSubtasks();
    if (!subtaskContext?.subtaskId) syncTask(refreshed.body.task);
    renderAssignee(currentAssigneeMember());
    const statusControl = host.querySelector('[data-task-status]');
    if (statusControl) statusControl.value = taskBoardStatus(detail.task);
    applyTaskCapabilityState();
    host.querySelector('[data-task-feed-list]').innerHTML = feedMarkup(host.querySelector('[data-task-feed].active')?.dataset.taskFeed || 'all');
    return true;
  };
  host.querySelector('[data-organization-open]')?.addEventListener('click', () => openOrganizationStructure(store, {
    apiRequest, showToast,
    onChanged: async data => {
      store.members = data.members || store.members;
      if (project?.id) await refreshProjectMembers();
      await refreshTaskExecution();
    }
  }));
  const notePanel = host.querySelector('[data-task-note-panel]');
  const noteToggle = host.querySelector('[data-task-note-toggle]');
  const noteShell = host.querySelector('[data-task-note-editor-shell]');
  const noteSummary = host.querySelector('[data-task-note-summary]');
  const noteEditor = host.querySelector('[data-task-rich-editor]');
  const setNoteEditorOpen = open => {
    noteEditorOpen = Boolean(open);
    notePanel?.classList.toggle('is-open', noteEditorOpen);
    noteToggle?.setAttribute('aria-expanded', String(noteEditorOpen));
    if (noteShell) noteShell.hidden = !noteEditorOpen;
    if (noteEditorOpen) setTimeout(() => noteEditor?.focus(), 0);
  };
  const refreshNoteSummary = () => {
    if (!noteSummary) return;
    const summary = summarizeRichText(detail.task.description) || '待添加';
    noteSummary.textContent = summary;
    noteToggle?.classList.toggle('is-empty', summary === '待添加');
  };
  refreshNoteSummary();
  noteToggle?.addEventListener('click', event => {
    event.preventDefault();
    setNoteEditorOpen(true);
  });
  host.querySelector('[data-task-note-close]')?.addEventListener('click', event => {
    event.preventDefault();
    setNoteEditorOpen(false);
  });
  host.addEventListener('pointerdown', event => {
    if (!noteEditorOpen || !notePanel || notePanel.contains(event.target) || event.target.closest?.('[data-task-note-toggle]')) return;
    setNoteEditorOpen(false);
  });
  renderTaskAttachments();
  document.addEventListener('keydown', escape);
  host.querySelector('[data-close-task-detail]').onclick = close;
  host.querySelectorAll('[data-task-detail-parent]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault();
    void close();
  }));
  const returnToRoot = async () => {
    await close();
    await options.onReturnRoot?.();
  };
  host.querySelector('[data-task-breadcrumb-project]')?.addEventListener('click', () => { void returnToRoot(); });
  const renderTaskFeed = () => {
    const feed = host.querySelector('[data-task-feed-list]');
    if (!feed) return;
    feed.innerHTML = feedMarkup(host.querySelector('[data-task-feed].active')?.dataset.taskFeed || 'all');
  };
  const addTaskAttachmentActivity = (action, attachment) => {
    detail.activities = [{
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      action,
      username: store.user?.username || store.user?.displayName || '我',
      displayName: store.user?.displayName || store.user?.username || '我',
       entityId: attachment?.id || '',
       metadata: { taskId: detail.task.id, projectId: detail.task.projectId || null, name: attachment?.name || '', attachmentId: attachment?.id || '' },
      createdAt: new Date().toISOString()
    }, ...(detail.activities || [])];
    renderTaskFeed();
  };
  const queueTaskAttachments = files => {
    if (!getTaskCapabilities().canManageAttachments) {
      showToast('只有当前负责人可以管理任务附件');
      return;
    }
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) return;
    const existingKeys = new Set([
      ...attachments.map(item => taskAttachmentFileKey(item)),
      ...pendingTaskAttachments.map(item => taskAttachmentFileKey(item.file))
    ]);
    const rejected = [];
    selectedFiles.forEach(file => {
      const name = String(file?.name || '未命名文件');
      const size = Number(file?.size || 0);
      if (!size) {
        rejected.push(`${name} 是空文件`);
        return;
      }
      if (size > taskAttachmentMaxBytes) {
        rejected.push(`${name} 超过 50MB 限制`);
        return;
      }
      const key = taskAttachmentFileKey(file);
      if (existingKeys.has(key)) {
        rejected.push(`${name} 已在附件列表中`);
        return;
      }
      existingKeys.add(key);
      pendingTaskAttachments.push(createPendingTaskAttachment(file));
    });
    const input = host.querySelector('[data-task-attachment-input]');
    if (input) input.value = '';
    renderTaskAttachments();
    if (rejected.length) showToast(rejected.slice(0, 3).join('；'));
  };
  const removePendingTaskAttachment = pendingId => {
    const pending = pendingTaskAttachments.find(item => item.id === pendingId);
    if (!pending) return;
    releasePendingTaskAttachmentPreview(pending);
    pendingTaskAttachments = pendingTaskAttachments.filter(item => item.id !== pendingId);
    host.querySelectorAll(`[data-task-pending-attachment="${pendingId}"]`).forEach(marker => marker.remove());
    scheduleRichDescriptionSave();
    renderTaskAttachments();
  };
  const uploadTaskAttachments = async pendingItems => {
    if (!getTaskCapabilities().canManageAttachments) {
      releasePendingTaskAttachmentPreviews();
      renderTaskAttachments();
      return showToast('只有当前负责人可以上传任务附件');
    }
    if (taskAttachmentUploading) return;
    const selectedItems = Array.from(pendingItems || []).filter(item => pendingTaskAttachments.some(pending => pending.id === item?.id));
    if (!selectedItems.length) return;
    const apiBase = location.pathname.startsWith('/mfggo/') ? '/mfggo-api' : '/api';
    const failedMessages = [];
    taskAttachmentUploading = true;
    renderTaskAttachments();
    for (const pending of selectedItems) {
      const file = pending.file;
      if (!file) continue;
      if (!Number(file.size || 0)) {
        failedMessages.push(`${pending.name} 是空文件`);
        continue;
      }
      if (Number(file.size || 0) > taskAttachmentMaxBytes) {
        failedMessages.push(`${pending.name} 超过 50MB 限制`);
        continue;
      }
      try {
        const response = await fetch(`${apiBase}${taskAttachmentApiPath}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${store.apiToken}`,
            'content-type': 'application/octet-stream',
            'x-file-name': encodeURIComponent(file.name)
          },
          body: file
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || '附件上传失败');
        if (body.attachment) {
          attachments.push(body.attachment);
          host.querySelectorAll(`[data-task-pending-attachment="${pending.id}"]`).forEach(marker => {
            marker.removeAttribute('data-task-pending-attachment');
            marker.dataset.taskAttachmentId = body.attachment.id;
            marker.classList.remove('task-rich-attachment-marker');
            marker.classList.add('task-rich-attachment-link');
            marker.textContent = body.attachment.name || pending.name;
          });
          await persistRichDescription();
          pendingTaskAttachments = pendingTaskAttachments.filter(item => item.id !== pending.id);
          releasePendingTaskAttachmentPreview(pending);
          detail.attachments = attachments;
          addTaskAttachmentActivity('task.attachment.upload', body.attachment);
          renderTaskAttachments();
          renderRelatedContent();
        }
      } catch (error) {
        failedMessages.push(`${pending.name}：${error?.message || '附件上传失败'}`);
      }
    }
    taskAttachmentUploading = false;
    renderTaskAttachments();
    if (failedMessages.length) showToast(failedMessages.slice(0, 3).join('；'));
  };
  const openTaskAttachmentPreview = async attachment => {
    if (!attachment?.id) return;
    if (typeof taskAttachmentPreviewClose === 'function') taskAttachmentPreviewClose();
    const kind = taskAttachmentPreviewKind(attachment);
    if (!kind) return showToast('此附件类型暂不支持在线预览，请下载后查看');
    const previewHost = document.createElement('div');
    previewHost.className = 'project-dialog-backdrop storage-preview-backdrop';
    previewHost.innerHTML = `<section class="project-dialog storage-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="taskAttachmentPreviewTitle"><header><div><small>ATTACHMENT PREVIEW</small><h2 id="taskAttachmentPreviewTitle">${esc(attachment.name)}</h2><p class="muted-note">任务附件 · ${esc(formatFileSize(attachment.sizeBytes))}</p></div><button type="button" data-task-attachment-preview-close aria-label="关闭">×</button></header><div class="storage-preview-body"><span class="storage-preview-loading">正在准备预览…</span></div><footer><button type="button" class="outline-button" data-task-attachment-preview-close>关闭</button><button type="button" class="primary-button" data-task-attachment-preview-download>下载文件</button></footer></section>`;
    document.body.appendChild(previewHost);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let closed = false;
    let previewUrl = '';
    const closePreview = () => {
      if (closed) return;
      closed = true;
      controller?.abort();
      if (previewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previewUrl);
      previewHost.remove();
      if (taskAttachmentPreviewClose === closePreview) taskAttachmentPreviewClose = null;
    };
    taskAttachmentPreviewClose = closePreview;
    previewHost.querySelectorAll('[data-task-attachment-preview-close]').forEach(button => button.addEventListener('click', closePreview));
    previewHost.addEventListener('click', event => { if (event.target === previewHost) closePreview(); });
    previewHost.querySelector('[data-task-attachment-preview-download]')?.addEventListener('click', () => downloadTaskAttachment(attachment));
    const previewBody = previewHost.querySelector('.storage-preview-body');
    if (kind === 'text' && Number(attachment.sizeBytes || 0) > 1024 * 1024) {
      previewBody.innerHTML = '<div class="storage-preview-unavailable"><b>文本过大，无法在线预览</b><p>超过 1MB 的文本文件请下载后查看。</p></div>';
      return;
    }
    const apiBase = location.pathname.startsWith('/mfggo/') ? '/mfggo-api' : '/api';
    try {
      const response = await fetch(`${apiBase}${taskAttachmentApiPath}/${encodeURIComponent(attachment.id)}/preview`, {
        headers: { authorization: `Bearer ${store.apiToken}` },
        ...(controller ? { signal: controller.signal } : {})
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || '预览加载失败');
      }
      const blob = await response.blob();
      if (closed) return;
      if (kind === 'text') {
        const text = await blob.text();
        if (!closed) previewBody.innerHTML = `<pre class="storage-preview-text">${esc(text)}</pre>`;
        return;
      }
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error('当前浏览器不支持预览');
      previewUrl = URL.createObjectURL(blob);
      if (closed) { URL.revokeObjectURL(previewUrl); previewUrl = ''; return; }
      previewBody.innerHTML = kind === 'image'
        ? `<img class="storage-preview-image" src="${esc(previewUrl)}" alt="${esc(attachment.name)}">`
        : kind === 'video'
          ? `<video class="storage-preview-media" src="${esc(previewUrl)}" controls playsinline preload="metadata"></video>`
          : kind === 'audio'
            ? `<audio class="storage-preview-audio" src="${esc(previewUrl)}" controls preload="metadata"></audio>`
            : `<iframe class="storage-preview-frame" src="${esc(previewUrl)}" title="${esc(attachment.name)}"></iframe>`;
    } catch (error) {
      if (!closed && error?.name !== 'AbortError') previewBody.innerHTML = `<div class="storage-preview-unavailable"><b>预览失败</b><p>${esc(error?.message || '请下载后查看')}</p></div>`;
    }
  };
  const downloadTaskAttachment = async attachment => {
    if (!attachment?.id) return;
    const apiBase = location.pathname.startsWith('/mfggo/') ? '/mfggo-api' : '/api';
    try {
      const response = await fetch(`${apiBase}${taskAttachmentApiPath}/${encodeURIComponent(attachment.id)}/download`, { headers: { authorization: `Bearer ${store.apiToken}` } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || '附件下载失败');
      }
      const blob = await response.blob();
      if (typeof URL?.createObjectURL !== 'function') throw new Error('当前浏览器不支持附件下载');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.name || 'attachment';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      showToast(error?.message || '附件下载失败');
    }
  };
  const deleteTaskAttachment = async attachment => {
    if (!attachment?.id) return;
    if (!getTaskCapabilities().canManageAttachments) return showToast('只有当前负责人可以删除任务附件');
    const apiBase = location.pathname.startsWith('/mfggo/') ? '/mfggo-api' : '/api';
    try {
      const response = await fetch(`${apiBase}${taskAttachmentApiPath}/${encodeURIComponent(attachment.id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${store.apiToken}` } });
      const result = { response, body: await response.json().catch(() => ({})) };
      if (!response.ok) return showToast(result.body.message || '附件删除失败');
      attachments = attachments.filter(item => item.id !== attachment.id);
      detail.attachments = attachments;
      richEditor?.querySelectorAll('[data-task-attachment-id]').forEach(marker => {
        if (String(marker.dataset.taskAttachmentId) === String(attachment.id)) marker.remove();
      });
      await persistRichDescription();
      addTaskAttachmentActivity('task.attachment.delete', attachment);
      renderTaskAttachments();
      renderRelatedContent();
    } catch (error) {
      showToast(error?.message || '附件删除失败');
    }
  };
  host.querySelector('[data-task-attachment-input]')?.addEventListener('change', event => { queueTaskAttachments(event.target.files); });
  const attachmentDropzone = host.querySelector('[data-task-attachment-dropzone]');
  const filesFromTransfer = transfer => Array.from(transfer?.files || []).filter(file => file && (file.size || file.name));
  const markPendingAttachmentInEditor = (editor, pendingIds) => {
    if (!editor || !pendingIds.length) return;
    pendingIds.forEach(id => {
      const pending = pendingTaskAttachments.find(item => item.id === id);
      if (!pending) return;
      const marker = document.createElement('span');
      marker.className = 'task-rich-attachment-marker';
      marker.dataset.taskPendingAttachment = id;
      marker.contentEditable = 'false';
      marker.textContent = `[附件待上传：${pending.name}]`;
      const selection = window.getSelection?.();
      if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(marker);
        range.setStartAfter(marker);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        editor.appendChild(marker);
      }
      editor.appendChild(document.createTextNode(' '));
    });
  };
  const queueTaskAttachmentsFromTransfer = (transfer, editor = null) => {
    const files = filesFromTransfer(transfer);
    if (!files.length) return false;
    const before = new Set(pendingTaskAttachments.map(item => item.id));
    queueTaskAttachments(files);
    const added = pendingTaskAttachments.filter(item => !before.has(item.id)).map(item => item.id);
    if (editor) markPendingAttachmentInEditor(editor, added);
    return true;
  };
  attachmentDropzone?.addEventListener('dragover', event => {
    if (!getTaskCapabilities().canManageAttachments) return;
    if (!filesFromTransfer(event.dataTransfer).length) return;
    event.preventDefault();
    attachmentDropzone.classList.add('drag-over');
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  attachmentDropzone?.addEventListener('dragleave', event => {
    if (!attachmentDropzone.contains(event.relatedTarget)) attachmentDropzone.classList.remove('drag-over');
  });
  attachmentDropzone?.addEventListener('drop', event => {
    if (!getTaskCapabilities().canManageAttachments) return;
    event.preventDefault();
    attachmentDropzone.classList.remove('drag-over');
    queueTaskAttachmentsFromTransfer(event.dataTransfer);
  });
  attachmentDropzone?.addEventListener('paste', event => {
    if (!getTaskCapabilities().canManageAttachments) return;
    if (queueTaskAttachmentsFromTransfer(event.clipboardData)) event.preventDefault();
  });
  const richEditor = host.querySelector('[data-task-rich-editor]');
  let richSaveTimer = null;
  function persistRichDescription() {
    if (!richEditor) return Promise.resolve(true);
    if (!getTaskCapabilities().canEdit) return Promise.resolve(false);
    const html = normalizeRichDescription(richEditor.innerHTML);
    if (html !== String(detail.task.description || '')) return saveFields({ description: html });
    return Promise.resolve(true);
  }
  function scheduleRichDescriptionSave() {
    window.clearTimeout(richSaveTimer);
    richSaveTimer = window.setTimeout(persistRichDescription, 650);
  }
  richEditor?.addEventListener('input', scheduleRichDescriptionSave);
  richEditor?.addEventListener('blur', persistRichDescription);
  richEditor?.addEventListener('paste', event => {
    if (!getTaskCapabilities().canManageAttachments) return;
    if (queueTaskAttachmentsFromTransfer(event.clipboardData, richEditor)) event.preventDefault();
  });
  richEditor?.addEventListener('dragover', event => {
    if (!getTaskCapabilities().canManageAttachments) return;
    if (!filesFromTransfer(event.dataTransfer).length) return;
    event.preventDefault();
    richEditor.classList.add('drag-over');
  });
  richEditor?.addEventListener('dragleave', event => {
    if (!richEditor.contains(event.relatedTarget)) richEditor.classList.remove('drag-over');
  });
  richEditor?.addEventListener('drop', event => {
    if (!getTaskCapabilities().canManageAttachments) return;
    event.preventDefault();
    richEditor.classList.remove('drag-over');
    queueTaskAttachmentsFromTransfer(event.dataTransfer, richEditor);
  });
  const commentInput = host.querySelector('[data-task-comment] textarea');
  commentInput?.addEventListener('paste', event => {
    if (!getTaskCapabilities().canManageAttachments) return;
    if (queueTaskAttachmentsFromTransfer(event.clipboardData)) event.preventDefault();
  });
  commentInput?.addEventListener('dragover', event => {
    if (!getTaskCapabilities().canManageAttachments) return;
    if (!filesFromTransfer(event.dataTransfer).length) return;
    event.preventDefault();
    commentInput.classList.add('drag-over');
  });
  commentInput?.addEventListener('dragleave', () => commentInput.classList.remove('drag-over'));
  commentInput?.addEventListener('drop', event => {
    if (!getTaskCapabilities().canManageAttachments) return;
    event.preventDefault();
    commentInput.classList.remove('drag-over');
    queueTaskAttachmentsFromTransfer(event.dataTransfer);
  });
  host.querySelectorAll('[data-rich-command]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault();
    if (!richEditor) return;
    richEditor.focus();
    const command = button.dataset.richCommand;
    if (command === 'createLink') {
      const url = window.prompt('请输入链接地址', 'https://');
      if (url && /^(?:https?:|mailto:)/i.test(url)) document.execCommand('createLink', false, url);
    } else if (typeof document.execCommand === 'function') document.execCommand(command, false);
    scheduleRichDescriptionSave();
  }));
  host.addEventListener('click', event => {
    const submitButton = event.target.closest('[data-task-attachment-submit]');
    if (submitButton) {
      event.preventDefault();
      if (!getTaskCapabilities().canManageAttachments) return showToast('只有当前负责人可以上传任务附件');
      if (!taskAttachmentUploading) void uploadTaskAttachments(pendingTaskAttachments);
      return;
    }
    const pendingDeleteButton = event.target.closest('[data-task-attachment-pending-delete]');
    if (pendingDeleteButton) {
      event.preventDefault();
      if (!getTaskCapabilities().canManageAttachments) return showToast('只有当前负责人可以管理任务附件');
      if (!taskAttachmentUploading) removePendingTaskAttachment(pendingDeleteButton.dataset.taskAttachmentPendingDelete);
      return;
    }
    const clearPendingButton = event.target.closest('[data-task-attachment-clear]');
    if (clearPendingButton) {
      event.preventDefault();
      if (!getTaskCapabilities().canManageAttachments) return showToast('只有当前负责人可以管理任务附件');
      if (!taskAttachmentUploading) {
        releasePendingTaskAttachmentPreviews();
        host.querySelectorAll('[data-task-pending-attachment]').forEach(marker => marker.remove());
        scheduleRichDescriptionSave();
        renderTaskAttachments();
      }
      return;
    }
    const uploadButton = event.target.closest('[data-task-attachment-upload]');
    if (uploadButton) {
      event.preventDefault();
      if (!getTaskCapabilities().canManageAttachments) return showToast('只有当前负责人可以上传任务附件');
      if (!taskAttachmentUploading) host.querySelector('[data-task-attachment-input]')?.click();
      return;
    }
    if (event.target.closest('[data-task-comment-attachment]')) {
      event.preventDefault();
      if (!getTaskCapabilities().canManageAttachments) return showToast('只有当前负责人可以上传任务附件');
      host.querySelector('[data-task-attachment-input]')?.click();
      return;
    }
    const downloadButton = event.target.closest('[data-task-attachment-download]');
    if (downloadButton) {
      const attachment = attachments.find(item => item.id === downloadButton.dataset.taskAttachmentDownload);
      void downloadTaskAttachment(attachment);
      return;
    }
    const previewButton = event.target.closest('[data-task-attachment-preview]');
    if (previewButton) {
      const attachment = attachments.find(item => item.id === previewButton.dataset.taskAttachmentPreview);
      void openTaskAttachmentPreview(attachment);
      return;
    }
    const deleteButton = event.target.closest('[data-task-attachment-delete]');
    if (deleteButton) {
      if (!getTaskCapabilities().canManageAttachments) return showToast('只有当前负责人可以删除任务附件');
      const attachment = attachments.find(item => item.id === deleteButton.dataset.taskAttachmentDelete);
      void deleteTaskAttachment(attachment);
      return;
    }
    const feedAttachmentButton = event.target.closest('[data-task-feed-attachment]');
    if (feedAttachmentButton) {
      const attachment = attachments.find(item => String(item.id) === String(feedAttachmentButton.dataset.taskFeedAttachment));
      if (!attachment) return showToast('附件已删除或无权访问');
      void openTaskAttachmentPreview(attachment);
      return;
    }
    const richAttachment = event.target.closest('[data-task-attachment-id]');
    if (richAttachment && richEditor?.contains(richAttachment)) {
      event.preventDefault();
      const attachment = attachments.find(item => String(item.id) === String(richAttachment.dataset.taskAttachmentId));
      if (!attachment) return showToast('附件已删除或无权访问');
      void openTaskAttachmentPreview(attachment);
    }
  });
  let relatedNavigationPending = false;
  const bindRelatedContent = () => host.querySelectorAll('[data-task-related]:not([data-related-bound])').forEach(button => {
    button.dataset.relatedBound = 'true';
    button.addEventListener('click', () => {
      const resource = resources.find(item => item.kind === button.dataset.relatedKind && item.id === button.dataset.relatedId);
      if (!resource) return;
      if (resource.kind === 'file' && resource.source === 'task-attachment') {
        const attachment = attachments.find(item => String(item.id) === String(resource.id)) || resource.attachment || resource.record;
        if (attachment) return void openTaskAttachmentPreview(attachment);
      }
      if (!onRelatedContent) return showToast('关联内容暂不可打开');
      // A double click can otherwise queue two async hand-offs and open stacked
      // destination dialogs (especially the quote and FAIR summaries).
      if (relatedNavigationPending) return;
      relatedNavigationPending = true;
      button.disabled = true;
      // Leave the task modal before switching to another module. This prevents
      // stacked dialogs and lets the destination view own keyboard focus.
      void (async () => {
        try {
          await close();
          await onRelatedContent(resource);
        } catch {
          relatedNavigationPending = false;
          button.disabled = false;
          showToast('关联内容打开失败');
        }
      })();
    });
  });
  bindRelatedContent();
  const canWriteSubtasks = () => Boolean(getTaskCapabilities().canManageSubtasks);
  const openSubtaskDialog = existing => {
    if (!canWriteSubtasks()) return showToast('只有当前负责人可以添加子任务');
    document.querySelector('[data-subtask-dialog]')?.remove();
    const current = existing || {};
    // A newly created subtask belongs to its creator by default. Keep an
    // explicit "未分配" option for callers that intentionally release it.
    const currentUserId = String(store.user?.id || store.user?.userId || '').trim();
    const defaultAssigneeId = existing
      ? String(current.assigneeUserId || '').trim()
      : (members.some(member => String(member?.id || '') === currentUserId) ? currentUserId : '');
    const dialog = document.createElement('div');
    dialog.className = 'project-dialog-backdrop';
    dialog.innerHTML = `<section class="project-dialog subtask-dialog" data-subtask-dialog role="dialog" aria-modal="true" aria-labelledby="subtaskDialogTitle"><header><div><small>${existing ? 'EDIT SUBTASK' : 'NEW SUBTASK'}</small><h2 id="subtaskDialogTitle">${existing ? '编辑子任务' : '添加子任务'}</h2></div><button type="button" data-subtask-dialog-close aria-label="关闭">×</button></header><form><label>子任务名称<input name="title" maxlength="160" value="${esc(current.title || '')}" placeholder="例如：确认客户图纸版本" required></label><label>说明<textarea name="description" rows="3" maxlength="4000" placeholder="补充交付标准或协作信息">${esc(current.description || '')}</textarea></label><div class="dialog-grid"><label>负责人<select name="assigneeUserId"><option value="" ${defaultAssigneeId ? '' : 'selected'}>未分配</option>${members.map(member => { const name = member.displayName || member.username || '成员'; return `<option value="${esc(member.id)}" ${String(member.id) === defaultAssigneeId ? 'selected' : ''}>${esc(name)}</option>`; }).join('')}</select></label><label>优先级<select name="priority">${['普通', '高', '紧急'].map(value => `<option value="${value}" ${value === (current.priority || '普通') ? 'selected' : ''}>${value}</option>`).join('')}</select></label></div><div class="dialog-grid"><label>开始日期<input name="startAt" type="date" value="${esc(current.startAt || '')}"></label><label>截止日期<input name="dueAt" type="date" value="${esc(current.dueAt || '')}"></label></div><label>状态<select name="status">${['待处理', '进行中', '已完成'].map(value => `<option value="${value}" ${value === (current.status || (current.completed ? '已完成' : '待处理')) ? 'selected' : ''}>${value}</option>`).join('')}</select></label><footer><button type="button" class="outline-button" data-subtask-dialog-close>取消</button><button type="submit" class="primary-button">${existing ? '保存子任务' : '添加子任务'}</button></footer></form></section>`;
    document.body.appendChild(dialog);
    if (!existing) { const select = dialog.querySelector('[name="assigneeUserId"]'); select.add(new Option('按自动化规则分配', '__automation__', true, true), 0); select.value = '__automation__'; }
    const closeDialog = () => dialog.remove();
    dialog.querySelectorAll('[data-subtask-dialog-close]').forEach(button => button.addEventListener('click', closeDialog));
    dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
    dialog.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      if (!canWriteSubtasks()) return showToast('只有当前负责人可以添加子任务');
      if (subtaskBusy) return;
      const form = new FormData(event.currentTarget);
      const title = String(form.get('title') || '').trim();
      if (!title) return showToast('子任务名称不能为空');
      const payload = {
        title,
        description: String(form.get('description') || ''),
        assigneeUserId: form.get('assigneeUserId') === '__automation__' ? undefined : String(form.get('assigneeUserId') || ''),
        priority: String(form.get('priority') || '普通'),
        startAt: String(form.get('startAt') || ''),
        dueAt: String(form.get('dueAt') || ''),
        status: String(form.get('status') || '待处理')
      };
      const submitButton = event.currentTarget.querySelector('[type="submit"]');
      submitButton.disabled = true;
      subtaskBusy = true;
      const path = existing
        ? `/api/tasks/${encodeURIComponent(taskIdForSubtasks)}/subtasks/${encodeURIComponent(existing.id)}`
        : subtaskContext?.subtaskId
          ? `/api/tasks/${encodeURIComponent(taskIdForSubtasks)}/subtasks/${encodeURIComponent(subtaskContext.subtaskId)}/subtasks`
          : `/api/tasks/${encodeURIComponent(taskIdForSubtasks)}/subtasks`;
      const result = await apiRequest(path, { method: existing ? 'PUT' : 'POST', body: JSON.stringify(payload) }, store.apiToken);
      subtaskBusy = false;
      submitButton.disabled = false;
      if (!result.response?.ok || !result.body?.subtask) return showToast(result.body?.message || '子任务保存失败');
      if (existing) {
        const index = subtasks.findIndex(item => item.id === existing.id);
        if (index >= 0) subtasks[index] = result.body.subtask;
      } else subtasks.push(result.body.subtask);
      subtasks.sort((left, right) => Number(left.position || 0) - Number(right.position || 0) || String(left.createdAt || '').localeCompare(String(right.createdAt || '')));
      detail.subtasks = subtasks;
      closeDialog();
      renderSubtasks();
      showToast(existing ? '子任务已更新' : '子任务已添加');
    });
    dialog.querySelector('input[name="title"]')?.focus();
  };
  const updateSubtask = async (subtask, changes, allowSubtaskExecutor = false) => {
    if (!subtask?.id || subtaskBusy) return;
    if (!canWriteSubtasks() && !(allowSubtaskExecutor && subtaskCanEdit(subtask))) return showToast('只有当前负责人可以编辑子任务');
    subtaskBusy = true;
    const result = await apiRequest(`${taskSubtaskBasePath}/${encodeURIComponent(subtask.id)}`, { method: 'PUT', body: JSON.stringify(changes) }, store.apiToken);
    subtaskBusy = false;
    if (!result.response?.ok || !result.body?.subtask) return showToast(result.body?.message || '子任务更新失败');
    const index = subtasks.findIndex(item => item.id === subtask.id);
    if (index >= 0) subtasks[index] = result.body.subtask;
    detail.subtasks = subtasks;
    renderSubtasks();
  };
  host.querySelector('[data-task-subtasks-section]')?.addEventListener('click', async event => {
    const row = event.target.closest('[data-subtask-id]');
    const subtask = row ? subtasks.find(item => item.id === row.dataset.subtaskId) : null;
    if (event.target.closest('[data-subtask-delete]') && subtask) {
      event.preventDefault();
      if (!subtaskCanDelete(subtask)) return showToast('需要企业所有者授予删除任务权限');
      if (window.confirm('永久删除此子任务及其下级子任务、评论和附件？删除后无法恢复。')) {
        subtaskBusy = true;
        apiRequest(`${taskSubtaskBasePath}/${encodeURIComponent(subtask.id)}`, { method: 'DELETE' }, store.apiToken).then(result => {
          subtaskBusy = false;
          if (!result.response?.ok) { void refreshTaskExecution(); return showToast(result.body?.message || '子任务删除失败'); }
          subtasks = subtasks.filter(item => item.id !== subtask.id);
          detail.subtasks = subtasks;
          renderSubtasks();
          showToast('子任务已删除');
        });
      }
      return;
    }
    if (event.target.closest('[data-subtask-add]')) {
      event.preventDefault();
      if (canWriteSubtasks()) openSubtaskDialog(null);
      return;
    }
    const openButton = event.target.closest('[data-subtask-open]');
    const rowOpen = row && !event.target.closest('[data-subtask-delete], [data-subtask-complete]');
    if ((openButton || rowOpen) && subtask) {
      event.preventDefault();
      event.stopPropagation();
      const result = await apiRequest(`${taskSubtaskBasePath}/${encodeURIComponent(subtask.id)}/detail`, {}, store.apiToken);
      if (!result.response?.ok || !result.body?.task) return showToast(result.body?.message || '子任务详情加载失败');
      openTaskDetail(store, result.body, {
        keepParent: true,
        subtaskContext: { rootTaskId: taskIdForSubtasks, subtaskId: subtask.id },
        parentTitle: detail.task.title,
        onReturnRoot: subtaskContext?.subtaskId ? returnToRoot : async () => { await refreshTaskExecution(); },
        projectMembers,
        capabilities: result.body.capabilities || subtask.capabilities || {},
        related: options.related || null,
        onRelatedContent,
        onOpenProject: options.onOpenProject,
        onClose: async () => {
          // A nested detail can change its own executor, status, or title.
          // Refresh the parent list on return so its row and completion count
          // reflect the saved child immediately.
          const refreshed = await apiRequest(`${taskSubtaskBasePath}`, {}, store.apiToken);
          if (refreshed.response?.ok && Array.isArray(refreshed.body?.subtasks)) {
            subtasks = refreshed.body.subtasks.slice().sort((left, right) => Number(left.position || 0) - Number(right.position || 0) || String(left.createdAt || '').localeCompare(String(right.createdAt || '')));
            detail.subtasks = subtasks;
          }
          renderSubtasks();
          if (!subtaskContext?.subtaskId) {
            await refreshTaskExecution();
            for (const key of ['customerProfile', 'customerManagement']) {
              const input = host.querySelector(`[data-task-field="${key}"]`);
              if (input) input.value = detail.task[key] || '';
            }
          }
        }
      });
    }
  });
  host.querySelector('[data-task-subtasks-section]')?.addEventListener('change', event => {
    const completeControl = event.target.closest('[data-subtask-complete]');
    if (!completeControl) return;
    const row = completeControl.closest('[data-subtask-id]');
    const subtask = row ? subtasks.find(item => item.id === row.dataset.subtaskId) : null;
    const previousCompleted = Boolean(subtask?.completed || subtask?.status === '已完成');
    if (!subtask || !subtaskCanEdit(subtask)) {
      completeControl.checked = previousCompleted;
      return showToast('只有当前子任务负责人可以修改完成状态');
    }
    if (subtaskBusy) {
      completeControl.checked = previousCompleted;
      return;
    }
    updateSubtask(subtask, {
      completed: completeControl.checked,
      status: completeControl.checked ? '已完成' : '待处理'
    }, true).catch(() => {
      completeControl.checked = previousCompleted;
    });
  });
  host.querySelector('[data-copy-task-link]').onclick = () => {
    const taskUrl = new URL(location.href);
    taskUrl.hash = '';
    taskUrl.searchParams.set('task', detail.task.id);
    navigator.clipboard?.writeText(taskUrl.toString()).then(() => showToast('任务链接已复制')).catch(() => showToast('复制失败'));
  };
  host.querySelectorAll('[data-task-field]').forEach(control => {
    if (control.matches('[contenteditable="true"], [data-task-rich-editor]')) return;
    control.addEventListener(control.tagName === 'TEXTAREA' || control.tagName === 'INPUT' && control.type === 'text' ? 'blur' : 'change', () => {
      if (!canSaveTaskField(control.dataset.taskField, control.type === 'number' ? Number(control.value) : control.value)) {
        applyTaskCapabilityState();
        return;
      }
      saveFields({ [control.dataset.taskField]: control.type === 'number' ? Number(control.value) : control.value });
    });
  });
  const assigneePicker = host.querySelector('[data-assignee-picker]');
  const assigneeTrigger = host.querySelector('[data-assignee-trigger]');
  const assigneeSearch = host.querySelector('[data-assignee-search]');
  let assigneeSelectionVersion = 0;
  const closeAssigneePicker = () => { assigneePicker.classList.remove('open'); assigneeTrigger.setAttribute('aria-expanded', 'false'); };
  let renderedParticipantMarkup = participantMarkup;
  const renderParticipants = assigneeOverride => {
    const unique = uniqueParticipants(participantMembersForDetail(assigneeOverride));
    const count = host.querySelector('[data-project-member-count]');
    const list = host.querySelector('[data-project-member-list]');
    if (count) count.textContent = String(unique.length);
    const nextMarkup = participantMarkupFor(unique);
    if (list && nextMarkup !== renderedParticipantMarkup) {
      closeParticipantMenu();
      list.innerHTML = nextMarkup;
      renderedParticipantMarkup = nextMarkup;
    }
  };
  const renderAssignee = member => {
    const name = member?.displayName || member?.username || '未分配';
    host.querySelector('[data-assignee-name]').textContent = name;
    host.querySelector('[data-assignee-avatar]').textContent = name.slice(0, 1);
    host.querySelectorAll('[data-assignee-id]').forEach(item => item.setAttribute('aria-selected', String(item.dataset.assigneeId === member?.id)));
    const claimButton = host.querySelector('[data-task-claim]');
    if (claimButton) claimButton.hidden = Boolean(member) || !getTaskCapabilities().canClaim;
    renderParticipants(member);
  };
  assigneeTrigger.onclick = event => {
    const capabilities = getTaskCapabilities();
    if (!capabilities.canTransferAssignee) {
      event.preventDefault();
      event.stopPropagation();
      return showToast(detail.task.assigneeUserId
        ? '只有当前负责人可以交接任务，请联系当前负责人'
        : capabilities.canClaim ? '任务尚未分配，请先认领任务' : '当前账号无权分配负责人');
    }
    event.stopPropagation();
    const open = !assigneePicker.classList.contains('open');
    assigneePicker.classList.toggle('open', open);
    assigneeTrigger.setAttribute('aria-expanded', String(open));
    if (open) { assigneeSearch.value = ''; assigneeSearch.dispatchEvent(new Event('input')); setTimeout(() => assigneeSearch.focus(), 0); }
  };
  assigneePicker.addEventListener('click', async event => {
    event.stopPropagation();
    if (!getTaskCapabilities().canTransferAssignee) return;
    const button = event.target.closest('[data-assignee-id]');
    if (!button || !assigneePicker.contains(button)) return;
    const member = members.find(item => item.id === button.dataset.assigneeId) || null;
    if (!canSaveTaskField('assigneeUserId', member?.id || '')) return showToast('只有当前负责人可以交接任务，未分配任务可由参与者认领');
    const selectionVersion = ++assigneeSelectionVersion;
    renderAssignee(member);
    closeAssigneePicker();
    const saved = await saveFields({ assigneeUserId: member?.id || '' });
    if (saved) {
      applyTaskCapabilityState();
      return;
    }
    if (selectionVersion !== assigneeSelectionVersion) return;
    const restoredMember = currentAssigneeMember();
    renderAssignee(restoredMember);
    applyTaskCapabilityState();
  });
  assigneeSearch.addEventListener('input', () => {
    const query = assigneeSearch.value.trim().toLowerCase();
    let visible = 0;
    host.querySelectorAll('[data-assignee-id]').forEach(button => { const match = !query || button.textContent.toLowerCase().includes(query); button.hidden = !match; if (match) visible += 1; });
    host.querySelector('.assignee-picker-empty').classList.toggle('visible', visible === 0);
  });
  const claimTask = async event => {
    if (!getTaskCapabilities().canClaim) return showToast('当前账号暂时不能认领此任务');
    const member = members.find(item => item.id === store.user?.id) || (['owner', 'admin'].includes(store.role) ? store.user : null);
    if (!member) return showToast('当前账号不是项目参与者');
    const button = event.currentTarget;
    button.disabled = true;
    const saved = await saveFields({ assigneeUserId: member.id });
    button.disabled = false;
    if (saved) {
      renderAssignee(currentAssigneeMember());
      applyTaskCapabilityState();
    }
  };
  host.querySelector('[data-task-claim]')?.addEventListener('click', claimTask);
  host.addEventListener('click', event => { if (!assigneePicker.contains(event.target)) closeAssigneePicker(); });
  const renderProjectMembers = () => {
    renderParticipants();
    const pickerList = host.querySelector('.assignee-picker-list');
    if (pickerList) pickerList.innerHTML = `<button type="button" role="option" data-assignee-id="" data-assignee-label="未分配" aria-selected="${detail.task.assigneeUserId ? 'false' : 'true'}"><span class="member-avatar">—</span><span><b>未分配</b><small>负责人为空</small></span><i>✓</i></button>${members.map(member => { const name = member.displayName || member.username || '成员'; return `<button type="button" role="option" data-assignee-id="${esc(member.id)}" data-assignee-label="${esc(name)}" aria-selected="${member.id === detail.task.assigneeUserId}"><span class="member-avatar">${esc(String(name).slice(0, 1))}</span><span><b>${esc(name)}</b><small>@${esc(member.username || '')}</small></span><i>✓</i></button>`; }).join('')}`;
  };
  const refreshProjectMembers = async () => {
    if (!project?.id) return false;
    const result = await apiRequest(`/api/projects/${encodeURIComponent(project.id)}/members`, {}, store.apiToken);
    if (!result.response?.ok || !Array.isArray(result.body?.members)) return false;
    const latest = result.body.members;
    projectMembers.splice(0, projectMembers.length, ...latest);
    members.splice(0, members.length, ...latest);
    if (store.projectMembers && project.id === detail.task.projectId) {
      store.projectMembers.splice(0, store.projectMembers.length, ...latest);
    }
    renderProjectMembers();
    applyTaskCapabilityState();
    return true;
  };
  const openProjectMemberPicker = () => {
    if (!project?.id || !getTaskCapabilities().canManageProjectMembers) return;
    document.querySelector('[data-project-member-picker]')?.remove();
    const picker = document.createElement('div');
    // This picker is opened from inside the task-detail modal. Give it its
    // own stacking layer so the original task template cannot cover it.
    picker.className = 'project-dialog-backdrop project-member-picker-backdrop';
    const candidates = (store.members || []).filter(member => member?.id && !members.some(item => item.id === member.id));
    picker.innerHTML = `<section class="project-dialog project-member-picker" data-project-member-picker role="dialog" aria-modal="true" aria-labelledby="projectMemberPickerTitle"><header><div><small>PROJECT MEMBERS</small><h2 id="projectMemberPickerTitle">添加项目参与者</h2></div><button type="button" data-project-member-picker-close aria-label="关闭">×</button></header><div class="project-member-picker-list">${candidates.length ? candidates.map(member => `<button type="button" data-project-member-candidate="${esc(member.id)}"><span class="member-avatar">${esc(String(member.displayName || member.username || '成').slice(0, 1))}</span><span><b>${esc(member.displayName || member.username || '成员')}</b><small>@${esc(member.username || '')}</small></span><i>添加</i></button>`).join('') : '<p class="muted-note">没有可添加的企业成员</p>'}</div><footer><button type="button" class="outline-button" data-project-member-picker-close>关闭</button></footer></section>`;
    document.body.appendChild(picker);
    const closePicker = () => picker.remove();
    picker.querySelectorAll('[data-project-member-picker-close]').forEach(button => button.addEventListener('click', closePicker));
    picker.addEventListener('click', async event => {
      if (event.target === picker) return closePicker();
      const candidate = event.target.closest('[data-project-member-candidate]');
      if (!candidate) return;
      if (!getTaskCapabilities().canManageProjectMembers) {
        closePicker();
        await refreshTaskExecution();
        return;
      }
      const userId = candidate.dataset.projectMemberCandidate;
      candidate.disabled = true;
      const result = await apiRequest(`/api/projects/${encodeURIComponent(project.id)}/members`, { method: 'POST', body: JSON.stringify({ userId, projectRole: 'member' }) }, store.apiToken);
      if (!result.response?.ok) {
        candidate.disabled = false;
        if (result.response?.status === 403) {
          closePicker();
          await refreshTaskExecution();
        }
        return showToast(result.body.message || '添加参与者失败');
      }
      // Re-read the canonical list so every member-facing control receives
      // the same server state, including when another session changed it.
      const refreshed = await refreshProjectMembers();
      if (!refreshed) {
        if (result.body.member?.id && !projectMembers.some(item => item.id === result.body.member.id)) projectMembers.push(result.body.member);
        if (result.body.member?.id && !members.some(item => item.id === result.body.member.id)) members.push(result.body.member);
        renderProjectMembers();
        showToast('成员已添加，列表同步稍后完成');
      }
      candidate.remove();
      showToast('项目参与者已添加');
      if (!picker.querySelector('[data-project-member-candidate]')) closePicker();
    });
  };
  host.querySelector('[data-project-member-add]')?.addEventListener('click', openProjectMemberPicker);
  const participantList = host.querySelector('[data-project-member-list]');
  const participantMenu = host.querySelector('[data-participant-menu]');
  const participantSection = host.querySelector('[data-task-participants]');
  let selectedParticipantId = '';
  let participantRemovalBusy = false;
  const alignParticipantMenu = () => {
    if (!participantMenu || participantMenu.hidden) return;
    const anchor = participantMenu.parentElement.getBoundingClientRect();
    const rail = participantSection.getBoundingClientRect();
    participantMenu.toggleAttribute('data-align-right', anchor.left + participantMenu.offsetWidth > rail.right - 12);
  };
  const participantResizeObserver = new ResizeObserver(alignParticipantMenu);
  participantResizeObserver.observe(participantSection);
  disposeParticipantMenu = () => participantResizeObserver.disconnect();
  const closeParticipantMenu = (restoreFocus = false) => {
    if (!participantMenu) return;
    participantMenu.hidden = true;
    participantMenu.innerHTML = '';
    participantSection.appendChild(participantMenu);
    host.querySelectorAll('[data-project-member-id]').forEach(button => {
      button.setAttribute('aria-expanded', 'false');
    });
    if (restoreFocus && selectedParticipantId) host.querySelector(`[data-project-member-id="${CSS.escape(selectedParticipantId)}"]`)?.focus({ preventScroll: true });
    selectedParticipantId = '';
  };
  participantList?.addEventListener('click', event => {
    const trigger = event.target.closest('[data-project-member-id]');
    if (!trigger || subtaskContext?.subtaskId || !project?.id || !participantMenu || participantRemovalBusy) return;
    const member = projectMembers.find(item => item.id === trigger.dataset.projectMemberId);
    if (!member) return;
    if (selectedParticipantId === member.id && !participantMenu.hidden) return closeParticipantMenu();
    closeParticipantMenu();
    selectedParticipantId = member.id;
    const allowed = getTaskCapabilities().canManageProjectMembers;
    participantMenu.innerHTML = allowed
      ? `<div role="menu" aria-label="参与者快捷操作"><button type="button" role="menuitem" data-member-remove><i data-lucide="trash-2" aria-hidden="true"></i>移出项目</button></div><p data-participant-menu-feedback role="status" aria-live="polite" hidden></p>`
      : `<p data-participant-menu-feedback role="status" aria-live="polite">只有当前负责人或获得“管理项目参与者”授权的成员可以操作</p>`;
    // Anchor to the avatar wrapper; absolute positioning leaves all cards fixed.
    trigger.parentElement.appendChild(participantMenu);
    participantMenu.hidden = false;
    alignParticipantMenu();
    trigger.setAttribute('aria-expanded', 'true');
    createIcons({ icons: { Trash2 }, root: participantMenu });
  });
  participantMenu?.addEventListener('click', async event => {
    const button = event.target.closest('[data-member-remove]');
    if (!button || button.disabled || !selectedParticipantId || participantRemovalBusy) return;
    event.stopPropagation();
    const member = projectMembers.find(item => item.id === selectedParticipantId);
    if (!member) return closeParticipantMenu();
    if (!getTaskCapabilities().canManageProjectMembers) return;
    button.disabled = true;
    participantRemovalBusy = true;
    const result = await apiRequest(`/api/projects/${encodeURIComponent(project.id)}/members/${encodeURIComponent(member.id)}`, { method: 'DELETE' }, store.apiToken);
    participantRemovalBusy = false;
    if (!host.isConnected) return;
    if (!result.response?.ok) {
      button.disabled = false;
      const feedback = participantMenu.querySelector('[data-participant-menu-feedback]');
      if (feedback) {
        feedback.textContent = result.body?.message || '移除失败，请重试';
        feedback.hidden = false;
        alignParticipantMenu();
      } else {
        showToast(result.body?.message || '移除失败，请重试');
      }
      return;
    }
    closeParticipantMenu();
    await refreshProjectMembers();
    await refreshTaskExecution();
    showToast('参与者已移出项目');
  });
  host.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !participantMenu || participantMenu.hidden) return;
    event.stopPropagation();
    event.preventDefault();
    if (!participantRemovalBusy) closeParticipantMenu(true);
  }, true);
  host.addEventListener('click', event => {
    if (!event.target.closest('[data-project-member-id],[data-participant-menu]') && !participantRemovalBusy) closeParticipantMenu();
  });
  host.querySelector('.task-detail-title').addEventListener('blur', event => { const title = event.target.value.trim(); if (!title) { event.target.value = detail.task.title; return showToast('任务名称不能为空'); } if (title !== detail.task.title) { if (!canSaveTaskField('title', title)) { event.target.value = detail.task.title; return showToast('只有当前负责人可以编辑此任务'); } saveFields({ title }); } });
  host.querySelectorAll('[data-task-feed]').forEach(button => button.onclick = () => { host.querySelectorAll('[data-task-feed]').forEach(item => item.classList.toggle('active', item === button)); host.querySelector('[data-task-feed-list]').innerHTML = feedMarkup(button.dataset.taskFeed); });
  host.querySelector('[data-task-comment]').onsubmit = async event => {
    event.preventDefault();
    if (!getTaskCapabilities().canComment) return showToast('当前账号无权评论此任务');
    const input = event.currentTarget.elements.body;
    const body = input.value.trim();
    // An attachment-only reply is valid. Upload queued files first, then
    // create a comment only when text was supplied.
    if (pendingTaskAttachments.length && !taskAttachmentUploading) await uploadTaskAttachments([...pendingTaskAttachments]);
    if (!body) {
      if (!pendingTaskAttachments.length) showToast('附件已上传');
      return;
    }
    const submit = event.currentTarget.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    const result = await apiRequest(taskCommentPath, { method: 'POST', body: JSON.stringify({ body }) }, store.apiToken);
    if (submit) submit.disabled = false;
    if (!result.response?.ok) return showToast(result.body.message || '评论发送失败');
    detail.comments.push(result.body.comment);
    input.value = '';
    syncCommentSendState();
    host.querySelector('[data-task-feed-list]').innerHTML = feedMarkup('all');
    host.querySelectorAll('[data-task-feed]').forEach(item => item.classList.toggle('active', item.dataset.taskFeed === 'all'));
  };
  const commentForm = host.querySelector('[data-task-comment]');
  const commentBodyInput = commentForm?.elements.body;
  const mentionBox = document.createElement('div');
  mentionBox.className = 'mention-suggestions'; mentionBox.hidden = true;
  commentBodyInput?.parentElement?.appendChild(mentionBox);
  commentBodyInput?.addEventListener('input', () => {
    const before = commentBodyInput.value.slice(0, commentBodyInput.selectionStart || 0), match = before.match(/(^|\s)@([^\s@]*)$/);
    if (!match) { mentionBox.hidden = true; return; }
    const query = match[2].toLowerCase();
    const items = uniqueParticipants(projectMembers.length ? projectMembers : participantMembers).filter(item => `${item.displayName || ''} ${item.username || ''}`.toLowerCase().includes(query));
    mentionBox.innerHTML = items.map(item => `<button type="button" data-mention-id="${esc(item.id)}"><span class="member-avatar small">${esc(String(item.displayName || item.username).slice(0,1))}</span><b>${esc(item.displayName || item.username)}</b><small>${esc(projectRoleLabel(item.projectRole))}</small></button>`).join('');
    mentionBox.hidden = !items.length;
    mentionBox.querySelectorAll('[data-mention-id]').forEach(button => button.onmousedown = event => { event.preventDefault(); const item = items.find(value => value.id === button.dataset.mentionId); const start = commentBodyInput.selectionStart - match[0].length + match[1].length; commentBodyInput.setRangeText(`@${item.displayName || item.username} `, start, commentBodyInput.selectionStart, 'end'); mentionBox.hidden = true; });
  });
  const commentSendButton = commentForm?.querySelector('.task-comment-send-button');
  syncCommentSendState = () => {
    const canComment = getTaskCapabilities().canComment;
    const canAttach = getTaskCapabilities().canManageAttachments;
    const ready = canComment && Boolean(String(commentBodyInput?.value || '').trim() || (canAttach && (pendingTaskAttachments.length || taskAttachmentUploading)));
    commentSendButton?.classList.toggle('is-ready', ready);
    if (commentSendButton) commentSendButton.disabled = !canComment;
  };
  commentBodyInput?.addEventListener('input', syncCommentSendState);
  host.querySelector('[data-task-comment] textarea').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.ctrlKey) { event.preventDefault(); host.querySelector('[data-task-comment]').requestSubmit(); } });
  syncCommentSendState();
  if (options.focusField) {
    window.setTimeout(() => {
      const field = [...host.querySelectorAll('[data-task-field]')].find(item => item.dataset.taskField === String(options.focusField));
      field?.focus();
    }, 0);
  }
  if (options.focusAssignee) window.setTimeout(() => host.querySelector('[data-assignee-trigger]')?.click(), 0);
  if (options.openSubtask) window.setTimeout(() => host.querySelector('[data-subtask-add]')?.click(), 0);
  if (options.viewSubtasks) window.setTimeout(() => host.querySelector('[data-task-subtasks-section]')?.scrollIntoView({ block: 'center' }), 0);
  options.onReady?.(host);
}

// Project cards open in a modal so the originating view remains intact underneath.
function openPartDialog(store, submit, defaults = {}) {
  document.querySelector('#partDialog')?.remove();
  const host = document.createElement('div');
  host.id = 'partDialog';
  host.className = 'project-dialog-backdrop';
  const projects = store.projects || [];
  const projectId = String(defaults.projectId || '');
  const format = String(defaults.format || 'STEP');
  const projectOptions = `<option value="">请选择</option>${projects.map(project => `<option value="${esc(project.id)}" ${project.id === projectId ? 'selected' : ''}>${esc(project.title)}</option>`).join('')}`;
  host.innerHTML = `<section class="project-dialog" role="dialog" aria-modal="true" aria-labelledby="partDialogTitle"><header><div><small>NEW PART</small><h2 id="partDialogTitle">新增零件</h2></div><button type="button" data-part-dialog-close aria-label="关闭">×</button></header><form><label>零件名称<input name="name" maxlength="160" placeholder="例如：转向节支架" required></label><label>归属项目<select name="projectId" required>${projectOptions}</select></label><div class="dialog-grid"><label>资料类型<select name="format"><option value="STEP" ${format === 'STEP' ? 'selected' : ''}>STEP</option><option value="STP" ${format === 'STP' ? 'selected' : ''}>STP</option><option value="IGES" ${format === 'IGES' ? 'selected' : ''}>IGES</option><option value="PDF" ${format === 'PDF' ? 'selected' : ''}>PDF</option></select></label><label>数量<input name="quantity" type="number" min="1" value="${Math.max(1, Number(defaults.quantity) || 1)}"></label></div><div class="dialog-grid"><label>材料<select name="material">${partSelectOptions(PART_MATERIAL_OPTIONS, defaults.material)}</select></label><label>表面处理<select name="finish">${partSelectOptions(PART_FINISH_OPTIONS, defaults.finish)}</select></label></div><footer><button type="button" class="outline-button" data-part-dialog-close>取消</button><button type="submit" class="primary-button">创建零件</button></footer></form></section>`;
  document.body.appendChild(host);
  const close = () => host.remove();
  host.querySelectorAll('[data-part-dialog-close]').forEach(button => button.addEventListener('click', close));
  host.addEventListener('click', event => { if (event.target === host) close(); });
  host.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('[type="submit"]');
    const payload = {
      name: String(form.get('name') || '').trim(),
      projectId: String(form.get('projectId') || ''),
      format: String(form.get('format') || 'STEP'),
      material: String(form.get('material') || '').trim(),
      finish: String(form.get('finish') || '').trim(),
      quantity: Math.max(1, Number(form.get('quantity') || 1))
    };
    button.disabled = true;
    try {
      if (await submit(payload)) close();
    } finally {
      button.disabled = false;
    }
  });
  host.querySelector('[name="name"]')?.focus();
}

function openEditPartDialog(store, part, submit) {
  const host = document.createElement('div');
  host.className = 'project-dialog-backdrop';
  const projects = store.projects || [];
  const projectOptions = projects.map(project => `<option value="${esc(project.id)}" ${project.id === part.projectId ? 'selected' : ''}>${esc(project.title)}</option>`).join('');
  host.innerHTML = `<section class="project-dialog" role="dialog" aria-modal="true"><header><div><small>EDIT PART</small><h2>编辑零件</h2></div><button type="button" data-close>×</button></header><form><label>零件名称<input name="name" value="${esc(part.name)}" required></label><label>所属项目<select name="projectId" required>${projectOptions}</select></label><label>格式<select name="format"><option value="STEP" ${part.format === 'STEP' ? 'selected' : ''}>STEP</option><option value="STP" ${part.format === 'STP' ? 'selected' : ''}>STP</option><option value="IGES" ${part.format === 'IGES' ? 'selected' : ''}>IGES</option><option value="PDF" ${part.format === 'PDF' ? 'selected' : ''}>PDF</option></select></label><label>材料<select name="material">${partSelectOptions(PART_MATERIAL_OPTIONS, part.material)}</select></label><label>表面处理<select name="finish">${partSelectOptions(PART_FINISH_OPTIONS, part.finish)}</select></label><label>尺寸<input name="dimensions" value="${esc(part.size || '')}"></label><label>体积<input name="volume" value="${esc(part.volume || '')}"></label><label>数量<input name="quantity" type="number" min="1" value="${Math.max(1, Number(part.quantity) || 1)}"></label><footer><button type="button" class="outline-button" data-close>取消</button><button type="submit" class="primary-button">保存</button></footer></form></section>`;
  document.body.appendChild(host);
  const close = () => host.remove();
  host.querySelectorAll('[data-close]').forEach(button => { button.onclick = close; });
  host.addEventListener('click', event => { if (event.target === host) close(); });
  host.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      if (await submit({
        name: String(data.get('name') || '').trim(),
        projectId: String(data.get('projectId') || ''),
        format: String(data.get('format') || 'STEP'),
        material: String(data.get('material') || '').trim(),
        finish: String(data.get('finish') || '').trim(),
        dimensions: String(data.get('dimensions') || '').trim(),
        volume: String(data.get('volume') || '').trim(),
        quantity: Math.max(1, Number(data.get('quantity') || 1))
      })) close();
    } finally {
      button.disabled = false;
    }
  };
  host.querySelector('[name="name"]')?.focus();
}

function openMembersDialog(store, options = {}) {
  if (!canManageOrganization(store)) return;
  return openOrganizationStructure(store, { ...options, apiRequest, showToast, onChanged: data => {
    store.members = data.members || store.members;
    document.querySelector('.organization-chart-view')?.dispatchEvent(new Event('organization-chart-refresh'));
  } });
}

function openQuoteDialog(store, submit, options = {}) {
  const project = store.projects.find(item => item.id === options.projectId) || store.projects[0];
  if (!project) return showToast('请先创建项目');
  const host = document.createElement('div'); host.className = 'project-dialog-backdrop';
  const parts = store.parts.filter(part => part.projectId === project.id).slice(0, 20);
  const existing = options.quoteId ? store.quotes.find(quote => quote.id === options.quoteId) : null; const existingLines = new Map((existing?.lines || []).map(line => [line.partId, line]));
  host.innerHTML = `<section class="project-dialog wide-dialog" role="dialog" aria-modal="true"><header><div><small>QUOTE / BOM</small><h2>${existing ? '编辑报价与 BOM' : '新建报价与 BOM'}</h2></div><button type="button" data-close>×</button></header><form><label>报价编号<input name="quoteNo" value="${esc(existing?.quoteNo || `QT-${new Date().toISOString().slice(0,10).replaceAll('-','')}-001`)}" required></label><div class="bom-editor">${parts.map((part, i) => { const line = existingLines.get(part.id); return `<div class="bom-row"><input name="name-${i}" value="${esc(line?.name || part.name)}"><input name="quantity-${i}" type="number" min="1" value="${line?.quantity || part.quantity || 1}"><input name="price-${i}" type="number" min="0" step="0.01" placeholder="单价 ¥" value="${line ? (line.unitPriceCents / 100).toFixed(2) : ''}"><input name="material-${i}" value="${esc(line?.material || part.material || '')}" placeholder="材料"></div>`; }).join('') || '<p class="muted-note">暂无零件，请先在零件中心添加。</p>'}</div><footer><button type="button" class="outline-button" data-close>取消</button><button type="submit" class="primary-button">保存报价草稿</button></footer></form></section>`;
  document.body.appendChild(host); const close = () => host.remove(); host.querySelectorAll('[data-close]').forEach(b => b.onclick = close); host.querySelector('form').onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); const lines = parts.map((part, i) => ({ partId: part.id, name: String(data.get(`name-${i}`) || part.name), quantity: Number(data.get(`quantity-${i}`) || 1), unitPriceCents: Math.round(Number(data.get(`price-${i}`) || 0) * 100), material: String(data.get(`material-${i}`) || ''), process: 'CNC' })); submit({ quoteId: existing?.id, quoteNo: data.get('quoteNo'), lines }); close(); };
}

function openFairDialog(store, submit, options = {}) {
  const projects = store.projects || [];
  const project = projects.find(item => item.id === options.projectId) || projects[0];
  if (!project) return showToast('请先创建项目');
  const host = document.createElement('div'); host.className = 'project-dialog-backdrop';
  const projectParts = (store.parts || []).filter(part => String(part.projectId) === String(project.id));
  const statusLabel = { pending: '待复核', pass: '合格', fail: '不合格' };
  const existing = (store.fairItems || []).filter(item => String(item.projectId) === String(project.id));
  const focusedId = String(options.itemId || options.focusItemId || '');
  host.innerHTML = `<section class="project-dialog fair-dialog" role="dialog" aria-modal="true"><header><div><small>FAIR / INSPECTION</small><h2>管理检验特性</h2><p class="muted-note">${esc(project.title)} · 项目检验记录</p></div><button type="button" data-close>×</button></header>${existing.length ? `<div class="fair-existing"><h3>已有检验项 <small>${existing.length}</small></h3>${existing.map(item => `<div class="fair-existing-row ${String(item.id) === focusedId ? 'is-focused' : ''}" data-fair-row="${esc(item.id)}"><div><b>${esc(item.characteristic)}</b><small>名义 ${esc(item.nominal || '—')} · 公差 ${esc(item.tolerance || '—')}</small></div><select data-fair-id="${esc(item.id)}"><option value="pending" ${item.status==='pending'?'selected':''}>待复核</option><option value="pass" ${item.status==='pass'?'selected':''}>合格</option><option value="fail" ${item.status==='fail'?'selected':''}>不合格</option></select></div>`).join('')}</div>` : ''}<form><h3>新增检验项</h3><label>检验特性<input name="characteristic" placeholder="例如：孔径" required></label><label>名义值<input name="nominal" placeholder="例如：Ø19"></label><label>公差<input name="tolerance" placeholder="例如：±0.2"></label><label>关联零件<select name="partId"><option value="">未关联</option>${projectParts.map(part => `<option value="${esc(part.id)}">${esc(part.name)}</option>`).join('')}</select></label><footer><button type="button" class="outline-button" data-close>取消</button><button type="submit" class="primary-button">保存检验项</button></footer></form></section>`;
  document.body.appendChild(host); const close = () => host.remove(); host.querySelectorAll('[data-close]').forEach(b => b.onclick = close); host.querySelector('form').onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); submit({ characteristic: data.get('characteristic'), nominal: data.get('nominal'), tolerance: data.get('tolerance'), partId: data.get('partId'), status: 'pending' }); close(); };
  host.querySelectorAll('[data-fair-id]').forEach(select => select.addEventListener('change', async event => { const item = store.fairItems.find(entry => entry.id === select.dataset.fairId); if (!item) return; const result = await apiRequest(`/api/projects/${encodeURIComponent(project.id)}/fair-items/${encodeURIComponent(item.id)}`, { method: 'PUT', body: JSON.stringify({ status: event.target.value }) }, store.apiToken); if (!result.response?.ok) return showToast(result.body.message || 'FAIR 状态更新失败'); Object.assign(item, result.body.item); showToast(`已更新为${statusLabel[item.status] || item.status}`); }));
}

async function apiRequest(path, options = {}, token = '') {
  if (location.pathname.startsWith('/mfggo/') && path.startsWith('/api/')) path = `/mfggo-api/${path.slice(5)}`;
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) };
  try {
    const response = await fetch(path, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  } catch (error) {
    return { response: null, body: { error: 'network_error', message: error.message } };
  }
}

function saveSession(store) {
  if (typeof sessionStorage === 'undefined') return;
  if (store.apiToken) sessionStorage.setItem('mfggo_saas_token', store.apiToken);
  else sessionStorage.removeItem('mfggo_saas_token');
}

/**
 * The cloud shell embeds a separate BOM application. It has no shared quote
 * selection state, so a related quote first opens a precise read-only summary
 * and offers an explicit hand-off to that application instead of silently
 * opening the first project's quote.
 */
function openRelatedQuoteDialog(quote, project, onOpenBom) {
  if (!quote?.id) return showToast('报价不存在或已无权访问');
  document.querySelector('#relatedQuoteDialog')?.remove();
  const host = document.createElement('div');
  host.id = 'relatedQuoteDialog';
  host.className = 'project-dialog-backdrop';
  const status = RELATED_STATUS_LABELS[quote.status] || quote.status || '草稿';
  const lines = Array.isArray(quote.lines) ? quote.lines : [];
  const lineMarkup = lines.length
    ? `<div class="related-quote-lines">${lines.map(line => `<div><span>${esc(line.name || '未命名明细')}</span><small>${Number(line.quantity || 0)} 件 · ${formatCents(line.unitPriceCents, quote.currency || 'CNY')} / 件</small><b>${formatCents(line.subtotalCents, quote.currency || 'CNY')}</b></div>`).join('')}</div>`
    : '<p class="muted-note">当前报价没有可展开的 BOM 明细。</p>';
  host.innerHTML = `<section class="project-dialog wide-dialog related-quote-dialog" role="dialog" aria-modal="true" aria-labelledby="relatedQuoteTitle"><header><div><small>PROJECT QUOTE</small><h2 id="relatedQuoteTitle">${esc(quote.quoteNo || '未命名报价')}</h2><p class="muted-note">${esc(project?.title || '当前项目')} · ${esc(status)}</p></div><button type="button" data-related-quote-close aria-label="关闭">×</button></header><div class="related-quote-summary"><div><span>报价状态</span><b>${esc(status)}</b></div><div><span>报价总额</span><b>${formatCents(quote.totalCents, quote.currency || 'CNY')}</b></div><div><span>BOM 明细</span><b>${lines.length} 项</b></div></div>${lineMarkup}<footer><button type="button" class="outline-button" data-related-quote-close>关闭</button><button type="button" class="primary-button" data-related-quote-bom>进入制表中心</button></footer></section>`;
  document.body.appendChild(host);
  const close = () => host.remove();
  host.querySelectorAll('[data-related-quote-close]').forEach(button => button.addEventListener('click', close));
  host.querySelector('[data-related-quote-bom]')?.addEventListener('click', () => { close(); onOpenBom?.(); });
  host.addEventListener('click', event => { if (event.target === host) close(); });
  host.querySelector('[data-related-quote-close]')?.focus();
}

function presentOfficeDocument(doc) {
  return { ...doc, scope: doc.scope === 'mine' ? '我的文档' : doc.scope === 'organization' ? '企业文档' : doc.scope || '共享给我', updated: new Date(doc.updatedAt).toLocaleString('zh-CN'), size: `${Math.max(1, Math.ceil(doc.sizeBytes / 1024))} KB`, permission: doc.permission === 'edit' ? '可编辑' : doc.permission || '只读' };
}

function mergeOfficeDocuments(documents) {
  const incoming = (documents || []).map(presentOfficeDocument);
  const ids = new Set(incoming.map(document => document.id));
  OFFICE_DOCUMENTS = [...incoming, ...OFFICE_DOCUMENTS.filter(document => !ids.has(document.id))];
}

async function hydrateProjects(store) {
  if (!store.apiToken) return false;
  if (store.consoleMode === 'platform') return true;
  const permittedRequest = (permission, path) => enterpriseCan(store, permission) ? apiRequest(path, {}, store.apiToken) : Promise.resolve({ body: {} });
  const [projectsResult, partsResult, membersResult, tasksResult, conversationsResult, statsResult] = await Promise.all([
    apiRequest('/api/projects', {}, store.apiToken),
    permittedRequest('part.read', '/api/parts'),
    apiRequest('/api/members', {}, store.apiToken),
    apiRequest('/api/tasks', {}, store.apiToken),
    apiRequest('/api/conversations', {}, store.apiToken),
    permittedRequest('stats.read', '/api/stats')
  ]);
  if (!projectsResult.response?.ok) return false;
  const documentsResult = await permittedRequest('document.read', '/api/documents');
  if (documentsResult.response?.ok) OFFICE_DOCUMENTS = (documentsResult.body.documents || []).map(presentOfficeDocument);
  store.projects = Array.isArray(projectsResult.body.projects) ? projectsResult.body.projects : [];
  store.modules = projectsResult.body.modules || store.modules;
  store.parts = partsResult.response?.ok && Array.isArray(partsResult.body.parts) ? partsResult.body.parts : [];
  store.members = membersResult.response?.ok && Array.isArray(membersResult.body.members) ? membersResult.body.members : [];
  store.tasks = tasksResult.response?.ok && Array.isArray(tasksResult.body.tasks)
    ? filterMyTasks(tasksResult.body.tasks, store.user?.id)
    : [];
  store.conversations = conversationsResult.response?.ok && Array.isArray(conversationsResult.body.conversations) ? conversationsResult.body.conversations : [];
  store.stats = statsResult.response?.ok ? statsResult.body.stats || null : null;
  store.messages = {};
  const initialProjectConversation = store.conversations.find(conversation => conversation.projectId);
  store.selectedChat = store.conversations[0]?.id || store.selectedChat;
  store.selectedCommunication = initialProjectConversation?.id || '';
  const initialConversationIds = [...new Set([store.conversations[0]?.id, initialProjectConversation?.id].filter(Boolean))];
  await Promise.all(initialConversationIds.map(async conversationId => {
    const messageResult = await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {}, store.apiToken);
    if (messageResult.response?.ok) store.messages[conversationId] = messageResult.body.messages || [];
  }));
  store.organization = projectsResult.body.organization || store.organization;
  // Related content is project-scoped. Hydrate every visible project so a
  // task opened from any card has the same parts/quotes/FAIR context.
  const projectIds = store.projects.map(project => project.id).filter(Boolean);
  const relatedResults = await Promise.all(projectIds.map(async projectId => {
    const [quotesResult, fairResult] = await Promise.all([
      permittedRequest('quote.read', `/api/projects/${encodeURIComponent(projectId)}/quotes`),
      permittedRequest('fair.read', `/api/projects/${encodeURIComponent(projectId)}/fair-items`)
    ]);
    return {
      quotes: quotesResult.response?.ok && Array.isArray(quotesResult.body.quotes) ? quotesResult.body.quotes : [],
      fairItems: fairResult.response?.ok && Array.isArray(fairResult.body.items) ? fairResult.body.items : []
    };
  }));
  store.quotes = relatedResults.flatMap(result => result.quotes);
  store.fairItems = relatedResults.flatMap(result => result.fairItems);
  return true;
}

function initCloudApp() {
  const loginView = document.querySelector('#loginView');
  const shellView = document.querySelector('#shellView');
  if (!loginView || !shellView) return;
  const store = createCloudStore();
  let disposeHistoryReport = () => {};
  let disposeOrganizationChart = () => {};
  store.platformUsers = [];
  let chatSyncTimer = null;
  let chatSyncInFlight = false;
  let chatSyncVersion = 0;
  let projectPopupVersion = 0;
  let storageRequestVersion = 0;
  let storagePreviewClose = null;
  let conversationInputComposing = false;
  let chatSyncRenderPending = false;
  let draggedTaskId = '';
  let draggedTaskCard = null;
  let draggedProjectId = '';
  let draggedProjectCard = null;
  let projectDragFinishedAt = 0;
  const releaseStoragePendingPreviews = () => {
    (store.storagePendingFiles || []).forEach(item => {
      if (item?.previewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(item.previewUrl);
    });
    store.storagePendingFiles = [];
  };
  const closeStoragePreview = () => {
    if (typeof storagePreviewClose === 'function') storagePreviewClose();
    storagePreviewClose = null;
  };
  const stopChatSync = () => {
    if (chatSyncTimer !== null) window.clearInterval(chatSyncTimer);
    chatSyncTimer = null;
    chatSyncInFlight = false;
    chatSyncVersion += 1;
  };
  const resetClientState = () => {
    disposeAutomation();
    closeProjectListEditor();
    closeTaskRecycleBin();
    closeOrganizationDialog();
    closeAccessDialog();
    disposeHistoryReport();
    disposeOrganizationChart();
    stopChatSync();
    store.authenticated = false;
    store.apiToken = '';
    store.user = null;
    store.organization = null;
    store.role = '';
    store.permissions = {};
    store.platformAdmin = false;
    store.platformRole = null;
    store.platformPermissions = {};
    store.grantablePermissions = {};
    store.query = '';
    store.currentView = pageMode === 'platform' ? 'platform-overview' : 'projects';
    store.projects = [];
    store.parts = [];
    store.tasks = [];
    store.conversations = [];
    store.messages = {};
    store.projectRelated = {};
    store.members = [];
    store.quotes = [];
    store.fairItems = [];
    store.stats = null;
    store.organizations = [];
    store.platformUsers = [];
    store.platformAudit = [];
    releaseStoragePendingPreviews();
    closeStoragePreview();
    store.storageFiles = [];
    store.storageScope = 'personal';
    store.storageProjectId = '';
    store.storageQuery = '';
    store.storageLoading = false;
    store.storageLoadedKey = '';
    store.workspaceFiles = [];
    store.pendingWorkspaceFiles = [];
    store.workspaceStarted = false;
    store.workspaceMode = '';
    store.workspaceStatus = '';
    store.workspaceStatusTone = '';
    store.bomProjectId = '';
    store.selectedChat = '';
    store.selectedCommunication = '';
    store.selectedPart = '';
    store.communicationDraft = '';
    store.communicationDraftAttachments = [];
    store.communicationUploading = false;
    store.communicationSending = false;
    store.chatDraft = '';
    store.chatDraftAttachments = [];
    store.chatUploading = false;
    store.chatSending = false;
    store.chatFilter = 'all';
    store.chatScope = 'all';
    store.chatQuery = '';
    conversationInputComposing = false;
    chatSyncRenderPending = false;
    OFFICE_DOCUMENTS = [];
    document.querySelectorAll('#projectDialog, #communicationDialog, #chatConversationDialog, #memberDialog, #partDialog, [data-task-detail-host]').forEach(node => node.remove());
    document.querySelectorAll('[data-task-due-dialog], [data-task-convert-dialog], [data-subtask-dialog]').forEach(node => node.remove());
  };
  const clearLegacyProjectTaskRoute = () => {
    if (!/^#\/projects\/[^/?#]+\/tasks(?:[/?#].*)?$/i.test(location.hash)) return;
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  };
  clearLegacyProjectTaskRoute();
  window.addEventListener('hashchange', clearLegacyProjectTaskRoute);
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.data?.type !== 'mfggo-enterprise-session' || !event.data.token) return;
    sessionStorage.setItem('mfggo_saas_token', event.data.token);
    window.location.reload();
  });
  const pageMode = document.body.dataset.consoleMode === 'platform' ? 'platform' : 'enterprise';
  store.consoleMode = pageMode;
  store.nav = (pageMode === 'platform' ? PLATFORM_NAV_ITEMS : NAV_ITEMS).map(item => ({ ...item }));
  store.currentView = pageMode === 'platform' ? 'platform-overview' : 'projects';
  const pageTitle = document.querySelector('#pageTitle');
  const content = document.querySelector('#cloudContent');
  const nav = document.querySelector('#cloudNav');
  const globalSearch = document.querySelector('#globalSearch');
  const userName = document.querySelector('#cloudUserName');
  const topUser = document.querySelector('.top-user');
  const updateUserIdentity = () => {
    const displayName = store.user?.displayName || store.user?.username || '未登录';
    const avatar = initials(displayName) || 'A';
    if (userName) userName.textContent = displayName;
    const sidebarAvatar = document.querySelector('.user-chip > span');
    if (sidebarAvatar) sidebarAvatar.textContent = avatar;
    if (topUser) {
      const avatarNode = topUser.querySelector('span');
      const nameNode = topUser.querySelector('b');
      if (avatarNode) avatarNode.textContent = avatar;
      if (nameNode) nameNode.textContent = displayName;
    }
  };
  const closeAccountMenu = () => document.querySelector('#accountMenu')?.remove();
  const openAccountMenu = () => {
    closeAccountMenu();
    const menu = document.createElement('div');
    menu.id = 'accountMenu';
    menu.className = 'account-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `<div class="account-menu-head"><span class="avatar blue">${esc(initials(store.user?.displayName || store.user?.username || 'A'))}</span><div><b>${esc(store.user?.displayName || store.user?.username || '未登录')}</b><small>@${esc(store.user?.username || '')} · ${esc(store.role || (store.consoleMode === 'platform' ? '平台管理员' : '成员'))}</small></div></div><div class="account-menu-context"><span>当前${store.consoleMode === 'platform' ? '平台' : '企业'}</span><b>${esc(store.organization?.name || '未选择企业')}</b></div><button type="button" data-account-action="logout">退出当前账号</button>`;
    document.body.appendChild(menu);
    const rect = topUser?.getBoundingClientRect();
    if (rect) { menu.style.top = `${rect.bottom + 8}px`; menu.style.right = `${Math.max(10, window.innerWidth - rect.right)}px`; }
    menu.querySelector('[data-account-action="logout"]')?.addEventListener('click', () => document.querySelector('#logoutButton')?.click());
    menu.querySelector('.account-menu-head small').textContent = `@${store.user?.username || ''} · ${(store.consoleMode === 'platform' ? PLATFORM_ROLE_LABELS[store.platformRole] : ENTERPRISE_ROLE_LABELS[store.role]) || '员工'}`;
    const commands = [
      { key: 'switch-organization', label: '切换企业', run: () => openOrganizationSwitchDialog(store, { apiRequest, showToast }) },
      ...(store.consoleMode === 'enterprise' ? [{ key: 'profile', label: '个人资料', run: () => openProfileDialog(store, { apiRequest, showToast, onChanged: () => { updateUserIdentity(); void hydrateProjects(store).then(() => renderShell()); } }) }] : []),
      ...(store.consoleMode === 'enterprise' && canManageOrganization(store) ? [{ key: 'organization', label: '组织架构', run: () => openMembersDialog(store) }] : []),
      ...(store.consoleMode === 'platform' && store.platformRole === 'owner' ? [{ key: 'platform-admins', label: '平台管理员', run: () => openPlatformAdministratorsDialog(store, { apiRequest, showToast }) }] : [])
    ];
    for (const command of commands) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.accountAction = command.key; button.textContent = command.label;
      button.onclick = () => { closeAccountMenu(); command.run(); };
      menu.insertBefore(button, menu.querySelector('[data-account-action="logout"]'));
    }
    window.setTimeout(() => {
      const dismiss = event => { if (!menu.contains(event.target) && event.target !== topUser) { closeAccountMenu(); document.removeEventListener('click', dismiss, true); } };
      document.addEventListener('click', dismiss, true);
    }, 0);
  };

  const renderNav = () => {
    const visibleNav = store.nav.filter(item => store.consoleMode === 'platform' ? platformViewAllowed(store, item.id) : enterpriseViewAllowed(store, item.id));
    const renderItem = item => `<button class="cloud-nav-item ${item.id===store.currentView?'active':''}" data-view="${item.id}" title="${esc(item.label)}" aria-label="${esc(item.label)}"><span class="nav-icon ${esc(item.iconClass || '')}" aria-hidden="true">${item.icon}</span><b>${item.label}</b></button>`;
    if (store.consoleMode === 'platform') {
      nav.innerHTML = visibleNav.map(renderItem).join('');
      return;
    }
    nav.innerHTML = visibleNav.map(renderItem).join('');
    createIcons({ icons: { Workflow }, root: nav });
  };
  let disposeCommunicationList = () => {};
  let disposeAutomation = () => {};
  const renderShell = () => {
    disposeAutomation();
    disposeCommunicationList();
    disposeHistoryReport();
    disposeOrganizationChart();
    const enterpriseMenu = document.querySelector('#enterpriseMenu');
    if (enterpriseMenu) enterpriseMenu.hidden = store.consoleMode !== 'platform' && !canManageOrganization(store);
    if (store.authenticated && !(store.consoleMode === 'platform' ? platformViewAllowed(store, store.currentView) : enterpriseViewAllowed(store, store.currentView))) {
      store.currentView = store.consoleMode === 'platform' ? 'platform-overview' : (store.nav.find(item => enterpriseViewAllowed(store, item.id))?.id || 'projects');
    }
    pageTitle.textContent = getViewTitle(store.currentView);
    globalSearch.disabled = store.currentView === 'automation';
    globalSearch.value = store.query;
    globalSearch.placeholder = store.currentView === 'projects' ? '搜索任务 / 项目 / 负责人' : `搜索${getViewTitle(store.currentView)}`;
    content.innerHTML = renderView(store);
    disposeAutomation = store.currentView === 'automation'
      ? mountAutomation(content, store, { apiRequest, showToast }) : () => {};
    disposeOrganizationChart = store.currentView === 'organization'
      ? mountOrganizationChart(content, store, { apiRequest, showToast, onManage: () => openMembersDialog(store), onEdit: memberId => openMembersDialog(store, { memberId }), onCreate: () => openMembersDialog(store, { createUnassigned: true }) })
      : () => {};
    disposeCommunicationList = store.currentView === 'communication'
      ? mountCommunicationList(content, store, { apiRequest, showToast })
      : () => {};
    createIcons({ icons: { Link, Copy, UserRound, CalendarDays, ListTodo, Plus, Workflow, Trash2, ArchiveRestore }, root: content });
    const enterpriseActions = { 'create-project': 'project.create', 'create-task': 'task.create', 'import-tasks': 'task.create', 'edit-project': 'project.write', 'edit-quote': 'quote.write', 'create-fair': 'fair.write' };
    for (const button of content.querySelectorAll('[data-action]')) {
      const permission = enterpriseActions[button.dataset.action];
      if (permission && !enterpriseCan(store, permission)) button.hidden = true;
    }
    if (!enterpriseCan(store, 'project.create')) content.querySelectorAll('[data-create-project-stage]').forEach(button => { button.hidden = true; });
    if (store.consoleMode === 'platform') {
      for (const button of content.querySelectorAll('[data-action]')) {
        const permission = ({ 'create-organization': 'organization.create', 'configure-organization': 'organization.modules.manage', 'enter-enterprise': 'organization.read' })[button.dataset.action];
        if (permission && !platformAllowed(store, permission)) button.remove();
      }
      if (!platformViewAllowed(store, 'organizations')) content.querySelector('[data-view-jump="organizations"]')?.remove();
      if (store.currentView === 'organizations') {
        for (const button of content.querySelectorAll('[data-action="enter-enterprise"]')) {
          const organization = store.organizations.find(item => item.id === button.dataset.organizationId);
          if (!organization?.canEnter) button.remove();
        }
        if (platformAllowed(store, 'organization.owner.manage')) {
          for (const row of content.querySelectorAll('tbody tr')) {
            const index = [...row.parentElement.children].indexOf(row), organization = store.organizations[index];
            if (!organization) continue;
            const button = document.createElement('button'); button.className = 'small-outline'; button.dataset.action = 'assign-enterprise-owner'; button.dataset.organizationId = organization.id; button.textContent = '任命主管理'; row.lastElementChild.appendChild(button);
          }
        }
      }
    }
    disposeHistoryReport = store.currentView === 'stats'
      ? mountTaskHistoryReport(content, store, { apiRequest, stages: PROJECT_COLUMNS })
      : () => {};
    renderNav();
    // Filters and conversation-state updates can select a different thread
    // while rendering. Load that thread here so the detail pane cannot remain
    // indefinitely at "正在加载消息...".
    if (store.currentView === 'chat' && store.selectedChat && !Object.prototype.hasOwnProperty.call(store.messages, store.selectedChat)) {
      void loadChatConversation(store.selectedChat);
    }
    if (store.currentView === 'communication' && store.selectedCommunication && !Object.prototype.hasOwnProperty.call(store.messages, store.selectedCommunication)) {
      void loadCommunicationThread(store.selectedCommunication);
    }
  };
  // Quick-action dialogs are defined outside the shell closure so they can be
  // reused by both project and standalone task cards. Expose the current
  // renderer only through this private store hook; it is never persisted.
  store.renderShell = renderShell;
  const addCreatedProject = project => {
    if (!project?.id) return;
    store.projects = [project, ...(store.projects || []).filter(item => item.id !== project.id)];
    // The project endpoint returns the canonical root-task id and executor,
    // but not a second task payload. Add a small authoritative-enough snapshot
    // immediately so the creator sees the new root in "我的任务" without a
    // full refresh; replace it with the detail response when available.
    if (project.rootTaskId && String(project.executorUserId || '') === String(store.user?.id || '')) {
      const rootTask = {
        id: project.rootTaskId,
        organizationId: store.organization?.id || '',
        projectId: project.id,
        title: project.title || '',
        description: project.description || '',
        customerProfile: '',
        customerManagement: '',
        projectList: '',
        stage: project.tag || '未分组',
        owner: project.owner || store.user?.displayName || '',
        assigneeUserId: project.executorUserId || store.user?.id || '',
        progress: Number(project.progress) || 0,
        status: project.status || project.stage || '立项沟通',
        priority: project.priority || '普通',
        startAt: project.startAt || '',
        dueAt: project.dueAt || ''
      };
      store.tasks = [rootTask, ...(store.tasks || []).filter(item => item.id !== rootTask.id)];
      void apiRequest(`/api/tasks/${encodeURIComponent(rootTask.id)}/detail`, {}, store.apiToken).then(result => {
        if (!result.response?.ok || !result.body?.task) return;
        const latest = result.body.task;
        store.tasks = [latest, ...(store.tasks || []).filter(item => item.id !== latest.id)];
      });
    }
    renderShell();
  };
  const updateWorkspaceStatus = (message, tone = '') => {
    store.workspaceStatus = message || '';
    store.workspaceStatusTone = tone || '';
    const status = content.querySelector('[data-workspace-status]');
    if (!status) return;
    status.textContent = store.workspaceStatus;
    status.classList.toggle('is-processing', tone === 'processing');
    status.classList.toggle('is-success', tone === 'success');
    status.classList.toggle('is-error', tone === 'error');
  };
  window.addEventListener('message', async event => {
    const frame = content.querySelector('.embedded-workspace-frame');
    if (event.origin !== window.location.origin || !frame || event.source !== frame.contentWindow) return;
    const message = event.data || {};
    if (message.type === 'mfggo-workspace-ready') {
      const projectId = store.bomProjectId || '';
      frame.contentWindow.postMessage({ type: 'mfggo-workspace-context', projectId, background: store.workspaceMode === 'background', project: store.projects?.find(p => String(p.id) === String(projectId)) || null, parts: store.parts?.filter(p => String(p.projectId) === String(projectId)), fairItems: store.fairItems?.filter(p => String(p.projectId) === String(projectId)), quotes: store.quotes?.filter(p => String(p.projectId) === String(projectId)) }, event.origin);
      if (store.pendingWorkspaceFiles?.length) {
        frame.contentWindow.postMessage({ type: 'mfggo-workspace-open-files', files: store.pendingWorkspaceFiles }, event.origin);
        store.pendingWorkspaceFiles = [];
      }
      return;
    }
    if (message.type === 'mfggo-workspace-progress') {
      updateWorkspaceStatus(message.message || '正在生成项目清单', message.tone || 'processing');
      if (message.tone === 'error') {
        store.pendingWorkspaceFiles = [];
        store.workspaceStarted = false;
        store.workspaceMode = '';
        content.innerHTML = renderWorkspace(store);
      }
      return;
    }
    if (message.type !== 'mfggo-workspace-save') return;
    const backgroundSync = store.workspaceStarted && store.workspaceMode === 'background';
    const projectId = String(message.projectId || store.bomProjectId || '');
    if (!projectId || projectId !== String(store.bomProjectId || '') || !store.apiToken) return frame.contentWindow.postMessage({ type: 'mfggo-workspace-save-result', ok: false, message: '当前没有明确选定的导入项目' }, event.origin);
    const importToken = store.apiToken;
    const importActive = () => store.apiToken === importToken && frame.isConnected;
    try {
      const parts = Array.isArray(message.parts) ? message.parts : [];
      const apiBody = (result, fallback) => {
        if (!result.response?.ok) throw new Error(result.body?.message || fallback);
        return result.body || {};
      };
      let savedParts = [];
      const fairItems = (Array.isArray(message.fairItems) ? message.fairItems : []).filter(item => item.characteristic).map(item => ({ characteristic: item.characteristic, nominal: item.nominal || '', tolerance: item.tolerance || '', partId: item.partId || null, status: item.status || 'pending' }));
      if (parts.length) {
        const payload = {
          parts: parts.filter(item => item?.name).map(part => ({
            clientId: String(part.clientId || ''), partId: part.partId || null, name: part.name,
            format: part.format || String(part.name).split('.').pop()?.toUpperCase() || 'STEP',
            material: part.material || '', finish: part.finish || '', dimensions: part.dimensions || '',
            volume: String(part.volume || ''), quantity: Math.max(1, Math.round(Number(part.quantity) || 1)),
            revision: String(part.revision || ''), notes: String(part.notes || ''), process: part.process || '',
            unitPriceCents: Math.round(Number(part.unitPrice || 0) * 100)
          })),
          quoteMeta: { quoteNo: message.quoteMeta?.quoteNo || `QT-${Date.now()}`, currency: message.quoteMeta?.currency || 'CNY' },
          fairItems
        };
        const imported = apiBody(await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/lists/import`, {
          method: 'POST', body: JSON.stringify(payload)
        }, importToken), '项目清单导入失败');
        if (!importActive()) return;
        savedParts = imported.parts.map(part => ({ clientId: part.clientId, partId: part.id, name: part.name }));
      } else for (const item of fairItems) {
        if (!importActive()) return;
        const result = await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/fair-items`, { method: 'POST', body: JSON.stringify({ characteristic: item.characteristic, nominal: item.nominal, tolerance: item.tolerance, partId: item.partId || null, status: item.status || 'pending' }) }, importToken);
        apiBody(result, 'FAIR 检验项同步失败');
      }
      if (!importActive()) return;
      const related = await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/related`, {}, importToken);
      if (!importActive()) return;
      if (related.response?.ok) mergeProjectSnapshot(projectId, related.body);
      const successMessage = !related.response?.ok ? '数据已保存，关联内容刷新失败，请刷新页面'
        : parts.length ? `已生成 ${savedParts.length} 项 BOM，并关联到项目任务` : 'FAIR 已同步到项目任务';
      frame.contentWindow.postMessage({ type: 'mfggo-workspace-save-result', ok: true, message: successMessage, parts: savedParts.map(item => ({ clientId: item.clientId, partId: item.partId, name: item.name })) }, event.origin);
      showToast(successMessage);
      if (backgroundSync) {
        store.workspaceFiles = [];
        store.pendingWorkspaceFiles = [];
        store.workspaceStarted = false;
        store.workspaceMode = '';
        store.workspaceStatus = successMessage;
        store.workspaceStatusTone = 'success';
        window.setTimeout(() => {
          if (store.currentView === 'workspace' && !store.workspaceStarted) content.innerHTML = renderWorkspace(store);
        }, 0);
      }
    } catch (error) {
      if (!importActive()) return;
      frame.contentWindow.postMessage({ type: 'mfggo-workspace-save-result', ok: false, message: error.message || '同步失败' }, event.origin);
      showToast(error.message || '项目清单同步失败');
      if (backgroundSync) {
        store.pendingWorkspaceFiles = [];
        store.workspaceStarted = false;
        store.workspaceMode = '';
        store.workspaceStatus = error.message || '项目清单同步失败';
        store.workspaceStatusTone = 'error';
        window.setTimeout(() => {
          if (store.currentView === 'workspace' && !store.workspaceStarted) content.innerHTML = renderWorkspace(store);
        }, 0);
      }
    }
  });
  const queueWorkspaceFiles = fileList => {
    if (store.workspaceStarted && store.workspaceMode === 'background') return;
    const allowed = /\.(?:step|stp|igs|iges|brep|pdf|zip)$/i;
    const incoming = [...(fileList || [])];
    const accepted = incoming.filter(file => allowed.test(file.name) && file.size <= 50 * 1024 * 1024);
    const rejected = incoming.length - accepted.length;
    const existing = new Set((store.workspaceFiles || []).map(file => `${file.name}\u0000${file.size}\u0000${file.lastModified}`));
    store.workspaceFiles = [...(store.workspaceFiles || []), ...accepted.filter(file => {
      const key = `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    })];
    store.workspaceStatus = '';
    store.workspaceStatusTone = '';
    content.innerHTML = renderWorkspace(store);
    if (rejected) showToast('已忽略不支持或超过 50MB 的文件');
  };
  content.addEventListener('dragover', event => {
    const dropzone = event.target.closest('[data-workspace-dropzone]');
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.add('dragging');
  });
  content.addEventListener('dragleave', event => {
    const dropzone = event.target.closest('[data-workspace-dropzone]');
    if (dropzone && !dropzone.contains(event.relatedTarget)) dropzone.classList.remove('dragging');
  });
  content.addEventListener('drop', event => {
    const dropzone = event.target.closest('[data-workspace-dropzone]');
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.remove('dragging');
    queueWorkspaceFiles(event.dataTransfer?.files);
  });
  const storageApiBase = () => location.pathname.startsWith('/mfggo/') ? '/mfggo-api' : '/api';
  const storageFileKey = file => `${String(file?.name || '')}\u0000${Number(file?.size || file?.sizeBytes || 0)}\u0000${Number(file?.lastModified || 0)}`;
  const isStorageImage = file => /^image\//i.test(String(file?.type || '')) || /\.(?:jpe?g|png|gif|webp|bmp|avif|heic|tiff?)$/i.test(String(file?.name || ''));
  const storageFileExtension = fileName => {
    const name = String(fileName || '');
    const dot = name.lastIndexOf('.');
    return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
  };
  const loadStorageFiles = async ({ force = false } = {}) => {
    if (!store.apiToken || store.consoleMode !== 'enterprise') return;
    const scope = store.storageScope === 'enterprise' ? 'enterprise' : 'personal';
    const projectId = scope === 'enterprise' ? String(store.storageProjectId || '') : '';
    const key = `${scope}:${projectId}`;
    if (!force && store.storageLoadedKey === key && Array.isArray(store.storageFiles)) return;
    const requestVersion = ++storageRequestVersion;
    const token = store.apiToken;
    store.storageLoading = true;
    if (store.currentView === 'files') renderShell();
    const params = new URLSearchParams({ scope });
    if (projectId) params.set('projectId', projectId);
    const result = await apiRequest(`/api/storage/files?${params.toString()}`, {}, token);
    if (requestVersion !== storageRequestVersion || token !== store.apiToken) return;
    store.storageLoading = false;
    if (!result.response?.ok) {
      store.storageFiles = [];
      store.storageLoadedKey = '';
      if (store.currentView === 'files') renderShell();
      return showToast(result.body.message || '文件空间加载失败');
    }
    store.storageFiles = Array.isArray(result.body.files) ? result.body.files : [];
    store.storageLoadedKey = key;
    if (store.currentView === 'files') renderShell();
  };
  const queueStorageFiles = files => {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) return;
    const scope = store.storageScope === 'enterprise' ? 'enterprise' : 'personal';
    const projectId = scope === 'enterprise' ? String(store.storageProjectId || '') : '';
    const existingKeys = new Set([
      ...(store.storageFiles || []).map(storageFileKey),
      ...(store.storagePendingFiles || []).map(item => storageFileKey(item.file))
    ]);
    const rejected = [];
    for (const file of selectedFiles) {
      const name = String(file?.name || '未命名文件');
      const sizeBytes = Number(file?.size || 0);
      const key = storageFileKey(file);
      if (!sizeBytes) { rejected.push(`${name} 是空文件`); continue; }
      if (sizeBytes > STORAGE_FILE_MAX_BYTES) { rejected.push(`${name} 超过 50MB 限制`); continue; }
      if (existingKeys.has(key)) { rejected.push(`${name} 已在文件列表中`); continue; }
      existingKeys.add(key);
      const extension = storageFileExtension(name);
      const previewUrl = isStorageImage(file) && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '';
      store.storagePendingFiles.push({ id: `storage-pending-${Date.now()}-${Math.random().toString(36).slice(2)}`, file, name, sizeBytes, extension, scope, projectId, previewUrl });
    }
    const input = content.querySelector('[data-storage-file-input]');
    if (input) input.value = '';
    renderShell();
    if (rejected.length) showToast(rejected.slice(0, 3).join('；'));
  };
  const removeStoragePendingFile = pendingId => {
    const pending = (store.storagePendingFiles || []).find(item => item.id === pendingId);
    if (!pending) return;
    if (pending.previewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(pending.previewUrl);
    store.storagePendingFiles = (store.storagePendingFiles || []).filter(item => item.id !== pendingId);
    renderShell();
  };
  const clearStoragePendingFiles = () => {
    releaseStoragePendingPreviews();
    renderShell();
  };
  const uploadStorageFiles = async pendingItems => {
    if (store.storageUploading) return;
    const selected = Array.from(pendingItems || []).filter(item => (store.storagePendingFiles || []).some(pending => pending.id === item?.id));
    if (!selected.length) return;
    const token = store.apiToken;
    store.storageUploading = true;
    renderShell();
    const failed = [];
    for (const pending of selected) {
      const file = pending.file;
      if (!file) continue;
      try {
        const headers = {
          authorization: `Bearer ${token}`,
          'content-type': file.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(pending.name),
          'x-file-scope': pending.scope,
          'x-file-mime-type': file.type || 'application/octet-stream'
        };
        if (pending.projectId) headers['x-project-id'] = pending.projectId;
        const response = await fetch(`${storageApiBase()}/storage/files`, { method: 'POST', headers, body: file });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || '文件上传失败');
        if (body.file) store.storageFiles = [body.file, ...(store.storageFiles || [])];
        store.storagePendingFiles = (store.storagePendingFiles || []).filter(item => item.id !== pending.id);
        if (pending.previewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(pending.previewUrl);
        renderShell();
      } catch (error) {
        failed.push(`${pending.name}：${error?.message || '文件上传失败'}`);
      }
    }
    store.storageUploading = false;
    store.storageLoadedKey = '';
    renderShell();
    if (failed.length) showToast(failed.slice(0, 3).join('；'));
    else if (selected.length) showToast(`已上传 ${selected.length} 个文件`);
    void loadStorageFiles({ force: true });
  };
  const downloadStorageFile = async file => {
    if (!file?.id) return;
    try {
      const response = await fetch(`${storageApiBase()}/storage/files/${encodeURIComponent(file.id)}/download`, { headers: { authorization: `Bearer ${store.apiToken}` } });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || '文件下载失败'); }
      const blob = await response.blob();
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error('当前浏览器不支持文件下载');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = file.name || 'file'; link.style.display = 'none';
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) { showToast(error?.message || '文件下载失败'); }
  };
  const openStorageFilePreview = async file => {
    if (!file?.id) return;
    closeStoragePreview();
    const host = document.createElement('div');
    host.id = 'storagePreviewDialog'; host.className = 'project-dialog-backdrop storage-preview-backdrop';
    host.innerHTML = `<section class="project-dialog storage-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="storagePreviewTitle"><header><div><small>FILE PREVIEW</small><h2 id="storagePreviewTitle">${esc(file.name)}</h2><p class="muted-note">${esc(STORAGE_SCOPE_LABELS[file.scope] || '文件空间')} · ${esc(formatFileSize(file.sizeBytes))}</p></div><button type="button" data-storage-preview-close aria-label="关闭">×</button></header><div class="storage-preview-body"><span class="storage-preview-loading">正在准备预览…</span></div><footer><button type="button" class="outline-button" data-storage-preview-close>关闭</button><button type="button" class="primary-button" data-storage-preview-download>下载文件</button></footer></section>`;
    document.body.appendChild(host);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let closed = false;
    let previewUrl = '';
    const close = () => {
      if (closed) return;
      closed = true;
      controller?.abort();
      if (previewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previewUrl);
      host.remove();
      if (storagePreviewClose === close) storagePreviewClose = null;
    };
    storagePreviewClose = close;
    host.querySelectorAll('[data-storage-preview-close]').forEach(button => button.addEventListener('click', close));
    host.addEventListener('click', event => { if (event.target === host) close(); });
    host.querySelector('[data-storage-preview-download]')?.addEventListener('click', () => downloadStorageFile(file));
    const body = host.querySelector('.storage-preview-body');
    const kind = String(file.previewKind || '').toLowerCase();
    if (!['image', 'pdf', 'text', 'video', 'audio'].includes(kind)) {
      body.innerHTML = `<div class="storage-preview-unavailable"><span class="storage-file-icon kind-${esc(kind || 'file')}">${esc(storageFileIcon(file))}</span><b>此文件类型暂不支持在线预览</b><p>可以下载文件后使用本机 CAD 或办公软件打开。</p></div>`;
      return;
    }
    if (kind === 'text' && Number(file.sizeBytes || 0) > 1024 * 1024) {
      body.innerHTML = '<div class="storage-preview-unavailable"><b>文本过大，无法在线预览</b><p>超过 1MB 的文本文件请下载后查看。</p></div>';
      return;
    }
    try {
      const response = await fetch(`${storageApiBase()}/storage/files/${encodeURIComponent(file.id)}/preview`, {
        headers: { authorization: `Bearer ${store.apiToken}` },
        ...(controller ? { signal: controller.signal } : {})
      });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.message || '预览加载失败'); }
      const blob = await response.blob();
      if (closed) return;
      if (kind === 'text') {
        const text = await blob.text();
        if (!closed) body.innerHTML = `<pre class="storage-preview-text">${esc(text)}</pre>`;
        return;
      }
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error('当前浏览器不支持预览');
      previewUrl = URL.createObjectURL(blob);
      if (closed) { URL.revokeObjectURL(previewUrl); previewUrl = ''; return; }
      if (kind === 'image') body.innerHTML = `<img class="storage-preview-image" src="${esc(previewUrl)}" alt="${esc(file.name)}">`;
      else if (kind === 'pdf') body.innerHTML = `<iframe class="storage-preview-frame" src="${esc(previewUrl)}" title="${esc(file.name)}"></iframe>`;
      else if (kind === 'video') body.innerHTML = `<video class="storage-preview-media" src="${esc(previewUrl)}" controls></video>`;
      else body.innerHTML = `<audio class="storage-preview-audio" src="${esc(previewUrl)}" controls></audio>`;
    } catch (error) { if (!closed && error?.name !== 'AbortError') body.innerHTML = `<div class="storage-preview-unavailable"><b>预览失败</b><p>${esc(error?.message || '请下载后查看')}</p></div>`; }
  };
  const deleteStorageFile = async file => {
    if (!file?.id || !window.confirm(`确定删除“${file.name}”吗？`)) return;
    const result = await apiRequest(`/api/storage/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' }, store.apiToken);
    if (!result.response?.ok) return showToast(result.body.message || '文件删除失败');
    store.storageFiles = (store.storageFiles || []).filter(item => item.id !== file.id);
    store.storageLoadedKey = '';
    renderShell();
    showToast('文件已删除');
  };
  const preserveCommunicationDraft = () => {
    const input = content.querySelector('#communicationInput');
    if (input) store.communicationDraft = input.value;
  };
  const hasPendingCommunicationCompose = () => Boolean((store.communicationDraft || '').trim() || (store.communicationDraftAttachments || []).length || store.communicationUploading || store.communicationSending);
  const loadCommunicationContext = async (conversationId = store.selectedCommunication) => {
    const conversation = store.conversations.find(item => item.id === conversationId);
    const project = store.projects.find(item => item.id === conversation?.projectId);
    if (!project) {
      if (conversation?.projectId) store.communicationContext = { ...(store.communicationContext || {}), [conversation.projectId]: { token: store.apiToken, error: '关联项目不可用或无权访问' } };
      if (store.currentView === 'communication' && store.selectedCommunication === conversationId) renderSyncedConversation();
      return;
    }
    const token = store.apiToken;
    const requestId = Symbol();
    store.communicationContextRequests = { ...(store.communicationContextRequests || {}), [project.id]: requestId };
    const [related, detail, members] = await Promise.all([
      apiRequest(`/api/projects/${encodeURIComponent(project.id)}/related`, {}, token),
      project.rootTaskId ? apiRequest(`/api/tasks/${encodeURIComponent(project.rootTaskId)}/detail`, {}, token) : Promise.resolve({}),
      apiRequest(`/api/projects/${encodeURIComponent(project.id)}/members`, {}, token)
    ]);
    if (token !== store.apiToken || store.communicationContextRequests?.[project.id] !== requestId) return;
    store.communicationContext = { ...(store.communicationContext || {}), [project.id]: {
      token,
      related: related.response?.ok ? related.body : null,
      detail: detail.response?.ok ? detail.body : null,
      members: members.response?.ok ? members.body.members || [] : [],
      error: !related.response?.ok || !detail.response?.ok ? '项目数据暂不可用或无权访问' : ''
    } };
    if (store.currentView === 'communication' && store.selectedCommunication === conversationId) {
      const scrollTop = content.querySelector('[data-communication-thread]')?.scrollTop || 0;
      renderSyncedConversation();
      content.querySelector('[data-communication-thread]')?.scrollTo({ top: scrollTop });
    }
  };
  const loadCommunicationThread = async conversationId => {
    if (content.querySelector('[data-communication-lite]')) return;
    if (!conversationId) return;
    const requestToken = store.apiToken;
    if (['unread', 'mentions'].includes(store.communicationFilter)) store.communicationReadSelection = { id: conversationId, filter: store.communicationFilter, token: requestToken };
    await loadCommunicationContext(conversationId);
    if (requestToken !== store.apiToken || store.selectedCommunication !== conversationId || store.currentView !== 'communication') return;
    const conversation = store.conversations.find(item => item.id === conversationId);
    if (Object.prototype.hasOwnProperty.call(store.messages, conversationId)) {
      if (conversation?.unreadCount || conversation?.mentionCount) {
        const stateResult = await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/state`, { method: 'PUT', body: JSON.stringify({ read: true }) }, store.apiToken);
        if (stateResult.response?.ok) Object.assign(conversation, { unreadCount: 0, mentionCount: 0 });
      }
      return;
    }
    const requestConversationId = conversationId;
    store.messages[conversationId] = null;
    if (store.currentView === 'communication') renderShell();
    const result = await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/messages?markRead=true`, {}, store.apiToken);
    const loadedMessages = result.response?.ok ? result.body.messages || [] : [];
    const inFlightMessages = Array.isArray(store.messages[conversationId]) ? store.messages[conversationId] : [];
    store.messages[conversationId] = mergeConversationMessages(inFlightMessages, loadedMessages);
    if (result.response?.ok && conversation) Object.assign(conversation, { unreadCount: 0, mentionCount: 0 });
    if (!result.response?.ok) showToast(result.body.message || '沟通消息加载失败');
    if (store.currentView === 'communication' && store.selectedCommunication === requestConversationId) {
      renderShell();
      content.querySelector('[data-communication-thread]')?.scrollTo({ top: 0 });
    }
  };
  const openCommunicationThread = async (conversationId, { syncProjectFilter = false } = {}) => {
    preserveCommunicationDraft();
    if (conversationId !== store.selectedCommunication && hasPendingCommunicationCompose()) {
      showToast('当前项目沟通有未发送内容或附件，请发送或移除后再切换话题');
      return;
    }
    const targetConversation = store.conversations.find(item => item.id === conversationId);
    store.communicationFilter = 'all';
    store.communicationReadSelection = null;
    // A related-content hand-off must make its project scope visible. Leaving
    // a previous project filter active would select a thread that is hidden
    // from the list and make it look as if the conversation disappeared.
    if (syncProjectFilter && targetConversation?.projectId) store.communicationProject = targetConversation.projectId;
    store.currentView = 'communication';
    store.selectedCommunication = conversationId;
    renderShell();
    await loadCommunicationThread(conversationId);
  };
  const createCommunication = async payload => {
    if (!payload.projectId || !payload.title || !payload.body) return showToast('请完整填写项目、主题和第一条消息');
    const conversationResult = await apiRequest('/api/conversations', { method: 'POST', body: JSON.stringify({ projectId: payload.projectId, title: payload.title }) }, store.apiToken);
    if (!conversationResult.response?.ok) return showToast(conversationResult.body.message || '项目沟通创建失败');
    const conversation = conversationResult.body.conversation;
    const messageResult = await apiRequest(`/api/conversations/${encodeURIComponent(conversation.id)}/messages`, { method: 'POST', body: JSON.stringify({ body: payload.body }) }, store.apiToken);
    if (!messageResult.response?.ok) return showToast(messageResult.body.message || '主题已创建，但第一条消息发送失败');
    const project = store.projects.find(item => item.id === payload.projectId);
    const message = messageResult.body.message;
    Object.assign(conversation, { projectTitle: project?.title || conversation.projectTitle || '', preview: message.body, lastSender: message.displayName || message.username || store.user?.displayName || '', lastMessageAt: message.createdAt, messageCount: 1 });
    store.conversations = [conversation, ...store.conversations.filter(item => item.id !== conversation.id)];
    store.messages[conversation.id] = [message];
    store.communicationProject = '';
    await openCommunicationThread(conversation.id);
    showToast('项目沟通已发起');
  };
  const sendCommunicationMessage = async () => {
    if (store.communicationSending || store.communicationUploading) return;
    const input = content.querySelector('#communicationInput');
    store.communicationDraft = input?.value || store.communicationDraft || '';
    const body = store.communicationDraft.trim();
    const attachmentIds = (store.communicationDraftAttachments || []).map(attachment => attachment.id);
    const conversation = store.conversations.find(item => item.id === store.selectedCommunication && item.projectId);
    if ((!body && !attachmentIds.length) || !conversation) return;
    const incompatibleAttachment = (store.communicationDraftAttachments || []).find(attachment => attachment.pendingConversationId !== conversation.id);
    if (incompatibleAttachment) return showToast('附件与当前项目沟通不匹配，请移除后重新添加');
    store.communicationSending = true;
    renderShell();
    const result = await apiRequest(`/api/conversations/${encodeURIComponent(conversation.id)}/messages`, { method: 'POST', body: JSON.stringify({ body, attachmentIds }) }, store.apiToken);
    store.communicationSending = false;
    if (!result.response?.ok) {
      renderShell();
      content.querySelector('#communicationInput')?.focus();
      return showToast(result.body.message || '回复发送失败');
    }
    const message = result.body.message;
    store.messages[conversation.id] = [...(store.messages[conversation.id] || []), message];
    Object.assign(conversation, { preview: body || `[附件] ${message.attachments?.[0]?.name || ''}`, lastSender: message.displayName || message.username || store.user?.displayName || '', lastMessageAt: message.createdAt, messageCount: Number(conversation.messageCount || 0) + 1, unreadCount: 0, mentionCount: 0 });
    store.conversations = [conversation, ...store.conversations.filter(item => item.id !== conversation.id)];
    store.communicationDraft = '';
    store.communicationDraftAttachments = [];
    renderShell();
    const thread = content.querySelector('[data-communication-thread]');
    thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
    content.querySelector('#communicationInput')?.focus();
  };
  const uploadCommunicationAttachments = async files => {
    if (store.communicationUploading || store.communicationSending) return;
    const conversation = store.conversations.find(item => item.id === store.selectedCommunication && item.projectId);
    if (!conversation) return showToast('请先选择项目沟通后再添加附件');
    const availableSlots = 5 - (store.communicationDraftAttachments || []).length;
    const selectedFiles = Array.from(files || []).slice(0, Math.max(0, availableSlots));
    if (!selectedFiles.length) return showToast(availableSlots ? '请选择附件' : '每条消息最多添加 5 个附件');
    if (files.length > availableSlots) showToast(`本次只添加前 ${availableSlots} 个附件`);
    const conversationId = conversation.id;
    const apiBase = location.pathname.startsWith('/mfggo/') ? '/mfggo-api' : '/api';
    let failedMessage = '';
    store.communicationUploading = true;
    renderShell();
    for (const file of selectedFiles) {
      try {
        const response = await fetch(`${apiBase}/chat-attachments`, { method: 'POST', headers: { authorization: `Bearer ${store.apiToken}`, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), 'x-conversation-id': conversationId }, body: file });
        const attachmentResult = await response.json();
        if (!response.ok) throw new Error(attachmentResult.message || '附件上传失败');
        store.communicationDraftAttachments.push(attachmentResult.attachment);
      } catch (uploadError) {
        failedMessage = uploadError.message;
      }
    }
    store.communicationUploading = false;
    renderShell();
    content.querySelector('#communicationInput')?.focus();
    if (failedMessage) showToast(failedMessage);
  };
  const removeCommunicationAttachment = async attachmentId => {
    const attachment = store.communicationDraftAttachments.find(item => item.id === attachmentId);
    if (!attachment) return;
    const result = await apiRequest(`/api/chat-attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' }, store.apiToken);
    if (!result.response?.ok) return showToast(result.body.message || '附件移除失败');
    store.communicationDraftAttachments = store.communicationDraftAttachments.filter(item => item.id !== attachmentId);
    renderShell();
    content.querySelector('#communicationInput')?.focus();
  };
  const loadChatConversation = async conversationId => {
    const conversation = store.conversations.find(item => item.id === conversationId);
    if (!conversation) return;
    store.selectedChat = conversationId;
    const requestConversationId = conversationId;
    if (!Object.prototype.hasOwnProperty.call(store.messages, conversationId)) {
      store.messages[conversationId] = null;
      if (store.currentView === 'chat') renderShell();
      const messageResult = await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/messages?markRead=true`, {}, store.apiToken);
      const loadedMessages = messageResult.response?.ok ? messageResult.body.messages || [] : [];
      // A user can send while the first history request is still in flight.
      // Keep a just-sent local result when that older response arrives later,
      // rather than overwriting the visible thread with stale history.
      const inFlightMessages = Array.isArray(store.messages[conversationId]) ? store.messages[conversationId] : [];
      const mergedMessages = new Map(loadedMessages.map(message => [message.id, message]));
      inFlightMessages.forEach(message => { if (!mergedMessages.has(message.id)) mergedMessages.set(message.id, message); });
      store.messages[conversationId] = [...mergedMessages.values()].sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')) || String(left.id || '').localeCompare(String(right.id || '')));
      if (!messageResult.response?.ok) showToast(messageResult.body.message || '聊天消息加载失败');
    }
    if (conversation.unreadCount || conversation.mentionCount) {
      const stateResult = await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/state`, { method: 'PUT', body: JSON.stringify({ read: true }) }, store.apiToken);
      if (stateResult.response?.ok) Object.assign(conversation, { unreadCount: 0, mentionCount: 0 });
    }
    if (store.currentView === 'chat' && store.selectedChat === requestConversationId) {
      renderShell();
      const messages = content.querySelector('[data-chat-messages]');
      messages?.scrollTo({ top: messages.scrollHeight });
    }
  };
  const uploadChatAttachments = async files => {
    const availableSlots = 5 - (store.chatDraftAttachments || []).length;
    const selectedFiles = Array.from(files || []).slice(0, Math.max(0, availableSlots));
    if (!selectedFiles.length) return showToast(availableSlots ? '请选择附件' : '每条消息最多添加 5 个附件');
    if (files.length > availableSlots) showToast(`本次只添加前 ${availableSlots} 个附件`);
    store.chatUploading = true;
    renderShell();
    const apiBase = location.pathname.startsWith('/mfggo/') ? '/mfggo-api' : '/api';
    let failedMessage = '';
    for (const file of selectedFiles) {
      try {
        const conversationId = store.selectedChat || '';
        const response = await fetch(`${apiBase}/chat-attachments`, { method: 'POST', headers: { authorization: `Bearer ${store.apiToken}`, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), ...(conversationId ? { 'x-conversation-id': conversationId } : {}) }, body: file });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || '附件上传失败');
        store.chatDraftAttachments.push(body.attachment);
      } catch (uploadError) {
        failedMessage = uploadError.message;
      }
    }
    store.chatUploading = false;
    renderShell();
    content.querySelector('#chatInput')?.focus();
    if (failedMessage) showToast(failedMessage);
  };
  const removeChatAttachment = async attachmentId => {
    const attachment = store.chatDraftAttachments.find(item => item.id === attachmentId);
    if (!attachment) return;
    const result = await apiRequest(`/api/chat-attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' }, store.apiToken);
    if (!result.response?.ok) return showToast(result.body.message || '附件移除失败');
    store.chatDraftAttachments = store.chatDraftAttachments.filter(item => item.id !== attachmentId);
    renderShell();
    content.querySelector('#chatInput')?.focus();
  };
  const createEnterpriseConversation = async title => {
    if (!store.apiToken) {
      showToast('SaaS 服务未连接，请重新登录后再创建企业频道');
      return false;
    }
    const result = await apiRequest('/api/conversations', { method: 'POST', body: JSON.stringify({ title }) }, store.apiToken);
    if (!result.response?.ok) {
      showToast(result.body.message || '企业频道创建失败');
      return false;
    }
    const conversation = { unreadCount: 0, mentionCount: 0, savedForLater: false, ...result.body.conversation };
    store.conversations = [conversation, ...store.conversations.filter(item => item.id !== conversation.id)];
    delete store.messages[conversation.id];
    store.chatFilter = 'all';
    store.chatScope = 'enterprise';
    store.chatQuery = '';
    store.selectedChat = conversation.id;
    renderShell();
    showToast('企业频道已创建');
    return true;
  };
  const sendChatMessage = async () => {
    if (store.chatSending || store.chatUploading) return;
    const input = content.querySelector('#chatInput');
    store.chatDraft = input?.value || store.chatDraft || '';
    const body = store.chatDraft.trim();
    const attachmentIds = (store.chatDraftAttachments || []).map(item => item.id);
    if (!body && !attachmentIds.length) return;
    const selectedConversation = store.conversations.find(item => item.id === store.selectedChat);
    if (!selectedConversation) {
      openChatConversationDialog(createEnterpriseConversation);
      return;
    }
    const incompatibleAttachment = (store.chatDraftAttachments || []).find(attachment => attachment.pendingConversationId
      ? attachment.pendingConversationId !== selectedConversation?.id
      : Boolean(selectedConversation?.projectId));
    if (incompatibleAttachment) return showToast('附件与当前会话不匹配，请移除后重新添加');
    store.chatSending = true;
    renderShell();
    const conversation = selectedConversation;
    const result = await apiRequest(`/api/conversations/${encodeURIComponent(conversation.id)}/messages`, { method: 'POST', body: JSON.stringify({ body, attachmentIds }) }, store.apiToken);
    store.chatSending = false;
    if (!result.response?.ok) {
      renderShell();
      content.querySelector('#chatInput')?.focus();
      return showToast(result.body.message || '消息发送失败');
    }
    const message = { ...result.body.message, mine: true };
    store.messages[conversation.id] = [...(store.messages[conversation.id] || []), message];
    Object.assign(conversation, {
      preview: body || `[附件] ${message.attachments?.[0]?.name || ''}`,
      lastSender: message.displayName || message.username || store.user?.displayName || '',
      lastMessageAt: message.createdAt,
      messageCount: Number(conversation.messageCount || 0) + 1,
      unreadCount: 0,
      mentionCount: 0
    });
    store.conversations = [conversation, ...store.conversations.filter(item => item.id !== conversation.id)];
    store.chatDraft = '';
    store.chatDraftAttachments = [];
    renderShell();
    const messages = content.querySelector('[data-chat-messages]');
    messages?.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
    content.querySelector('#chatInput')?.focus();
  };
  const canAutoSyncChats = () => store.authenticated && store.consoleMode === 'enterprise' && Boolean(store.apiToken) && document.visibilityState === 'visible';
  const captureConversationInput = () => {
    const chatInput = content.querySelector('#chatInput');
    const communicationInput = content.querySelector('#communicationInput');
    if (chatInput) store.chatDraft = chatInput.value;
    if (communicationInput) store.communicationDraft = communicationInput.value;
    const active = document.activeElement;
    const selector = active?.matches('#chatInput') ? '#chatInput'
      : active?.matches('#communicationInput') ? '#communicationInput'
        : active?.matches('[data-chat-search]') ? '[data-chat-search]'
          : active?.matches('[data-communication-search]') ? '[data-communication-search]' : '';
    return selector ? { selector, start: active.selectionStart, end: active.selectionEnd } : null;
  };
  const restoreConversationInput = state => {
    if (!state) return;
    const input = content.querySelector(state.selector);
    if (!input) return;
    input.focus();
    if (typeof input.setSelectionRange === 'function' && Number.isInteger(state.start) && Number.isInteger(state.end)) input.setSelectionRange(state.start, state.end);
  };
  const renderSyncedConversation = () => {
    if (store.currentView === 'communication' && content.querySelector('[data-communication-lite]')) return;
    if (store.currentView !== 'chat' && store.currentView !== 'communication') return;
    const inputState = captureConversationInput();
    renderShell();
    restoreConversationInput(inputState);
  };
  const conversationListChanged = incoming => {
    const current = store.conversations || [];
    if (current.length !== incoming.length || current.some((conversation, index) => conversation.id !== incoming[index]?.id)) return true;
    const fields = ['title', 'projectId', 'projectTitle', 'preview', 'lastSender', 'lastMessageAt', 'messageCount', 'unreadCount', 'mentionCount', 'savedForLater'];
    return incoming.some(next => {
      const previous = current.find(conversation => conversation.id === next.id);
      return !previous || fields.some(field => previous[field] !== next[field]);
    });
  };
  const mergeConversationSummaries = incoming => {
    const currentById = new Map((store.conversations || []).map(conversation => [conversation.id, conversation]));
    const incomingIds = new Set(incoming.map(conversation => conversation.id));
    const merged = incoming.map(summary => {
      const current = currentById.get(summary.id);
      if (!current) return summary;
      // A poll can return while a local send is still being committed. Keep
      // that newer local summary until the server has caught up.
      Object.assign(current, hasLaterConversationMessage(summary, current) ? { ...summary, ...current } : summary);
      current.unreadCount = Number(summary.unreadCount || 0);
      current.mentionCount = Number(summary.mentionCount || 0);
      if (typeof summary.savedForLater === 'boolean') current.savedForLater = summary.savedForLater;
      return current;
    });
    // Do not drop a just-created local channel because an earlier poll
    // response was already in flight when the create request completed.
    (store.conversations || []).forEach(conversation => { if (!incomingIds.has(conversation.id)) merged.push(conversation); });
    store.conversations = merged;
  };
  const syncVisibleConversationMessages = async (conversationId, token) => {
    const result = await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/messages?markRead=true`, {}, token);
    if (!result.response?.ok || token !== store.apiToken || !canAutoSyncChats()) return false;
    const currentMessages = Array.isArray(store.messages[conversationId]) ? store.messages[conversationId] : [];
    store.messages[conversationId] = mergeConversationMessages(currentMessages, result.body.messages || []);
    const conversation = store.conversations.find(item => item.id === conversationId);
    if (conversation) Object.assign(conversation, { unreadCount: 0, mentionCount: 0 });
    return true;
  };
  const syncChatConversations = async () => {
    if (!canAutoSyncChats() || chatSyncInFlight) return;
    const syncVersion = chatSyncVersion;
    const token = store.apiToken;
    chatSyncInFlight = true;
    try {
      const result = await apiRequest('/api/conversations', {}, token);
      if (!result.response?.ok || !Array.isArray(result.body.conversations) || syncVersion !== chatSyncVersion || token !== store.apiToken || !canAutoSyncChats()) return;
      const incoming = result.body.conversations;
      const activeConversationId = store.currentView === 'chat' ? store.selectedChat : store.currentView === 'communication' ? store.selectedCommunication : '';
      const previous = activeConversationId ? store.conversations.find(conversation => conversation.id === activeConversationId) : null;
      const activeSummary = activeConversationId ? incoming.find(conversation => conversation.id === activeConversationId) : null;
      const shouldRefreshThread = Boolean(activeConversationId && activeSummary && conversationHasNewMessages(previous, activeSummary));
      const listChanged = conversationListChanged(incoming);
      mergeConversationSummaries(incoming);
      const refreshedThread = shouldRefreshThread ? await syncVisibleConversationMessages(activeConversationId, token) : false;
      if (syncVersion !== chatSyncVersion || token !== store.apiToken || !canAutoSyncChats()) return;
      if ((listChanged || refreshedThread) && (store.currentView === 'chat' || store.currentView === 'communication')) {
        // Project communication currently disables its composer while posting;
        // defer a repaint so that operation cannot be re-enabled mid-request.
        if (conversationInputComposing || content.querySelector('#communicationInput')?.disabled) {
          chatSyncRenderPending = true;
          return;
        }
        renderSyncedConversation();
      }
    } catch {
      // Polling is opportunistic: a temporary network failure must not affect
      // the user's current draft or other in-flight actions.
    } finally {
      if (syncVersion === chatSyncVersion) chatSyncInFlight = false;
    }
  };
  const startChatSync = () => {
    stopChatSync();
    if (!canAutoSyncChats()) return;
    chatSyncTimer = window.setInterval(() => { void syncChatConversations(); }, CHAT_SYNC_INTERVAL_MS);
  };
  const mergeProjectSnapshot = (projectId, related) => {
    const id = String(projectId || '');
    if (!id || !related) return;
    const merge = (key, incoming) => {
      if (!Array.isArray(incoming)) return;
      const other = (store[key] || []).filter(item => String(item?.projectId || '') !== id);
      store[key] = [...incoming, ...other];
    };
    merge('parts', related.parts);
    merge('quotes', related.quotes);
    merge('fairItems', related.fairItems);
    merge('conversations', related.conversations);
    if (Array.isArray(related.documents)) {
      // Replace this project's document slice as well as adding the fresh
      // records. Otherwise a permission/module change could leave an old
      // document visible in the global document center.
      const incomingIds = new Set(related.documents.map(document => String(document?.id || '')));
      OFFICE_DOCUMENTS = (OFFICE_DOCUMENTS || []).filter(document => String(document?.projectId || '') !== id || incomingIds.has(String(document?.id || '')));
      mergeOfficeDocuments(related.documents);
    }
    store.projectRelated = { ...(store.projectRelated || {}), [id]: { ...related, projectId: id } };
  };
  const openOfficeDocument = documentId => {
    const doc = (OFFICE_DOCUMENTS || []).find(item => String(item.id) === String(documentId));
    if (!doc) return showToast('文档不存在或已无权访问');
    const apiBase = location.pathname.startsWith('/mfggo/') ? '/mfggo-api' : '/api';
    store.currentView = 'workspace';
    renderShell();
    content.innerHTML = `<section class="view office-editor-view"><iframe class="onlyoffice-frame" src="./onlyoffice.html?embedded=1&configUrl=${apiBase}/documents/${encodeURIComponent(doc.id)}/config&apiToken=${encodeURIComponent(store.apiToken)}" title="${esc(doc.title)}"></iframe></section>`;
  };
  const openRelatedContent = async resource => {
    const projectId = String(resource?.projectId || '');
    const project = (store.projects || []).find(item => String(item.id) === projectId);
    if (!project || !resource?.id) throw new Error('关联项目不存在');
    if (resource.kind === 'file') {
      const file = (store.storageFiles || []).find(item => String(item.id) === String(resource.id)) || resource.record;
      if (!file) throw new Error('关联文件不存在或已无权访问');
      await openStorageFilePreview(file);
      return;
    }
    if (resource.kind === 'part') {
      const part = (store.parts || []).find(item => String(item.id) === String(resource.id) && String(item.projectId) === projectId);
      if (!part) throw new Error('零件不存在或已无权访问');
      store.selectedPart = part.id;
      store.currentView = 'parts';
      renderShell();
      return;
    }
    if (resource.kind === 'communication') {
      const conversation = (store.conversations || []).find(item => String(item.id) === String(resource.id) && String(item.projectId) === projectId);
      if (!conversation) throw new Error('项目沟通不存在或已无权访问');
      await openCommunicationThread(conversation.id, { syncProjectFilter: true });
      return;
    }
    if (resource.kind === 'document') {
      const document = (OFFICE_DOCUMENTS || []).find(item => String(item.id) === String(resource.id) && String(item.projectId) === projectId);
      if (!document) throw new Error('文档不存在或已无权访问');
      openOfficeDocument(document.id);
      return;
    }
    if (resource.kind === 'quote') {
      const quote = (store.quotes || []).find(item => String(item.id) === String(resource.id) && String(item.projectId) === projectId) || resource.record;
      openRelatedQuoteDialog(quote, project, () => { store.bomProjectId = projectId; store.workspaceStarted = false; store.workspaceMode = ''; store.workspaceStatus = ''; store.workspaceStatusTone = ''; store.currentView = 'workspace'; renderShell(); });
      return;
    }
    if (resource.kind === 'fair') {
      const item = (store.fairItems || []).find(entry => String(entry.id) === String(resource.id) && String(entry.projectId) === projectId) || resource.record;
      if (!item) throw new Error('FAIR 检验项不存在或已无权访问');
      if (item.partId) {
        const part = (store.parts || []).find(entry => String(entry.id) === String(item.partId) && String(entry.projectId) === projectId);
        if (part) store.selectedPart = part.id;
      }
      store.currentView = 'parts';
      renderShell();
      openFairDialog(store, payload => {
        apiRequest(`/api/projects/${encodeURIComponent(projectId)}/fair-items`, { method: 'POST', body: JSON.stringify(payload) }, store.apiToken).then(result => {
          if (!result.response?.ok) return showToast(result.body.message || 'FAIR 保存失败');
          store.fairItems = [result.body.item, ...(store.fairItems || []).filter(entry => entry.id !== result.body.item.id)];
          mergeProjectSnapshot(projectId, { ...(store.projectRelated?.[projectId] || {}), fairItems: (store.projectRelated?.[projectId]?.fairItems || []).filter(entry => entry.id !== result.body.item.id).concat(result.body.item) });
          showToast('FAIR 检验项已保存');
        });
      }, { projectId, itemId: item.id });
      return;
    }
    throw new Error('不支持的关联内容');
  };
  const openProjectCardPopup = async (projectId, { beforeOpen, trail = [] } = {}) => {
    const requestVersion = ++projectPopupVersion;
    const token = store.apiToken;
    let selected = store.projects.find(project => project.id === projectId);
    if (!selected) {
      const result = await apiRequest('/api/projects', {}, token);
      if (requestVersion !== projectPopupVersion || token !== store.apiToken) return null;
      if (result.response?.ok) {
        store.projects = result.body.projects || [];
        selected = store.projects.find(project => project.id === projectId);
      }
    }
    if (!selected) return showToast('项目不存在或已无权访问');
    if (!selected.rootTaskId) return showToast('该项目尚未生成任务，请刷新后重试');
    const [detailResult, membersResult] = await Promise.all([
      apiRequest(`/api/tasks/${encodeURIComponent(selected.rootTaskId)}/detail`, {}, store.apiToken),
      apiRequest(`/api/projects/${encodeURIComponent(selected.id)}/members`, {}, store.apiToken)
    ]);
    if (requestVersion !== projectPopupVersion || token !== store.apiToken) return null;
    if (!detailResult.response?.ok) return showToast(detailResult.body.message || '任务详情加载失败');
    if (typeof beforeOpen === 'function' && await beforeOpen() === false) return null;
    if (requestVersion !== projectPopupVersion || token !== store.apiToken) return null;
    // Keep the original project-card close contract explicit for integrations:
    // openTaskDetail(store, detailResult.body, { onClose: () => renderShell() })
    return openTaskDetail(store, detailResult.body, {
      projectMembers: membersResult.response?.ok && Array.isArray(membersResult.body?.members) ? membersResult.body.members : [],
      onOpenProject: (id, closeCurrent) => openProjectCardPopup(id, { beforeOpen: closeCurrent, trail: [...trail, { id: selected.id, title: selected.title }] }),
      returnProjectTitle: trail.at(-1)?.title,
      onReturnProject: closeCurrent => trail.length ? openProjectCardPopup(trail.at(-1).id, { beforeOpen: closeCurrent, trail: trail.slice(0, -1) }) : null,
      onClose: () => renderShell()
    });
  };
  // “我的任务”是一个汇总入口。项目任务必须回到项目管理上下文，
  // 再打开同一个根任务详情，避免用户在两个页面看到两套编辑状态。
  const openMyTask = async (taskId, projectId = '') => {
    const task = (store.tasks || []).find(item => String(item.id) === String(taskId));
    if (!task) return showToast('任务不存在或已无权访问');
    const project = (store.projects || []).find(item => String(item.id) === String(projectId || task.projectId || '')
      || String(item.rootTaskId || '') === String(taskId));
    // Claimed project roots open in the project board; a claimed standalone
    // task stays in this work queue and opens its own detail modal.
    store.currentView = project ? 'projects' : 'tasks';
    renderShell();
    if (project) return openProjectCardPopup(project.id);
    const result = await apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/detail`, {}, store.apiToken);
    if (!result.response?.ok || !result.body?.task) return showToast(result.body?.message || '任务详情加载失败');
    return openTaskDetail(store, result.body, { onClose: () => renderShell() });
  };
  const clearTaskShortcutMenuPosition = menu => {
    if (!menu) return;
    const floatingCard = menu._taskShortcutFloatingCard;
    if (floatingCard) {
      if (menu._taskShortcutCardTransform) floatingCard.style.transform = menu._taskShortcutCardTransform;
      else floatingCard.style.removeProperty('transform');
      delete menu._taskShortcutFloatingCard;
      delete menu._taskShortcutCardTransform;
    }
    menu.style.position = '';
    menu.style.top = '';
    menu.style.right = '';
    menu.style.bottom = '';
    menu.style.left = '';
    menu.style.zIndex = '';
    menu.style.visibility = '';
    menu.removeAttribute('data-floating');
  };
  const positionTaskShortcutMenu = (trigger, menu) => {
    if (!trigger || !menu) return;
    if (typeof menu.showPopover === 'function' && !menu.matches(':popover-open')) menu.showPopover();
    const anchor = trigger.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
    const top = anchor.bottom + 6 + height <= window.innerHeight - 8
      ? anchor.bottom + 6 : Math.max(8, anchor.top - height - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    menu.setAttribute('data-floating', 'true');
    menu.style.visibility = 'visible';
  };
  const repositionTaskShortcutMenus = () => {
    content.querySelectorAll('[data-task-shortcuts-menu]:not([hidden])').forEach(menu => {
      const trigger = menu.closest('[data-project-card],[data-task-card]')?.querySelector('[data-task-shortcuts-trigger]');
      positionTaskShortcutMenu(trigger, menu);
    });
  };
  const closeTaskShortcutMenus = except => {
    content.querySelectorAll('[data-task-shortcuts-menu]').forEach(menu => {
      if (menu === except) return;
      if (typeof menu.hidePopover === 'function' && menu.matches(':popover-open')) menu.hidePopover();
      menu.hidden = true;
      clearTaskShortcutMenuPosition(menu);
      const trigger = menu.closest('[data-project-card],[data-task-card]')?.querySelector('[data-task-shortcuts-trigger]');
      trigger?.setAttribute('aria-expanded', 'false');
    });
  };
  const loadTaskShortcutDetail = async taskId => {
    if (!taskId) return null;
    const result = await apiRequest(`/api/tasks/${encodeURIComponent(taskId)}/detail`, {}, store.apiToken);
    if (!result.response?.ok || !result.body?.task) {
      showToast(result.body?.message || '任务详情加载失败');
      return null;
    }
    return result.body;
  };
  const openTaskShortcutDetail = async (taskId, options = {}) => {
    const project = (store.projects || []).find(item => String(item.rootTaskId) === String(taskId));
    if (project && !options.focusField && !options.focusAssignee && !options.openSubtask && !options.viewSubtasks) {
      return openProjectCardPopup(project.id);
    }
    const detail = await loadTaskShortcutDetail(taskId);
    if (!detail) return null;
    let projectMembers = [];
    if (project) {
      const membersResult = await apiRequest(`/api/projects/${encodeURIComponent(project.id)}/members`, {}, store.apiToken);
      projectMembers = membersResult.response?.ok && Array.isArray(membersResult.body?.members) ? membersResult.body.members : [];
    }
    return openTaskDetail(store, detail, {
      projectMembers,
      onOpenProject: (id, closeCurrent) => openProjectCardPopup(id, { beforeOpen: closeCurrent, trail: project ? [{ id: project.id, title: project.title }] : [] }),
      onClose: () => renderShell(),
      ...options
    });
  };
  const canCurrentUserChangeTaskStatus = task => Boolean(task?.id && deriveTaskCapabilities(store, { task }).canChangeStatus);
  const canCurrentUserMoveProject = project => Boolean(project?.rootTaskId && canCurrentUserExecuteProject(store, project));
  const loadPlatformData = async () => {
    const token = store.apiToken;
    const requests = [
      ['organization.read', '/api/platform/organizations', 'organizations', 'organizations'],
      ['user.read', '/api/platform/users', 'platformUsers', 'users'],
      ['audit.read', '/api/platform/audit', 'platformAudit', 'events']
    ];
    await Promise.all(requests.map(async ([permission, path, key, field]) => {
      const result = platformAllowed(store, permission) ? await apiRequest(path, {}, token) : null;
      if (store.apiToken !== token || store.consoleMode !== 'platform') return;
      store[key] = result?.response?.ok ? result.body[field] || [] : [];
    }));
    if (store.apiToken === token && store.consoleMode === 'platform') renderShell();
  };
  let accessRefreshBusy = false;
  const refreshAccess = async () => {
    if (!store.authenticated || !store.apiToken || accessRefreshBusy || document.hidden) return;
    accessRefreshBusy = true;
    const token = store.apiToken;
    try {
      const result = await apiRequest('/api/me', {}, token);
      if (store.apiToken !== token || !result.response?.ok) return;
      const keys = ['role', 'permissions', 'grantablePermissions', 'platformRole', 'platformPermissions', 'modules', 'user'];
      const changed = keys.some(key => JSON.stringify(store[key]) !== JSON.stringify(result.body[key]));
      if (!changed) return;
      for (const key of keys) store[key] = result.body[key];
      store.platformAdmin = Boolean(result.body.platformAdmin);
      closeOrganizationDialog(); closeAccessDialog(); closeTaskRecycleBin(); closeProjectListEditor(); closeAccountMenu();
      document.querySelectorAll('[data-task-detail-host], #memberDialog').forEach(node => node.remove());
      if (store.consoleMode === 'platform' && !store.platformAdmin) {
        resetClientState(); saveSession(store);
        shellView.classList.add('hidden'); loginView.classList.remove('hidden');
        return;
      }
      updateUserIdentity();
      if (store.consoleMode === 'platform') await loadPlatformData();
      else { await hydrateProjects(store); renderShell(); }
    } finally { accessRefreshBusy = false; }
  };
  window.addEventListener('focus', () => { void refreshAccess(); });
  window.setInterval(() => { void refreshAccess(); }, 15000);
  const switchConsole = mode => {
    if (mode === 'enterprise' && store.consoleMode === 'platform' && document.body.dataset.consoleMode === 'platform') {
      // A platform session is still scoped to the current organization. Let
      // the enterprise page hydrate from that token instead of merely
      // swapping nav state and rendering an empty platform store.
      window.location.assign('enterprise.html');
      return;
    }
    store.consoleMode = mode;
    store.nav = (mode === 'platform' ? PLATFORM_NAV_ITEMS : NAV_ITEMS).map(item => ({ ...item }));
    store.currentView = mode === 'platform' ? 'platform-overview' : (store.modules.projects !== false ? 'projects' : (store.nav.find(item => store.modules[item.id] !== false)?.id || 'projects'));
    document.querySelectorAll('[data-console]').forEach(button => button.classList.toggle('active', button.dataset.console === mode));
    renderShell();
    if (mode === 'enterprise') startChatSync();
    else stopChatSync();
    if (mode === 'platform' && store.apiToken) {
      void loadPlatformData();
    }
  };
  const showShell = () => {
    store.authenticated = true;
    if (store.consoleMode !== 'platform') {
      const allowedViews = store.nav.filter(item => enterpriseViewAllowed(store, item.id));
      if (!allowedViews.some(item => item.id === store.currentView)) store.currentView = allowedViews[0]?.id || 'projects';
    }
    loginView.classList.add('hidden');
    shellView.classList.remove('hidden');
    updateUserIdentity();
    const enterpriseMenu = document.querySelector('#enterpriseMenu');
    if (enterpriseMenu) enterpriseMenu.textContent = `${store.organization?.name || '企业管理'}⌄`;
    renderShell();
    startChatSync();
    if (store.consoleMode === 'platform' && store.apiToken && store.platformAdmin) {
      void loadPlatformData();
    }
  };

  const restoreSession = async () => {
    const token = typeof sessionStorage === 'undefined' ? '' : sessionStorage.getItem('mfggo_saas_token') || '';
    if (!token) return;
    store.apiToken = token;
    const meResult = await apiRequest('/api/me', {}, token);
    if (!meResult.response?.ok) {
      store.apiToken = '';
      saveSession(store);
      return;
    }
    store.user = meResult.body.user || null;
    store.role = meResult.body.role || '';
    store.permissions = meResult.body.permissions || {};
    store.organization = meResult.body.organization || null;
    store.platformAdmin = Boolean(meResult.body.platformAdmin);
    store.platformRole = meResult.body.platformRole || null;
    store.platformPermissions = meResult.body.platformPermissions || {};
    store.grantablePermissions = meResult.body.grantablePermissions || {};
    if (pageMode === 'platform' && !store.platformAdmin) {
      resetClientState();
      saveSession(store);
      return;
    }
    store.modules = meResult.body.modules || store.modules;
    store.communicationDraft = '';
    store.communicationDraftAttachments = [];
    store.communicationUploading = false;
    store.communicationSending = false;
    store.chatDraft = '';
    store.chatDraftAttachments = [];
    store.messages = {};
    store.projectRelated = {};
    OFFICE_DOCUMENTS = [];
    const hydrated = await hydrateProjects(store);
    if (hydrated) {
      showShell();
    }
  };

  document.querySelector('#loginForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const username = document.querySelector('#loginUser').value.trim();
    const password = document.querySelector('#loginPassword').value;
    const error = document.querySelector('#loginError');
    const loginButton = event.currentTarget.querySelector('button[type="submit"]');
    loginButton.disabled = true;
    const result = await apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    if (result.response?.ok) {
      store.apiToken = result.body.token || '';
      store.communicationDraft = '';
      store.communicationDraftAttachments = [];
      store.communicationUploading = false;
      store.communicationSending = false;
      store.chatDraft = '';
      store.chatDraftAttachments = [];
      store.messages = {};
      OFFICE_DOCUMENTS = [];
      store.user = result.body.user || { displayName: username };
      store.role = result.body.role || '';
      store.permissions = result.body.permissions || {};
      store.organization = result.body.organization || null;
      store.platformAdmin = Boolean(result.body.platformAdmin);
      store.platformRole = result.body.platformRole || null;
      store.platformPermissions = result.body.platformPermissions || {};
      store.grantablePermissions = result.body.grantablePermissions || {};
      store.modules = result.body.modules || store.modules;
      if (pageMode === 'platform' && !store.platformAdmin) {
        resetClientState();
        saveSession(store);
        error.textContent = '当前账号没有平台管理权限，请使用平台管理员账号登录';
        error.classList.add('show');
        loginButton.disabled = false;
        return;
      }
      saveSession(store);
      const hydrated = await hydrateProjects(store);
      if (!hydrated) {
        resetClientState();
        saveSession(store);
        error.textContent = '登录成功，但企业数据暂时无法加载，请检查服务后重试';
        error.classList.add('show');
        loginButton.disabled = false;
        return;
      }
      error.classList.remove('show');
      showShell();
      loginButton.disabled = false;
      return;
    }
    if (result.response?.status === 401 || !username || !password) {
      error.textContent = result.body.message || '账号或密码不正确';
      error.classList.add('show');
      loginButton.disabled = false;
      return;
    }
    error.textContent = result.body.message || 'SaaS 服务暂不可用，请确认后端已启动';
    error.classList.add('show');
    loginButton.disabled = false;
  });

  nav.addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    if (button.dataset.view === 'workspace' && store.currentView === 'workspace' && store.workspaceStarted) return;
    // Invalidate an in-flight project-card request before changing the host
    // view. Otherwise a slow detail/related response can resurrect the task
    // modal over the module the user just selected.
    projectPopupVersion += 1;
    if (button.dataset.view !== 'workspace') {
      store.workspaceStarted = false;
      store.workspaceMode = '';
      store.pendingWorkspaceFiles = [];
      store.workspaceStatus = '';
      store.workspaceStatusTone = '';
    }
    store.currentView = button.dataset.view;
    store.query = '';
    renderShell();
    if (store.currentView === 'files') void loadStorageFiles();
    if (store.currentView === 'communication' && store.selectedCommunication) loadCommunicationThread(store.selectedCommunication);
    if (store.currentView === 'chat' && store.selectedChat) loadChatConversation(store.selectedChat);
    if (store.currentView === 'platform-audit') apiRequest('/api/platform/audit', {}, store.apiToken).then(result => { if (result.response?.ok) { store.platformAudit = result.body.events || []; renderShell(); } else showToast(result.body.message || '审计记录加载失败'); });
  });
  globalSearch.addEventListener('input', event => {
    if (store.currentView === 'automation') return;
    if (store.currentView === 'organization') {
      const search = content.querySelector('[data-chart-search]');
      if (search) { search.value = event.target.value; search.dispatchEvent(new Event('input', { bubbles: true })); }
      return;
    }
    if (store.currentView === 'communication') {
      const search = content.querySelector('[data-comm-search]');
      if (search) { search.value = event.target.value; search.dispatchEvent(new Event('input', { bubbles: true })); }
      return;
    }
    store.query = event.target.value;
    if (store.currentView === 'workspace' && store.workspaceStarted && store.workspaceMode === 'background') return;
    content.innerHTML = renderView(store);
  });
  content.addEventListener('change', async event => {
    const subtaskCheckbox = event.target.closest('[data-communication-subtask]');
    if (subtaskCheckbox) {
      const conversation = store.conversations.find(item => item.id === store.selectedCommunication);
      const project = store.projects.find(item => item.id === conversation?.projectId);
      if (!project?.rootTaskId) return;
      const completed = subtaskCheckbox.checked;
      subtaskCheckbox.disabled = true;
      const result = await apiRequest(`/api/tasks/${encodeURIComponent(project.rootTaskId)}/subtasks/${encodeURIComponent(subtaskCheckbox.dataset.communicationSubtask)}`, { method: 'PUT', body: JSON.stringify({ completed }) }, store.apiToken);
      if (!result.response?.ok) showToast(result.body.message || '子任务更新失败');
      await loadCommunicationContext(conversation.id);
      return;
    }
    if (event.target.matches('[data-storage-file-input]')) {
      queueStorageFiles(event.target.files);
      return;
    }
    if (event.target.matches('[data-workspace-upload]')) {
      queueWorkspaceFiles(event.target.files);
      event.target.value = '';
      return;
    }
    if (event.target.matches('[data-workspace-project]')) {
      store.bomProjectId = event.target.value || '';
      store.workspaceStatus = '';
      store.workspaceStatusTone = '';
      content.innerHTML = renderWorkspace(store);
      return;
    }
    if (event.target.matches('[data-storage-project]')) {
      if ((store.storagePendingFiles || []).length) {
        event.target.value = store.storageProjectId || '';
        return showToast('请先上传或清空待上传文件，再更改归属项目');
      }
      store.storageProjectId = event.target.value || '';
      store.storageLoadedKey = '';
      void loadStorageFiles();
      return;
    }
    if (!event.target.matches('[data-office-upload]')) return;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const apiBase = location.pathname.startsWith('/mfggo/') ? '/mfggo-api' : '/api';
      const response = await fetch(`${apiBase}/documents/upload`, { method: 'POST', headers: { authorization: `Bearer ${store.apiToken}`, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) }, body: file });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || '上传失败');
      const doc = body.document;
      OFFICE_DOCUMENTS.unshift({ ...doc, scope: '我的文档', updated: new Date(doc.updatedAt).toLocaleString('zh-CN'), size: `${Math.max(1, Math.ceil(doc.sizeBytes / 1024))} KB`, permission: '可编辑' });
      content.innerHTML = renderWorkspace(store);
      showToast('文档上传成功');
    } catch (error) { showToast(error.message); }
  });
  document.querySelector('#logoutButton')?.addEventListener('click', async () => {
    stopChatSync();
    const token = store.apiToken;
    if (token) await apiRequest('/api/auth/logout', { method: 'POST' }, token);
    resetClientState();
    saveSession(store);
    shellView.classList.add('hidden');
    loginView.classList.remove('hidden');
    document.querySelector('#loginPassword')?.focus();
  });

  content.addEventListener('click', async event => {
    if (event.target.closest('[data-action="task-recycle-bin"]')) {
      openTaskRecycleBin(store, { apiRequest, showToast, onChanged: async () => { await hydrateProjects(store); renderShell(); } });
      return;
    }
    // Card avatars are a separate interaction surface from opening the card.
    // Resolve the trigger before the generic project/task-card handlers below.
    const shortcutTrigger = event.target.closest('[data-task-shortcuts-trigger]');
    if (shortcutTrigger) {
      event.preventDefault();
      event.stopPropagation();
      const card = shortcutTrigger.closest('[data-project-card],[data-task-card]');
      const menu = card?.querySelector('[data-task-shortcuts-menu]');
      if (!menu) return;
      const willOpen = menu.hidden;
      closeTaskShortcutMenus(willOpen ? menu : null);
      menu.hidden = !willOpen;
      shortcutTrigger.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) {
        positionTaskShortcutMenu(shortcutTrigger, menu);
        menu.querySelector('[data-task-shortcut]:not(:disabled)')?.focus();
      } else {
        clearTaskShortcutMenuPosition(menu);
      }
      return;
    }
    const shortcutAction = event.target.closest('[data-task-shortcut]');
    if (shortcutAction) {
      event.preventDefault();
      event.stopPropagation();
      if (shortcutAction.disabled) return;
      const menu = shortcutAction.closest('[data-task-shortcuts-menu]');
      const taskId = String(menu?.dataset.taskId || '');
      const projectId = String(menu?.dataset.projectId || '');
      const action = String(shortcutAction.dataset.taskShortcut || '');
      closeTaskShortcutMenus();
      if (!taskId) return showToast('当前卡片没有可操作的任务');
      const project = (store.projects || []).find(item => String(item.id) === projectId || String(item.rootTaskId) === taskId);
      const rootTaskSnapshot = project?.rootTaskId === taskId
        ? (store.tasks || []).find(item => String(item?.id || '') === taskId)
        : null;
      const localTask = (store.tasks || []).find(item => String(item.id) === taskId)
        || (project?.rootTaskId === taskId ? { ...project, ...rootTaskSnapshot, id: taskId, projectId: project.id, assigneeUserId: project.executorUserId || rootTaskSnapshot?.assigneeUserId || '', dueAt: project.dueAt || rootTaskSnapshot?.dueAt || '' } : null);
      const shortcutCapabilities = localTask
        ? deriveTaskCapabilities(store, { task: localTask }, { project })
        : null;
      if (action === 'copy-link') {
        const taskUrl = new URL(location.href);
        taskUrl.hash = '';
        taskUrl.searchParams.set('task', taskId);
        const copied = await writeClipboardText(taskUrl.toString());
        showToast(copied ? '任务链接已复制' : '复制失败，请手动复制地址');
        return;
      }
      if (action === 'copy-task') {
        // A project card is backed by its canonical root task. Copying that
        // row through the standalone-task endpoint silently detached the
        // copy from its project, which then made an unexpected card appear
        // in "我的任务". Keep project work inside the project board; users
        // can create an independent task explicitly from that module.
        if (project?.rootTaskId === taskId) {
          return showToast('项目根任务不能复制为独立任务，请在项目管理中新建项目');
        }
        const detail = await loadTaskShortcutDetail(taskId);
        const source = detail?.task || localTask;
        if (!source) return;
        const assigneeUserId = ['owner', 'admin'].includes(store.role)
          ? (source.assigneeUserId || store.user?.id || '')
          : (store.user?.id || '');
        const result = await apiRequest('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title: `${source.title || '未命名任务'}（副本）`,
            description: source.description || '',
            stage: source.stage || '未分组',
            assigneeUserId,
            priority: source.priority || '普通',
            startAt: source.startAt || '',
            dueAt: source.dueAt || '',
            status: PROJECT_BOARD_STAGE_IDS.has(source.status) ? source.status : taskBoardStatus(source)
          })
        }, store.apiToken);
        if (!result.response?.ok || !result.body?.task) return showToast(result.body?.message || '复制任务失败');
        store.tasks = [result.body.task, ...(store.tasks || [])];
        store.currentView = 'tasks';
        renderShell();
        showToast('任务副本已创建');
        return;
      }
      if (action === 'set-assignee') {
        // An assigned task may only be handed off by its current executor.
        // Leave an empty slot reachable so the detail view can validate project
        // membership and expose the claim action after loading fresh members.
        const assignedToSomeone = Boolean(String(localTask?.assigneeUserId || '').trim());
        const projectExecutor = project?.rootTaskId === taskId
          ? canCurrentUserExecuteProject(store, project)
          : Boolean(shortcutCapabilities?.isCurrentExecutor);
        if (assignedToSomeone && !projectExecutor) return showToast('只有当前负责人可以交接任务');
        await openTaskShortcutDetail(taskId, { focusAssignee: true });
        return;
      }
      if (action === 'set-due') {
        if (!shortcutCapabilities?.canEdit) return showToast('只有当前负责人可以修改时间');
        const detail = await loadTaskShortcutDetail(taskId);
        if (!detail) return;
        openTaskDueDialog(store, detail.task, body => {
          const task = (store.tasks || []).find(item => item.id === body.task?.id);
          if (task) Object.assign(task, body.task);
          if (body?.project) {
            const updated = (store.projects || []).find(item => item.id === body.project.id);
            if (updated) Object.assign(updated, body.project);
          }
          renderShell();
        });
        return;
      }
      if (action === 'set-status') {
        if (!shortcutCapabilities?.canChangeStatus) return showToast('只有当前负责人可以更改状态');
        const detail = await loadTaskShortcutDetail(taskId);
        if (!detail) return;
        openTaskStatusDialog(store, detail.task, body => {
          const task = (store.tasks || []).find(item => item.id === body.task.id);
          if (task) Object.assign(task, body.task);
          if (body.project && project) Object.assign(project, body.project);
          renderShell();
        });
        return;
      }
      if (action === 'add-subtask' || action === 'view-subtasks') {
        if (action === 'add-subtask' && !shortcutCapabilities?.canManageSubtasks) return showToast('只有当前负责人可以添加子任务');
        await openTaskShortcutDetail(taskId, { openSubtask: action === 'add-subtask', viewSubtasks: action === 'view-subtasks' });
        return;
      }
      if (action === 'move-project' || action === 'convert-subtask') {
        return showToast('任务转换暂不可用');
      }
      if (action === 'recycle') {
        const isProject = Boolean(project?.rootTaskId === taskId);
        if (!(isProject ? enterpriseCan(store, 'project.delete') : shortcutCapabilities?.canDelete)) return showToast('未获得回收此任务的权限');
        const name = isProject ? project.title : localTask?.title || '此任务';
        if (!await confirmTaskRecycle({ title: name, projectRoot: isProject })) return;
        const path = isProject ? `/api/projects/${encodeURIComponent(project.id)}/recycle` : `/api/tasks/${encodeURIComponent(taskId)}/recycle`;
        const result = await apiRequest(path, { method: 'POST' }, store.apiToken);
        if (!result.response?.ok) return showToast(result.body?.message || '移入回收站失败');
        await hydrateProjects(store);
        renderShell();
        showToast('已移入回收站');
        return;
      }
      return;
    }
    if (event.target.closest('[data-task-shortcuts-menu]')) return;
    closeTaskShortcutMenus();
    if (event.target.closest('[data-action="clear-chat-filters"]')) {
      store.chatFilter = 'all';
      store.chatScope = 'all';
      store.chatQuery = '';
      renderShell();
      return;
    }
    if (event.target.closest('[data-action="create-chat-conversation"]')) {
      openChatConversationDialog(createEnterpriseConversation);
      return;
    }
    const storageScope = event.target.closest('[data-storage-scope]');
    if (storageScope) {
      if ((store.storagePendingFiles || []).length) return showToast('请先上传或清空待上传文件，再切换空间');
      store.storageScope = storageScope.dataset.storageScope === 'enterprise' ? 'enterprise' : 'personal';
      if (store.storageScope === 'personal') store.storageProjectId = '';
      store.storageLoadedKey = '';
      renderShell();
      void loadStorageFiles();
      return;
    }
    const storagePreview = event.target.closest('[data-storage-file-preview]');
    if (storagePreview) {
      const file = (store.storageFiles || []).find(item => item.id === storagePreview.dataset.storageFilePreview);
      void openStorageFilePreview(file);
      return;
    }
    const storageDownload = event.target.closest('[data-storage-file-download]');
    if (storageDownload) {
      const file = (store.storageFiles || []).find(item => item.id === storageDownload.dataset.storageFileDownload);
      void downloadStorageFile(file);
      return;
    }
    const storageDelete = event.target.closest('[data-storage-file-delete]');
    if (storageDelete) {
      const file = (store.storageFiles || []).find(item => item.id === storageDelete.dataset.storageFileDelete);
      void deleteStorageFile(file);
      return;
    }
    const storagePendingRemove = event.target.closest('[data-storage-pending-remove]');
    if (storagePendingRemove) {
      if (!store.storageUploading) removeStoragePendingFile(storagePendingRemove.dataset.storagePendingRemove);
      return;
    }
    if (event.target.closest('[data-storage-pending-clear]')) {
      if (!store.storageUploading) clearStoragePendingFiles();
      return;
    }
    if (event.target.closest('[data-storage-pending-submit]')) {
      if (!store.storageUploading) void uploadStorageFiles(store.storagePendingFiles);
      return;
    }
    const projectCard = event.target.closest('[data-project-open]');
    if (projectCard && Date.now() - projectDragFinishedAt > 350 && !projectCard.classList.contains('dragging', 'is-saving') && !event.target.closest('[data-action="edit-project"]')) { openProjectCardPopup(projectCard.dataset.projectOpen); return; }
    const createProjectStage = event.target.closest('[data-create-project-stage]');
    if (createProjectStage) { openProjectDialog((title, stage) => {
      if (!store.apiToken) return showToast('SaaS 服务未连接，请重新登录后再创建项目');
      apiRequest('/api/projects', { method: 'POST', body: JSON.stringify({ title, stage }) }, store.apiToken).then(result => {
        if (!result.response?.ok) return showToast(result.body.message || '项目创建失败');
        addCreatedProject(result.body.project); showToast('项目已创建并写入企业空间');
      });
    }, createProjectStage.dataset.createProjectStage); return; }
    const documentScope = event.target.closest('[data-document-scope]');
    if (documentScope) { const scope=documentScope.dataset.documentScope;if(scope==='回收站'){apiRequest('/api/documents/trash',{},store.apiToken).then(result=>{if(!result.response?.ok)return showToast(result.body.message||'回收站加载失败');OFFICE_DOCUMENTS=OFFICE_DOCUMENTS.filter(item=>item.scope!=='回收站').concat((result.body.documents||[]).map(doc=>({...doc,scope:'回收站',updated:new Date(doc.deletedAt||doc.updatedAt).toLocaleString('zh-CN'),size:`${Math.max(1,Math.ceil(doc.sizeBytes/1024))} KB`,permission:'已删除'})));content.innerHTML=renderWorkspace(store);const tab=content.querySelector('[data-document-scope="回收站"]');content.querySelectorAll('[data-document-scope]').forEach(button=>button.classList.toggle('active',button===tab));content.querySelectorAll('[data-document-card]').forEach(card=>card.hidden=card.dataset.scope!=='回收站')});return;} content.querySelectorAll('[data-document-scope]').forEach(button=>button.classList.toggle('active',button===documentScope)); content.querySelectorAll('[data-document-card]').forEach(card=>card.hidden=card.dataset.scope!==scope); return; }
    const officeDocument = event.target.closest('[data-office-document]');
    if (officeDocument) { const doc = OFFICE_DOCUMENTS.find(item => item.id === officeDocument.dataset.officeDocument); if (doc) { const apiBase=location.pathname.startsWith('/mfggo/')?'/mfggo-api':'/api'; content.innerHTML = `<section class="view office-editor-view"><iframe class="onlyoffice-frame" src="./onlyoffice.html?embedded=1&configUrl=${apiBase}/documents/${encodeURIComponent(doc.id)}/config&apiToken=${encodeURIComponent(store.apiToken)}" title="${esc(doc.title)}"></iframe></section>`; } return; }
    const part = event.target.closest('[data-part-id]');
    if (part) { store.selectedPart = part.dataset.partId; content.innerHTML = renderParts(store); return; }
    const chatFilter = event.target.closest('[data-chat-filter]');
    if (chatFilter) {
      store.chatDraft = content.querySelector('#chatInput')?.value || store.chatDraft;
      store.chatFilter = chatFilter.dataset.chatFilter;
      const filtered = filterChatConversations(store.conversations, { filter: store.chatFilter, scope: store.chatScope, query: store.chatQuery });
      store.selectedChat = filtered[0]?.id || '';
      renderShell();
      return;
    }
    const chatDownload = event.target.closest('[data-chat-attachment-download]');
    if (chatDownload) {
      const attachmentId = chatDownload.dataset.chatAttachmentDownload;
      const apiBase = location.pathname.startsWith('/mfggo/') ? '/mfggo-api' : '/api';
      fetch(`${apiBase}/chat-attachments/${encodeURIComponent(attachmentId)}/download`, { headers: { authorization: `Bearer ${store.apiToken}` } }).then(async response => {
        if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || '附件下载失败'); }
        const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
        link.href = url; link.download = chatDownload.dataset.chatAttachmentName || 'attachment'; link.click(); URL.revokeObjectURL(url);
      }).catch(downloadError => showToast(downloadError.message));
      return;
    }
    const chat = event.target.closest('[data-chat-id]');
    if (chat) { store.chatDraft = content.querySelector('#chatInput')?.value || store.chatDraft; loadChatConversation(chat.dataset.chatId); return; }
    const communication = event.target.closest('[data-communication-id]');
    if (communication) {
      preserveCommunicationDraft();
      if (communication.dataset.communicationId !== store.selectedCommunication && hasPendingCommunicationCompose()) return showToast('当前项目沟通有未发送内容或附件，请发送或移除后再切换话题');
      store.selectedCommunication = communication.dataset.communicationId;
      content.innerHTML = renderCommunication(store);
      loadCommunicationThread(store.selectedCommunication);
      return;
    }
    const projectConversation = event.target.closest('[data-project-conversation-id]');
    if (projectConversation) { openCommunicationThread(projectConversation.dataset.projectConversationId); return; }
    const workspaceFileRemove = event.target.closest('[data-workspace-file-remove]');
    if (workspaceFileRemove) {
      store.workspaceFiles = (store.workspaceFiles || []).filter((_, index) => index !== Number(workspaceFileRemove.dataset.workspaceFileRemove));
      store.workspaceStatus = '';
      store.workspaceStatusTone = '';
      content.innerHTML = renderWorkspace(store);
      return;
    }
    const communicationFilter = event.target.closest('[data-communication-filter]');
    const communicationFeed = event.target.closest('[data-communication-feed]');
    if (communicationFilter || communicationFeed) {
      preserveCommunicationDraft();
      if (communicationFilter && hasPendingCommunicationCompose()) return showToast('请先发送或清空当前草稿再切换通知');
      if (communicationFilter) {
        store.communicationFilter = communicationFilter.dataset.communicationFilter;
        store.communicationReadSelection = null;
      }
      if (communicationFeed) store.communicationFeed = communicationFeed.dataset.communicationFeed;
      renderShell();
      if (communicationFilter && store.selectedCommunication) void loadCommunicationThread(store.selectedCommunication);
      return;
    }
    if (event.target.closest('[data-communication-refresh]')) { void loadCommunicationContext(); return; }
    const communicationTool = event.target.closest('[data-communication-project-tool]');
    const communicationResource = event.target.closest('[data-communication-resource]');
    const communicationLater = event.target.closest('[data-communication-later]');
    if (communicationTool || communicationResource || communicationLater) {
      preserveCommunicationDraft();
      const conversation = store.conversations.find(item => item.id === store.selectedCommunication);
      const project = store.projects.find(item => item.id === conversation?.projectId);
      if (!conversation || !project) return;
      if (communicationLater) {
        const result = await apiRequest(`/api/conversations/${encodeURIComponent(conversation.id)}/state`, { method: 'PUT', body: JSON.stringify({ savedForLater: !conversation.savedForLater }) }, store.apiToken);
        if (!result.response?.ok) return showToast(result.body.message || '稍后处理设置失败');
        conversation.savedForLater = !conversation.savedForLater;
        renderShell();
      } else if (communicationTool) {
        const mode = communicationTool.dataset.communicationProjectTool;
        await openTaskShortcutDetail(project.rootTaskId, {
          openSubtask: mode === 'add', viewSubtasks: mode === 'subtasks',
          onClose: () => { void loadCommunicationContext(conversation.id); renderShell(); }
        });
      } else {
        if (hasPendingCommunicationCompose()) return showToast('请先发送或清空当前草稿再打开资源');
        const snapshot = store.communicationContext?.[project.id]?.related;
        const resource = snapshot && getTaskRelatedContent({}, project.id, snapshot, snapshot.taskAttachments).filter(item => item.kind !== 'communication')[Number(communicationResource.dataset.communicationResource)];
        if (resource?.source === 'task-attachment') {
          const result = await fetch(`${location.pathname.startsWith('/mfggo/') ? '/mfggo-api' : '/api'}/tasks/${encodeURIComponent(project.rootTaskId)}/attachments/${encodeURIComponent(resource.id)}/download`, { headers: { authorization: `Bearer ${store.apiToken}` } });
          if (!result.ok) return showToast('附件下载失败或无权访问');
          const url = URL.createObjectURL(await result.blob());
          const anchor = document.createElement('a');
          anchor.href = url; anchor.download = resource.title; anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
          return;
        }
        if (resource) { try { await openRelatedContent(resource); } catch (error) { showToast(error.message || '资源打开失败'); } }
      }
      return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'start-workspace-analysis') {
      if (!store.workspaceFiles?.length) return showToast('请先选择 STEP、PDF 或 ZIP 文件');
      if (!store.bomProjectId) return showToast('请先选要导入的项目');
      const mode = getWorkspaceLaunchMode(store.workspaceFiles);
      store.pendingWorkspaceFiles = [...store.workspaceFiles];
      if (mode === 'pdf') store.workspaceFiles = [];
      store.workspaceStarted = true;
      store.workspaceMode = mode;
      store.workspaceStatus = mode === 'background' ? '正在本地解析 3D 文件并生成项目清单' : '';
      store.workspaceStatusTone = mode === 'background' ? 'processing' : '';
      renderShell();
      return;
    }
    if (action === 'send-chat') { sendChatMessage(); return; }
    if (action === 'attach-chat-file') { content.querySelector('[data-chat-attachment-input]')?.click(); return; }
    if (action === 'remove-chat-attachment') { removeChatAttachment(event.target.closest('[data-chat-attachment-id]')?.dataset.chatAttachmentId); return; }
    if (action === 'attach-communication-file') { content.querySelector('[data-communication-attachment-input]')?.click(); return; }
    if (action === 'remove-communication-attachment') { removeCommunicationAttachment(event.target.closest('[data-communication-attachment-id]')?.dataset.communicationAttachmentId); return; }
    if (action === 'toggle-chat-later') {
      const conversation = store.conversations.find(item => item.id === store.selectedChat);
      if (!conversation) return;
      const savedForLater = !conversation.savedForLater;
      apiRequest(`/api/conversations/${encodeURIComponent(conversation.id)}/state`, { method: 'PUT', body: JSON.stringify({ savedForLater }) }, store.apiToken).then(result => {
        if (!result.response?.ok) return showToast(result.body.message || '稍后处理状态保存失败');
        conversation.savedForLater = savedForLater; renderShell();
      });
      return;
    }
    if (action === 'create-communication') {
      preserveCommunicationDraft();
      if (hasPendingCommunicationCompose()) return showToast('当前项目沟通有未发送内容或附件，请发送或移除后再发起新话题');
      openCommunicationDialog(store, createCommunication);
      return;
    }
    if (action === 'send-communication') { sendCommunicationMessage(); return; }
    if (action === 'open-communication-project') {
      const conversation = store.conversations.find(item => item.id === store.selectedCommunication);
      if (conversation?.projectId) openProjectCardPopup(conversation.projectId);
      return;
    }
    if (action === 'storage-upload') { content.querySelector('[data-storage-file-input]')?.click(); return; }
    if (action === 'upload-office-document') { content.querySelector('[data-office-upload]')?.click(); return; }
    const documentId = event.target.closest('[data-document-id]')?.dataset.documentId;
    if (action === 'rename-office-document' && documentId) { const doc=OFFICE_DOCUMENTS.find(item=>item.id===documentId),title=window.prompt('请输入新文档名称',doc?.title||'');if(!title||title===doc?.title)return;apiRequest(`/api/documents/${encodeURIComponent(documentId)}`,{method:'PUT',body:JSON.stringify({title})},store.apiToken).then(result=>{if(!result.response?.ok)return showToast(result.body.message||'重命名失败');doc.title=title;content.innerHTML=renderWorkspace(store);showToast('文档已重命名')});return; }
    if (action === 'download-office-document' && documentId) { const apiBase=location.pathname.startsWith('/mfggo/')?'/mfggo-api':'/api';fetch(`${apiBase}/documents/${encodeURIComponent(documentId)}/download`,{headers:{authorization:`Bearer ${store.apiToken}`}}).then(async response=>{if(!response.ok)throw new Error('下载失败');const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=OFFICE_DOCUMENTS.find(item=>item.id===documentId)?.title||'document';link.click();URL.revokeObjectURL(url)}).catch(error=>showToast(error.message));return; }
    if (action === 'trash-office-document' && documentId) { if(!window.confirm('将此文档移入回收站？'))return;apiRequest(`/api/documents/${encodeURIComponent(documentId)}`,{method:'DELETE'},store.apiToken).then(result=>{if(!result.response?.ok)return showToast(result.body.message||'删除失败');OFFICE_DOCUMENTS=OFFICE_DOCUMENTS.filter(item=>item.id!==documentId);content.innerHTML=renderWorkspace(store);showToast('已移入回收站')});return; }
    if (action === 'restore-office-document' && documentId) { apiRequest(`/api/documents/${encodeURIComponent(documentId)}/restore`,{method:'POST'},store.apiToken).then(result=>{if(!result.response?.ok)return showToast(result.body.message||'恢复失败');OFFICE_DOCUMENTS=OFFICE_DOCUMENTS.filter(item=>item.id!==documentId);content.innerHTML=renderWorkspace(store);showToast('文档已恢复')});return; }
    if (action === 'permanent-delete-office-document' && documentId) { if(!window.confirm('彻底删除后无法恢复，是否继续？'))return;apiRequest(`/api/documents/${encodeURIComponent(documentId)}/permanent`,{method:'DELETE'},store.apiToken).then(result=>{if(!result.response?.ok)return showToast(result.body.message||'彻底删除失败');OFFICE_DOCUMENTS=OFFICE_DOCUMENTS.filter(item=>item.id!==documentId);content.innerHTML=renderWorkspace(store);showToast('文档已彻底删除')});return; }
    if (action === 'new-office-document') {
      const fileType = event.target.closest('[data-file-type]')?.dataset.fileType || 'xlsx';
      if (!store.apiToken) return showToast('请先登录后创建文档');
      const names = { docx: '未命名 Word 文档.docx', xlsx: '未命名 Excel 表格.xlsx', pptx: '未命名演示文稿.pptx' };
      apiRequest('/api/documents', { method: 'POST', body: JSON.stringify({ fileType, title: names[fileType] }) }, store.apiToken).then(result => {
        if (!result.response?.ok) return showToast(result.body.message || '创建文档失败');
        const doc = result.body.document; OFFICE_DOCUMENTS.unshift({ ...doc, scope: '我的文档', updated: new Date(doc.updatedAt).toLocaleString('zh-CN'), size: `${Math.max(1, Math.ceil(doc.sizeBytes / 1024))} KB`, permission: '可编辑' });
        content.innerHTML = renderWorkspace(store); showToast('文档已创建');
      });
      return;
    }
    if (action === 'edit-part') {
      const part = store.parts.find(item => item.id === store.selectedPart);
      if (!part) return showToast('当前零件不支持编辑');
      openEditPartDialog(store, part, async payload => {
        const result = await apiRequest(`/api/parts/${encodeURIComponent(part.id)}`, { method: 'PUT', body: JSON.stringify(payload) }, store.apiToken);
        if (!result.response?.ok || !result.body?.part?.id) {
          showToast(result.body?.message || '零件保存失败');
          return false;
        }
        Object.assign(part, result.body.part);
        renderShell();
        showToast('零件已更新');
        return true;
      });
      return;
    }
    if (action === 'save-part-manual') {
      const part = store.parts.find(item => item.id === store.selectedPart);
      const form = event.target.closest('[data-part-manual-form]');
      if (!part || !form) return showToast('当前零件不支持编辑');
      const data = new FormData(form);
      const payload = {
        dimensions: String(data.get('dimensions') || '').trim(),
        volume: String(data.get('volume') || '').trim(),
        quantity: Number(data.get('quantity') || 1),
        material: String(data.get('material') || '').trim(),
        finish: String(data.get('finish') || '').trim()
      };
      const result = await apiRequest(`/api/parts/${encodeURIComponent(part.id)}`, { method: 'PUT', body: JSON.stringify(payload) }, store.apiToken);
      if (!result.response?.ok || !result.body?.part?.id) return showToast(result.body?.message || '零件保存失败');
      Object.assign(part, result.body.part);
      renderShell();
      showToast('零件已保存');
      return;
    }
    if (action === 'edit-project') {
      const project = store.projects.find(item => item.id === event.target.closest('[data-project-id]')?.dataset.projectId);
      if (!project) return showToast('当前项目不支持编辑');
      if (!canCurrentUserExecuteProject(store, project)) return showToast('只有当前负责人可以编辑项目');
      openEditProjectDialog(project, payload => apiRequest(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'PUT', body: JSON.stringify(payload) }, store.apiToken).then(result => { if (!result.response?.ok) return showToast(result.body.message || '项目保存失败'); Object.assign(project, result.body.project); renderShell(); showToast('项目已更新'); }));
    }
    if (action === 'enter-enterprise') {
      const organizationId = event.target.closest('[data-organization-id]')?.dataset.organizationId;
      if (!organizationId) return switchConsole('enterprise');
      const enterpriseWindow = window.open('enterprise.html', '_blank');
      if (!enterpriseWindow) return showToast('浏览器拦截了新页面，请允许弹出窗口后重试');
      const switchButton = event.target.closest('button');
      if (switchButton) { switchButton.disabled = true; switchButton.textContent = '进入中…'; }
      apiRequest(`/api/platform/organizations/${encodeURIComponent(organizationId)}/switch`, { method: 'POST' }, store.apiToken).then(async result => {
        if (!result.response?.ok) {
          enterpriseWindow.close();
          if (switchButton) { switchButton.disabled = false; switchButton.textContent = '进入企业'; }
          return showToast(result.body.message || '进入企业失败');
        }
        const sessionMessage = { type: 'mfggo-enterprise-session', token: result.body.token };
        const deliverSession = () => { try { if (!enterpriseWindow.closed) enterpriseWindow.postMessage(sessionMessage, window.location.origin); } catch {} };
        deliverSession();
        const retry = window.setInterval(() => { if (enterpriseWindow.closed) return window.clearInterval(retry); deliverSession(); }, 300);
        window.setTimeout(() => window.clearInterval(retry), 10000);
      }).catch(() => {
        enterpriseWindow.close();
        if (switchButton) { switchButton.disabled = false; switchButton.textContent = '进入企业'; }
        showToast('进入企业失败，请检查网络连接');
      });
    }
    if (action === 'create-organization') {
      if (!platformAllowed(store, 'organization.create')) return showToast('未获授权创建企业');
      const token = store.apiToken;
      const candidates = await apiRequest('/api/platform/owner-candidates', {}, token);
      if (token !== store.apiToken) return;
      if (!candidates.response?.ok) return showToast(candidates.body.message || '主管理账号加载失败');
      openOrganizationDialog(async payload => {
        const result = await apiRequest('/api/platform/organizations', { method: 'POST', body: JSON.stringify(payload) }, token);
        if (!result.response?.ok) { showToast(result.body.message || '企业创建失败'); return false; }
        await loadPlatformData(); showToast('企业已创建'); return true;
      }, candidates.body.candidates || []);
    }
    if (action === 'assign-enterprise-owner') {
      const organization = store.organizations.find(item => item.id === event.target.closest('[data-organization-id]')?.dataset.organizationId);
      if (organization) openEnterpriseOwnerDialog(store, organization, { apiRequest, showToast, onChanged: loadPlatformData });
    }
    if (action === 'create-task') openTaskDialog(store, async payload => {
      const result = await apiRequest('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }, store.apiToken); if (!result.response?.ok) return showToast(result.body.message || '任务创建失败'); store.tasks = [result.body.task, ...(store.tasks || [])]; renderShell(); const detailResult = await apiRequest(`/api/tasks/${encodeURIComponent(result.body.task.id)}/detail`, {}, store.apiToken); if (detailResult.response?.ok) openTaskDetail(store, detailResult.body); showToast('任务已创建');
    });
    if (action === 'import-tasks') {
      openTaskImportDialog(store, { onImported: () => renderShell() });
      return;
    }
    if (action === 'open-my-task') {
      if (event.target.closest('button,input,select,a')) return;
      const row = event.target.closest('[data-my-task-row]');
      if (!row?.dataset.taskId) return;
      void openMyTask(row.dataset.taskId, row.dataset.projectId || '');
      return;
    }
    if (action === 'edit-task') {
      if (event.target.closest('select,input,button')) return;
      const taskId = event.target.closest('[data-task-id]')?.dataset.taskId;
      const task = store.tasks.find(item => item.id === taskId);
      if (!task) return;
      apiRequest(`/api/tasks/${encodeURIComponent(task.id)}/detail`, {}, store.apiToken).then(result => {
        if (!result.response?.ok) return showToast(result.body.message || '任务详情加载失败');
        openTaskDetail(store, result.body);
      });
      return;
    }
    if (action === 'configure-organization') {
      const organization = store.organizations.find(item => item.id === event.target.closest('[data-organization-id]')?.dataset.organizationId);
      if (!organization) return;
      const keys = ['projects', 'workspace', 'parts', 'communication', 'chat', 'tasks', 'stats'];
      const labels = { projects: '项目管理', workspace: '制表中心', parts: '零件中心', communication: '项目沟通', chat: '聊天信息', tasks: '我的任务', stats: '统计' };
      const host = document.createElement('div'); host.className = 'project-dialog-backdrop'; host.innerHTML = `<section class="project-dialog" role="dialog" aria-modal="true"><header><div><small>MODULES</small><h2>配置企业功能</h2></div><button type="button" data-close>×</button></header><p class="muted-note">${esc(organization.name)} 的功能开关</p><form>${keys.map(key => `<label class="module-toggle"><input type="checkbox" name="${key}" ${organization.modules?.[key] ? 'checked' : ''}> <span>${labels[key]}</span></label>`).join('')}<footer><button type="button" class="outline-button" data-close>取消</button><button type="submit" class="primary-button">保存模块配置</button></footer></form></section>`;
      document.body.appendChild(host); const close = () => host.remove(); host.querySelectorAll('[data-close]').forEach(button => button.onclick = close); host.querySelector('form').onsubmit = async submitEvent => { submitEvent.preventDefault(); const form = new FormData(submitEvent.currentTarget); const modules = Object.fromEntries(keys.map(key => [key, form.has(key)])); const result = await apiRequest(`/api/platform/organizations/${encodeURIComponent(organization.id)}/modules`, { method: 'PUT', body: JSON.stringify({ modules }) }, store.apiToken); if (!result.response?.ok) return showToast(result.body.message || '模块配置保存失败'); organization.modules = result.body.organization.modules; if (organization.id === store.organization?.id) store.modules = organization.modules; close(); renderShell(); showToast('企业功能模块已更新'); };
    }
    if (action === 'open-workspace') {
      const part = store.parts.find(item => item.id === store.selectedPart);
      store.bomProjectId = part?.projectId || store.projects?.[0]?.id || '';
      store.workspaceStarted = false;
      store.workspaceMode = '';
      store.workspaceStatus = '';
      store.workspaceStatusTone = '';
      store.currentView = 'workspace';
      renderShell();
      return;
    }
    if (action === 'edit-quote') openQuoteDialog(store, payload => {
      const project = store.projects[0];
      const method = payload.quoteId ? 'PUT' : 'POST'; const path = payload.quoteId ? `/api/projects/${encodeURIComponent(project.id)}/quotes/${encodeURIComponent(payload.quoteId)}` : `/api/projects/${encodeURIComponent(project.id)}/quotes`; apiRequest(path, { method, body: JSON.stringify(payload) }, store.apiToken).then(result => { if (!result.response?.ok) return showToast(result.body.message || '报价保存失败'); store.quotes = payload.quoteId ? [result.body.quote, ...(store.quotes || []).filter(item => item.id !== payload.quoteId)] : [result.body.quote, ...(store.quotes || [])]; renderShell(); showToast(payload.quoteId ? '报价草稿已更新' : '报价草稿已保存'); });
    }, { quoteId: store.quotes?.[0]?.id });
    if (action === 'edit-fair') openFairDialog(store, payload => {
      const project = store.projects[0];
      apiRequest(`/api/projects/${encodeURIComponent(project.id)}/fair-items`, { method: 'POST', body: JSON.stringify(payload) }, store.apiToken).then(result => { if (!result.response?.ok) return showToast(result.body.message || 'FAIR 保存失败'); store.fairItems = [result.body.item, ...(store.fairItems || [])]; renderShell(); showToast('FAIR 检验项已保存'); });
    });
    if (action === 'new-part') {
      if (!store.apiToken) return showToast('SaaS 服务未连接，请重新登录后再新增零件');
      openPartDialog(store, async payload => {
        if (!payload.projectId || !payload.name) return showToast('请选择项目并填写零件名称');
        const created = await apiRequest(`/api/projects/${encodeURIComponent(payload.projectId)}/parts`, { method: 'POST', body: JSON.stringify(payload) }, store.apiToken);
        const createdPart = created.body?.part;
        if (!created.response?.ok || !createdPart?.id) {
          showToast(created.body?.message || '零件保存失败');
          return false;
        }
        if (createdPart.material !== payload.material || createdPart.finish !== payload.finish) {
          showToast('材料或表面处理未被服务器保存，零件未显示为创建成功');
          return false;
        }

        const reloaded = await apiRequest('/api/parts', {}, store.apiToken);
        if (reloaded.response?.ok && Array.isArray(reloaded.body?.parts)) {
          const persistedPart = reloaded.body.parts.find(item => item.id === createdPart.id);
          if (!persistedPart || persistedPart.material !== payload.material || persistedPart.finish !== payload.finish) {
            showToast('创建后的材料或表面处理校验失败，请刷新页面后重试');
            return false;
          }
          store.parts = reloaded.body.parts;
          store.selectedPart = persistedPart.id;
        } else {
          // The create response is already authoritative. Retain it locally
          // when an immediate list refresh is temporarily unavailable.
          store.parts.unshift(createdPart);
          store.selectedPart = createdPart.id;
        }
        renderShell();
        showToast('零件已创建');
        return true;
      });
      return;
    }
    if (action === 'create-project' || action === 'new-project') {
      openProjectDialog((title, stage) => {
        if (!store.apiToken) return showToast('SaaS 服务未连接，请重新登录后再创建项目');
        apiRequest('/api/projects', { method: 'POST', body: JSON.stringify({ title, stage }) }, store.apiToken).then(result => {
          if (!result.response?.ok) return showToast(result.body.message || '项目创建失败');
          addCreatedProject(result.body.project);
          if (store.currentView === 'workspace') store.bomProjectId = result.body.project.id;
          renderShell();
          showToast('项目已创建并写入企业空间');
        });
      }, '立项沟通');
    }
  });

  // Keep a floating menu anchored while the board or the page is scrolled.
  // The capture listener also catches the horizontal board scroller, which
  // otherwise would leave a fixed menu behind at its old screen position.
  content.addEventListener('scroll', repositionTaskShortcutMenus, true);
  window.addEventListener('resize', repositionTaskShortcutMenus);

  content.addEventListener('change', async event => {
    if (event.target.matches('[data-chat-attachment-input]')) {
      await uploadChatAttachments(event.target.files);
      return;
    }
    if (event.target.matches('[data-communication-attachment-input]')) {
      await uploadCommunicationAttachments(event.target.files);
      return;
    }
    const chatScope = event.target.closest('[data-chat-scope]');
    if (chatScope) {
      store.chatDraft = content.querySelector('#chatInput')?.value || store.chatDraft;
      store.chatScope = chatScope.value;
      const filtered = filterChatConversations(store.conversations, { filter: store.chatFilter, scope: store.chatScope, query: store.chatQuery });
      store.selectedChat = filtered[0]?.id || '';
      renderShell();
      return;
    }
    const taskControl = event.target.closest('[data-task-status][data-task-id]');
    if (taskControl) {
      const taskId = taskControl.dataset.taskId;
      const task = store.tasks.find(item => item.id === taskId);
      const nextStatus = taskControl.value;
      if (!task || !PROJECT_BOARD_STAGE_IDS.has(nextStatus)) return;
      if (!canCurrentUserChangeTaskStatus(task)) {
        taskControl.value = taskBoardStatus(task);
        return showToast('只有当前负责人可以变更任务状态');
      }
      taskControl.disabled = true;
      apiRequest(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'PUT', body: JSON.stringify({ status: nextStatus }) }, store.apiToken).then(result => {
        taskControl.disabled = false;
        if (!result.response?.ok) return showToast(result.body.message || '任务更新失败');
        Object.assign(task, result.body.task);
        renderShell();
        showToast('任务节点已更新');
      });
      return;
    }
    if (event.target.id !== 'cloudFileInput') return;
    const list = document.querySelector('#cloudUploadList');
    const files = Array.from(event.target.files || []);
    list.innerHTML = files.map(file => `<div><span>▱</span><b>${esc(file.name)}</b><small>${Math.ceil(file.size / 1024)} KB</small><em>待解析</em></div>`).join('');
    if (files.length) showToast(`已添加 ${files.length} 个文件`);
  });
  content.addEventListener('input', event => {
    if (event.target.matches('#chatInput')) { store.chatDraft = event.target.value; return; }
    if (event.target.matches('#communicationInput')) { store.communicationDraft = event.target.value; return; }
    const storageSearch = event.target.closest('[data-storage-search]');
    if (storageSearch) {
      store.storageQuery = storageSearch.value;
      const cursor = storageSearch.selectionStart;
      content.innerHTML = renderStorageSpace(store);
      const next = content.querySelector('[data-storage-search]');
      if (next) { next.focus(); next.setSelectionRange(cursor, cursor); }
      return;
    }
    const chatSearch = event.target.closest('[data-chat-search]');
    if (chatSearch) {
      store.chatQuery = chatSearch.value;
      store.chatDraft = content.querySelector('#chatInput')?.value || store.chatDraft;
      const cursor = chatSearch.selectionStart;
      content.innerHTML = renderChat(store);
      const next = content.querySelector('[data-chat-search]');
      if (next) { next.focus(); next.setSelectionRange(cursor, cursor); }
      return;
    }
    const communicationSearch = event.target.closest('[data-communication-search]');
    if (communicationSearch) {
      preserveCommunicationDraft();
      if (hasPendingCommunicationCompose()) {
        communicationSearch.value = store.communicationQuery || '';
        return showToast('请先发送或清空当前草稿再搜索');
      }
      store.communicationQuery = communicationSearch.value;
      const cursor = communicationSearch.selectionStart;
      content.innerHTML = renderCommunication(store);
      const next = content.querySelector('[data-communication-search]');
      if (next) { next.focus(); next.setSelectionRange(cursor, cursor); }
      if (store.selectedCommunication) loadCommunicationThread(store.selectedCommunication);
      return;
    }
  });
  content.addEventListener('change', event => {
    const communicationProject = event.target.closest('[data-communication-project]');
    if (!communicationProject) return;
    preserveCommunicationDraft();
    if (hasPendingCommunicationCompose()) {
      communicationProject.value = store.communicationProject;
      return showToast('当前项目沟通有未发送内容或附件，请发送或移除后再切换项目筛选');
    }
    store.communicationProject = communicationProject.value;
    store.selectedCommunication = '';
    content.innerHTML = renderCommunication(store);
    if (store.selectedCommunication) loadCommunicationThread(store.selectedCommunication);
  });
  content.addEventListener('dragstart', event => {
    const projectCard = event.target.closest('[data-project-card][data-project-id]');
      if (projectCard) {
        if (projectCard.classList.contains('is-saving') || event.target.closest('select,button,input,textarea,[contenteditable="true"]')) return event.preventDefault();
        const project = store.projects.find(item => item.id === projectCard.dataset.projectId);
        if (!canCurrentUserMoveProject(project)) {
          event.preventDefault();
          return showToast('只有当前负责人可以变更项目节点');
        }
      draggedProjectId = project.id;
      draggedProjectCard = projectCard;
      draggedTaskId = '';
      draggedTaskCard = null;
      projectCard.classList.add('dragging');
      projectCard.setAttribute('aria-grabbed', 'true');
      event.dataTransfer?.setData('text/plain', `project:${project.id}`);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      return;
    }
    const card = event.target.closest('[data-task-card][data-task-id]');
    if (!card || card.classList.contains('is-saving') || event.target.closest('select,button,input,textarea,[contenteditable="true"]')) return event.preventDefault();
    const task = store.tasks.find(item => String(item?.id || '') === String(card.dataset.taskId || ''));
    if (!canCurrentUserChangeTaskStatus(task)) {
      event.preventDefault();
      return showToast('只有当前负责人可以变更任务状态');
    }
    draggedProjectId = '';
    draggedProjectCard = null;
    draggedTaskId = card.dataset.taskId || '';
    draggedTaskCard = card;
    card.classList.add('dragging');
    card.setAttribute('aria-grabbed', 'true');
    event.dataTransfer?.setData('text/plain', draggedTaskId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  content.addEventListener('dragover', event => {
    const projectColumn = event.target.closest('[data-project-stage]');
    const projectDropzone = projectColumn?.querySelector('[data-project-dropzone]');
    if (projectColumn && projectDropzone && draggedProjectId) {
      const targetStage = projectColumn.dataset.projectStage || '';
      const project = store.projects.find(item => String(item?.id || '') === String(draggedProjectId));
      if (!PROJECT_BOARD_STAGE_IDS.has(targetStage) || !canCurrentUserMoveProject(project)) return;
      event.preventDefault();
      projectDropzone.classList.add('drag-over');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      return;
    }
    const taskColumn = event.target.closest('[data-task-board-column]');
    const dropzone = taskColumn?.querySelector('[data-task-board-dropzone]');
    if (!taskColumn || !dropzone || !draggedTaskId) return;
    const draggedTask = store.tasks.find(item => String(item?.id || '') === String(draggedTaskId));
    if (!canCurrentUserChangeTaskStatus(draggedTask)) return;
    event.preventDefault();
    dropzone.classList.add('drag-over');
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  });
  content.addEventListener('dragleave', event => {
    const projectColumn = event.target.closest('[data-project-stage]');
    if (projectColumn && !projectColumn.contains(event.relatedTarget)) projectColumn.querySelector('[data-project-dropzone]')?.classList.remove('drag-over');
    const taskColumn = event.target.closest('[data-task-board-column]');
    if (taskColumn && !taskColumn.contains(event.relatedTarget)) taskColumn.querySelector('[data-task-board-dropzone]')?.classList.remove('drag-over');
  });
  content.addEventListener('drop', event => {
    const projectColumn = event.target.closest('[data-project-stage]');
    const projectDropzone = projectColumn?.querySelector('[data-project-dropzone]');
    if (projectColumn && projectDropzone && draggedProjectId) {
      event.preventDefault();
      projectDropzone.classList.remove('drag-over');
      const projectId = draggedProjectId;
      const targetStage = projectColumn.dataset.projectStage || '';
      const project = store.projects.find(item => item.id === projectId);
      draggedProjectId = '';
      if (!canCurrentUserMoveProject(project)) return showToast('只有当前负责人可以变更项目节点');
      if (!PROJECT_BOARD_STAGE_IDS.has(targetStage) || projectBoardStage(project) === targetStage) return;
      const previousProject = { stage: project.stage, status: project.status };
      const previousProgress = project.progress;
      const projectCard = draggedProjectCard;
      Object.assign(project, { stage: targetStage, status: targetStage });
      project.progress = taskNodeProgress(targetStage) ?? project.progress;
      projectCard?.classList.add('is-saving');
      if (projectCard && projectCard.parentElement !== projectDropzone) projectDropzone.appendChild(projectCard);
      content.querySelectorAll('[data-project-stage]').forEach(column => {
        const count = column.querySelector('header span');
        if (count) count.textContent = String(column.querySelectorAll('[data-project-card]').length);
      });
      apiRequest(`/api/tasks/${encodeURIComponent(project.rootTaskId)}`, { method: 'PUT', body: JSON.stringify({ status: targetStage }) }, store.apiToken).then(result => {
        if (!result.response?.ok) {
          Object.assign(project, previousProject);
          project.progress = previousProgress;
          showToast(result.body.message || '项目节点更新失败');
          renderShell();
          return;
        }
        if (result.body.project) Object.assign(project, result.body.project);
        projectCard?.classList.remove('is-saving');
        showToast(`项目已移动到“${targetStage}”`);
      }).catch(() => {
        Object.assign(project, previousProject);
        project.progress = previousProgress;
        renderShell();
        showToast('项目节点更新失败');
      });
      return;
    }
    const taskColumn = event.target.closest('[data-task-board-column]');
    const dropzone = taskColumn?.querySelector('[data-task-board-dropzone]');
    if (!taskColumn || !dropzone || !draggedTaskId) return;
    event.preventDefault();
    dropzone.classList.remove('drag-over');
    const taskId = draggedTaskId;
    const targetStatus = taskColumn.dataset.taskBoardColumn || '';
    const task = store.tasks.find(item => item.id === taskId);
    draggedTaskId = '';
    if (!canCurrentUserChangeTaskStatus(task)) return showToast('只有当前负责人可以变更任务状态');
    if (!PROJECT_BOARD_STAGE_IDS.has(targetStatus) || taskBoardStatus(task) === targetStatus) return;
    const previousStatus = task.status;
    const previousProgress = task.progress;
    const taskCard = draggedTaskCard;
    const sourceDropzone = taskCard?.closest('[data-task-board-dropzone]');
    task.status = targetStatus;
    task.progress = taskNodeProgress(targetStatus) ?? task.progress;
    taskCard?.classList.add('is-saving');
    dropzone.querySelector('.task-board-empty')?.remove();
    if (taskCard && taskCard.parentElement !== dropzone) dropzone.appendChild(taskCard);
    const statusSelect = taskCard?.querySelector('[data-task-status]');
    if (statusSelect) statusSelect.value = targetStatus;
    if (sourceDropzone && !sourceDropzone.querySelector('[data-task-card]')) sourceDropzone.insertAdjacentHTML('beforeend', '<div class="task-board-empty">暂无任务</div>');
    content.querySelectorAll('[data-task-board-column]').forEach(column => {
      const count = column.querySelector('.task-board-column-head>b');
      if (count) count.textContent = String(column.querySelectorAll('[data-task-card]').length);
    });
    apiRequest(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'PUT', body: JSON.stringify({ status: targetStatus }) }, store.apiToken).then(result => {
      if (!result.response?.ok) {
        task.status = previousStatus;
        task.progress = previousProgress;
        showToast(result.body.message || '任务节点更新失败');
        renderShell();
        return;
      }
      Object.assign(task, result.body.task);
      taskCard?.classList.remove('is-saving');
      showToast('任务已移动到指定节点');
    }).catch(() => {
      task.status = previousStatus;
      task.progress = previousProgress;
      renderShell();
      showToast('任务节点更新失败');
    });
  });
  content.addEventListener('dragend', event => {
    const projectCard = event.target.closest('[data-project-card]');
    projectCard?.classList.remove('dragging');
    projectCard?.setAttribute('aria-grabbed', 'false');
    if (projectCard) projectDragFinishedAt = Date.now();
    const card = event.target.closest('[data-task-card]');
    card?.classList.remove('dragging');
    card?.setAttribute('aria-grabbed', 'false');
    content.querySelectorAll('.drag-over').forEach(item => item.classList.remove('drag-over'));
    draggedTaskId = '';
    draggedTaskCard = null;
    draggedProjectId = '';
    draggedProjectCard = null;
  });

  document.querySelector('#enterpriseMenu')?.addEventListener('click', () => {
    if (!store.authenticated) return showToast('请先登录企业空间');
    // In the platform console this control is a context switch, not a
    // tenant-members dialog. Opening the members modal here made the button
    // appear broken and was especially confusing after switching accounts.
    if (store.consoleMode === 'platform') return switchConsole('enterprise');
    openMembersDialog(store);
  });
  topUser?.addEventListener('click', event => { event.stopPropagation(); openAccountMenu(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    closeAccountMenu();
    const menu = content.querySelector('[data-task-shortcuts-menu]:not([hidden])');
    const trigger = menu?.closest('[data-project-card],[data-task-card]')?.querySelector('[data-task-shortcuts-trigger]');
    closeTaskShortcutMenus(); trigger?.focus();
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-task-shortcuts-menu],[data-task-shortcuts-trigger]')) closeTaskShortcutMenus();
  });
  content.addEventListener('compositionstart', event => {
    if (event.target.matches('#chatInput, #communicationInput, [data-chat-search], [data-communication-search]')) conversationInputComposing = true;
  });
  content.addEventListener('compositionend', event => {
    if (!event.target.matches('#chatInput, #communicationInput, [data-chat-search], [data-communication-search]')) return;
    conversationInputComposing = false;
    if (!chatSyncRenderPending) return;
    window.setTimeout(() => {
      if (conversationInputComposing || !chatSyncRenderPending) return;
      chatSyncRenderPending = false;
      renderSyncedConversation();
    }, 0);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return stopChatSync();
    startChatSync();
    void syncChatConversations();
  });
  content.addEventListener('click', event => {
    const jump = event.target.closest('[data-view-jump]');
    if (jump) { store.currentView = jump.dataset.viewJump; renderShell(); }
  });
  content.addEventListener('keydown', event => {
    const shortcutMenu = event.target.closest('[data-task-shortcuts-menu]');
    if (shortcutMenu && ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) {
      if (event.key === 'Tab') { closeTaskShortcutMenus(); return; }
      event.preventDefault(); event.stopPropagation();
      const actions = [...shortcutMenu.querySelectorAll('[data-task-shortcut]:not(:disabled)')];
      const index = actions.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? actions.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + actions.length) % actions.length;
      actions[next]?.focus(); return;
    }
    if (event.target.matches('#chatInput') && event.key === 'Enter' && !event.isComposing && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      content.querySelector('[data-action="send-chat"]')?.click();
      return;
    }
    if (event.target.matches('#communicationInput') && event.key === 'Enter' && !event.isComposing && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      sendCommunicationMessage();
      return;
    }
    if (!['Enter', ' '].includes(event.key)) return;
    const taskCard = event.target.closest('[data-action="edit-task"]');
    if (taskCard && !event.target.closest('button,select,input,textarea')) { event.preventDefault(); taskCard.click(); return; }
    const myTaskRow = event.target.closest('[data-my-task-row]');
    if (myTaskRow && !event.target.closest('button,select,input,textarea,a')) { event.preventDefault(); myTaskRow.click(); return; }
    const card=event.target.closest('[data-project-open]');
    if (!card || event.target.closest('button,select,input')) return;
    event.preventDefault();openProjectCardPopup(card.dataset.projectOpen);
  });

  restoreSession();
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', initCloudApp);
