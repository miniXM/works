import { PLATFORM_ROLE_LABELS, ENTERPRISE_ROLE_LABELS } from './access-policy.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let closeActive = null;
export const closeAccessDialog = () => closeActive?.();

function accessDialog(store, title, { apiRequest, showToast = () => {} }) {
  closeAccessDialog();
  const token = store.apiToken;
  const organizationId = store.organization?.id;
  const previousFocus = document.activeElement;
  const host = document.createElement('div');
  host.className = 'organization-backdrop';
  host.dataset.accessDialog = '';
  host.innerHTML = `<section class="organization-dialog access-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1"><header class="organization-heading"><h2>${esc(title)}</h2><button class="org-icon-button" data-access-close aria-label="关闭">×</button></header><p class="organization-message" data-access-message role="status"></p><div class="access-content" data-access-content></div></section>`;
  const siblings = [...document.body.children].map(element => [element, element.inert]);
  for (const [element] of siblings) element.inert = true;
  document.body.appendChild(host);
  const bodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  let closed = false;
  let busy = false;
  const valid = () => !closed && token === store.apiToken && organizationId === store.organization?.id;
  function close() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    window.removeEventListener('keydown', onKeyDown, true);
    host.remove();
    for (const [element, inert] of siblings) if (element.isConnected) element.inert = inert;
    document.body.style.overflow = bodyOverflow;
    if (previousFocus?.isConnected) previousFocus.focus();
    if (closeActive === close) closeActive = null;
  }
  function onKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    if (event.key !== 'Tab') return;
    const controls = [...host.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(node => node.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || !host.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && (document.activeElement === last || !host.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    event.stopPropagation();
  }
  const timer = setInterval(() => { if (!valid()) close(); }, 300);
  closeActive = close;
  host.querySelector('[data-access-close]').onclick = close;
  window.addEventListener('keydown', onKeyDown, true);
  host.querySelector('[role="dialog"]').focus();
  const content = host.querySelector('[data-access-content]');
  const message = host.querySelector('[data-access-message]');
  const status = (text, error = false) => { message.textContent = text; message.classList.toggle('is-error', error); message.setAttribute('role', error ? 'alert' : 'status'); };
  async function request(path, options = {}) {
    const result = await apiRequest(path, options, token);
    if (!valid()) return null;
    if (!result.response?.ok) throw new Error(result.body?.message || '操作失败，请重试');
    return result.body;
  }
  async function run(callback, success = '') {
    if (busy || !valid()) return;
    busy = true;
    content.inert = true;
    host.setAttribute('aria-busy', 'true');
    status('正在处理...');
    try {
      await callback();
      if (valid()) { status(success); if (success) showToast(success); }
    } catch (error) { if (valid()) status(error.message, true); }
    finally { busy = false; content.inert = false; host.removeAttribute('aria-busy'); }
  }
  return { host, content, close, valid, request, run };
}

export function openProfileDialog(store, options) {
  const dialog = accessDialog(store, '个人资料', options);
  void dialog.run(async () => {
    const body = await dialog.request('/api/me/profile');
    if (!body) return;
    const { member, departments } = body;
    dialog.content.innerHTML = `<form class="organization-editor" data-profile-form><p>@${esc(member.username)} · ${esc(ENTERPRISE_ROLE_LABELS[member.role] || member.role)}</p><label>姓名<input name="displayName" value="${esc(member.displayName)}" maxlength="80" required></label><label>所属部门<select name="departmentId"><option value="">未分配部门</option>${departments.map(item => `<option value="${esc(item.id)}"${item.id === member.departmentId ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label><label>职位<input name="jobTitle" value="${esc(member.jobTitle)}" maxlength="80"></label><footer><button type="submit" class="org-primary-button">保存</button></footer></form>`;
    dialog.content.querySelector('form').onsubmit = event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void dialog.run(async () => {
        const result = await dialog.request('/api/me/profile', { method: 'PUT', body: JSON.stringify({ displayName: data.get('displayName'), departmentId: data.get('departmentId') || null, jobTitle: data.get('jobTitle') }) });
        if (!result) return;
        store.user = { ...store.user, displayName: result.member.displayName, departmentId: result.member.departmentId, jobTitle: result.member.jobTitle };
        options.onChanged?.(result.member);
        dialog.close();
      }, '个人资料已保存');
    };
  });
  return dialog.close;
}

export function openPlatformAdministratorsDialog(store, options) {
  if (store.platformRole !== 'owner') return;
  const dialog = accessDialog(store, '平台管理员', options);
  let state;
  async function refresh() {
    state = await dialog.request('/api/platform/administrators');
    if (!state) return;
    const candidates = state.candidates || [];
    dialog.content.innerHTML = `<div class="organization-table-scroll"><table class="organization-member-table platform-administrator-table"><thead><tr><th>姓名 / 账号</th><th>平台身份</th><th>操作</th></tr></thead><tbody>${state.administrators.map(item => `<tr><td><b>${esc(item.displayName)}</b><small>@${esc(item.username)}</small></td><td>${esc(PLATFORM_ROLE_LABELS[item.role])}</td><td>${item.role === 'admin' ? `<button data-platform-edit="${esc(item.id)}">授权</button>` : ''}</td></tr>`).join('')}</tbody></table></div>${candidates.length ? `<form class="organization-editor" data-platform-add><label>任命平台副管理<select name="userId">${candidates.map(item => `<option value="${esc(item.id)}">${esc(item.displayName)} (@${esc(item.username)})</option>`).join('')}</select></label><footer><button class="org-primary-button" type="submit">任命</button></footer></form>` : ''}`;
    dialog.content.querySelectorAll('[data-platform-edit]').forEach(button => { button.onclick = () => edit(state.administrators.find(item => item.id === button.dataset.platformEdit)); });
    const add = dialog.content.querySelector('[data-platform-add]');
    if (add) add.onsubmit = event => { event.preventDefault(); const id = new FormData(add).get('userId'); edit({ ...candidates.find(item => item.id === id), role: 'admin', permissions: {} }); };
  }
  function edit(member) {
    dialog.content.innerHTML = `<form class="organization-editor" data-platform-grants><h3>${esc(member.displayName)} <small>@${esc(member.username)}</small></h3><fieldset class="organization-permissions"><legend>平台授权</legend>${state.permissionDefinitions.map(item => `<label><input type="checkbox" name="${esc(item.key)}"${member.permissions?.[item.key] ? ' checked' : ''}><span>${esc(item.label)}</span></label>`).join('')}</fieldset><footer><button type="button" data-platform-back>返回</button>${state.administrators.some(item => item.id === member.id) ? '<button type="button" class="org-danger-button" data-platform-revoke>撤销副管理</button>' : ''}<button type="submit" class="org-primary-button">保存授权</button></footer></form>`;
    dialog.content.querySelector('[data-platform-back]').onclick = () => { void dialog.run(refresh); };
    dialog.content.querySelector('form').onsubmit = event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void dialog.run(async () => {
        await dialog.request(`/api/platform/administrators/${encodeURIComponent(member.id)}`, { method: 'PUT', body: JSON.stringify({ role: 'admin', permissions: Object.fromEntries(state.permissionDefinitions.map(item => [item.key, data.has(item.key)])) }) });
        if (dialog.valid()) await refresh();
      }, '平台授权已保存');
    };
    const revoke = dialog.content.querySelector('[data-platform-revoke]');
    if (revoke) revoke.onclick = () => {
      dialog.content.innerHTML = `<div class="organization-editor"><p>撤销 ${esc(member.displayName)} 的平台副管理身份？</p><footer><button data-platform-cancel>取消</button><button class="org-danger-button" data-platform-confirm>确认撤销</button></footer></div>`;
      dialog.content.querySelector('[data-platform-cancel]').onclick = () => edit(member);
      dialog.content.querySelector('[data-platform-confirm]').onclick = () => { void dialog.run(async () => { await dialog.request(`/api/platform/administrators/${encodeURIComponent(member.id)}`, { method: 'PUT', body: JSON.stringify({ role: null }) }); if (dialog.valid()) await refresh(); }, '平台副管理已撤销'); };
    };
  }
  void dialog.run(refresh);
  return dialog.close;
}

export function openEnterpriseOwnerDialog(store, organization, options) {
  const dialog = accessDialog(store, `企业主管理 · ${organization.name}`, options);
  void dialog.run(async () => {
    const body = await dialog.request(`/api/platform/owner-candidates?organizationId=${encodeURIComponent(organization.id)}`);
    if (!body) return;
    dialog.content.innerHTML = `<form class="organization-editor"><label>企业主管理<select name="userId" required>${body.candidates.map(item => `<option value="${esc(item.id)}"${item.role === 'owner' ? ' selected' : ''}>${esc(item.displayName)} (@${esc(item.username)})</option>`).join('')}</select></label><p>现有主管理将调整为副管理，原管理授权会清除。</p><footer><button type="submit" class="org-primary-button">确认任命</button></footer></form>`;
    dialog.content.querySelector('form').onsubmit = event => {
      event.preventDefault();
      const userId = new FormData(event.currentTarget).get('userId');
      void dialog.run(async () => {
        const result = await dialog.request(`/api/platform/organizations/${encodeURIComponent(organization.id)}/owner`, { method: 'PUT', body: JSON.stringify({ userId }) });
        if (!result) return;
        await options.onChanged?.(result.organization);
        dialog.close();
      }, '企业主管理已更新');
    };
  });
  return dialog.close;
}

export function openOrganizationSwitchDialog(store, options) {
  const dialog = accessDialog(store, '切换企业', options);
  void dialog.run(async () => {
    const body = await dialog.request('/api/me/organizations');
    if (!body) return;
    dialog.content.innerHTML = `<form class="organization-editor"><label>企业<select name="organizationId" required>${body.organizations.map(item => `<option value="${esc(item.id)}"${item.id === store.organization?.id ? ' selected' : ''}>${esc(item.name)} · ${esc(ENTERPRISE_ROLE_LABELS[item.role] || item.role)}</option>`).join('')}</select></label><footer><button class="org-primary-button" type="submit">进入企业</button></footer></form>`;
    dialog.content.querySelector('form').onsubmit = event => {
      event.preventDefault();
      const id = new FormData(event.currentTarget).get('organizationId');
      void dialog.run(async () => {
        const body = await dialog.request(`/api/me/organizations/${encodeURIComponent(id)}/switch`, { method: 'POST' });
        if (body) { sessionStorage.setItem('mfggo_saas_token', body.token); location.assign('enterprise.html'); }
      });
    };
  });
  return dialog.close;
}
