import { ENTERPRISE_ROLE_LABELS as ROLE_LABELS, ENTERPRISE_PERMISSION_DEFINITIONS as DEFAULT_PERMISSIONS } from './access-policy.js';
import { createElement, X, ChevronDown } from 'lucide';
let closeCurrentDialog = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function canManageOrganization(store = {}) {
  return ['owner', 'admin'].includes(store.role || store.user?.role);
}

export function closeOrganizationDialog() {
  closeCurrentDialog?.();
}

function permissionDefinitions(value) {
  const definitions = Array.isArray(value) ? value : Object.entries(value || {}).map(([key, label]) => ({ key, ...(typeof label === 'object' ? label : { label }) }));
  return DEFAULT_PERMISSIONS.map(fallback => {
    const definition = definitions.find(item => (item.key || item.id) === fallback.key);
    return { ...fallback, ...definition, key: fallback.key };
  });
}

export function openOrganizationDialog(store, { apiRequest, showToast = () => {}, onChanged, memberId, createUnassigned = false } = {}) {
  if (!canManageOrganization(store) || !store.apiToken || typeof apiRequest !== 'function') {
    showToast('需要企业管理身份');
    return () => {};
  }
  closeOrganizationDialog();
  const focused = Boolean(createUnassigned || (memberId != null && String(memberId)));
  const requestedMemberId = memberId == null ? '' : String(memberId);
  const token = store.apiToken;
  const userId = String(store.user?.id || store.user?.userId || '');
  const organizationId = String(store.organization?.id || '');
  const previousFocus = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  const inertElements = [...document.body.children].map(element => ({ element, inert: element.inert }));
  for (const { element } of inertElements) element.inert = true;
  const host = document.createElement('div');
  host.className = 'organization-backdrop';
  host.dataset.organizationDialog = '';
  host.innerHTML = `<section class="organization-dialog${focused ? ' organization-dialog-focused' : ''}" role="dialog" aria-modal="true" aria-labelledby="organizationDialogTitle" tabindex="-1">
    <header class="organization-heading"><div><h2 id="organizationDialogTitle">${focused ? createUnassigned ? '新增员工' : '成员设置' : '组织架构'}</h2><p data-org-name></p></div><button type="button" class="org-icon-button" data-org-close title="关闭" aria-label="关闭">${focused ? createElement(X, { width: 18, height: 18, 'aria-hidden': 'true' }).outerHTML : '×'}</button></header>
    <p class="organization-message" data-org-message role="status" aria-live="polite"></p>
    <div class="organization-workspace"><aside class="organization-departments" aria-label="部门"><div class="organization-section-heading"><h3>部门</h3><button type="button" class="org-icon-button" data-org-add-department title="新增部门" aria-label="新增部门">+</button></div><nav data-org-departments aria-label="部门筛选"></nav><div class="organization-department-actions" data-org-department-actions></div></aside>
    <main class="organization-content" data-org-content></main></div>
  </section>`;
  document.body.appendChild(host);
  document.body.style.overflow = 'hidden';
  const dialog = host.querySelector('.organization-dialog');
  const content = host.querySelector('[data-org-content]');
  const message = host.querySelector('[data-org-message]');
  const controllers = new Set();
  let state = { organization: {}, departments: [], members: [], permissionDefinitions: DEFAULT_PERMISSIONS };
  let department = 'all';
  let search = '';
  let view = createUnassigned ? { type: 'create-member' } : requestedMemberId ? { type: 'member', id: requestedMemberId } : { type: 'members' };
  let busy = false;
  let loaded = false;
  let disposed = false;
  let synchronizing = false, syncError = false, refreshVersion = 0, structureSnapshot = '';
  const active = () => !disposed && host.isConnected && token === store.apiToken && userId === String(store.user?.id || store.user?.userId || '') && organizationId === String(store.organization?.id || '') && canManageOrganization(store);
  function close() {
    if (disposed) return;
    disposed = true;
    clearInterval(sessionCheck);
    clearInterval(autoRefresh);
    for (const controller of controllers) controller.abort();
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('focus', autoSync);
    window.removeEventListener('online', autoSync);
    document.removeEventListener('visibilitychange', autoSync);
    host.remove();
    for (const { element, inert } of inertElements) if (element.isConnected) element.inert = inert;
    document.body.style.overflow = previousOverflow;
    if (closeCurrentDialog === close) closeCurrentDialog = null;
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  closeCurrentDialog = close;
  const sessionCheck = setInterval(() => { if (!active()) close(); }, 300);
  function onKeyDown(event) {
    if (!active()) { close(); return; }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!focused && view.type !== 'members' && !busy) { view = { type: 'members' }; renderContent(); focusContent(); void autoSync(); }
      else close();
    }
    if (event.key === 'Tab') {
      const elements = [...host.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')].filter(element => element.getClientRects().length);
      const first = elements[0];
      const last = elements.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !host.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !host.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      event.stopPropagation();
    }
  }
  window.addEventListener('keydown', onKeyDown, true);
  function setMessage(text = '', error = false) {
    message.textContent = text;
    message.classList.toggle('is-error', error);
    message.setAttribute('role', error ? 'alert' : 'status');
  }
  function syncBusy() {
    dialog.setAttribute('aria-busy', String(busy));
    for (const control of host.querySelectorAll('input, select, button')) {
      if (control.hasAttribute('data-org-close')) continue;
      control.disabled = busy || control.dataset.orgLocked === 'true' || (!loaded && !control.hasAttribute('data-org-retry'));
    }
  }
  async function request(path, options = {}) {
    if (!active()) return null;
    const controller = new AbortController();
    controllers.add(controller);
    try {
      const result = await apiRequest(path, { ...options, signal: controller.signal }, token);
      if (!active()) return null;
      if (!result.response?.ok) throw Object.assign(new Error(result.body?.message || '操作失败，请重试'), { status: result.response?.status || 0 });
      return result.body || {};
    } finally { controllers.delete(controller); }
  }
  function applyStructure(body) {
    state = { ...body, organization: body.organization || {}, departments: Array.isArray(body.departments) ? body.departments : [], members: Array.isArray(body.members) ? body.members : [], permissionDefinitions: permissionDefinitions(body.permissionDefinitions) };
    structureSnapshot = JSON.stringify(body);
    loaded = true;
    if (department !== 'all' && department !== '' && !state.departments.some(item => String(item.id) === department)) department = 'all';
    host.querySelector('[data-org-name]').textContent = state.organization.name || store.organization?.name || '企业空间';
  }
  async function refresh({ changed = false } = {}) {
    const version = ++refreshVersion;
    const body = await request('/api/organization/structure');
    if (!body || !active() || version !== refreshVersion) return;
    applyStructure(body);
    render();
    if (changed && active() && typeof onChanged === 'function') await onChanged(state);
  }
  async function autoSync() {
    if (!active() || busy || synchronizing || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    if (!loaded) { void load(); return; }
    if (focused || view.type !== 'members') return;
    synchronizing = true;
    const requestedView = view, version = refreshVersion;
    try {
      const body = await request('/api/organization/structure');
      if (!body || !active() || busy || view !== requestedView || version !== refreshVersion) return;
      if (structureSnapshot !== JSON.stringify(body)) {
        const focus = document.activeElement;
        const focusKey = ['data-org-edit-member', 'data-org-department'].find(key => focus?.hasAttribute(key));
        const focusId = focusKey ? focus.getAttribute(focusKey) : null;
        const scroll = [...host.querySelectorAll('.organization-table-scroll, [data-org-departments], [data-org-content]')]
          .map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }));
        applyStructure(body);
        renderDepartments();
        renderMemberRows();
        content.querySelector('[data-org-create-member]').hidden = !state.capabilities?.canManageMembers;
        if (focusKey) {
          const replacement = [...host.querySelectorAll(`[${focusKey}]`)].find(element => element.getAttribute(focusKey) === focusId);
          (replacement || content.querySelector('[data-org-search]'))?.focus({ preventScroll: true });
        }
        for (const item of scroll) { item.element.scrollTop = item.top; item.element.scrollLeft = item.left; }
        if (typeof onChanged === 'function') await onChanged(state);
      }
      if (syncError && active() && view === requestedView && version === refreshVersion) { syncError = false; setMessage(); }
    } catch (error) {
      if (!active() || busy || view !== requestedView || version !== refreshVersion) return;
      if (error.status === 401 || error.status === 403) { close(); showToast(error.message); return; }
      syncError = true;
      setMessage('暂时无法同步，连接恢复后将自动更新', true);
    } finally { synchronizing = false; }
  }
  async function load() {
    if (busy || !active()) return;
    busy = true; syncBusy(); setMessage('正在加载组织架构…');
    content.innerHTML = '<p class="organization-empty">正在加载成员…</p>';
    try { await refresh(); if (active()) setMessage(); }
    catch (error) {
      if (!active()) return;
      if (error.status === 401 || error.status === 403) { close(); showToast(error.message); return; }
      loaded = false;
      setMessage(error.message, true);
      content.innerHTML = '<div class="organization-empty"><p>组织架构加载失败</p><button type="button" data-org-retry>重试</button></div>';
    } finally { if (active()) { busy = false; syncBusy(); } }
  }
  function descendantIds(id) {
    const ids = new Set([String(id)]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const item of state.departments) {
        if (item.parentId != null && ids.has(String(item.parentId)) && !ids.has(String(item.id))) { ids.add(String(item.id)); expanded = true; }
      }
    }
    return ids;
  }
  function departmentRows() {
    const rows = [];
    const seen = new Set();
    function append(parent, depth) {
      for (const item of state.departments.filter(entry => String(entry.parentId || '') === parent)) {
        if (seen.has(String(item.id))) continue;
        seen.add(String(item.id)); rows.push({ ...item, depth }); append(String(item.id), depth + 1);
      }
    }
    append('', 0);
    for (const item of state.departments) if (!seen.has(String(item.id))) rows.push({ ...item, depth: 0 });
    return rows;
  }
  function departmentOptions(selected = '', excluded = new Set()) {
    return `<option value=""${!selected ? ' selected' : ''}>未分配部门</option>${departmentRows().filter(item => !excluded.has(String(item.id))).map(item => `<option value="${escapeHtml(item.id)}"${String(item.id) === String(selected) ? ' selected' : ''}>${escapeHtml(`${'　'.repeat(item.depth)}${item.name}`)}</option>`).join('')}`;
  }
  function roleOptions(selected = 'member') {
    return Object.entries(ROLE_LABELS).filter(([key]) => (key !== 'owner' || selected === 'owner') && (state.capabilities?.canAssignRoles || key === selected)).map(([key, label]) => `<option value="${key}"${selected === key ? ' selected' : ''}>${label}</option>`).join('');
  }
  function reportingDescendants(id) {
    const children = new Map();
    for (const member of state.members) {
      const parent = String(member.managerUserId || '');
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(String(member.id));
    }
    const ids = new Set();
    const pending = [String(id)];
    while (pending.length) {
      const next = pending.pop();
      if (ids.has(next)) continue;
      ids.add(next);
      pending.push(...(children.get(next) || []));
    }
    return ids;
  }
  function reportingField(member, role = member.role) {
    const primary = state.actor?.role === 'owner';
    const scope = reportingDescendants(userId);
    const editable = role !== 'owner' && (primary || (state.capabilities?.canManageMembers && (!member.id || scope.has(String(member.id)))));
    const excluded = member.id ? reportingDescendants(member.id) : new Set();
    const selected = role === 'owner' ? '' : String(member.managerUserId || '');
    const candidates = state.members.filter(item => !excluded.has(String(item.id)) && (primary || scope.has(String(item.id))) && (role !== 'admin' || item.role !== 'member'));
    const current = state.members.find(item => String(item.id) === selected);
    if (current && !candidates.some(item => String(item.id) === selected)) candidates.push(current);
    return `<label data-org-reporting-field>直属上级<select name="managerUserId"${editable ? '' : ' disabled data-org-locked="true"'}>${primary || !selected ? `<option value=""${!selected ? ' selected' : ''}>无直属上级</option>` : ''}${candidates.map(item => `<option value="${escapeHtml(item.id)}"${String(item.id) === selected ? ' selected' : ''}>${escapeHtml(item.displayName || item.username)} · ${escapeHtml(ROLE_LABELS[item.role] || item.role)}</option>`).join('')}</select></label>`;
  }
  function renderDepartments() {
    const countFor = id => {
      const ids = descendantIds(id);
      return state.members.filter(member => ids.has(String(member.departmentId || ''))).length;
    };
    const entries = [{ id: 'all', name: '全部成员', depth: 0, count: state.members.length }, { id: '', name: '未分配部门', depth: 0, count: state.members.filter(item => !item.departmentId).length }, ...departmentRows().map(item => ({ ...item, count: countFor(item.id) }))];
    host.querySelector('[data-org-departments]').innerHTML = entries.map(item => `<button type="button" class="organization-department${department === String(item.id) ? ' is-selected' : ''}" data-org-department="${escapeHtml(item.id)}" aria-pressed="${department === String(item.id)}" style="--department-depth:${Math.min(6, item.depth)}"><span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span><small>${item.count}</small></button>`).join('');
    host.querySelector('[data-org-add-department]').hidden = !state.capabilities?.canManageDepartments;
    host.querySelector('[data-org-department-actions]').innerHTML = state.capabilities?.canManageDepartments && department && department !== 'all' ? '<button type="button" data-org-edit-department>编辑部门</button><button type="button" class="org-danger-button" data-org-delete-department>删除部门</button>' : '';
  }
  function filteredMembers() {
    const ids = department === 'all' ? null : descendantIds(department);
    const query = search.trim().toLocaleLowerCase();
    return state.members.filter(member => (!ids || ids.has(String(member.departmentId || ''))) && (!query || `${member.displayName || ''} ${member.username || ''} ${member.jobTitle || ''}`.toLocaleLowerCase().includes(query)));
  }
  function renderMemberRows() {
    const rows = filteredMembers();
    content.querySelector('[data-org-member-count]').textContent = `${rows.length} 位成员`;
    content.querySelector('[data-org-member-rows]').innerHTML = rows.length ? rows.map(member => {
      const name = member.displayName || member.username || '未命名成员';
      const departmentName = state.departments.find(item => String(item.id) === String(member.departmentId))?.name || '未分配';
      const permissions = state.permissionDefinitions.filter(item => member.role === 'owner' || member.permissions?.[item.key] === true).map(item => item.label);
      return `<tr><td><b>${escapeHtml(name)}</b><small>@${escapeHtml(member.username)}</small></td><td>${escapeHtml(ROLE_LABELS[member.role] || member.role)}</td><td>${escapeHtml(departmentName)}${member.jobTitle ? `<small>${escapeHtml(member.jobTitle)}</small>` : ''}</td><td class="organization-permission-summary">${escapeHtml(member.role === 'owner' ? '全部企业权限' : permissions.join('、') || '未授予')}</td><td>${member.canEdit ? `<button type="button" data-org-edit-member="${escapeHtml(member.id)}" aria-label="编辑${escapeHtml(name)}的成员授权">编辑</button>` : ''}</td></tr>`;
    }).join('') : '<tr><td colspan="5" class="organization-empty">暂无符合条件的成员</td></tr>';
  }
  function editorHeader(title) {
    if (focused) return `<header class="organization-editor-heading"><h3>${escapeHtml(title)}</h3></header>`;
    return `<header class="organization-editor-heading"><button type="button" class="org-icon-button" data-org-cancel title="返回成员列表" aria-label="返回成员列表">←</button><h3>${escapeHtml(title)}</h3></header>`;
  }
  function permissionFields(member = {}) {
    const primary = state.actor?.role === 'owner';
    const groups = [...new Set(state.permissionDefinitions.map(item => item.group))];
    const fields = groups.map(group => {
      const definitions = state.permissionDefinitions.filter(item => item.group === group && (!item.managementOnly || member.role !== 'member') && (!focused || item.key !== 'member.manage'));
      if (!definitions.length) return '';
      return `<fieldset class="organization-permissions"><legend>${escapeHtml(group)}</legend>${definitions.map(item => {
      const locked = member.role === 'owner' || (!primary && !state.actor?.grantablePermissions?.[item.key]);
      return `<div class="organization-permission-row"><label><input type="checkbox" name="${escapeHtml(item.key)}" data-org-permission${member.role === 'owner' || member.permissions?.[item.key] === true ? ' checked' : ''}${locked ? ' disabled data-org-locked="true"' : ''}><span>${escapeHtml(item.label)}</span></label>${primary && member.role === 'admin' && !item.managementOnly ? `<label class="organization-delegation"><input type="checkbox" name="delegate:${escapeHtml(item.key)}" data-org-delegation${member.grantablePermissions?.[item.key] ? ' checked' : ''}><span>可授予员工</span></label>` : ''}</div>`;
      }).join('')}</fieldset>`;
    }).join('');
    if (!focused) return `<div data-org-permission-fields>${fields}</div>`;
    const manager = member.role !== 'member' ? `<fieldset class="organization-permissions organization-management-permission"><legend>管理权限</legend><label><input type="checkbox" name="member.manage" data-org-permission${member.role === 'owner' || member.permissions?.['member.manage'] === true ? ' checked' : ''}${member.role === 'owner' || !primary ? ' disabled data-org-locked="true"' : ''}><span>允许管理成员</span></label></fieldset>` : '';
    return `<div data-org-permission-fields>${manager}<details class="organization-more-permissions"><summary><span>其他权限</span>${createElement(ChevronDown, { width: 16, height: 16, 'aria-hidden': 'true' }).outerHTML}</summary>${fields}</details></div>`;
  }
  function renderContent() {
    if (view.type === 'members') {
      content.innerHTML = `<div class="organization-member-toolbar"><label class="organization-search"><span class="org-visually-hidden">搜索成员</span><input type="search" data-org-search placeholder="搜索姓名、账号、职位" value="${escapeHtml(search)}" autocomplete="off"></label><button type="button" class="org-primary-button" data-org-create-member>+ 新增成员</button></div><p class="organization-member-count" data-org-member-count></p><div class="organization-table-scroll" tabindex="0" aria-label="组织成员"><table class="organization-member-table"><thead><tr><th scope="col">成员</th><th scope="col">企业角色</th><th scope="col">部门 / 职位</th><th scope="col">已授予权限</th><th scope="col">操作</th></tr></thead><tbody data-org-member-rows></tbody></table></div>`;
      renderMemberRows();
      content.querySelector('[data-org-create-member]').hidden = !state.capabilities?.canManageMembers;
    } else if (view.type === 'member' || view.type === 'create-member') {
      const creating = view.type === 'create-member';
      const member = creating ? { role: 'member', departmentId: department === 'all' ? '' : department, managerUserId: createUnassigned ? null : userId, permissions: {} } : state.members.find(item => String(item.id) === view.id);
      if (!member || (focused && (creating ? !state.capabilities?.canManageMembers : !member.canEdit))) {
        if (focused) { content.innerHTML = `<div class="organization-empty"><p>${!member ? '该成员已不存在或不在可管理范围内' : '当前账号无法设置该成员'}</p><button type="button" data-org-close>关闭</button></div>`; return; }
        view = { type: 'members' }; renderContent(); return;
      }
      if (focused) host.querySelector('#organizationDialogTitle').textContent = creating ? '新增员工' : '成员设置';
      const profileFields = focused ? `<label>职位<input name="jobTitle" value="${escapeHtml(member.jobTitle)}" maxlength="80"></label>` : `<div class="organization-form-grid"><label>所属部门<select name="departmentId">${departmentOptions(member.departmentId)}</select></label><label>职位<input name="jobTitle" value="${escapeHtml(member.jobTitle)}" maxlength="80"></label></div>`;
      content.innerHTML = `${editorHeader(creating ? createUnassigned ? '未分配员工' : '新增成员' : `${focused ? '' : '成员授权 · '}${member.displayName || member.username}`)}<form class="organization-editor" data-org-member-form>${creating ? '<label>登录账号<input name="username" pattern="[a-z0-9._-]+" maxlength="64" autocomplete="off" required></label><label>显示名称<input name="displayName" maxlength="80" required></label><label>临时密码<input name="temporaryPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label>' : `<p class="organization-member-account">账号：${escapeHtml(member.username)}</p>`}<label>企业角色<select name="role"${!creating && String(member.id) === userId ? ' disabled data-org-locked="true"' : ''}>${roleOptions(member.role)}</select></label>${creating ? '' : `${profileFields}${permissionFields(member)}`}<footer><button type="button" data-org-cancel>取消</button><button type="submit" class="org-primary-button">${creating ? '创建成员' : '保存'}</button></footer></form>`;
      if (!creating) {
        content.querySelector('.organization-member-account').insertAdjacentHTML('afterend', `<label>姓名<input name="displayName" maxlength="80" value="${escapeHtml(member.displayName)}" required></label>`);
      }
      if (!focused) content.querySelector('[name="role"]').closest('label').insertAdjacentHTML('afterend', reportingField(member));
      if (!state.capabilities?.canAssignRoles) content.querySelector('[name="role"]').dataset.orgLocked = 'true';
    } else if (view.type === 'department') {
      const item = state.departments.find(entry => String(entry.id) === view.id);
      const excluded = item ? descendantIds(item.id) : new Set();
      content.innerHTML = `${editorHeader(item ? '编辑部门' : '新增部门')}<form class="organization-editor" data-org-department-form><label>部门名称<input name="name" value="${escapeHtml(item?.name)}" maxlength="80" required></label><label>上级部门<select name="parentId">${departmentOptions(item?.parentId || (!item && department !== 'all' ? department : ''), excluded).replace('未分配部门', '无上级部门')}</select></label><footer><button type="button" data-org-cancel>取消</button><button type="submit" class="org-primary-button">保存</button></footer></form>`;
    } else if (view.type === 'delete-department') {
      const item = state.departments.find(entry => String(entry.id) === view.id);
      const hasChildren = state.departments.some(entry => String(entry.parentId) === view.id);
      const hasMembers = state.members.some(entry => String(entry.departmentId) === view.id);
      content.innerHTML = `${editorHeader('删除部门')}<form class="organization-editor" data-org-delete-form><p class="organization-delete-message">${hasChildren || hasMembers ? `“${escapeHtml(item?.name)}”仍有${hasChildren ? '子部门' : ''}${hasChildren && hasMembers ? '和' : ''}${hasMembers ? '成员' : ''}，暂时无法删除。` : `确定删除“${escapeHtml(item?.name)}”部门？`}</p><footer><button type="button" data-org-cancel>取消</button>${hasChildren || hasMembers ? '' : '<button type="submit" class="org-danger-button">删除部门</button>'}</footer></form>`;
    }
    syncBusy();
  }
  function render() { if (!focused) renderDepartments(); renderContent(); }
  function focusContent() { content.querySelector('input:not(:disabled), select:not(:disabled), button:not(:disabled)')?.focus(); }
  async function save(path, method, payload, success, after) {
    if (busy || !active()) return;
    ++refreshVersion;
    busy = true; syncBusy(); setMessage('正在保存…');
    let saved = false;
    try {
      const body = await request(path, { method, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
      if (!body || !active()) return;
      saved = true;
      view = after ? after(body) : focused ? view : { type: 'members' };
      await refresh({ changed: true });
      if (active()) { setMessage(success); showToast(success); }
    } catch (error) {
      if (active()) {
        setMessage(saved ? `已保存，刷新失败：${error.message}` : error.message, true);
        if (saved) { renderContent(); }
      }
    } finally { if (active()) { busy = false; syncBusy(); if (saved) focusContent(); } }
  }
  host.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (event.target === host || button?.hasAttribute('data-org-close')) { close(); return; }
    if (!button || busy || !active()) return;
    if (button.hasAttribute('data-org-retry')) { void load(); return; }
    if (button.hasAttribute('data-org-department')) { department = button.dataset.orgDepartment; view = { type: 'members' }; render(); void autoSync(); return; }
    if (button.hasAttribute('data-org-edit-member')) view = { type: 'member', id: button.dataset.orgEditMember };
    else if (button.hasAttribute('data-org-create-member')) view = { type: 'create-member' };
    else if (button.hasAttribute('data-org-add-department')) view = { type: 'department', id: '' };
    else if (button.hasAttribute('data-org-edit-department')) view = { type: 'department', id: department };
    else if (button.hasAttribute('data-org-delete-department')) view = { type: 'delete-department', id: department };
    else if (button.hasAttribute('data-org-cancel')) { if (focused) { close(); return; } view = { type: 'members' }; }
    else return;
    setMessage(); renderContent(); focusContent();
    if (view.type === 'members') void autoSync();
  });
  host.addEventListener('input', event => {
    if (event.target.hasAttribute('data-org-search') && active() && !busy) { search = event.target.value; renderMemberRows(); }
  });
  host.addEventListener('change', event => {
    if (event.target.hasAttribute('data-org-delegation') && event.target.checked) {
      const key = event.target.name.slice('delegate:'.length);
      const own = [...content.querySelectorAll('[data-org-permission]')].find(item => item.name === key);
      if (own) own.checked = true;
    }
    if (event.target.hasAttribute('data-org-permission') && !event.target.checked) {
      const delegation = [...content.querySelectorAll('[data-org-delegation]')].find(item => item.name === `delegate:${event.target.name}`);
      if (delegation) delegation.checked = false;
    }
    if (event.target.name !== 'role' || !active() || busy) return;
    const member = state.members.find(item => String(item.id) === view.id);
    const permissions = { ...member?.permissions, ...Object.fromEntries([...content.querySelectorAll('[data-org-permission]')].map(input => [input.name, input.checked])) };
    const grantablePermissions = { ...member?.grantablePermissions, ...Object.fromEntries([...content.querySelectorAll('[data-org-delegation]')].map(input => [input.name.slice('delegate:'.length), input.checked])) };
    const expandedPermissions = content.querySelector('.organization-more-permissions')?.open;
    content.querySelector('[data-org-permission-fields]')?.replaceWith(document.createRange().createContextualFragment(permissionFields({ ...member, role: event.target.value, permissions, grantablePermissions })));
    if (expandedPermissions && content.querySelector('.organization-more-permissions')) content.querySelector('.organization-more-permissions').open = true;
    const currentManager = content.querySelector('[name="managerUserId"]')?.value;
    content.querySelector('[data-org-reporting-field]')?.replaceWith(document.createRange().createContextualFragment(reportingField({ ...member, managerUserId: currentManager }, event.target.value)));
    syncBusy();
  });
  host.addEventListener('submit', event => {
    event.preventDefault();
    if (!active() || busy) return;
    const form = event.target;
    const data = new FormData(form);
    const value = key => String(data.get(key) || '').trim();
    if (form.hasAttribute('data-org-member-form')) {
      if (view.type === 'create-member') {
        void save('/api/members', 'POST', { username: value('username'), displayName: value('displayName'), temporaryPassword: String(data.get('temporaryPassword') || ''), role: value('role'), managerUserId: createUnassigned ? null : value('managerUserId') || null }, '成员已创建', body => ({ type: 'member', id: String(body.member?.id || body.user?.id || body.id || '') }));
      } else {
        const member = state.members.find(item => String(item.id) === view.id);
        const primary = state.actor?.role === 'owner';
        const role = !primary || String(member.id) === userId ? member.role : value('role');
        const permissions = Object.fromEntries(state.permissionDefinitions.filter(item => (primary || state.actor?.grantablePermissions?.[item.key]) && (!item.managementOnly || role !== 'member')).map(item => [item.key, data.has(item.key)]));
        const grantablePermissions = Object.fromEntries(state.permissionDefinitions.filter(item => !item.managementOnly).map(item => [item.key, data.has(`delegate:${item.key}`)]));
        void save(`/api/organization/members/${encodeURIComponent(view.id)}`, 'PUT', { ...(primary ? { role } : {}), displayName: value('displayName'), ...(data.has('departmentId') ? { departmentId: value('departmentId') || null } : {}), jobTitle: value('jobTitle'), ...(data.has('managerUserId') ? { managerUserId: value('managerUserId') || null } : {}), ...(role === 'owner' ? {} : { permissions }), ...(primary && role === 'admin' ? { grantablePermissions } : {}) }, focused ? '成员设置已保存' : '成员授权已保存');
      }
    } else if (form.hasAttribute('data-org-department-form')) {
      if (!value('name')) { setMessage('请填写部门名称', true); return; }
      void save(`/api/organization/departments${view.id ? `/${encodeURIComponent(view.id)}` : ''}`, view.id ? 'PUT' : 'POST', { name: value('name'), parentId: value('parentId') || null }, '部门已保存');
    } else if (form.hasAttribute('data-org-delete-form')) {
      void save(`/api/organization/departments/${encodeURIComponent(view.id)}`, 'DELETE', undefined, '部门已删除');
    }
  });
  dialog.focus();
  const autoRefresh = setInterval(autoSync, 5000);
  window.addEventListener('focus', autoSync);
  window.addEventListener('online', autoSync);
  document.addEventListener('visibilitychange', autoSync);
  void load();
  return close;
}
