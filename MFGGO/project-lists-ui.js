import { enterpriseCan } from './access-policy.js';
import { normalizeBomLayout, normalizeBomCellStyles, visibleBomColumns, bomHeaderTextColor } from './bom-schema.js';
import { createBomImageSession } from './bom-images.js';
import { mountBomWorkbookFrame } from './bom-workbook-frame.js';
import { createIcons, Plus, Pencil, X, ChevronDown } from 'lucide';

const icons = { Plus, Pencil, X, ChevronDown };
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const canReadLists = store => enterpriseCan(store, 'project.list.read');
const canWriteLists = store => canReadLists(store) && enterpriseCan(store, 'project.list.write');
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const iconButton = (action, label, name, extra = '') => `<button type="button" class="project-list-icon-button" data-project-list-${action} aria-label="${esc(label)}" title="${esc(label)}" ${extra}>${icon(name)}</button>`;
let currentEditor = null;
let currentBom = null;
let dialogSequence = 0;
let editorModulePromise;
function prefetchEditor() {
  return editorModulePromise ||= import('./bom-editor.js').catch(() => { editorModulePromise = null; return null; });
}

export function closeProjectListEditor() {
  currentEditor?.close(true);
  currentBom?.close();
}

export function renderProjectListsSection(store, project) {
  if (!project?.id || !canReadLists(store)) return '';
  return `<div class="project-lists-section task-project-list-property" data-project-lists-section data-project-id="${esc(project.id)}" aria-label="项目清单"><label>项目清单</label><div class="project-lists-controls"><span role="status">正在加载...</span></div></div>`;
}

function listSummary(list) {
  const { items, workbook, ...summary } = list;
  return { ...summary, hasWorkbook: Boolean(workbook || list.hasWorkbook), itemCount: Array.isArray(items) ? items.length : 0 };
}

export function getBomPrices(list, quote) {
  const items = list?.items || [];
  const lines = quote && quote.id === list?.sourceQuoteId && quote.projectId === list.projectId ? quote.lines || [] : [];
  const sameIdentity = (item, line) => String(item.name || '') === String(line.name || '') && String(item.material || '') === String(line.material || '');
  const samePart = (item, line) => String(item.partId || '') === String(line.partId || '');
  const exact = items.map(item => lines.find(line => line.id === item.id && samePart(item, line) && sameIdentity(item, line)));
  const used = new Set(exact.filter(Boolean).map(line => line.id));
  const rows = items.map((item, index) => {
    let line = exact[index];
    if (!line) {
      const candidates = lines.filter(candidate => samePart(item, candidate) && sameIdentity(item, candidate) && !used.has(candidate.id));
      const peers = items.filter((peer, peerIndex) => !exact[peerIndex] && samePart(peer, item) && sameIdentity(peer, item));
      if (candidates.length === 1 && peers.length === 1) line = candidates[0];
    }
    const unitPriceCents = line?.unitPriceCents;
    const subtotalCents = unitPriceCents * item.quantity;
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0 || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(subtotalCents)) return null;
    return { unitPriceCents, subtotalCents };
  });
  const sum = rows.reduce((total, row) => total + (row?.subtotalCents ?? 0), 0);
  return { rows, currency: lines.length ? quote.currency : '', quoteNo: lines.length ? quote.quoteNo : '',
    totalCents: rows.length && rows.every(Boolean) && Number.isSafeInteger(sum) ? sum : null };
}

const formatBomPrice = (cents, currency) => {
  if (!Number.isSafeInteger(cents)) return '—';
  try { return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: currency || 'CNY' }).format(cents / 100); }
  catch { return `${currency || ''} ${(cents / 100).toFixed(2)}`.trim(); }
};

export function mountProjectListsSection(container, store, project, { apiRequest, showToast = () => {}, onChanged } = {}) {
  const section = container?.matches?.('[data-project-lists-section]') ? container : container?.querySelector?.('[data-project-lists-section]');
  if (!section || !project?.id || !store.apiToken || !canReadLists(store) || typeof apiRequest !== 'function') return () => {};
  const token = store.apiToken;
  const userId = String(store.user?.id || store.user?.userId || '');
  const organizationId = String(store.organization?.id || '');
  const consoleMode = store.consoleMode;
  const basePath = `/api/projects/${encodeURIComponent(project.id)}/lists`;
  const images = createBomImageSession({ projectId: project.id, token, active: () => active(), request });
  const controllers = new Set();
  const state = { lists: [], selectedListId: '', viewedListId: '', list: null, capabilities: null, pricing: { allowed: true, quote: null, error: '' } };
  let disposed = false;
  let revoked = false;
  let busy = false;
  let currentLoad = null;
  let loaded = false;
  let errorMessage = '';
  let editor = null;
  let viewer = null;
  let dropdownOpen = false;
  const optionsId = `projectListOptions${++dialogSequence}`;
  const sessionMatches = () => token === store.apiToken && userId === String(store.user?.id || store.user?.userId || '') && organizationId === String(store.organization?.id || '') && consoleMode === store.consoleMode;
  const active = () => !disposed && !revoked && section.isConnected && sessionMatches() && canReadLists(store);
  const writable = () => active() && canWriteLists(store) && state.capabilities?.canWrite !== false;
  const canReadPrices = () => active() && enterpriseCan(store, 'quote.read') && store.modules?.workspace !== false;
  const currentPricing = () => canReadPrices() ? state.pricing : { allowed: false, quote: null, error: '' };
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(sessionCheck);
    clearInterval(autoRefresh);
    for (const controller of controllers) controller.abort();
    images.dispose();
    section.removeEventListener('click', onClick);
    section.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('pointerdown', onOutsideClick);
    document.removeEventListener('visibilitychange', autoLoad);
    window.removeEventListener('focus', autoLoad);
    window.removeEventListener('online', autoLoad);
    editor?.close(true);
    viewer?.close();
    section.replaceChildren();
    section.hidden = true;
  }
  const sessionCheck = setInterval(() => {
    if (!active()) { dispose(); return; }
    if (editor && !writable()) editor.close(true);
    const visibleWriteControl = section.querySelector('[data-project-list-create], [data-project-list-edit]');
    if (Boolean(visibleWriteControl) !== writable() && loaded && !busy) render();
    viewer?.update(state.list, writable(), currentPricing());
  }, 300);
  async function loadPricing(list) {
    const pricing = { allowed: canReadPrices(), quote: null, error: '' };
    if (!pricing.allowed || !list?.sourceQuoteId) { state.pricing = pricing; return; }
    const controller = new AbortController();
    controllers.add(controller);
    try {
      const result = await apiRequest(`/api/projects/${encodeURIComponent(project.id)}/quotes/${encodeURIComponent(list.sourceQuoteId)}`, { signal: controller.signal }, token);
      if (!active() || state.list?.id !== list.id) return;
      if (canReadPrices() && result.response?.ok) pricing.quote = result.body?.quote || null;
      else if (!canReadPrices() || [401, 403].includes(result.response?.status)) pricing.allowed = false;
      else if (result.response?.status !== 404) pricing.error = '价格暂时无法加载';
      state.pricing = pricing;
    } catch {
      if (active() && state.list?.id === list.id) state.pricing = { ...pricing, error: '价格暂时无法加载' };
    } finally { controllers.delete(controller); }
  }
  async function request(path = basePath, options = {}) {
    if (!active()) return null;
    const controller = new AbortController();
    controllers.add(controller);
    try {
      const result = await apiRequest(path, { ...options, signal: controller.signal }, token);
      if (!active()) return null;
      if (!result.response?.ok) {
        if ([401, 403, 404].includes(result.response?.status)) {
          revoked = true;
          dispose();
          showToast(result.response.status === 404 ? '项目或清单已不可用' : '项目清单权限已更新，请重新打开项目');
          return null;
        }
        const error = new Error(result.body?.message || '清单操作失败，请重试');
        error.status = result.response?.status || 0;
        error.code = result.body?.error || '';
        throw error;
      }
      return result.body || {};
    } finally { controllers.delete(controller); }
  }
  function acceptList(list, { selected = false } = {}) {
    if (!list?.id) return;
    state.list = list;
    state.viewedListId = String(list.id);
    if (selected) state.selectedListId = String(list.id);
    const index = state.lists.findIndex(item => String(item.id) === String(list.id));
    if (index < 0) state.lists.push(listSummary(list));
    else state.lists[index] = listSummary(list);
  }
  async function notifyChanged(list) {
    if (!sessionMatches() || disposed || typeof onChanged !== 'function') return;
    try { await onChanged({ list, selectedListId: state.selectedListId }); }
    catch { if (active()) showToast('清单已保存，项目刷新失败，请重新打开项目'); }
  }
  function render() {
    if (!active()) return;
    const write = writable();
    const inlineViewerHost = viewer?.host?.parentElement === section ? viewer.host : null;
    inlineViewerHost?.remove();
    const selectedId = state.viewedListId || state.selectedListId;
    const label = state.list?.title || (loaded ? '选择项目清单' : busy ? '正在加载...' : '暂时无法加载');
    const focusSelect = document.activeElement?.matches('[data-project-list-select]') && section.contains(document.activeElement);
    section.innerHTML = `<label>项目清单</label><div class="project-lists-controls"><div class="project-lists-select"><button type="button" data-project-list-select role="combobox" aria-label="选择项目清单" aria-controls="${optionsId}" aria-haspopup="listbox" aria-expanded="${dropdownOpen}"${busy || !state.lists.length ? ' disabled' : ''}><span>${esc(label)}</span>${icon('chevron-down')}</button><div id="${optionsId}" class="project-lists-options" role="listbox" aria-label="项目清单"${dropdownOpen ? '' : ' hidden'}>${state.lists.map(entry => `<button type="button" role="option" data-project-list-option="${esc(entry.id)}" aria-selected="${String(entry.id) === selectedId}"><span>${esc(entry.title || '未命名清单')}</span><small>${entry.hasWorkbook ? '工作簿' : `${Number(entry.itemCount) || 0} 项`}</small></button>`).join('')}</div></div>${write ? iconButton('create', '新增项目清单', 'plus', busy ? 'disabled' : '') : ''}</div><p class="project-lists-message is-error" data-project-lists-message role="status"${errorMessage ? '' : ' hidden'}>${esc(errorMessage)}</p>`;
    if (inlineViewerHost) section.appendChild(inlineViewerHost);
    createIcons({ icons, root: section });
    if (focusSelect) section.querySelector('[data-project-list-select]')?.focus();
    viewer?.update(state.list, write, currentPricing());
  }
  async function load({ silent = false } = {}) {
    if (!active() || busy || editor || dropdownOpen) return;
    let finishLoad;
    currentLoad = new Promise(resolve => { finishLoad = resolve; });
    busy = true;
    errorMessage = '';
    if (!silent) render();
    try {
      const body = await request();
      if (!body || !active()) return;
      state.lists = Array.isArray(body.lists) ? body.lists : [];
      state.selectedListId = String(body.selectedListId || '');
      state.capabilities = body.capabilities || null;
      if (state.capabilities?.canRead === false) { revoked = true; dispose(); return; }
      const viewedId = state.viewedListId && state.lists.some(list => list.id === state.viewedListId) ? state.viewedListId : state.selectedListId;
      const selected = viewedId && (viewedId !== body.list?.id || body.list?.hasWorkbook && !body.list.workbook) ? await request(`${basePath}/${encodeURIComponent(viewedId)}`) : body;
      if (!selected || !active()) return;
      state.viewedListId = String(selected.list?.id || '');
      state.list = selected.list || null;
      await loadPricing(state.list);
      loaded = true;
    } catch (error) { if (active()) errorMessage = error.message; }
    finally {
      if (active()) {
        busy = false;
        if (silent && viewer && state.list) {
          // Silent polling only changes the viewer data. Rebuilding the
          // section would detach the scroll container and reset its position.
          viewer.update(state.list, writable(), currentPricing());
          const label = section.querySelector('[data-project-list-select] span');
          if (label) label.textContent = state.list.title || '选择项目清单';
        } else {
          render();
          if (state.list && !viewer) openViewer();
        }
      }
      currentLoad = null;
      finishLoad();
    }
  }
  async function selectList(id) {
    if (!active() || busy || !id) return;
    setDropdown(false);
    busy = true;
    errorMessage = '';
    const persist = writable() && id !== state.selectedListId;
    let opened = false;
    render();
    try {
      const body = await request(persist ? `${basePath}/selection` : `${basePath}/${encodeURIComponent(id)}`, persist ? { method: 'PUT', body: JSON.stringify({ listId: id }) } : {});
      if (!body || !active()) return;
      acceptList(body.list, { selected: persist });
      await loadPricing(body.list);
      if (!active()) return;
      if (persist) await notifyChanged(body.list);
      opened = true;
    } catch (error) { if (active()) errorMessage = error.message; }
    finally { if (active()) { busy = false; render(); } }
    if (opened && active()) openViewer();
  }
  function openViewer() {
    if (!active() || !state.list || viewer) return;
    closeProjectListEditor();
    viewer = createBomViewer({ list: state.list, canWrite: writable(), pricing: currentPricing(), project, images, container: section,
      onClose() { viewer = null; section.querySelector('[data-project-list-select]')?.focus(); }, onEdit() { void openEditor(); } });
    currentBom = viewer;
  }
  async function openEditor({ create = false, focusRow = -1 } = {}) {
    if (currentLoad) await currentLoad;
    if (!writable() || busy || editor || (!create && !state.list?.id)) return;
    setDropdown(false);
    let list = null;
    if (!create) {
      busy = true;
      errorMessage = '';
      render();
      try {
        const body = await request(`${basePath}/${encodeURIComponent(state.list.id)}`);
        if (!body || !writable()) return;
        list = body.list;
        acceptList(list);
      } catch (error) { if (active()) errorMessage = error.message; return; }
      finally { if (active()) { busy = false; render(); } }
    }
    if (!writable()) return;
    let createBomEditor;
    busy = true;
    try {
      const module = await (editorModulePromise || prefetchEditor());
      createBomEditor = module?.createBomEditor;
      if (typeof createBomEditor !== 'function') throw new Error('editor module unavailable');
    }
    catch { showToast('清单编辑器加载失败，请重试'); return; }
    finally { busy = false; }
    if (!writable()) return;
    currentEditor?.close(true);
    editor = createBomEditor({ list, project, focusRow, active: writable, request, basePath, images,
      canReadPrices: canReadPrices(),
      onClose() { if (currentEditor === editor) currentEditor = null; editor = null; },
      async onSaved(saved, wasCreated) {
        if (!active()) return;
        acceptList(saved, { selected: wasCreated });
        await loadPricing(saved);
        if (!active()) return;
        render();
        if (wasCreated) openViewer();
        showToast(wasCreated ? '项目清单已新增' : '项目清单已保存');
        await notifyChanged(saved);
      }
    });
    currentEditor = editor;
  }
  function onClick(event) {
    if (!active()) return;
    event.stopPropagation();
    if (event.target.closest('[data-project-list-select]')) { setDropdown(!dropdownOpen); return; }
    const option = event.target.closest('[data-project-list-option]');
    if (option) { void selectList(option.dataset.projectListOption); return; }
    if (event.target.closest('[data-project-list-create]')) { void openEditor({ create: true }); return; }
  }
  function setDropdown(open) {
    dropdownOpen = Boolean(open && state.lists.length && !busy);
    section.querySelector('[data-project-list-select]')?.setAttribute('aria-expanded', String(dropdownOpen));
    section.querySelector('[role="listbox"]')?.toggleAttribute('hidden', !dropdownOpen);
    if (dropdownOpen) (section.querySelector('[role="option"][aria-selected="true"]') || section.querySelector('[role="option"]'))?.focus();
  }
  function onOutsideClick(event) {
    if (!section.contains(event.target)) setDropdown(false);
  }
  function onKeyDown(event) {
    if (event.key === 'Escape' && dropdownOpen) {
      event.preventDefault(); event.stopPropagation(); setDropdown(false);
      section.querySelector('[data-project-list-select]')?.focus(); return;
    }
    if (event.key === 'Tab') { setDropdown(false); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (!dropdownOpen) { setDropdown(true); return; }
    const options = [...section.querySelectorAll('[role="option"]')];
    const index = options.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  }
  function autoLoad() { if (!document.hidden) void load({ silent: loaded }); }
  const autoRefresh = setInterval(autoLoad, 5000);
  section.addEventListener('click', onClick);
  section.addEventListener('keydown', onKeyDown);
  document.addEventListener('pointerdown', onOutsideClick);
  document.addEventListener('visibilitychange', autoLoad);
  window.addEventListener('focus', autoLoad);
  window.addEventListener('online', autoLoad);
  void load();
  return dispose;
}

function createBomViewer({ list, project, canWrite, pricing, images, container, onClose, onEdit }) {
  const inline = Boolean(container);
  const previousFocus = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  const siblings = [...document.body.children].map(element => [element, element.inert]);
  if (!inline) for (const [element] of siblings) element.inert = true;
  const titleId = `projectBomTitle${++dialogSequence}`;
  const host = document.createElement('div');
  host.className = inline ? 'project-list-bom-inline' : 'project-list-bom-backdrop';
  host.dataset.projectListBom = '';
  const closeButton = inline ? '' : iconButton('bom-close', '关闭 BOM 表', 'x');
  const editButton = iconButton('edit', '编辑项目清单', 'pencil');
  const role = inline ? 'region' : 'dialog';
  host.innerHTML = `<section class="project-list-bom${inline ? ' project-list-bom--inline' : ''}" role="${role}"${inline ? '' : ' aria-modal="true"'} aria-labelledby="${titleId}" tabindex="-1"><header><div><h2 id="${titleId}">BOM 表</h2><p>${esc(project.title || '')}</p></div><div>${inline ? '' : editButton}${closeButton}</div></header><div class="project-list-bom-summary"><b data-bom-title></b><span data-bom-count></span>${inline ? editButton : ''}</div><div class="project-list-bom-scroll" tabindex="0" aria-label="BOM 明细"><table class="project-list-bom-table"><thead></thead><tbody></tbody></table><p class="project-lists-empty" data-bom-empty hidden>清单暂无明细</p></div><div class="project-list-workbook" data-bom-viewer-workbook hidden><p data-bom-workbook-status role="status">正在加载工作簿...</p></div><details class="project-list-source-quote" data-bom-workbook-pricing hidden></details><footer class="project-list-bom-total" data-bom-pricing hidden><span data-bom-price-source></span><span>合计 <strong data-bom-price-total></strong></span></footer></section>`;
  (container || document.body).appendChild(host);
  if (!inline) document.body.style.overflow = 'hidden';
  host.insertAdjacentHTML('beforeend', `<div class="bom-image-preview" data-bom-viewer-preview role="dialog" aria-label="图片预览" aria-modal="true" hidden><figure><figcaption><span></span>${iconButton('image-close', '关闭图片预览', 'x')}</figcaption><img alt=""></figure></div>`);
  const preview = host.querySelector('[data-bom-viewer-preview]');
  let previewTrigger;
  function closePreview() {
    preview.hidden = true;
    preview.querySelector('img').removeAttribute('src');
    host.querySelector('section').inert = false;
    (previewTrigger?.isConnected ? previewTrigger : host.querySelector('[data-project-list-bom-close]') || host.querySelector('[data-project-list-edit]'))?.focus();
  }
  let closed = false, signature = '', workbookSignature = '', workbookFrame = null, workbookGeneration = 0;
  function close() {
    if (closed) return;
    closed = true;
    workbookGeneration++; workbookFrame?.dispose();
    document.removeEventListener('keydown', onKeyDown, true);
    host.remove();
    if (!inline) {
      for (const [element, inert] of siblings) if (element.isConnected) element.inert = inert;
      document.body.style.overflow = previousOverflow;
    }
    if (currentBom?.host === host) currentBom = null;
    if (!inline && previousFocus?.isConnected) previousFocus.focus();
    onClose();
  }
  function update(value, write, prices) {
    if (closed || !value) return;
    // Auto-sync can replace the table body while the user is inspecting a
    // wide BOM. Keep the viewer at the same position across that refresh.
    const scrollHost = host.querySelector('.project-list-bom-scroll');
    const scrollPosition = scrollHost ? { left: scrollHost.scrollLeft, top: scrollHost.scrollTop } : null;
    const next = JSON.stringify([value.id, value.revision, value.title, write, prices]);
    if (next === signature) { loadImages(); return; }
    signature = next;
    canWrite = write;
    host.querySelector('[data-project-list-edit]').hidden = !write;
    host.querySelector('[data-bom-title]').textContent = value.title;
    const hasWorkbook = Boolean(value.workbook), workbookHost = host.querySelector('[data-bom-viewer-workbook]');
    host.querySelector('section').classList.toggle('has-workbook', hasWorkbook);
    workbookHost.hidden = !hasWorkbook;
    host.querySelector('.project-list-bom-scroll').hidden = hasWorkbook;
    host.querySelector('[data-bom-workbook-pricing]').hidden = true;
    if (hasWorkbook) {
      host.querySelector('[data-bom-pricing]').hidden = true;
      host.querySelector('.project-list-bom-table thead').replaceChildren();
      host.querySelector('.project-list-bom-table tbody').replaceChildren();
      host.querySelector('[data-bom-price-source]').textContent = '';
      host.querySelector('[data-bom-price-total]').textContent = '';
      host.querySelector('[data-bom-count]').textContent = `${value.workbook.sheetOrder?.length || 1} 张工作表`;
      renderSourceQuote(value, prices);
      const key = `${value.id}:${value.revision}`;
      if (key !== workbookSignature) {
        workbookSignature = key;
        const current = ++workbookGeneration;
        workbookFrame?.dispose();
        const status = host.querySelector('[data-bom-workbook-status]'); status.hidden = false; status.textContent = '正在加载工作簿...';
        workbookFrame = mountBomWorkbookFrame(workbookHost, { snapshot: JSON.parse(JSON.stringify(value.workbook)), editable: false });
        void workbookFrame.ready.then(() => { if (!closed && current === workbookGeneration) status.hidden = true; }).catch(error => { if (!closed && current === workbookGeneration) status.textContent = error.message || '工作簿加载失败'; });
      }
      if (scrollHost && scrollPosition) { scrollHost.scrollLeft = scrollPosition.left; scrollHost.scrollTop = scrollPosition.top; }
      return;
    }
    workbookSignature = ''; workbookGeneration++; workbookFrame?.dispose(); workbookFrame = null;
    const items = value.items || [];
    const showPrices = Boolean(prices?.allowed);
    const amounts = getBomPrices(value, prices?.quote);
    const layout = normalizeBomLayout(value.layout);
    const columns = visibleBomColumns(layout, showPrices);
    const table = host.querySelector('table');
    table.classList.add('bom-configured-table');
    table.classList.toggle('bom-striped', layout.style.stripe);
    table.classList.toggle('bom-bordered', layout.style.borders);
    table.style.setProperty('--bom-header', layout.style.headerColor);
    table.style.setProperty('--bom-header-text', bomHeaderTextColor(layout.style.headerColor));
    table.style.setProperty('--bom-row-height', `${layout.style.rowHeight}px`);
    table.style.setProperty('--bom-font-size', `${layout.style.fontSize}px`);
    table.style.width = `${columns.reduce((sum, entry) => sum + entry.width, 0)}px`;
    host.querySelector('[data-bom-title]').textContent = value.title;
    host.querySelector('[data-bom-count]').textContent = `${items.length} 项 · ${items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} 件`;
    host.querySelector('[data-project-list-edit]').hidden = !write;
    host.querySelector('table').classList.toggle('has-prices', showPrices);
    host.querySelector('thead').innerHTML = `<tr>${columns.map(entry => `<th style="width:${entry.width}px;text-align:${entry.align}"${entry.key === 'unitPrice' ? ' data-bom-unit-price' : ''}>${esc(entry.label)}</th>`).join('')}</tr>`;
    const cell = (item, index, entry) => {
      if (entry.key === 'item') return String(index + 1);
      if (entry.key === 'image') return item.imageId ? `<button type="button" class="bom-image-button" data-bom-view-image aria-label="查看${esc(item.name)}图片" title="查看图片" disabled><img data-bom-image="${esc(item.imageId)}" alt="${esc(item.name)}" hidden><span data-bom-image-status>加载中</span></button>` : '<span class="bom-empty-cell">—</span>';
      if (entry.type === 'price') return esc(formatBomPrice(amounts.rows[index]?.[entry.key === 'unitPrice' ? 'unitPriceCents' : 'subtotalCents'], amounts.currency));
      const content = entry.key.startsWith('custom_') ? item.customValues?.[entry.key] : item[entry.key];
      if (entry.type === 'checkbox' && typeof content === 'boolean') return `<input type="checkbox" disabled${content ? ' checked' : ''} aria-label="${esc(entry.label)}">`;
      return esc(content ?? '');
    };
    const cellStyle = (styles, entry) => {
      const style = styles[entry.key] || {};
      return `text-align:${style.align || entry.align};` +
        (style.bold !== undefined ? `font-weight:${style.bold ? 700 : 400};` : '') +
        (style.italic !== undefined ? `font-style:${style.italic ? 'italic' : 'normal'};` : '') +
        (style.color ? `color:${style.color};` : '') +
        (style.background ? `background-color:${style.background};` : '');
    };
    host.querySelector('tbody').innerHTML = items.map((item, index) => {
      const styles = normalizeBomCellStyles(item.cellStyles, layout);
      return `<tr>${columns.map(entry => `<td data-bom-column="${esc(entry.key)}" style="${cellStyle(styles, entry)}"${entry.type === 'price' ? ` class="bom-money" ${entry.key === 'unitPrice' ? 'data-bom-row-unit' : 'data-bom-row-amount'}` : ''}>${cell(item, index, entry)}</td>`).join('')}</tr>`;
    }).join('');
    loadImages();
    host.querySelector('[data-bom-pricing]').hidden = !showPrices;
    host.querySelector('[data-bom-price-source]').textContent = showPrices ? prices.error || (amounts.quoteNo ? `报价 ${amounts.quoteNo}` : '') : '';
    host.querySelector('[data-bom-price-total]').textContent = showPrices ? formatBomPrice(amounts.totalCents, amounts.currency) : '';
    host.querySelector('[data-bom-empty]').hidden = Boolean(items.length);
    host.querySelector('table').hidden = !items.length;
    if (scrollHost && scrollPosition) { scrollHost.scrollLeft = scrollPosition.left; scrollHost.scrollTop = scrollPosition.top; }
  }
  function renderSourceQuote(value, prices) {
    const target = host.querySelector('[data-bom-workbook-pricing]');
    target.replaceChildren();
    if (!prices?.allowed || !value.sourceQuoteId) return;
    const quote = prices.quote;
    if (!quote || quote.id !== value.sourceQuoteId || quote.projectId !== value.projectId) {
      if (prices.error) { target.innerHTML = `<summary>来源报价</summary><p>${esc(prices.error)}</p>`; target.hidden = false; }
      return;
    }
    target.innerHTML = `<summary>来源报价 ${esc(quote.quoteNo || '')}</summary><div><table><thead><tr><th>名称</th><th>数量</th><th>单价</th><th>金额</th></tr></thead><tbody>${(quote.lines || []).map(line => `<tr><td>${esc(line.name)}</td><td>${esc(line.quantity)}</td><td>${esc(formatBomPrice(line.unitPriceCents, quote.currency))}</td><td>${esc(formatBomPrice(line.subtotalCents, quote.currency))}</td></tr>`).join('')}</tbody></table></div>`;
    target.hidden = false;
  }
  function loadImages() {
    for (const image of host.querySelectorAll('[data-bom-image]:not([src])')) {
      if (image.dataset.loading || Number(image.dataset.retryAt || 0) > Date.now()) continue;
      image.dataset.loading = 'true';
      void images.load(image.dataset.bomImage).then(url => {
        if (closed || !image.isConnected || !url) return;
        image.src = url; image.hidden = false; image.nextElementSibling.hidden = true; image.parentElement.disabled = false;
      }).catch(() => {
        if (!image.isConnected) return;
        image.nextElementSibling.textContent = '图片加载失败';
        image.dataset.retryAt = String(Date.now() + 5000);
      }).finally(() => { delete image.dataset.loading; });
    }
  }
  function onKeyDown(event) {
    if (inline || host.inert) return;
    if (!preview.hidden) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closePreview(); }
      if (event.key === 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); preview.querySelector('button').focus(); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...host.querySelectorAll('button:not(:disabled), iframe, summary, [tabindex="0"]')].filter(element => element.getClientRects().length && !element.closest('[inert]'));
    if (event.shiftKey && (document.activeElement === controls[0] || !host.contains(document.activeElement))) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && (document.activeElement === controls.at(-1) || !host.contains(document.activeElement))) { event.preventDefault(); controls[0]?.focus(); }
    event.stopPropagation();
  }
  host.addEventListener('click', event => {
    if (event.target.closest('[data-project-list-image-close]') || event.target === preview) { closePreview(); return; }
    const imageButton = event.target.closest('[data-bom-view-image]');
    if (imageButton && !imageButton.disabled) {
      const source = imageButton.querySelector('img');
      preview.querySelector('img').src = source.src;
      preview.querySelector('img').alt = source.alt;
      preview.querySelector('figcaption span').textContent = source.alt;
      previewTrigger = imageButton;
      host.querySelector('section').inert = true;
      preview.hidden = false;
      preview.querySelector('button').focus();
      return;
    }
    if (event.target === host || event.target.closest('[data-project-list-bom-close]')) close();
    if (event.target.closest('[data-project-list-edit]') && canWrite) onEdit();
  });
  host.querySelector('[data-project-list-edit]')?.addEventListener('pointerenter', prefetchEditor, { once: true });
  host.querySelector('[data-project-list-edit]')?.addEventListener('focus', prefetchEditor, { once: true });
  if (inline) void prefetchEditor();
  if (!inline) document.addEventListener('keydown', onKeyDown, true);
  createIcons({ icons, root: host });
  update(list, canWrite, pricing);
  if (!inline) host.querySelector('[data-project-list-bom-close]')?.focus();
  return { host, close, update };
}
