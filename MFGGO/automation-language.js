// This registry is shared by the editor, compiler, and server. New statements
// must have an explicit parser and controlled executor; source is never eval'd.
export const AUTOMATION_EVENTS = Object.freeze({ '独立任务': 'task', '子任务': 'subtask', '项目根任务': 'project' });
export const AUTOMATION_FIELDS = Object.freeze({ '标题': 'title', '状态': 'status', '优先级': 'priority', '阶段': 'stage', '执行者': 'assigneeUserId', '原状态': 'previousStatus' });
export const AUTOMATION_TEMPLATES = [
  { name: '独立任务默认分配', source: '当 独立任务 创建时\n将 当前任务的执行者 设为 创建人' },
  { name: '子任务默认分配', source: '当 子任务 创建时\n将 当前任务的执行者 设为 创建人' },
  { name: '项目节点变更记录', source: '当 项目根任务 状态变化时\n如果 当前任务的状态 等于 「订单结束/已完成」 或者 当前任务的状态 等于 「已完成」\n  记录 「项目节点已完成」\n否则\n  记录 「项目节点已变更」\n结束判断' },
  { name: '按优先级处理', source: '当 独立任务 创建时\n如果 当前任务的优先级 等于 「紧急」\n  将 当前任务的执行者 设为 创建人\n  记录 「紧急任务已分配」\n结束判断' }
];
export const AUTOMATION_PHRASES = [
  { category: '事件', items: Object.keys(AUTOMATION_EVENTS).flatMap(kind => ['创建时', '状态变化时'].map(event => ({ label: `${kind}${event}`, source: `当 ${kind} ${event}` }))) },
  { category: '判断', items: [
    { label: '如果', source: '如果 当前任务的状态 等于 「进行中」\n  记录 「条件满足」\n结束判断' },
    { label: '否则', source: '否则' }, { label: '结束判断', source: '结束判断' },
    { label: '并且', source: '并且 当前任务的优先级 等于 「紧急」' },
    { label: '或者', source: '或者 当前任务的状态 等于 「已完成」' }
    ,{ label: '创建人岗位', source: '如果 创建人的岗位 等于 「业务员」\n  记录 「业务员创建」\n结束判断' }
  ] },
  { category: '分配与参与', items: [
    { label: '分配给创建人', source: '将 当前任务的执行者 设为 创建人' },
    { label: '分配给成员', source: '将 当前任务的执行者 设为 成员「成员名称」' },
    { label: '人员数组随机分配', source: '将 当前任务的执行者 设为 从 人员数组「报价工程师」 随机选择一人' },
    { label: '添加数组成员参与', source: '添加 人员数组「报价工程师」 为 当前任务的参与者' },
    { label: '添加创建人参与', source: '添加 创建人 为 当前任务的参与者' },
    { label: '清空执行者', source: '将 当前任务的执行者 设为 无人' }
  ] },
  { category: '人员数组', items: [
    { label: '定义人员数组', source: '设 人员数组「报价工程师」 为 []' }
  ] },
  { category: '记录', items: [{ label: '记录日志', source: '记录 「说明文字」' }] }
];

export class AutomationSyntaxError extends Error {
  constructor(line, message) { super(`第 ${line} 行：${message}`); this.name = 'AutomationSyntaxError'; this.line = line; this.status = 400; this.code = 'automation_syntax_error'; }
}
const fail = (line, message) => { throw new AutomationSyntaxError(line, message); };
const quoted = value => {
  const match = /^(?:「([^「」\r\n]*)」|"([^"\r\n]*)")$/.exec(value.trim());
  return match ? match[1] ?? match[2] : null;
};
function recipient(text, line, allowSet = false) {
  if (text === '创建人') return { type: 'creator' };
  if (text === '无人' && !allowSet) return { type: 'none' };
  let match = /^成员\s*(.+)$/.exec(text);
  if (match && quoted(match[1])) return { type: 'member', name: quoted(match[1]) };
  match = /^从\s+集合\s*(.+)\s+随机选择一人$/.exec(text);
  if (match && quoted(match[1])) return { type: 'random', name: quoted(match[1]) };
  match = /^从\s+人员数组\s*(.+)\s+随机选择一人$/.exec(text);
  if (match && quoted(match[1])) return { type: 'random_array', name: quoted(match[1]) };
  match = /^人员数组\s*(.+)$/.exec(text);
  if (allowSet && match && quoted(match[1])) return { type: 'array', name: quoted(match[1]) };
  match = /^集合\s*(.+)$/.exec(text);
  if (allowSet && match && quoted(match[1])) return { type: 'set', name: quoted(match[1]) };
  fail(line, '请选择创建人、成员「账号」或从 人员数组「名称」 随机选择一人');
}
function personnelArray(match, line) {
  const name = quoted(match[1]);
  if (!name || name.trim() !== name || name.length > 100) fail(line, '人员数组名称须为 1 至 100 字符，放在「」内');
  const text = match[2].trim(), members = [];
  if (text) {
    let index = 0;
    while (index < text.length) {
      const member = /^成员\s*(?:「([^「」\r\n]+)」|"([^"\r\n]+)")\s*/.exec(text.slice(index));
      if (!member) fail(line, '人员数组应为 [成员「账号」, 成员「账号」]，也可以是 []');
      members.push({ type: 'member', name: member[1] ?? member[2] });
      index += member[0].length;
      if (index === text.length) break;
      if (![',', '，'].includes(text[index])) fail(line, '人员数组的成员之间请用逗号分隔');
      index++;
      while (/\s/.test(text[index] || '') && index < text.length) index++;
      if (index === text.length) fail(line, '人员数组末尾不能有多余的逗号');
    }
  }
  if (members.length > 500) fail(line, '人员数组最多 500 名成员');
  return { name, members };
}
// Boolean separators inside quoted text are literal. 并且 binds more tightly.
function condition(text, line) {
  const parts = []; let start = 0, quote = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '「' || char === '"') { quote = char === '「' ? '」' : '"'; continue; }
    const op = text.slice(index, index + 2);
    if (op === '并且' || op === '或者') { parts.push(text.slice(start, index).trim(), op); start = index + 2; index++; }
  }
  if (quote) fail(line, '引号未闭合');
  parts.push(text.slice(start).trim());
  const groups = [[]];
  for (let index = 0; index < parts.length; index++) {
    if (parts[index] === '或者') { groups.push([]); continue; }
    if (parts[index] === '并且') continue;
    const match = /^(当前任务|创建人)的(标题|状态|优先级|阶段|执行者|原状态|姓名|账号|岗位|部门)\s+(不等于|等于|不包含|包含)\s+(.+)$/.exec(parts[index]);
    const fields = match?.[1] === '创建人' ? { 姓名: 'displayName', 账号: 'username', 岗位: 'jobTitle', 部门: 'department' } : AUTOMATION_FIELDS;
    if (!match || !fields[match[2]] || quoted(match[4]) === null) fail(line, '判断格式应为 当前任务／创建人的字段 等于／不等于／包含／不包含 「值」');
    groups.at(-1).push({ subject: match[1] === '创建人' ? 'creator' : 'task', field: fields[match[2]], operator: match[3], value: quoted(match[4]) });
  }
  return { type: 'or', groups };
}
export const AUTOMATION_STATEMENTS = Object.freeze([
  { type: 'declare_array', pattern: /^设\s+人员数组\s*(.+?)\s+为\s+\[([^\r\n]*)\]$/, parse: personnelArray },
  { type: 'assign', pattern: /^将\s+当前任务的执行者\s+设为\s+(.+)$/, parse: (match, line) => ({ recipient: recipient(match[1], line) }) },
  { type: 'participants', pattern: /^添加\s+(.+)\s+为\s+当前任务的参与者$/, parse: (match, line) => ({ recipient: recipient(match[1], line, true) }) },
  { type: 'log', pattern: /^记录\s+(.+)$/, parse: (match, line) => { const message = quoted(match[1]); if (message === null) fail(line, '日志文字必须放在「」内'); return { message }; } }
]);
export function compileAutomation(source) {
  if (typeof source !== 'string' || !source.trim() || source.length > 20000) fail(1, '规则内容不能为空且不能超过 20000 字符');
  const lines = source.split(/\r?\n/).map((text, index) => ({ text: text.trim(), line: index + 1 })).filter(item => item.text);
  if (lines.length > 300) fail(301, '规则最多 300 行');
  const event = /^当\s+(独立任务|子任务|项目根任务)\s+(创建时|状态变化时)$/.exec(lines[0].text);
  if (!event) fail(lines[0].line, '首行应为 当 独立任务／子任务／项目根任务 创建时／状态变化时');
  const program = { version: 1, event: { kind: AUTOMATION_EVENTS[event[1]], type: event[2] === '创建时' ? 'created' : 'status_changed' }, body: [] };
  const stack = [{ body: program.body }];
  const arrays = new Set();
  for (const { text, line } of lines.slice(1)) {
    const current = stack.at(-1);
    if (text.startsWith('如果 ')) {
      if (stack.length > 16) fail(line, '判断嵌套最多 16 层');
      const node = { type: 'if', line, condition: condition(text.slice(3), line), then: [], else: [] };
      current.body.push(node); stack.push({ node, body: node.then, conditionSource: text.slice(3) }); continue;
    }
    if (/^(并且|或者)\s/.test(text)) {
      if (!current.node || current.inElse || current.body.length) fail(line, '并且／或者必须紧接如果条件，放在执行语句之前');
      current.conditionSource += ` ${text}`;
      current.node.condition = condition(current.conditionSource, line); continue;
    }
    if (text === '否则') {
      if (!current.node || current.inElse) fail(line, '否则必须对应一个尚未使用否则的如果');
      current.inElse = true; current.body = current.node.else; continue;
    }
    if (text === '结束判断') { if (stack.length === 1) fail(line, '没有对应的如果'); stack.pop(); continue; }
    let found = false;
    for (const statement of AUTOMATION_STATEMENTS) {
      const match = statement.pattern.exec(text);
      if (!match) continue;
      const node = { type: statement.type, line, ...statement.parse(match, line) };
      if (node.type === 'declare_array') {
        if (stack.length !== 1) fail(line, '人员数组须在判断之外定义，供本事件的后续语句使用');
        if (arrays.has(node.name)) fail(line, `人员数组「${node.name}」已经定义，请修改原定义`);
        arrays.add(node.name);
      }
      if (['array', 'random_array'].includes(node.recipient?.type) && !arrays.has(node.recipient.name)) fail(line, `请先定义人员数组「${node.recipient.name}」`);
      current.body.push(node); found = true; break;
    }
    if (!found) fail(line, '不支持此语句，请使用右侧语句或修改为受支持的中文语法');
  }
  if (stack.length > 1) fail(stack.at(-1).node.line, '如果缺少结束判断');
  if (!program.body.length) fail(lines[0].line, '事件后至少需要一条操作或判断');
  return program;
}
