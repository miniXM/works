import test from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../automation-ui.js';

test('save acknowledgement retains edits made while the request was in flight', () => {
  assert.equal(typeof ui.mergeSavedAutomationDraft, 'function');
  const local = { id: 'draft-1', name: '后续名称', source: '后续编辑', enabled: false, isNew: true };
  const saved = { id: 'saved-1', name: '提交名称', source: '提交内容', enabled: true, revision: 2 };
  const result = ui.mergeSavedAutomationDraft(local, saved);
  assert.equal(result.source, '后续编辑');
  assert.equal(result.name, '后续名称');
  assert.equal(result.enabled, false);
  assert.equal(result.savedSource, '提交内容');
  assert.equal(result.revision, 2);
  assert.equal(result.isNew, false);
});

test('automation editor is owner-only and not exposed in platform mode', () => {
  assert.equal(ui.canManageAutomation({ role: 'owner' }), true);
  assert.equal(ui.canManageAutomation({ role: 'admin' }), false);
  assert.equal(ui.canManageAutomation({ role: 'owner', consoleMode: 'platform' }), false);
});
