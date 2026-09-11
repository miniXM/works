import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationHasNewMessages, createCloudStore, deriveTaskCapabilities, filterChatConversations, filterMyTasks, filterProjectCommunications, filterProjects, getProjectBomRows, getViewTitle, getProgressTone, getWorkspaceLaunchMode, mergeConversationMessages, normalizeProjectTaskStatus, renderCommunication, renderParts, renderWorkspace, taskBoardStatus } from '../zhizao-app.js';
import { readFile } from 'node:fs/promises';
import { renderTaskShortcutMenu } from '../zhizao-app.js';

test('creates a logged-out cloud store with the reference navigation', () => {
  const store = createCloudStore();
  assert.equal(store.authenticated, false);
  assert.deepEqual(store.nav.map(item => item.id), [
    'projects', 'automation', 'workspace', 'parts', 'communication', 'chat', 'tasks', 'stats', 'organization'
  ]);
  assert.equal(store.nav.find(item => item.id === 'workspace')?.label, '制表中心');
  assert.equal(store.nav.some(item => item.id === 'bom'), false);
});

test('loads the shadcn-compatible design primitives on every cloud entry point', async () => {
  const root = new URL('..', import.meta.url);
  for (const entry of ['enterprise.html', 'admin.html', 'platform.html']) {
    const html = await readFile(new URL(entry, root), 'utf8');
    assert.match(html, /href="\.\/shadcn\.css"/);
  }
  const css = await readFile(new URL('../shadcn.css', import.meta.url), 'utf8');
  assert.match(css, /--primary:/);
  assert.match(css, /\.shadcn-button/);
  assert.match(css, /prefers-reduced-motion/);
});

test('redirects the legacy root entry to the canonical enterprise workspace', async () => {
  const root = new URL('..', import.meta.url);
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /window\.location\.replace\(`\.\/enterprise\.html\$\{window\.location\.search\}\$\{window\.location\.hash\}`\)/);
  assert.doesNotMatch(html, /id="shellView"|id="loginView"|zhizao-app\.js/);
});

test('filters project cards by title, owner, or tag', () => {
  const projects = [
    { title: 'Cheetah 转向节询价', owner: '张工', tag: 'Upper Knuckle' },
    { title: 'LDH 顶盖询盘发布', owner: '王工', tag: 'LDH Top' }
  ];
  assert.equal(filterProjects(projects, 'knuckle').length, 1);
  assert.equal(filterProjects(projects, '王工').length, 1);
  assert.equal(filterProjects(projects, '').length, 2);
});

test('maps progress to stable semantic tones for the task table', () => {
  assert.equal(getProgressTone(0), 'idle');
  assert.equal(getProgressTone(33), 'active');
  assert.equal(getProgressTone(100), 'done');
  assert.equal(getViewTitle('parts'), '零件中心');
});

test('treats an explicitly released executor as empty despite a stale project cache', () => {
  const capabilities = deriveTaskCapabilities(
    { user: { id: 'user-old-executor' }, role: 'engineer', projects: [] },
    { task: { id: 'task-root', projectId: 'project-1', assigneeUserId: '' } },
    {
      project: { id: 'project-1', rootTaskId: 'task-root', executorUserId: 'user-old-executor' },
      projectMembers: [{ id: 'user-old-executor', projectRole: 'member' }]
    }
  );
  assert.equal(capabilities.assigneeId, '');
  assert.equal(capabilities.isCurrentExecutor, false);
  assert.equal(capabilities.canClaim, true);
});

test('renders missing part data in the read-only detail view', () => {
  const store = createCloudStore();
  store.parts = [{ id: 'part-a', name: '支架', project: '示例项目', order: '', format: '手工录入', material: '', finish: '', size: '', volume: '', quantity: 1, uploaded: '2026-08-28' }];
  const markup = renderParts(store);
  assert.match(markup, /class="preview-empty"/);
  assert.match(markup, /<strong>待补充<\/strong>/);
  assert.doesNotMatch(markup, /data-part-manual-form/);
  assert.doesNotMatch(markup, /<select name="material"/);
  assert.doesNotMatch(markup, /name="finish"/);
  assert.doesNotMatch(markup, /data-action="save-part-manual"/);
  assert.doesNotMatch(markup, /上传模型并报价/);
});

test('renders saved part material and finish as read-only values', () => {
  const store = createCloudStore();
  store.parts = [{ id: 'part-a', name: '法兰', project: '示例项目', order: '', format: 'STEP', material: 'Aluminum 6061', finish: 'Anodizing (Black)', size: '80 × 80 × 12', volume: '32000', quantity: 2, uploaded: '2026-08-28' }];
  const markup = renderParts(store);
  assert.match(markup, /<strong>Aluminum 6061<\/strong>/);
  assert.match(markup, /<strong>Anodizing \(Black\)<\/strong>/);
});

test('keeps custom material and finish visible in the read-only detail view', () => {
  const store = createCloudStore();
  store.parts = [{ id: 'part-a', name: '法兰', project: '示例项目', order: '', format: 'STEP', material: 'Titanium Grade 5', finish: 'Glass Bead Blasting', size: '', volume: '', quantity: 1, uploaded: '2026-08-28' }];
  const markup = renderParts(store);
  assert.match(markup, /<strong>Titanium Grade 5<\/strong>/);
  assert.match(markup, /<strong>Glass Bead Blasting<\/strong>/);
});

test('maps legacy project lifecycle values to a selectable task status', () => {
  assert.equal(normalizeProjectTaskStatus('active'), '待处理');
  assert.equal(normalizeProjectTaskStatus('进行中'), '进行中');
  assert.equal(normalizeProjectTaskStatus('已完成'), '已完成');
});

test('places legacy tasks by their explicit workflow stage before generic status', () => {
  assert.equal(taskBoardStatus({ stage: '询盘发布', status: '进行中' }), '询盘发布');
  assert.equal(taskBoardStatus({ stage: '内部报价', status: '已完成' }), '内部报价');
  assert.equal(taskBoardStatus({ stage: '询盘发布', status: '未知状态' }), '询盘发布');
  // Once a card is moved, a formal workflow status is canonical even if an
  // older free-form stage/tag still contains the previous node.
  assert.equal(taskBoardStatus({ stage: '询盘发布', status: '内部报价' }), '内部报价');
});

test('shows only claimed tasks, including claimed project roots', () => {
  const tasks = [
    { id: 'mine', projectId: null, assigneeUserId: 'user-me', status: '内部报价' },
    { id: 'unassigned', projectId: null, assigneeUserId: '', status: '询盘发布' },
    { id: 'project-root', projectId: 'project-a', assigneeUserId: 'user-me', status: '立项沟通' }
  ];
  assert.deepEqual(filterMyTasks(tasks, 'user-me').map(task => task.id), ['mine', 'project-root']);
  assert.deepEqual(filterMyTasks(tasks, ''), []);
});

test('re-applies the standalone task boundary whenever the workbench renders', async () => {
  const source = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(source, /const source = filterMyTasks\(store\.tasks \|\| \[\], store\.user\?\.id\);/);
  assert.match(source, /data-action="open-my-task"/);
  assert.match(source, /data-my-task-row/);
  assert.match(source, /const openMyTask = async/);
  assert.match(source, /store\.currentView = project \? 'projects' : 'tasks';\s*renderShell\(\);/);
  assert.match(source, /if \(taskIndex >= 0\) \{/);
  assert.match(source, /store\.tasks = \[updated, \.\.\.\(store\.tasks \|\| \[\]\)\]/);
});

test('filters project communication by project and live message content', () => {
  const conversations = [
    { id: 'a', projectId: 'project-a', projectTitle: '转向节项目', title: '图纸确认', preview: '请确认孔径公差', lastSender: '张工' },
    { id: 'b', projectId: 'project-b', projectTitle: '法兰项目', title: '交期调整', preview: '改到周五', lastSender: '李工' },
    { id: 'c', projectId: null, title: '企业群聊', preview: '下午开会' }
  ];
  assert.deepEqual(filterProjectCommunications(conversations).map(item => item.id), ['a', 'b']);
  assert.deepEqual(filterProjectCommunications(conversations, { projectId: 'project-b' }).map(item => item.id), ['b']);
  assert.deepEqual(filterProjectCommunications(conversations, { query: '孔径' }).map(item => item.id), ['a']);
  assert.deepEqual(filterProjectCommunications(conversations, { query: '李工' }).map(item => item.id), ['b']);
});

test('filters chat conversations by unread state, mentions, later state, scope and search', () => {
  const conversations = [
    { id: 'enterprise', projectId: null, title: '企业群聊', preview: '排产更新', unreadCount: 2, mentionCount: 1, savedForLater: false },
    { id: 'project-a', projectId: 'a', projectTitle: '法兰项目', title: '图纸确认', preview: '公差已更新', unreadCount: 0, mentionCount: 0, savedForLater: true },
    { id: 'project-b', projectId: 'b', projectTitle: '壳体项目', title: '交期确认', preview: '周五发货', unreadCount: 1, mentionCount: 0, savedForLater: false }
  ];
  assert.deepEqual(filterChatConversations(conversations, { filter: 'unread' }).map(item => item.id), ['enterprise', 'project-b']);
  assert.deepEqual(filterChatConversations(conversations, { filter: 'mentions' }).map(item => item.id), ['enterprise']);
  assert.deepEqual(filterChatConversations(conversations, { filter: 'later' }).map(item => item.id), ['project-a']);
  assert.deepEqual(filterChatConversations(conversations, { scope: 'enterprise' }).map(item => item.id), ['enterprise']);
  assert.deepEqual(filterChatConversations(conversations, { scope: 'projects' }).map(item => item.id), ['project-a', 'project-b']);
  assert.deepEqual(filterChatConversations(conversations, { scope: 'project:b' }).map(item => item.id), ['project-b']);
  assert.deepEqual(filterChatConversations(conversations, { query: '公差' }).map(item => item.id), ['project-a']);
});

test('detects new thread summaries and merges polled messages by message id', () => {
  assert.equal(conversationHasNewMessages({ messageCount: 2, lastMessageAt: '2026-01-01T10:00:00.000Z' }, { messageCount: 3, lastMessageAt: '2026-01-01T10:01:00.000Z' }), true);
  assert.equal(conversationHasNewMessages({ messageCount: 2, lastMessageAt: '2026-01-01T10:00:00.000Z' }, { messageCount: 2, lastMessageAt: '2026-01-01T10:01:00.000Z' }), true);
  assert.equal(conversationHasNewMessages({ messageCount: 2, lastMessageAt: '2026-01-01T10:00:00.000Z', preview: '本地发送' }, { messageCount: 2, lastMessageAt: '2026-01-01T10:00:00.000Z', preview: '成员回复' }), true);
  assert.equal(conversationHasNewMessages({ messageCount: 3, lastMessageAt: '2026-01-01T10:01:00.000Z' }, { messageCount: 2, lastMessageAt: '2026-01-01T10:00:00.000Z' }), false);
  assert.deepEqual(mergeConversationMessages(
    [{ id: 'local-send', body: '刚发送', createdAt: '2026-01-01T10:00:01.000Z' }],
    [{ id: 'remote-reply', body: '收到', createdAt: '2026-01-01T10:00:02.000Z' }]
  ).map(message => message.id), ['local-send', 'remote-reply']);
});

test('renders communication as an existing-task inbox with no topic creation', async () => {
  const markup = renderCommunication(createCloudStore());
  assert.match(markup, /data-communication-lite/);
  assert.match(markup, /隐藏项目/);
  assert.doesNotMatch(markup, /create-communication|发起|communication-detail/);
  const source = await readFile(new URL('../communication-ui.js', import.meta.url), 'utf8');
  assert.match(source, /contextmenu/);
  assert.match(source, /data-comm-menu/);
  assert.ok(source.includes('/comments'));
  assert.doesNotMatch(source, /conversations/);
});

test('keeps chat detail selection inside the active filtered list', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(appSource, /const selected = conversations\.find\(item => item\.id === store\.selectedChat\) \|\| conversations\[0\] \|\| null;/);
  assert.match(appSource, /if \(selected\?\.id !== store\.selectedChat\) store\.selectedChat = selected\?\.id \|\| '';/);
  assert.match(appSource, /store\.currentView === 'chat' && store\.selectedChat && !Object\.prototype\.hasOwnProperty\.call\(store\.messages, store\.selectedChat\)/);
  assert.match(appSource, /void loadChatConversation\(store\.selectedChat\);/);
  assert.match(appSource, /data-action="clear-chat-filters"/);
  assert.match(appSource, /data-action="create-chat-conversation"/);
});

test('creates a named enterprise channel instead of an implicit generic chat', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(appSource, /function openChatConversationDialog\(submit\)/);
  assert.match(appSource, /当前企业的全部成员均可查看和参与/);
  assert.match(appSource, /const createEnterpriseConversation = async title => \{[\s\S]*?apiRequest\('\/api\/conversations', \{ method: 'POST', body: JSON\.stringify\(\{ title \}\) \}, store\.apiToken\)[\s\S]*?store\.chatFilter = 'all';\s+store\.chatScope = 'enterprise';/);
  assert.match(appSource, /openChatConversationDialog\(createEnterpriseConversation\);/);
  assert.doesNotMatch(appSource, /title: '企业沟通'/);
});

test('preserves an in-flight sent chat message and does not send during IME composition', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(appSource, /const mergedMessages = new Map\(loadedMessages\.map\(message => \[message\.id, message\]\)\);/);
  assert.match(appSource, /inFlightMessages\.forEach\(message => \{ if \(!mergedMessages\.has\(message\.id\)\) mergedMessages\.set\(message\.id, message\); \}\);/);
  assert.match(appSource, /event\.key === 'Enter' && !event\.isComposing && !event\.ctrlKey && !event\.shiftKey/);
});

test('scopes automatic chat polling to a visible enterprise session and stops it on logout', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(appSource, /const CHAT_SYNC_INTERVAL_MS = 8000;/);
  assert.match(appSource, /const canAutoSyncChats = \(\) => store\.authenticated && store\.consoleMode === 'enterprise' && Boolean\(store\.apiToken\) && document\.visibilityState === 'visible';/);
  assert.match(appSource, /const result = await apiRequest\('\/api\/conversations', \{\}, token\);/);
  assert.match(appSource, /syncVisibleConversationMessages = async \(conversationId, token\) => \{[\s\S]*?messages\?markRead=true/);
  assert.match(appSource, /window\.setInterval\(\(\) => \{ void syncChatConversations\(\); \}, CHAT_SYNC_INTERVAL_MS\)/);
  assert.match(appSource, /#logoutButton'\)\?\.addEventListener\('click', async \(\) => \{\s+stopChatSync\(\);/);
  assert.match(appSource, /document\.addEventListener\('visibilitychange', \(\) => \{[\s\S]*?startChatSync\(\);/);
  assert.match(appSource, /content\.addEventListener\('compositionstart', event => \{/);
  assert.match(appSource, /if \(conversationInputComposing \|\| content\.querySelector\('#communicationInput'\)\?\.disabled\) \{/);
});

test('uses the platform topbar control as a console switch', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(appSource, /if \(store\.consoleMode === 'platform'\) return switchConsole\('enterprise'\);/);
});

test('rehydrates the enterprise page when leaving the platform console', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(appSource, /document\.body\.dataset\.consoleMode === 'platform'/);
  assert.match(appSource, /window\.location\.assign\('enterprise\.html'\)/);
});

test('does not expose a platform shell to non-platform accounts', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(appSource, /pageMode === 'platform' && !store\.platformAdmin/);
  assert.match(appSource, /当前账号没有平台管理权限/);
});

test('keeps enterprise and platform context controls reachable on mobile', async () => {
  const enterpriseSource = await readFile(new URL('../enterprise.html', import.meta.url), 'utf8');
  const platformSource = await readFile(new URL('../platform.html', import.meta.url), 'utf8');
  const cloudSource = await readFile(new URL('../cloud.css', import.meta.url), 'utf8');
  assert.match(enterpriseSource, /id="enterpriseMenu"[^>]*aria-label="打开企业成员管理"/);
  assert.match(platformSource, /id="enterpriseMenu"[^>]*aria-label="返回企业工作台"/);
  assert.match(cloudSource, /\.enterprise-button::before/);
  assert.doesNotMatch(cloudSource, /\.enterprise-button \{ display: none; \}/);
});

test('makes the top account control actionable', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  const cloudSource = await readFile(new URL('../cloud.css', import.meta.url), 'utf8');
  assert.match(appSource, /topUser\?\.addEventListener\('click'/);
  assert.match(appSource, /data-account-action="logout"/);
  assert.match(cloudSource, /\.account-menu\{/);
});

test('uses the table center as the local CAD, ZIP, and PDF quotation entry', async () => {
  const source = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  const parserSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const workspaceSource = await readFile(new URL('../workspace.html', import.meta.url), 'utf8');
  const store = createCloudStore();
  store.projects = [{ id: 'project-a', title: '飞行器支架' }];
  const markup = renderWorkspace(store);
  assert.match(markup, /上传 STEP 或项目压缩包/);
  assert.match(markup, /3D 零件在当前页面后台生成 BOM/);
  assert.match(markup, /只有 2D PDF 图纸会进入气泡标注与 FAIR/);
  assert.match(markup, /data-workspace-upload/);
  assert.match(markup, /\.step,\.stp,\.igs,\.iges,\.brep,\.pdf,\.zip/);
  assert.match(markup, /data-workspace-project/);
  assert.match(markup, /本地解析/);
  assert.match(markup, />生成项目清单<\/button>/);
  assert.doesNotMatch(markup, /文档中心|data-office-upload/);
  assert.match(source, /mfggo-workspace-open-files/);
  assert.match(source, /title="3D 项目清单后台解析"/);
  assert.match(source, /\/lists\/import/);
  assert.match(source, /项目清单导入失败/);
  assert.match(source, /已生成 \$\{savedParts\.length\} 项 BOM，并关联到项目任务/);
  assert.match(parserSource, /saveToMainProject\(\{automatic:true\}\)/);
  assert.match(workspaceSource, /同步项目清单/);
});

test('keeps 3D and project archives in the table center while PDF opens FAIR', async () => {
  assert.equal(getWorkspaceLaunchMode([{ name: 'bracket.step' }]), 'background');
  assert.equal(getWorkspaceLaunchMode([{ name: 'assembly.zip' }]), 'background');
  assert.equal(getWorkspaceLaunchMode([{ name: 'drawing.pdf' }]), 'pdf');
  assert.equal(getWorkspaceLaunchMode([{ name: 'drawing.pdf' }, { name: 'bracket.stp' }]), 'background');

  const backgroundStore = createCloudStore();
  backgroundStore.projects = [{ id: 'project-a', title: '飞行器支架' }];
  backgroundStore.bomProjectId = 'project-a';
  backgroundStore.workspaceFiles = [{ name: 'bracket.step', size: 128 }];
  backgroundStore.workspaceStarted = true;
  backgroundStore.workspaceMode = 'background';
  const backgroundMarkup = renderWorkspace(backgroundStore);
  assert.match(backgroundMarkup, /class="view quote-workspace-entry"/);
  assert.match(backgroundMarkup, /workspace-background-frame/);
  assert.match(backgroundMarkup, /aria-hidden="true"/);
  assert.doesNotMatch(backgroundMarkup, /class="view embedded-workspace-view"/);

  const pdfStore = createCloudStore();
  pdfStore.bomProjectId = 'project-a';
  pdfStore.workspaceStarted = true;
  pdfStore.workspaceMode = 'pdf';
  const pdfMarkup = renderWorkspace(pdfStore);
  assert.match(pdfMarkup, /class="view embedded-workspace-view"/);
  assert.match(pdfMarkup, /2D 图纸标注与 FAIR 工作台/);
  assert.doesNotMatch(pdfMarkup, /workspace-background-frame/);

  const parserSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const backgroundStart = parserSource.indexOf('if(state.backgroundSync)');
  const backgroundEnd = parserSource.indexOf("$('#landing').classList.add('hidden')", backgroundStart);
  assert.ok(backgroundStart >= 0 && backgroundEnd > backgroundStart);
  const backgroundBranch = parserSource.slice(backgroundStart, backgroundEnd);
  assert.match(backgroundBranch, /parseCadItem\(item\)/);
  assert.match(backgroundBranch, /saveToMainProject\(\{automatic:true\}\)/);
  assert.doesNotMatch(backgroundBranch, /selectFile\(|openCad\(|renderCad\(/);
});

test('builds the project task BOM table from linked parts and the latest quote', () => {
  const rows = getProjectBomRows({
    parts: [{ id: 'part-a', name: '支架.step', format: 'STEP', material: 'Aluminum 6061', size: '120 × 80 × 25', quantity: 2 }],
    quotes: [{
      id: 'quote-a',
      quoteNo: 'QT-BOM-001',
      currency: 'CNY',
      updatedAt: '2026-09-01T08:00:00.000Z',
      lines: [{ id: 'line-a', partId: 'part-a', name: '支架.step', material: 'Aluminum 6061', process: 'CNC 铣削', quantity: 2, unitPriceCents: 12800, subtotalCents: 25600 }]
    }]
  });
  assert.deepEqual(rows, [{
    id: 'part-a',
    kind: 'part',
    name: '支架.step',
    previewUrl: '',
    format: 'STEP',
    dimensions: '120 × 80 × 25',
    material: 'Aluminum 6061',
    process: 'CNC 铣削',
    quantity: 2,
    unitPriceCents: 12800,
    subtotalCents: 25600,
    quoteId: 'quote-a',
    currency: 'CNY'
  }]);
});

test('uses the BOM selected by the project detail instead of always using the latest quote', () => {
  const snapshot = {
    parts: [{ id: 'part-a', name: '支架.step', quantity: 1 }],
    quotes: [
      { id: 'quote-old', updatedAt: '2026-08-01T08:00:00.000Z', lines: [{ partId: 'part-a', name: '支架.step', quantity: 2, unitPriceCents: 1000 }] },
      { id: 'quote-new', updatedAt: '2026-09-01T08:00:00.000Z', lines: [{ partId: 'part-a', name: '支架.step', quantity: 4, unitPriceCents: 2000 }] }
    ]
  };
  assert.equal(getProjectBomRows(snapshot)[0].quoteId, 'quote-new');
  assert.deepEqual(getProjectBomRows(snapshot, 'quote-old').map(row => [row.quoteId, row.quantity, row.unitPriceCents]), [['quote-old', 2, 1000]]);
});

test('mounts the authorized project list control without the legacy priced BOM popup', async () => {
  const source = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(source, /renderProjectListsSection\(store, project\)/);
  assert.match(source, /mountProjectListsSection\(host, store, project/);
  assert.doesNotMatch(source, /data-project-bom-open|data-project-bom-select|data-task-field="projectList"/);
});

test('keeps the BOM preview scroll position when auto-sync redraws rows', async () => {
  const source = await readFile(new URL('../project-lists-ui.js', import.meta.url), 'utf8');
  assert.match(source, /const scrollPosition = scrollHost \? \{ left: scrollHost\.scrollLeft, top: scrollHost\.scrollTop \} : null;/);
  assert.match(source, /scrollHost\.scrollLeft = scrollPosition\.left; scrollHost\.scrollTop = scrollPosition\.top/);
  assert.match(source, /if \(silent && viewer && state\.list\) \{[\s\S]*?viewer\.update\(state\.list, writable\(\), currentPricing\(\)\);[\s\S]*?\} else \{[\s\S]*?render\(\);/);
});

test('opens a project card as its top-level task detail, without a second project workspace', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  const cloudSource = await readFile(new URL('../cloud.css', import.meta.url), 'utf8');
  const taskDetailSource = await readFile(new URL('../task-detail.css', import.meta.url), 'utf8');
  assert.match(appSource, /nav\.innerHTML = visibleNav\.map\(renderItem\)\.join\(''\)/);
  assert.match(appSource, /apiRequest\(`\/api\/tasks\/\$\{encodeURIComponent\(selected\.rootTaskId\)\}\/detail`, \{\}, store\.apiToken\)/);
  assert.match(appSource, /openTaskDetail\(store, detailResult\.body, \{ onClose: \(\) => renderShell\(\) \}\)/);
  assert.match(appSource, /const clearLegacyProjectTaskRoute = \(\) => \{[\s\S]*?\^#\\\/projects\\\/\[\^\/\?\#\]\+\\\/tasks/);
  assert.match(appSource, /window\.addEventListener\('hashchange', clearLegacyProjectTaskRoute\)/);
  assert.doesNotMatch(appSource, /openTaskDetail\(store, \{ task: null \}/);
  assert.doesNotMatch(appSource, /\/api\/projects\/\$\{encodeURIComponent\(projectId\)\}\/workspace/);
  assert.match(appSource, /class="project-task-modal"/);
  assert.match(taskDetailSource, /\.project-task-modal/);
  assert.doesNotMatch(appSource, /task-detail-shell|project-detail-shell|project-popup-(?:tab|task|resource|activity|create|upload)/);
  assert.doesNotMatch(taskDetailSource, /task-detail-shell|project-detail-shell|project-popup-/);
  assert.doesNotMatch(cloudSource, /project-detail-shell|project-popup-/);
});

test('serializes task detail saves so a stale request cannot overwrite a later choice', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(appSource, /let saveChain = Promise\.resolve\(\);/);
  assert.match(appSource, /const queuedSave = saveChain\.then\(persist, persist\);/);
  assert.match(appSource, /saveChain = queuedSave\.catch\(\(\) => undefined\);/);
  assert.match(appSource, /const close = async \(\) => \{[\s\S]*?await saveChain;[\s\S]*?options\.onClose/);
  assert.match(appSource, /const renderAssignee = member => \{/);
  assert.match(appSource, /const selectionVersion = \+\+assigneeSelectionVersion;[\s\S]*?renderAssignee\(member\);[\s\S]*?const saved = await saveFields/);
  assert.match(appSource, /detail\.task\.assigneeUserId \|\| ''\) !== nextValue/);
});

test('covers the task detail collaboration surface shown in the acceptance UI', async () => {
  const source = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="taskDetailTitle"/);
  assert.match(source, /id="taskDetailTitle"[^>]+aria-label="任务名称"/);
  // The simplified task detail no longer exposes the legacy start-date field.
  // Status and due date remain editable in the current acceptance UI.
  for (const field of ['status', 'dueAt']) {
    assert.match(source, new RegExp(`data-task-field="${field}"`));
  }
  assert.doesNotMatch(source, /data-task-field="startAt"/);
  assert.match(source, /data-task-note-panel/);
  assert.match(source, /data-task-rich-editor/);
  assert.match(source, /saveFields\(\{ description: html \}\)/);
  assert.doesNotMatch(source, /data-task-field="progress"/);
  assert.match(source, /data-assignee-picker/);
  assert.match(source, /data-assignee-search/);
  assert.match(source, /data-task-feed="all"/);
  assert.match(source, /data-task-feed="comments"/);
  assert.match(source, /data-task-feed="attachments"/);
  assert.match(source, /project\?\.id \? projectBoardStage\(project\) : taskBoardStatus\(detail\.task\)/);
  assert.match(source, /'assigneeUserId', 'progress', 'step'/);
  assert.match(source, /filter === 'attachments'[\s\S]*?activities\.filter\(item => item\.type === 'attachment'\)/);
  assert.match(source, /data-task-comment/);
  assert.match(source, /请输入评论，Enter 发送 \/ Ctrl \+ Enter 换行/);
  assert.match(source, /class="task-comment-attachment-zone"[^>]+data-task-attachments-section[^>]+data-task-attachment-dropzone/);
  assert.match(source, /可粘贴图片、拖动文件到输入框，或点击附件按钮/);
  assert.match(source, /data-task-attachment-input/);
  assert.match(source, /data-task-attachment-upload/);
  assert.doesNotMatch(source, /class="task-attachment-empty"[^>]+data-task-attachments-empty/);
  assert.doesNotMatch(source, /还没有附件，上传图纸或协作文件开始工作。/);
  assert.match(source, /const taskAttachmentPath = `\$\{taskResourcePath\}\/attachments`/);
  assert.match(source, /data-task-attachment-download/);
  assert.match(source, /data-task-attachment-preview/);
  assert.match(source, /taskAttachmentApiPath\}\/\$\{encodeURIComponent\(attachment\.id\)\}\/preview/);
  assert.match(source, /data-task-attachment-delete/);
  assert.match(source, /detail\.attachments = attachments/);
  assert.match(source, /data-copy-task-link/);
  assert.match(source, /data-close-task-detail/);
  assert.match(source, /detail\.projectComments/);
  assert.match(source, /task\.comment\.create.*project\.comment\.create/);
  assert.match(source, /item\.displayName \|\| item\.username \|\| '系统'/);
  assert.match(source, /'storage\.file\.upload': `上传了企业文件/);
});

test('keeps subtask participants scoped to the subtask assignee', async () => {
  const source = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(source, /if \(subtaskContext\?\.subtaskId\) return assignee \? \[assignee\] : \[\]/);
  assert.match(source, /return projectMembers\.length \? projectMembers : \(assignee \? \[assignee\] : \[\]\)/);
  assert.match(source, /const canManageProjectMembers = Boolean\(!subtaskContext\?\.subtaskId && project\?\.id/);
  assert.match(source, /const participantPanelTitle = subtaskContext\?\.subtaskId \? '负责人' : '参与者'/);
  assert.match(source, /renderParticipants\(member\)/);
});

test('keeps participant removal errors beside the shortcut action', async () => {
  const source = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../task-detail.css', import.meta.url), 'utf8');
  assert.match(source, /data-participant-menu-feedback role="status" aria-live="polite" hidden/);
  assert.match(source, /const feedback = participantMenu\.querySelector\('\[data-participant-menu-feedback\]'\)/);
  assert.match(source, /feedback\.textContent = result\.body\?\.message \|\| '移除失败，请重试'/);
  assert.match(source, /feedback\.hidden = false;/);
  assert.match(css, /\.participant-inline-menu p\{[^}]*overflow-wrap:anywhere/);
  assert.match(source, /store\.role !== 'owner' && memberCan\(store, 'project\.members\.manage'\)/);
  assert.match(source, /只有当前负责人或获得“管理项目参与者”授权的成员可以操作/);
});

test('rechecks member-management capability before a picker can submit', async () => {
  const source = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(source, /const openProjectMemberPicker = \(\) => \{\s*if \(!project\?\.id \|\| !getTaskCapabilities\(\)\.canManageProjectMembers\) return;/);
  assert.match(source, /const candidate = event\.target\.closest\('\[data-project-member-candidate\]'\);\s*if \(!candidate\) return;\s*if \(!getTaskCapabilities\(\)\.canManageProjectMembers\) \{[\s\S]*?closePicker\(\);[\s\S]*?await refreshTaskExecution\(\);/);
  assert.match(source, /result\.response\?\.status === 403/);
});

test('defaults a new subtask to the current creator while retaining an explicit unassigned option', async () => {
  const source = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(source, /const defaultAssigneeId = existing[\s\S]*?members\.some\(member => String\(member\?\.id \|\| ''\) === currentUserId\) \? currentUserId : ''/);
  assert.match(source, /<option value="" \$\{defaultAssigneeId \? '' : 'selected'\}>未分配<\/option>/);
  assert.match(source, /String\(member\.id\) === defaultAssigneeId \? 'selected' : ''/);
});

test('defaults a new standalone task to the current creator while retaining an explicit unassigned option', async () => {
  const source = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  const dialogSource = source.slice(source.indexOf('function openTaskDialog'), source.indexOf('async function writeClipboardText'));
  assert.match(dialogSource, /const currentUserId = String\(store\.user\?\.id \|\| store\.user\?\.userId \|\| ''\)\.trim\(\);/);
  assert.match(dialogSource, /const defaultAssigneeId = existing[\s\S]*?members\.some\(member => String\(member\?\.id \|\| ''\)\.trim\(\) === currentUserId\) \? currentUserId : ''/);
  assert.match(dialogSource, /<option value="" \$\{defaultAssigneeId \? '' : 'selected'\}>未分配<\/option>/);
  assert.match(dialogSource, /String\(member\?\.id \|\| ''\)\.trim\(\) === defaultAssigneeId \? 'selected' : ''/);
});

test('routes subtask comments and attachments through the nested task scope', async () => {
  const source = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(source, /const taskResourcePath = subtaskContext\?\.subtaskId[\s\S]*?\$\{taskSubtaskBasePath\}\/\$\{encodeURIComponent\(subtaskContext\.subtaskId\)\}/);
  assert.match(source, /const taskCommentPath = `\$\{taskResourcePath\}\/comments`/);
  assert.match(source, /const taskAttachmentPath = `\$\{taskResourcePath\}\/attachments`/);
  assert.match(source, /fetch\(`\$\{apiBase\}\$\{taskAttachmentApiPath\}`/);
  assert.match(source, /apiRequest\(taskCommentPath/);
});

test('layers the project member picker above the task detail modal', async () => {
  const source = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  const taskDetailSource = await readFile(new URL('../task-detail.css', import.meta.url), 'utf8');
  assert.match(source, /project-member-picker-backdrop/);
  assert.match(taskDetailSource, /\.project-member-picker-backdrop\s*\{\s*z-index:\s*220/);
  assert.match(source, /const nestedDialog = \[\.\.\.document\.querySelectorAll\('body > \.project-dialog-backdrop'\)\]/);
  assert.match(source, /nestedDialog\.querySelector\('\[data-task-attachment-preview-close\], \[data-project-member-picker-close\], \[data-subtask-dialog-close\]/);
});

test('moves project cards through the ten lifecycle nodes without progress UI', async () => {
  const source = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../cloud.css', import.meta.url), 'utf8');
  assert.match(source, /data-project-card data-project-id=/);
  assert.match(source, /data-project-dropzone/);
  assert.doesNotMatch(source, /customStages/);
  assert.match(source, /待处理\|未开始\|立项\|沟通/);
  assert.match(source, /异常\|阻塞\|暂停\|挂起\|优先/);
  assert.match(source, /const draggable = Boolean\(project\.rootTaskId && canExecute\)/);
  assert.match(source, /apiRequest\(`\/api\/tasks\/\$\{encodeURIComponent\(project\.rootTaskId\)\}`,[\s\S]*?status: targetStage/);
  assert.match(source, /event\.target\.closest\('\[data-project-stage\]'\)[\s\S]*?projectColumn\?\.querySelector\('\[data-project-dropzone\]'\)/);
  assert.match(source, /event\.target\.closest\('\[data-task-board-column\]'\)[\s\S]*?taskColumn\?\.querySelector\('\[data-task-board-dropzone\]'\)/);
  assert.match(source, /Object\.assign\(project, \{ stage: targetStage, status: targetStage \}\)[\s\S]*?projectDropzone\.appendChild\(projectCard\)/);
  assert.match(source, /Object\.assign\(project, result\.body\.project\);\s*projectCard\?\.classList\.remove\('is-saving'\);\s*showToast/);
  assert.match(source, /task\.status = targetStatus;[\s\S]*?dropzone\.appendChild\(taskCard\)/);
  assert.match(source, /Object\.assign\(task, result\.body\.task\);\s*taskCard\?\.classList\.remove\('is-saving'\);\s*showToast/);
  assert.match(source, /class="project-card"/);
  assert.match(css, /\.project-board-home \.project-card\.project-priority-urgent/);
  assert.doesNotMatch(source, /class="progress-row"/);
  assert.match(css, /\.project-board-home \.kanban-items\.drag-over/);
  assert.match(css, /\.project-board-home \.kanban-items\{[^}]*flex:1/);
  assert.match(css, /\.task-board-dropzone\{[^}]*flex:1/);
  assert.match(css, /\.project-priority-label\.urgent/);
  assert.doesNotMatch(css, /\.project-board-home \.progress-row/);
});

test('does not copy a project root task into the standalone task workbench', async () => {
  const source = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  // Project roots are the canonical task for a project. The shortcut menu
  // must stop before POST /api/tasks, otherwise the copy loses project scope
  // and becomes a card in "我的任务".
  assert.match(source, /if \(action === 'copy-task'\) \{[\s\S]*?if \(project\?\.rootTaskId === taskId\) \{[\s\S]*?项目根任务不能复制为独立任务/);
});

test('project shortcuts separate executor actions from explicitly granted project recycling', () => {
  const executor = { canEdit: true, canChangeStatus: true, canManageSubtasks: true, canDelete: true };
  const taskOnly = renderTaskShortcutMenu({ projectRoot: true, capabilities: executor });
  assert.doesNotMatch(taskOnly, /data-task-shortcut="copy-task"|data-task-shortcut="recycle"/);
  for (const action of ['set-status', 'add-subtask', 'view-subtasks', 'set-due']) assert.match(taskOnly, new RegExp(`data-task-shortcut="${action}"`));
  const manager = renderTaskShortcutMenu({ projectRoot: true, capabilities: { canEdit: false, canChangeStatus: false }, canRecycleProject: true });
  assert.match(manager, /data-task-shortcut="recycle"/);
  assert.match(manager, /data-task-shortcut="set-status"[^>]*disabled/);
  assert.match(manager, /data-task-shortcut="add-subtask"[^>]*disabled/);
  assert.doesNotMatch(manager, /永久删除/);
  assert.match(renderTaskShortcutMenu({ capabilities: executor }), /data-task-shortcut="recycle"/);
});

test('previews selected task files before upload and supports removing the pending queue', async () => {
  const source = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../task-detail.css', import.meta.url), 'utf8');
  assert.match(source, /let pendingTaskAttachments = \[\];/);
  assert.match(source, /const queueTaskAttachments = files => \{/);
  assert.match(source, /URL\.createObjectURL\(file\)/);
  assert.match(source, /data-task-attachment-pending-delete/);
  assert.match(source, /data-task-attachment-clear/);
  assert.match(source, /data-task-attachment-submit/);
  assert.match(source, /const uploadTaskAttachments = async pendingItems => \{/);
  assert.match(source, /queueTaskAttachments\(event\.target\.files\)/);
  assert.match(source, /void uploadTaskAttachments\(pendingTaskAttachments\)/);
  assert.match(source, /pending\.previewUrl/);
  assert.match(source, /taskAttachmentFileType\(pending\.name\)/);
  assert.match(css, /\.task-attachment-pending-block/);
  assert.match(css, /\.task-attachment-pending-preview img/);
  assert.match(css, /\.task-attachment-pending-list/);
  assert.match(css, /\.task-attachment-submit/);
});

test('keeps the task popup fields within a narrow mobile viewport', async () => {
  const source = await readFile(new URL('../task-detail.css', import.meta.url), 'utf8');
  assert.match(source, /@media\(max-width:900px\)\{[\s\S]*?\.task-property-list>div\{grid-template-columns:84px minmax\(0,1fr\);min-width:0\}/);
  assert.match(source, /@media\(max-width:560px\)\{[\s\S]*?\.task-property-list>div\{grid-template-columns:1fr;gap:6px/);
  assert.match(source, /\.task-date-range input\{width:100%;min-width:0\}/);
});

test('removes the legacy full-page project workspace route', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  const enterpriseSource = await readFile(new URL('../enterprise.html', import.meta.url), 'utf8');
  const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(appSource, /#\/projects|selectedProjectId|projectWorkspace|projectTool|projectTaskRoute|loadProjectWorkspace/);
  assert.doesNotMatch(appSource, /create-project-task|import-project-tasks|create-project-quote|manage-project-quality|create-project-part|back-projects|close-project-tool/);
  assert.doesNotMatch(appSource, /project-workspace/);
  assert.doesNotMatch(`${enterpriseSource}\n${indexSource}`, /project-workspace\.css/);
  await assert.rejects(readFile(new URL('../project-workspace.css', import.meta.url), 'utf8'));
});

test('opens projects in the popup without demo fallbacks', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(appSource, /data-project-popup-workspace/);
  assert.doesNotMatch(appSource, /onOpenWorkspace: \(\) => loadProjectWorkspace\(projectId, 'tasks'\)/);
  assert.doesNotMatch(appSource, /openProjectTaskModal/);
  assert.doesNotMatch(appSource, /本地演示组织|后端未连接，当前为本地演示模式/);
  assert.doesNotMatch(appSource, /export const (PARTS|CHATS|COMMUNICATIONS) =/);
  assert.doesNotMatch(appSource, /data-project-popup-toggle|data-project-popup-upload/);
});

test('keeps new and imported tasks standalone', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  const dialogSource = appSource.slice(appSource.indexOf('function openTaskDialog'), appSource.indexOf('const TASK_IMPORT_FIELDS'));
  const importSource = appSource.slice(appSource.indexOf('const TASK_IMPORT_FIELDS'), appSource.indexOf('const TASK_STATUS_OPTIONS'));
  assert.doesNotMatch(dialogSource, /name="projectId"|data\.get\('projectId'\)|projectId:/);
  assert.doesNotMatch(importSource, /所属项目|taskImportValue\(row, state\.mapping, 'project'\)|projectId:/);
  assert.match(appSource, /data-action="import-tasks"/);
  assert.match(appSource, /if \(action === 'import-tasks'\)/);
});

test('opens a communication project in the popup instead of the legacy activity route', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(appSource, /if \(action === 'open-communication-project'\) \{\s+const conversation = store\.conversations\.find\(item => item\.id === store\.selectedCommunication\);\s+if \(conversation\?\.projectId\) openProjectCardPopup\(conversation\.projectId\);\s+return;\s+\}/);
  assert.doesNotMatch(appSource, /open-communication-project[\s\S]{0,400}openProjectCardPopup\([^)]*,\s*['"]activity['"]\)/);
});

test('keeps chat filters and attachments wired to persistent APIs', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  const apiSource = await readFile(new URL('../server/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /data-chat-filter="\$\{id\}"/);
  assert.match(appSource, /data-chat-scope/);
  assert.doesNotMatch(appSource, /data-chat-emoji|toggle-chat-emoji|CHAT_EMOJIS|chatEmojiOpen/);
  assert.match(appSource, /data-chat-attachment-input/);
  assert.match(appSource, /data-chat-attachment-download/);
  assert.match(appSource, /toggle-chat-later/);
  assert.match(appSource, /\/api\/chat-attachments/);
  assert.match(appSource, /\/state`/);
  assert.match(apiSource, /router\.put\('\/conversations\/:conversationId\/state'/);
  assert.match(apiSource, /router\.post\('\/chat-attachments'/);
  assert.match(apiSource, /router\.get\('\/chat-attachments\/:attachmentId\/download'/);
  assert.doesNotMatch(appSource, /const (CHATS|CHAT_MESSAGES) =/);
});

test('clears tenant data and chat drafts on logout or a fresh account session', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(appSource, /const resetClientState = \(\) => \{/);
  assert.match(appSource, /store\.projects = \[\];/);
  assert.match(appSource, /store\.conversations = \[\];/);
  assert.match(appSource, /store\.chatDraftAttachments = \[\];/);
  assert.match(appSource, /store\.communicationDraftAttachments = \[\];/);
  assert.match(appSource, /document\.querySelectorAll\('#projectDialog, #communicationDialog, #chatConversationDialog, #memberDialog, #partDialog, \[data-task-detail-host\]'\)/);
  assert.match(appSource, /resetClientState\(\);\s+saveSession\(store\)/);
});

test('guards async chat and communication responses against stale selections', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(appSource, /const requestConversationId = conversationId;/);
  assert.match(appSource, /store\.selectedChat === requestConversationId/);
  assert.match(appSource, /store\.selectedCommunication === requestConversationId/);
});

test('does not enter the shell when initial tenant hydration fails', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(appSource, /const hydrated = await hydrateProjects\(store\);/);
  assert.match(appSource, /登录成功，但企业数据暂时无法加载，请检查服务后重试/);
  assert.match(appSource, /if \(!hydrated\) \{\s+resetClientState\(\);/);
});
