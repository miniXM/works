import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../server/db.js';

test('keeps post-read messages unread and ordered when timestamps collide', async () => {
  const originalDate = globalThis.Date;
  const directory = await mkdtemp(join(tmpdir(), 'machquote-chat-state-'));
  let db;
  try {
    globalThis.Date = class FixedDate extends originalDate {
      constructor(...args) { super(...(args.length ? args : ['2026-08-26T00:00:00.000Z'])); }
      static now() { return new originalDate('2026-08-26T00:00:00.000Z').getTime(); }
    };
    db = await createDatabase({ dbPath: join(directory, 'test.sqlite') });
    const teammate = db.createMember({
      organizationId: 'org_demo',
      username: 'chat_state_teammate',
      displayName: '聊天状态协作员',
      password: 'chat-state-pass',
      role: 'engineer'
    });
    const conversation = db.createConversation({ organizationId: 'org_demo', title: '同毫秒未读校验' });

    db.createMessage({ organizationId: 'org_demo', conversationId: conversation.id, userId: teammate.id, body: '已读前消息' });
    db.updateConversationUserState('org_demo', conversation.id, 'user_admin', { read: true });
    db.createMessage({ organizationId: 'org_demo', conversationId: conversation.id, userId: teammate.id, body: '已读后消息' });

    assert.deepEqual(db.listMessages('org_demo', conversation.id).map(message => message.body), ['已读前消息', '已读后消息']);
    const summary = db.listConversations('org_demo', 'user_admin').find(item => item.id === conversation.id);
    assert.equal(summary.preview, '已读后消息');
    assert.equal(summary.unreadCount, 1);
  } finally {
    db?.close();
    globalThis.Date = originalDate;
    await rm(directory, { recursive: true, force: true });
  }
});

test('migrates existing conversation read states before using the message cursor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'machquote-chat-state-migration-'));
  const dbPath = join(directory, 'legacy.sqlite');
  let db;
  try {
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`CREATE TABLE conversation_user_states (
      organization_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_read_at TEXT,
      saved_for_later INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(conversation_id, user_id)
    );`);
    legacyDb.exec(`CREATE TABLE chat_attachments (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      message_id TEXT,
      uploader_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      storage_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);
    legacyDb.close();

    db = await createDatabase({ dbPath });
    const conversation = db.createConversation({ organizationId: 'org_demo', title: '历史状态迁移校验' });
    const state = db.updateConversationUserState('org_demo', conversation.id, 'user_admin', { read: true });
    assert.equal(state.conversationId, conversation.id);
    const attachment = db.createChatAttachment({ organizationId: 'org_demo', userId: 'user_admin', name: 'legacy-migration.step', mimeType: 'model/step', sizeBytes: 1, storageKey: 'legacy-migration.step', pendingConversationId: conversation.id });
    assert.equal(attachment.pendingConversationId, conversation.id);
  } finally {
    db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
