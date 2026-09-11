import { hierarchy, tree } from 'd3-hierarchy';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, zoomTransform } from 'd3-zoom';
import { createElement, Search, X, Plus, Minus, Maximize, LocateFixed, RefreshCw, UsersRound, ChevronDown, ChevronRight, Network, LoaderCircle, CircleAlert } from 'lucide';
import { ENTERPRISE_ROLE_LABELS, canonicalEnterpriseRole } from './access-policy.js';
import { renderAssignmentPanel, mountOrganizationAssignment } from './organization-assignment.js';

const NODE_WIDTH = 236;
const NODE_HEIGHT = 164;
const ROW_GAP = 76;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2;
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const icon = shape => createElement(shape, { width: 18, height: 18, 'aria-hidden': 'true' }).outerHTML;
const memberName = member => member.displayName || member.username || '未命名成员';
const roleLabel = member => ENTERPRISE_ROLE_LABELS[canonicalEnterpriseRole(member.role)] || '员工';
const identity = store => `${store.organization?.id || ''}:${store.user?.id || store.user?.userId || ''}`;
const toolButton = (action, shape, label, extra = '') => `<button type="button" class="org-chart-icon" data-chart-action="${action}" title="${label}" aria-label="${label}" ${extra}>${icon(shape)}</button>`;

export function organizationChartLayout(members, collapsed = new Set()) {
  const records = new Map();
  for (const member of members || []) {
    if (member?.id == null || records.has(String(member.id))) continue;
    records.set(String(member.id), { ...member, id: String(member.id), managerUserId: member.managerUserId == null ? null : String(member.managerUserId), children: [] });
  }
  const forest = { id: null, children: [] };
  for (const member of records.values()) {
    const parent = records.get(member.managerUserId);
    let ancestor = parent;
    const visited = new Set([member.id]);
    while (ancestor && !visited.has(ancestor.id)) {
      visited.add(ancestor.id);
      ancestor = records.get(ancestor.managerUserId);
    }
    // Invalid cycles stay visible as separate roots instead of breaking the canvas.
    if (parent && !ancestor) parent.children.push(member);
    else forest.children.push(member);
  }
  const root = hierarchy(forest, record => collapsed.has(record.id) ? null : record.children);
  tree().nodeSize([NODE_WIDTH + 34, NODE_HEIGHT + ROW_GAP]).separation((left, right) => left.parent === right.parent ? 1 : 1.12)(root);
  const nodes = root.descendants().filter(node => node.data.id !== null).map(node => ({
    id: node.data.id, member: node.data, x: node.x - NODE_WIDTH / 2,
    y: (node.depth - 1) * (NODE_HEIGHT + ROW_GAP),
    childCount: node.data.children.length,
    expanded: !collapsed.has(node.data.id)
  }));
  const positions = new Map(nodes.map(node => [node.id, node]));
  const links = root.links().filter(link => link.source.data.id !== null).map(link => ({ source: positions.get(link.source.data.id), target: positions.get(link.target.data.id) }));
  const bounds = nodes.length ? {
    minX: Math.min(...nodes.map(node => node.x)), minY: Math.min(...nodes.map(node => node.y)),
    maxX: Math.max(...nodes.map(node => node.x + NODE_WIDTH)), maxY: Math.max(...nodes.map(node => node.y + NODE_HEIGHT))
  } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { nodes, links, bounds, records };
}

export function searchOrganizationMembers(members, query) {
  const normalized = String(query || '').trim().toLocaleLowerCase();
  if (!normalized) return [];
  return members.filter(member => [member.displayName, member.username, member.departmentName, member.jobTitle, roleLabel(member)]
    .some(value => String(value || '').toLocaleLowerCase().includes(normalized)));
}

export function renderOrganizationChart(store) {
  return `<section class="view organization-chart-view" data-organization-chart aria-label="组织架构">
    <header class="org-chart-toolbar">
      <div class="org-chart-heading"><span class="org-chart-heading-icon">${icon(Network)}</span><div><h2 data-chart-name>${escape(store.organization?.name || '组织架构')}</h2><p><span data-chart-member-count>组织成员</span><span class="org-chart-scope">我的汇报关系</span></p></div></div>
      <div class="org-chart-actions">
        <div class="org-chart-search-wrap"><form class="org-chart-search" data-chart-search-form role="search">${icon(Search)}<input type="search" data-chart-search placeholder="搜索成员、部门或职务" aria-label="搜索成员、部门或职务" aria-controls="organization-chart-search-results" autocomplete="off" disabled><button type="button" data-chart-action="clear-search" title="清空搜索" aria-label="清空搜索" hidden>${icon(X)}</button></form><div class="org-chart-results" data-chart-results id="organization-chart-search-results" hidden></div></div>
        ${toolButton('refresh', RefreshCw, '刷新组织架构')}
        <button type="button" class="org-chart-manage" data-chart-action="manage" title="管理成员" aria-label="管理成员" hidden>${icon(UsersRound)}<span>管理成员</span></button>
      </div>
    </header>
    <div class="org-chart-workspace">${renderAssignmentPanel()}
    <div class="org-chart-viewport" data-chart-viewport tabindex="0" aria-label="组织架构画布" aria-busy="true">
      <div class="org-chart-scene" data-chart-scene><svg class="org-chart-links" data-chart-links aria-hidden="true"></svg><div data-chart-nodes role="list" aria-label="成员汇报关系"></div></div>
      <div class="org-chart-state" data-chart-state role="status" aria-live="polite"><span class="org-chart-loading">${icon(LoaderCircle)}</span><b>正在加载组织架构</b></div>
      <div class="org-chart-bottom">
        <div class="org-chart-summary" data-chart-summary hidden><span class="org-chart-self-key"></span><span>本人</span><span class="org-chart-summary-count" data-chart-visible-count></span></div>
        <div class="org-chart-controls" role="group" aria-label="画布视图">
          ${toolButton('zoom-out', Minus, '缩小', 'disabled')}
          <button type="button" class="org-chart-zoom" data-chart-action="reset-zoom" title="恢复 100% 缩放" aria-label="恢复 100% 缩放" disabled><output data-chart-zoom>100%</output></button>
          ${toolButton('zoom-in', Plus, '放大', 'disabled')}<span class="org-chart-control-divider"></span>
          ${toolButton('fit', Maximize, '适应全部成员', 'disabled')}${toolButton('self', LocateFixed, '定位到本人', 'disabled')}
        </div>
      </div>
    </div>
    </div><div class="org-chart-announcement" data-chart-announcement role="status" aria-live="polite"></div>
  </section>`;
}

export function mountOrganizationChart(host, store, { apiRequest, showToast = () => {}, onManage, onEdit, onCreate } = {}) {
  const root = host.querySelector('[data-organization-chart]');
  if (!root) return () => {};
  const viewport = root.querySelector('[data-chart-viewport]');
  const scene = root.querySelector('[data-chart-scene]');
  const nodesHost = root.querySelector('[data-chart-nodes]');
  const linksHost = root.querySelector('[data-chart-links]');
  const status = root.querySelector('[data-chart-state]');
  const search = root.querySelector('[data-chart-search]');
  const results = root.querySelector('[data-chart-results]');
  const token = store.apiToken;
  const sessionIdentity = identity(store);
  let disposed = false, controller = null, requestVersion = 0, data = null, layout = null, selectedId = null, searchMatches = [];
  const collapsed = new Set();
  const active = () => !disposed && root.isConnected && token === store.apiToken && sessionIdentity === identity(store);
  const dimensions = () => ({ width: viewport.clientWidth || 1, height: viewport.clientHeight || 1 });
  let lastDimensions = dimensions();
  const announcement = text => { root.querySelector('[data-chart-announcement]').textContent = text; };
  const zoomBehavior = zoom().scaleExtent([MIN_ZOOM, MAX_ZOOM])
    .extent(() => { const { width, height } = dimensions(); return [[0, 0], [width, height]]; })
    .filter(event => !event.target.closest('button, input, select, [data-chart-results]') && (event.type === 'wheel' || !event.target.closest('[data-member-drag]')) && (!event.ctrlKey || event.type === 'wheel') && !event.button)
    .on('zoom.organization', event => {
      if (!active()) return;
      scene.style.transform = `translate(${event.transform.x}px, ${event.transform.y}px) scale(${event.transform.k})`;
      viewport.style.setProperty('--chart-dot-size', `${24 * event.transform.k}px`);
      viewport.style.setProperty('--chart-dot-x', `${event.transform.x}px`);
      viewport.style.setProperty('--chart-dot-y', `${event.transform.y}px`);
      root.querySelector('[data-chart-zoom]').textContent = `${Math.round(event.transform.k * 100)}%`;
      root.querySelector('[data-chart-action="zoom-out"]').disabled = !layout?.nodes.length || event.transform.k <= MIN_ZOOM;
      root.querySelector('[data-chart-action="zoom-in"]').disabled = !layout?.nodes.length || event.transform.k >= MAX_ZOOM;
    });
  const selection = select(viewport).call(zoomBehavior).on('dblclick.zoom', null);
  const assignment = mountOrganizationAssignment(root, {
    getData: () => data, apiRequest, token, active, reload: () => load({ throwOnError: true }),
    onEdit, onCreate, onPanelResize: () => requestAnimationFrame(() => { if (active()) fit(); }), showToast
  });

  function setState(kind, message) {
    status.hidden = !kind;
    viewport.setAttribute('aria-busy', String(kind === 'loading'));
    if (kind) status.innerHTML = `<span class="${kind === 'loading' ? 'org-chart-loading' : 'org-chart-state-icon'}">${icon(kind === 'loading' ? LoaderCircle : kind === 'error' ? CircleAlert : UsersRound)}</span><b>${escape(message)}</b>${kind === 'error' ? '<button type="button" class="org-chart-retry" data-chart-action="refresh">重新加载</button>' : ''}`;
    root.querySelector('[data-chart-action="refresh"]').disabled = kind === 'loading';
    root.querySelector('[data-chart-action="refresh"]').classList.toggle('is-loading', kind === 'loading');
  }

  function setControls(enabled) {
    search.disabled = !enabled;
    for (const button of root.querySelectorAll('.org-chart-controls button')) button.disabled = !enabled;
    root.querySelector('[data-chart-summary]').hidden = !enabled;
  }

  function fit() {
    if (!layout?.nodes.length) return;
    const { width, height } = dimensions();
    lastDimensions = { width, height };
    const { minX, minY, maxX, maxY } = layout.bounds;
    const availableHeight = Math.max(100, height - 116);
    const scale = Math.max(MIN_ZOOM, Math.min(1, (width - 64) / Math.max(NODE_WIDTH, maxX - minX), availableHeight / Math.max(NODE_HEIGHT, maxY - minY)));
    selection.call(zoomBehavior.transform, zoomIdentity.translate(width / 2 - (minX + maxX) / 2 * scale, 28 + availableHeight / 2 - (minY + maxY) / 2 * scale).scale(scale));
  }

  function centerMember(id, highlight = true) {
    if (!layout || !data) return;
    if (data.unassignedMembers?.some(member => String(member.id) === String(id))) {
      assignment.focusPool(id);
      return;
    }
    const seen = new Set();
    let current = layout.records.get(String(id));
    if (!current) return;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      collapsed.delete(current.id);
      current = layout.records.get(current.managerUserId);
    }
    selectedId = highlight ? String(id) : null;
    draw();
    const node = layout.nodes.find(item => item.id === String(id));
    if (!node) return;
    const { width, height } = dimensions();
    lastDimensions = { width, height };
    const scale = Math.max(0.7, Math.min(1, zoomTransform(viewport).k));
    selection.call(zoomBehavior.transform, zoomIdentity.translate(width / 2 - (node.x + NODE_WIDTH / 2) * scale, (height - 64) / 2 - (node.y + NODE_HEIGHT / 2) * scale).scale(scale));
    announcement(`已定位到${memberName(node.member)}`);
  }

  function draw() {
    if (!active() || !data) return;
    layout = organizationChartLayout(data.members, collapsed);
    const currentUserId = String(data.currentUserId);
    const supervisorId = layout.records.get(currentUserId)?.managerUserId;
    linksHost.innerHTML = layout.links.map(({ source, target }) => {
      const x1 = source.x + NODE_WIDTH / 2, y1 = source.y + NODE_HEIGHT;
      const x2 = target.x + NODE_WIDTH / 2, y2 = target.y;
      const middle = y1 + ROW_GAP / 2;
      return `<path d="M ${x1} ${y1} V ${middle} H ${x2} V ${y2}" class="${target.id === currentUserId ? 'is-self-link' : ''}" />`;
    }).join('');
    nodesHost.innerHTML = layout.nodes.map(node => {
      const member = node.member, isSelf = node.id === currentUserId, isSupervisor = node.id === supervisorId;
      const name = memberName(member), role = canonicalEnterpriseRole(member.role);
      const details = [name, roleLabel(member), member.departmentName, member.jobTitle].filter(Boolean).join('，');
      return `<article class="org-chart-person ${isSelf ? 'is-self' : ''} ${selectedId === node.id ? 'is-selected' : ''}" style="left:${node.x}px;top:${node.y}px" data-chart-member="${escape(node.id)}" role="listitem" aria-label="${escape(details)}${isSelf ? '，本人' : isSupervisor ? '，直属上级' : ''}" tabindex="0">
        <div class="org-chart-person-top"><span class="org-chart-avatar role-${role === 'owner' ? 'owner' : role === 'admin' ? 'admin' : 'member'}">${escape([...name.trim()][0] || '?')}</span><div class="org-chart-person-title"><b title="${escape(name)}">${escape(name)}</b><span class="org-chart-role">${escape(roleLabel(member))}</span></div>${isSelf ? '<span class="org-chart-relation is-self">本人</span>' : isSupervisor ? '<span class="org-chart-relation">直属上级</span>' : ''}</div>
        <div class="org-chart-person-details"><span title="${escape(member.departmentName || '未分配部门')}">${escape(member.departmentName || '未分配部门')}</span><span title="${escape(member.jobTitle || '未设置职务')}">${escape(member.jobTitle || '未设置职务')}</span></div>
        <div class="org-chart-person-bottom">${node.childCount ? `<button type="button" data-chart-toggle="${escape(node.id)}" aria-expanded="${node.expanded}" title="${node.expanded ? '收起' : '展开'}${escape(name)}的下级">${icon(node.expanded ? ChevronDown : ChevronRight)}<span>${node.childCount} 位直属下级</span></button>` : '<span>暂无直属下级</span>'}</div>
      </article>`;
    }).join('');
    root.querySelector('[data-chart-visible-count]').textContent = `${layout.nodes.length} / ${data.members.length} 位成员`;
    root.querySelector('[data-chart-member-count]').textContent = `${data.members.length} 位可见成员`;
    setControls(Boolean(layout.nodes.length));
    root.querySelector('[data-chart-action="self"]').disabled = !layout.records.has(currentUserId);
    assignment.update();
  }

  function hideResults() {
    results.hidden = true;
    search.setAttribute('aria-expanded', 'false');
  }

  function renderSearch() {
    const query = search.value.trim();
    root.querySelector('[data-chart-action="clear-search"]').hidden = !query;
    searchMatches = data ? searchOrganizationMembers([...data.members, ...(data.unassignedMembers || [])], query) : [];
    if (!query) { hideResults(); return; }
    results.innerHTML = searchMatches.length ? `<div class="org-chart-results-count">${searchMatches.length} 位成员</div>${searchMatches.map(member => `<button type="button" data-chart-search-member="${escape(member.id)}"><span class="org-chart-search-avatar">${escape([...memberName(member)][0])}</span><span><b>${escape(memberName(member))}</b><small>${escape([roleLabel(member), member.departmentName].filter(Boolean).join(' · '))}</small></span></button>`).join('')}` : '<div class="org-chart-no-results">未找到匹配的成员</div>';
    results.hidden = false;
    search.setAttribute('aria-expanded', 'true');
  }

  async function load({ throwOnError = false } = {}) {
    if (!active()) return;
    const version = ++requestVersion;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    data = null; layout = null;
    assignment.update();
    nodesHost.replaceChildren(); linksHost.replaceChildren();
    hideResults(); setControls(false);
    root.querySelector('[data-chart-action="manage"]').hidden = true;
    root.querySelector('[data-chart-member-count]').textContent = '组织成员';
    setState('loading', '正在加载组织架构');
    try {
      if (!token || typeof apiRequest !== 'function') throw new Error('请登录后查看组织架构');
      const result = await apiRequest('/api/organization/assignment-board', { signal }, token);
      if (!active() || signal.aborted || version !== requestVersion) return;
      if (!result.response?.ok) throw new Error(result.body?.message || '组织架构加载失败');
      const body = result.body;
      if (!Array.isArray(body?.members) || !body.currentUserId || !body.organization?.id) throw new Error('组织架构数据不完整');
      if (String(body.currentUserId) !== String(store.user?.id || store.user?.userId || '') || String(body.organization.id) !== String(store.organization?.id || '')) throw new Error('登录信息已变更，请刷新页面');
      data = { ...body, members: body.members.filter(member => member && member.id != null) };
      selectedId = null;
      for (const id of collapsed) if (!data.members.some(member => String(member.id) === id)) collapsed.delete(id);
      root.querySelector('[data-chart-name]').textContent = body.organization.name || '组织架构';
      root.querySelector('[data-chart-action="manage"]').hidden = !body.capabilities?.canManageMembers || typeof onManage !== 'function';
      draw();
      setState(data.members.length ? null : 'empty', '暂无组织成员');
      fit();
      if (search.value) renderSearch();
    } catch (error) {
      if (!active() || signal.aborted || version !== requestVersion) return;
      setState('error', error.message || '组织架构加载失败');
      if (throwOnError) throw error;
    }
  }

  function onClick(event) {
    if (!active()) return;
    const resultButton = event.target.closest('[data-chart-search-member]');
    if (resultButton) { centerMember(resultButton.dataset.chartSearchMember); hideResults(); if (!data?.unassignedMembers?.some(member => String(member.id) === resultButton.dataset.chartSearchMember)) viewport.focus({ preventScroll: true }); return; }
    const toggle = event.target.closest('[data-chart-toggle]');
    if (toggle) {
      const id = toggle.dataset.chartToggle;
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      draw();
      const replacement = [...root.querySelectorAll('[data-chart-toggle]')].find(button => button.dataset.chartToggle === id);
      replacement?.focus({ preventScroll: true });
      announcement(`${collapsed.has(id) ? '已收起' : '已展开'}${memberName(layout.records.get(id))}的下级`);
      return;
    }
    const action = event.target.closest('[data-chart-action]')?.dataset.chartAction;
    if (!action) return;
    if (action === 'refresh') { void load(); return; }
    if (action === 'clear-search') { search.value = ''; selectedId = null; draw(); renderSearch(); search.focus(); return; }
    if (action === 'manage') {
      if (data?.capabilities?.canManageMembers && typeof onManage === 'function') {
        try { Promise.resolve(onManage()).catch(error => { if (active()) showToast(error.message || '无法打开成员管理'); }); }
        catch (error) { showToast(error.message || '无法打开成员管理'); }
      }
      return;
    }
    if (!layout?.nodes.length) return;
    if (action === 'fit') fit();
    if (action === 'self') centerMember(data.currentUserId);
    if (action === 'zoom-in' || action === 'zoom-out') selection.call(zoomBehavior.scaleBy, action === 'zoom-in' ? 1.2 : 1 / 1.2);
    if (action === 'reset-zoom') selection.call(zoomBehavior.scaleTo, 1);
  }

  function onKeyDown(event) {
    if (!active()) return;
    if (event.key === 'Escape') { hideResults(); if (results.contains(event.target)) search.focus(); return; }
    if (event.target === search && event.key === 'ArrowDown' && !results.hidden) { event.preventDefault(); results.querySelector('button')?.focus(); return; }
    if (results.contains(event.target) && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const buttons = [...results.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
      buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      return;
    }
    if (event.target !== viewport || !layout?.nodes.length) return;
    const pans = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
    if (pans[event.key]) { event.preventDefault(); const scale = zoomTransform(viewport).k; selection.call(zoomBehavior.translateBy, pans[event.key][0] / scale, pans[event.key][1] / scale); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); selection.call(zoomBehavior.scaleBy, 1.2); }
    else if (event.key === '-') { event.preventDefault(); selection.call(zoomBehavior.scaleBy, 1 / 1.2); }
    else if (event.key === 'Home') { event.preventDefault(); fit(); }
  }

  function onSubmit(event) {
    event.preventDefault();
    if (searchMatches[0]) { centerMember(searchMatches[0].id); hideResults(); if (!data?.unassignedMembers?.some(member => member.id === searchMatches[0].id)) viewport.focus({ preventScroll: true }); }
  }
  function onDocumentClick(event) { if (!root.querySelector('.org-chart-search-wrap').contains(event.target)) hideResults(); }
  function onSearchFocus() { if (search.value) renderSearch(); }
  function onRefresh() { void load(); }
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('organization-chart-refresh', onRefresh);
  search.addEventListener('input', renderSearch);
  search.addEventListener('focus', onSearchFocus);
  root.querySelector('[data-chart-search-form]').addEventListener('submit', onSubmit);
  document.addEventListener('click', onDocumentClick);
  const observer = new ResizeObserver(() => {
    if (!active()) return;
    const next = dimensions();
    const transform = zoomTransform(viewport);
    selection.call(zoomBehavior.transform, zoomIdentity.translate(transform.x + (next.width - lastDimensions.width) / 2, transform.y + (next.height - lastDimensions.height) / 2).scale(transform.k));
    lastDimensions = next;
  });
  observer.observe(viewport);
  const sessionCheck = setInterval(() => { if (!active()) cleanup(); }, 400);
  function cleanup() {
    if (disposed) return;
    disposed = true;
    ++requestVersion;
    controller?.abort();
    assignment.cleanup();
    clearInterval(sessionCheck);
    observer.disconnect();
    selection.on('.zoom', null);
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('organization-chart-refresh', onRefresh);
    search.removeEventListener('input', renderSearch);
    search.removeEventListener('focus', onSearchFocus);
    root.querySelector('[data-chart-search-form]').removeEventListener('submit', onSubmit);
    document.removeEventListener('click', onDocumentClick);
    data = null; layout = null; searchMatches = [];
    root.replaceChildren();
  }
  void load();
  return cleanup;
}
