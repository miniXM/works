export const NAV_ITEMS = [
  { id: 'projects', label: '项目管理', icon: '▦', iconClass: 'icon-projects', group: '项目工作' },
  { id: 'tasks', label: '我的任务', icon: '✓', iconClass: 'icon-tasks', group: '项目工作' },
  { id: 'parts', label: '零件中心', icon: '◇', iconClass: 'icon-parts', group: '制造资料' },
  { id: 'workspace', label: '制表中心', icon: '▤', iconClass: 'icon-workspace', group: '制造资料' },
  { id: 'bom', label: 'BOM 报价助手', icon: '▥', iconClass: 'icon-bom', group: '制造资料' },
  { id: 'communication', label: '项目沟通', icon: '◌', iconClass: 'icon-communication', group: '沟通协作' },
  { id: 'chat', label: '聊天信息', icon: '▣', iconClass: 'icon-chat', group: '沟通协作' },
  { id: 'stats', label: '统计', icon: '⌁', iconClass: 'icon-stats', group: '分析' }
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

function projectBoardStage(project) {
  const value = String(project?.stage || '').trim();
  if (PROJECT_BOARD_STAGE_IDS.has(value)) return value;
  if (!value || /未开始|立项|沟通/.test(value)) return '立项沟通';
  if (/询盘|询价/.test(value)) return '询盘发布';
  if (/内部报价|成本核算/.test(value)) return '内部报价';
  if (/对外报价|正式报价/.test(value)) return '对外报价';
  if (/订单|待办/.test(value)) return '订单发布/待办';
  if (/排产|加工|生产|进行中/.test(value)) return '已排产/处理中';
  if (/异常|暂停|挂起|优先/.test(value)) return '异常/优先处理';
  if (/到货|质检|检验/.test(value)) return '已到货/质检';
  if (/发货|发运|物流/.test(value)) return '发货';
  if (/完成|结束|归档|交付|结案/.test(value)) return '订单结束/已完成';
  return value;
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

export function createCloudStore() {
  return { authenticated: false, platformAdmin: false, role: '', consoleMode: 'enterprise', currentView: 'projects', query: '', selectedPart: '', selectedChat: '', selectedCommunication: '', communicationProject: '', communicationQuery: '', chatFilter: 'all', chatScope: 'all', chatQuery: '', chatDraft: '', chatDraftAttachments: [], chatUploading: false, chatSending: false, projects: [], parts: [], tasks: [], conversations: [], messages: {}, stats: null, members: [], quotes: [], fairItems: [], organizations: [], platformUsers: [], platformAudit: [], modules: Object.fromEntries(NAV_ITEMS.map(item => [item.id, true])), apiToken: '', user: null, organization: null, nav: NAV_ITEMS.map(item => ({ ...item })) };
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

function formatFileSize(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function renderProjectCard(project) {
  const progress = Math.max(0, Math.min(100, Number(project.progress) || 0));
  const step = String(project.step || '').trim() || (progress >= 100 ? '1/1' : '0/1');
  return `<article class="project-card" data-project-open="${esc(project.id || project.title)}" tabindex="0"><div class="project-card-title"><div class="project-card-name"><b title="${esc(project.title)}">${esc(project.title || '未命名项目')}</b><small>${esc(project.owner || '未指定负责人')}</small></div><button class="project-card-edit" aria-label="编辑项目" title="编辑项目" data-action="edit-project" data-project-id="${esc(project.id || '')}">✎</button></div><div class="project-card-meta"><span>${esc(project.tag || '未设置标签')}</span><em>${esc(step)}</em></div><div class="progress-row"><i><span class="${getProgressTone(progress)}" style="width:${progress}%"></span></i><small>${progress}%</small></div></article>`;
}

function renderProjects(store) {
  const filtered = filterProjects(store.projects || [], store.query);
  const customStages = filtered.map(projectBoardStage).filter(stage => !PROJECT_BOARD_STAGE_IDS.has(stage));
  const stages = [...PROJECT_BOARD_STAGES, ...[...new Set(customStages)].map(id => ({ id, label: id }))];
  const columns = stages.map(stage => {
    const projects = filtered.filter(project => projectBoardStage(project) === stage.id);
    return `<section class="kanban-column" data-project-stage="${esc(stage.id)}"><header><b>${esc(stage.label)}</b><span>${projects.length}</span></header><div class="kanban-items">${projects.map(renderProjectCard).join('')}</div><button class="add-column-button" data-create-project-stage="${esc(stage.id)}" type="button">＋ 新增</button></section>`;
  }).join('');
  return `<section class="view projects-view project-board-home"><div class="project-board-toolbar"><div><h2>项目管理</h2><span>${filtered.length}${filtered.length !== (store.projects || []).length ? ` / ${(store.projects || []).length}` : ''} 个项目</span></div><button class="primary-button" data-action="create-project">＋ 新建项目</button></div><div class="kanban-scroll"><div class="kanban-board">${columns}</div></div></section>`;
}

function renderWorkspace(store) {
  const groups = ['我的文档','共享给我','企业文档','回收站'];
  const icon = doc => String(doc.fileType || doc.title || '').toLowerCase().includes('doc') ? 'DOCX' : String(doc.fileType || doc.title || '').toLowerCase().includes('ppt') ? 'PPTX' : String(doc.fileType || doc.title || '').toLowerCase().includes('pdf') ? 'PDF' : 'XLSX';
  const actions = doc => doc.scope === '回收站' ? `<div class="document-card-actions"><button data-action="restore-office-document" data-document-id="${doc.id}">恢复</button><button class="danger" data-action="permanent-delete-office-document" data-document-id="${doc.id}">彻底删除</button></div>` : `<div class="document-card-actions"><button class="document-open" data-office-document="${doc.id}">打开</button><button data-action="rename-office-document" data-document-id="${doc.id}">重命名</button><button data-action="download-office-document" data-document-id="${doc.id}">下载</button><button class="danger" data-action="trash-office-document" data-document-id="${doc.id}">删除</button></div>`;
  return `<section class="view documents-view"><input type="file" data-office-upload accept=".docx,.xlsx,.pptx,.pdf" hidden><div class="documents-head"><div><span class="eyebrow">DOCUMENT CENTER</span><h2>文档中心</h2><p>管理当前账号可访问的 Word、Excel、PPT 和 PDF 文档。</p></div><div class="document-create-actions"><button class="outline-button" data-action="upload-office-document">上传文档</button><button class="primary-button" data-action="new-office-document" data-file-type="docx">＋ Word</button><button class="primary-button" data-action="new-office-document" data-file-type="xlsx">＋ Excel</button><button class="primary-button" data-action="new-office-document" data-file-type="pptx">＋ PPT</button></div></div><div class="documents-toolbar"><div class="document-tabs">${groups.map((g,i)=>`<button class="${i===0?'active':''}" data-document-scope="${g}">${g}<em>${OFFICE_DOCUMENTS.filter(d=>d.scope===g).length}</em></button>`).join('')}</div><input placeholder="搜索文档" data-document-search></div><div class="document-list-head"><span>文件名称</span><span>所有者</span><span>更新时间</span><span>大小</span><span>操作</span></div><div class="document-grid">${OFFICE_DOCUMENTS.map(doc=>`<article class="document-card" data-document-card data-scope="${doc.scope}" data-title="${esc(doc.title)}"><div class="document-file"><div class="document-card-icon type-${icon(doc).toLowerCase()}">${icon(doc)}</div><div class="document-card-body"><h3 title="${esc(doc.title)}">${esc(doc.title)}</h3><small>${esc(doc.permission)}</small></div></div><p class="document-owner">${esc(doc.owner)}</p><time>${esc(doc.updated)}</time><span class="document-size">${esc(doc.size)}</span>${actions(doc)}</article>`).join('')}</div></section>`;
}

function renderBomAssistant() {
  return `<section class="view embedded-workspace-view"><iframe class="embedded-workspace-frame" src="./workspace.html" title="BOM 报价助手" loading="eager"></iframe></section>`;
}

function renderParts(store) {
  const parts = store.parts || [];
  const selected = parts.find(part => part.id === store.selectedPart) || parts[0];
  if (!selected) return `<section class="view"><div class="view-intro"><div><h2>零件中心</h2><p>这里展示已经写入当前企业项目的真实零件数据。</p></div><button class="primary-button" data-action="new-part">＋ 新增零件</button></div><div class="task-empty-compact"><b>还没有零件</b><span>选择所属项目并录入零件；需要解析 STEP 时可进入 BOM 报价助手。</span><button class="primary-button" data-action="new-part">新增第一个零件</button></div></section>`;
  return `<section class="view parts-view"><div class="split-card"><aside class="parts-list"><div class="split-heading"><div class="split-heading-top"><h2>零件清单 <span>${parts.length}</span></h2><button class="small-outline" data-action="new-part">＋ 新增</button></div><div class="search-inline"><span>⌕</span><input data-part-search placeholder="按零件名搜索"></div></div><div class="parts-list-body">${parts.map(part => `<button class="part-list-item ${part.id===selected.id?'active':''}" data-part-id="${part.id}"><b>${esc(part.name)}</b><small>${esc(part.project)} · ${esc(part.order)} · ${esc(part.format)}</small><time>${esc(part.uploaded)}</time><span>♧</span></button>`).join('')}</div></aside><article class="part-detail"><header class="detail-header"><div><h2>${esc(selected.name)} <em>${esc(selected.format)}</em></h2><p>上传于 ${esc(selected.uploaded)}</p></div><div class="detail-actions"><button class="outline-button" data-action="edit-part">编辑零件</button><button class="outline-button" data-action="open-workspace">打开报价工作台</button></div></header><section class="part-preview"><div class="preview-title"><b>零件预览</b><span>本地 B-Rep 预览</span></div><div class="cad-cube" aria-label="3D 零件预览"><div class="cube-top"></div><div class="cube-front"></div><div class="cube-side"></div><span class="cube-hole"></span></div></section><section class="detail-section"><h3>基本信息</h3><div class="info-grid"><label>零件名<strong>${esc(selected.name)}</strong></label><label>格式<strong>${esc(selected.format)}</strong></label><label>所属项目<strong>${esc(selected.project)}</strong></label><label>订单号<strong>${esc(selected.order)}</strong></label><label>上传时间<strong>${esc(selected.uploaded)}</strong></label><label>数量<strong>${selected.quantity}</strong></label></div></section><section class="detail-section"><h3>尺寸体积</h3><div class="metric-strip"><div><span>尺寸 (mm)</span><b>${esc(selected.size)}</b></div><div><span>体积 (mm³)</span><b>${esc(selected.volume)}</b></div><div><span>数量</span><b>${selected.quantity}</b></div></div></section><section class="detail-section"><h3>材料工艺</h3><div class="metric-strip"><div><span>材料</span><b>${esc(selected.material)}</b></div><div><span>表面处理</span><b>${esc(selected.finish)}</b></div></div></section></article></div></section>`;
}

export function renderCommunication(store) {
  const projectConversations = store.conversations.filter(item => item.projectId);
  const conversations = filterProjectCommunications(projectConversations, { projectId: store.communicationProject, query: store.communicationQuery });
  const selected = conversations.find(item => item.id === store.selectedCommunication) || conversations[0] || null;
  if (selected && selected.id !== store.selectedCommunication) store.selectedCommunication = selected.id;
  const messages = selected ? store.messages[selected.id] : [];
  const participants = Array.isArray(messages) ? [...new Map(messages.map(message => [message.userId || message.displayName || message.username, message.displayName || message.username || '成员'])).values()] : [];
  const listMarkup = conversations.length ? conversations.map(item => `<button class="communication-item ${item.id===selected?.id?'active':''}" data-communication-id="${esc(item.id)}"><span class="avatar orange">${esc(initials(item.projectTitle || item.title) || '项')}</span><div><b>${esc(item.title)}</b><small><span>${esc(item.projectTitle || '未命名项目')}</span>${item.preview ? ` · ${esc(item.lastSender || '成员')}：${esc(item.preview)}` : ' · 尚未开始讨论'}</small></div><time>${esc(formatConversationTime(item.lastMessageAt || item.createdAt))}</time>${item.messageCount ? `<em>${item.messageCount}</em>` : ''}</button>`).join('') : `<div class="communication-list-empty"><b>${projectConversations.length ? '没有匹配的沟通' : '还没有项目沟通'}</b><span>${projectConversations.length ? '调整项目或关键词后重试' : '发起一个主题，集中记录项目决策'}</span><button class="small-outline" data-action="create-communication">发起沟通</button></div>`;
  const messageMarkup = !selected ? `<div class="communication-detail-empty"><span>▤</span><b>选择一条项目沟通</b><button class="primary-button" data-action="create-communication">发起沟通</button></div>`
    : !Array.isArray(messages) ? '<div class="communication-loading">正在加载讨论...</div>'
      : messages.length ? messages.map(message => { const author = message.displayName || message.username || '成员'; const mine = message.userId === store.user?.id; return `<div class="communication-message ${mine ? 'mine' : ''}"><span class="avatar ${mine ? 'blue' : 'gray'}">${esc(initials(author))}</span><div><header><b>${esc(author)}</b><time>${esc(new Date(message.createdAt).toLocaleString('zh-CN'))}</time></header><p>${esc(message.body)}</p></div></div>`; }).join('')
        : '<div class="communication-thread-empty"><b>还没有回复</b><span>在下方写下第一条项目记录</span></div>';
  return `<section class="view communication-view"><div class="split-card communication-card"><aside class="communication-list"><div class="split-heading communication-heading"><div class="split-heading-top"><h2>项目沟通 <span>${projectConversations.length}</span></h2><button class="small-outline" data-action="create-communication">＋ 发起</button></div><label class="communication-search"><span>⌕</span><input data-communication-search value="${esc(store.communicationQuery || '')}" placeholder="搜索主题或消息"></label><select data-communication-project aria-label="按项目筛选"><option value="">全部项目</option>${store.projects.map(project => `<option value="${esc(project.id)}" ${store.communicationProject === project.id ? 'selected' : ''}>${esc(project.title)}</option>`).join('')}</select></div><div class="communication-list-body">${listMarkup}</div></aside><article class="communication-detail">${selected ? `<header class="communication-top"><div><span class="communication-project-mark">${esc(initials(selected.projectTitle) || '项')}</span><div><b>${esc(selected.title)}</b><button data-action="open-communication-project" title="打开关联项目">${esc(selected.projectTitle || '关联项目')} ›</button></div></div><div class="communication-participants" title="参与讨论的成员">${participants.slice(0, 4).map(name => `<span>${esc(initials(name))}</span>`).join('')}<small>${participants.length || 1} 人参与</small></div></header><div class="communication-context"><span>项目讨论</span><b>${esc(selected.projectTitle || '未命名项目')}</b><em>${Number(selected.messageCount || (Array.isArray(messages) ? messages.length : 0))} 条消息</em></div>` : ''}<div class="communication-thread" data-communication-thread>${messageMarkup}</div>${selected ? `<footer class="communication-compose"><textarea id="communicationInput" rows="2" maxlength="4000" placeholder="输入回复，Enter 发送 / Ctrl + Enter 换行"></textarea><div><span>消息将保存到项目动态</span><button class="primary-button" data-action="send-communication">发送</button></div></footer>` : ''}</article></div></section>`;
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
  // Project cards are the project-level work items; avoid showing stale standalone test tasks with the same title twice.
  const projectTitles = new Set((store.projects || []).map(project => String(project.title || '').trim().toLowerCase()).filter(Boolean));
  const source = (store.tasks || []).filter(task => !projectTitles.has(String(task.title || '').trim().toLowerCase()));
  const filtered = store.query ? source.filter(task => [task.title, task.stage, task.owner, task.description].some(value => String(value || '').toLowerCase().includes(store.query.toLowerCase()))) : source;
  return `<section class="view tasks-view"><div class="view-intro"><div><h2>我的任务</h2><p>只显示当前企业和当前账号可见的任务。</p></div><button class="primary-button" data-action="create-task">＋ 新建任务</button></div><div class="table-card"><header class="table-card-head"><h2>任务清单</h2><span>${filtered.length} 项</span></header>${filtered.length ? `<div class="task-table-wrap"><table class="task-table"><thead><tr><th>任务</th><th>分组</th><th>负责人</th><th>进度</th><th>状态</th></tr></thead><tbody>${filtered.map(task => { const progress = Math.max(0, Math.min(100, Number(task.progress) || 0)); return `<tr data-action="edit-task" data-task-id="${esc(task.id || '')}"><td><b>${esc(task.title)}</b></td><td>${esc(task.stage || '未分组')}</td><td>${esc(task.owner || '未分配')}</td><td><div class="task-progress"><input class="task-progress-input task-progress-range" data-task-id="${esc(task.id || '')}" type="range" min="0" max="100" step="1" value="${progress}" style="--progress-value:${progress}%" aria-label="调整 ${esc(task.title)} 的进度"><output>${progress}%</output></div></td><td><select class="task-status-select" data-task-id="${esc(task.id || '')}"><option ${task.status==='待处理'?'selected':''}>待处理</option><option ${task.status==='进行中'?'selected':''}>进行中</option><option ${task.status==='阻塞'?'selected':''}>阻塞</option><option ${task.status==='已完成'?'selected':''}>已完成</option></select></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="task-empty-compact"><b>还没有任务</b><span>从一个具体行动开始，创建后再分配负责人和截止日期。</span><button class="primary-button" data-action="create-task">新建第一个任务</button></div>'}</div></section>`;
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
  const moduleLabels = { projects: '项目管理', workspace: '制表中心', bom: 'BOM 报价助手', parts: '零件中心', communication: '项目沟通', chat: '聊天信息', tasks: '我的任务', stats: '统计' };
  return `<section class="view platform-view"><div class="view-intro"><div><h2>企业管理</h2><p>管理平台内的租户企业、启用状态和企业功能模块。</p></div><button class="primary-button" data-action="create-organization">＋ 新建企业</button></div><div class="table-card"><header class="table-card-head"><h2>全部企业</h2><span>${store.organizations.length} 家</span></header><div class="task-table-wrap"><table class="task-table"><thead><tr><th>企业</th><th>标识</th><th>成员</th><th>项目</th><th>已开通模块</th><th>操作</th></tr></thead><tbody>${store.organizations.map(org => `<tr><td><b>${esc(org.name)}</b></td><td>${esc(org.slug)}</td><td>${org.memberCount}</td><td>${org.projectCount}</td><td><div class="module-pills">${Object.entries(org.modules || {}).filter(([, enabled]) => enabled).map(([key]) => `<em>${moduleLabels[key] || key}</em>`).join('') || '<em>仅基础空间</em>'}</div></td><td><button class="small-outline" data-organization-id="${esc(org.id)}" data-action="configure-organization">配置模块</button> <button class="small-outline" data-organization-id="${esc(org.id)}" data-action="enter-enterprise">进入企业</button></td></tr>`).join('')}</tbody></table></div></div></section>`;
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
    case 'platform-overview': return renderPlatformOverview(store);
    case 'organizations': return renderOrganizations(store);
    case 'platform-users': return renderPlatformUsers(store);
    case 'platform-audit': return renderPlatformAudit(store);
    case 'workspace': return renderWorkspace(store);
    case 'bom': return renderBomAssistant(store);
    case 'parts': return renderParts(store);
    case 'communication': return renderCommunication(store);
    case 'chat': return renderChat(store);
    case 'tasks': return renderTasks(store);
    case 'stats': return renderStats(store);
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
  document.body.appendChild(host); const close = () => host.remove(); host.querySelectorAll('[data-close]').forEach(button => button.onclick = close); host.querySelector('form').onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); submit({ title: data.get('title'), stage: data.get('stage'), tag: data.get('tag'), progress: Number(data.get('progress')) }); close(); }; host.querySelector('input').focus();
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

function openOrganizationDialog(submit) {
  document.querySelector('#organizationDialog')?.remove();
  const host = document.createElement('div'); host.id = 'organizationDialog'; host.className = 'project-dialog-backdrop';
  const modules = [['projects','项目管理'],['workspace','制表中心'],['bom','BOM 报价助手'],['parts','零件中心'],['communication','项目沟通'],['chat','聊天信息'],['tasks','我的任务'],['stats','统计']];
  host.innerHTML = `<section class="project-dialog" role="dialog" aria-modal="true"><header><div><small>NEW ORGANIZATION</small><h2>新建企业</h2></div><button type="button" data-close>×</button></header><form><label>企业名称<input name="name" maxlength="120" placeholder="例如：苏州精密制造有限公司" required></label><label>企业标识<input name="slug" maxlength="80" pattern="[a-z0-9-]+" placeholder="例如：suzhou-precision" required></label><p class="muted-note">初始开通功能</p>${modules.map(([key,label]) => `<label class="module-toggle"><input type="checkbox" name="${key}" checked> <span>${label}</span></label>`).join('')}<footer><button type="button" class="outline-button" data-close>取消</button><button type="submit" class="primary-button">创建企业</button></footer></form></section>`;
  document.body.appendChild(host); const close = () => host.remove(); host.querySelectorAll('[data-close]').forEach(button => button.onclick = close); host.querySelector('form').onsubmit = event => { event.preventDefault(); const form = new FormData(event.currentTarget); submit({ name: String(form.get('name') || '').trim(), slug: String(form.get('slug') || '').trim().toLowerCase(), modules: Object.fromEntries(modules.map(([key]) => [key, form.has(key)])) }); close(); }; host.querySelector('input').focus();
}

function openTaskDialog(store, submit, defaults = {}, existing = null) {
  const host = document.createElement('div'); host.className = 'project-dialog-backdrop';
  const members = store.members?.length ? store.members : [{ id: store.user?.id || '', displayName: store.user?.displayName || '我', username: store.user?.username || 'admin' }];
  const value = (key, fallback = '') => existing?.[key] ?? defaults[key] ?? fallback;
  const status = value('status', '待处理');
  const progress = Math.max(0, Math.min(100, Number(value('progress', 0)) || 0));
  host.innerHTML = `<section class="project-dialog task-dialog" role="dialog" aria-modal="true"><header><div><small>${existing ? 'EDIT TASK' : 'NEW TASK'}</small><h2>${existing ? '编辑任务' : '新建任务'}</h2></div><button type="button" data-close aria-label="关闭">×</button></header><form><label>任务名称<input name="title" maxlength="160" value="${esc(value('title'))}" placeholder="例如：确认客户图纸版本" required></label><label>任务描述<textarea name="description" rows="4" maxlength="4000" placeholder="补充背景、交付标准或协作信息">${esc(value('description'))}</textarea></label><div class="dialog-grid"><label>所属项目<select name="projectId"><option value="">不关联项目</option>${store.projects.map(project => `<option value="${esc(project.id)}" ${project.id === value('projectId') ? 'selected' : ''}>${esc(project.title)}</option>`).join('')}</select></label><label>分组 / 标签<input name="stage" maxlength="80" value="${esc(value('stage', '未分组'))}" placeholder="例如：客户沟通、设计评审"></label></div><div class="dialog-grid"><label>负责人<select name="assigneeUserId">${members.map(member => `<option value="${esc(member.id)}" ${member.id === (value('assigneeUserId') || store.user?.id) ? 'selected' : ''}>${esc(member.displayName || member.username)}</option>`).join('')}</select></label><label>优先级<select name="priority">${['普通','高','紧急'].map(item => `<option ${item === value('priority', '普通') ? 'selected' : ''}>${item}</option>`).join('')}</select></label></div><div class="dialog-grid"><label>截止日期<input name="dueAt" type="date" value="${esc(value('dueAt'))}"></label><label>进度<div class="task-progress-field dialog-progress-field"><input name="progress" class="task-progress-range" type="range" min="0" max="100" step="1" value="${progress}" style="--progress-value:${progress}%"><output>${progress}%</output></div></label></div><label>状态<select name="status">${['待处理','进行中','阻塞','已完成'].map(item => `<option ${item === status ? 'selected' : ''}>${item}</option>`).join('')}</select></label><footer><button type="button" class="outline-button" data-close>取消</button><button type="submit" class="primary-button">${existing ? '保存任务' : '创建任务'}</button></footer></form></section>`;
  document.body.appendChild(host); const close = () => host.remove(); host.querySelectorAll('[data-close]').forEach(button => button.onclick = close); host.addEventListener('click', event => { if (event.target === host) close(); }); host.querySelector('.task-progress-range').addEventListener('input', event => { event.target.style.setProperty('--progress-value', `${event.target.value}%`); event.target.nextElementSibling.value = `${event.target.value}%`; event.target.nextElementSibling.textContent = `${event.target.value}%`; }); host.querySelector('form').onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); submit({ title: String(data.get('title') || '').trim(), description: String(data.get('description') || '').trim(), projectId: String(data.get('projectId') || ''), stage: String(data.get('stage') || '').trim() || '未分组', assigneeUserId: String(data.get('assigneeUserId') || ''), priority: data.get('priority'), dueAt: data.get('dueAt'), progress: Number(data.get('progress') || 0), status: data.get('status') }); close(); }; host.querySelector('input').focus();
}

const TASK_IMPORT_FIELDS = [
  { key: 'title', label: '任务名称', aliases: ['title', 'name', 'task', 'taskname', '任务', '任务名称', '标题'], required: true },
  { key: 'description', label: '描述', aliases: ['description', 'desc', 'note', '备注', '描述', '说明'] },
  { key: 'stage', label: '分组 / 标签', aliases: ['stage', 'group', 'list', 'column', '分组', '标签', '阶段'] },
  { key: 'owner', label: '负责人', aliases: ['owner', 'assignee', 'executor', '负责人', '执行者', '责任人'] },
  { key: 'priority', label: '优先级', aliases: ['priority', 'level', '优先级'] },
  { key: 'status', label: '状态', aliases: ['status', 'state', '状态'] },
  { key: 'progress', label: '进度', aliases: ['progress', 'percent', '完成度', '进度'] },
  { key: 'startAt', label: '开始日期', aliases: ['startat', 'start', 'startdate', '开始日期', '开始时间'] },
  { key: 'dueAt', label: '截止日期', aliases: ['dueat', 'due', 'duedate', 'deadline', '截止日期', '截止时间'] },
  { key: 'project', label: '所属项目', aliases: ['project', 'projectname', '项目', '项目名称'] }
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
    const projects = store.projects || [];
    const defaultProjectId = options.projectId || '';
    const normalizeChoice = (value, values, fallback) => { const text = String(value || '').trim(); const hit = values.find(item => item === text || item.includes(text) || text.includes(item)); return hit || fallback; };
    const memberFor = value => { const text = String(value || '').trim().toLowerCase(); return members.find(member => [member.id, member.username, member.displayName].some(candidate => String(candidate || '').trim().toLowerCase() === text)) || members.find(member => member.id === store.user?.id) || members[0]; };
    let success = 0, failed = 0;
    for (const row of state.rows) {
      const title = String(taskImportValue(row, state.mapping, 'title') || '').trim();
      if (!title) { failed += 1; continue; }
      const member = memberFor(taskImportValue(row, state.mapping, 'owner'));
      const projectText = String(taskImportValue(row, state.mapping, 'project') || '').trim();
      const project = projects.find(item => item.id === projectText || item.title === projectText) || projects.find(item => item.id === defaultProjectId);
      const rawProgress = Number(String(taskImportValue(row, state.mapping, 'progress')).replace('%', ''));
      const payload = { title, description: String(taskImportValue(row, state.mapping, 'description') || '').trim(), projectId: project?.id || defaultProjectId || '', stage: String(taskImportValue(row, state.mapping, 'stage') || '未分组').trim() || '未分组', assigneeUserId: member?.id || '', priority: normalizeChoice(taskImportValue(row, state.mapping, 'priority'), ['普通', '高', '紧急'], '普通'), status: normalizeChoice(taskImportValue(row, state.mapping, 'status'), ['待处理', '进行中', '阻塞', '已完成'], '待处理'), progress: Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : 0, startAt: String(taskImportValue(row, state.mapping, 'startAt') || '').trim() || null, dueAt: String(taskImportValue(row, state.mapping, 'dueAt') || '').trim() || null };
      const result = await apiRequest('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }, store.apiToken);
      if (!result.response?.ok) { failed += 1; continue; }
      success += 1;
      store.tasks = [result.body.task, ...(store.tasks || [])];
      if (options.workspace && result.body.task.projectId === defaultProjectId) options.workspace.tasks = [result.body.task, ...(options.workspace.tasks || [])];
    }
    if (success && typeof options.onImported === 'function') options.onImported();
    if (failed) { status.textContent = `已导入 ${success} 条，${failed} 条失败（缺少任务名称或数据无效）。`; submitButton.disabled = false; }
    else { close(); showToast(`已导入 ${success} 条任务`); }
  };
}

export function openTaskDetail(store, detail, options = {}) {
  document.querySelector('#taskDetail')?.remove();
  const host = document.createElement('div');
  host.id = 'taskDetail';
  host.className = 'task-detail-backdrop';
  const projectRecord = options.projectRecord || null;
  const workspace = options.workspace?.project?.id === detail?.task?.projectId || options.projectDraft || projectRecord ? options.workspace : null;
  const project = projectRecord || store.projects.find(item => item.id === detail?.task?.projectId) || workspace?.project;
  if (!detail?.task) {
    detail = { task: { id: project?.id || `draft-${Date.now()}`, title: project?.title || '新建任务', projectId: project?.id || '', status: project?.stage || '待处理', priority: project?.priority || '普通', progress: Number(project?.progress || 0), owner: project?.owner || store.user?.displayName || '未分配', description: project?.description || '', stage: project?.tag || '未分组', startAt: project?.startAt || '', dueAt: project?.dueAt || '' }, subtasks: [], comments: options.workspace?.comments || [], activities: options.workspace?.activities || [] };
  }
  let isDraft = Boolean(options.projectDraft);
  let isProjectRecord = Boolean(projectRecord);
  const members = store.members?.length ? store.members : [{ id: store.user?.id || detail.task.assigneeUserId, displayName: store.user?.displayName || detail.task.owner, username: store.user?.username || 'admin' }];
  const initialAssignee = members.find(member => member.id === detail.task.assigneeUserId) || members.find(member => (member.displayName || member.username) === detail.task.owner) || members[0];
  const resources = [
    ...((workspace?.parts || store.parts.filter(item => item.projectId === detail.task.projectId))).slice(0, 4).map(item => ({ kind: '零件', title: item.name })),
    ...((workspace?.quotes || store.quotes.filter(item => item.projectId === detail.task.projectId))).slice(0, 3).map(item => ({ kind: '报价', title: item.quoteNo })),
    ...((workspace?.documents || OFFICE_DOCUMENTS.filter(item => item.projectId === detail.task.projectId))).slice(0, 4).map(item => ({ kind: '文档', title: item.title }))
  ];
  const fieldLabels = { title: '标题', description: '备注', stage: '标签', owner: '执行者', assigneeUserId: '执行者', progress: '进度', status: '状态', priority: '优先级', startAt: '开始日期', dueAt: '截止日期', tag: '标签', step: '步骤' };
  const activityText = item => {
    if (item.action === 'task.create' || item.action === 'project.create') return item.action.startsWith('project') ? '创建了项目' : '创建了任务';
    if (item.action.endsWith('comment.create')) return '发表了评论';
    const changed = item.metadata?.changed || {};
    const entries = Object.entries(changed).filter(([key]) => key !== 'assigneeUserId');
    if (!entries.length) return '更新了信息';
    return entries.slice(0, 2).map(([key, value]) => `将${fieldLabels[key] || key}改为“${value?.to ?? ''}”`).join('，');
  };
  const close = () => {
    document.removeEventListener('keydown', escape);
    host.remove();
    if (typeof options.onClose === 'function') return options.onClose();
  };
  const escape = event => {
    if (event.key !== 'Escape') return;
    const picker = host.querySelector('[data-assignee-picker]');
    if (picker?.classList.contains('open')) { picker.classList.remove('open'); return; }
    close();
  };
  const syncTask = updated => {
    Object.assign(detail.task, updated);
    const globalTask = store.tasks.find(item => item.id === updated.id);
    const projectTask = workspace?.tasks?.find(item => item.id === updated.id);
    if (globalTask) Object.assign(globalTask, updated);
    if (projectTask) Object.assign(projectTask, updated);
  };
  const saveFields = async payload => {
    const changed = {};
    for (const [key, nextValue] of Object.entries(payload)) {
      if (key === 'assigneeUserId') {
        const nextAssignee = members.find(member => member.id === nextValue);
        const nextName = nextAssignee?.displayName || nextAssignee?.username || '未分配';
        if (detail.task.owner !== nextName) changed.owner = { from: detail.task.owner || '', to: nextName };
        continue;
      }
      const previousValue = detail.task[key] ?? '';
      if (previousValue !== nextValue) changed[key] = { from: previousValue, to: nextValue ?? '' };
    }
    const projectPayload = { ...payload };
    if (Object.hasOwn(projectPayload, 'status')) { projectPayload.stage = projectPayload.status; delete projectPayload.status; }
    else if (Object.hasOwn(projectPayload, 'stage')) { projectPayload.tag = projectPayload.stage; delete projectPayload.stage; }
    if (Object.hasOwn(projectPayload, 'assigneeUserId')) {
      const assignee = members.find(member => member.id === projectPayload.assigneeUserId);
      if (assignee) projectPayload.owner = assignee.displayName || assignee.username;
      delete projectPayload.assigneeUserId;
    }
    const result = await apiRequest(isProjectRecord ? `/api/projects/${encodeURIComponent(project.id)}` : (isDraft ? '/api/tasks' : `/api/tasks/${encodeURIComponent(detail.task.id)}`), { method: 'PUT', body: JSON.stringify(isProjectRecord ? projectPayload : (isDraft ? { ...detail.task, ...payload, projectId: project?.id || detail.task.projectId } : payload)) }, store.apiToken);
    if (!result.response?.ok) { showToast(result.body.message || '任务保存失败'); return false; }
    if (isProjectRecord) {
      const updatedProject = result.body.project || {};
      Object.assign(project, updatedProject);
      Object.assign(detail.task, updatedProject);
      const storeProject = store.projects.find(item => item.id === project.id);
      if (storeProject && storeProject !== project) Object.assign(storeProject, updatedProject);
      if (workspace?.project && workspace.project !== project) Object.assign(workspace.project, updatedProject);
      renderShell();
    }
    else if (isDraft) { detail.task = result.body.task; isDraft = false; store.tasks = [result.body.task, ...(store.tasks || [])]; if (workspace) workspace.tasks = [result.body.task, ...(workspace.tasks || [])]; }
    else syncTask(result.body.task);
    if (Object.keys(changed).length) {
      detail.activities = [{ id: `local-${Date.now()}`, action: isProjectRecord ? 'project.update' : 'task.update', username: store.user?.username || store.user?.displayName || '我', metadata: { changed }, createdAt: new Date().toISOString() }, ...(detail.activities || [])];
      const activeFeed = host.querySelector('[data-task-feed].active')?.dataset.taskFeed || 'all';
      host.querySelector('[data-task-feed-list]').innerHTML = feedMarkup(activeFeed);
    }
    showToast('任务已保存'); return true;
  };
  const feedMarkup = filter => {
    const comments = (detail.comments || []).map(item => ({ type: 'comment', body: item.body, username: item.displayName || item.username, createdAt: item.createdAt }));
    const activities = (detail.activities || []).map(item => ({ type: 'activity', body: activityText(item), username: item.username || '系统', createdAt: item.createdAt }));
    const rows = [...comments, ...(filter === 'comments' ? [] : activities)].filter(item => filter !== 'comments' || item.type === 'comment').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return rows.length ? rows.map(item => `<article class="task-feed-row type-${item.type}"><span class="member-avatar small">${esc(String(item.username || '系').slice(0, 1))}</span><div><p>${item.type === 'comment' ? `<b>${esc(item.username || '系统')}</b>${esc(item.body)}` : `<span><b>${esc(item.username || '系统')}</b> ${esc(item.body)}</span>`}</p><time>${new Date(item.createdAt).toLocaleString('zh-CN')}</time></div></article>`).join('') : '<div class="task-feed-empty">还没有动态</div>';
  };
  host.innerHTML = `<section class="task-detail-shell" role="dialog" aria-modal="true" aria-labelledby="taskDetailTitle">
    <header class="task-detail-topbar"><span class="task-type-badge"><i>⌄</i> 任务</span><nav><button type="button" data-copy-task-link title="复制任务链接" aria-label="复制任务链接">↗</button><button type="button" data-close-task-detail title="关闭" aria-label="关闭">×</button></nav></header>
    <div class="task-detail-layout"><main class="task-detail-main"><div class="task-detail-main-inner">
      <input id="taskDetailTitle" class="task-detail-title" name="title" maxlength="160" value="${esc(detail.task.title)}" aria-label="任务名称">
      <section class="task-property-list">
        <div><label><span>☑</span>状态</label><select data-task-field="status">${['待处理','进行中','阻塞','已完成'].map(value => `<option ${detail.task.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
        <div><label><span>♙</span>执行者</label><div class="assignee-picker" data-assignee-picker><button type="button" class="assignee-picker-trigger" data-assignee-trigger aria-haspopup="listbox" aria-expanded="false"><span class="member-avatar small" data-assignee-avatar>${esc(String(initialAssignee?.displayName || initialAssignee?.username || '未').slice(0, 1))}</span><b data-assignee-name>${esc(initialAssignee?.displayName || initialAssignee?.username || '未分配')}</b><i>⌄</i></button><div class="assignee-picker-popover"><div class="assignee-picker-search"><span>⌕</span><input type="search" data-assignee-search placeholder="搜索成员" autocomplete="off"></div><div class="assignee-picker-list" role="listbox">${members.map(member => { const name = member.displayName || member.username; return `<button type="button" role="option" data-assignee-id="${esc(member.id)}" data-assignee-label="${esc(name)}" aria-selected="${member.id === initialAssignee?.id}"><span class="member-avatar">${esc(String(name).slice(0, 1))}</span><span><b>${esc(name)}</b><small>@${esc(member.username || '')}</small></span><i>✓</i></button>`; }).join('')}</div><p class="assignee-picker-empty">没有匹配的成员</p></div></div></div>
        <div><label><span>▣</span>时间</label><div class="task-date-range"><input data-task-field="startAt" type="date" value="${esc(detail.task.startAt || '')}" aria-label="开始日期"><i>至</i><input data-task-field="dueAt" type="date" value="${esc(detail.task.dueAt || '')}" aria-label="截止日期"></div></div>
        <div><label><span>◇</span>项目</label><div class="task-project-reference"><span class="member-avatar small">${esc(String(project?.title || '项').slice(0, 1))}</span><b>${esc(project?.title || '未关联项目')}</b><i>/</i><span>${esc(detail.task.stage || '未分组')}</span></div></div>
        <div class="task-property-note"><label><span>▤</span>备注</label><textarea data-task-field="description" rows="4" maxlength="4000" placeholder="添加任务说明、验收标准或协作信息">${esc(detail.task.description || '')}</textarea></div>
        <div><label><span>⚑</span>优先级</label><select data-task-field="priority">${['普通','高','紧急'].map(value => `<option ${detail.task.priority === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
        <div><label><span>◇</span>标签</label><input data-task-field="stage" maxlength="80" value="${esc(detail.task.stage || '未分组')}" placeholder="添加标签"></div>
        <div><label><span>◔</span>进度</label><div class="task-progress-field"><input data-task-field="progress" class="task-progress-range" type="range" min="0" max="100" step="1" value="${Math.max(0, Math.min(100, Number(detail.task.progress) || 0))}" style="--progress-value:${Math.max(0, Math.min(100, Number(detail.task.progress) || 0))}%" aria-label="调整任务进度"><output>${Math.max(0, Math.min(100, Number(detail.task.progress) || 0))}%</output></div></div>
      </section>
      <section class="task-detail-section"><h3>关联内容 <small>${resources.length}</small></h3>${resources.length ? `<div class="task-related-list">${resources.map(item => `<article><span>${esc(item.kind)}</span><b>${esc(item.title)}</b></article>`).join('')}</div>` : '<div class="task-related-empty"><span>＋</span><div><b>暂无关联内容</b><p>项目中的零件、报价和文档会显示在这里。</p></div></div>'}</section>
    </div></main><aside class="task-detail-aside">
      <section class="task-participants"><h3>参与者 <small>1</small></h3><div><span class="member-avatar" data-participant-avatar>${esc(String(initialAssignee?.displayName || initialAssignee?.username || detail.task.owner || '未').slice(0, 1))}</span><b data-participant-name>${esc(initialAssignee?.displayName || initialAssignee?.username || detail.task.owner || '未分配')}</b></div></section>
      <section class="task-feed"><nav><button class="active" data-task-feed="all">所有动态</button><button data-task-feed="comments">仅评论</button><button data-task-feed-action="search" title="搜索动态" aria-label="搜索动态">⌕</button><button data-task-feed-action="filter" title="筛选动态" aria-label="筛选动态">♧</button></nav><div data-task-feed-list>${feedMarkup('all')}</div></section>
      <form class="task-comment-compose" data-task-comment><textarea name="body" rows="3" maxlength="4000" placeholder="请输入评论，Enter 发送 / Ctrl + Enter 换行"></textarea><footer><span>⌕ ☺</span><button type="submit">回复</button></footer></form>
    </aside></div>
  </section>`;
  document.body.appendChild(host); document.addEventListener('keydown', escape);
  host.querySelector('[data-close-task-detail]').onclick = close;
  host.querySelector('[data-copy-task-link]').onclick = () => {
    const taskUrl = new URL(location.href);
    taskUrl.hash = '';
    taskUrl.searchParams.set(isProjectRecord ? 'project' : 'task', detail.task.id);
    navigator.clipboard?.writeText(taskUrl.toString()).then(() => showToast('任务链接已复制')).catch(() => showToast('复制失败'));
  };
  host.querySelectorAll('[data-task-field]').forEach(control => {
    if (control.type === 'range') {
      control.addEventListener('input', () => {
        control.style.setProperty('--progress-value', `${control.value}%`);
        control.nextElementSibling.value = `${control.value}%`;
        control.nextElementSibling.textContent = `${control.value}%`;
      });
      control.addEventListener('change', () => saveFields({ [control.dataset.taskField]: Number(control.value) }));
      return;
    }
    control.addEventListener(control.tagName === 'TEXTAREA' || control.tagName === 'INPUT' && control.type === 'text' ? 'blur' : 'change', () => saveFields({ [control.dataset.taskField]: control.type === 'number' ? Number(control.value) : control.value }));
  });
  const assigneePicker = host.querySelector('[data-assignee-picker]');
  const assigneeTrigger = host.querySelector('[data-assignee-trigger]');
  const assigneeSearch = host.querySelector('[data-assignee-search]');
  const closeAssigneePicker = () => { assigneePicker.classList.remove('open'); assigneeTrigger.setAttribute('aria-expanded', 'false'); };
  assigneeTrigger.onclick = () => {
    const open = !assigneePicker.classList.contains('open');
    assigneePicker.classList.toggle('open', open);
    assigneeTrigger.setAttribute('aria-expanded', String(open));
    if (open) { assigneeSearch.value = ''; assigneeSearch.dispatchEvent(new Event('input')); setTimeout(() => assigneeSearch.focus(), 0); }
  };
  assigneeSearch.addEventListener('input', () => {
    const query = assigneeSearch.value.trim().toLowerCase();
    let visible = 0;
    host.querySelectorAll('[data-assignee-id]').forEach(button => { const match = !query || button.textContent.toLowerCase().includes(query); button.hidden = !match; if (match) visible += 1; });
    host.querySelector('.assignee-picker-empty').classList.toggle('visible', visible === 0);
  });
  host.querySelectorAll('[data-assignee-id]').forEach(button => button.onclick = async () => {
    const member = members.find(item => item.id === button.dataset.assigneeId);
    if (!member) return;
    const saved = await saveFields({ assigneeUserId: member.id });
    if (!saved) return;
    const name = member.displayName || member.username;
    detail.task.assigneeUserId = member.id;
    detail.task.owner = name;
    host.querySelector('[data-assignee-name]').textContent = name;
    host.querySelector('[data-assignee-avatar]').textContent = name.slice(0, 1);
    host.querySelector('[data-participant-name]').textContent = name;
    host.querySelector('[data-participant-avatar]').textContent = name.slice(0, 1);
    host.querySelectorAll('[data-assignee-id]').forEach(item => item.setAttribute('aria-selected', String(item === button)));
    closeAssigneePicker();
  });
  host.addEventListener('click', event => { if (!assigneePicker.contains(event.target)) closeAssigneePicker(); });
  host.querySelector('.task-detail-title').addEventListener('blur', event => { const title = event.target.value.trim(); if (!title) { event.target.value = detail.task.title; return showToast('任务名称不能为空'); } if (title !== detail.task.title) saveFields({ title }); });
  host.querySelectorAll('[data-task-feed]').forEach(button => button.onclick = () => { host.querySelectorAll('[data-task-feed]').forEach(item => item.classList.toggle('active', item === button)); host.querySelector('[data-task-feed-list]').innerHTML = feedMarkup(button.dataset.taskFeed); });
  host.querySelector('[data-task-comment]').onsubmit = async event => { event.preventDefault(); const input = event.currentTarget.elements.body; const body = input.value.trim(); if (!body) return; const endpoint = isProjectRecord ? `/api/projects/${encodeURIComponent(project.id)}/comments` : `/api/tasks/${encodeURIComponent(detail.task.id)}/comments`; const result = await apiRequest(endpoint, { method: 'POST', body: JSON.stringify({ body }) }, store.apiToken); if (!result.response?.ok) return showToast(result.body.message || '评论发送失败'); detail.comments.push(result.body.comment); input.value = ''; host.querySelector('[data-task-feed-list]').innerHTML = feedMarkup('all'); host.querySelectorAll('[data-task-feed]').forEach(item => item.classList.toggle('active', item.dataset.taskFeed === 'all')); };
  host.querySelector('[data-task-comment] textarea').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.ctrlKey) { event.preventDefault(); host.querySelector('[data-task-comment]').requestSubmit(); } });
}

// Project cards open in a modal so the originating view remains intact underneath.
function openPartDialog(store, submit, defaults = {}) {
  document.querySelector('#partDialog')?.remove();
  const host = document.createElement('div');
  host.id = 'partDialog';
  host.className = 'project-dialog-backdrop';
  const projects = store.projects || [];
  host.innerHTML = `<section class="project-dialog" role="dialog" aria-modal="true" aria-labelledby="partDialogTitle"><header><div><small>NEW PART</small><h2 id="partDialogTitle">新增零件</h2></div><button type="button" data-part-dialog-close aria-label="关闭">×</button></header><form><label>零件名称<input name="name" maxlength="160" placeholder="例如：Fibula Plate" required></label><label>归属项目<select name="projectId">${projects.map(project => `<option value="${esc(project.id || project.title)}" ${(project.id || project.title) === defaults.projectId ? 'selected' : ''}>${esc(project.title)}</option>`).join('')}</select></label><div class="dialog-grid"><label>格式<select name="format"><option>STEP</option><option>STP</option><option>PDF</option></select></label><label>数量<input name="quantity" type="number" min="1" value="1"></label></div><label>材料<input name="material" value="Aluminum 6061"></label><footer><button type="button" class="outline-button" data-part-dialog-close>取消</button><button type="submit" class="primary-button">保存零件</button></footer></form></section>`;
  document.body.appendChild(host);
  const close = () => host.remove();
  host.querySelectorAll('[data-part-dialog-close]').forEach(button => button.addEventListener('click', close));
  host.addEventListener('click', event => { if (event.target === host) close(); });
  host.querySelector('form').addEventListener('submit', event => { event.preventDefault(); const form = new FormData(event.currentTarget); submit({ name: String(form.get('name') || '').trim(), projectId: String(form.get('projectId') || ''), format: String(form.get('format') || 'STEP'), material: String(form.get('material') || ''), quantity: Number(form.get('quantity') || 1) }); close(); });
  host.querySelector('input').focus();
}

function openEditPartDialog(part, submit) {
  const host = document.createElement('div'); host.className = 'project-dialog-backdrop'; host.innerHTML = `<section class="project-dialog" role="dialog" aria-modal="true"><header><div><small>EDIT PART</small><h2>编辑零件</h2></div><button type="button" data-close>×</button></header><form><label>零件名称<input name="name" value="${esc(part.name)}" required></label><label>格式<select name="format"><option ${part.format==='STEP'?'selected':''}>STEP</option><option ${part.format==='STP'?'selected':''}>STP</option><option ${part.format==='PDF'?'selected':''}>PDF</option></select></label><label>材料<input name="material" value="${esc(part.material || '')}"></label><label>表面处理<input name="finish" value="${esc(part.finish || '')}"></label><label>尺寸<input name="dimensions" value="${esc(part.size || '')}"></label><label>体积<input name="volume" value="${esc(part.volume || '')}"></label><label>数量<input name="quantity" type="number" min="1" value="${part.quantity || 1}"></label><footer><button type="button" class="outline-button" data-close>取消</button><button type="submit" class="primary-button">保存零件</button></footer></form></section>`;
  document.body.appendChild(host); const close = () => host.remove(); host.querySelectorAll('[data-close]').forEach(button => button.onclick = close); host.querySelector('form').onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); submit(Object.fromEntries(data.entries())); close(); }; host.querySelector('input').focus();
}

function openMembersDialog(store) {
  document.querySelector('#memberDialog')?.remove();
  const host = document.createElement('div');
  host.id = 'memberDialog';
  host.className = 'project-dialog-backdrop';
  const members = store.members.length ? store.members : [{ username: 'admin', displayName: 'admin', role: 'owner' }];
  const roleLabel = { owner: '企业所有者', admin: '企业管理员', engineer: '工程师', qa: '质检员', viewer: '只读成员' };
  const canManage = ['owner', 'admin'].includes(store.user?.role || store.role);
  host.innerHTML = `<section class="project-dialog member-dialog" role="dialog" aria-modal="true" aria-labelledby="memberDialogTitle"><header><div><small>ORGANIZATION</small><h2 id="memberDialogTitle">${esc(store.organization?.name || '企业空间')}</h2></div><button type="button" data-member-dialog-close aria-label="关闭">×</button></header><div class="member-dialog-body"><div class="member-dialog-toolbar"><p>成员与角色</p>${canManage ? '<button type="button" class="small-outline" data-invite-member>＋ 邀请成员</button>' : ''}</div>${members.map(member => `<div class="member-row"><span class="avatar blue">${initials(member.displayName || member.username)}</span><div><b>${esc(member.displayName || member.username)}</b><small>@${esc(member.username)}</small></div>${canManage ? `<select class="member-role-select" data-member-id="${esc(member.id)}"><option value="owner" ${member.role==='owner'?'selected':''}>企业所有者</option><option value="admin" ${member.role==='admin'?'selected':''}>企业管理员</option><option value="engineer" ${member.role==='engineer'?'selected':''}>工程师</option><option value="qa" ${member.role==='qa'?'selected':''}>质检员</option><option value="viewer" ${member.role==='viewer'?'selected':''}>只读成员</option></select>` : `<em>${esc(roleLabel[member.role] || member.role)}</em>`}</div>`).join('')}</div><footer class="member-dialog-footer"><button type="button" class="outline-button" data-member-dialog-close>关闭</button></footer></section>`;
  document.body.appendChild(host);
  const close = () => host.remove();
  host.querySelectorAll('[data-member-dialog-close]').forEach(button => button.addEventListener('click', close));
  host.addEventListener('click', event => { if (event.target === host) close(); });
  host.addEventListener('change', async event => {
    const select = event.target.closest('.member-role-select');
    if (!select) return;
    const result = await apiRequest(`/api/members/${encodeURIComponent(select.dataset.memberId)}/role`, { method: 'PUT', body: JSON.stringify({ role: select.value }) }, store.apiToken);
    if (!result.response?.ok) { showToast(result.body.message || '角色更新失败'); return; }
    const member = store.members.find(item => item.id === select.dataset.memberId); if (member) member.role = result.body.member.role;
    showToast('成员角色已更新');
  });
  host.addEventListener('click', event => {
    if (!event.target.closest('[data-invite-member]')) return;
    const invite = document.createElement('div'); invite.className = 'project-dialog-backdrop';
    invite.innerHTML = `<section class="project-dialog" role="dialog" aria-modal="true"><header><div><small>INVITE MEMBER</small><h2>邀请成员</h2></div><button type="button" data-close>×</button></header><form><label>登录账号<input name="username" pattern="[a-z0-9._-]+" placeholder="例如：zhangsan" required></label><label>显示名称<input name="displayName" placeholder="例如：张工" required></label><label>临时密码<input name="temporaryPassword" type="password" minlength="8" placeholder="至少 8 位" required></label><label>企业角色<select name="role"><option value="admin">企业管理员</option><option value="engineer" selected>工程师</option><option value="qa">质检员</option><option value="viewer">只读成员</option></select></label><p class="muted-note">请将临时密码安全地交给成员，正式版可接入邮件邀请。</p><footer><button type="button" class="outline-button" data-close>取消</button><button type="submit" class="primary-button">发送邀请</button></footer></form></section>`;
    document.body.appendChild(invite); const closeInvite = () => invite.remove(); invite.querySelectorAll('[data-close]').forEach(button => button.onclick = closeInvite); invite.querySelector('form').onsubmit = async submitEvent => { submitEvent.preventDefault(); const form = new FormData(submitEvent.currentTarget); const result = await apiRequest('/api/members', { method: 'POST', body: JSON.stringify(Object.fromEntries(form.entries())) }, store.apiToken); if (!result.response?.ok) return showToast(result.body.message || '邀请失败'); store.members.push(result.body.member); closeInvite(); close(); openMembersDialog(store); showToast('成员已邀请'); }; invite.querySelector('input').focus();
  });
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
  const project = store.projects.find(item => item.id === options.projectId) || store.projects[0];
  if (!project) return showToast('请先创建项目');
  const host = document.createElement('div'); host.className = 'project-dialog-backdrop';
  const projectParts = store.parts.filter(part => part.projectId === project.id);
  const statusLabel = { pending: '待复核', pass: '合格', fail: '不合格' }; const existing = store.fairItems || [];
  host.innerHTML = `<section class="project-dialog fair-dialog" role="dialog" aria-modal="true"><header><div><small>FAIR / INSPECTION</small><h2>管理检验特性</h2></div><button type="button" data-close>×</button></header>${existing.length ? `<div class="fair-existing"><h3>已有检验项 <small>${existing.length}</small></h3>${existing.map(item => `<div class="fair-existing-row"><div><b>${esc(item.characteristic)}</b><small>名义 ${esc(item.nominal || '—')} · 公差 ${esc(item.tolerance || '—')}</small></div><select data-fair-id="${esc(item.id)}"><option value="pending" ${item.status==='pending'?'selected':''}>待复核</option><option value="pass" ${item.status==='pass'?'selected':''}>合格</option><option value="fail" ${item.status==='fail'?'selected':''}>不合格</option></select></div>`).join('')}</div>` : ''}<form><h3>新增检验项</h3><label>检验特性<input name="characteristic" placeholder="例如：孔径" required></label><label>名义值<input name="nominal" placeholder="例如：Ø19"></label><label>公差<input name="tolerance" placeholder="例如：±0.2"></label><label>关联零件<select name="partId"><option value="">未关联</option>${projectParts.map(part => `<option value="${part.id}">${esc(part.name)}</option>`).join('')}</select></label><footer><button type="button" class="outline-button" data-close>取消</button><button type="submit" class="primary-button">保存检验项</button></footer></form></section>`;
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
  const [projectsResult, partsResult, membersResult, tasksResult, conversationsResult, statsResult] = await Promise.all([
    apiRequest('/api/projects', {}, store.apiToken),
    apiRequest('/api/parts', {}, store.apiToken),
    apiRequest('/api/members', {}, store.apiToken),
    apiRequest('/api/tasks', {}, store.apiToken),
    apiRequest('/api/conversations', {}, store.apiToken),
    apiRequest('/api/stats', {}, store.apiToken)
  ]);
  if (!projectsResult.response?.ok) return false;
  const documentsResult = await apiRequest('/api/documents', {}, store.apiToken);
  if (documentsResult.response?.ok) OFFICE_DOCUMENTS = (documentsResult.body.documents || []).map(presentOfficeDocument);
  store.projects = Array.isArray(projectsResult.body.projects) ? projectsResult.body.projects : [];
  store.modules = projectsResult.body.modules || store.modules;
  store.parts = partsResult.response?.ok && Array.isArray(partsResult.body.parts) ? partsResult.body.parts : [];
  store.members = membersResult.response?.ok && Array.isArray(membersResult.body.members) ? membersResult.body.members : [];
  store.tasks = tasksResult.response?.ok && Array.isArray(tasksResult.body.tasks) ? tasksResult.body.tasks : [];
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
  const projectId = store.projects[0]?.id;
  if (projectId) {
    const [quotesResult, fairResult] = await Promise.all([
      apiRequest(`/api/projects/${encodeURIComponent(projectId)}/quotes`, {}, store.apiToken),
      apiRequest(`/api/projects/${encodeURIComponent(projectId)}/fair-items`, {}, store.apiToken)
    ]);
    store.quotes = quotesResult.response?.ok && Array.isArray(quotesResult.body.quotes) ? quotesResult.body.quotes : [];
    store.fairItems = fairResult.response?.ok && Array.isArray(fairResult.body.items) ? fairResult.body.items : [];
  }
  return true;
}

function initCloudApp() {
  const loginView = document.querySelector('#loginView');
  const shellView = document.querySelector('#shellView');
  if (!loginView || !shellView) return;
  const store = createCloudStore();
  store.platformUsers = [];
  const resetClientState = () => {
    store.authenticated = false;
    store.apiToken = '';
    store.user = null;
    store.organization = null;
    store.role = '';
    store.platformAdmin = false;
    store.projects = [];
    store.parts = [];
    store.tasks = [];
    store.conversations = [];
    store.messages = {};
    store.members = [];
    store.quotes = [];
    store.fairItems = [];
    store.stats = null;
    store.organizations = [];
    store.platformUsers = [];
    store.platformAudit = [];
    store.selectedChat = '';
    store.selectedCommunication = '';
    store.selectedPart = '';
    store.chatDraft = '';
    store.chatDraftAttachments = [];
    store.chatUploading = false;
    store.chatSending = false;
    store.chatFilter = 'all';
    store.chatScope = 'all';
    store.chatQuery = '';
    OFFICE_DOCUMENTS = [];
    document.querySelectorAll('#projectDetail, #projectDialog, #communicationDialog, #memberDialog, #partDialog').forEach(node => node.remove());
  };
  if (location.hash) history.replaceState(null, '', `${location.pathname}${location.search}`);
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
    window.setTimeout(() => {
      const dismiss = event => { if (!menu.contains(event.target) && event.target !== topUser) { closeAccountMenu(); document.removeEventListener('click', dismiss, true); } };
      document.addEventListener('click', dismiss, true);
    }, 0);
  };

  const renderNav = () => {
    const visibleNav = store.consoleMode === 'platform' ? store.nav : store.nav.filter(item => store.modules[item.id] !== false);
    const renderItem = item => `<button class="cloud-nav-item ${item.id===store.currentView?'active':''}" data-view="${item.id}" title="${esc(item.label)}" aria-label="${esc(item.label)}"><span class="nav-icon ${esc(item.iconClass || '')}" aria-hidden="true">${item.icon}</span><b>${item.label}</b></button>`;
    if (store.consoleMode === 'platform') {
      nav.innerHTML = visibleNav.map(renderItem).join('');
      return;
    }
    const groups = new Map();
    visibleNav.forEach(item => {
      const group = item.group || '其他';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    });
    nav.innerHTML = [...groups].map(([group, items]) => `<section class="cloud-nav-group"><p>${esc(group)}</p>${items.map(renderItem).join('')}</section>`).join('');
  };
  const renderShell = () => {
    pageTitle.textContent = getViewTitle(store.currentView);
    globalSearch.value = store.query;
    globalSearch.placeholder = store.currentView === 'projects' ? '搜索任务 / 项目 / 负责人' : `搜索${getViewTitle(store.currentView)}`;
    content.innerHTML = renderView(store);
    renderNav();
    // Filters and conversation-state updates can select a different thread
    // while rendering. Load that thread here so the detail pane cannot remain
    // indefinitely at "正在加载消息...".
    if (store.currentView === 'chat' && store.selectedChat && !Object.prototype.hasOwnProperty.call(store.messages, store.selectedChat)) {
      void loadChatConversation(store.selectedChat);
    }
  };
  const loadCommunicationThread = async conversationId => {
    if (!conversationId || Object.prototype.hasOwnProperty.call(store.messages, conversationId)) return;
    const requestConversationId = conversationId;
    store.messages[conversationId] = null;
    if (store.currentView === 'communication') renderShell();
    const result = await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/messages?markRead=true`, {}, store.apiToken);
    store.messages[conversationId] = result.response?.ok ? result.body.messages || [] : [];
    if (!result.response?.ok) showToast(result.body.message || '沟通消息加载失败');
    if (store.currentView === 'communication' && store.selectedCommunication === requestConversationId) {
      renderShell();
      content.querySelector('[data-communication-thread]')?.scrollTo({ top: 999999 });
    }
  };
  const openCommunicationThread = async conversationId => {
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
    const input = content.querySelector('#communicationInput');
    const body = input?.value.trim();
    const conversation = store.conversations.find(item => item.id === store.selectedCommunication && item.projectId);
    if (!body || !conversation) return;
    input.disabled = true;
    const result = await apiRequest(`/api/conversations/${encodeURIComponent(conversation.id)}/messages`, { method: 'POST', body: JSON.stringify({ body }) }, store.apiToken);
    if (!result.response?.ok) { input.disabled = false; input.focus(); return showToast(result.body.message || '回复发送失败'); }
    const message = result.body.message;
    store.messages[conversation.id] = [...(store.messages[conversation.id] || []), message];
    Object.assign(conversation, { preview: message.body, lastSender: message.displayName || message.username || store.user?.displayName || '', lastMessageAt: message.createdAt, messageCount: Number(conversation.messageCount || 0) + 1 });
    store.conversations = [conversation, ...store.conversations.filter(item => item.id !== conversation.id)];
    renderShell();
    const thread = content.querySelector('[data-communication-thread]');
    thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
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
  const openProjectCardPopup = async projectId => {
    // Project popup contracts: data-project-popup-tab="tasks" data-project-popup-tab="resources" data-project-popup-tab="activity".
    const selected = store.projects.find(project => project.id === projectId);
    if (!selected) return showToast('项目不存在或已无权访问');
    const result = store.apiToken
      ? await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/workspace`, {}, store.apiToken)
      : { response: { ok: true }, body: { project: selected, tasks: [], parts: [], quotes: [], fairItems: [], documents: [], conversations: [], activities: [] } };
    if (!result.response?.ok) return showToast(result.body.message || '项目内容加载失败');
    const workspace = result.body;
    mergeOfficeDocuments(workspace.documents || []);
    return openTaskDetail(store, { task: null }, { workspace, projectRecord: selected });
    /* legacy project workspace removed: project cards open task detail directly. */
    return;
    document.querySelector('#projectDetail')?.remove();
    const host = document.createElement('div');
    host.id = 'projectDetail';
    host.className = 'task-detail-backdrop';
    const tabs = [['tasks', '任务'], ['resources', '资料'], ['activity', '动态']];
    const taskMarkup = () => workspace.tasks?.length
      ? workspace.tasks.slice(0, 20).map(task => `<button class="project-popup-task" type="button" data-project-popup-task="${esc(task.id)}"><span class="project-popup-check">${task.status === '已完成' ? '✓' : '□'}</span><b>${esc(task.title)}</b><small>${esc(task.owner || '未分配')} · ${esc(task.status || '待处理')}</small></button>`).join('')
      : `<div class="project-popup-empty"><b>这个项目还没有任务</b><span>把项目拆成可执行的任务，团队成员就能在这里协作。</span><button type="button" class="primary-button" data-project-popup-create>＋ 新建任务</button></div>`;
    const resourcesMarkup = () => {
      const resources = [...(workspace.parts || []).map(item => ({ kind: '零件', title: item.name })), ...(workspace.quotes || []).map(item => ({ kind: '报价', title: item.quoteNo })), ...(workspace.documents || []).map(item => ({ kind: '文档', title: item.title }))];
      return resources.length ? `<div class="project-popup-resource-list">${resources.map(item => `<div><span>${esc(item.kind)}</span><b>${esc(item.title || '未命名')}</b></div>`).join('')}</div><button type="button" class="outline-button" data-project-popup-upload>上传项目文档</button>` : `<div class="project-popup-empty"><b>暂无项目资料</b><span>上传图纸、文档或创建报价后会显示在这里。</span><button type="button" class="outline-button" data-project-popup-upload>上传项目文档</button></div>`;
    };
    const activityMarkup = () => (workspace.activities || []).length
      ? `<div class="project-popup-activity-list">${workspace.activities.slice(0, 12).map(item => `<div><span class="avatar blue">${esc(String(item.username || '系').slice(0, 1))}</span><p><b>${esc(item.username || '系统')}</b><span>${esc(item.action || '更新了项目')}</span><small>${item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : '刚刚'}</small></p></div>`).join('')}</div>`
      : '<div class="project-popup-empty"><b>还没有项目动态</b><span>项目创建、任务和资料变更会记录在这里。</span></div>';
    host.innerHTML = `<section class="task-detail-shell project-detail-shell" role="dialog" aria-modal="true" aria-labelledby="projectDetailTitle">
      <header class="task-detail-topbar"><span class="task-type-badge"><i>▦</i> 项目</span><nav><button type="button" data-project-popup-create title="新建任务" aria-label="新建任务">＋</button><button type="button" data-close-project-detail title="关闭" aria-label="关闭">×</button></nav></header>
      <div class="project-popup-main"><div class="project-popup-heading"><div><small>PROJECT SPACE</small><h1 id="projectDetailTitle">${esc(workspace.project?.title || selected.title)}</h1><p>${esc(workspace.project?.owner || selected.owner || '未指定负责人')} · ${esc(workspace.project?.stage || selected.stage || '立项沟通')}</p></div><div class="project-popup-progress"><b>${Number(workspace.project?.progress || selected.progress || 0)}%</b><i><em style="width:${Math.max(0, Math.min(100, Number(workspace.project?.progress || selected.progress || 0)))}%"></em></i></div></div>
      <nav class="project-popup-tabs" aria-label="项目内容">${tabs.map(([id, label], index) => `<button type="button" class="${index === 0 ? 'active' : ''}" data-project-popup-tab="${id}" data-project-popup-toggle="${id}">${label}<span>${id === 'tasks' ? (workspace.tasks?.length || 0) : id === 'resources' ? ((workspace.parts?.length || 0) + (workspace.quotes?.length || 0) + (workspace.documents?.length || 0)) : (workspace.activities?.length || 0)}</span></button>`).join('')}</nav>
      <section class="project-popup-panel" data-project-popup-panel="tasks"><div class="project-popup-section-head"><h3>项目任务</h3><button type="button" class="outline-button" data-project-popup-create>＋ 新建任务</button></div><div class="project-popup-task-list">${taskMarkup()}</div></section>
      <section class="project-popup-panel" data-project-popup-panel="resources" hidden><div class="project-popup-section-head"><h3>项目资料</h3></div><div data-project-popup-resources>${resourcesMarkup()}</div></section>
      <section class="project-popup-panel" data-project-popup-panel="activity" hidden><div class="project-popup-section-head"><h3>项目动态</h3></div>${activityMarkup()}</section>
      </div></section>`;
    document.body.appendChild(host);
    const close = () => host.remove();
    host.querySelector('[data-close-project-detail]').onclick = close;
    host.addEventListener('click', async event => {
      if (event.target === host) return close();
      const tab = event.target.closest('[data-project-popup-tab]');
      if (tab) {
        host.querySelectorAll('[data-project-popup-tab]').forEach(item => item.classList.toggle('active', item === tab));
        host.querySelectorAll('[data-project-popup-panel]').forEach(panel => { panel.hidden = panel.dataset.projectPopupPanel !== tab.dataset.projectPopupTab; });
        return;
      }
      const task = event.target.closest('[data-project-popup-task]');
      if (task) {
        const detail = await apiRequest(`/api/tasks/${encodeURIComponent(task.dataset.projectPopupTask)}/detail`, {}, store.apiToken);
        if (!detail.response?.ok) return showToast(detail.body.message || '任务详情加载失败');
        close(); openTaskDetail(store, detail.body, { workspace });
        return;
      }
      if (event.target.closest('[data-project-popup-upload]')) {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.docx,.xlsx,.pptx,.pdf'; input.click();
        input.onchange = async () => {
          const file = input.files?.[0]; if (!file) return;
          const response = await fetch(`${location.pathname.startsWith('/mfggo/') ? '/mfggo-api' : '/api'}/documents/upload`, { method: 'POST', headers: { authorization: `Bearer ${store.apiToken}`, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), 'x-project-id': projectId }, body: file });
          const body = await response.json().catch(() => ({})); if (!response.ok) return showToast(body.message || '上传失败');
          workspace.documents.unshift(body.document); mergeOfficeDocuments([body.document]); host.querySelector('[data-project-popup-resources]').innerHTML = resourcesMarkup(); showToast('项目文档已上传');
        };
        return;
      }
      if (event.target.closest('[data-project-popup-create]')) {
        close();
        openTaskDialog(store, async payload => {
          const created = await apiRequest('/api/tasks', { method: 'POST', body: JSON.stringify({ ...payload, projectId }) }, store.apiToken);
          if (!created.response?.ok) return showToast(created.body.message || '任务创建失败');
          store.tasks.unshift(created.body.task); showToast('任务已加入项目'); openProjectCardPopup(projectId);
        }, { projectId, stage: '未分组' });
      }
    });
    document.addEventListener('keydown', function escapeProject(event) { if (event.key === 'Escape') { document.removeEventListener('keydown', escapeProject); close(); } });
  };
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
    if (mode === 'platform' && store.apiToken) {
      Promise.all([
        apiRequest('/api/platform/organizations', {}, store.apiToken),
        apiRequest('/api/platform/users', {}, store.apiToken)
      ]).then(([organizations, users]) => {
        if (organizations.response?.ok) store.organizations = organizations.body.organizations || [];
        if (users.response?.ok) store.platformUsers = users.body.users || [];
        renderShell();
      });
    }
  };
  const showShell = () => {
    store.authenticated = true;
    loginView.classList.add('hidden');
    shellView.classList.remove('hidden');
    userName.textContent = store.user?.displayName || 'admin';
    const enterpriseMenu = document.querySelector('#enterpriseMenu');
    if (enterpriseMenu) enterpriseMenu.textContent = `${store.organization?.name || '企业管理'}⌄`;
    renderShell();
    if (store.consoleMode === 'platform' && store.apiToken && store.platformAdmin) {
      Promise.all([
        apiRequest('/api/platform/organizations', {}, store.apiToken),
        apiRequest('/api/platform/users', {}, store.apiToken)
      ]).then(([organizations, users]) => {
        if (organizations.response?.ok) store.organizations = organizations.body.organizations || [];
        if (users.response?.ok) store.platformUsers = users.body.users || [];
        renderShell();
      });
      apiRequest('/api/platform/audit', {}, store.apiToken).then(result => { if (result.response?.ok) store.platformAudit = result.body.events || []; });
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
    store.organization = meResult.body.organization || null;
    store.platformAdmin = Boolean(meResult.body.platformAdmin);
    if (pageMode === 'platform' && !store.platformAdmin) {
      resetClientState();
      saveSession(store);
      return;
    }
    store.modules = meResult.body.modules || store.modules;
    store.chatDraft = '';
    store.chatDraftAttachments = [];
    store.messages = {};
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
      store.chatDraft = '';
      store.chatDraftAttachments = [];
      store.messages = {};
      OFFICE_DOCUMENTS = [];
      store.user = result.body.user || { displayName: username };
      store.role = result.body.role || '';
      store.organization = result.body.organization || null;
      store.platformAdmin = Boolean(result.body.platformAdmin);
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
    store.currentView = button.dataset.view;
    store.query = '';
    renderShell();
    if (store.currentView === 'communication' && store.selectedCommunication) loadCommunicationThread(store.selectedCommunication);
    if (store.currentView === 'chat' && store.selectedChat) loadChatConversation(store.selectedChat);
    if (store.currentView === 'platform-audit') apiRequest('/api/platform/audit', {}, store.apiToken).then(result => { if (result.response?.ok) { store.platformAudit = result.body.events || []; renderShell(); } else showToast(result.body.message || '审计记录加载失败'); });
  });
  globalSearch.addEventListener('input', event => { store.query = event.target.value; content.innerHTML = renderView(store); });
  content.addEventListener('change', async event => { if(!event.target.matches('[data-office-upload]'))return;const file=event.target.files?.[0];if(!file)return;try{const apiBase=location.pathname.startsWith('/mfggo/')?'/mfggo-api':'/api';const response=await fetch(`${apiBase}/documents/upload`,{method:'POST',headers:{authorization:`Bearer ${store.apiToken}`,'content-type':'application/octet-stream','x-file-name':encodeURIComponent(file.name)},body:file});const body=await response.json();if(!response.ok)throw new Error(body.message||'上传失败');const doc=body.document;OFFICE_DOCUMENTS.unshift({...doc,scope:'我的文档',updated:new Date(doc.updatedAt).toLocaleString('zh-CN'),size:`${Math.max(1,Math.ceil(doc.sizeBytes/1024))} KB`,permission:'可编辑'});content.innerHTML=renderWorkspace(store);showToast('文档上传成功')}catch(error){showToast(error.message)} });
  document.querySelector('#logoutButton')?.addEventListener('click', async () => {
    const token = store.apiToken;
    if (token) await apiRequest('/api/auth/logout', { method: 'POST' }, token);
    resetClientState();
    saveSession(store);
    shellView.classList.add('hidden');
    loginView.classList.remove('hidden');
    document.querySelector('#loginPassword')?.focus();
  });

  content.addEventListener('click', event => {
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
    const projectCard = event.target.closest('[data-project-open]');
    if (projectCard && !event.target.closest('[data-action="edit-project"]')) { openProjectCardPopup(projectCard.dataset.projectOpen); return; }
    const createProjectStage = event.target.closest('[data-create-project-stage]');
    if (createProjectStage) { openProjectDialog((title, stage) => {
      if (!store.apiToken) return showToast('SaaS 服务未连接，请重新登录后再创建项目');
      apiRequest('/api/projects', { method: 'POST', body: JSON.stringify({ title, stage }) }, store.apiToken).then(result => {
        if (!result.response?.ok) return showToast(result.body.message || '项目创建失败');
        store.projects.unshift(result.body.project); renderShell(); showToast('项目已创建并写入企业空间');
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
    if (communication) { store.selectedCommunication = communication.dataset.communicationId; content.innerHTML = renderCommunication(store); loadCommunicationThread(store.selectedCommunication); return; }
    const projectConversation = event.target.closest('[data-project-conversation-id]');
    if (projectConversation) { openCommunicationThread(projectConversation.dataset.projectConversationId); return; }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'send-chat') { sendChatMessage(); return; }
    if (action === 'attach-chat-file') { content.querySelector('[data-chat-attachment-input]')?.click(); return; }
    if (action === 'remove-chat-attachment') { removeChatAttachment(event.target.closest('[data-chat-attachment-id]')?.dataset.chatAttachmentId); return; }
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
      openCommunicationDialog(store, createCommunication);
      return;
    }
    if (action === 'send-communication') { sendCommunicationMessage(); return; }
    if (action === 'open-communication-project') {
      const conversation = store.conversations.find(item => item.id === store.selectedCommunication);
      if (conversation?.projectId) openProjectCardPopup(conversation.projectId);
      return;
    }
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
      openEditPartDialog(part, payload => apiRequest(`/api/parts/${encodeURIComponent(part.id)}`, { method: 'PUT', body: JSON.stringify(payload) }, store.apiToken).then(result => { if (!result.response?.ok) return showToast(result.body.message || '零件保存失败'); Object.assign(part, result.body.part); renderShell(); showToast('零件已更新'); }));
    }
    if (action === 'edit-project') {
      const project = store.projects.find(item => item.id === event.target.closest('[data-project-id]')?.dataset.projectId);
      if (!project) return showToast('当前项目不支持编辑');
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
    if (action === 'create-organization') openOrganizationDialog(async payload => {
      const result = await apiRequest('/api/platform/organizations', { method: 'POST', body: JSON.stringify({ name: payload.name, slug: payload.slug }) }, store.apiToken);
      if (!result.response?.ok) return showToast(result.body.message || '企业创建失败');
      const organization = result.body.organization;
      const moduleResult = await apiRequest(`/api/platform/organizations/${encodeURIComponent(organization.id)}/modules`, { method: 'PUT', body: JSON.stringify({ modules: payload.modules }) }, store.apiToken);
      if (moduleResult.response?.ok) organization.modules = moduleResult.body.organization.modules;
      store.organizations = [organization, ...(store.organizations || [])]; renderShell(); showToast('企业已创建');
    });
    if (action === 'create-task') openTaskDialog(store, async payload => {
      const result = await apiRequest('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }, store.apiToken); if (!result.response?.ok) return showToast(result.body.message || '任务创建失败'); store.tasks = [result.body.task, ...(store.tasks || [])]; renderShell(); const detailResult = await apiRequest(`/api/tasks/${encodeURIComponent(result.body.task.id)}/detail`, {}, store.apiToken); if (detailResult.response?.ok) openTaskDetail(store, detailResult.body); showToast('任务已创建');
    });
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
      const keys = ['projects', 'workspace', 'bom', 'parts', 'communication', 'chat', 'tasks', 'stats'];
      const labels = { projects: '项目管理', workspace: '制表中心', bom: 'BOM 报价助手', parts: '零件中心', communication: '项目沟通', chat: '聊天信息', tasks: '我的任务', stats: '统计' };
      const host = document.createElement('div'); host.className = 'project-dialog-backdrop'; host.innerHTML = `<section class="project-dialog" role="dialog" aria-modal="true"><header><div><small>MODULES</small><h2>配置企业功能</h2></div><button type="button" data-close>×</button></header><p class="muted-note">${esc(organization.name)} 的功能开关</p><form>${keys.map(key => `<label class="module-toggle"><input type="checkbox" name="${key}" ${organization.modules?.[key] ? 'checked' : ''}> <span>${labels[key]}</span></label>`).join('')}<footer><button type="button" class="outline-button" data-close>取消</button><button type="submit" class="primary-button">保存模块配置</button></footer></form></section>`;
      document.body.appendChild(host); const close = () => host.remove(); host.querySelectorAll('[data-close]').forEach(button => button.onclick = close); host.querySelector('form').onsubmit = async submitEvent => { submitEvent.preventDefault(); const form = new FormData(submitEvent.currentTarget); const modules = Object.fromEntries(keys.map(key => [key, form.has(key)])); const result = await apiRequest(`/api/platform/organizations/${encodeURIComponent(organization.id)}/modules`, { method: 'PUT', body: JSON.stringify({ modules }) }, store.apiToken); if (!result.response?.ok) return showToast(result.body.message || '模块配置保存失败'); organization.modules = result.body.organization.modules; if (organization.id === store.organization?.id) store.modules = organization.modules; close(); renderShell(); showToast('企业功能模块已更新'); };
    }
    if (action === 'open-workspace') {
      store.currentView = 'bom';
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
      openPartDialog(store, payload => {
        if (!payload.projectId || !payload.name) return showToast('请选择项目并填写零件名称');
        apiRequest(`/api/projects/${encodeURIComponent(payload.projectId)}/parts`, { method: 'POST', body: JSON.stringify(payload) }, store.apiToken).then(result => {
          if (!result.response?.ok) return showToast(result.body.message || '零件保存失败');
          store.parts.unshift(result.body.part);
          store.selectedPart = result.body.part.id;
          renderShell();
          showToast('零件已写入项目');
        });
      });
    }
    if (action === 'create-project' || action === 'new-project') {
      openProjectDialog((title, stage) => {
        if (!store.apiToken) return showToast('SaaS 服务未连接，请重新登录后再创建项目');
        apiRequest('/api/projects', { method: 'POST', body: JSON.stringify({ title, stage }) }, store.apiToken).then(result => {
          if (!result.response?.ok) return showToast(result.body.message || '项目创建失败');
          store.projects.unshift(result.body.project);
          renderShell();
          showToast('项目已创建并写入企业空间');
        });
      }, '立项沟通');
    }
  });

  content.addEventListener('change', async event => {
    if (event.target.matches('[data-chat-attachment-input]')) {
      await uploadChatAttachments(event.target.files);
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
    const taskControl = event.target.closest('[data-task-id]');
    if (taskControl && (taskControl.classList.contains('task-progress-input') || taskControl.classList.contains('task-status-select'))) {
      const taskId=taskControl.dataset.taskId,task = store.tasks.find(item => item.id === taskId); if (!task) return;
      const payload = taskControl.classList.contains('task-progress-input') ? { progress: Number(taskControl.value) } : { status: taskControl.value };
      apiRequest(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'PUT', body: JSON.stringify(payload) }, store.apiToken).then(result => { if (!result.response?.ok) return showToast(result.body.message || '任务更新失败'); Object.assign(task,result.body.task); renderShell(); showToast('任务已更新'); }); return;
    }
    if (event.target.id !== 'cloudFileInput') return;
    const list = document.querySelector('#cloudUploadList');
    const files = Array.from(event.target.files || []);
    list.innerHTML = files.map(file => `<div><span>▱</span><b>${esc(file.name)}</b><small>${Math.ceil(file.size / 1024)} KB</small><em>待解析</em></div>`).join('');
    if (files.length) showToast(`已添加 ${files.length} 个文件`);
  });
  content.addEventListener('input', event => {
    const progressRange = event.target.closest('.task-progress-range');
    if (progressRange) {
      progressRange.style.setProperty('--progress-value', `${progressRange.value}%`);
      if (progressRange.nextElementSibling?.tagName === 'OUTPUT') {
        progressRange.nextElementSibling.value = `${progressRange.value}%`;
        progressRange.nextElementSibling.textContent = `${progressRange.value}%`;
      }
      return;
    }
    if (event.target.matches('#chatInput')) { store.chatDraft = event.target.value; return; }
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
    store.communicationProject = communicationProject.value;
    store.selectedCommunication = '';
    content.innerHTML = renderCommunication(store);
    if (store.selectedCommunication) loadCommunicationThread(store.selectedCommunication);
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
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeAccountMenu(); });
  content.addEventListener('click', event => {
    const jump = event.target.closest('[data-view-jump]');
    if (jump) { store.currentView = jump.dataset.viewJump; renderShell(); }
  });
  content.addEventListener('keydown', event => {
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
    const card=event.target.closest('[data-project-open]');
    if (!card || event.target.closest('button,select,input')) return;
    event.preventDefault();openProjectCardPopup(card.dataset.projectOpen);
  });

  restoreSession();
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', initCloudApp);
