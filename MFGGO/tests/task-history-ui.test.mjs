import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskHistoryQuery, canViewTaskHistoryReport, formatTaskHistoryTime,
  mountTaskHistoryReport, renderTaskHistoryReport, renderTaskHistoryTimeline
} from '../task-history-ui.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const adminStore = () => ({ apiToken: 'test-token', user: { id: 'admin-1', role: 'admin' }, permissions: { 'stats.read': true }, organization: { id: 'org-1' }, members: [] });

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.attributes = new Map();
    this.classes = new Set();
    this.classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.isConnected = true;
  }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  removeEventListener(name, handler) { if (this.listeners.get(name) === handler) this.listeners.delete(name); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  focus() { this.focused = true; }
  fire(name) { return this.listeners.get(name)?.({ preventDefault() {} }); }
}

function reportFixture() {
  const selectors = ['filters', 'message', 'rows', 'summary', 'count', 'page', 'prev', 'next', 'refresh', 'export'];
  const elements = Object.fromEntries(selectors.map(name => [name, new FakeElement()]));
  const fields = Object.fromEntries(['userId', 'stage', 'status', 'from', 'to'].map(name => [name, new FakeElement()]));
  elements.filters.elements = { namedItem: name => fields[name] };
  elements.filters.querySelectorAll = () => Object.values(fields);
  const report = new FakeElement();
  report.matches = selector => selector === '[data-task-history-report]';
  report.querySelector = selector => elements[selector.replace('[data-history-', '').replace(']', '')];
  return { report, elements, fields };
}

function success(items = [], total = items.length, page = 1) {
  return { response: { ok: true }, body: { records: items, total, page, pageSize: 50, summary: { eventCount: total, baselineCount: 1 } } };
}

test('report follows explicit statistics grants, with implicit enterprise primary access', async () => {
  for (const role of ['owner', 'admin', 'member']) {
    const store = { user: { role }, permissions: role === 'owner' ? {} : { 'stats.read': true } };
    assert.equal(canViewTaskHistoryReport(store), true);
    assert.match(renderTaskHistoryReport(store), /data-task-history-report/);
  }
  for (const role of ['engineer', 'qa', 'viewer', 'platform_admin', '']) {
    const store = { ...adminStore(), permissions: {}, user: { id: 'user', role } };
    assert.equal(renderTaskHistoryReport(store), '');
    const { report } = reportFixture();
    let calls = 0;
    const cleanup = mountTaskHistoryReport(report, store, { apiRequest: async () => { calls += 1; return success(); } });
    await tick();
    assert.equal(calls, 0);
    cleanup();
  }
  assert.equal(canViewTaskHistoryReport({ role: 'admin' }), false);
});

test('filter encoding preserves values and export omits pagination', () => {
  const filters = { userId: 'member&status=已完成', stage: '订单发布/待办', status: '进行中', from: '2026-09-01', to: '2026-09-07', token: 'must-not-export' };
  const query = new URLSearchParams(buildTaskHistoryQuery(filters, { page: 2 }));
  assert.equal(query.get('userId'), filters.userId);
  assert.equal(query.get('stage'), filters.stage);
  assert.equal(query.get('status'), filters.status);
  assert.equal(query.get('page'), '2');
  assert.equal(query.get('pageSize'), '50');
  assert.equal(query.has('token'), false);
  const exported = new URLSearchParams(buildTaskHistoryQuery(filters, { paginate: false }));
  assert.equal(exported.has('page'), false);
  assert.equal(exported.has('pageSize'), false);
  assert.equal(exported.get('from'), '2026-09-01');
});

test('event times always render Beijing time and invalid dates remain explicit', () => {
  assert.equal(formatTaskHistoryTime('2026-09-06T16:00:00.000Z'), '2026-09-07 00:00:00');
  assert.equal(formatTaskHistoryTime('2026-09-07T09:23:15+08:00'), '2026-09-07 09:23:15');
  assert.equal(formatTaskHistoryTime('invalid-date'), '时间未知');
  assert.equal(formatTaskHistoryTime(null), '时间未知');
});

test('timeline escapes names and snapshots remain distinct from real operations', () => {
  const markup = renderTaskHistoryTimeline([{
    eventType: 'migration_snapshot', source: 'migration', occurredAt: '2026-09-07T00:00:00Z',
    actorName: '<img src=x onerror=alert(1)>', assigneeName: 'A & "B"', stage: '<b>内部报价</b>', status: '进行中'
  }]);
  assert.match(markup, /迁移快照/);
  assert.match(markup, /原始操作时间未知/);
  assert.match(markup, /事件时间（北京时间）/);
  assert.match(markup, /2026-09-07 08:00:00/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(markup, /A &amp; &quot;B&quot;/);
  assert.doesNotMatch(markup, /<img|<b>内部报价/);
  assert.match(renderTaskHistoryTimeline([]), /暂无执行历史/);
  const report = renderTaskHistoryReport({ ...adminStore(), members: [{ id: '" onfocus="alert(1)', displayName: '<script>attack</script>' }] });
  assert.doesNotMatch(report, /<script>|value="" onfocus=/);
});

test('persisted ledger fields render the same history and report counts', async () => {
  const ledgerItem = {
    title: 'Ledger task', eventType: 'transferred', entityKind: 'subtask',
    previousAssigneeUserId: 'one', previousAssigneeName: '张工', assigneeUserId: 'two', assigneeName: '李工',
    previousStage: '内部报价', stage: '对外报价', previousStatus: '进行中', status: '已完成',
    source: 'live', occurredAt: '2026-09-07T00:00:00Z'
  };
  const markup = renderTaskHistoryTimeline([ledgerItem]);
  assert.match(markup, /交接/);
  assert.match(markup, /张工/);
  assert.match(markup, /李工/);
  assert.match(markup, /内部报价/);
  assert.match(markup, /对外报价/);
  const fixture = reportFixture();
  const cleanup = mountTaskHistoryReport(fixture.report, adminStore(), { apiRequest: async () => ({
    response: { ok: true }, body: { records: [ledgerItem], total: 1, page: 1, pageSize: 50,
      summary: { eventCount: 1, taskCount: 1, transferredCount: 1, baselineCount: 0 } }
  }) });
  await tick();
  assert.match(fixture.elements.rows.innerHTML, /Ledger task/);
  assert.match(fixture.elements.summary.innerHTML, /<dt>交接<\/dt><dd>1<\/dd>/);
  cleanup();
});

test('queries are explicit, date ranges validated, and pagination uses applied filters', async () => {
  const fixture = reportFixture();
  const calls = [];
  const cleanup = mountTaskHistoryReport(fixture.report, adminStore(), {
    stages: [{ id: '内部报价', label: '内部报价' }],
    apiRequest: async (path, options, token) => {
      calls.push({ path, options, token });
      return success([{ eventType: 'claimed', title: '测试任务', actorName: '张工', occurredAt: '2026-09-07T00:00:00Z' }], 51, Number(new URL(path, 'http://example.test').searchParams.get('page')));
    }
  });
  assert.equal(fixture.fields.userId.disabled, true);
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, 'test-token');
  assert.equal(fixture.fields.userId.disabled, false);
  assert.equal(fixture.elements.next.disabled, false);
  fixture.fields.userId.value = 'member-2';
  await tick();
  assert.equal(calls.length, 1);
  fixture.fields.from.value = '2026-09-08';
  fixture.fields.to.value = '2026-09-07';
  fixture.elements.filters.fire('submit');
  assert.equal(calls.length, 1);
  assert.match(fixture.elements.message.textContent, /开始日期不能晚于结束日期/);
  fixture.fields.from.value = '2026-09-01';
  fixture.elements.filters.fire('submit');
  await tick();
  assert.equal(new URL(calls[1].path, 'http://example.test').searchParams.get('userId'), 'member-2');
  fixture.fields.userId.value = 'not-submitted';
  fixture.elements.next.fire('click');
  await tick();
  const nextQuery = new URL(calls[2].path, 'http://example.test').searchParams;
  assert.equal(nextQuery.get('page'), '2');
  assert.equal(nextQuery.get('userId'), 'member-2');
  assert.equal(fixture.elements.next.disabled, true);
  fixture.elements.filters.fire('reset');
  await tick();
  assert.equal(new URL(calls[3].path, 'http://example.test').searchParams.has('userId'), false);
  assert.equal(fixture.fields.userId.value, '');
  cleanup();
});

test('session changes, detached hosts and cleanup discard pending responses', async () => {
  for (const boundary of ['token', 'organization', 'user', 'permission', 'detach', 'cleanup']) {
    const fixture = reportFixture();
    const store = adminStore();
    let resolve;
    let signal;
    const cleanup = mountTaskHistoryReport(fixture.report, store, { apiRequest: (_path, options) => {
      signal = options.signal;
      return new Promise(done => { resolve = done; });
    } });
    if (boundary === 'token') store.apiToken = 'another-token';
    if (boundary === 'organization') store.organization = { id: 'org-2' };
    if (boundary === 'user') store.user.id = 'another-user';
    if (boundary === 'permission') store.permissions['stats.read'] = false;
    if (boundary === 'detach') fixture.report.isConnected = false;
    if (boundary === 'cleanup') cleanup();
    resolve(success([{ title: 'private-history' }]));
    await tick();
    assert.equal(fixture.elements.rows.innerHTML, '', boundary);
    cleanup();
    assert.equal(signal.aborted, true);
    assert.equal(fixture.elements.filters.listeners.size, 0);
  }
});

test('failed requests clear previous rows and allow retry without exporting stale data', async () => {
  const fixture = reportFixture();
  let failing = false;
  const cleanup = mountTaskHistoryReport(fixture.report, adminStore(), { apiRequest: async () => failing
    ? { response: { ok: false }, body: { message: '暂无权限' } }
    : success([{ title: 'visible-before-refresh', eventType: 'completed' }])
  });
  await tick();
  assert.match(fixture.elements.rows.innerHTML, /visible-before-refresh/);
  failing = true;
  fixture.elements.refresh.fire('click');
  await tick();
  assert.doesNotMatch(fixture.elements.rows.innerHTML, /visible-before-refresh/);
  assert.equal(fixture.elements.message.textContent, '暂无权限');
  assert.equal(fixture.elements.export.disabled, true);
  assert.equal(fixture.elements.refresh.disabled, false);
  failing = false;
  fixture.elements.refresh.fire('click');
  await tick();
  assert.match(fixture.elements.rows.innerHTML, /visible-before-refresh/);
  cleanup();
});

test('CSV uses authenticated prefixed endpoint, applied filters, and no page limit', async t => {
  const fixture = reportFixture();
  const fetchCalls = [];
  const clicked = [];
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { pathname: '/mfggo/enterprise.html' } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    body: { appendChild() {} },
    createElement: () => ({ click() { clicked.push(this.download); }, remove() {} })
  } });
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
    if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation); else delete globalThis.location;
  });
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    fetchCalls.push({ path, options });
    return { ok: true, blob: async () => new Blob(['csv-content']) };
  });
  const cleanup = mountTaskHistoryReport(fixture.report, adminStore(), { apiRequest: async () => success([{ title: 'task' }]) });
  t.after(cleanup);
  await tick();
  fixture.fields.userId.value = 'member & 2';
  fixture.elements.filters.fire('submit');
  await tick();
  fixture.fields.userId.value = 'not-submitted';
  await fixture.elements.export.fire('click');
  assert.equal(fetchCalls.length, 1);
  const url = new URL(fetchCalls[0].path, 'http://example.test');
  assert.equal(url.pathname, '/mfggo-api/stats/task-history/export.csv');
  assert.equal(url.searchParams.get('userId'), 'member & 2');
  assert.equal(url.searchParams.has('page'), false);
  assert.equal(url.searchParams.has('pageSize'), false);
  assert.equal(url.searchParams.has('token'), false);
  assert.equal(fetchCalls[0].options.headers.authorization, 'Bearer test-token');
  assert.equal(clicked.length, 1);
  assert.match(clicked[0], /^任务执行历史-\d{4}-\d{2}-\d{2}\.csv$/);
});
