import { createElement, Search, GripVertical, UserPlus, Pencil, Network, X, Check, PanelLeftClose, PanelLeftOpen } from 'lucide';
import { ENTERPRISE_ROLE_LABELS } from './access-policy.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const icon = shape => createElement(shape, { width: 16, height: 16, 'aria-hidden': 'true' }).outerHTML;
const nameOf = member => member.displayName || member.username || '未命名成员';
const button = (action, shape, label, id = '') => `<button type="button" data-assignment-action="${action}" data-assignment-id="${escape(id)}" title="${escape(label)}" aria-label="${escape(label)}">${icon(shape)}</button>`;

export function renderAssignmentPanel() {
  return `<aside class="org-assignment-panel" data-assignment-panel aria-label="未分配员工" hidden>
    <header><h3>未分配员工 <small data-assignment-count>0</small></h3>${button('collapse', PanelLeftClose, '收起员工窗口')}</header>
    <label class="org-assignment-search">${icon(Search)}<input type="search" data-assignment-search placeholder="搜索姓名或账号" aria-label="搜索未分配员工" autocomplete="off"></label>
    <div class="org-assignment-pool" data-assignment-pool aria-label="未分配员工列表"></div>
    <footer>${button('create', UserPlus, '新增员工')}<span>待安排归属</span></footer>
  </aside><button class="org-assignment-reopen" type="button" data-assignment-action="expand" title="展开未分配员工" aria-label="展开未分配员工" hidden>${icon(PanelLeftOpen)}</button>
  <section class="org-assignment-picker" data-assignment-picker role="dialog" aria-modal="false" aria-label="分配员工" hidden></section>
  <div class="org-assignment-message" data-assignment-message role="status" aria-live="polite" hidden></div>`;
}

export function assignmentAllowed(data, sourceId, targetId) {
  const records = new Map([...(data?.members || []), ...(data?.unassignedMembers || [])].map(member => [String(member.id), member]));
  const source = records.get(String(sourceId));
  if (!data?.capabilities?.canAssignMembers || !source?.canMove) return false;
  if (targetId === null) return Boolean(source.managerUserId);
  const target = records.get(String(targetId));
  if (!target?.canReceive || String(source.managerUserId || '') === String(targetId)) return false;
  if (source.role === 'admin' && target.role === 'member') return false;
  let current = target;
  const seen = new Set();
  while (current && !seen.has(String(current.id))) {
    if (String(current.id) === String(source.id)) return false;
    seen.add(String(current.id));
    current = records.get(String(current.managerUserId));
  }
  return true;
}

export function mountOrganizationAssignment(root, { getData, apiRequest, token, active, reload, onEdit, onCreate, onPanelResize = () => {} }) {
  const panel = root.querySelector('[data-assignment-panel]');
  const pool = root.querySelector('[data-assignment-pool]');
  const search = root.querySelector('[data-assignment-search]');
  const picker = root.querySelector('[data-assignment-picker]');
  const message = root.querySelector('[data-assignment-message]');
  const reopen = root.querySelector('[data-assignment-action="expand"]');
  let disposed = false, busy = false, drag = null, ghost = null, controller = null, pickerSource = null, focusBeforePicker = null;
  let collapsed = false, lastPointerClick = 0, messageTimer = null;
  const records = () => [...(getData()?.members || []), ...(getData()?.unassignedMembers || [])];
  const memberById = id => records().find(member => String(member.id) === String(id));
  const isActive = () => !disposed && active();
  const report = (text, error = false, pending = false) => {
    clearTimeout(messageTimer);
    message.textContent = text;
    message.hidden = !text;
    message.classList.toggle('is-error', error);
    message.setAttribute('role', error ? 'alert' : 'status');
    if (text && !error && !pending) messageTimer = setTimeout(() => { message.hidden = true; }, 5000);
  };

  function renderPool() {
    const data = getData();
    const enabled = Boolean(data?.capabilities?.canAssignMembers);
    panel.hidden = !enabled || collapsed;
    reopen.hidden = !enabled || !collapsed;
    root.classList.toggle('has-assignment-panel', enabled && !collapsed);
    const query = search.value.trim().toLocaleLowerCase();
    const unassigned = data?.unassignedMembers || [];
    const filtered = unassigned.filter(member => `${nameOf(member)} ${member.username || ''} ${member.jobTitle || ''}`.toLocaleLowerCase().includes(query));
    root.querySelector('[data-assignment-count]').textContent = String(unassigned.length);
    search.disabled = busy;
    pool.innerHTML = filtered.length ? filtered.map(member => `<article class="org-pool-person" data-pool-member="${escape(member.id)}" tabindex="0">
      <div class="org-pool-identity" data-member-drag="${escape(member.id)}"${member.canMove ? '' : ' data-drag-disabled'}><span class="org-pool-grip">${icon(GripVertical)}</span><span class="org-pool-avatar">${escape([...nameOf(member)][0])}</span><div><b title="${escape(nameOf(member))}">${escape(nameOf(member))}</b><small>${escape(member.jobTitle || ENTERPRISE_ROLE_LABELS[member.role] || '员工')}</small></div></div>
      <footer><span title="${escape(member.username)}">@${escape(member.username)}</span><div>${member.canEdit ? button('edit', Pencil, `设置${nameOf(member)}的职位与权限`, member.id) : ''}${member.canMove ? button('assign', Network, `分配${nameOf(member)}的归属`, member.id) : ''}</div></footer>
      ${member.childCount ? `<small class="org-pool-branch">含 ${Number(member.childCount)} 位下级</small>` : ''}</article>`).join('') : `<p class="org-pool-empty">${query ? '未找到员工' : '暂无未分配员工'}</p>`;
    for (const control of panel.querySelectorAll('button')) control.disabled = busy;
    panel.querySelector('[data-assignment-action="create"]').hidden = !data?.capabilities?.canManageMembers;
  }

  function decorateNodes() {
    for (const card of root.querySelectorAll('[data-chart-member]')) {
      const member = memberById(card.dataset.chartMember);
      const top = card.querySelector('.org-chart-person-top');
      if (top) { delete top.dataset.memberDrag; top.removeAttribute('title'); }
      delete card.dataset.memberDrag;
      card.querySelector('[data-member-grip]')?.remove();
      if (member?.canMove) {
        card.dataset.memberDrag = String(member.id);
        top?.insertAdjacentHTML('beforeend', `<span class="org-chart-person-grip" data-member-grip title="调整${escape(nameOf(member))}的归属" aria-hidden="true">${icon(GripVertical)}</span>`);
      }
      card.querySelector('[data-assignment-tools]')?.remove();
      if (member?.canMove || member?.canEdit) {
        card.insertAdjacentHTML('beforeend', `<div class="org-chart-person-tools" data-assignment-tools>${member.canEdit ? button('edit', Pencil, `设置${nameOf(member)}的职位与权限`, member.id) : ''}${member.canMove ? button('assign', Network, `分配${nameOf(member)}的归属`, member.id) : ''}</div>`);
      }
    }
  }

  function closePicker(restore = true) {
    picker.hidden = true;
    pickerSource = null;
    if (restore && focusBeforePicker?.isConnected) focusBeforePicker.focus({ preventScroll: true });
  }

  function openPicker(id) {
    const source = memberById(id);
    if (!source?.canMove || busy) return;
    focusBeforePicker = document.activeElement;
    pickerSource = String(id);
    const targets = (getData()?.members || []).filter(member => assignmentAllowed(getData(), id, String(member.id)));
    picker.innerHTML = `<header><h3>${escape(nameOf(source))}</h3>${button('close-picker', X, '关闭分配窗口')}</header><form data-assignment-form><label>直属上级<select name="managerUserId" aria-label="直属上级" required>${source.managerUserId ? '<option value="__pool__">未分配员工</option>' : ''}${targets.map(member => `<option value="${escape(member.id)}">${escape(nameOf(member))} · ${escape(member.jobTitle || ENTERPRISE_ROLE_LABELS[member.role])}</option>`).join('')}</select></label><footer><button type="submit"${targets.length || source.managerUserId ? '' : ' disabled'}>${icon(Check)}<span>确认分配</span></button></footer></form>`;
    picker.hidden = false;
    picker.querySelector('select')?.focus();
  }

  async function assign(id, targetId) {
    if (busy || !isActive() || !assignmentAllowed(getData(), id, targetId)) return;
    const member = memberById(id);
    const target = targetId === null ? null : memberById(targetId);
    busy = true;
    controller = new AbortController();
    closePicker(false);
    renderPool();
    root.classList.add('is-assigning');
    report(`正在调整${nameOf(member)}的归属…`, false, true);
    let saved = false;
    try {
      const result = await apiRequest(`/api/organization/members/${encodeURIComponent(id)}/reporting`, {
        method: 'PUT', signal: controller.signal,
        body: JSON.stringify({ managerUserId: targetId, expectedManagerUserId: member.managerUserId || null })
      }, token);
      if (!isActive()) return;
      if (!result.response?.ok) {
        if (result.response?.status === 409 || result.response?.status === 403) await reload();
        throw new Error(result.body?.message || '归属调整失败，请重试');
      }
      saved = true;
      await reload();
      if (!isActive()) return;
      const text = target ? `${nameOf(member)}已分配到${nameOf(target)}名下` : `${nameOf(member)}已移回未分配员工`;
      report(text);
    } catch (error) {
      if (isActive() && error.name !== 'AbortError') report(saved ? `已保存，刷新失败：${error.message}` : error.message, true);
    } finally {
      if (isActive()) { busy = false; root.classList.remove('is-assigning'); renderPool(); decorateNodes(); }
    }
  }

  function clearDrag() {
    root.querySelectorAll('.is-drop-target, .is-drop-invalid, .is-drag-source').forEach(element => element.classList.remove('is-drop-target', 'is-drop-invalid', 'is-drag-source'));
    ghost?.remove(); ghost = null;
    root.classList.remove('is-member-dragging');
    drag = null;
  }

  function targetAt(x, y) {
    const element = document.elementFromPoint(x, y);
    const card = element?.closest('[data-chart-member]');
    if (card && root.contains(card)) return { element: card, id: card.dataset.chartMember };
    if (element?.closest('[data-assignment-panel]') === panel) return { element: panel, id: null };
    return null;
  }

  function onPointerDown(event) {
    if (!isActive() || busy || event.button !== 0 || event.target.closest('button, input, select')) return;
    const handle = event.target.closest('[data-member-drag]');
    if (!handle || handle.hasAttribute('data-drag-disabled')) return;
    const member = memberById(handle.dataset.memberDrag);
    if (!member?.canMove) return;
    event.stopPropagation();
    event.preventDefault();
    drag = { id: String(member.id), x: event.clientX, y: event.clientY, pointerId: event.pointerId, started: false, source: handle.closest('[data-chart-member], [data-pool-member]') };
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId || !isActive()) return;
    event.preventDefault();
    if (!drag.started && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    if (!drag.started) {
      drag.started = true;
      drag.source?.classList.add('is-drag-source');
      root.classList.add('is-member-dragging');
      ghost = document.createElement('div');
      ghost.className = 'org-assignment-drag-ghost';
      ghost.textContent = nameOf(memberById(drag.id));
      document.body.appendChild(ghost);
    }
    ghost.style.left = `${event.clientX + 16}px`;
    ghost.style.top = `${event.clientY + 14}px`;
    root.querySelectorAll('.is-drop-target, .is-drop-invalid').forEach(element => element.classList.remove('is-drop-target', 'is-drop-invalid'));
    const target = targetAt(event.clientX, event.clientY);
    if (target) target.element.classList.add(assignmentAllowed(getData(), drag.id, target.id) ? 'is-drop-target' : 'is-drop-invalid');
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const previous = drag;
    const target = previous.started ? targetAt(event.clientX, event.clientY) : null;
    clearDrag();
    if (previous.started) {
      lastPointerClick = Date.now();
      if (target && assignmentAllowed(getData(), previous.id, target.id)) void assign(previous.id, target.id);
      else if (target) report('不能分配到此位置，请选择可管理的其他成员', true);
    }
  }

  function onClick(event) {
    if (Date.now() - lastPointerClick < 250) { event.preventDefault(); return; }
    const control = event.target.closest('[data-assignment-action]');
    if (!control || !isActive() || busy) return;
    const { assignmentAction: action, assignmentId: id } = control.dataset;
    if (action === 'collapse' || action === 'expand') { collapsed = action === 'collapse'; renderPool(); onPanelResize(); }
    if (action === 'close-picker') closePicker();
    if (action === 'assign') openPicker(id);
    if (action === 'edit' && memberById(id)?.canEdit) onEdit?.(id);
    if (action === 'create') onCreate?.();
  }
  function onSubmit(event) {
    if (!event.target.matches('[data-assignment-form]')) return;
    event.preventDefault();
    const value = new FormData(event.target).get('managerUserId');
    if (value && pickerSource) void assign(pickerSource, value === '__pool__' ? null : String(value));
  }
  function onKeyDown(event) {
    if (event.key === 'Escape') { clearDrag(); closePicker(); }
  }
  function focusPool(id) {
    collapsed = false;
    search.value = memberById(id)?.username || '';
    renderPool();
    pool.querySelector('[data-pool-member]')?.focus({ preventScroll: true });
    onPanelResize();
  }
  root.addEventListener('pointerdown', onPointerDown, true);
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('keydown', onKeyDown);
  search.addEventListener('input', renderPool);
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', clearDrag);
  window.addEventListener('blur', clearDrag);
  return {
    update() { clearDrag(); renderPool(); decorateNodes(); }, focusPool,
    cleanup() {
      disposed = true; controller?.abort(); clearTimeout(messageTimer); clearDrag();
      root.removeEventListener('pointerdown', onPointerDown, true);
      root.removeEventListener('click', onClick);
      root.removeEventListener('submit', onSubmit);
      root.removeEventListener('keydown', onKeyDown);
      search.removeEventListener('input', renderPool);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', clearDrag);
      window.removeEventListener('blur', clearDrag);
      closePicker(false);
    }
  };
}
