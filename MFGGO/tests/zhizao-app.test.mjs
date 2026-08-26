import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudStore, filterChatConversations, filterProjectCommunications, filterProjects, getViewTitle, getProgressTone } from '../zhizao-app.js';
import { readFile } from 'node:fs/promises';

test('creates a logged-out cloud store with the reference navigation', () => {
  const store = createCloudStore();
  assert.equal(store.authenticated, false);
  assert.deepEqual(store.nav.map(item => item.id), [
    'projects', 'tasks', 'parts', 'workspace', 'bom', 'communication', 'chat', 'stats'
  ]);
  assert.equal(store.nav.find(item => item.id === 'workspace')?.label, '制表中心');
  assert.equal(store.nav.find(item => item.id === 'bom')?.label, 'BOM 报价助手');
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

test('keeps chat detail selection inside the active filtered list', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(appSource, /const selected = conversations\.find\(item => item\.id === store\.selectedChat\) \|\| conversations\[0\] \|\| null;/);
  assert.match(appSource, /if \(selected\?\.id !== store\.selectedChat\) store\.selectedChat = selected\?\.id \|\| '';/);
  assert.match(appSource, /store\.currentView === 'chat' && store\.selectedChat && !Object\.prototype\.hasOwnProperty\.call\(store\.messages, store\.selectedChat\)/);
  assert.match(appSource, /void loadChatConversation\(store\.selectedChat\);/);
  assert.match(appSource, /data-action="clear-chat-filters"/);
  assert.match(appSource, /data-action="focus-chat-input"/);
});

test('preserves an in-flight sent chat message and does not send during IME composition', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(appSource, /const mergedMessages = new Map\(loadedMessages\.map\(message => \[message\.id, message\]\)\);/);
  assert.match(appSource, /inFlightMessages\.forEach\(message => \{ if \(!mergedMessages\.has\(message\.id\)\) mergedMessages\.set\(message\.id, message\); \}\);/);
  assert.match(appSource, /event\.key === 'Enter' && !event\.isComposing && !event\.ctrlKey && !event\.shiftKey/);
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

test('keeps the document center and BOM assistant as separate workspaces', async () => {
  const source = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(source, /data-office-document="?\$\{doc\.id\}/);
  assert.match(source, /onlyoffice\.html\?embedded=1&configUrl=\$\{apiBase\}\/documents\/\$\{encodeURIComponent\(doc\.id\)\}\/config/);
  assert.doesNotMatch(source, /office-editor-back|back-document-library/);
  assert.doesNotMatch(source, /&_\=\$\{Date\.now\(\)\}/);
  assert.match(source, /src="\.\/workspace\.html" title="BOM 报价助手"/);
  assert.doesNotMatch(source, /window\.location\.assign\('workspace\.html'\)/);
});

test('keeps project management focused on popup tasks, resources, and activity', async () => {
  const appSource = await readFile(new URL('../zhizao-app.js', import.meta.url), 'utf8');
  assert.match(appSource, /cloud-nav-group/);
  assert.match(appSource, /data-project-popup-tab="tasks"/);
  assert.match(appSource, /data-project-popup-tab="resources"/);
  assert.match(appSource, /data-project-popup-tab="activity"/);
  assert.match(appSource, /data-project-popup-create/);
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
  assert.match(appSource, /data-project-popup-toggle/);
  assert.match(appSource, /data-project-popup-upload/);
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
  assert.match(appSource, /document\.querySelectorAll\('#projectDetail, #projectDialog, #communicationDialog, #memberDialog, #partDialog'\)/);
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
