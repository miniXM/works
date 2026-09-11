import { enterpriseCan } from './access-policy.js';

const fields = { customerProfile: '客户画像', customerManagement: '客户管理' };

export function renderSharedTaskCustomers(store) {
  if (!enterpriseCan(store, 'customer.read')) return '';
  return Object.entries(fields).map(([key, label]) => `<div data-shared-customer-row><label>${label}</label><input data-shared-customer-field="${key}" aria-label="${label}" maxlength="200" placeholder="正在加载..." readonly></div>`).join('');
}

export function mountSharedTaskCustomers(host, store, taskId, { apiRequest, showToast }) {
  const inputs = [...host.querySelectorAll('[data-shared-customer-field]')];
  if (!inputs.length) return () => {};
  const token = store.apiToken, organizationId = store.organization?.id;
  const path = `/api/tasks/${encodeURIComponent(taskId)}`;
  let disposed = false, loading = false, saving = false, canEdit = false;
  let latest = {}, pendingSave = Promise.resolve();
  const active = () => !disposed && host.isConnected && store.apiToken === token && store.organization?.id === organizationId;
  const allowed = () => active() && enterpriseCan(store, 'customer.read');
  function hide() {
    canEdit = false;
    latest = {};
    for (const input of inputs) { input.value = ''; input.readOnly = true; input.closest('[data-shared-customer-row]').hidden = true; }
  }
  function render(task, capabilities) {
    if (!allowed() || !capabilities?.canViewCustomers) { hide(); return; }
    canEdit = Boolean(capabilities.canEdit);
    for (const input of inputs) {
      const key = input.dataset.sharedCustomerField;
      const dirty = input.value !== String(latest[key] || '') && input.placeholder !== '正在加载...';
      if (!dirty || !canEdit) input.value = String(task[key] || '');
      input.placeholder = '待添加';
      input.readOnly = !canEdit;
      input.title = canEdit ? '' : '由主任务负责人编辑';
      input.closest('[data-shared-customer-row]').hidden = false;
    }
    latest = task;
  }
  async function load() {
    if (!active() || loading || saving || document.hidden) return;
    if (!allowed()) { hide(); return; }
    loading = true;
    try {
      const result = await apiRequest(`${path}/detail`, {}, token);
      if (!active()) return;
      if (result.response?.ok) render(result.body?.task || {}, result.body?.capabilities);
      else if ([401, 403, 404].includes(result.response?.status)) hide();
      else throw new Error('客户资料加载失败');
    } catch {
      if (active()) {
        canEdit = false;
        for (const input of inputs) { input.readOnly = true; input.placeholder = '暂时无法加载'; }
      }
    } finally { loading = false; }
  }
  function onBlur(event) {
    const input = event.currentTarget, key = input.dataset.sharedCustomerField, value = input.value;
    if (!allowed() || !canEdit || saving || value === String(latest[key] || '')) return;
    saving = true;
    inputs.forEach(control => { control.disabled = true; });
    pendingSave = (async () => {
      try {
        const result = await apiRequest(path, { method: 'PUT', body: JSON.stringify({ [key]: value }) }, token);
        if (!active()) return;
        if (!result.response?.ok) {
          if ([401, 403, 404].includes(result.response?.status)) hide();
          showToast(result.body?.message || '客户资料保存失败，请重试');
          return;
        }
        latest = result.body?.task || { ...latest, [key]: value };
        input.value = String(latest[key] || '');
        showToast('客户资料已保存');
      } catch { if (active()) showToast('客户资料保存失败，请重试'); }
      finally {
        saving = false;
        if (active()) { inputs.forEach(control => { control.disabled = false; }); await load(); }
      }
    })();
  }
  for (const input of inputs) input.addEventListener('blur', onBlur);
  const autoLoad = () => { void load(); };
  window.addEventListener('focus', autoLoad);
  window.addEventListener('online', autoLoad);
  document.addEventListener('visibilitychange', autoLoad);
  const refresh = setInterval(autoLoad, 5000);
  const sessionCheck = setInterval(() => { if (!active()) dispose(); else if (!allowed()) hide(); }, 300);
  function dispose() {
    disposed = true;
    clearInterval(refresh);
    clearInterval(sessionCheck);
    window.removeEventListener('focus', autoLoad);
    window.removeEventListener('online', autoLoad);
    document.removeEventListener('visibilitychange', autoLoad);
    for (const input of inputs) input.removeEventListener('blur', onBlur);
    return pendingSave;
  }
  autoLoad();
  return dispose;
}
