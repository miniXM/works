import test from 'node:test';
import assert from 'node:assert/strict';
import { communicationPreferenceKey, taskCommunicationRows, filterTaskCommunications, renderCommunicationList } from '../communication-ui.js';

function fixture() {
  const store = { user: { id: 'me', username: 'admin' }, organization: { id: 'org' }, apiToken: 'a', projects: [{ id: 'p1', title: '法兰项目', rootTaskId: 't1' }, { id: 'p2', title: '支架项目', rootTaskId: 't2' }], tasks: [], conversations: [] };
  const state = { details: { t1: { task: { title: '任务标题' }, comments: [{ userId: 'other', username: '李工', body: '@admin 确认交付', createdAt: '2026-09-07T12:00:00Z' }], projectComments: [] } }, preferences: {}, errors: {}, filter: 'all', query: '', projectId: '' };
  return { store, state };
}

test('communication uses canonical task comments', () => {
  const { store, state } = fixture();
  store.conversations = [{ projectId: 'p1', preview: '独立聊天消息' }];
  const rows = taskCommunicationRows(store, state);
  assert.equal(rows[0].id, 't1'); assert.equal(rows[0].title, '任务标题');
  assert.equal(rows[0].preview, '@admin 确认交付'); assert.equal(rows[0].unread, 1); assert.equal(rows[0].mentions, 1);
  state.preferences.t1 = { readAt: Date.parse('2026-09-07T13:00:00Z') };
  assert.equal(taskCommunicationRows(store, state)[0].unread, 0);
});

test('hidden tasks are excluded from normal filters and recoverable in hidden projects', () => {
  const { store, state } = fixture(); state.preferences.t1 = { hidden: true, pinned: true };
  assert.deepEqual(filterTaskCommunications(taskCommunicationRows(store, state), state).map(row => row.id), ['t2']);
  state.filter = 'hidden';
  assert.deepEqual(filterTaskCommunications(taskCommunicationRows(store, state), state).map(row => row.id), ['t1']);
  state.preferences.t1.hidden = false;
  assert.equal(filterTaskCommunications(taskCommunicationRows(store, state), state).length, 0);
});

test('pinned tasks precede newer tasks with independent later and unread filters', () => {
  const { store, state } = fixture(); state.preferences.t2 = { pinned: true, later: true, forceUnread: true };
  const rows = taskCommunicationRows(store, state);
  assert.deepEqual(filterTaskCommunications(rows, state).map(row => row.id), ['t2', 't1']);
  state.filter = 'later'; assert.deepEqual(filterTaskCommunications(rows, state).map(row => row.id), ['t2']);
  state.filter = 'unread'; assert.equal(filterTaskCommunications(rows, state).length, 2);
  state.filter = 'mentions'; assert.deepEqual(filterTaskCommunications(rows, state).map(row => row.id), ['t1']);
});

test('preferences are isolated and lightweight page has no create or detail panels', () => {
  const { store } = fixture(); const key = communicationPreferenceKey(store);
  assert.notEqual(key, communicationPreferenceKey({ ...store, user: { id: 'someone' } }));
  assert.notEqual(key, communicationPreferenceKey({ ...store, organization: { id: 'another' } }));
  const html = renderCommunicationList(store);
  assert.match(html, /隐藏项目/); assert.match(html, /data-comm-list/);
  assert.doesNotMatch(html, /发起|子任务|关联内容|参与者|communication-detail/);
});

test('project and text filters combine and own comments do not count as unread', () => {
  const { store, state } = fixture(); state.projectId = 'p1'; state.query = '交付';
  assert.equal(filterTaskCommunications(taskCommunicationRows(store, state), state).length, 1);
  state.details.t1.comments[0].userId = 'me';
  assert.equal(taskCommunicationRows(store, state)[0].unread, 0);
  state.query = '不存在'; assert.equal(filterTaskCommunications(taskCommunicationRows(store, state), state).length, 0);
});
