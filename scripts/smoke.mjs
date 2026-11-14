// Smoke tests for the dsh-approval-gate fork.
// Runs without DSH: uses a temporary DSH_HOME so the plugin's top-level
// config initialization cannot touch the real profile.
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-approval-gate-test-'))

const mod = await import('../src/index.mjs')
const plugin = mod.default

assert.equal(plugin.name, 'dsh-moongate', 'plugin name')
assert.equal(typeof plugin.apply, 'function', 'plugin apply function')
assert.ok(Array.isArray(plugin.inject), 'plugin inject list')
for (const service of ['llm', 'approval', 'permissionPresets', 'agentDefaultModel', 'timer', 'webServer']) {
  assert.ok(plugin.inject.includes(service), `inject includes ${service}`)
}

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
assert.ok(client.includes("id: 'dsh-moongate'"), 'client module id matches package name')
for (const marker of ['记住这次操作', '取消记住', '⑦ 规则库', '拒绝计数', '参数：', '自学习', 'Shadow 候选', '行内编辑', '按项目 / 目录']) {
  assert.ok(client.includes(marker), `client bundle contains ${marker}`)
}

// Shadow 模式行为：开启时只记录候选并转人工，不写规则命中；关闭时恢复正常自动放行。
const dataDir = join(process.env.DSH_HOME, 'auto-approve')
const allowlistPath = join(dataDir, 'allowlist.json')
const eventsPath = join(dataDir, 'events.jsonl')
mkdirSync(dataDir, { recursive: true })
const cwd = join(process.env.DSH_HOME, 'project')
mkdirSync(cwd, { recursive: true })
writeFileSync(allowlistPath, JSON.stringify({
  version: 3,
  shadow: true,
  allowRules: [{ mode: 'workspace-write' }]
}), 'utf8')

let flashReply = 'SAFE'
const handlers = new Map()
const routes = new Map()
const ctx = {
  llm: {
    stream: async function* () {
      yield { type: 'text-delta', text: flashReply }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  },
  permissionPresets: { current: () => 'auto-approve' },
  get: () => null,
  on: (name, fn) => { handlers.set(name, fn); return () => {} },
  effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
  timeout: () => new Promise(() => {}),
  webServer: { register: (spec) => { routes.set(spec.path, spec.handler); return () => {} } },
}
plugin.apply(ctx)
const approval = handlers.get('approval/request')
assert.equal(typeof approval, 'function', 'approval handler registered')

// 调规则 API：用最小 req/res 模拟 WebServer，验证行内编辑走真实 HTTP 路径。
const callApi = async (path, method, body) => {
  const handler = routes.get(path)
  assert.equal(typeof handler, 'function', 'route registered: ' + path)
  const req = new EventEmitter()
  req.method = method
  req.url = path
  if (body !== undefined) {
    req.on('data', () => {})
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(body)))
      req.emit('end')
    })
  } else {
    process.nextTick(() => req.emit('end'))
  }
  let status = 0
  let text = ''
  const res = { writeHead: (code) => { status = code }, end: (chunk) => { text = String(chunk || '') } }
  await handler(req, res)
  return { status, text, json: text ? JSON.parse(text) : null }
}

let nextCalls = 0
const nextAllowed = async () => { nextCalls += 1; return 'allowed-once' }
const request = {
  agent: { session: { id: 'shadow-test', cwd } },
  toolName: 'write',
  reason: 'escalate sandbox to workspace-write: write ' + join(cwd, 'note.txt'),
}
const shadowOut = await approval(request, nextAllowed)
assert.equal(shadowOut, 'allowed-once')
assert.equal(nextCalls, 1, 'shadow candidate still asks the human')

const events = readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
const candidate = events.find((ev) => ev.kind === 'shadow-candidate')
assert.ok(candidate, 'shadow candidate recorded')
assert.equal(candidate.wouldPath, 'rule', 'candidate records would-be path')
assert.equal(candidate.cwd, cwd, 'candidate records cwd')
assert.equal(events.filter((ev) => ev.kind === 'auto').length, 0, 'shadow writes no auto event')
const afterShadow = JSON.parse(readFileSync(allowlistPath, 'utf8'))
assert.equal(afterShadow.allowRules[0].hitCount || 0, 0, 'shadow does not touch rule hit count')
const learningPath = join(dataDir, 'learning.json')
const snapsDir = join(dataDir, 'snapshots')
assert.ok(!existsSync(learningPath), 'shadow writes no learning file')
assert.ok(!existsSync(snapsDir) || readdirSync(snapsDir).length === 0, 'shadow writes no snapshots')

writeFileSync(allowlistPath, JSON.stringify(Object.assign({}, afterShadow, { shadow: false })), 'utf8')
nextCalls = 0
const autoOut = await approval(request, nextAllowed)
assert.equal(autoOut, 'allowed-once')
assert.equal(nextCalls, 0, 'normal rule hit auto-allows without human')
const eventsAfter = readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
const last = eventsAfter[eventsAfter.length - 1]
assert.equal(last.kind, 'auto')
assert.equal(last.verdict, 'rule')
assert.equal(last.cwd, cwd, 'auto event records cwd')
assert.equal(JSON.parse(readFileSync(allowlistPath, 'utf8')).allowRules[0].hitCount, 1, 'normal rule hit increments')

// flash-safe 分支：无规则命中、判定 SAFE 时也只记录候选，不自动放行
const readEvents = () => readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
const requestFor = (sid) => ({ ...request, agent: { session: { id: sid, cwd } } })
const autoBeforeFlash = readEvents().filter((ev) => ev.kind === 'auto').length
writeFileSync(allowlistPath, JSON.stringify({ version: 3, shadow: true, allowRules: [] }), 'utf8')
flashReply = 'SAFE'
nextCalls = 0
const flashOut = await approval(requestFor('shadow-flash-test'), nextAllowed)
assert.equal(flashOut, 'allowed-once')
assert.equal(nextCalls, 1, 'flash-safe shadow still asks the human')
const flashEvents = readEvents()
const flashCandidate = flashEvents.filter((ev) => ev.kind === 'shadow-candidate').pop()
assert.equal(flashCandidate.wouldPath, 'flash-safe', 'flash-safe candidate path')
assert.equal(flashCandidate.cwd, cwd, 'flash-safe candidate records cwd')
assert.equal(flashEvents.filter((ev) => ev.kind === 'auto').length, autoBeforeFlash, 'flash-safe shadow writes no auto event')

// learned 分支：命中带 category 的沉淀规则时也只记录候选
writeFileSync(allowlistPath, JSON.stringify({
  version: 3,
  shadow: true,
  allowRules: [{ tool: 'write', mode: 'workspace-write', category: 'neutral', description: 'learned test' }]
}), 'utf8')
flashReply = 'RISKY:neutral'
nextCalls = 0
const learnedOut = await approval(requestFor('shadow-learned-test'), nextAllowed)
assert.equal(learnedOut, 'allowed-once')
assert.equal(nextCalls, 1, 'learned shadow still asks the human')
const learnedEvents = readEvents()
const learnedCandidate = learnedEvents.filter((ev) => ev.kind === 'shadow-candidate').pop()
assert.equal(learnedCandidate.wouldPath, 'learned', 'learned candidate path')
assert.equal(learnedCandidate.cwd, cwd, 'learned candidate records cwd')
assert.equal(learnedEvents.filter((ev) => ev.kind === 'auto').length, autoBeforeFlash, 'learned shadow writes no auto event')
assert.equal(JSON.parse(readFileSync(allowlistPath, 'utf8')).allowRules[0].hitCount || 0, 0, 'learned shadow does not touch hit count')

// 行内编辑：快照带稳定 id；set 可更新描述；危险的 danger-full-access 无条件规则被拒绝。
const rulesRes = await callApi('/api/auto-approve/rules', 'GET')
assert.equal(rulesRes.status, 200)
const editable = rulesRes.json.config.allowRules.find((rule) => rule.id)
assert.ok(editable, 'rules snapshot exposes stable id')
const edited = await callApi('/api/auto-approve/rules', 'POST', {
  op: 'set', kind: 'allowRules', value: { id: editable.id, rule: { description: 'inline edit test' } }
})
assert.equal(edited.status, 200, 'inline rule edit accepted')
assert.equal(edited.json.ok, true)
const unsafe = await callApi('/api/auto-approve/rules', 'POST', {
  op: 'set', kind: 'allowRules', value: { id: editable.id, rule: { mode: 'danger-full-access', tool: '', contains: '' } }
})
assert.equal(unsafe.status, 400, 'unsafe rule edit rejected')
assert.match(unsafe.json.error, /danger-full-access/, 'unsafe edit explains danger-full-access constraint')
const afterEdit = await callApi('/api/auto-approve/rules', 'GET')
assert.equal(afterEdit.json.config.allowRules.find((rule) => rule.id === editable.id).description, 'inline edit test', 'inline edit persisted')

// 项目统计：按 cwd 聚合；历史无 cwd 归入“未知目录”。
appendFileSync(eventsPath, JSON.stringify({ id: 9999, ts: Date.now(), tool: 'old', mode: 'workspace-write', verdict: 'rule', kind: 'auto' }) + '\n')
const projectStats = await callApi('/api/auto-approve/project-stats', 'GET')
assert.equal(projectStats.status, 200, 'project stats endpoint')
assert.ok(projectStats.json.ok, 'project stats ok')
const project = projectStats.json.projects.find((p) => p.path === cwd)
assert.ok(project, 'project stats includes current cwd')
assert.ok(project.auto >= 1, 'project stats counts auto approvals')
assert.ok(project.shadow >= 1, 'project stats counts shadow candidates')
const unknown = projectStats.json.projects.find((p) => !p.path)
assert.ok(unknown && unknown.name === '未知目录', 'project stats groups missing cwd as unknown')

const patchPath = new URL('../patches/dsh-approval-gate@0.5.0.patch', import.meta.url)
assert.ok(existsSync(patchPath), 'fork patch present')
const patch = readFileSync(patchPath, 'utf8')
assert.ok(patch.includes('--- a/src/index.mjs'), 'patch targets host source')
assert.ok(patch.includes('--- a/client.js'), 'patch targets client bundle')

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(pkg.name, 'dsh-moongate', 'package name')
assert.equal(pkg.license, 'MIT', 'license stays MIT')

console.log('smoke: ok')
