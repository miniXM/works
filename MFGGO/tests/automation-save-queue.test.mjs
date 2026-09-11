import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomationAutosaver } from '../automation-save-queue.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const draft = overrides => ({ id: 'one', name: '事件', source: '已保存', enabled: false, revision: 1, savedName: '事件', savedSource: '已保存', savedEnabled: false, ...overrides });
const tick = () => new Promise(resolve => setImmediate(resolve));
const reply = (payload, id = 'one') => ({ ...payload, id, revision: (payload.revision || 0) + 1 });

test('flush serializes in-flight edits and follows new server identity and revision', async t => {
  const first = deferred(), second = deferred(), calls = [], acknowledgements = [];
  const local = draft({ id: 'draft-one', isNew: true, name: ' 初始名称 ', source: '初稿' });
  const queue = createAutomationAutosaver({
    save(d, payload) { calls.push({ id: d.id, isNew: d.isNew, payload }); return calls.length === 1 ? first.promise : second.promise; },
    onSaved(d, saved) { acknowledgements.push({ id: d.id, source: d.source, saved }); },
  });
  t.after(() => queue.dispose());
  const flushing = queue.flush(local);
  await tick();
  assert.equal(calls.length, 1);
  local.name = '最新名称'; local.source = '最新正文'; local.enabled = true;
  queue.schedule(local);
  const flushingAgain = queue.flush(local);
  first.resolve(reply(calls[0].payload, 'server-one'));
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].id, 'server-one');
  assert.equal(calls[1].isNew, false);
  assert.equal(calls[1].payload.revision, 2);
  assert.equal(calls[1].payload.source, '最新正文');
  assert.equal(local.source, '最新正文');
  assert.equal(acknowledgements[0].source, '最新正文');
  second.resolve(reply(calls[1].payload, 'server-one'));
  await Promise.all([flushing, flushingAgain]);
  assert.equal(local.savedSource, '最新正文');
  assert.equal(local.savedName, '最新名称');
  assert.equal(local.savedEnabled, true);
  assert.equal(local.revision, 3);
});

test('different drafts save independently and unchanged drafts bypass validation', async t => {
  const first = deferred(), seen = [];
  const queue = createAutomationAutosaver({ validate(d) { seen.push(d.id); }, save(d, payload) { return d.id === 'one' ? first.promise : Promise.resolve(reply(payload, d.id)); } });
  t.after(() => queue.dispose());
  const a = draft({ source: 'A' }), b = draft({ id: 'two', source: 'B' });
  const aSave = queue.flush(a);
  await queue.flush(b);
  assert.equal(b.savedSource, 'B');
  assert.equal(a.savedSource, '已保存');
  first.resolve(reply({ name: a.name, source: a.source, enabled: a.enabled, revision: 1 }));
  await aSave;
  await queue.flush(a);
  queue.schedule(b);
  assert.deepEqual(seen, ['one', 'two']);
});

test('invalid source is retained, reported, and never sent', async t => {
  const statuses = [];
  let saves = 0;
  const queue = createAutomationAutosaver({ save() { saves++; }, validate() { throw new Error('第 2 行不完整'); }, onState(d, status) { statuses.push(status); } });
  t.after(() => queue.dispose());
  const local = draft({ source: '尚未写完' });
  queue.schedule(local);
  await assert.rejects(queue.flush(local), /第 2 行不完整/);
  assert.equal(saves, 0);
  assert.equal(local.source, '尚未写完');
  assert.equal(local.error, '第 2 行不完整');
  assert.deepEqual(statuses, ['invalid', 'invalid']);
});

test('failed save preserves later text and requires a new explicit schedule or flush', async t => {
  const request = deferred(); let calls = 0;
  const queue = createAutomationAutosaver({ delay: 5, save(d, payload) { calls++; return calls === 1 ? request.promise : Promise.resolve(reply(payload)); } });
  t.after(() => queue.dispose());
  const local = draft({ source: '提交内容' });
  const saving = queue.flush(local);
  await tick();
  local.source = '请求期间的新内容'; queue.schedule(local);
  request.reject(new Error('网络中断'));
  await assert.rejects(saving, /网络中断/);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  assert.equal(local.source, '请求期间的新内容');
  assert.equal(local.savedSource, '已保存');
  assert.equal(local.error, '网络中断');
  queue.schedule(local);
  await queue.flush(local);
  assert.equal(calls, 2);
  assert.equal(local.savedSource, '请求期间的新内容');
});

test('revision conflicts block blind retries until caller resolves the conflict', async t => {
  let calls = 0;
  const failure = Object.assign(new Error('其他用户已修改'), { status: 409 });
  const queue = createAutomationAutosaver({ save(d, payload) { calls++; return calls === 1 ? Promise.reject(failure) : Promise.resolve(reply(payload)); } });
  t.after(() => queue.dispose());
  const local = draft({ source: '本地内容' });
  await assert.rejects(queue.flush(local), /其他用户已修改/);
  assert.equal(local.conflict, true);
  local.source = '更多本地内容'; queue.schedule(local);
  await assert.rejects(queue.flush(local), /其他用户已修改/);
  assert.equal(calls, 1);
  local.conflict = false; local.revision = 8;
  await queue.flush(local);
  assert.equal(calls, 2);
  assert.equal(local.revision, 9);
});

test('dispose cancels pending timers and suppresses follow-up writes while acknowledging an in-flight save', async () => {
  const request = deferred(), acks = []; let calls = 0;
  const queue = createAutomationAutosaver({ delay: 5, save() { calls++; return request.promise; }, onSaved(d, saved) { acks.push(saved.id); } });
  const local = draft({ source: '提交内容' }), other = draft({ id: 'two', source: '不发送' });
  const saving = queue.flush(local);
  await tick();
  local.source = '未提交修改'; queue.schedule(local); queue.schedule(other);
  queue.dispose();
  request.resolve({ id: 'one', name: local.name, source: '提交内容', enabled: false, revision: 2 });
  await saving;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  assert.equal(local.source, '未提交修改');
  assert.equal(local.savedSource, '提交内容');
  assert.equal(local.revision, 2);
  assert.deepEqual(acks, ['one']);
  await queue.flush(other);
  assert.equal(calls, 1);
});

test('cancel and idle wait for only the current write and do not save later invalid edits', async t => {
  const request = deferred(); let calls = 0;
  const queue = createAutomationAutosaver({ save() { calls++; return request.promise; } });
  t.after(() => queue.dispose());
  const local = draft({ source: '有效内容' });
  const saving = queue.flush(local);
  await tick();
  local.source = '未完成内容'; queue.schedule(local); queue.cancel(local);
  const waiting = queue.idle(local);
  request.resolve({ id: 'one', name: local.name, source: '有效内容', enabled: false, revision: 2 });
  await Promise.all([saving, waiting]);
  assert.equal(calls, 1);
  assert.equal(local.source, '未完成内容');
  assert.equal(local.savedSource, '有效内容');
});

test('debounce coalesces changes and normalizes a submitted name only when it is unchanged', async t => {
  const calls = [];
  const queue = createAutomationAutosaver({ delay: 5, save(d, payload) { calls.push(payload); return Promise.resolve(reply(payload)); } });
  t.after(() => queue.dispose());
  const local = draft({ name: '  调整名称  ', source: '第一稿' });
  queue.schedule(local);
  local.source = '第二稿'; queue.schedule(local);
  await new Promise(resolve => setTimeout(resolve, 30));
  await queue.idle(local);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, '第二稿');
  assert.equal(local.name, '调整名称');
  assert.equal(local.error, '');
});

test('acknowledgement does not clear validation errors introduced while saving', async t => {
  const request = deferred(), statuses = [];
  const queue = createAutomationAutosaver({
    save() { return request.promise; },
    validate(d) { if (d.source === '未写完') throw new Error('语句不完整'); },
    onState(d, status) { statuses.push(status); },
  });
  t.after(() => queue.dispose());
  const local = draft({ source: '有效内容' });
  const saving = queue.flush(local);
  await tick();
  local.source = '未写完'; queue.schedule(local);
  request.resolve({ id: 'one', name: local.name, source: '有效内容', enabled: false, revision: 2 });
  await assert.rejects(saving, /语句不完整/);
  assert.equal(local.source, '未写完');
  assert.equal(local.savedSource, '有效内容');
  assert.equal(local.error, '语句不完整');
  assert.equal(statuses.at(-1), 'invalid');
});
