// Smoke tests for the dsh-approval-gate fork.
// Runs without DSH: uses a temporary DSH_HOME so the plugin's top-level
// config initialization cannot touch the real profile.
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, appendFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-approval-gate-test-'))
// 权限预设写入的是“当前 profile”的补丁层，不能再写死 profiles/web。
const testProfileDir = join(process.env.DSH_HOME, 'profiles', 'desktop')
mkdirSync(testProfileDir, { recursive: true })
writeFileSync(join(testProfileDir, 'package.json'), '{}')
writeFileSync(join(testProfileDir, 'cordis.patch.yml'), `- id: permission
  name: '@deepseek-ai/dsh-permission-presets'
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: ask
`, 'utf8')
// Desktop 主进程不设置 DSH_PROFILE_DIR，只把 profile 目录作为 argv 传入；
// 这里模拟该启动方式，验证插件能从 argv 识别当前 profile。
delete process.env.DSH_PROFILE
delete process.env.DSH_PROFILE_DIR
process.argv.push(testProfileDir)

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
for (const marker of ['记住这次操作', '取消记住', '⑥ 规则库', '学习与沉淀', '拒绝计数', '参数：', '自学习', 'Shadow 候选', '止损观察', '行内编辑', '按项目 / 目录', 'Approval audit', '只读命令', '项目信任', '知道了，开始使用', '自学习已开启', '以后项目内', 'ag-set-collapsed', '界面语言', 'Follow system']) {
  assert.ok(client.includes(marker), `client bundle contains ${marker}`)
}
assert.ok(client.includes("className: 'ag-set', onClick: toggleSettingCard"), 'settings root wires collapse handler')
assert.ok(!client.includes("slots.inject('settings.section'"), 'settings section entry removed')

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
  const [routePath] = String(path).split('?')
  const handler = routes.get(routePath)
  assert.equal(typeof handler, 'function', 'route registered: ' + routePath)
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

// 一键配置权限预设必须写入当前 profile（desktop），而不是硬编码的 profiles/web。
const setupBefore = await callApi('/api/auto-approve/setup', 'GET')
assert.equal(setupBefore.status, 200, 'setup endpoint registered')
assert.equal(setupBefore.json.configured, false, 'preset initially absent')
assert.equal(setupBefore.json.patchPath, join(testProfileDir, 'cordis.patch.yml'), 'setup targets the profile from argv')
assert.equal(setupBefore.json.profile, 'desktop', 'setup reports the detected profile')
const setupPost = await callApi('/api/auto-approve/setup', 'POST')
assert.equal(setupPost.status, 200, 'setup POST works')
assert.equal(setupPost.json.status, 'added-preset', 'setup inserts preset')
assert.equal(setupPost.json.needRestart, true, 'setup asks for restart')
assert.ok(readFileSync(join(testProfileDir, 'cordis.patch.yml'), 'utf8').includes('auto-approve:'), 'preset written to the active profile')
assert.ok(!existsSync(join(process.env.DSH_HOME, 'profiles', 'web', 'cordis.patch.yml')), 'setup does not write profiles/web')
const setupAgain = await callApi('/api/auto-approve/setup', 'POST')
assert.equal(setupAgain.json.status, 'already', 'setup is idempotent')

const initialRules = await callApi('/api/auto-approve/rules', 'GET')
assert.equal(initialRules.status, 200, 'rules endpoint during onboarding test')
assert.equal(initialRules.json.config.selfLearn, true, 'self-learning defaults on for a fresh config')
assert.equal(initialRules.json.config.selfLearnThreshold, 3, 'default self-learning threshold')
assert.equal(initialRules.json.config.selfLearnSessions, 1, 'default self-learning sessions')
const onboard = await callApi('/api/auto-approve/rules', 'POST', { op: 'set', kind: 'onboarded', value: true })
assert.equal(onboard.status, 200, 'onboarding dismissal accepted')
assert.equal((await callApi('/api/auto-approve/rules', 'GET')).json.config.onboarded, true, 'onboarding dismissal persists')

let nextCalls = 0
const nextAllowed = async () => { nextCalls += 1; return 'allowed-once' }
const nextRejected = async () => 'rejected'
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
await callApi('/api/auto-approve/rules', 'POST', { op: 'set', kind: 'selfLearn', value: true })
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
await expectManualBash('readonly-test', 'call-readonly-gitgrepf', 'git grep -f /etc/passwd', 'git grep -f must ask human')
await expectManualBash('readonly-test', 'call-readonly-gitgrepfile', 'git grep --file=/etc/passwd', 'git grep --file must ask human')
await expectManualBash('readonly-test', 'call-readonly-blamecontents', 'git blame --contents=/etc/passwd a.txt', 'git blame --contents must ask human')
await expectManualBash('readonly-test', 'call-readonly-blameignore', 'git blame --ignore-revs-file=/etc/passwd a.txt', 'git blame --ignore-revs-file must ask human')
await expectManualBash('readonly-test', 'call-readonly-blameS', 'git blame -S /etc/passwd a.txt', 'git blame -S must ask human')
await expectManualBash('readonly-test', 'call-readonly-lsfilesX', 'git ls-files -X /etc/passwd', 'git ls-files -X must ask human')
await expectManualBash('readonly-test', 'call-readonly-lsfilesexclude', 'git ls-files --exclude-from=/etc/passwd', 'git ls-files --exclude-from must ask human')
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

// Shadow 候选事件仍参与按项目统计；v0.8.0 移除了「候选分组 + 一键建规则」链路，
// 历史 events.jsonl 里的 shadow-candidate 记录必须继续被 project-stats 正确统计。
for (const id of [9001, 9002]) {
  appendFileSync(eventsPath, JSON.stringify({
    id, ts: Date.now(), sessionId: 'suggest-test', tool: 'bash', mode: 'workspace-write',
    category: 'neutral', kind: 'shadow-candidate', wouldPath: 'flash-safe',
    commandPattern: 'npm test', cwd, justification: 'npm test'
  }) + '\n')
}
assert.equal(routes.has('/api/auto-approve/shadow-suggestions'), false, 'shadow suggestion API removed in v0.8.0')

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

// 执行止损调试日志（v0.8.0）：只写 audit.log 的 GUARD 行，不写 events.jsonl、不改变审批结果。
const auditLogPath = join(dataDir, 'audit.log')
const readAudit = () => { try { return readFileSync(auditLogPath, 'utf8') } catch { return '' } }
const guardAuditBefore = readAudit()
const guardSeg = () => readAudit().slice(guardAuditBefore.length)
flashReply = 'RISKY:neutral'
flashQueue = []
writeFileSync(allowlistPath, JSON.stringify({
  version: 3,
  guard: true,
  shadow: false,
  allowRules: []
}), 'utf8')
nextCalls = 0
feedToolCall('guard-test', 'call-guard-1', 'git status')
const guardFirst = await approval(bashRequest('guard-test', 'call-guard-1', 'git status'), nextAllowed)
assert.equal(guardFirst, 'allowed-once')
assert.equal(nextCalls, 0, 'guard logging does not change read-only approval')
nextCalls = 0
feedToolCall('guard-test', 'call-guard-2', 'git status')
const guardSecond = await approval(bashRequest('guard-test', 'call-guard-2', 'git status'), nextAllowed)
assert.equal(guardSecond, 'allowed-once')
assert.equal(nextCalls, 0, 'guard logging keeps read-only behavior')
const guardLines = guardSeg().split('\n').filter((line) => line.includes('GUARD   '))
assert.equal(guardLines.length, 2, 'one GUARD audit line per approval request')
assert.match(guardLines[0], /repeat=1 total=1 files=0/, 'first guard line records repeat/total/files')
assert.match(guardLines[1], /repeat=2 total=2 files=0/, 'second identical candidate increments repeat')
assert.match(guardLines[0], / sig=.+$/, 'guard line carries the operation signature so repeat is traceable')
assert.equal(readEvents().filter((ev) => ev.kind === 'guard-candidate').length, 0, 'guard writes no events.jsonl record')
// 文件预算：只统计项目内路径，/tmp 等临时目录不计入。
const guardProjectCwd = join(cwd, 'guard-project')
mkdirSync(guardProjectCwd, { recursive: true })
const snapshotsPath = join(dataDir, 'snapshots')
const snapshotsBefore = existsSync(snapshotsPath) ? readdirSync(snapshotsPath).length : 0
feedToolCallTool('guard-paths', 'call-guard-paths', 'write', { files: [join(guardProjectCwd, 'a.js'), '/tmp/scratch.txt'] })
nextCalls = 0
const guardPathOut = await approval({
  agent: { session: { id: 'guard-paths', cwd: guardProjectCwd } },
  toolName: 'write',
  callId: 'call-guard-paths',
  reason: 'escalate sandbox to workspace-write: write project files',
}, nextAllowed)
assert.equal(guardPathOut, 'allowed-once')
assert.equal(nextCalls, 1, 'guard does not change write approval')
const guardWriteLines = guardSeg().split('\n').filter((line) => line.includes('GUARD   write'))
assert.equal(guardWriteLines.length, 1, 'guard records write request in audit.log')
assert.match(guardWriteLines[0], /mode=workspace-write repeat=1 total=1 files=1/, 'guard counts project file and excludes scratch paths')
const snapshotsAfter = existsSync(snapshotsPath) ? readdirSync(snapshotsPath).length : 0
assert.equal(snapshotsAfter, snapshotsBefore, 'guard logging does not create snapshots')
// 同一文件再次修改：签名不变，repeat 递增（文件内容变化不应拆散签名）。
feedToolCallTool('guard-paths', 'call-guard-paths-2', 'write', { files: [join(guardProjectCwd, 'a.js')], content: 'different content' })
nextCalls = 0
await approval({
  agent: { session: { id: 'guard-paths', cwd: guardProjectCwd } },
  toolName: 'write',
  callId: 'call-guard-paths-2',
  reason: 'escalate sandbox to workspace-write: write project files',
}, nextAllowed)
const guardWriteLines2 = guardSeg().split('\n').filter((line) => line.includes('GUARD   write'))
assert.equal(guardWriteLines2.length, 2, 'second file request logged')
assert.match(guardWriteLines2[1], /repeat=2 .*files=1/, 'same file signature increments repeat')
const guardSigOf = (line) => (line.match(/ sig=(.*)$/) || [])[1]
assert.ok(guardSigOf(guardWriteLines2[0]), 'write guard line carries a signature')
assert.equal(guardSigOf(guardWriteLines2[0]), guardSigOf(guardWriteLines2[1]), 'same file keeps one signature across content changes')
// 兼容性：历史 guard-candidate 事件仍被 project-stats 忽略（不改变统计口径）。
appendFileSync(eventsPath, JSON.stringify({
  id: 9100, ts: Date.now(), sessionId: 'guard-legacy', tool: 'write', mode: 'workspace-write',
  kind: 'guard-candidate', path: 'guard-observe', cwd: guardProjectCwd,
  guard: { signature: 'write|a.js', repeat: 1, sessionTotal: 1, files: 1, paths: [join(guardProjectCwd, 'a.js')] }
}) + '\n')
const statsWithGuard = await callApi('/api/auto-approve/project-stats', 'GET')
const guardProject = statsWithGuard.json.projects.find((p) => p.path === guardProjectCwd)
assert.ok(guardProject, 'project stats includes the guard project decision')
assert.equal(guardProject.total, 2, 'project stats ignores legacy guard observation events')
const guardCfg = await callApi('/api/auto-approve/rules', 'GET')
assert.equal(guardCfg.json.config.guard, true, 'guard config exposed')
const guardOff = await callApi('/api/auto-approve/rules', 'POST', { op: 'set', kind: 'guard', value: false })
assert.equal(guardOff.status, 200, 'guard toggle accepted')
const guardOffBefore = readAudit()
nextCalls = 0
feedToolCall('guard-test-2', 'call-guard-3', 'git status')
const guardDisabled = await approval(bashRequest('guard-test-2', 'call-guard-3', 'git status'), nextAllowed)
assert.equal(guardDisabled, 'allowed-once')
assert.equal(readAudit().slice(guardOffBefore.length).split('\n').filter((line) => line.includes('GUARD   ')).length, 0, 'guard off writes no GUARD line')

// 向后兼容：遗留 source（如已移除的 shadow-suggestion）仍能读取，规则不被删除。
writeFileSync(allowlistPath, JSON.stringify({
  version: 3,
  allowRules: [
    { tool: 'bash', mode: 'danger-full-access', contains: 'echo legacy-suggestion', source: 'shadow-suggestion', hitCount: 0, disabled: true, description: '来自已移除的 Shadow 建议' },
  ],
}), 'utf8')
const legacyCfg = await callApi('/api/auto-approve/rules', 'GET')
const legacyRule = (legacyCfg.json.config.allowRules || []).find((r) => r.source === 'shadow-suggestion')
assert.ok(legacyRule, 'legacy shadow-suggestion rule is still readable')
assert.equal(legacyRule.contains, 'echo legacy-suggestion', 'legacy rule fields survive loading')
assert.equal(legacyRule.disabled, true, 'a disabled legacy rule stays disabled and is still readable')

const patchPath = new URL('../patches/dsh-approval-gate@0.5.0.patch', import.meta.url)
assert.ok(existsSync(patchPath), 'fork patch present')
const patch = readFileSync(patchPath, 'utf8')
assert.ok(patch.includes('--- a/src/index.mjs'), 'patch targets host source')
assert.ok(patch.includes('--- a/client.js'), 'patch targets client bundle')

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(pkg.name, 'dsh-moongate', 'package name')
assert.equal(pkg.license, 'MIT', 'license stays MIT')

// 自学习：默认累计 3 次 SAFE（同签名）后生成 self-learned 规则；显式 false 不生成。
const slPath = join(cwd, 'selflearn-' + Date.now() + '.txt')
writeFileSync(allowlistPath, JSON.stringify({
  version: 3, riskyThreshold: 1, semanticReuse: false, shadow: false,
  sessionMemory: false, selfLearn: true, selfLearnThreshold: 3, selfLearnSessions: 1,
  allowRules: []
}), 'utf8')
flashReply = 'SAFE'
for (let i = 0; i < 3; i++) {
  const callId = 'call-selflearn-' + i
  feedToolCallTool('selflearn-test', callId, 'write', { path: slPath, content: 'x' })
  nextCalls = 0
  const out = await approval({
    agent: { session: { id: 'selflearn-test', cwd } },
    toolName: 'write', callId,
    reason: 'escalate sandbox to danger-full-access: write ' + slPath,
  }, nextAllowed)
  assert.equal(out, 'allowed-once')
  assert.equal(nextCalls, 0, 'self-learning SAFE auto-allows')
}
const selfLearned = (await callApi('/api/auto-approve/rules', 'GET')).json.config.allowRules
  .find((r) => r && r.source === 'self-learned')
assert.ok(selfLearned, 'three SAFE verdicts create a self-learned rule')

const slOffPath = join(cwd, 'selflearn-off-' + Date.now() + '.txt')
writeFileSync(allowlistPath, JSON.stringify({
  version: 3, riskyThreshold: 1, semanticReuse: false, shadow: false,
  sessionMemory: false, selfLearn: false, selfLearnThreshold: 3, selfLearnSessions: 1,
  allowRules: []
}), 'utf8')
await callApi('/api/auto-approve/rules', 'POST', { op: 'set', kind: 'selfLearn', value: false })
for (let i = 0; i < 3; i++) {
  const callId = 'call-selflearn-off-' + i
  feedToolCallTool('selflearn-off', callId, 'write', { path: slOffPath, content: 'x' })
  nextCalls = 0
  const out = await approval({
    agent: { session: { id: 'selflearn-off', cwd } },
    toolName: 'write', callId,
    reason: 'escalate sandbox to danger-full-access: write ' + slOffPath,
  }, nextAllowed)
  assert.equal(out, 'allowed-once')
  assert.equal(nextCalls, 0, 'self-learning off still allows via Flash SAFE')
}
const noSelfLearned = (await callApi('/api/auto-approve/rules', 'GET')).json.config.allowRules
  .find((r) => r && r.source === 'self-learned')
assert.ok(!noSelfLearned, 'explicit selfLearn=false creates no self-learned rule')

// 过宽签名不学习：家目录第一层（~/xxx.txt）连 3 次 SAFE 也不得沉淀规则（否则等于放行整个 ~）
const slBroadPath = '~/selflearn-broad-' + Date.now() + '.txt'
writeFileSync(allowlistPath, JSON.stringify({
  version: 3, riskyThreshold: 1, semanticReuse: false, shadow: false,
  sessionMemory: false, selfLearn: true, selfLearnThreshold: 3, selfLearnSessions: 1,
  allowRules: []
}), 'utf8')
await callApi('/api/auto-approve/rules', 'POST', { op: 'set', kind: 'selfLearn', value: true })
for (let i = 0; i < 3; i++) {
  const callId = 'call-selflearn-broad-' + i
  feedToolCallTool('selflearn-broad', callId, 'write', { path: slBroadPath, content: 'x' })
  nextCalls = 0
  const out = await approval({
    agent: { session: { id: 'selflearn-broad', cwd } },
    toolName: 'write', callId,
    reason: 'escalate sandbox to danger-full-access: write ' + slBroadPath,
  }, nextAllowed)
  assert.equal(out, 'allowed-once', 'broad signature still auto-allows via Flash SAFE')
  assert.equal(nextCalls, 0)
}
const broadLearned = (await callApi('/api/auto-approve/rules', 'GET')).json.config.allowRules
  .find((r) => r && r.source === 'self-learned')
assert.ok(!broadLearned, 'broad ~/* signature is never self-learned')
assert.ok(readFileSync(join(dataDir, 'audit.log'), 'utf8').includes('SELFLEARN-SKIP'), 'broad signature veto is audited')

// 敏感目录不学习：深度够（~/.dsh/profiles/x.txt）但命中敏感清单，同样 3 次 SAFE 也不得沉淀规则
const slSensitivePath = '~/.dsh/profiles/selflearn-' + Date.now() + '.txt'
for (let i = 0; i < 3; i++) {
  const callId = 'call-selflearn-sensitive-' + i
  feedToolCallTool('selflearn-sensitive', callId, 'write', { path: slSensitivePath, content: 'x' })
  nextCalls = 0
  const out = await approval({
    agent: { session: { id: 'selflearn-sensitive', cwd } },
    toolName: 'write', callId,
    reason: 'escalate sandbox to danger-full-access: write ' + slSensitivePath,
  }, nextAllowed)
  assert.equal(out, 'allowed-once', 'sensitive-path signature still auto-allows via Flash SAFE')
  assert.equal(nextCalls, 0)
}
const sensitiveLearned = (await callApi('/api/auto-approve/rules', 'GET')).json.config.allowRules
  .find((r) => r && r.source === 'self-learned')
assert.ok(!sensitiveLearned, 'sensitive-prefix signature is never self-learned')
assert.ok(/SELFLEARN-SKIP .*sensitive/.test(readFileSync(join(dataDir, 'audit.log'), 'utf8')), 'sensitive veto is audited with reason')

// 隐藏目录的子目录同样不学习：~/.docker/keys/token.json（3 次 SAFE 也不得沉淀规则）
const slDotPath = '~/.docker/keys/selflearn-' + Date.now() + '.json'
for (let i = 0; i < 3; i++) {
  const callId = 'call-selflearn-dot-' + i
  feedToolCallTool('selflearn-dot', callId, 'write', { path: slDotPath, content: '{}' })
  nextCalls = 0
  const out = await approval({
    agent: { session: { id: 'selflearn-dot', cwd } },
    toolName: 'write', callId,
    reason: 'escalate sandbox to danger-full-access: write ' + slDotPath,
  }, nextAllowed)
  assert.equal(out, 'allowed-once', 'dot-dir signature still auto-allows via Flash SAFE')
  assert.equal(nextCalls, 0)
}
const dotLearned = (await callApi('/api/auto-approve/rules', 'GET')).json.config.allowRules
  .find((r) => r && r.source === 'self-learned')
assert.ok(!dotLearned, 'dot-dir subdirectory is never self-learned')
assert.ok(/SELFLEARN-SKIP .*hidden-dir/.test(readFileSync(join(dataDir, 'audit.log'), 'utf8')), 'dot-dir veto is audited')

// 深度 2 的家目录项目目录仍可学（~ 口径与文档一致：只挡 ~/* 与 /*）
const slProjectPath = '~/selflearn-project-' + Date.now() + '/file.txt'
for (let i = 0; i < 3; i++) {
  const callId = 'call-selflearn-project-' + i
  feedToolCallTool('selflearn-project', callId, 'write', { path: slProjectPath, content: 'x' })
  nextCalls = 0
  await approval({
    agent: { session: { id: 'selflearn-project', cwd } },
    toolName: 'write', callId,
    reason: 'escalate sandbox to danger-full-access: write ' + slProjectPath,
  }, nextAllowed)
}
const projectRule = (await callApi('/api/auto-approve/rules', 'GET')).json.config.allowRules
  .find((r) => r && r.source === 'self-learned')
assert.ok(projectRule, 'home project directory (depth 2) is still learnable')
assert.ok(projectRule.signature.includes('~/selflearn-project-') || /\*\/file\.txt$/.test(projectRule.signature), 'learned signature keeps directory scoping: ' + projectRule.signature)

// 闸门单元用例：归一化（..、//、大小写、符号链接）与清单覆盖
const tooBroad = mod.signatureTooBroad
assert.equal(tooBroad(['~/*']), 'too-broad ~/*')
assert.equal(tooBroad(['/*']), 'too-broad /*')
assert.equal(tooBroad(['/tmp/*']), 'too-broad /tmp/*')
const probeRoot = join(process.env.DSH_HOME, 'gate-probe-' + Date.now())
assert.equal(tooBroad([probeRoot + '/*.txt']), '', 'depth-2 directory under tmp home stays learnable')
assert.equal(tooBroad(['~/gate-probe-' + Date.now() + '/*.txt']), '', 'depth-2 directory under home stays learnable')
assert.ok(tooBroad(['/tmp/../etc/review-*.txt']).startsWith('sensitive'), '.. is collapsed before the sensitive check')
assert.ok(tooBroad(['//etc/ssh/review-*.txt']).startsWith('sensitive'), 'double slash is collapsed')
assert.ok(tooBroad(['~/.SSH/keys/review-*.txt']).startsWith('sensitive'), 'case-insensitive sensitive match')
assert.ok(tooBroad(['~/Library/Messages/x/*.txt']).startsWith('sensitive'), '~/Library covered')
assert.ok(tooBroad(['/opt/homebrew/x/*.txt']).startsWith('sensitive'), '/opt covered')
assert.ok(tooBroad(['/var/db/x/*.txt']).startsWith('sensitive'), '/var/db covered')
assert.equal(tooBroad(['/private/var/folders/ab/cd/*.txt']), '', 'macOS temp under /var/folders stays learnable')
assert.ok(tooBroad(['/Users/otheruser/proj/*.txt']).startsWith('other-home'), 'other users home is rejected')

// 毕业闸门（recordSignatureApproval）走同一判定：家目录点目录不可毕业。
// 最小路径：graduationThreshold=1、graduationSessions=1，两次不同指纹的人工批准即达毕业条件。
writeFileSync(allowlistPath, JSON.stringify({
  version: 3, riskyThreshold: 1, semanticReuse: false, shadow: false,
  sessionMemory: false, selfLearn: false, graduationThreshold: 1, graduationSessions: 1,
  allowRules: [], denyRules: []
}), 'utf8')
await callApi('/api/auto-approve/rules', 'POST', { op: 'set', kind: 'graduationThreshold', value: 1 })
assert.equal((await callApi('/api/auto-approve/rules', 'GET')).json.config.graduationThreshold, 1, 'graduation threshold reloaded')
const gradA = '~/.dsh/profiles/grada-' + Date.now() + '.txt'
const gradB = '~/.dsh/profiles/gradb-' + Date.now() + '.txt'
flashQueue.push('RISKY:neutral', 'DIFFERENT:neutral', 'RISKY:neutral', 'DIFFERENT:neutral')
for (const [i, target] of [gradA, gradB].entries()) {
  const callId = 'call-graduate-' + i
  feedToolCallTool('graduate-test', callId, 'write', { path: target, content: 'x' })
  nextCalls = 0
  const out = await approval({
    agent: { session: { id: 'graduate-test', cwd } },
    toolName: 'write', callId,
    reason: 'escalate sandbox to danger-full-access: write ' + target,
  }, nextAllowed)
  assert.equal(out, 'allowed-once', 'neutral write falls back to the human and is approved')
  assert.equal(nextCalls, 1, 'neutral write asked the human')
}
const gradRules = (await callApi('/api/auto-approve/rules', 'GET')).json.config.allowRules
assert.ok(!gradRules.some((r) => r && r.graduation), 'no graduation rule for a sensitive home dot-dir')
assert.ok(/GRADUATE-SKIP .*签名不可学习：(sensitive|hidden-dir)/.test(readFileSync(join(dataDir, 'audit.log'), 'utf8')), 'graduation veto is audited')

// 家目录第一层点目录（凭据常见位置）兜底 + 符号链接归一化
assert.ok(tooBroad(['~/.docker/*.json']).startsWith('hidden-dir'), '~/.docker is not learnable')
assert.ok(tooBroad(['~/.cargo/*.toml']).startsWith('hidden-dir'), '~/.cargo is not learnable')
assert.ok(tooBroad(['~/.terraform.d/*.json']).startsWith('hidden-dir'), '~/.terraform.d is not learnable')
assert.equal(tooBroad(['~/proj/.cache/*.txt']), '', 'deeper hidden segments stay learnable')
const etcLink = join(process.env.DSH_HOME, 'etc-link')
symlinkSync('/etc', etcLink)
assert.ok(tooBroad([etcLink + '/*.conf']).startsWith('sensitive'), 'symlinked sensitive dir is resolved before the check')

// ---- 回归：生产 10 周零触发但代码可达的三条路径（ESCALATE / PROMOTE / SELFLEARN-CAP）----
// 目的：裁剪评估中确认它们“可达但零触发”，用测试锁定语义，避免以后被误删或静默失效。
const auditPath = join(dataDir, 'audit.log')
const readAuditLog = () => { try { return readFileSync(auditPath, 'utf8') } catch { return '' } }

// 1) ESCALATE：同一会话连续拒绝达到配置阈值时必须产出 escalate 事件 + audit 行 + 计数 API。
const escAuditBefore = readAuditLog()
writeFileSync(allowlistPath, JSON.stringify({
  version: 3, riskyThreshold: 3, semanticReuse: false, shadow: false, guard: false,
  sessionMemory: false, selfLearn: false, allowRules: [], denyRules: []
}), 'utf8')
flashReply = 'RISKY:neutral'
flashQueue = []
for (let i = 0; i < 3; i++) {
  const out = await approval({
    agent: { session: { id: 'esc-test', cwd } },
    toolName: 'write',
    callId: 'call-esc-' + i,
    reason: 'escalate sandbox to workspace-write: write ~/esc-proj/a.txt',
  }, nextRejected)
  assert.equal(out, 'rejected', 'rejection is propagated: ' + i)
}
const escEvent = readEvents().filter((ev) => ev.kind === 'escalate').pop()
assert.ok(escEvent, 'escalate event recorded when consecutive rejects hit the limit')
assert.equal(escEvent.consecutive, 3, 'escalate event records consecutive count')
assert.equal(escEvent.total, 3, 'escalate event records total count')
assert.match(readAuditLog().slice(escAuditBefore.length), /ESCALATE esc-test .*consecutive=3 total=3/, 'escalate audited')
const escCounters = await callApi('/api/auto-approve/counters?sessionId=esc-test', 'GET')
assert.equal(escCounters.json.consecutive, 3, 'counters API exposes consecutive rejects')
assert.equal(escCounters.json.total, 3, 'counters API exposes total rejects')
assert.equal(escCounters.json.limits.consecutive, 3, 'counters API exposes consecutive limit')
assert.equal(escCounters.json.limits.total, 20, 'counters API exposes total limit')
await callApi('/api/auto-approve/counters-reset', 'POST', { sessionId: 'esc-test' })
const escReset = await callApi('/api/auto-approve/counters?sessionId=esc-test', 'GET')
assert.equal(escReset.json.consecutive, 0, 'counters reset clears consecutive')
assert.equal(escReset.json.total, 0, 'counters reset clears total')

// 2) PROMOTE：同一指纹在 2 个会话被人工确认后（带明确用户意图），晋升为 learned 规则。
const promoAuditBefore = readAuditLog()
writeFileSync(allowlistPath, JSON.stringify({
  version: 3, riskyThreshold: 3, semanticReuse: false, shadow: false, guard: false,
  sessionMemory: true, promotionSessions: 2, selfLearn: false,
  graduationThreshold: 99, graduationSessions: 99, allowRules: [], denyRules: []
}), 'utf8')
flashReply = 'RISKY:neutral'
flashQueue = []
for (const sid of ['promote-a', 'promote-b']) {
  nextCalls = 0
  const out = await approval({
    agent: { session: { id: sid, cwd } },
    toolName: 'write',
    callId: 'call-' + sid,
    reason: 'escalate sandbox to workspace-write: 用户已确认 write ~/promote-proj/a.txt',
  }, nextAllowed)
  assert.equal(out, 'allowed-once')
  assert.equal(nextCalls, 1, 'promotion candidate still asks the human: ' + sid)
}
const promoRules = (await callApi('/api/auto-approve/rules', 'GET')).json.config.allowRules.filter((r) => r && r.source === 'learned')
assert.equal(promoRules.length, 1, 'cross-session promotion creates exactly one learned rule')
assert.ok(JSON.stringify(promoRules[0]).includes('promote-proj'), 'promoted rule carries the confirmed fingerprint')
assert.match(readAuditLog().slice(promoAuditBefore.length), /PROMOTE .*promote-proj/, 'promotion audited')

// 3) SELFLEARN-CAP：自学习规则数达到上限后不再新增规则，并留下 SELFLEARN-CAP 审计行。
const capAuditBefore = readAuditLog()
writeFileSync(allowlistPath, JSON.stringify({
  version: 3, riskyThreshold: 1, semanticReuse: false, shadow: false, guard: false,
  sessionMemory: false, selfLearn: true, selfLearnThreshold: 1, selfLearnSessions: 1, selfLearnMaxRules: 1,
  allowRules: [{ tool: 'bash', source: 'self-learned', signature: 'preexisting-sig' }]
}), 'utf8')
flashReply = 'SAFE'
flashQueue = []
const capPath = join(cwd, 'cap-project-' + Date.now() + '.txt')
nextCalls = 0
const capOut = await approval({
  agent: { session: { id: 'cap-test', cwd } },
  toolName: 'write',
  callId: 'call-cap',
  reason: 'escalate sandbox to workspace-write: write ' + capPath,
}, nextAllowed)
assert.equal(capOut, 'allowed-once')
assert.equal(nextCalls, 0, 'flash-safe auto-allows before self-learning is evaluated')
assert.match(readAuditLog().slice(capAuditBefore.length), /SELFLEARN-CAP .*已达自学习规则上限/, 'self-learning cap audited')
const capRules = JSON.parse(readFileSync(allowlistPath, 'utf8')).allowRules.filter((r) => r && r.source === 'self-learned')
assert.equal(capRules.length, 1, 'self-learning cap keeps the existing rule count')

console.log('smoke: ok')
