import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

let fixture;
let address;
let previousInitialAdminPassword;
let previousOnlyOfficeStorage;
let previousChatAttachmentStorage;

test.before(async () => {
  previousInitialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  process.env.INITIAL_ADMIN_PASSWORD = 'admin123';
  fixture = { path: await mkdtemp(join(tmpdir(), 'machquote-collaboration-e2e-')) };
  previousOnlyOfficeStorage = process.env.ONLYOFFICE_STORAGE_DIR;
  process.env.ONLYOFFICE_STORAGE_DIR = join(fixture.path, 'office-documents');
  previousChatAttachmentStorage = process.env.CHAT_ATTACHMENT_STORAGE_DIR;
  process.env.CHAT_ATTACHMENT_STORAGE_DIR = join(fixture.path, 'chat-attachments');
  fixture.app = await createApp({ dbPath: join(fixture.path, 'test.sqlite') });
  fixture.server = createServer(fixture.app.callback());
  await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${fixture.server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => fixture.server.close(resolve));
  fixture.app.close();
  await rm(fixture.path, { recursive: true, force: true });
  if (previousInitialAdminPassword === undefined) delete process.env.INITIAL_ADMIN_PASSWORD;
  else process.env.INITIAL_ADMIN_PASSWORD = previousInitialAdminPassword;
  if (previousOnlyOfficeStorage === undefined) delete process.env.ONLYOFFICE_STORAGE_DIR;
  else process.env.ONLYOFFICE_STORAGE_DIR = previousOnlyOfficeStorage;
  if (previousChatAttachmentStorage === undefined) delete process.env.CHAT_ATTACHMENT_STORAGE_DIR;
  else process.env.CHAT_ATTACHMENT_STORAGE_DIR = previousChatAttachmentStorage;
});

async function request(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(`${address}${path}`, {
    ...rest,
    headers: { 'content-type': 'application/json', ...headers }
  });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json() : await response.text();
  return { response, body };
}

async function login(username, password = 'admin123') {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  assert.equal(result.response.status, 200, `登录 ${username} 失败: ${JSON.stringify(result.body)}`);
  return { ...result.body, headers: { authorization: `Bearer ${result.body.token}` } };
}

test('协同主旅程：成员加入项目后完成任务、评论、会话和提醒闭环', async () => {
  const owner = await login('admin');
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const invited = await request('/api/members', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({
      username: `e2e_engineer_${suffix}`,
      displayName: '协同工程师',
      temporaryPassword: 'engineer-pass-123',
      role: 'engineer'
    })
  });
  assert.equal(invited.response.status, 201);
  const engineer = await login(`e2e_engineer_${suffix}`, 'engineer-pass-123');

  const createdProject = await request('/api/projects', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ title: `协同发布验收-${suffix}`, stage: '询盘发布' })
  });
  assert.equal(createdProject.response.status, 201);
  const project = createdProject.body.project;

  const claimedByOwner = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT', headers: owner.headers, body: JSON.stringify({ assigneeUserId: owner.user.id })
  });
  assert.equal(claimedByOwner.response.status, 200);

  const projectMember = await request(`/api/projects/${project.id}/members`, {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ userId: invited.body.member.id, projectRole: 'member' })
  });
  assert.equal(projectMember.response.status, 201);

  const projectRead = await request(`/api/projects/${project.id}`, { headers: engineer.headers });
  assert.equal(projectRead.response.status, 200);
  assert.equal(projectRead.body.project.id, project.id);
  const task = { id: project.rootTaskId };

  // The current responsible person hands off the root task before the invited
  // member can mutate its status and content.
  const handedOff = await request(`/api/tasks/${task.id}`, {
    method: 'PUT',
    headers: owner.headers,
    body: JSON.stringify({ assigneeUserId: engineer.user.id })
  });
  assert.equal(handedOff.response.status, 200);

  const taskUpdate = await request(`/api/tasks/${task.id}`, {
    method: 'PUT',
    headers: engineer.headers,
    body: JSON.stringify({ progress: 60, status: '已排产/处理中', description: '已同步客户最新图纸' })
  });
  assert.equal(taskUpdate.response.status, 200);
  assert.equal(taskUpdate.body.task.progress, 60);

  const taskComment = await request(`/api/tasks/${task.id}/comments`, {
    method: 'POST',
    headers: engineer.headers,
    body: JSON.stringify({ body: '图纸已上传，请负责人复核' })
  });
  assert.equal(taskComment.response.status, 201);
  const projectComment = await request(`/api/projects/${project.id}/comments`, {
    method: 'POST',
    headers: engineer.headers,
    body: JSON.stringify({ body: '项目进入内部协同阶段' })
  });
  assert.equal(projectComment.response.status, 201);

  const conversationCreated = await request('/api/conversations', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ projectId: project.id, title: '图纸确认协同' })
  });
  assert.equal(conversationCreated.response.status, 201);
  const conversation = conversationCreated.body.conversation;

  const attachment = await request('/api/chat-attachments', {
    method: 'POST',
    headers: {
      ...engineer.headers,
      'content-type': 'application/octet-stream',
      'x-conversation-id': conversation.id,
      'x-file-name': encodeURIComponent('customer-revision.step')
    },
    body: Buffer.from('ISO-10303-21; E2E; END-ISO-10303-21;')
  });
  assert.equal(attachment.response.status, 201);

  const message = await request(`/api/conversations/${conversation.id}/messages`, {
    method: 'POST',
    headers: engineer.headers,
    body: JSON.stringify({ body: '@admin 请确认客户图纸版本', attachmentIds: [attachment.body.attachment.id] })
  });
  assert.equal(message.response.status, 201);
  assert.equal(message.body.message.attachments[0].name, 'customer-revision.step');

  const ownerConversations = await request('/api/conversations', { headers: owner.headers });
  const unread = ownerConversations.body.conversations.find(item => item.id === conversation.id);
  assert.equal(unread.unreadCount, 1);
  assert.equal(unread.mentionCount, 1);
  assert.equal(unread.preview, '@admin 请确认客户图纸版本');

  const passiveHistory = await request(`/api/conversations/${conversation.id}/messages`, { headers: owner.headers });
  assert.equal(passiveHistory.body.messages.length, 1);
  const stillUnread = await request('/api/conversations', { headers: owner.headers });
  assert.equal(stillUnread.body.conversations.find(item => item.id === conversation.id).unreadCount, 1);

  const activeHistory = await request(`/api/conversations/${conversation.id}/messages?markRead=true`, { headers: owner.headers });
  assert.equal(activeHistory.body.messages[0].attachments[0].name, 'customer-revision.step');
  const read = await request('/api/conversations', { headers: owner.headers });
  const readSummary = read.body.conversations.find(item => item.id === conversation.id);
  assert.equal(readSummary.unreadCount, 0);
  assert.equal(readSummary.mentionCount, 0);

  const detail = await request(`/api/tasks/${task.id}/detail`, { headers: owner.headers });
  assert.equal(detail.response.status, 200);
  assert.ok(Array.isArray(detail.body.subtasks));
  assert.ok(detail.body.comments.some(item => item.body === '图纸已上传，请负责人复核'));
  assert.ok(detail.body.projectComments.some(item => item.body === '项目进入内部协同阶段'));
  assert.ok(detail.body.activities.some(item => item.action === 'project.create' && item.displayName === 'admin'));
  assert.ok(detail.body.activities.some(item => item.action === 'project.comment.create' && item.metadata?.projectId === project.id));
  const finalProject = await request(`/api/projects/${project.id}`, { headers: owner.headers });
  assert.equal(finalProject.body.project.rootTaskId, task.id);
  assert.equal(finalProject.body.project.status, '已排产/处理中');
  const projectConversations = await request(`/api/conversations?projectId=${encodeURIComponent(project.id)}`, { headers: owner.headers });
  assert.ok(projectConversations.body.conversations.some(item => item.id === conversation.id && item.messageCount === 1));
});

test('项目卡根任务可直接切换执行者，并在刷新和换账号后保持一致', async () => {
  const owner = await login('admin');
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const invited = await request('/api/members', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({
      username: `root_task_worker_${suffix}`,
      displayName: '根任务执行工程师',
      temporaryPassword: 'worker-pass-123',
      role: 'engineer'
    })
  });
  assert.equal(invited.response.status, 201);
  const worker = await login(`root_task_worker_${suffix}`, 'worker-pass-123');

  const created = await request('/api/projects', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ title: `根任务切换验收-${suffix}`, stage: '内部报价' })
  });
  assert.equal(created.response.status, 201);
  const project = created.body.project;
  assert.ok(project.rootTaskId, '新项目必须绑定真实根任务');
  assert.equal(project.ownerUserId, owner.user.id, '项目创建者应保留为项目记录信息');
  assert.equal(project.executorUserId, '', '新项目应先保持未分配，等待参与者认领');

  const ownerTasksBeforeClaim = await request('/api/tasks', { headers: owner.headers });
  assert.ok(!ownerTasksBeforeClaim.body.tasks.some(item => item.id === project.rootTaskId), '未认领的项目根任务不应出现在创建者的我的任务');

  const claimedByOwner = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT', headers: owner.headers, body: JSON.stringify({ assigneeUserId: owner.user.id })
  });
  assert.equal(claimedByOwner.response.status, 200);

  const addedWorker = await request(`/api/projects/${project.id}/members`, {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ userId: invited.body.member.id, projectRole: 'member' })
  });
  assert.equal(addedWorker.response.status, 201);

  // A project member can see the project, but the root task stays out of that
  // member's personal work queue until it is handed off or claimed.
  const workerTasksBeforeClaim = await request('/api/tasks', { headers: worker.headers });
  assert.ok(!workerTasksBeforeClaim.body.tasks.some(item => item.id === project.rootTaskId), '认领前项目根任务不应出现在执行者的我的任务');

  const switched = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT',
    headers: owner.headers,
    body: JSON.stringify({ assigneeUserId: invited.body.member.id })
  });
  assert.equal(switched.response.status, 200);
  assert.equal(switched.body.task.assigneeUserId, invited.body.member.id);
  assert.equal(switched.body.project.ownerUserId, owner.user.id, '改派执行者不能覆盖项目管理者');
  assert.equal(switched.body.project.owner, owner.user.displayName);
  assert.equal(switched.body.project.executorUserId, invited.body.member.id);

  const persisted = await request(`/api/tasks/${project.rootTaskId}/detail`, { headers: owner.headers });
  assert.equal(persisted.response.status, 200);
  assert.equal(persisted.body.task.assigneeUserId, invited.body.member.id);

  const projectMembers = await request(`/api/projects/${project.id}/members`, { headers: owner.headers });
  assert.ok(projectMembers.body.members.some(member => member.id === invited.body.member.id), '被添加的参与者必须保留在项目成员中');
  const workerProjects = await request('/api/projects', { headers: worker.headers });
  assert.ok(workerProjects.body.projects.some(item => item.id === project.id));
  const workerDetail = await request(`/api/tasks/${project.rootTaskId}/detail`, { headers: worker.headers });
  assert.equal(workerDetail.response.status, 200);
  const workerComment = await request(`/api/tasks/${project.rootTaskId}/comments`, {
    method: 'POST', headers: worker.headers, body: JSON.stringify({ body: '已收到项目根任务' })
  });
  assert.equal(workerComment.response.status, 201);

  const ownerTaskList = await request('/api/tasks', { headers: owner.headers });
  assert.ok(!ownerTaskList.body.tasks.some(item => item.id === project.rootTaskId), '未认领给管理员的项目根任务不应出现在管理员的我的任务');
  const workerTaskList = await request('/api/tasks', { headers: worker.headers });
  assert.ok(workerTaskList.body.tasks.some(item => item.id === project.rootTaskId), '认领后的项目根任务应进入执行者的我的任务');
  const standalone = await request('/api/tasks', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ title: project.title, description: '与项目同名的独立任务' })
  });
  assert.equal(standalone.response.status, 201);
  const taskListWithSameTitle = await request('/api/tasks', { headers: owner.headers });
  assert.ok(taskListWithSameTitle.body.tasks.some(item => item.id === standalone.body.task.id), '同名独立任务不能被项目标题过滤掉');
});

test('获授权参与者可管理成员，参与者可查看并认领空根任务', async () => {
  const owner = await login('admin');
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const invited = await Promise.all([
    request('/api/members', {
      method: 'POST',
      headers: owner.headers,
      body: JSON.stringify({ username: `project_manager_${suffix}`, displayName: '已授权成员', temporaryPassword: 'manager-pass-123', role: 'engineer' })
    }),
    request('/api/members', {
      method: 'POST',
      headers: owner.headers,
      body: JSON.stringify({ username: `project_worker_${suffix}`, displayName: '项目成员', temporaryPassword: 'worker-pass-123', role: 'engineer' })
    })
  ]);
  assert.equal(invited[0].response.status, 201);
  assert.equal(invited[1].response.status, 201);
  const manager = await login(`project_manager_${suffix}`, 'manager-pass-123');
  const worker = await login(`project_worker_${suffix}`, 'worker-pass-123');
  const created = await request('/api/projects', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ title: `项目参与者权限验收-${suffix}`, stage: '内部报价' })
  });
  assert.equal(created.response.status, 201);
  const project = created.body.project;
  assert.equal(project.executorUserId, '', '新项目应先保持未分配');

  const claimedByOwner = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT', headers: owner.headers, body: JSON.stringify({ assigneeUserId: owner.user.id })
  });
  assert.equal(claimedByOwner.response.status, 200);

  const managerMembership = await request(`/api/projects/${project.id}/members`, {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ userId: invited[0].body.member.id, projectRole: 'manager' })
  });
  assert.equal(managerMembership.response.status, 201);

  const deniedBeforeGrant = await request(`/api/projects/${project.id}/members`, {
    method: 'POST', headers: manager.headers,
    body: JSON.stringify({ userId: invited[1].body.member.id, projectRole: 'member' })
  });
  assert.equal(deniedBeforeGrant.response.status, 403);
  const grant = await request(`/api/organization/members/${manager.user.id}`, {
    method: 'PUT', headers: owner.headers,
    body: JSON.stringify({ permissions: { 'project.members.manage': true } })
  });
  assert.equal(grant.response.status, 200);
  const addedByManager = await request(`/api/projects/${project.id}/members`, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({ userId: invited[1].body.member.id, projectRole: 'member' })
  });
  assert.equal(addedByManager.response.status, 201);
  assert.equal(addedByManager.body.member.id, invited[1].body.member.id);

  // Release the responsible person's task so the ordinary participant can
  // exercise the explicit self-claim path.
  const released = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT',
    headers: owner.headers,
    body: JSON.stringify({ assigneeUserId: '' })
  });
  assert.equal(released.response.status, 200);

  const workerProjects = await request('/api/projects', { headers: worker.headers });
  assert.ok(workerProjects.body.projects.some(item => item.id === project.id), '新参与者应能看到所属项目');
  const workerDetail = await request(`/api/tasks/${project.rootTaskId}/detail`, { headers: worker.headers });
  assert.equal(workerDetail.response.status, 200);
  assert.equal(workerDetail.body.task.assigneeUserId, '', '认领前根任务执行者应为空');
  const claimed = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT',
    headers: worker.headers,
    body: JSON.stringify({ assigneeUserId: worker.user.id })
  });
  assert.equal(claimed.response.status, 200);
  assert.equal(claimed.body.task.assigneeUserId, worker.user.id);
  assert.equal(claimed.body.project.ownerUserId, owner.user.id, '认领不能改变项目管理者');
});

test('项目卡根任务不依赖制表中心或我的任务模块', async () => {
  const owner = await login('admin');
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const created = await request('/api/projects', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ title: `项目卡模块隔离验收-${suffix}`, stage: '内部报价' })
  });
  assert.equal(created.response.status, 201);
  const project = created.body.project;
  const claimedByOwner = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT', headers: owner.headers, body: JSON.stringify({ assigneeUserId: owner.user.id })
  });
  assert.equal(claimedByOwner.response.status, 200);
  const beforeModules = (await request('/api/me', { headers: owner.headers })).body.modules;

  try {
    const disabled = await request(`/api/platform/organizations/${owner.organization.id}/modules`, {
      method: 'PUT',
      headers: owner.headers,
      body: JSON.stringify({ modules: { ...beforeModules, projects: true, tasks: false, workspace: false } })
    });
    assert.equal(disabled.response.status, 200);

    const projectRead = await request(`/api/projects/${project.id}`, { headers: owner.headers });
    assert.equal(projectRead.response.status, 200, '项目卡读取仅依赖项目管理模块');
    const removedWorkspace = await request(`/api/projects/${project.id}/workspace`, { headers: owner.headers });
    assert.equal(removedWorkspace.response.status, 404, '旧项目工作区接口必须彻底删除');

    const detail = await request(`/api/tasks/${project.rootTaskId}/detail`, { headers: owner.headers });
    assert.equal(detail.response.status, 200, '项目卡必须仍可读取真实根任务');
    const updated = await request(`/api/tasks/${project.rootTaskId}`, {
      method: 'PUT',
      headers: owner.headers,
      body: JSON.stringify({ status: '已排产/处理中', progress: 55 })
    });
    assert.equal(updated.response.status, 200, '项目卡必须仍可修改真实根任务');
    assert.equal(updated.body.project.status, '已排产/处理中');

    const comment = await request(`/api/tasks/${project.rootTaskId}/comments`, {
      method: 'POST',
      headers: owner.headers,
      body: JSON.stringify({ body: '项目卡在独立模块下仍可评论' })
    });
    assert.equal(comment.response.status, 201);

    const standaloneTasks = await request('/api/tasks', { headers: owner.headers });
    assert.equal(standaloneTasks.response.status, 403, '我的任务列表保持按 tasks 模块开关控制');
  } finally {
    await request(`/api/platform/organizations/${owner.organization.id}/modules`, {
      method: 'PUT',
      headers: owner.headers,
      body: JSON.stringify({ modules: beforeModules })
    });
  }
});

test('协同权限边界：未加入项目不可见，加入后按角色写入，模块关闭立即生效', async () => {
  const owner = await login('admin');
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const invited = await request('/api/members', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ username: `e2e_viewer_${suffix}`, displayName: '协同访客', temporaryPassword: 'viewer-pass-123', role: 'viewer' })
  });
  assert.equal(invited.response.status, 201);
  const viewer = await login(`e2e_viewer_${suffix}`, 'viewer-pass-123');
  const project = (await request('/api/projects', {
    method: 'POST', headers: owner.headers,
    body: JSON.stringify({ title: `协同权限验收-${suffix}`, stage: '内部报价' })
  })).body.project;
  const claimedByOwner = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT', headers: owner.headers, body: JSON.stringify({ assigneeUserId: owner.user.id })
  });
  assert.equal(claimedByOwner.response.status, 200);
  const conversation = (await request('/api/conversations', {
    method: 'POST', headers: owner.headers,
    body: JSON.stringify({ projectId: project.id, title: '权限协同频道' })
  })).body.conversation;

  const deniedProject = await request(`/api/projects/${project.id}`, { headers: viewer.headers });
  assert.equal(deniedProject.response.status, 403);
  assert.equal(deniedProject.body.error, 'project_access_denied');
  const deniedMessages = await request(`/api/conversations/${conversation.id}/messages`, { headers: viewer.headers });
  assert.equal(deniedMessages.response.status, 403);
  assert.equal(deniedMessages.body.error, 'project_access_denied');

  const joined = await request(`/api/projects/${project.id}/members`, {
    method: 'POST', headers: owner.headers,
    body: JSON.stringify({ userId: invited.body.member.id, projectRole: 'member' })
  });
  assert.equal(joined.response.status, 201);
  const readable = await request(`/api/projects/${project.id}`, { headers: viewer.headers });
  assert.equal(readable.response.status, 200);
  const released = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT', headers: owner.headers,
    body: JSON.stringify({ assigneeUserId: '' })
  });
  assert.equal(released.response.status, 200);
  const claimed = await request(`/api/tasks/${project.rootTaskId}`, {
    method: 'PUT', headers: viewer.headers,
    body: JSON.stringify({ assigneeUserId: viewer.user.id })
  });
  assert.equal(claimed.response.status, 200, '项目参与者应能认领空执行者');
  assert.equal(claimed.body.task.assigneeUserId, viewer.user.id);
  assert.equal(claimed.body.project.ownerUserId, owner.user.id, '认领不能改变项目管理者');
  assert.equal(claimed.body.project.executorUserId, viewer.user.id);
  const deniedTask = await request('/api/tasks', {
    method: 'POST', headers: viewer.headers,
    body: JSON.stringify({ title: '访客不应创建任务', projectId: project.id })
  });
  assert.equal(deniedTask.response.status, 403);
  assert.equal(deniedTask.body.error, 'permission_denied');
  const employeeMessage = await request(`/api/conversations/${conversation.id}/messages`, {
    method: 'POST', headers: viewer.headers,
    body: JSON.stringify({ body: '员工参与项目沟通' })
  });
  assert.equal(employeeMessage.response.status, 201);

  const beforeModules = (await request('/api/me', { headers: owner.headers })).body.modules;
  try {
    const disabled = await request(`/api/platform/organizations/${owner.organization.id}/modules`, {
      method: 'PUT', headers: owner.headers,
      body: JSON.stringify({ modules: { ...beforeModules, communication: false } })
    });
    assert.equal(disabled.response.status, 200);
    const blocked = await request(`/api/conversations/${conversation.id}/messages`, { headers: owner.headers });
    assert.equal(blocked.response.status, 403);
    assert.equal(blocked.body.error, 'module_disabled');
  } finally {
    await request(`/api/platform/organizations/${owner.organization.id}/modules`, {
      method: 'PUT', headers: owner.headers,
      body: JSON.stringify({ modules: beforeModules })
    });
  }
});
