import { AUTOMATION_TEMPLATES, AUTOMATION_PHRASES, compileAutomation } from './automation-language.js';
import { createAutomationAutosaver } from './automation-save-queue.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pencil = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14.5 5.5 4 4M4 20l4.5-1L20 7.5a2.8 2.8 0 0 0-4-4L4.5 15 4 20Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const caches = new WeakMap();
export const mergeSavedAutomationDraft = (local, saved) => ({ ...saved, name: local.name, source: local.source, enabled: local.enabled, isNew: false, savedName: saved.name, savedSource: saved.source, savedEnabled: saved.enabled });
export const canManageAutomation = store => store?.role === 'owner' && store?.consoleMode !== 'platform';
const dirty = d => d && (d.isNew || d.name !== d.savedName || d.source !== d.savedSource || d.enabled !== d.savedEnabled);
const fromRule = r => ({ ...r, savedName: r.name, savedSource: r.source, savedEnabled: r.enabled });

export function renderAutomation(store) {
  return canManageAutomation(store)
    ? '<section class="automation-view" data-automation><p role="status">正在加载自动化流程…</p></section>'
    : '<p role="status">当前账号无法访问此功能</p>';
}

export function mountAutomation(host, store, { apiRequest }) {
  const root = host.querySelector('[data-automation]');
  if (!root || !canManageAutomation(store)) return () => {};
  const identity = `${store.organization?.id}:${store.user?.id}`;
  if (caches.get(store)?.identity !== identity) caches.set(store, { identity, drafts: new Map(), selected: null, prompt: '' });
  const state = caches.get(store), token = store.apiToken, controller = new AbortController(), dialogs = new Set();
  let disposed = false, busy = false, aiBusy = false, snapshot = { rules: [], members: [], sets: [] }, menu = null;
  const q = selector => root.querySelector(selector);
  const current = () => state.drafts.get(state.selected);
  const alive = () => !disposed && store.apiToken === token && identity === `${store.organization?.id}:${store.user?.id}` && canManageAutomation(store);
  const request = async (path, method = 'GET', body, persist = false) => {
    const result = await apiRequest(`/api${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}), ...(!persist ? { signal: controller.signal } : {}) }, token);
    if (!persist && !alive()) throw new Error('页面已切换');
    if (!result.response?.ok) {
      const e = new Error(result.body?.message || '请求失败，请稍后重试');
      e.status = result.response?.status; e.code = result.body?.error || result.body?.code; throw e;
    }
    return result.body;
  };
  const report = message => { if (alive() && q('[data-feedback]')) q('[data-feedback]').textContent = message; };
  const syntaxError = d => {
    if (!d.name.trim()) return '请输入事件名称';
    try { compileAutomation(d.source); return ''; } catch (e) { return e.message; }
  };
  const updateStatus = () => {
    if (!alive()) return;
    const d = current(), status = q('[data-save-status]'); if (!d || !status) return;
    const invalid = syntaxError(d);
    status.textContent = d.saving ? '正在保存…' : d.error ? '未保存' : invalid ? '待完善' : dirty(d) ? '待自动保存' : '已自动保存';
    report(d.conflict ? '此事件已在另一处修改。你的草稿已保留，请对比最新版本。' : d.error || invalid);
    q('[data-conflict]').hidden = !d.conflict;
    q('[data-retry-save]').hidden = !d.error || Boolean(d.conflict) || Boolean(invalid);
  };
  const saver = createAutomationAutosaver({
    delay: 900,
    validate: d => { const message = syntaxError(d); if (message) throw new Error(message); },
    save: async (d, payload) => (await request(d.isNew ? '/automations' : `/automations/${encodeURIComponent(d.id)}`, d.isNew ? 'POST' : 'PUT', payload, true)).rule,
    onState: (d, status) => { d.saving = status === 'saving'; updateStatus(); },
    onSaved: (d, saved) => {
      d.saving = false;
      for (const [key, value] of state.drafts) if (value === d && key !== d.id) {
        state.drafts.delete(key); state.drafts.set(d.id, d); if (state.selected === key) state.selected = d.id;
      }
      const index = snapshot.rules.findIndex(r => r.id === saved.id);
      if (index < 0) snapshot.rules.push(saved); else snapshot.rules[index] = saved;
      if (alive()) { renderEvents(); updateStatus(); }
    }
  });
  const flushQuietly = d => { if (d) void saver.flush(d).catch(() => updateStatus()); };
  function adopt(data) {
    snapshot = data;
    for (const rule of data.rules || []) {
      const draft = state.drafts.get(rule.id);
      if (!draft) state.drafts.set(rule.id, fromRule(rule));
      else if (!dirty(draft) && !draft.saving) Object.assign(draft, fromRule(rule), { error: '', conflict: false });
      else if (draft.savedName === rule.name && draft.savedSource === rule.source && draft.savedEnabled === rule.enabled) {
        draft.revision = rule.revision; draft.position = rule.position;
      }
    }
    const ids = new Set(data.rules.map(r => r.id));
    for (const [id, d] of state.drafts) if (!ids.has(id) && !d.isNew) {
      if (!dirty(d)) state.drafts.delete(id); else { d.conflict = true; d.error = '此事件已被删除，草稿已保留'; }
    }
    if (!state.drafts.has(state.selected)) state.selected = state.drafts.keys().next().value || null;
  }
  function eventOrder() {
    return [...snapshot.rules.map(r => state.drafts.get(r.id)).filter(Boolean), ...[...state.drafts.values()].filter(d => !snapshot.rules.some(r => r.id === d.id))];
  }
  function renderEvents() {
    const nav = q('[data-event-list]'); if (!nav) return;
    nav.innerHTML = eventOrder().map(d => `<div class="automation-event-row ${d.id === state.selected ? 'active' : ''}" data-row="${esc(d.id)}" draggable="${!d.isNew}" title="拖动调整执行顺序"><button class="automation-event-name" data-rule="${esc(d.id)}">${esc(d.name || '未命名事件')}</button><button class="automation-event-edit ${d.savedEnabled ? 'enabled' : ''}" data-edit="${esc(d.id)}" aria-label="编辑${esc(d.name)}" aria-haspopup="menu" aria-expanded="false" title="${d.savedEnabled ? '已启用' : '已停用'} · 事件设置"><i aria-hidden="true"></i>${pencil}</button></div>`).join('');
  }
  function updateLines() {
    const source = q('[data-source]'); if (!source) return;
    q('[data-lines]').textContent = source.value.split('\n').map((_, i) => String(i + 1).padStart(2, '0')).join('\n');
    q('[data-lines]').scrollTop = source.scrollTop;
  }
  function render() {
    closeMenu();
    const d = current();
    root.innerHTML = `<aside class="automation-events"><header><b>自动化流程事件</b><button data-new aria-label="新建流程事件">＋</button></header><nav data-event-list aria-label="事件列表"></nav></aside>
      <main class="automation-editor">${d ? `<div class="automation-editor-head"><input data-name aria-label="事件名称" maxlength="100" value="${esc(d.name)}"><span data-save-status role="status"></span></div><div class="automation-source"><pre data-lines aria-hidden="true"></pre><textarea data-source aria-label="中文编程逻辑" spellcheck="false" wrap="off">${esc(d.source)}</textarea></div>` : '<p class="automation-empty">新建一个事件，开始编写自动化流程。</p>'}<p class="automation-feedback" role="status" data-feedback></p><button data-conflict hidden>对比最新版本</button><button data-retry-save hidden>重试自动保存</button></main>
      <aside class="automation-palette"><header>添加编程模块</header>${AUTOMATION_PHRASES.map((group, g) => `<small>${esc(group.category)}</small>${group.items.map((item, i) => `<button draggable="true" data-phrase="${g}:${i}">${esc(item.label)}</button>`).join('')}`).join('')}</aside>
      <form class="automation-composer"><input data-prompt aria-label="AI编辑需求" maxlength="4000" placeholder="描述需求，AI 帮你编辑逻辑…" value="${esc(state.prompt || '')}"><button aria-label="发送需求" ${aiBusy ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></form>`;
    renderEvents(); if (d) { updateLines(); updateStatus(); }
  }
  function modal(title, html) {
    closeMenu();
    const dialog = document.createElement('dialog'); dialog.className = 'automation-dialog';
    dialog.innerHTML = `<header><b>${esc(title)}</b><button data-close aria-label="关闭">×</button></header>${html}<p data-modal-error role="alert"></p>`;
    root.appendChild(dialog); dialogs.add(dialog);
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { dialogs.delete(dialog); dialog.remove(); });
    dialog.showModal(); return dialog;
  }
  function closeMenu() {
    if (!menu) return;
    menu.anchor?.setAttribute('aria-expanded', 'false'); menu.panel.remove(); menu = null;
  }
  function openMenu(anchor, d) {
    if (menu?.draft === d) { closeMenu(); return; }
    closeMenu(); anchor.setAttribute('aria-expanded', 'true');
    const panel = document.createElement('div'); panel.className = 'automation-event-menu'; panel.setAttribute('role', 'menu');
    panel.setAttribute('aria-label', `${d.name}快捷操作`);
    panel.innerHTML = `<button role="menuitemcheckbox" aria-checked="${Boolean(d.savedEnabled)}" data-toggle><span>启用</span><i class="automation-switch ${d.savedEnabled ? 'on' : ''}"></i></button><button role="menuitem" class="danger" data-delete>删除事件</button><p role="alert"></p>`;
    root.appendChild(panel); menu = { panel, anchor, draft: d };
    const rect = anchor.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.right + 10, window.innerWidth - bounds.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.top - 5, window.innerHeight - bounds.height - 8))}px`;
    panel.querySelector('[data-toggle]').onclick = async () => {
      if (busy) return; busy = true; saver.cancel(d); await saver.idle(d);
      try {
        if (d.isNew) await saver.flush(d);
        const result = await request(`/automations/${encodeURIComponent(d.id)}/enabled`, 'PATCH', { enabled: !d.savedEnabled, revision: d.revision });
        Object.assign(d, { enabled: result.rule.enabled, savedEnabled: result.rule.enabled, revision: result.rule.revision });
        const record = snapshot.rules.find(r => r.id === d.id); if (record) Object.assign(record, result.rule);
        closeMenu(); renderEvents(); updateStatus(); if (dirty(d)) saver.schedule(d);
      } catch (e) { if (panel.isConnected) panel.querySelector('p').textContent = e.message; else report(e.message); } finally { busy = false; }
    };
    panel.querySelector('[data-delete]').onclick = () => {
      const dialog = modal('删除事件', `<p>删除“${esc(d.name)}”后，它将不再执行。</p><footer><button data-confirm class="danger">确认删除</button></footer>`);
      dialog.querySelector('[data-confirm]').onclick = async () => {
        if (busy) return; busy = true; saver.cancel(d); await saver.idle(d);
        try {
          if (!d.isNew) await request(`/automations/${encodeURIComponent(d.id)}`, 'DELETE', { revision: d.revision });
          saver.cancel(d); state.drafts.delete(d.id); snapshot.rules = snapshot.rules.filter(r => r.id !== d.id);
          if (state.selected === d.id) state.selected = eventOrder()[0]?.id || null;
          dialog.close(); render();
        } catch (e) { dialog.querySelector('[data-modal-error]').textContent = e.message; } finally { busy = false; }
      };
    };
    panel.querySelector('button').focus();
  }
  function newRule() {
    const dialog = modal('新建流程事件', `<form><label>事件名称<input name="name" required maxlength="100" placeholder="例如：内部报价分配工程师"></label><label>起始模板<select name="template">${AUTOMATION_TEMPLATES.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('')}</select></label><footer><button class="primary">创建事件</button></footer></form>`);
    dialog.querySelector('form').onsubmit = e => {
      e.preventDefault(); const form = new FormData(e.target), id = `draft-${crypto.randomUUID()}`;
      const d = { id, name: String(form.get('name')).trim(), source: AUTOMATION_TEMPLATES[Number(form.get('template'))]?.source || '', enabled: false, savedEnabled: false, isNew: true };
      state.drafts.set(id, d); state.selected = id; dialog.close(); render(); saver.schedule(d); q('[data-source]')?.focus();
    };
  }
  function changed(d = current()) {
    if (!d) return;
    updateLines(); renderEvents(); updateStatus(); if (!busy) saver.schedule(d);
  }
  function insertPhrase(phrase) {
    const source = q('[data-source]'); if (!source || busy) return;
    // Event headers replace the header; statements are inserted at line boundaries.
    if (phrase.startsWith('当 ')) {
      const lines = source.value.split('\n'); lines[0] = phrase; source.value = lines.join('\n');
    } else {
      const lineEnd = source.value.indexOf('\n', source.selectionEnd), end = lineEnd < 0 ? source.value.length : lineEnd + 1;
      source.setRangeText((end && source.value[end - 1] !== '\n' ? '\n' : '') + phrase + '\n', end, end, 'end');
    }
    current().source = source.value; source.focus(); changed();
  }
  async function personnelArray() {
    const d = current(); if (!d) return report('请先新建或选择一个事件');
    let members;
    try { members = (await request('/automations')).members; } catch (e) { report(e.message); return; }
    if (d !== current()) return;
    const dialog = modal('定义人员数组', `<form><label>数组名称<input name="arrayName" required maxlength="80" placeholder="例如：报价工程师"></label><input data-member-search placeholder="搜索姓名、部门、岗位" aria-label="搜索组织成员"><div class="automation-member-list">${members.map(m => `<label data-member-row data-search="${esc([m.displayName, m.username, m.departmentName, m.jobTitle].join(' ').toLowerCase())}"><input name="members" type="checkbox" value="${esc(m.id)}"><span>${esc(m.displayName || m.username)}<small>${esc([m.departmentName, m.jobTitle, `@${m.username}`].filter(Boolean).join(' · '))}</small></span></label>`).join('')}</div><p class="automation-array-preview" data-array-preview>人员数组 = []</p><footer><button class="primary">插入脚本</button></footer></form>`);
    const form = dialog.querySelector('form');
    const sourceFor = () => {
      const data = new FormData(form), name = String(data.get('arrayName')).trim(), selected = new Set(data.getAll('members'));
      const names = members.filter(m => selected.has(m.id)).map(m => m.username);
      if (/[「」\r\n]/.test(name) || names.some(n => /[「」\r\n]/.test(n))) throw new Error('名称不能包含「」或换行');
      return { name, source: `设 人员数组「${name}」 为 [${names.map(n => `成员「${n}」`).join(', ')}]` };
    };
    form.oninput = () => { try { dialog.querySelector('[data-array-preview]').textContent = sourceFor().source; } catch (e) { dialog.querySelector('[data-modal-error]').textContent = e.message; } };
    dialog.querySelector('[data-member-search]').oninput = e => { for (const row of dialog.querySelectorAll('[data-member-row]')) row.hidden = !row.dataset.search.includes(e.target.value.toLowerCase()); };
    form.onsubmit = e => {
      e.preventDefault();
      try {
        const { name, source } = sourceFor(); if (!name) throw new Error('请输入数组名称');
        const lines = d.source.split('\n');
        if (lines.some(line => line.trim().startsWith(`设 人员数组「${name}」`))) throw new Error('脚本里已有这个数组，请直接修改原来的定义');
        const index = lines.findIndex(line => line.trim().startsWith('当 '));
        lines.splice(index < 0 ? 0 : index + 1, 0, source); d.source = lines.join('\n');
        dialog.close(); render(); changed(d);
      } catch (e) { dialog.querySelector('[data-modal-error]').textContent = e.message; }
    };
  }
  async function resolveConflict() {
    const d = current(); if (!d) return;
    try {
      const data = await request('/automations'), latest = data.rules.find(r => r.id === d.id);
      const dialog = modal('对比最新版本', `<p>你的修改已保留，请选择要继续编辑的版本。</p><label>当前草稿<textarea readonly>${esc(d.source)}</textarea></label><label>最新保存的版本<textarea readonly>${esc(latest?.source || '此事件已被删除')}</textarea></label><footer><button data-copy>保留为新事件</button>${latest ? '<button data-latest>使用最新版本</button>' : ''}</footer>`);
      dialog.querySelector('[data-copy]').onclick = () => {
        const copy = { id: `draft-${crypto.randomUUID()}`, name: `${d.name}（副本）`.slice(0, 100), source: d.source, enabled: false, savedEnabled: false, isNew: true };
        if (latest) Object.assign(d, fromRule(latest), { conflict: false, error: '' }); else state.drafts.delete(d.id);
        state.drafts.set(copy.id, copy); state.selected = copy.id; snapshot = data; dialog.close(); render(); saver.schedule(copy);
      };
      dialog.querySelector('[data-latest]')?.addEventListener('click', () => { Object.assign(d, fromRule(latest), { conflict: false, error: '' }); snapshot = data; dialog.close(); render(); });
    } catch (e) { report(e.message); }
  }
  async function askAi(form) {
    const d = current(); if (!d) return report('请先新建或选择一个事件');
    if (aiBusy || !state.prompt?.trim()) return;
    aiBusy = true; form.querySelector('button').disabled = true; report('AI 正在编辑逻辑…');
    const base = d.source;
    try {
      const result = await request('/automations/ai', 'POST', { request: state.prompt.trim(), source: base }); compileAutomation(result.source);
      if (!state.drafts.has(d.id)) return;
      const dialog = modal('AI 编辑结果', `<textarea class="automation-ai-draft" aria-label="AI生成的中文逻辑">${esc(result.source)}</textarea><footer><button data-apply class="primary">应用修改</button></footer>`);
      dialog.querySelector('[data-apply]').onclick = () => {
        if (d.source !== base) { dialog.querySelector('[data-modal-error]').textContent = '等待期间脚本已修改，请复制需要的语句或重新生成。'; return; }
        const source = dialog.querySelector('textarea').value;
        try { compileAutomation(source); } catch (e) { dialog.querySelector('[data-modal-error]').textContent = e.message; return; }
        d.source = source; state.selected = d.id; dialog.close(); render(); changed(d);
      };
    } catch (e) { report(e.message); } finally { aiBusy = false; if (alive() && q('.automation-composer button')) q('.automation-composer button').disabled = false; }
  }
  async function reorder(from, to) {
    if (busy || from === to) return;
    busy = true;
    const drafts = [...state.drafts.values()]; drafts.forEach(d => saver.cancel(d));
    try {
      await Promise.all(drafts.map(d => saver.idle(d)));
      const ids = snapshot.rules.map(r => r.id), i = ids.indexOf(from), j = ids.indexOf(to); if (i < 0 || j < 0) return;
      ids.splice(j, 0, ids.splice(i, 1)[0]);
      const result = await request('/automations/order', 'PUT', { ids });
      adopt({ ...snapshot, rules: result.rules }); renderEvents();
    } catch (e) { report(e.message); } finally { busy = false; drafts.filter(d => dirty(d)).forEach(d => saver.schedule(d)); }
  }
  root.addEventListener('click', e => {
    const button = e.target.closest('button'); if (!button || button.closest('dialog,.automation-event-menu') || busy) return;
    if (button.dataset.rule) { flushQuietly(current()); state.selected = button.dataset.rule; render(); }
    else if (button.dataset.edit) openMenu(button, state.drafts.get(button.dataset.edit));
    else if (button.hasAttribute('data-new')) newRule();
    else if (button.hasAttribute('data-conflict')) void resolveConflict();
    else if (button.hasAttribute('data-retry-save')) flushQuietly(current());
    else if (button.hasAttribute('data-reload')) void load();
    else if (button.dataset.phrase) { const [g, i] = button.dataset.phrase.split(':').map(Number); const phrase = AUTOMATION_PHRASES[g].items[i].source; if (phrase.startsWith('设 人员数组')) void personnelArray(); else insertPhrase(phrase); }
  }, { signal: controller.signal });
  root.addEventListener('input', e => {
    if (e.target.matches('[data-prompt]')) { state.prompt = e.target.value; return; }
    const d = current(); if (!d || e.target.closest('dialog')) return;
    if (e.target.matches('[data-source]')) { d.source = e.target.value; changed(d); }
    if (e.target.matches('[data-name]')) { d.name = e.target.value; changed(d); }
  }, { signal: controller.signal });
  root.addEventListener('scroll', e => { if (e.target.matches?.('[data-source]')) q('[data-lines]').scrollTop = e.target.scrollTop; }, { signal: controller.signal, capture: true });
  root.addEventListener('submit', e => { if (e.target.matches('.automation-composer')) { e.preventDefault(); void askAi(e.target); } }, { signal: controller.signal });
  root.addEventListener('dragstart', e => {
    const phrase = e.target.closest('[data-phrase]'), row = e.target.closest('[data-row]'); if (!e.dataTransfer) return;
    if (phrase) { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/automation-phrase', phrase.dataset.phrase); }
    else if (row && !state.drafts.get(row.dataset.row)?.isNew) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/automation-rule', row.dataset.row); }
  }, { signal: controller.signal });
  root.addEventListener('dragover', e => { if ((e.target.matches('[data-source]') && e.dataTransfer?.types.includes('text/automation-phrase')) || (e.target.closest('[data-row]') && e.dataTransfer?.types.includes('text/automation-rule'))) e.preventDefault(); }, { signal: controller.signal });
  root.addEventListener('drop', e => {
    const key = e.dataTransfer?.getData('text/automation-phrase'), from = e.dataTransfer?.getData('text/automation-rule');
    if (from && e.target.closest('[data-row]')) { e.preventDefault(); void reorder(from, e.target.closest('[data-row]').dataset.row); }
    if (key && e.target.matches('[data-source]')) { e.preventDefault(); const [g, i] = key.split(':').map(Number), phrase = AUTOMATION_PHRASES[g]?.items[i]?.source; if (phrase?.startsWith('设 人员数组')) void personnelArray(); else if (phrase) insertPhrase(phrase); }
  }, { signal: controller.signal });
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMenu();
    if (e.target.matches('[data-source]') && e.key === 'Tab') { e.preventDefault(); e.target.setRangeText('  ', e.target.selectionStart, e.target.selectionEnd, 'end'); current().source = e.target.value; changed(); }
    if (e.target.matches('[data-source],[data-name]') && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); flushQuietly(current()); }
    if (menu && ['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); const buttons = [...menu.panel.querySelectorAll('button')], index = buttons.indexOf(document.activeElement); buttons[(index + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus(); }
  }, { signal: controller.signal });
  document.addEventListener('pointerdown', e => { if (menu && !menu.panel.contains(e.target) && !menu.anchor.contains(e.target)) closeMenu(); }, { signal: controller.signal });
  window.addEventListener('resize', closeMenu, { signal: controller.signal });
  window.addEventListener('beforeunload', e => { if ([...state.drafts.values()].some(dirty)) { e.preventDefault(); e.returnValue = ''; } }, { signal: controller.signal });
  async function load() {
    try { adopt(await request('/automations')); render(); for (const d of state.drafts.values()) if (dirty(d)) saver.schedule(d); }
    catch (e) { if (alive()) root.innerHTML = `<p role="alert">${esc(e.message)} <button data-reload>重试</button></p>`; }
  }
  void load();
  return () => { disposed = true; saver.dispose(); controller.abort(); closeMenu(); for (const dialog of dialogs) dialog.remove(); dialogs.clear(); };
}
