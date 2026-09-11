import { DatabaseSync, backup } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../server/db.js';

const projectDirectory = fileURLToPath(new URL('..', import.meta.url));
const organizationId = 'org_demo';
const setupAction = 'organization.demo.reporting.v1';
const organizationName = 'MFGGO 制造中心';
const profiles = [
  { username: 'admin', displayName: '李老板', jobTitle: '企业负责人', role: 'owner', manager: null },
  { username: 'chen.pm', displayName: '陈建国', jobTitle: '项目主管', role: 'admin', manager: 'admin' },
  { username: 'test.user05', displayName: '赵明辉', jobTitle: '品质主管', role: 'admin', manager: 'admin' },
  { username: 'liu.manager', displayName: '刘志强', jobTitle: '生产主管', role: 'admin', manager: 'admin', canCreate: true },
  { username: 'zhang.gong', displayName: '张伟', jobTitle: '工艺工程师', role: 'member', manager: 'chen.pm' },
  { username: 'li.gong', displayName: '李建军', jobTitle: 'CNC 工程师', role: 'member', manager: 'liu.manager' },
  { username: 'wang.qa', displayName: '王海峰', jobTitle: '质量工程师', role: 'member', manager: 'test.user05' },
  { username: 'test.user01', displayName: '周文博', jobTitle: '设计工程师', role: 'member', manager: 'chen.pm' },
  { username: 'test.user02', displayName: '孙志远', jobTitle: '数控技师', role: 'member', manager: 'liu.manager' },
  { username: 'test.user03', displayName: '吴晓敏', jobTitle: '质量检验员', role: 'member', manager: 'test.user05' },
  { username: 'test.user04', displayName: '郑佳宁', jobTitle: '综合专员', role: 'member', manager: null },
  { username: 'zhou.employee', displayName: '周晨', jobTitle: '生产员工', role: 'member', manager: null, canCreate: true },
  { username: 'lin.employee', displayName: '林晓', jobTitle: '质量检验员', role: 'member', manager: null, canCreate: true }
];

function inspect(db) {
  const organization = db.prepare('SELECT id, name FROM organizations WHERE id = ?').get(organizationId);
  if (!organization) throw new Error('org_demo does not exist; no changes made');
  const marker = db.prepare('SELECT created_at FROM audit_events WHERE organization_id = ? AND action = ? AND entity_id = ? LIMIT 1')
    .get(organizationId, setupAction, organizationId);
  if (marker) return { alreadyApplied: true, appliedAt: marker.created_at, organization };
  const members = db.prepare(`SELECT m.*, u.username, COALESCE(NULLIF(m.display_name_override, ''), u.display_name) AS display_name
    FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ?`).all(organizationId);
  const byUsername = new Map(members.map(member => [member.username, member]));
  for (const profile of profiles) {
    const existing = byUsername.get(profile.username);
    if (!existing && !profile.canCreate) throw new Error(`Required demo account is missing: ${profile.username}`);
    if (!existing && db.prepare('SELECT 1 FROM users WHERE username = ?').get(profile.username)) {
      throw new Error(`Account already exists outside org_demo: ${profile.username}`);
    }
    if (existing && existing.role !== profile.role) throw new Error(`Unexpected existing role for ${profile.username}; review manually`);
  }
  return { alreadyApplied: false, organization, byUsername,
    members: profiles.map(profile => ({ username: profile.username, displayName: profile.displayName, jobTitle: profile.jobTitle,
      role: profile.role, managerUsername: profile.manager, createAccount: !byUsername.has(profile.username),
      preserveDepartmentId: byUsername.get(profile.username)?.department_id || null })) };
}

const publicPlan = plan => plan.alreadyApplied ? { alreadyApplied: true, appliedAt: plan.appliedAt, organization: plan.organization }
  : { alreadyApplied: false, organization: { id: organizationId, previousName: plan.organization.name, name: organizationName }, members: plan.members };

export async function prepareOrganizationDemo({ dbPath = join(projectDirectory, 'data', 'machquote.sqlite'), apply = false,
  outputDirectory = join(projectDirectory, 'tmp') } = {}) {
  const absolutePath = resolve(dbPath);
  const db = new DatabaseSync(absolutePath, { readOnly: !apply });
  let accountFile = null;
  let transactionOpen = false;
  let committed = false;
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
    const initial = inspect(db);
    if (!apply || initial.alreadyApplied) return { applied: false, database: absolutePath, ...publicPlan(initial) };
    const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const backupDirectory = join(dirname(absolutePath), 'backups');
    const backupPath = join(backupDirectory, `machquote-pre-organization-demo-${runId}.sqlite`);
    await mkdir(backupDirectory, { recursive: true });
    await backup(db, backupPath);
    const savedBackup = new DatabaseSync(backupPath, { readOnly: true });
    try {
      if (savedBackup.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity verification failed');
    } finally { savedBackup.close(); }
    db.exec('BEGIN IMMEDIATE');
    transactionOpen = true;
    const plan = inspect(db);
    if (plan.alreadyApplied) {
      db.exec('ROLLBACK');
      transactionOpen = false;
      return { applied: false, database: absolutePath, backupPath, ...publicPlan(plan) };
    }
    const timestamp = new Date().toISOString();
    const ownerId = plan.byUsername.get('admin').user_id;
    const audit = (action, entityType, entityId, metadata) => db.prepare(`INSERT INTO audit_events
      (id, organization_id, user_id, action, entity_type, entity_id, metadata_json, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`audit_${randomUUID()}`, organizationId, ownerId, action, entityType, entityId, JSON.stringify(metadata), timestamp);
    const newAccounts = [];
    const initialPassword = `Mfg1!${randomBytes(20).toString('base64url')}`;
    for (const profile of profiles) {
      if (plan.byUsername.has(profile.username)) continue;
      const userId = `user_${randomUUID()}`;
      db.prepare('INSERT INTO users(id, username, password_hash, display_name, created_at) VALUES(?, ?, ?, ?, ?)')
        .run(userId, profile.username, hashPassword(initialPassword), profile.displayName, timestamp);
      db.prepare(`INSERT INTO memberships(id, organization_id, user_id, role, created_at) VALUES(?, ?, ?, ?, ?)`)
        .run(`membership_${randomUUID()}`, organizationId, userId, profile.role, timestamp);
      plan.byUsername.set(profile.username, { user_id: userId, username: profile.username, role: profile.role,
        display_name: profile.displayName, job_title: '', manager_user_id: null });
      newAccounts.push({ username: profile.username, displayName: profile.displayName, role: profile.role });
      audit('organization.member.demo.create', 'membership', `${organizationId}:${userId}`, { username: profile.username, displayName: profile.displayName, role: profile.role });
    }
    for (const profile of profiles) {
      const existing = plan.byUsername.get(profile.username);
      const managerUserId = profile.manager ? plan.byUsername.get(profile.manager).user_id : null;
      const before = { displayName: existing.display_name, jobTitle: existing.job_title || '', managerUserId: existing.manager_user_id || null, role: existing.role };
      const after = { displayName: profile.displayName, jobTitle: profile.jobTitle, managerUserId, role: profile.role };
      db.prepare(`UPDATE memberships SET display_name_override = ?, job_title = ?, manager_user_id = ? WHERE organization_id = ? AND user_id = ?`)
        .run(profile.displayName, profile.jobTitle, managerUserId, organizationId, existing.user_id);
      db.prepare('UPDATE tasks SET owner_name = ? WHERE organization_id = ? AND assignee_user_id = ?').run(profile.displayName, organizationId, existing.user_id);
      db.prepare('UPDATE projects SET owner_name = ? WHERE organization_id = ? AND owner_user_id = ?').run(profile.displayName, organizationId, existing.user_id);
      audit('organization.member.demo.update', 'membership', `${organizationId}:${existing.user_id}`, { username: profile.username, from: before, to: after });
      if (profile.role === 'admin') {
        const oldGrant = db.prepare(`SELECT enabled, delegated_by_user_id FROM organization_member_permissions
          WHERE organization_id = ? AND user_id = ? AND permission_key = 'member.manage'`).get(organizationId, existing.user_id) || null;
        db.prepare(`INSERT INTO organization_member_permissions(organization_id, user_id, permission_key, enabled, updated_at, delegated_by_user_id)
          VALUES(?, ?, 'member.manage', 1, ?, NULL) ON CONFLICT(organization_id, user_id, permission_key)
          DO UPDATE SET enabled = 1, updated_at = excluded.updated_at, delegated_by_user_id = NULL`).run(organizationId, existing.user_id, timestamp);
        audit('organization.member.demo.grant', 'membership', `${organizationId}:${existing.user_id}`, { permissionKey: 'member.manage', from: oldGrant, to: { enabled: 1, delegated_by_user_id: null } });
      }
    }
    db.prepare('UPDATE organizations SET name = ? WHERE id = ?').run(organizationName, organizationId);
    audit('organization.demo.rename', 'organization', organizationId, { from: plan.organization.name, to: organizationName });
    if (newAccounts.length) {
      await mkdir(outputDirectory, { recursive: true });
      accountFile = resolve(outputDirectory, `organization-demo-accounts-${runId}.json`);
      await writeFile(accountFile, `${JSON.stringify({ organizationId, organizationName, createdAt: timestamp,
        note: '仅以下新账号使用本次初始密码。既有账号密码未变更；首次登录后请修改初始密码。',
        initialPassword, accounts: newAccounts }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    }
    audit(setupAction, 'organization', organizationId, { memberCount: profiles.length, createdUsernames: newAccounts.map(account => account.username), backupPath });
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key verification failed; changes rolled back');
    db.exec('COMMIT');
    transactionOpen = false;
    committed = true;
    return { applied: true, database: absolutePath, backupPath, accountFile, createdUsernames: newAccounts.map(account => account.username), ...publicPlan(plan) };
  } catch (error) {
    if (transactionOpen) db.exec('ROLLBACK');
    if (accountFile && !committed) await rm(accountFile, { force: true });
    throw error;
  } finally { db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let index = 2; index < process.argv.length; index += 1) {
      const argument = process.argv[index];
      if (argument === '--apply') options.apply = true;
      else if (argument === '--db' || argument === '--output-dir') {
        const value = process.argv[++index];
        if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path`);
        options[argument === '--db' ? 'dbPath' : 'outputDirectory'] = value;
      } else throw new Error(`Unknown argument: ${argument}`);
    }
    console.log(JSON.stringify(await prepareOrganizationDemo(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
