// Smoke tests for the dsh-approval-gate fork.
// Runs without DSH: uses a temporary DSH_HOME so the plugin's top-level
// config initialization cannot touch the real profile.
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, appendFileSync, symlinkSync } from 'node:fs'
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
assert.ok(client.includes('function T(zh, en)'), 'client has i18n helper')
for (const marker of ['记住这次操作', '取消记住', '⑦ 规则库', '拒绝计数', '参数：', '自学习', 'Shadow 候选', '行内编辑', '按项目 / 目录', 'Approval audit', '只读命令', '项目信任']) {
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
let flashQueue = []
let lastPrompt = ''
const handlers = new Map()
const routes = new Map()
const ctx = {
  llm: {
    stream: async function* (req) {
      lastPrompt = String(req && req.messages && req.messages[0] && req.messages[0].content && req.messages[0].content[0] && req.messages[0].content[0].text || '')
      const text = flashQueue.length ? flashQueue.shift() : flashReply
      yield { type: 'text-delta', text }
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
const expectManualBash = async (sid, callId, command, label) => {
  feedToolCall(sid, callId, command)
  nextCalls = 0
  const out = await approval(bashRequest(sid, callId, command), nextAllowed)
  assert.equal(out, 'allowed-once')
  assert.equal(nextCalls, 1, label)
}
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

// 语义近似复用：一次人工批准后，同类操作由 Flash SAME 放行；DIFFERENT 仍转人工；不沉淀规则。
writeFileSync(allowlistPath, JSON.stringify({
  version: 3,
  semanticReuse: true,
  riskyThreshold: 3,
  allowRules: []
}), 'utf8')
const semanticRequest = (sid, file) => ({
  ...request,
  agent: { session: { id: sid, cwd } },
  reason: 'escalate sandbox to workspace-write: write ' + join(cwd, file),
})
flashQueue = ['RISKY:neutral', 'RISKY:neutral', 'SAME', 'RISKY:neutral', 'DIFFERENT']
nextCalls = 0
const firstOut = await approval(semanticRequest('semantic-1', 'alpha.txt'), nextAllowed)
assert.equal(firstOut, 'allowed-once')
assert.equal(nextCalls, 1, 'first neutral request asks the human once')
const learningAfterFirst = JSON.parse(readFileSync(learningPath, 'utf8'))
const neutralKey = 'write|workspace-write|neutral'
assert.equal(learningAfterFirst.stats[neutralKey], 1, 'first approval records one neutral sample')
assert.equal((learningAfterFirst.history[neutralKey] || []).length, 1, 'one sample is stored')

nextCalls = 0
const secondOut = await approval(semanticRequest('semantic-2', 'beta.txt'), nextAllowed)
assert.equal(secondOut, 'allowed-once')
assert.equal(nextCalls, 0, 'semantic SAME auto-allows without human')
const semanticEvents = readEvents()
const semanticAuto = semanticEvents.filter((ev) => ev.kind === 'auto' && ev.path === 'semantic').pop()
assert.ok(semanticAuto, 'semantic auto event recorded')
assert.equal(semanticAuto.verdict, 'flash-same')
assert.equal(JSON.parse(readFileSync(allowlistPath, 'utf8')).allowRules.length, 0, 'semantic reuse does not sediment a rule')
assert.equal(JSON.parse(readFileSync(learningPath, 'utf8')).stats[neutralKey], 1, 'semantic reuse keeps the one-sample count')

nextCalls = 0
const thirdOut = await approval(semanticRequest('semantic-3', 'gamma.txt'), nextAllowed)
assert.equal(thirdOut, 'allowed-once')
assert.equal(nextCalls, 1, 'semantic DIFFERENT falls back to human')

// Shadow 下的语义复用：只记录 wouldPath=semantic 候选，仍转人工。
writeFileSync(allowlistPath, JSON.stringify({
  version: 3,
  semanticReuse: true,
  shadow: true,
  riskyThreshold: 3,
  allowRules: []
}), 'utf8')
flashQueue = ['RISKY:neutral', 'SAME']
nextCalls = 0
const semanticShadowOut = await approval(semanticRequest('semantic-shadow', 'delta.txt'), nextAllowed)
assert.equal(semanticShadowOut, 'allowed-once')
assert.equal(nextCalls, 1, 'semantic shadow still asks the human')
const semanticShadowEvents = readEvents()
const semanticShadowCandidate = semanticShadowEvents.filter((ev) => ev.kind === 'shadow-candidate' && ev.wouldPath === 'semantic').pop()
assert.ok(semanticShadowCandidate, 'semantic shadow candidate recorded')
assert.equal(semanticShadowCandidate.cwd, cwd)

// 命令意图学习：npm test 与 npm publish 共享 tool/mode/category，但真实参数不同。
// 只有安全命令（npm test）进入命令 key；npm publish 不应复用它的学习结果。
const sessionEvent = handlers.get('session/event')
assert.equal(typeof sessionEvent, 'function', 'session/event handler registered')
const bashRequest = (sid, callId, command) => ({
  agent: { session: { id: sid, cwd } },
  toolName: 'bash',
  reason: 'escalate sandbox to workspace-write: ' + command,
  callId,
})
const feedToolCall = (sid, callId, command) => sessionEvent(
  { id: sid },
  { type: 'tool/call', data: { callId, name: 'bash', arguments: JSON.stringify({ command }) } }
)
const feedToolCallTool = (sid, callId, name, args) => sessionEvent(
  { id: sid },
  { type: 'tool/call', data: { callId, name, arguments: JSON.stringify(args) } }
)

// 只读符号链接：软链指向 cwd 外时必须转人工。
const readonlyOutside = join(process.env.DSH_HOME, 'readonly-outside.txt')
writeFileSync(readonlyOutside, 'secret\n', 'utf8')
const readonlyLinkFile = join(cwd, 'link-read.txt')
if (!existsSync(readonlyLinkFile)) symlinkSync(readonlyOutside, readonlyLinkFile)
const readonlyLinkDir = join(cwd, 'link-dir')
if (!existsSync(readonlyLinkDir)) symlinkSync(process.env.DSH_HOME, readonlyLinkDir)
const readonlySubDir = join(cwd, 'real-sub')
mkdirSync(readonlySubDir, { recursive: true })
const readonlySubLink = join(cwd, 'sub-link')
if (!existsSync(readonlySubLink)) symlinkSync(readonlySubDir, readonlySubLink)

// 只读快速路径：git status 这类严格只读命令首次安装即可自动放行；sed -i / 越界路径仍转人工。
writeFileSync(allowlistPath, JSON.stringify({
  version: 3,
  riskyThreshold: 1,
  semanticReuse: false,
  shadow: false,
  sessionMemory: false,
  allowRules: []
}), 'utf8')
flashReply = 'RISKY:neutral'
nextCalls = 0
feedToolCall('readonly-test', 'call-readonly-1', 'git status --short')
const readonlyOut = await approval(bashRequest('readonly-test', 'call-readonly-1', 'git status --short'), nextAllowed)
assert.equal(readonlyOut, 'allowed-once')
assert.equal(nextCalls, 0, 'strict read-only command auto-allows without human')
const readonlyAuto = readEvents().filter((ev) => ev.kind === 'auto' && ev.path === 'readonly').pop()
assert.ok(readonlyAuto, 'read-only auto event recorded')
assert.equal(readonlyAuto.verdict, 'readonly')
assert.equal(readonlyAuto.cwd, cwd)
assert.deepEqual(readonlyAuto.files, [], 'read-only event does not snapshot files')

// 显式永久人工规则优先于只读快速路径。
writeFileSync(allowlistPath, JSON.stringify({
  version: 3,
  shadow: false,
  denyRules: [{ tool: 'bash', category: 'neutral', commandPattern: 'git status' }],
  allowRules: []
}), 'utf8')
nextCalls = 0
feedToolCall('readonly-test', 'call-readonly-deny', 'git status --short')
const readonlyDenyOut = await approval(bashRequest('readonly-test', 'call-readonly-deny', 'git status --short'), nextAllowed)
assert.equal(readonlyDenyOut, 'allowed-once')
assert.equal(nextCalls, 1, 'explicit deny rule beats read-only fast path')

writeFileSync(allowlistPath, JSON.stringify({
  version: 3,
  shadow: false,
  allowRules: []
}), 'utf8')
nextCalls = 0
feedToolCall('readonly-test', 'call-readonly-2', 'sed -i s/a/b/ note.txt')
const sedOut = await approval(bashRequest('readonly-test', 'call-readonly-2', 'sed -i s/a/b/ note.txt'), nextAllowed)
assert.equal(sedOut, 'allowed-once')
assert.equal(nextCalls, 1, 'sed -i is not read-only and asks human')

nextCalls = 0
feedToolCall('readonly-test', 'call-readonly-3', 'cat /etc/passwd')
const outsideOut = await approval(bashRequest('readonly-test', 'call-readonly-3', 'cat /etc/passwd'), nextAllowed)
assert.equal(outsideOut, 'allowed-once')
assert.equal(nextCalls, 1, 'read outside cwd asks human')

nextCalls = 0
feedToolCall('readonly-test', 'call-readonly-4', 'ls ..')
const parentOut = await approval(bashRequest('readonly-test', 'call-readonly-4', 'ls ..'), nextAllowed)
assert.equal(parentOut, 'allowed-once')
assert.equal(nextCalls, 1, 'parent directory listing asks human')

nextCalls = 0
feedToolCall('readonly-test', 'call-readonly-5', 'cat $HOME/.ssh/id_rsa')
const varOut = await approval(bashRequest('readonly-test', 'call-readonly-5', 'cat $HOME/.ssh/id_rsa'), nextAllowed)
assert.equal(varOut, 'allowed-once')
assert.equal(nextCalls, 1, 'shell variable expansion asks human')

// 只读解析器绕过：执行外部程序 / 原地写 / 外部 config；都必须转人工。
await expectManualBash('readonly-test', 'call-readonly-pre', 'rg --pre=/tmp/evil foo', 'rg --pre must ask human')
await expectManualBash('readonly-test', 'call-readonly-pager', 'git grep -O --open-files-in-pager="touch /tmp/x" foo', 'git grep pager must ask human')
await expectManualBash('readonly-test', 'call-readonly-sort', 'sort --compress-program=/tmp/evil f', 'sort compress-program must ask human')
await expectManualBash('readonly-test', 'call-readonly-sed', 'sed -ni s/a/b/ f', 'combined sed -ni must ask human')
await expectManualBash('readonly-test', 'call-readonly-cfg', 'git config -e', 'git config -e must ask human')
await expectManualBash('readonly-test', 'call-readonly-remote', 'git remote set-branches origin main', 'git remote set-branches must ask human')
await expectManualBash('readonly-test', 'call-readonly-upstream', 'git branch --set-upstream-to=origin/main', 'git branch set-upstream must ask human')
await expectManualBash('readonly-test', 'call-readonly-upstreamabbr', 'git branch --set-upstream-t=origin/main', 'git branch set-upstream abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-unsetup', 'git branch --unset-up', 'git branch unset-upstream abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-editd', 'git branch --edit-d', 'git branch edit-description abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-cd', 'cd /etc && cat passwd', 'cd outside session cwd must ask human')
await expectManualBash('readonly-test', 'call-readonly-gitO', "git grep -O'touch /tmp/x' needle", 'git grep attached -O must ask human')
await expectManualBash('readonly-test', 'call-readonly-gitnO', "git grep -nO'touch /tmp/x' needle", 'git grep combined -O must ask human')
await expectManualBash('readonly-test', 'call-readonly-gitopen', "git grep --open='touch /tmp/x' needle", 'git grep --open abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-gitopenf', "git grep --open-files='touch /tmp/x' needle", 'git grep --open-files abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-gitop', "git grep --op='touch /tmp/x' needle", 'git grep shortest --op abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-gitope', "git grep --ope='touch /tmp/x' needle", 'git grep shortest --ope abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-sedf', 'sed -n -f x.pat note.txt', 'sed -f script file must ask human')
await expectManualBash('readonly-test', 'call-readonly-sedfile', 'sed -n --file=x.pat note.txt', 'sed --file script must ask human')
await expectManualBash('readonly-test', 'call-readonly-sedinp', 'sed -n --in-p=s/a/b/ note.txt', 'sed --in-p abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-sedexp', "sed -n --exp='s/a/b/w out' note.txt", 'sed --exp abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-sedi1', 'sed -n --i=s/a/b/ note.txt', 'sed shortest --i abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-sede1', "sed -n --e='s/a/b/w out' note.txt", 'sed shortest --e abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-sedfi1', 'sed -n --fi=x.pat note.txt', 'sed shortest --fi abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-sorto', 'sort -ro out.txt f', 'sort attached -o must ask human')
await expectManualBash('readonly-test', 'call-readonly-sortT', 'sort -T/tmp f', 'sort attached -T must ask human')
await expectManualBash('readonly-test', 'call-readonly-sortout', 'sort --out=out.txt f', 'sort --out abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-sortcomp', 'sort --comp=./x f', 'sort --comp abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-sorto1', 'sort --o=out.txt f', 'sort shortest --o abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-sortcom1', 'sort --com=./x f', 'sort shortest --com abbreviation must ask human')
await expectManualBash('readonly-test', 'call-readonly-grepp', 'grep -f/etc/passwd pattern', 'grep attached -f must ask human')
await expectManualBash('readonly-test', 'call-readonly-link', 'cat link-read.txt', 'read-only symlink escape must ask human')
await expectManualBash('readonly-test', 'call-readonly-linkdir', 'cd link-dir && cat readonly-outside.txt', 'cd symlink outside must ask human')

// 软链 cwd 指向会话内部时，不存在的参数路径不应被误判为越界。
nextCalls = 0
feedToolCall('readonly-test', 'call-readonly-sublink', "cd sub-link && sed -n 's/a/b/p' note.txt")
const subLinkOut = await approval(bashRequest('readonly-test', 'call-readonly-sublink', "cd sub-link && sed -n 's/a/b/p' note.txt"), nextAllowed)
assert.equal(subLinkOut, 'allowed-once')
assert.equal(nextCalls, 0, 'symlinked cwd inside session still allows safe sed')

// 项目信任：只放行项目内的 edit/write 和已识别 test/build；push 仍转人工。
const projectRoot = join(process.env.DSH_HOME, 'trusted-project')
mkdirSync(projectRoot, { recursive: true })
const projectFile = join(projectRoot, 'a.js')
writeFileSync(projectFile, 'const a = 1\n', 'utf8')
const outsideFile = join(process.env.DSH_HOME, 'outside-secret.txt')
writeFileSync(outsideFile, 'secret\n', 'utf8')
const projectLink = join(projectRoot, 'link.txt')
symlinkSync(outsideFile, projectLink)
writeFileSync(allowlistPath, JSON.stringify({
  version: 3,
  riskyThreshold: 1,
  semanticReuse: false,
  shadow: false,
  sessionMemory: false,
  allowRules: []
}), 'utf8')
const addProject = await callApi('/api/auto-approve/rules', 'POST', { op: 'add', kind: 'projectTrust', value: projectRoot })
assert.equal(addProject.status, 200)
assert.equal(addProject.json.ok, true)
const projectSnap = await callApi('/api/auto-approve/rules', 'GET')
assert.ok((projectSnap.json.config.projectTrust || []).includes(projectRoot), 'project trust persisted')

feedToolCallTool('project-test', 'call-project-edit', 'edit', { path: projectFile, old_string: '1', new_string: '2' })
nextCalls = 0
const projectEditOut = await approval({
  agent: { session: { id: 'project-test', cwd } },
  toolName: 'edit',
  callId: 'call-project-edit',
  reason: 'escalate sandbox to danger-full-access: write ' + projectFile,
}, nextAllowed)
assert.equal(projectEditOut, 'allowed-once')
assert.equal(nextCalls, 0, 'project trust auto-allows edit inside root')

feedToolCallTool('project-test', 'call-project-write', 'write', { path: projectFile, content: 'const a = 2\n' })
nextCalls = 0
const projectWriteOut = await approval({
  agent: { session: { id: 'project-test', cwd } },
  toolName: 'write',
  callId: 'call-project-write',
  reason: 'escalate sandbox to danger-full-access: write ' + projectFile,
}, nextAllowed)
assert.equal(projectWriteOut, 'allowed-once')
assert.equal(nextCalls, 0, 'project trust auto-allows write inside root')
const projectEditEvent = readEvents().filter((ev) => ev.kind === 'auto' && ev.path === 'project-trust').pop()
assert.ok(projectEditEvent, 'project trust auto event recorded')
assert.equal(projectEditEvent.projectRoot, projectRoot, 'project trust records root')

nextCalls = 0
feedToolCall('project-test', 'call-project-bash', 'cd ' + projectRoot + ' && npm test')
const projectBashOut = await approval(bashRequest('project-test', 'call-project-bash', 'cd ' + projectRoot + ' && npm test'), nextAllowed)
assert.equal(projectBashOut, 'allowed-once')
assert.equal(nextCalls, 0, 'project trust auto-allows recognized test command inside root')

nextCalls = 0
feedToolCall('project-test', 'call-project-go', 'cd ' + projectRoot + ' && go test ./...')
const projectGoOut = await approval(bashRequest('project-test', 'call-project-go', 'cd ' + projectRoot + ' && go test ./...'), nextAllowed)
assert.equal(projectGoOut, 'allowed-once')
assert.equal(nextCalls, 0, 'project trust auto-allows go test inside root')

nextCalls = 0
feedToolCall('project-test', 'call-project-build', 'cd ' + projectRoot + ' && npm run build')
const projectBuildOut = await approval(bashRequest('project-test', 'call-project-build', 'cd ' + projectRoot + ' && npm run build'), nextAllowed)
assert.equal(projectBuildOut, 'allowed-once')
assert.equal(nextCalls, 0, 'project trust auto-allows npm run build inside root')

// 项目信任不能被 --prefix / 环境变量 / -vettool / symlink / 缺失参数绕过。
await expectManualBash('project-test', 'call-project-prefix', 'cd ' + projectRoot + ' && npm test --prefix /tmp', 'project trust must reject npm --prefix')
await expectManualBash('project-test', 'call-project-env', 'cd ' + projectRoot + ' && GOFLAGS=-toolexec=/tmp/evil go test ./...', 'project trust must reject leading env')
await expectManualBash('project-test', 'call-project-vettool', 'cd ' + projectRoot + ' && go vet -vettool=/tmp/evil ./...', 'project trust must reject go -vettool')
await expectManualBash('project-test', 'call-project-vettool2', 'cd ' + projectRoot + ' && go vet --vettool=/tmp/evil ./...', 'project trust must reject go --vettool')
await expectManualBash('project-test', 'call-project-overlay', 'cd ' + projectRoot + ' && go build -overlay=/tmp/evil.json ./...', 'project trust must reject go -overlay')
await expectManualBash('project-test', 'call-project-cd-out', 'cd /tmp && npm test', 'project trust must reject cwd outside root')

nextCalls = 0
feedToolCall('project-test', 'call-project-push', 'git push')
const projectPushOut = await approval(bashRequest('project-test', 'call-project-push', 'git push'), nextAllowed)
assert.equal(projectPushOut, 'allowed-once')
assert.equal(nextCalls, 1, 'project trust does not auto-allow push')

// symlink 越界、根外写入、缺失参数都必须转人工。
feedToolCallTool('project-test', 'call-project-link', 'edit', { path: projectLink, old_string: 'secret', new_string: 'x' })
nextCalls = 0
const projectLinkOut = await approval({
  agent: { session: { id: 'project-test', cwd } },
  toolName: 'edit', callId: 'call-project-link',
  reason: 'escalate sandbox to danger-full-access: write ' + projectLink,
}, nextAllowed)
assert.equal(projectLinkOut, 'allowed-once')
assert.equal(nextCalls, 1, 'project trust rejects symlink escape')

feedToolCallTool('project-test', 'call-project-outside', 'write', { path: outsideFile, content: 'x' })
nextCalls = 0
const projectOutsideOut = await approval({
  agent: { session: { id: 'project-test', cwd } },
  toolName: 'write', callId: 'call-project-outside',
  reason: 'escalate sandbox to danger-full-access: write ' + outsideFile,
}, nextAllowed)
assert.equal(projectOutsideOut, 'allowed-once')
assert.equal(nextCalls, 1, 'project trust rejects write outside root')

feedToolCallTool('project-test', 'call-project-noargs', 'edit', {})
nextCalls = 0
const noargsTarget = join(projectRoot, 'noargs-unique-' + Date.now() + '.js')
const projectNoArgsOut = await approval({
  agent: { session: { id: 'project-test', cwd } },
  toolName: 'edit', callId: 'call-project-noargs',
  reason: 'escalate sandbox to danger-full-access: write ' + noargsTarget,
}, nextAllowed)
assert.equal(projectNoArgsOut, 'allowed-once')

assert.equal(nextCalls, 1, 'project trust fails closed without args paths')

const removeProject = await callApi('/api/auto-approve/rules', 'POST', { op: 'remove', kind: 'projectTrust', value: projectRoot })
assert.equal(removeProject.status, 200)
assert.equal(removeProject.json.ok, true)
const afterRemoveTarget = join(projectRoot, 'after-remove-' + Date.now() + '.js')
feedToolCallTool('project-test', 'call-project-edit-2', 'edit', { path: afterRemoveTarget, old_string: '2', new_string: '3' })
nextCalls = 0
const projectEditAgain = await approval({
  agent: { session: { id: 'project-test', cwd } },
  toolName: 'edit',
  callId: 'call-project-edit-2',
  reason: 'escalate sandbox to danger-full-access: write ' + afterRemoveTarget,
}, nextAllowed)
assert.equal(projectEditAgain, 'allowed-once')
assert.equal(nextCalls, 1, 'removed project trust asks human again')

writeFileSync(allowlistPath, JSON.stringify({
  version: 3,
  riskyThreshold: 1,
  semanticReuse: false,
  shadow: false,
  sessionMemory: false,
  allowRules: []
}), 'utf8')
flashReply = 'RISKY:neutral'
nextCalls = 0
feedToolCall('command-test', 'call-test-1', 'npm test')
const testFirst = await approval(bashRequest('command-test', 'call-test-1', 'npm test'), nextAllowed)
assert.equal(testFirst, 'allowed-once')
assert.equal(nextCalls, 1, 'first safe command asks once')
const commandLearning = JSON.parse(readFileSync(learningPath, 'utf8'))
const commandKey = 'bash|workspace-write|neutral|cmd=npm test|cwd=' + cwd
assert.equal(commandLearning.stats[commandKey], 1, 'safe command gets its own learning key')

nextCalls = 0
feedToolCall('command-test', 'call-test-2', 'npm publish')
const publishOut = await approval(bashRequest('command-test', 'call-test-2', 'npm publish'), nextAllowed)
assert.equal(publishOut, 'allowed-once')
assert.equal(nextCalls, 1, 'npm publish does not reuse npm test approval')
assert.equal(JSON.parse(readFileSync(learningPath, 'utf8')).stats['bash|workspace-write|neutral'], undefined, 'unverified bash is not counted')
assert.ok(readEvents().filter((ev) => ev.path === 'command-unverified').length >= 1, 'unverified bash uses its own path')

nextCalls = 0
feedToolCall('command-test', 'call-test-2b', 'npm publish')
const publishAgain = await approval(bashRequest('command-test', 'call-test-2b', 'npm publish'), nextAllowed)
assert.equal(publishAgain, 'allowed-once')
assert.equal(nextCalls, 1, 'unverified bash still asks every time')
assert.equal(readEvents().filter((ev) => ev.kind === 'auto' && ev.justification === 'npm publish').length, 0, 'unverified bash never auto-allows')

nextCalls = 0
feedToolCall('command-test', 'call-test-3', 'npm test')
const testSecond = await approval(bashRequest('command-test', 'call-test-3', 'npm test'), nextAllowed)
assert.equal(testSecond, 'allowed-once')
assert.equal(nextCalls, 0, 'same safe command auto-allows after confirmation')
const commandEvents = readEvents()
const commandAuto = commandEvents.filter((ev) => ev.kind === 'auto' && ev.commandPattern === 'npm test').pop()
assert.ok(commandAuto, 'auto event records commandPattern')
const commandRule = JSON.parse(readFileSync(allowlistPath, 'utf8')).allowRules.find((rule) => rule.commandPattern === 'npm test')
assert.ok(commandRule, 'learned rule stores commandPattern')
assert.equal(commandRule.cwdPrefix, cwd, 'learned rule scopes command to cwd')

// P1 语义复用：只比较真实参数，且 bash 必须同一 program。
const semanticCwd = join(process.env.DSH_HOME, 'semantic-project')
writeFileSync(allowlistPath, JSON.stringify({
  version: 3,
  riskyThreshold: 2,
  semanticReuse: true,
  shadow: false,
  sessionMemory: false,
  allowRules: []
}), 'utf8')
flashQueue = ['RISKY:neutral']
nextCalls = 0
feedToolCall('semantic-args', 'call-semantic-1', 'npm test')
const semanticFirst = await approval({ ...bashRequest('semantic-args', 'call-semantic-1', 'npm test'), agent: { session: { id: 'semantic-args', cwd: semanticCwd } } }, nextAllowed)
assert.equal(semanticFirst, 'allowed-once')
assert.equal(nextCalls, 1, 'semantic P1 first command asks')
const semanticKey = 'bash|workspace-write|neutral|cmd=npm test|cwd=' + semanticCwd
const semanticSample = JSON.parse(readFileSync(learningPath, 'utf8')).history[semanticKey][0]
assert.match(semanticSample.args, /npm test/, 'sample stores real command args')

flashQueue = ['RISKY:neutral', 'SAME']
nextCalls = 0
feedToolCall('semantic-args', 'call-semantic-2', 'npm test')
const semanticSecond = await approval({ ...bashRequest('semantic-args', 'call-semantic-2', 'npm test'), agent: { session: { id: 'semantic-args', cwd: semanticCwd } } }, nextAllowed)
assert.equal(semanticSecond, 'allowed-once')
assert.equal(nextCalls, 0, 'semantic P1 same program auto-allows')
assert.match(lastPrompt, /真实参数/, 'similarity prompt includes real args')
assert.match(lastPrompt, /本次命令 program: npm/, 'similarity prompt constrains program')
assert.match(lastPrompt, /npm test/, 'similarity prompt includes command')

// 行内编辑需要一个已有规则作为编辑对象。
writeFileSync(allowlistPath, JSON.stringify({
  version: 3,
  allowRules: [{ mode: 'workspace-write', description: 'inline base rule' }]
}), 'utf8')

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

// Shadow 候选分组：两次同命令/同目录候选应聚合，并给出命令规则建议。
for (const id of [9001, 9002]) {
  appendFileSync(eventsPath, JSON.stringify({
    id, ts: Date.now(), sessionId: 'suggest-test', tool: 'bash', mode: 'workspace-write',
    category: 'neutral', kind: 'shadow-candidate', wouldPath: 'flash-safe',
    commandPattern: 'npm test', cwd, justification: 'npm test'
  }) + '\n')
}
const suggestions = await callApi('/api/auto-approve/shadow-suggestions', 'GET')
assert.equal(suggestions.status, 200, 'shadow suggestions endpoint')
assert.ok(suggestions.json.ok, 'shadow suggestions ok')
const group = suggestions.json.groups.find((g) => g.commandPattern === 'npm test' && g.cwd === cwd)
assert.ok(group, 'shadow suggestions groups same command')
assert.ok(group.count >= 2, 'shadow suggestions counts candidates')
assert.equal(group.suggestion && group.suggestion.commandPattern, 'npm test', 'shadow suggestion is command-aware')
assert.equal(group.suggestion && group.suggestion.cwdPrefix, cwd, 'shadow suggestion scopes cwd')
const addSuggestion = await callApi('/api/auto-approve/rules', 'POST', { op: 'add', kind: 'allowRules', value: group.suggestion })
assert.equal(addSuggestion.status, 200, 'shadow suggestion can be added as a rule')
assert.ok(addSuggestion.json.ok, 'shadow suggestion rule accepted')
const addedRule = (await callApi('/api/auto-approve/rules', 'GET')).json.config.allowRules.find((r) => r.commandPattern === 'npm test' && r.cwdPrefix === cwd)
assert.ok(addedRule, 'shadow suggestion rule persists')

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
