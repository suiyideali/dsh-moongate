// Smoke tests for the dsh-approval-gate fork.
// Runs without DSH: uses a temporary DSH_HOME so the plugin's top-level
// config initialization cannot touch the real profile.
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

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
for (const marker of ['记住这次操作', '取消记住', '⑦ 规则库', '拒绝计数', '参数：', '自学习', 'Shadow 候选']) {
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

const handlers = new Map()
const ctx = {
  llm: {},
  permissionPresets: { current: () => 'auto-approve' },
  get: () => null,
  on: (name, fn) => { handlers.set(name, fn); return () => {} },
  effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
  timeout: () => new Promise(() => {}),
  webServer: { register: () => () => {} },
}
plugin.apply(ctx)
const approval = handlers.get('approval/request')
assert.equal(typeof approval, 'function', 'approval handler registered')

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

const patchPath = new URL('../patches/dsh-approval-gate@0.5.0.patch', import.meta.url)
assert.ok(existsSync(patchPath), 'fork patch present')
const patch = readFileSync(patchPath, 'utf8')
assert.ok(patch.includes('--- a/src/index.mjs'), 'patch targets host source')
assert.ok(patch.includes('--- a/client.js'), 'patch targets client bundle')

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(pkg.name, 'dsh-moongate', 'package name')
assert.equal(pkg.license, 'MIT', 'license stays MIT')

console.log('smoke: ok')
