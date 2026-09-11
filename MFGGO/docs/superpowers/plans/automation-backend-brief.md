# 中文自动化 Implementation Plan

> For agentic workers: Use subagent-driven-development for the bounded backend task and review. Preserve the existing dirty worktree. Do not commit unrelated work or deploy remotely.

**Goal:** Adopt approved minimal line-by-line Chinese programming UI and connect persistent enterprise automation.

**Architecture:** Shared Chinese statement compiler, tenant-scoped SQLite store/executor and owner-only Koa routes. Frontend owns a separate module mounted in existing enterprise shell. AI proposes Chinese source; the same compiler validates manual and AI edits.

**Tech Stack:** Existing vanilla JS, Vite, Koa, node:sqlite, node:test.

## Global Constraints

- Sidebar label 自动化功能. Enterprise owner only. No permission subtitle, no trial-run button.
- Left event list, center top-to-bottom editable Chinese source, right insertion palette, bottom minimal AI input.
- Independent task creation defaults migrate into enabled persisted rule. Subtasks use a separate default rule. Project roots remain unassigned unless a configured rule assigns them.
- Tenant rules run by position, all matching rules execute. Later assignment overrides earlier. Participants accumulate. A failed rule rolls back its own actions, logs failure and allows the original event and later rules to succeed.
- Collections select existing enterprise members. No real data in example rules. No fake AI replies or arbitrary JavaScript eval.
- Existing manual task permissions remain; configured rules run through controlled system execution with project membership synchronization and history.

## Task 1: backend and shared language

Create automation-language.js, server/automation.js, server/automation-routes.js, tests/automation.test.mjs. Integrate server/db.js and server/app.js only as necessary.

API contract (paths include /api):
GET /automations -> {rules,sets,members,runs,aiConfigured}; rule {id,name,source,enabled,position,revision}; set {id,name,userIds}; runs {id,ruleName,status,message,createdAt}.
POST /automations -> {rule}; body {name,source,enabled}.
PUT /automations/:id -> {rule}; body {name,source,enabled,revision} with optimistic concurrency.
DELETE /automations/:id with revision in body.
PUT /automations/order body {ids} exact permutation.
POST /automation-sets body {name,userIds}; PUT/DELETE /automation-sets/:id.
POST /automations/ai body {request,source} -> {source}; use server env AUTOMATION_AI_BASE_URL, AUTOMATION_AI_API_KEY, AUTOMATION_AI_MODEL; unconfigured returns 503 with Chinese message; no credentials in browser.

Shared exports: AUTOMATION_TEMPLATES array {name,source}; AUTOMATION_PHRASES array {category,items:[{label,source}]}; compileAutomation(source) returns structured program or throws line-specific Chinese error. Backend may adapt internals but keep these frontend exports.

Grammar must be explicit and extensible, include nested 如果/否则/结束判断 and 并且/或者, field comparisons, named collections, random selection, assignment, participants, logs. Reject unsupported statements; never silently skip source. Default source: 当 独立任务 创建时\n将 当前任务的执行者 设为 创建人. Separate subtask default uses 当 子任务 创建时. Allow names for members/sets but reject ambiguity and non-members. Tests cover isolation, owner gate, malformed language, nested conditions, ordering/failure isolation, default disable, status transition once, invalid members and AI error paths.


