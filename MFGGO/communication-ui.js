import { createElement, Pencil, Pin, EyeOff, Eye, Clock3, Mail, MessageSquare, X, Paperclip, Send } from 'lucide';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = shape => createElement(shape, { width: 17, height: 17, 'aria-hidden': 'true' }).outerHTML;
const stamp = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const time = value => stamp(value) ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
export const communicationPreferenceKey = store => `mfggo.communication.v2:${store.organization?.id || ''}:${store.user?.id || ''}`;

export function taskCommunicationRows(store, state) {
  const tasks = new Map();
  for (const project of store.projects || []) if (project.rootTaskId) tasks.set(project.rootTaskId, { id: project.rootTaskId, projectId: project.id, title: project.title });
  for (const task of store.tasks || []) if (task.projectId && (store.projects || []).some(project => project.id === task.projectId)) tasks.set(task.id, task);
  return [...tasks.values()].map(task => {
    const project = store.projects.find(item => item.id === task.projectId);
    const detail = state.details[task.id];
    const comments = [...(detail?.comments || []), ...(detail?.projectComments || [])].sort((a, b) => stamp(a.createdAt) - stamp(b.createdAt));
    const latest = comments.at(-1);
    const prefs = state.preferences[task.id] || {};
    const unread = comments.filter(comment => comment.userId !== store.user?.id && stamp(comment.createdAt) > Number(prefs.readAt || 0));
    const names = [store.user?.username, store.user?.displayName].filter(Boolean);
    const mentions = unread.filter(comment => names.some(name => new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s，。！？、,:;！!？?])`, 'u').test(comment.body || '')));
    return { ...task, title: detail?.task?.title || task.title, projectTitle: project.title, comments, prefs,
      preview: latest?.body || '暂无评论', author: latest?.displayName || latest?.username || '',
      updatedAt: latest?.createdAt || task.createdAt,
      unread: prefs.forceUnread ? Math.max(1, unread.length) : unread.length,
      mentions: mentions.length, error: state.errors[task.id] || '' };
  });
}

export function filterTaskCommunications(rows, state) {
  const query = (state.query || '').trim().toLowerCase();
  return rows.filter(row => (state.filter === 'hidden' ? row.prefs.hidden : !row.prefs.hidden)
    && (!state.projectId || state.projectId === row.projectId)
    && (!query || [row.title, row.projectTitle, row.preview].some(value => String(value).toLowerCase().includes(query)))
    && (state.filter !== 'unread' || row.unread > 0)
    && (state.filter !== 'mentions' || row.mentions > 0)
    && (state.filter !== 'later' || row.prefs.later))
    .sort((a, b) => Number(Boolean(b.prefs.pinned)) - Number(Boolean(a.prefs.pinned)) || stamp(b.updatedAt) - stamp(a.updatedAt));
}

function pageState(store) {
  const key = communicationPreferenceKey(store);
  if (store.communicationLite?.key === key && store.communicationLite.token === store.apiToken) return store.communicationLite;
  let preferences = {};
  try { preferences = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* Private browsing can deny storage. */ }
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) preferences = {};
  return (store.communicationLite = { key, token: store.apiToken, preferences, details: {}, errors: {}, revisions: {}, query: '', projectId: '', filter: 'all', loaded: false, selected: '', drafts: {} });
}

export function renderCommunicationList(store) {
  const state = pageState(store);
  return `<link rel="stylesheet" href="${new URL('./communication.css', import.meta.url).href}"><section class="view communication-view" data-communication-lite>
    <div class="comm-panel"><div class="comm-layout"><aside class="comm-sidebar"><header class="comm-heading"><h2>项目沟通 <span data-comm-count>0</span></h2>
    <nav class="comm-tabs" aria-label="消息筛选">${[['all', '全部通知'], ['unread', '未读'], ['mentions', '@我的'], ['later', '稍后处理'], ['hidden', '隐藏项目']].map(([value, label]) => `<button data-comm-filter="${value}" class="${state.filter === value ? 'active' : ''}" aria-pressed="${state.filter === value}">${label}</button>`).join('')}</nav></header>
    <div class="comm-list" data-comm-list></div></aside><article class="comm-detail" data-comm-detail><div class="comm-detail-empty">选择左侧任务查看项目沟通</div></article></div></div></section>`;
}

export function mountCommunicationList(host, store, { apiRequest, showToast }) {
  const root = host.querySelector('[data-communication-lite]');
  if (!root) return () => {};
  const state = pageState(store);
  const token = store.apiToken;
  let disposed = false, refreshing = false, dialog = null, menu = null, sending = false, chatVersion = 0;
  state.feedFilter = state.feedFilter || 'comments';
  const controllers = new Set();
  const active = () => !disposed && root.isConnected && token === store.apiToken && store.currentView === 'communication';
  const rows = () => taskCommunicationRows(store, state);
  async function request(path, options = {}) {
    const controller = new AbortController();
    controllers.add(controller);
    try { return await apiRequest(path, { ...options, signal: controller.signal }, token); }
    finally { controllers.delete(controller); }
  }
  function save(id, changes) {
    state.preferences[id] = { ...(state.preferences[id] || {}), ...changes };
    try { localStorage.setItem(state.key, JSON.stringify(state.preferences)); }
    catch { showToast('浏览器无法保存设置，本次操作仅在当前会话有效'); }
    renderRows();
  }
  function renderRows() {
    if (!active()) return;
    const all = rows();
    root.querySelector('[data-comm-count]').textContent = all.filter(row => !row.prefs.hidden).length;
    const visible = filterTaskCommunications(all, state);
    root.querySelector('[data-comm-list]').innerHTML = visible.map(row => `<div class="comm-row ${row.prefs.pinned ? 'is-pinned' : ''} ${state.selected === row.id ? 'is-selected' : ''}" data-comm-row="${escape(row.id)}">
      <button class="comm-row-main" data-comm-open="${escape(row.id)}"><span class="comm-avatar">${escape(row.projectTitle.slice(0, 1))}</span><span class="comm-row-copy"><b>${escape(row.title)}</b><small>${escape(row.projectTitle)} · ${escape(row.error || `${row.author ? `${row.author}：` : ''}${row.preview}`)}</small></span></button>
      <div class="comm-row-actions"><time>${escape(time(row.updatedAt))}</time><span>${row.prefs.pinned ? `<i title="已置顶">${icon(Pin)}</i>` : ''}${row.prefs.later ? `<i title="稍后处理">${icon(Clock3)}</i>` : ''}${row.unread ? `<em aria-label="${row.unread} 条未读">${Math.min(row.unread, 99)}</em>` : ''}<button class="comm-icon" data-comm-menu="${escape(row.id)}" title="编辑与操作" aria-label="编辑与操作：${escape(row.title)}" aria-haspopup="menu">${icon(Pencil)}</button></span></div></div>`).join('') || `<div class="comm-empty">${!state.loaded ? '正在加载任务沟通…' : state.filter === 'hidden' ? '暂无隐藏项目' : '暂无符合条件的沟通'}</div>`;
  }
  function closeMenu() { menu?.remove(); menu = null; }
  function openMenu(id, anchor) {
    closeMenu();
    const row = rows().find(item => item.id === id);
    if (!row) return;
    menu = document.createElement('div');
    menu.className = 'comm-menu'; menu.setAttribute('role', 'menu');
    menu.innerHTML = [
      ['open', MessageSquare, '打开任务聊天'], ['pin', Pin, row.prefs.pinned ? '取消置顶' : '置顶'],
      ['read', Mail, row.unread ? '标为已读' : '标为未读'], ['later', Clock3, row.prefs.later ? '取消稍后处理' : '稍后处理'],
      ['hide', row.prefs.hidden ? Eye : EyeOff, row.prefs.hidden ? '取消隐藏' : '隐藏']
    ].map(([action, shape, label]) => `<button role="menuitem" data-menu-command="${action}">${icon(shape)}${label}</button>`).join('');
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(anchor.x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(anchor.y, window.innerHeight - rect.height - 8))}px`;
    menu.addEventListener('click', event => {
      const action = event.target.closest('[data-menu-command]')?.dataset.menuCommand;
      if (!action) return;
      closeMenu();
      if (action === 'open') void openChat(id);
      if (action === 'pin') save(id, { pinned: !row.prefs.pinned });
      if (action === 'hide') save(id, { hidden: !row.prefs.hidden });
      if (action === 'later') save(id, { later: !row.prefs.later });
      if (action === 'read') save(id, row.unread ? { readAt: Date.now(), forceUnread: false } : { forceUnread: true });
    });
    menu.addEventListener('keydown', event => {
      const buttons = [...menu.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus(); }
    });
    menu.querySelector('button').focus();
  }
  async function loadDetail(id) {
    const revision = state.revisions[id] = (state.revisions[id] || 0) + 1;
    const result = await request(`/api/tasks/${encodeURIComponent(id)}/detail`);
    if (!active() || state.revisions[id] !== revision) return null;
    if (!result.response?.ok) { delete state.details[id]; state.errors[id] = result.body?.message || '加载失败，点击重试'; return null; }
    state.details[id] = result.body; delete state.errors[id];
    return result.body;
  }
  async function refresh() {
    if (!active() || refreshing || sending || document.hidden) return;
    refreshing = true;
    try {
      const tasks = rows();
      for (let offset = 0; offset < tasks.length && active(); offset += 4) await Promise.all(tasks.slice(offset, offset + 4).map(row => loadDetail(row.id)));
      if (!active()) return;
      state.loaded = true; renderRows();
      if (state.selected && state.details[state.selected]) renderDetail(state.selected);
    } finally { refreshing = false; }
  }
  function closeDialog() {
    if (sending) { showToast('正在发送，请稍候'); return; }
    chatVersion++; dialog?.close(); dialog?.remove(); dialog = null;
  }
  function renderChatFeed(id) {
    const detailPane = root.querySelector('[data-comm-detail]');
    if (!detailPane || state.selected !== id) return;
    const detail = state.details[id];
    const row = rows().find(item => item.id === id);
    if (!row || !detail) return;
    const feed = detailPane.querySelector('[data-comm-chat-feed]');
    if (!feed) return;
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 70;
    const comments = row.comments.map(comment => ({ ...comment, kind: 'comment' }));
    const files = (detail.attachments || []).map(file => ({ ...file, kind: 'file' }));
    const items = state.feedFilter === 'attachments' ? files : state.feedFilter === 'all' ? [...comments, ...files] : comments;
    feed.innerHTML = items.sort((a, b) => stamp(a.createdAt) - stamp(b.createdAt)).map(item => `<div class="comm-comment"><span class="comm-comment-avatar">${escape(String(item.displayName || item.username || '成').slice(0, 1))}</span><div><header><b>${escape(item.displayName || item.username || '成员')}</b><time>${escape(time(item.createdAt))}</time></header>${item.kind === 'file' ? `<button class="comm-file" data-comm-file="${escape(item.id)}">${icon(Paperclip)}${escape(item.name)}</button>` : `<p>${escape(item.body)}</p>`}</div></div>`).join('') || '<div class="comm-empty">暂无内容</div>';
    if (nearBottom) feed.scrollTop = feed.scrollHeight;
    detailPane.querySelector('textarea').disabled = !detail.capabilities?.canComment || sending;
    detailPane.querySelector('[type="submit"]').disabled = !detail.capabilities?.canComment || sending;
    detailPane.querySelector('[data-comm-attach]').hidden = !detail.capabilities?.canManageAttachments;
    detailPane.querySelector('[data-comm-attach]').disabled = sending;
  }
  function bindDetail(id) {
    const detailPane = root.querySelector('[data-comm-detail]');
    if (!detailPane) return;
    detailPane.querySelectorAll('[data-comm-feed-filter]').forEach(button => button.onclick = () => { state.feedFilter = button.dataset.commFeedFilter; detailPane.querySelectorAll('[data-comm-feed-filter]').forEach(item => item.classList.toggle('active', item === button)); renderChatFeed(id); });
    detailPane.querySelector('textarea').oninput = event => { state.drafts[id] = event.target.value; };
    detailPane.querySelector('textarea').onkeydown = event => { if (event.key === 'Enter' && !event.isComposing && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); detailPane.querySelector('form').requestSubmit(); } };
    detailPane.querySelector('form').onsubmit = async event => {
      event.preventDefault(); const body = (state.drafts[id] || '').trim();
      if (!body || sending || !state.details[id]?.capabilities?.canComment) return;
      sending = true; renderChatFeed(id);
      const result = await request(`/api/tasks/${encodeURIComponent(id)}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
      sending = false; if (!active()) return;
      if (!result.response?.ok) { showToast(result.body?.message || '发送失败，草稿已保留'); renderChatFeed(id); return; }
      state.drafts[id] = ''; await loadDetail(id); renderDetail(id); detailPane.querySelector('textarea')?.focus();
    };
    detailPane.querySelector('[data-comm-attach]').onclick = () => detailPane.querySelector('[data-comm-upload]').click();
    detailPane.querySelector('[data-comm-upload]').onchange = async event => {
      const file = event.target.files?.[0]; if (!file || sending) return;
      sending = true; const response = await fetch(`${location.pathname.startsWith('/mfggo/') ? '/mfggo-api' : '/api'}/tasks/${encodeURIComponent(id)}/attachments`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) }, body: file }).catch(() => null);
      sending = false; if (!response?.ok) showToast('附件上传失败'); await loadDetail(id); if (active()) renderDetail(id);
    };
    detailPane.querySelector('[data-comm-chat-feed]').onclick = async event => {
      const fileId = event.target.closest('[data-comm-file]')?.dataset.commFile;
      const file = state.details[id]?.attachments?.find(item => item.id === fileId);
      if (!file) return;
      const response = await fetch(`${location.pathname.startsWith('/mfggo/') ? '/mfggo-api' : '/api'}/tasks/${encodeURIComponent(id)}/attachments/${encodeURIComponent(file.id)}/download`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
      if (!response?.ok) return showToast('附件下载失败或无权访问');
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name || 'attachment'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    };
  }
  function renderDetail(id) {
    const detailPane = root.querySelector('[data-comm-detail]'); const row = rows().find(item => item.id === id); const detail = state.details[id];
    if (!detailPane || !row || !detail) { if (detailPane) detailPane.innerHTML = '<div class="comm-detail-empty">选择左侧任务查看项目沟通</div>'; return; }
    detailPane.innerHTML = `<header class="comm-detail-head"><div><h2>${escape(row.title)}</h2><small>${escape(row.projectTitle)} · ${escape(row.author || '暂无消息')}</small></div><button class="comm-later-button" data-comm-later>${row.prefs.later ? '取消稍后处理' : '稍后处理'}</button></header><div class="comm-detail-meta"><span>项目讨论</span><b>${row.comments.length} 条消息</b></div><section class="comm-feed-section"><nav><strong>动态/评论</strong><button data-comm-feed-filter="all" class="${state.feedFilter === 'all' ? 'active' : ''}">所有动态</button><button data-comm-feed-filter="comments" class="${state.feedFilter === 'comments' ? 'active' : ''}">仅评论</button><button data-comm-feed-filter="attachments" class="${state.feedFilter === 'attachments' ? 'active' : ''}">仅附件</button></nav><div class="comm-chat-feed" data-comm-chat-feed></div></section><form class="comm-compose"><textarea aria-label="输入评论" placeholder="输入评论…" maxlength="4000">${escape(state.drafts[id] || '')}</textarea><footer><input type="file" data-comm-upload hidden><button type="button" class="comm-icon" data-comm-attach title="添加附件" aria-label="添加附件">${icon(Paperclip)}</button><button class="primary-button" type="submit">${icon(Send)}发送</button></footer></form>`;
    detailPane.querySelector('[data-comm-later]').onclick = () => save(id, { later: !row.prefs.later });
    bindDetail(id); renderChatFeed(id); detailPane.querySelector('textarea').focus();
  }
  async function openChat(id) {
    closeMenu();
    if (sending) return;
    closeDialog();
    const row = rows().find(item => item.id === id);
    if (!row) return;
    state.selected = id; renderRows();
    renderDetail(id);
    const version = ++chatVersion;
    const detail = await loadDetail(id);
    if (!active() || version !== chatVersion) return;
    if (!detail) { renderDetail(id); return; }
    renderDetail(id); save(id, { readAt: Date.now(), forceUnread: false });
  }
  function updateTabs() { root.querySelectorAll('[data-comm-filter]').forEach(button => { const selected = button.dataset.commFilter === state.filter; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); }); renderRows(); }
  function onClick(event) {
    const open = event.target.closest('[data-comm-open]'); if (open) { void openChat(open.dataset.commOpen); return; }
    const edit = event.target.closest('[data-comm-menu]'); if (edit) { const rect = edit.getBoundingClientRect(); openMenu(edit.dataset.commMenu, { x: rect.right - 184, y: rect.bottom + 4 }); return; }
    const filter = event.target.closest('[data-comm-filter]'); if (filter) { closeMenu(); state.filter = filter.dataset.commFilter; updateTabs(); return; }
  }
  function onContextMenu(event) { const row = event.target.closest('[data-comm-row]'); if (row) { event.preventDefault(); openMenu(row.dataset.commRow, { x: event.clientX, y: event.clientY }); } }
  function outside(event) { if (menu && !menu.contains(event.target) && !event.target.closest('[data-comm-menu]')) closeMenu(); }
  function keyboard(event) { if (event.key === 'Escape') closeMenu(); }
  root.addEventListener('click', onClick); root.addEventListener('contextmenu', onContextMenu);
  root.querySelector('[data-comm-search]')?.addEventListener('input', event => { state.query = event.target.value; renderRows(); });
  root.querySelector('[data-comm-project]')?.addEventListener('change', event => { state.projectId = event.target.value; renderRows(); });
  document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keyboard); window.addEventListener('resize', closeMenu);
  const timer = setInterval(() => { if (!active()) dispose(); else void refresh(); }, 15000);
  function dispose() { disposed = true; chatVersion++; clearInterval(timer); for (const controller of controllers) controller.abort(); closeMenu(); dialog?.close(); dialog?.remove(); dialog = null; root.removeEventListener('click', onClick); root.removeEventListener('contextmenu', onContextMenu); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard); window.removeEventListener('resize', closeMenu); }
  renderRows(); void refresh();
  return dispose;
}
