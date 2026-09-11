import { enterpriseCan } from './access-policy.js';

const HISTORY_ACTION_LABELS = Object.freeze({
  created: '创建分配', claimed: '认领', transferred: '交接', released: '释放',
  status_changed: '状态变更', completed: '完成', reopened: '重新打开',
  deleted: '删除', recycled: '移入回收站', restored: '恢复', migration_snapshot: '迁移快照'
});
const LEGACY_STATUSES = ['待处理', '进行中', '阻塞', '已完成'];
const FILTER_KEYS = ['userId', 'stage', 'status', 'from', 'to'];
const PAGE_SIZE = 50;
const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

export function canViewTaskHistoryReport(store = {}) {
  return enterpriseCan({ ...store, role: store.role || store.user?.role }, 'stats.read');
}

export function buildTaskHistoryQuery(filters = {}, { page = 1, pageSize = PAGE_SIZE, paginate = true } = {}) {
  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = String(filters[key] ?? '').trim();
    if (value) query.set(key, value);
  }
  if (paginate) {
    query.set('page', String(Math.max(1, Math.trunc(Number(page)) || 1)));
    query.set('pageSize', String(Math.min(100, Math.max(1, Math.trunc(Number(pageSize)) || PAGE_SIZE))));
  }
  return query.toString();
}

export function formatTaskHistoryTime(value) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间未知';
  const parts = Object.fromEntries(timeFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function isBaseline(item) {
  return item.source === 'migration' || item.eventType === 'migration_snapshot';
}

function actionLabel(item) {
  if (isBaseline(item)) return '迁移快照';
  return item.eventLabel || HISTORY_ACTION_LABELS[item.eventType] || item.eventType || '更新';
}

function assigneeName(item, previous = false) {
  return previous
    ? item.previousAssigneeName || (item.previousAssigneeUserId ? '已离开成员' : '未分配')
    : item.assigneeName || (item.assigneeUserId ? '已离开成员' : '未分配');
}

function transition(fromValue, toValue, fallback = '未设置') {
  const from = String(fromValue || fallback);
  const to = String(toValue || fallback);
  return from === to ? escapeHtml(to) : `${escapeHtml(from)} <span aria-hidden="true">→</span> ${escapeHtml(to)}`;
}

function actionMarkup(item) {
  return `<span class="task-history-action${isBaseline(item) ? ' is-baseline' : ''}">${escapeHtml(actionLabel(item))}</span>${isBaseline(item) ? '<small class="task-history-baseline-note">原始操作时间未知</small>' : ''}`;
}

function historyRows(items) {
  return items.map(item => `<tr${isBaseline(item) ? ' class="task-history-baseline"' : ''}>
    <td class="task-history-time"><time datetime="${escapeHtml(item.occurredAt)}">${escapeHtml(formatTaskHistoryTime(item.occurredAt))}</time></td>
    <td class="task-history-entity"><b>${escapeHtml(item.title || '未命名任务')}</b><small>${escapeHtml(item.projectTitle || '独立任务')}${item.entityKind === 'subtask' || item.subtaskId ? ' · 子任务' : ''}</small></td>
    <td>${actionMarkup(item)}</td><td>${escapeHtml(item.actorName || (isBaseline(item) ? '系统迁移' : '系统'))}</td>
    <td>${transition(assigneeName(item, true), assigneeName(item), '未分配')}</td>
    <td>${transition(item.previousStage, item.stage)}</td><td>${transition(item.previousStatus, item.status)}</td>
  </tr>`).join('');
}

export function renderTaskHistoryTimeline(items = []) {
  const history = Array.isArray(items) ? items : [];
  if (!history.length) return '<p class="task-history-empty">暂无执行历史</p>';
  return `<div class="task-history-timeline"><p class="task-history-time-label">事件时间（北京时间）</p><ol>${history.map(item => `<li${isBaseline(item) ? ' class="is-baseline"' : ''}>
    <div class="task-history-timeline-top">${actionMarkup(item)}<time datetime="${escapeHtml(item.occurredAt)}">${escapeHtml(formatTaskHistoryTime(item.occurredAt))}</time></div>
    <p><b>${escapeHtml(item.actorName || (isBaseline(item) ? '系统迁移' : '系统'))}</b></p>
    <dl><div><dt>负责人</dt><dd>${transition(assigneeName(item, true), assigneeName(item), '未分配')}</dd></div><div><dt>阶段</dt><dd>${transition(item.previousStage, item.stage)}</dd></div><div><dt>状态</dt><dd>${transition(item.previousStatus, item.status)}</dd></div></dl>
  </li>`).join('')}</ol></div>`;
}

function selectOptions(values, emptyLabel) {
  return `<option value="">${escapeHtml(emptyLabel)}</option>${values.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('')}`;
}

export function renderTaskHistoryReport(store = {}) {
  if (!canViewTaskHistoryReport(store)) return '';
  const members = (Array.isArray(store.members) ? store.members : []).filter(member => member?.id).map(member => ({
    id: member.id, label: `${member.displayName || member.username || '未命名成员'}${member.username ? ` (${member.username})` : ''}`
  }));
  return `<section class="task-history-report" data-task-history-report aria-label="任务执行历史">
    <header class="task-history-heading"><h3>任务执行历史</h3><div class="task-history-tools"><button type="button" class="outline-button task-history-icon-button" data-history-refresh title="刷新记录" aria-label="刷新记录">↻</button><button type="button" class="outline-button" data-history-export disabled><span aria-hidden="true">⇩</span> 导出 CSV</button></div></header>
    <form class="task-history-filters" data-history-filters>
      <label>归属人员<select name="userId">${selectOptions(members, '全部人员')}</select></label>
      <label>阶段<select name="stage"><option value="">全部阶段</option></select></label>
      <label>状态<select name="status">${selectOptions(LEGACY_STATUSES.map(value => ({ id: value, label: value })), '全部状态')}</select></label>
      <label>开始日期（北京时间）<input type="date" name="from"></label>
      <label>结束日期（北京时间）<input type="date" name="to"></label>
      <div class="task-history-filter-actions"><button type="submit" class="primary-button">查询</button><button type="reset" class="outline-button">重置</button></div>
    </form>
    <p class="task-history-message" data-history-message role="status" aria-live="polite">正在加载记录…</p>
    <dl class="task-history-summary" data-history-summary></dl>
    <div class="task-history-table-wrap" tabindex="0" aria-label="任务执行历史表格"><table class="task-history-table"><thead><tr><th scope="col">事件时间（北京时间）</th><th scope="col">任务 / 项目</th><th scope="col">操作</th><th scope="col">操作人</th><th scope="col">负责人变更</th><th scope="col">阶段变更</th><th scope="col">状态变更</th></tr></thead><tbody data-history-rows><tr><td colspan="7" class="task-history-empty">正在加载记录…</td></tr></tbody></table></div>
    <footer class="task-history-pagination"><span data-history-count>0 条记录</span><div><button type="button" class="outline-button task-history-icon-button" data-history-prev aria-label="上一页" title="上一页" disabled>←</button><output data-history-page aria-live="polite">第 1 / 1 页</output><button type="button" class="outline-button task-history-icon-button" data-history-next aria-label="下一页" title="下一页" disabled>→</button></div></footer>
  </section>`;
}

function summaryMarkup(summary = {}) {
  return [['eventCount', '操作事件'], ['taskCount', '涉及任务'], ['peopleCount', '参与人员'], ['claimedCount', '认领'], ['transferredCount', '交接'], ['releasedCount', '释放'], ['completedCount', '完成'], ['baselineCount', '迁移快照']].map(([key, label]) => `<div><dt>${label}</dt><dd>${Math.max(0, Number(summary[key]) || 0).toLocaleString('zh-CN')}</dd></div>`).join('');
}

export function mountTaskHistoryReport(host, store, { apiRequest, stages = [] } = {}) {
  const report = host?.matches?.('[data-task-history-report]') ? host : host?.querySelector?.('[data-task-history-report]');
  if (!report || !canViewTaskHistoryReport(store) || !store.apiToken || typeof apiRequest !== 'function') return () => {};
  const token = store.apiToken;
  const userId = String(store.user?.id || store.user?.userId || '');
  const organizationId = String(store.organization?.id || '');
  const form = report.querySelector('[data-history-filters]');
  const message = report.querySelector('[data-history-message]');
  const tbody = report.querySelector('[data-history-rows]');
  const summary = report.querySelector('[data-history-summary]');
  const counter = report.querySelector('[data-history-count]');
  const pageLabel = report.querySelector('[data-history-page]');
  const previous = report.querySelector('[data-history-prev]');
  const next = report.querySelector('[data-history-next]');
  const refresh = report.querySelector('[data-history-refresh]');
  const exportButton = report.querySelector('[data-history-export]');
  const stageOptions = stages.map(stage => typeof stage === 'string' ? { id: stage, label: stage } : stage);
  form.elements.namedItem('stage').innerHTML = selectOptions(stageOptions, '全部阶段');
  const statuses = [...new Set([...LEGACY_STATUSES, ...stageOptions.map(stage => stage.id)])];
  form.elements.namedItem('status').innerHTML = selectOptions(statuses.map(value => ({ id: value, label: value })), '全部状态');
  let disposed = false;
  let loading = false;
  let exporting = false;
  let sequence = 0;
  let total = 0;
  let page = 1;
  let appliedFilters = {};
  let requestController;
  let exportController;
  const listeners = [];
  const active = () => !disposed && report.isConnected && token === store.apiToken
    && userId === String(store.user?.id || store.user?.userId || '')
    && organizationId === String(store.organization?.id || '') && canViewTaskHistoryReport(store);
  function listen(element, event, handler) {
    element.addEventListener(event, handler);
    listeners.push(() => element.removeEventListener(event, handler));
  }
  function setBusy() {
    const busy = loading || exporting;
    report.setAttribute('aria-busy', String(busy));
    for (const control of form.querySelectorAll('input, select, button')) control.disabled = busy;
    refresh.disabled = busy;
    exportButton.disabled = busy || total === 0;
    previous.disabled = busy || page <= 1;
    next.disabled = busy || page * PAGE_SIZE >= total;
  }
  function setMessage(value, error = false) {
    message.textContent = value;
    message.classList.toggle('is-error', error);
    message.setAttribute('role', error ? 'alert' : 'status');
  }
  async function load(requestedPage = 1) {
    if (!active() || exporting) return;
    requestController?.abort();
    requestController = new AbortController();
    const requestId = ++sequence;
    loading = true;
    setBusy();
    setMessage('正在加载记录…');
    try {
      const result = await apiRequest(`/api/stats/task-history?${buildTaskHistoryQuery(appliedFilters, { page: requestedPage })}`, { signal: requestController.signal }, token);
      if (!active() || requestId !== sequence) return;
      if (!result.response?.ok) throw new Error(result.body?.message || '任务历史加载失败，请重试');
      const body = result.body || {};
      const items = Array.isArray(body.records) ? body.records : [];
      total = Math.max(0, Number(body.total) || 0);
      page = Math.max(1, Number(body.page) || requestedPage);
      const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (page > lastPage) { loading = false; return load(lastPage); }
      tbody.innerHTML = items.length ? historyRows(items) : '<tr><td colspan="7" class="task-history-empty">暂无符合条件的执行历史</td></tr>';
      summary.innerHTML = summaryMarkup(body.summary);
      counter.textContent = `${total.toLocaleString('zh-CN')} 条记录`;
      pageLabel.textContent = `第 ${page} / ${lastPage} 页`;
      setMessage(items.length ? '' : '暂无符合条件的执行历史');
    } catch (error) {
      if (!active() || requestId !== sequence || error.name === 'AbortError') return;
      total = 0;
      page = 1;
      tbody.innerHTML = '<tr><td colspan="7" class="task-history-empty">记录加载失败</td></tr>';
      summary.innerHTML = '';
      counter.textContent = '0 条记录';
      pageLabel.textContent = '第 1 / 1 页';
      setMessage(error.message || '任务历史加载失败，请重试', true);
    } finally {
      if (active() && requestId === sequence) { loading = false; setBusy(); }
    }
  }
  function readFilters() {
    return Object.fromEntries(FILTER_KEYS.map(key => [key, String(form.elements.namedItem(key)?.value || '').trim()]));
  }
  listen(form, 'submit', event => {
    event.preventDefault();
    if (!active() || loading || exporting) return;
    const filters = readFilters();
    if (filters.from && filters.to && filters.from > filters.to) {
      setMessage('开始日期不能晚于结束日期', true);
      form.elements.namedItem('from').focus();
      return;
    }
    appliedFilters = filters;
    void load(1);
  });
  listen(form, 'reset', event => {
    event.preventDefault();
    if (!active() || loading || exporting) return;
    for (const key of FILTER_KEYS) form.elements.namedItem(key).value = '';
    appliedFilters = {};
    void load(1);
  });
  listen(refresh, 'click', () => { if (!loading) void load(page); });
  listen(previous, 'click', () => { if (!loading && page > 1) void load(page - 1); });
  listen(next, 'click', () => { if (!loading && page * PAGE_SIZE < total) void load(page + 1); });
  listen(exportButton, 'click', async () => {
    if (!active() || loading || exporting || !total) return;
    exporting = true;
    exportController = new AbortController();
    setBusy();
    setMessage('正在导出记录…');
    try {
      const apiBase = globalThis.location?.pathname.startsWith('/mfggo/') ? '/mfggo-api' : '/api';
      const query = buildTaskHistoryQuery(appliedFilters, { paginate: false });
      const response = await fetch(`${apiBase}/stats/task-history/export.csv${query ? `?${query}` : ''}`, {
        headers: { authorization: `Bearer ${token}` }, signal: exportController.signal
      });
      if (!active()) return;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || '导出失败，请重试');
      }
      const blob = await response.blob();
      if (!active()) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `任务执行历史-${formatTaskHistoryTime(new Date()).slice(0, 10)}.csv`;
      link.hidden = true;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setMessage('CSV 已导出');
    } catch (error) {
      if (active() && error.name !== 'AbortError') setMessage(error.message || '导出失败，请重试', true);
    } finally {
      if (active()) { exporting = false; setBusy(); }
    }
  });
  void load(1);
  return () => {
    disposed = true;
    sequence += 1;
    requestController?.abort();
    exportController?.abort();
    listeners.forEach(remove => remove());
  };
}
