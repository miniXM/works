export const ENTERPRISE_ROLE_LABELS = Object.freeze({ owner: '企业主管理', admin: '企业副管理', member: '员工' });

export const ENTERPRISE_BASE_PERMISSIONS = Object.freeze([
  'project.read', 'task.read', 'task.write', 'communication.read', 'communication.write',
  'chat.read', 'chat.write', 'member.read'
]);

export const ENTERPRISE_PERMISSION_DEFINITIONS = Object.freeze([
  { key: 'project.create', label: '新建项目', group: '项目与任务' },
  { key: 'project.write', label: '管理项目资料', group: '项目与任务' },
  { key: 'project.delete', label: '回收和恢复项目任务', group: '项目与任务' },
  { key: 'project.members.manage', label: '管理项目参与者', group: '项目与任务' },
  { key: 'task.create', label: '新建独立任务', group: '项目与任务' },
  { key: 'task.delete', label: '删除独立任务和子任务', group: '项目与任务' },
  { key: 'customer.read', label: '查看客户信息', group: '业务资料' },
  { key: 'project.list.read', label: '查看项目清单', group: '业务资料' },
  { key: 'project.list.write', label: '新增和编辑项目清单', group: '业务资料' },
  { key: 'part.read', label: '查看零件', group: '业务资料' },
  { key: 'part.write', label: '维护零件', group: '业务资料' },
  { key: 'quote.read', label: '查看报价', group: '业务资料' },
  { key: 'quote.write', label: '维护报价', group: '业务资料' },
  { key: 'fair.read', label: '查看质检', group: '业务资料' },
  { key: 'fair.write', label: '维护质检', group: '业务资料' },
  { key: 'document.read', label: '查看制表文档', group: '业务资料' },
  { key: 'document.write', label: '维护制表文档', group: '业务资料' },
  { key: 'storage.enterprise.delete', label: '删除企业公共文件', group: '业务资料' },
  { key: 'stats.read', label: '查看企业统计', group: '管理信息' },
  { key: 'audit.read', label: '查看企业审计', group: '管理信息' },
  { key: 'member.manage', label: '管理员工资料和账号', group: '组织管理', managementOnly: true },
  { key: 'department.manage', label: '管理部门', group: '组织管理', managementOnly: true }
].map(item => Object.freeze(item)));

export const LEGACY_ROLE_PERMISSIONS = Object.freeze({
  engineer: ['project.create', 'project.write', 'part.read', 'part.write', 'quote.read', 'quote.write', 'fair.read', 'task.create', 'document.read', 'document.write'],
  qa: ['part.read', 'fair.read', 'fair.write', 'document.read'],
  viewer: ['part.read', 'quote.read', 'fair.read', 'document.read'],
  admin: ['project.create', 'project.write', 'part.read', 'part.write', 'quote.read', 'quote.write', 'fair.read', 'fair.write', 'task.create', 'document.read', 'document.write', 'stats.read', 'audit.read', 'storage.enterprise.delete']
});

export function canonicalEnterpriseRole(role) {
  return ['engineer', 'qa', 'viewer'].includes(role) ? 'member' : role;
}

export function enterpriseCan(session = {}, permission) {
  const role = canonicalEnterpriseRole(session.role);
  if (!['owner', 'admin', 'member'].includes(role)) return false;
  if (role === 'owner') return true;
  if (ENTERPRISE_BASE_PERMISSIONS.includes(permission)) return true;
  return session.permissions?.[permission] === true;
}

export const PLATFORM_ROLE_LABELS = Object.freeze({ owner: '平台主管理', admin: '平台副管理' });
export const PLATFORM_PERMISSION_DEFINITIONS = Object.freeze([
  { key: 'organization.read', label: '查看企业' },
  { key: 'organization.create', label: '创建企业并指定主管理' },
  { key: 'organization.modules.manage', label: '配置企业功能' },
  { key: 'organization.owner.manage', label: '任命企业主管理' },
  { key: 'user.read', label: '查看平台用户' },
  { key: 'audit.read', label: '查看平台审计' }
].map(item => Object.freeze(item)));

export function platformCan(access = {}, permission) {
  return access.role === 'owner' || access.permissions?.[permission] === true;
}
