import { createIcons, X, Save, Copy, Check, RefreshCw } from 'lucide';
import { prepareBomWorkbook, createBlankBomWorkbook } from './bom-workbook-convert.js';
import { mountBomWorkbookFrame } from './bom-workbook-frame.js';
import { normalizeBomLayout } from './bom-schema.js';
import './bom-editor.css';

const icons = { X, Save, Copy, Check, RefreshCw };
const esc = value => String(value ?? '').replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]);
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const tool = (action, label, name, extra = '') => `<button type="button" class="bom-editor-tool" data-bom-action="${action}" title="${esc(label)}" aria-label="${esc(label)}" ${extra}>${icon(name)}</button>`;
let dialogSequence = 0;

export function createBomEditor({ list, project, active, request, basePath, images, onClose = () => {}, onSaved = () => {} }) {
  const previousFocus = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  const siblings = [...document.body.children].map(element => [element, element.inert]);
  for (const [element] of siblings) element.inert = true;
  const titleId = `bomEditorTitle${++dialogSequence}`;
  const host = document.createElement('div');
  host.className = 'bom-editor-backdrop';
  host.dataset.projectListEditor = '';
  host.innerHTML = `<section class="bom-editor" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
    <header class="bom-editor-heading"><div><h2 id="${titleId}">${list ? '编辑项目清单' : '新增项目清单'}</h2><p>${esc(project?.title || '')}</p></div>${tool('close', '关闭项目清单', 'x')}</header>
    <form class="bom-editor-form" novalidate>
      <div class="bom-editor-mainbar"><label class="bom-editor-title"><span>清单名称</span><input name="title" maxlength="160" autocomplete="off" required></label><label class="bom-editor-template"><span>模板</span><select data-bom-template aria-label="选择企业模板"><option value="">空白工作簿</option></select></label><div class="bom-editor-template-tools" data-bom-template-tools hidden>${tool('template-new', '保存为新模板', 'copy')}${tool('template-update', '更新当前模板', 'save', 'data-bom-template-update disabled')}</div></div>
      <div class="bom-editor-template-name" data-bom-template-name-panel hidden><label>模板名称<input data-bom-template-name maxlength="80" autocomplete="off"></label><label class="bom-editor-checkbox"><input type="checkbox" data-bom-template-content>包含单元格内容及图片</label>${tool('template-save', '确认保存模板', 'check')}${tool('template-cancel', '取消保存模板', 'x')}</div>
      <div class="bom-editor-workspace" data-bom-workbook-container><p class="bom-editor-loading" data-bom-loading role="status">正在加载工作簿...</p></div>
      <div class="bom-editor-feedback"><p data-project-list-editor-message role="status" aria-live="polite" hidden></p><div data-project-list-conflict hidden><button type="button" data-bom-action="reload">${icon('refresh-cw')}加载最新清单</button></div><div class="bom-editor-confirm" data-bom-confirm role="alert" hidden><p data-bom-confirm-text></p><div><button type="button" data-bom-action="confirm-cancel">继续编辑</button><button type="button" class="is-danger" data-bom-action="confirm-ok">确认</button></div></div></div>
      <footer class="bom-editor-footer"><button type="button" data-bom-action="close">取消</button><button type="submit" class="is-primary" data-project-list-save>${icon('save')}保存清单</button></footer>
    </form></section>`;
  document.body.appendChild(host);
  document.body.style.overflow = 'hidden';
  const dialog = host.querySelector('.bom-editor'), form = host.querySelector('form');
  const titleInput = form.elements.title, templateSelect = host.querySelector('[data-bom-template]');
  const container = host.querySelector('[data-bom-workbook-container]'), loading = host.querySelector('[data-bom-loading]');
  const message = host.querySelector('[data-project-list-editor-message]'), confirmPanel = host.querySelector('[data-bom-confirm]');
  let currentList = list, frame = null, closed = false, busy = false, initializing = true, changed = false, conflict = false;
  let templates = [], canManageTemplates = false, templateId = list?.layout?.templateId || '', templateRevision = list?.layout?.templateRevision || null, templateMode = '', confirmAction = null;
  let baselineTitle = list?.title || '', generation = 0, initialized = false, closing = false;
  titleInput.value = baselineTitle;
  const alive = () => !closed && host.isConnected && active();
  const dirty = () => changed || titleInput.value !== baselineTitle;
  const setMessage = (text = '', error = false) => { message.textContent = text; message.hidden = !text; message.classList.toggle('is-error', error); message.setAttribute('role', error ? 'alert' : 'status'); };
  function syncBusy() {
    dialog.setAttribute('aria-busy', String(busy || initializing));
    for (const control of host.querySelectorAll('input,select,button')) control.disabled = busy || initializing;
    for (const control of host.querySelectorAll('[data-bom-action="close"]')) control.disabled = busy;
    host.querySelector('[data-project-list-save]').disabled = busy || initializing || conflict || !initialized;
    host.querySelector('[data-bom-template-update]').disabled = busy || initializing || !templateId || !templates.some(entry => entry.id === templateId);
    if (frame) frame.frame.style.pointerEvents = busy || initializing ? 'none' : '';
    if (!busy && !initializing) frame?.setEditable(alive());
  }
  function confirmChange(text, action, label = '确认') {
    confirmAction = action;
    host.querySelector('[data-bom-confirm-text]').textContent = text;
    host.querySelector('[data-bom-action="confirm-ok"]').textContent = label;
    confirmPanel.hidden = false;
    host.querySelector('[data-bom-action="confirm-cancel"]').focus();
  }
  function finishClose() {
    if (closed) return;
    closed = true; generation++;
    clearInterval(sessionTimer);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('beforeunload', onBeforeUnload);
    frame?.dispose(); host.remove();
    for (const [element, inert] of siblings) if (element.isConnected) element.inert = inert;
    document.body.style.overflow = previousOverflow;
    if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus();
    onClose();
  }
  function close(force = false) {
    if (closed || (!force && (busy || closing))) return;
    if (force) { finishClose(); return; }
    closing = true;
    void (async () => {
      try { if (initialized) await frame?.snapshot(); }
      catch (error) { if (alive()) setMessage(error.message, true); return; }
      finally { closing = false; }
      if (!alive()) return;
      if (dirty()) confirmChange('有未保存的修改，是否放弃？', finishClose, '放弃修改');
      else finishClose();
    })();
  }
  const sessionTimer = setInterval(() => { if (!alive()) close(true); }, 300);
  async function loadWorkbook(value, { reset = false } = {}) {
    const current = ++generation;
    initializing = true; initialized = false; loading.hidden = false; loading.textContent = '正在加载工作簿...';
    frame?.dispose(); frame = null; syncBusy();
    try {
      const prepared = value?.blank ? { snapshot: createBlankBomWorkbook(titleInput.value || 'BOM'), images: [] } : await prepareBomWorkbook(value, images);
      if (!alive() || generation !== current) return;
      const mounted = mountBomWorkbookFrame(container, { ...prepared, editable: true,
        onChange() { if (alive() && initialized && generation === current) changed = true; },
        onSave() { if (alive()) void save(); },
      });
      frame = mounted;
      await mounted.ready;
      if (!alive() || generation !== current) { mounted.dispose(); return; }
      initialized = true; initializing = false; loading.hidden = true;
      if (reset) { changed = false; baselineTitle = titleInput.value; }
      syncBusy();
      return true;
    } catch (error) {
      if (!alive() || generation !== current) return;
      initializing = false; loading.textContent = '工作簿未能加载'; setMessage(error.message || '工作簿加载失败，请重试', true); syncBusy();
      return false;
    }
  }
  function renderTemplates() {
    templateSelect.innerHTML = '<option value="">空白工作簿</option>' + templates.map(template => `<option value="${esc(template.id)}">${esc(template.name)}</option>`).join('');
    if (templateId && !templates.some(template => template.id === templateId)) templateSelect.insertAdjacentHTML('beforeend', `<option value="${esc(templateId)}">当前清单模板</option>`);
    templateSelect.value = templateId;
    host.querySelector('[data-bom-template-tools]').hidden = !canManageTemplates;
    syncBusy();
  }
  async function loadTemplates() {
    try {
      const body = await request(`${basePath}/templates`);
      if (!body || !alive()) return;
      templates = body.templates || []; canManageTemplates = body.capabilities?.canManageTemplates === true; renderTemplates();
    } catch (error) { if (alive()) setMessage(error.message, true); }
  }
  async function applyTemplate(id) {
    const selected = templates.find(template => template.id === id);
    if (id && !selected) return;
    const apply = async () => {
      templateId = selected?.id || ''; templateRevision = selected?.revision || null;
      changed = true; renderTemplates(); setMessage();
      await loadWorkbook(selected ? { title: titleInput.value, items: [], layout: selected.layout, workbook: selected.workbook } : { blank: true });
    };
    await frame?.snapshot();
    if (!alive()) return;
    templateSelect.value = templateId;
    if (currentList || dirty()) confirmChange('应用模板将替换当前工作簿，包括单元格内容和图片。', () => void apply(), '应用模板');
    else await apply();
  }
  async function saveTemplate() {
    if (!alive() || busy || !initialized || !canManageTemplates || !templateMode) return;
    const nameInput = host.querySelector('[data-bom-template-name]'), name = nameInput.value.trim();
    if (!name) { nameInput.focus(); setMessage('请填写模板名称', true); return; }
    const selected = templates.find(entry => entry.id === templateId), update = templateMode === 'update';
    if (update && !selected) return;
    busy = true; syncBusy(); setMessage('正在保存模板...');
    try {
      const workbook = await frame.snapshot();
      if (!workbook || !alive()) return;
      frame.setEditable(false);
      const body = await request(update ? `${basePath}/templates/${encodeURIComponent(selected.id)}` : `${basePath}/templates`, { method: update ? 'PUT' : 'POST', body: JSON.stringify({ name, workbook, includeContent: host.querySelector('[data-bom-template-content]').checked, ...(update ? { revision: templateRevision || selected.revision } : {}) }) });
      if (!body || !alive()) return;
      const index = templates.findIndex(entry => entry.id === body.template.id);
      if (index < 0) templates.push(body.template); else templates[index] = body.template;
      templateId = body.template.id; templateRevision = body.template.revision; templateMode = '';
      host.querySelector('[data-bom-template-name-panel]').hidden = true; renderTemplates(); setMessage('模板已保存');
    } catch (error) {
      if (!alive()) return;
      if (error.status === 409) await loadTemplates();
      if (alive()) setMessage(error.status === 409 ? '模板已被其他成员修改，请重新选择模板或保存为新模板。' : error.message, true);
    } finally { if (alive()) { busy = false; syncBusy(); } }
  }
  async function save() {
    if (!alive() || busy || initializing || conflict || !initialized) return;
    if (!titleInput.value.trim()) { titleInput.focus(); setMessage('请填写清单名称', true); return; }
    busy = true; confirmPanel.hidden = true; setMessage('正在保存...'); syncBusy();
    try {
      const workbook = await frame.snapshot();
      if (!workbook || !alive()) return;
      frame.setEditable(false);
      const wasCreated = !currentList?.id;
      const metadata = normalizeBomLayout(currentList?.layout);
      delete metadata.templateId; delete metadata.templateRevision;
      if (templateId && templateRevision) { metadata.templateId = templateId; metadata.templateRevision = templateRevision; }
      const body = await request(wasCreated ? basePath : `${basePath}/${encodeURIComponent(currentList.id)}`, { method: wasCreated ? 'POST' : 'PUT', body: JSON.stringify({ title: titleInput.value.trim(), workbook, layout: metadata, ...(wasCreated ? {} : { revision: currentList.revision }) }) });
      if (!body || !alive()) return;
      finishClose(); await onSaved(body.list, wasCreated);
    } catch (error) {
      if (!alive()) return;
      if (error.status === 409) { conflict = true; host.querySelector('[data-project-list-conflict]').hidden = false; setMessage('清单已被其他成员修改，当前输入已保留。请加载最新清单后重新编辑。', true); }
      else setMessage(error.message, true);
    } finally { if (alive()) { busy = false; syncBusy(); } }
  }
  async function reload() {
    if (!alive() || busy || !currentList?.id) return;
    busy = true; syncBusy(); setMessage('正在加载最新清单...');
    try {
      const body = await request(`${basePath}/${encodeURIComponent(currentList.id)}`);
      if (!body || !alive()) return;
      currentList = body.list; titleInput.value = body.list.title;
      templateId = body.list.layout?.templateId || ''; templateRevision = body.list.layout?.templateRevision || null; conflict = false; host.querySelector('[data-project-list-conflict]').hidden = true;
      const loaded = await loadWorkbook(body.list, { reset: true }); renderTemplates(); if (loaded) setMessage();
    } catch (error) { if (alive()) setMessage(error.message, true); }
    finally { if (alive()) { busy = false; syncBusy(); } }
  }
  function onBeforeUnload(event) { if (dirty() || initialized && document.activeElement === frame?.frame) { event.preventDefault(); event.returnValue = ''; } }
  function onKeyDown(event) {
    if (!alive()) { close(true); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopImmediatePropagation(); void save(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!confirmPanel.hidden) { confirmPanel.hidden = true; confirmAction = null; } else close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...host.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), iframe')].filter(element => element.getClientRects().length && !element.closest('[inert]'));
    if (event.shiftKey && (document.activeElement === controls[0] || !host.contains(document.activeElement))) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && (document.activeElement === controls.at(-1) || !host.contains(document.activeElement))) { event.preventDefault(); controls[0]?.focus(); }
    event.stopPropagation();
  }
  form.addEventListener('submit', event => { event.preventDefault(); void save(); });
  templateSelect.addEventListener('change', () => { void applyTemplate(templateSelect.value).catch(error => { if (alive()) setMessage(error.message, true); }); });
  host.addEventListener('click', event => {
    const action = event.target.closest('[data-bom-action]')?.dataset.bomAction;
    if (event.target === host || action === 'close') { close(); return; }
    if (!alive() || busy || !action) return;
    if (action === 'confirm-cancel') { confirmPanel.hidden = true; confirmAction = null; }
    if (action === 'confirm-ok') { const proceed = confirmAction; confirmAction = null; confirmPanel.hidden = true; proceed?.(); }
    if (action === 'reload') confirmChange('加载最新清单将放弃当前未保存的修改。', () => void reload(), '加载最新清单');
    if (action === 'template-new' || action === 'template-update') {
      if (!canManageTemplates || !initialized) return;
      templateMode = action === 'template-new' ? 'new' : 'update';
      host.querySelector('[data-bom-template-name-panel]').hidden = false;
      host.querySelector('[data-bom-template-content]').checked = false;
      const nameInput = host.querySelector('[data-bom-template-name]'); nameInput.value = templates.find(entry => entry.id === templateId)?.name || titleInput.value; nameInput.focus(); nameInput.select();
    }
    if (action === 'template-cancel') { templateMode = ''; host.querySelector('[data-bom-template-name-panel]').hidden = true; }
    if (action === 'template-save') void saveTemplate();
  });
  window.addEventListener('keydown', onKeyDown, true); window.addEventListener('beforeunload', onBeforeUnload);
  createIcons({ icons, root: host }); syncBusy();
  void loadWorkbook(list, { reset: true }); void loadTemplates(); titleInput.focus();
  return { host, close };
}
