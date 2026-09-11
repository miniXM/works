import { enterpriseCan } from './access-policy.js';
import { createIcons, Plus, FolderKanban, ChevronRight, Unlink, X, Search, RotateCw } from 'lucide';

const icons = { Plus, FolderKanban, ChevronRight, Unlink, X, Search, RotateCw };
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const iconButton = (action, label, name, disabled = false) => `<button type="button" class="project-links-icon-button" data-project-links-${action} aria-label="${esc(label)}" title="${esc(label)}"${disabled ? ' disabled' : ''}>${icon(name)}</button>`;
let dialogSequence = 0;

export function renderProjectLinksSection(store, project) {
  if (!project?.id || !enterpriseCan(store, 'project.read')) return '';
  return '<section class="task-detail-section project-links-section" data-project-links-section aria-label="关联项目"><div class="project-links-heading"><h3>关联项目 <small data-project-links-count>0</small></h3></div><div data-project-links-list><p class="project-links-message" role="status">正在加载...</p></div></section>';
}

const projectCopy = project => `<span class="project-links-project-icon">${icon('folder-kanban')}</span><span class="project-links-copy"><b>${esc(project.title || '未命名项目')}</b><small>${esc(project.stage || project.status || '未开始')}</small></span>`;

export function mountProjectLinksSection(container, store, project, { apiRequest, showToast = () => {}, onOpenProject } = {}) {
  const section = container?.matches?.('[data-project-links-section]') ? container : container?.querySelector?.('[data-project-links-section]');
  if (!section || !project?.id || !store.apiToken || !enterpriseCan(store, 'project.read') || typeof apiRequest !== 'function') return () => {};
  const token = store.apiToken;
  const userId = String(store.user?.id || store.user?.userId || '');
  const organizationId = String(store.organization?.id || '');
  const consoleMode = store.consoleMode;
  const basePath = `/api/projects/${encodeURIComponent(project.id)}`;
  const controllers = new Set();
  const state = { projects: [], capabilities: null, loaded: false, error: '' };
  let disposed = false, loading = false, mutating = false, opening = false, dialog = null, signature = '', linksRevision = 0, reloadAccess = false;
  const sessionMatches = () => token === store.apiToken && userId === String(store.user?.id || store.user?.userId || '') && organizationId === String(store.organization?.id || '') && consoleMode === store.consoleMode;
  const active = () => !disposed && section.isConnected && sessionMatches() && enterpriseCan(store, 'project.read');
  const writable = () => active() && enterpriseCan(store, 'project.write') && state.capabilities?.canWrite === true;
  const pending = () => mutating || opening;

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(autoRefresh);
    clearInterval(sessionCheck);
    for (const controller of controllers) controller.abort();
    section.removeEventListener('click', onClick);
    document.removeEventListener('visibilitychange', autoLoad);
    window.removeEventListener('focus', autoLoad);
    window.removeEventListener('online', autoLoad);
    dialog?.close();
    section.replaceChildren();
    section.hidden = true;
  }

  async function request(path, options = {}) {
    if (!active()) return null;
    const controller = new AbortController();
    controllers.add(controller);
    try {
      const result = await apiRequest(path, { ...options, signal: controller.signal }, token);
      if (!active()) return null;
      if (!result.response?.ok) {
        const mainRead = path === `${basePath}/links` && (!options.method || options.method === 'GET');
        if (result.response?.status === 401 || (mainRead && [403, 404].includes(result.response?.status))) {
          dispose();
          showToast(result.response.status === 404 ? '项目已不可用' : '项目权限已更新，请重新打开项目');
          return null;
        }
        if (result.response?.status === 403) {
          linksRevision++;
          reloadAccess = true;
          state.capabilities = { canWrite: false };
          dialog?.close();
          render();
          showToast('关联项目管理权限已更新');
          return null;
        }
        const error = new Error(result.body?.message || '关联项目暂时无法加载');
        error.status = result.response?.status || 0;
        throw error;
      }
      return result.body || {};
    } finally { controllers.delete(controller); }
  }

  function accept(body) {
    state.projects = Array.isArray(body.projects) ? body.projects : [];
    state.capabilities = body.capabilities || null;
    state.loaded = true;
    state.error = '';
    if (dialog && !writable()) dialog.close();
  }

  function render() {
    if (!active()) return;
    const write = writable();
    const next = JSON.stringify([state, write, pending(), loading && !state.loaded]);
    if (next === signature) return;
    signature = next;
    const focus = section.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focus?.getAttribute('data-project-links-open') || focus?.getAttribute('data-project-links-unlink');
    const focusAction = focus?.hasAttribute('data-project-links-unlink') ? 'unlink' : focus?.hasAttribute('data-project-links-add') ? 'add' : 'open';
    section.innerHTML = `<div class="project-links-heading"><h3>关联项目 <small data-project-links-count>${state.projects.length}</small></h3>${write ? iconButton('add', '添加关联项目', 'plus', pending()) : ''}</div><div class="project-links-list" data-project-links-list>${state.projects.map(entry => `<div class="project-links-row"><button type="button" class="project-links-open" data-project-links-open="${esc(entry.id)}" title="打开项目：${esc(entry.title)}"${pending() ? ' disabled' : ''}>${projectCopy(entry)}<span class="project-links-chevron">${icon('chevron-right')}</span></button>${write ? `<button type="button" class="project-links-icon-button project-links-unlink" data-project-links-unlink="${esc(entry.id)}" aria-label="解除关联：${esc(entry.title)}" title="解除关联：${esc(entry.title)}"${pending() ? ' disabled' : ''}>${icon('unlink')}</button>` : ''}</div>`).join('')}${!state.projects.length ? `<p class="project-links-message" role="status">${!state.loaded && loading ? '正在加载...' : state.error ? '' : '暂无关联项目'}</p>` : ''}</div>${state.error ? `<div class="project-links-error" role="status"><span>${esc(state.error)}</span>${iconButton('retry', '重试加载关联项目', 'rotate-cw', loading || pending())}</div>` : ''}`;
    createIcons({ icons, root: section });
    if (focus && !dialog) {
      const controls = [...section.querySelectorAll(`[data-project-links-${focusAction}]`)];
      const replacement = controls.find(element => focusAction === 'add' || element.getAttribute(`data-project-links-${focusAction}`) === focusKey);
      (replacement || section.querySelector('[data-project-links-add]'))?.focus();
    }
  }

  async function load({ silent = false } = {}) {
    if (!active() || loading || pending()) return;
    loading = true;
    const revision = linksRevision;
    if (!silent) { state.error = ''; render(); }
    try {
      const body = await request(`${basePath}/links`);
      if (body && active() && revision === linksRevision) accept(body);
    } catch (error) {
      if (active()) {
        if (error.status === 404) { dispose(); showToast('项目已不可用'); return; }
        state.error = error.message;
      }
    } finally { loading = false; if (active()) { render(); reloadPermissions(); } }
  }

  function reloadPermissions() {
    if (!reloadAccess || !active() || loading || pending()) return;
    reloadAccess = false;
    void load({ silent: true });
  }

  async function mutate(targetId, remove = false) {
    if (!writable() || pending() || !targetId) return false;
    mutating = true;
    linksRevision++;
    state.error = '';
    render();
    dialog?.setPending(true);
    try {
      const body = await request(remove ? `${basePath}/links/${encodeURIComponent(targetId)}` : `${basePath}/links`, remove ? { method: 'DELETE' } : { method: 'POST', body: JSON.stringify({ projectId: targetId }) });
      if (!body || !active()) return false;
      accept(body);
      showToast(remove ? '已解除关联' : '已关联项目');
      dialog?.close();
      return true;
    } catch (error) {
      if (active()) {
        if (dialog) dialog.setError(error.message);
        else state.error = error.message;
      }
      return false;
    } finally {
      mutating = false;
      if (active()) { dialog?.setPending(false); render(); if (!dialog) section.querySelector('[data-project-links-add]')?.focus(); reloadPermissions(); }
    }
  }

  function openPicker() {
    if (!writable() || pending() || dialog) return;
    let candidates = [], candidateError = '', candidateLoading = false, queryVersion = 0, candidateSignature = '';
    const modal = createDialog('添加关联项目', () => { queryVersion++; dialog = null; if (active()) section.querySelector('[data-project-links-add]')?.focus(); });
    dialog = modal;
    modal.body.innerHTML = `<label class="project-links-search">${icon('search')}<input type="search" data-project-links-search aria-label="搜索项目" placeholder="搜索项目" maxlength="160" autocomplete="off"></label><div class="project-links-candidates" data-project-links-candidates></div>`;
    createIcons({ icons, root: modal.host });
    const input = modal.body.querySelector('input');
    const list = modal.body.querySelector('[data-project-links-candidates]');
    function renderCandidates() {
      if (dialog !== modal) return;
      const query = input.value.trim().toLocaleLowerCase();
      const visibleCandidates = candidates.filter(entry => `${entry.title || ''} ${entry.stage || ''} ${entry.status || ''}`.toLocaleLowerCase().includes(query));
      const next = JSON.stringify([visibleCandidates, candidateError, candidateLoading, pending(), query]);
      if (next === candidateSignature) return;
      candidateSignature = next;
      const focusedId = list.contains(document.activeElement) ? document.activeElement?.getAttribute('data-project-links-candidate') : null;
      const scrollTop = list.scrollTop;
      list.innerHTML = `${visibleCandidates.map(entry => `<button type="button" class="project-links-candidate" data-project-links-candidate="${esc(entry.id)}" title="关联项目：${esc(entry.title)}"${pending() || candidateLoading ? ' disabled' : ''}>${projectCopy(entry)}${icon('plus')}</button>`).join('')}${!visibleCandidates.length ? `<p class="project-links-message" role="status">${candidateLoading ? '正在加载...' : candidateError ? '' : query ? '没有匹配的项目' : '暂无可关联项目'}</p>` : ''}${candidateError ? `<div class="project-links-error" role="status"><span>${esc(candidateError)}</span>${iconButton('candidate-retry', '重试加载项目', 'rotate-cw', candidateLoading || pending())}</div>` : ''}`;
      createIcons({ icons, root: list });
      list.scrollTop = scrollTop;
      if (focusedId) [...list.querySelectorAll('[data-project-links-candidate]')].find(element => element.dataset.projectLinksCandidate === focusedId)?.focus();
    }
    async function loadCandidates({ silent = false } = {}) {
      if (dialog !== modal || !writable() || pending()) return;
      const version = ++queryVersion;
      candidateLoading = true;
      candidateError = '';
      if (!silent) renderCandidates();
      try {
        const body = await request(`${basePath}/links/candidates`);
        if (dialog !== modal || version !== queryVersion || !body || !writable()) return;
        candidates = Array.isArray(body.projects) ? body.projects : [];
      } catch (error) {
        if (dialog === modal && version === queryVersion) { candidates = []; candidateError = error.message; }
      } finally {
        if (dialog === modal && version === queryVersion) { candidateLoading = false; renderCandidates(); }
        reloadPermissions();
      }
    }
    input.addEventListener('input', () => {
      renderCandidates();
    });
    list.addEventListener('click', event => {
      if (event.target.closest('[data-project-links-candidate-retry]')) void loadCandidates();
      const candidate = event.target.closest('[data-project-links-candidate]');
      if (candidate && !candidate.disabled) void mutate(candidate.dataset.projectLinksCandidate);
    });
    modal.refresh = () => { if (!candidateLoading) void loadCandidates({ silent: true }); };
    input.focus();
    void loadCandidates();
  }

  function confirmUnlink(id) {
    if (!writable() || pending() || dialog) return;
    const entry = state.projects.find(item => item.id === id);
    if (!entry) return;
    const modal = createDialog('解除关联', () => { dialog = null; if (active()) section.querySelector('[data-project-links-add]')?.focus(); });
    dialog = modal;
    modal.body.innerHTML = `<p class="project-links-confirm-title">${esc(entry.title || '未命名项目')}</p>`;
    modal.footer.innerHTML = '<button type="button" data-project-links-cancel>取消</button><button type="button" class="is-danger" data-project-links-confirm>' + icon('unlink') + '解除关联</button>';
    modal.footer.hidden = false;
    modal.footer.querySelector('[data-project-links-cancel]').addEventListener('click', () => modal.close());
    modal.footer.querySelector('[data-project-links-confirm]').addEventListener('click', () => { void mutate(id, true); });
    createIcons({ icons, root: modal.host });
    modal.footer.querySelector('[data-project-links-cancel]').focus();
  }

  async function onClick(event) {
    if (!active()) return;
    if (event.target.closest('[data-project-links-add]')) openPicker();
    if (event.target.closest('[data-project-links-retry]')) void load();
    const unlink = event.target.closest('[data-project-links-unlink]');
    if (unlink) confirmUnlink(unlink.dataset.projectLinksUnlink);
    const open = event.target.closest('[data-project-links-open]');
    if (!open || pending() || typeof onOpenProject !== 'function') return;
    opening = true;
    render();
    try { await onOpenProject(open.dataset.projectLinksOpen); }
    catch (error) { if (active()) { state.error = error.message || '项目暂时无法打开'; showToast(state.error); } }
    finally { opening = false; if (active()) render(); }
  }

  function autoLoad() {
    if (!active() || document.visibilityState === 'hidden' || navigator.onLine === false || pending()) return;
    void load({ silent: true });
    dialog?.refresh?.();
  }
  const autoRefresh = setInterval(autoLoad, 5000);
  const sessionCheck = setInterval(() => {
    if (!active()) { dispose(); return; }
    if (dialog && !writable()) dialog.close();
    render();
  }, 300);
  section.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', autoLoad);
  window.addEventListener('focus', autoLoad);
  window.addEventListener('online', autoLoad);
  void load();
  return dispose;
}

function createDialog(title, onClose) {
  const previousFocus = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  const siblings = [...document.body.children].map(element => [element, element.inert]);
  for (const [element] of siblings) element.inert = true;
  const titleId = `projectLinksDialog${++dialogSequence}`;
  const host = document.createElement('div');
  host.className = 'project-links-backdrop';
  host.dataset.projectLinksDialog = '';
  host.innerHTML = `<section class="project-links-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1"><header><h2 id="${titleId}">${esc(title)}</h2>${iconButton('close', '关闭', 'x')}</header><div class="project-links-dialog-body"></div><p class="project-links-dialog-error" role="status" hidden></p><footer hidden></footer></section>`;
  document.body.appendChild(host);
  document.body.style.overflow = 'hidden';
  const body = host.querySelector('.project-links-dialog-body');
  const footer = host.querySelector('footer');
  const error = host.querySelector('.project-links-dialog-error');
  let closed = false, busy = false;
  function close() {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKeyDown, true);
    host.remove();
    for (const [element, inert] of siblings) if (element.isConnected) element.inert = inert;
    document.body.style.overflow = previousOverflow;
    onClose();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function onKeyDown(event) {
    if (host.inert) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!busy) close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...host.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(element => element.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); host.querySelector('[role="dialog"]').focus(); }
    else if (event.shiftKey && (document.activeElement === first || !host.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !host.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    event.stopPropagation();
  }
  host.addEventListener('click', event => { if (!busy && (event.target === host || event.target.closest('[data-project-links-close]'))) close(); });
  window.addEventListener('keydown', onKeyDown, true);
  createIcons({ icons, root: host });
  host.querySelector('[data-project-links-close]').focus();
  return {
    host, body, footer, close,
    setPending(value) {
      busy = value;
      host.setAttribute('aria-busy', String(value));
      for (const control of host.querySelectorAll('button, input')) control.disabled = value;
      if (value) { error.hidden = true; error.textContent = ''; }
    },
    setError(message) { error.hidden = false; error.textContent = message; }
  };
}
