import { enterpriseCan } from './access-policy.js';

let closeCurrentBin = null;
let closeCurrentConfirmation = null;
let dialogSequence = 0;

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const canOpen = store => enterpriseCan(store, 'project.delete') || enterpriseCan(store, 'task.delete');

export function closeRecycleBin() {
  closeCurrentConfirmation?.();
  closeCurrentBin?.();
}

function createDialog(title, content, { confirmation = false, onClose = () => {} } = {}) {
  const previousFocus = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  const siblings = [...document.body.children].map(element => [element, element.inert]);
  for (const [element] of siblings) element.inert = true;
  const titleId = `taskRecycleTitle${++dialogSequence}`;
  const host = document.createElement('div');
  host.className = 'task-recycle-backdrop';
  host.dataset.taskRecycleDialog = confirmation ? 'confirmation' : 'bin';
  host.innerHTML = `<section class="task-recycle-dialog${confirmation ? ' task-recycle-confirmation' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1"><header class="task-recycle-heading"><h2 id="${titleId}">${esc(title)}</h2><button type="button" class="task-recycle-icon" data-recycle-close aria-label="关闭${esc(title)}" title="关闭">×</button></header>${content}</section>`;
  document.body.appendChild(host);
  document.body.style.overflow = 'hidden';
  const dialog = host.querySelector('[role="dialog"]');
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKeyDown, true);
    host.remove();
    for (const [element, inert] of siblings) if (element.isConnected) element.inert = inert;
    document.body.style.overflow = previousOverflow;
    if (previousFocus?.isConnected && !previousFocus.inert) previousFocus.focus();
    onClose();
  }
  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...host.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(element => element.getClientRects().length);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first) { event.preventDefault(); dialog.focus(); }
    else if (event.shiftKey && (document.activeElement === first || !host.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !host.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    event.stopPropagation();
  }
  host.addEventListener('click', event => {
    if (event.target === host || event.target.closest('[data-recycle-close]')) close();
  });
  window.addEventListener('keydown', onKeyDown, true);
  dialog.focus();
  return { host, dialog, close, active: () => !closed && host.isConnected };
}

export function confirmTaskRecycle({ title = '', projectRoot = false } = {}) {
  closeRecycleBin();
  return new Promise(resolve => {
    let confirmed = false;
    const { host, close } = createDialog('移入回收站', `<div class="task-recycle-confirm-body"><p class="task-recycle-target">${esc(title || (projectRoot ? '未命名项目' : '未命名任务'))}</p><p>${projectRoot ? '整个项目、根任务、子任务及关联资料将一同移入回收站，移入后暂停协作。' : '任务、子任务及关联资料将一同移入回收站，移入后暂停协作。'}</p><p>数据会保留，可由有恢复权限的成员从回收站恢复。</p></div><footer class="task-recycle-footer"><button type="button" data-recycle-close>取消</button><button type="button" class="task-recycle-danger" data-recycle-confirm>移入回收站</button></footer>`, {
      confirmation: true,
      onClose() {
        if (closeCurrentConfirmation === close) closeCurrentConfirmation = null;
        resolve(confirmed);
      }
    });
    closeCurrentConfirmation = close;
    host.querySelector('[data-recycle-confirm]').addEventListener('click', () => { confirmed = true; close(); });
    host.querySelector('.task-recycle-footer [data-recycle-close]').focus();
  });
}

function formatTime(value) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function openRecycleBin(store, { apiRequest, showToast = () => {}, onChanged } = {}) {
  if (!store?.apiToken || !canOpen(store) || typeof apiRequest !== 'function') {
    showToast('需要项目或任务回收权限');
    return () => {};
  }
  closeRecycleBin();
  const token = store.apiToken;
  const userId = String(store.user?.id || store.user?.userId || '');
  const organizationId = String(store.organization?.id || '');
  const consoleMode = store.consoleMode;
  const controllers = new Set();
  let items = [];
  let search = '';
  let loading = false;
  let loaded = false;
  let pendingId = '';
  let loadFailed = false;
  const sessionMatches = () => token === store.apiToken && userId === String(store.user?.id || store.user?.userId || '') && organizationId === String(store.organization?.id || '') && consoleMode === store.consoleMode;
  const modal = createDialog('任务回收站', `<div class="task-recycle-toolbar"><label class="task-recycle-search"><span class="task-recycle-sr-only">搜索回收站</span><input type="search" data-recycle-search placeholder="搜索任务或项目" autocomplete="off"></label><button type="button" class="task-recycle-icon" data-recycle-refresh aria-label="刷新回收站" title="刷新">↻</button></div><p class="task-recycle-message" data-recycle-message role="status" aria-live="polite"></p><div class="task-recycle-list" data-recycle-list></div><footer class="task-recycle-summary"><span data-recycle-count></span><span>北京时间</span></footer>`, {
    onClose() {
      clearInterval(sessionCheck);
      for (const controller of controllers) controller.abort();
      if (closeCurrentBin === modal.close) closeCurrentBin = null;
    }
  });
  const { host, dialog, close } = modal;
  const list = host.querySelector('[data-recycle-list]');
  const message = host.querySelector('[data-recycle-message]');
  const searchInput = host.querySelector('[data-recycle-search]');
  const active = () => modal.active() && sessionMatches() && canOpen(store);
  const sessionCheck = setInterval(() => { if (!active()) close(); }, 300);
  closeCurrentBin = close;
  function setMessage(text = '', error = false) {
    message.textContent = text;
    message.classList.toggle('is-error', error);
    message.setAttribute('role', error ? 'alert' : 'status');
  }
  function syncBusy() {
    dialog.setAttribute('aria-busy', String(loading || Boolean(pendingId)));
    host.querySelector('[data-recycle-refresh]').disabled = loading || Boolean(pendingId);
    searchInput.disabled = !loaded;
    for (const button of list.querySelectorAll('[data-recycle-restore]')) button.disabled = loading || Boolean(pendingId) || button.dataset.restoreAllowed !== 'true';
    const retry = list.querySelector('[data-recycle-retry]');
    if (retry) retry.disabled = loading || Boolean(pendingId);
  }
  function render() {
    const query = search.trim().toLocaleLowerCase();
    const filtered = items.filter(item => [item.title, item.projectTitle, item.deletedByName].some(value => String(value || '').toLocaleLowerCase().includes(query)));
    if (!loaded && loading) list.innerHTML = '<p class="task-recycle-empty">正在加载回收站...</p>';
    else if (!loaded && loadFailed) list.innerHTML = '<div class="task-recycle-empty"><p>回收站加载失败</p><button type="button" data-recycle-retry>重试</button></div>';
    else if (!filtered.length) list.innerHTML = `<p class="task-recycle-empty">${query ? '没有匹配的任务或项目' : '回收站为空'}</p>`;
    else list.innerHTML = `<ul>${filtered.map(item => `<li class="task-recycle-row"><div class="task-recycle-item"><div class="task-recycle-title"><span class="task-recycle-kind">${item.resourceType === 'project' ? '项目' : '任务'}</span><h3>${esc(item.title || '未命名任务')}</h3></div>${item.projectTitle && item.resourceType !== 'project' ? `<p class="task-recycle-project">${esc(item.projectTitle)}</p>` : ''}<p class="task-recycle-metadata"><time>${esc(formatTime(item.deletedAt))}</time><span>${esc(item.deletedByName || '未知成员')} 移入</span></p></div><div class="task-recycle-row-action"><button type="button" data-recycle-restore="${esc(item.id)}" data-restore-allowed="${item.canRestore === true}"${item.canRestore === true ? '' : ' disabled'} aria-label="恢复${esc(item.title || '未命名任务')}" title="${item.canRestore === true ? '恢复到原项目或任务列表' : '需要恢复权限'}">${String(item.id) === pendingId ? '恢复中...' : '恢复'}</button>${item.canRestore === true ? '' : '<small>无恢复权限</small>'}</div></li>`).join('')}</ul>`;
    host.querySelector('[data-recycle-count]').textContent = loaded ? (query ? `${filtered.length} / ${items.length} 项` : `${items.length} 项`) : '';
    syncBusy();
  }
  async function request(path, options = {}, keepAfterClose = false) {
    const controller = new AbortController();
    if (!keepAfterClose) controllers.add(controller);
    try {
      const result = await apiRequest(path, { ...options, signal: controller.signal }, token);
      if (!sessionMatches() || (!keepAfterClose && !active())) return null;
      if (!result.response?.ok) throw new Error(result.body?.message || '操作失败，请重试');
      return result.body || {};
    } finally { controllers.delete(controller); }
  }
  async function refresh() {
    const body = await request('/api/recycle-bin');
    if (!body || !active()) return;
    items = Array.isArray(body.items) ? body.items : [];
    loaded = true;
    loadFailed = false;
    render();
  }
  async function load() {
    if (!active() || loading || pendingId) return;
    loading = true;
    setMessage('正在加载...');
    render();
    try { await refresh(); if (active()) setMessage(); }
    catch (error) { if (active()) { loadFailed = true; setMessage(error.message, true); } }
    finally { if (active()) { loading = false; render(); } }
  }
  async function restore(id) {
    const item = items.find(entry => String(entry.id) === id);
    if (!active() || loading || pendingId || item?.canRestore !== true) return;
    pendingId = id;
    setMessage('正在恢复...');
    render();
    try {
      // Complete a submitted restore after the dialog closes, unless the session changed.
      const body = await request(`/api/recycle-bin/${encodeURIComponent(id)}/restore`, { method: 'POST', body: '{}' }, true);
      if (!body || !sessionMatches()) return;
      items = items.filter(entry => String(entry.id) !== id);
      showToast('已恢复');
      if (active()) { setMessage('已恢复'); render(); }
      let updateFailed = false;
      if (typeof onChanged === 'function') {
        try { await onChanged(body.item); }
        catch { updateFailed = true; }
      }
      if (active()) {
        try { await refresh(); }
        catch { updateFailed = true; }
        if (updateFailed) setMessage('已恢复，列表刷新失败，请刷新重试', true);
      } else if (updateFailed && sessionMatches()) showToast('已恢复，列表刷新失败，请刷新重试');
    } catch (error) { if (active()) setMessage(error.message, true); else if (sessionMatches()) showToast(error.message); }
    finally {
      if (active()) {
        pendingId = '';
        render();
        if (document.activeElement === document.body || !host.contains(document.activeElement)) searchInput.focus();
      }
    }
  }
  host.addEventListener('click', event => {
    if (event.target.closest('[data-recycle-refresh], [data-recycle-retry]')) void load();
    const restoreButton = event.target.closest('[data-recycle-restore]');
    if (restoreButton) void restore(restoreButton.dataset.recycleRestore);
  });
  searchInput.addEventListener('input', () => { search = searchInput.value; render(); });
  void load();
  return close;
}
