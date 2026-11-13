/**
 * dsh-approval-gate — 自动审批（多级判定）持久插件 v3
 *
 * 挂在审批瀑布（approval/request）最前：当会话权限预设为 auto-approve 时，
 * 按「DENY → 白名单 → denyRules → flash（SAFE/硬类别/中立计数）→ 裁决学习」管道判定越界请求。
 *
 * 设计目标：最小人工介入。人工只出现在两类场景：
 *   1. 必须人工确认：DENY 危险词、硬风险类别（deletion/credential/remote/system/bulk）
 *   2. 中立操作（neutral）：前 N-1 次人工确认；阈值状态按「指纹命中 → flash 第三方同类验证 → 人工」分流：
 *      指纹命中（确认样本）→ 自动放行并沉淀规则（{tool,mode,category,contains}）
 *      指纹未命中但有样本 → flash 语义判断是否与确认样本同类（SAME 放行 / DIFFERENT 人工）
 *      无样本 / 判不同 / 验证失败 → 人工确认
 *      拒绝 → 升级为永久人工规则（denyRules）；取消 → 不计数
 *
 * DSH 审批触发点：命令在沙箱内被拒后，模型带 sandbox_permissions 重试，
 * 触发 approval.request，reason 固定为：
 *   `escalate sandbox to <mode>: <justification>`
 * 其中 mode 仅两级：workspace-write（写工作区，可回补）/
 * danger-full-access（任意文件/系统，危险）。
 *
 * flash 判定协议（v3）：输出 `SAFE` 或 `RISKY:<category>`
 *   category ∈ { deletion, credential, remote, system, bulk, neutral }
 *   硬类别（前五个）→ 直接转人工；neutral（中立）→ 计数放行，第 N 次转人工裁决。
 *
 * 超时/失败处理：AbortController + signal 传给 llm.stream（可取消），
 *   超时或失败重试 1 次，仍失败 → 转人工（fail-safe）。
 *
 * 数据文件（跨部署统一放到 DSH_HOME 下，node_modules 可能只读）：
 *   $DSH_HOME/auto-approve/allowlist.json  配置（denyKeywords/allowRules/denyRules/hardCategories/…）
 *   $DSH_HOME/auto-approve/learning.json   学习状态（跨会话持久化）
 *   $DSH_HOME/auto-approve/audit.log       审计（追加式）
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const NAME = 'dsh-approval-gate'
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DATA_DIR = join(DSH_HOME, 'auto-approve')
const ALLOWLIST_PATH = join(DATA_DIR, 'allowlist.json')
const LEARNING_PATH = join(DATA_DIR, 'learning.json')
const AUDIT_PATH = join(DATA_DIR, 'audit.log')
const EVENTS_PATH = join(DATA_DIR, 'events.jsonl')
const MEMORY_PATH = join(DATA_DIR, 'memory.json')
const SNAPSHOTS_DIR = join(DATA_DIR, 'snapshots')
const PROFILE_PATCH_PATH = join(DSH_HOME, 'profiles', 'web', 'cordis.patch.yml')

// 快照限制：单文件 ≤256KB、每事件 ≤5 个文件
const SNAPSHOT_MAX_BYTES = 256 * 1024
const SNAPSHOT_MAX_FILES = 5

/** 判定文本文件（跳过二进制/图片等） */
const SNAPSHOT_BINARY_RE = /[\x00-\x08\x0e-\x1f]/
function isSnapshotText(buf) {
  if (buf.length > SNAPSHOT_MAX_BYTES) return false
  const head = buf.subarray(0, Math.min(buf.length, 8192))
  return !SNAPSHOT_BINARY_RE.test(head.toString('latin1'))
}

/** 读取文件快照（文本，限制大小）；失败返回 null */
function readSnapshotFile(absPath) {
  try {
    const buf = readFileSync(absPath)
    if (!isSnapshotText(buf)) return null
    return buf.toString('utf8')
  } catch { return null }
}

/** 快照目录安全包装：列目录 / 取大小 / 删除（失败不抛） */
function readdirSyncSafe(dir) {
  try { return readdirSync(dir) } catch { return [] }
}
function statSyncSafe(absPath) {
  try { return statSync(absPath).size } catch { return 0 }
}
function rmSyncSafe(absPath) {
  rmSync(absPath, { force: true })
}

/** 判断某个快照文件是否属于指定会话（读 JSON 的 sessionId 字段；无 sessionId 的旧快照视为不匹配，仅全量操作命中） */
function snapshotMatchesSession(absPath, sessionId) {
  if (!sessionId) return true
  try {
    const data = JSON.parse(readFileSync(absPath, 'utf8'))
    return String(data.sessionId || '') === String(sessionId)
  } catch { return false }
}

/** 解析文件路径为绝对路径（~ → home，/ → 原样，相对 → 依次尝试会话 cwd / 进程 cwd / home，取存在的） */
function resolveAbsPath(p, baseDir) {
  const s = String(p || '')
  if (s.startsWith('~')) return join(homedir(), s.slice(1))
  if (s.startsWith('/')) return s
  const candidates = [baseDir, process.cwd(), homedir()].filter((b) => typeof b === 'string' && b)
  const seen = new Set()
  for (const b of candidates) {
    const abs = join(b, s)
    if (!seen.has(abs)) {
      seen.add(abs)
      if (existsSync(abs)) return abs
    }
  }
  // 都不存在：返回第一个候选（快照保存时会因读不到而跳过，保持确定性）
  return join(candidates[0] || process.cwd(), s)
}

/** 保存事件涉及文件的快照（审批时 = 改动前内容） */
function saveEventSnapshots(eventId, files, baseDir, sessionId) {
  const list = files || []
  if (list.length === 0) return
  const snapshots = []
  const seen = new Set()
  for (const f of list) {
    if (snapshots.length >= SNAPSHOT_MAX_FILES) break
    const abs = resolveAbsPath(f, baseDir)
    if (seen.has(abs)) continue
    seen.add(abs)
    const content = readSnapshotFile(abs)
    if (content === null) continue
    snapshots.push({ path: abs, content, ts: new Date().toISOString() })
  }
  if (snapshots.length === 0) return
  const cwdUsed = (typeof baseDir === 'string' && baseDir) ? baseDir : process.cwd()
  try {
    ensureDataDir()
    mkdirSync(SNAPSHOTS_DIR, { recursive: true })
    writeFileSync(join(SNAPSHOTS_DIR, String(eventId) + '.json'), JSON.stringify({ eventId, sessionId: String(sessionId || ''), cwd: cwdUsed, snapshots }, null, 2), 'utf8')
  } catch (error) {
    console.error(`[${NAME}] 保存快照失败`, error)
  }
}

/** 读取事件快照 */
function loadEventSnapshots(eventId) {
  try {
    const raw = readFileSync(join(SNAPSHOTS_DIR, String(eventId) + '.json'), 'utf8')
    const data = JSON.parse(raw)
    return Array.isArray(data.snapshots) ? data.snapshots : []
  } catch { return [] }
}

/** 逐行 diff：只返回变更行（add/del） */
function diffLines(before, after, contextLines) {
  const CTX = (typeof contextLines === 'number' && contextLines >= 0) ? contextLines : 5
  const a = String(before == null ? '' : before).split('\n')
  const b = String(after == null ? '' : after).split('\n')
  // 行级贪心匹配：b 中每个值的位置队列，a 按序匹配（保持顺序、近似 LCS）
  const bPos = new Map()
  for (let j = 0; j < b.length; j++) {
    if (!bPos.has(b[j])) bPos.set(b[j], [])
    bPos.get(b[j]).push(j)
  }
  const aMatch = new Array(a.length).fill(-1)
  const bUsed = new Array(b.length).fill(false)
  let limit = 0
  for (let i = 0; i < a.length; i++) {
    const q = bPos.get(a[i])
    if (!q) continue
    for (const pos of q) {
      if (pos >= limit && !bUsed[pos]) { aMatch[i] = pos; bUsed[pos] = true; limit = pos + 1; break }
    }
  }
  // 双指针生成位置交错的操作序列（same/del/add），保留原/新行号
  const ops = [] // {type:'same'|'del'|'add', aNo?, bNo?, text}
  let i = 0, j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && aMatch[i] >= 0) {
      const target = aMatch[i]
      while (j < target) { ops.push({ type: 'add', bNo: j + 1, text: b[j] }); j++ }
      ops.push({ type: 'same', aNo: i + 1, bNo: target + 1, text: a[i] })
      j = target + 1
      i++
    } else if (i < a.length) {
      ops.push({ type: 'del', aNo: i + 1, text: a[i] })
      i++
    } else {
      ops.push({ type: 'add', bNo: j + 1, text: b[j] })
      j++
    }
  }
  // 标记展示行：变更行 ±CTX 的 same 行作为上下文
  const show = new Array(ops.length).fill(false)
  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx].type === 'same') continue
    for (let k = Math.max(0, idx - CTX); k <= Math.min(ops.length - 1, idx + CTX); k++) show[k] = true
  }
  // 聚类 hunk：连续展示行成块，块间隐藏行数记为 hiddenBefore（首块为 0，无参照前置）
  const hunks = []
  let hiddenBefore = 0
  let pending = []
  let started = false
  for (let idx = 0; idx < ops.length; idx++) {
    if (show[idx]) {
      started = true
      pending.push(ops[idx])
    } else {
      if (started && pending.length) {
        hunks.push({ hiddenBefore, lines: pending })
        pending = []
        started = false
      }
      hiddenBefore++
    }
  }
  if (pending.length && started) hunks.push({ hiddenBefore, lines: pending })
  if (hunks.length > 0) hunks[0].hiddenBefore = 0
  const added = ops.filter((o) => o.type === 'add').length
  const removed = ops.filter((o) => o.type === 'del').length
  const stats = {
    added,
    removed,
    contextLines: Math.max(a.length, b.length) - (added + removed),
  }
  return {
    hunks: hunks.map((h) => ({ hiddenBefore: h.hiddenBefore, lines: h.lines })),
    stats,
    changedLines: ops.filter((o) => o.type !== 'same').slice(0, 500),
  }
}

// auto-approve 权限预设（一键初始化时写入 cordis.patch.yml 的 permission 条目）
const AUTO_APPROVE_PRESET_YAML = `      auto-approve:
        sandbox: workspace-write
        approval: ask
        name: 自动审批（Flash）
        description: Flash 预判写入/命令是否不可回补：安全自动批准，有风险转人工审批。
`
// 无 permission 条目时追加的完整预设块
const FULL_PERMISSION_BLOCK = `
# ── 自动审批模式（dsh-approval-gate）─────────────────────────
- id: permission
  name: '@deepseek-ai/dsh-permission-presets'
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
`

// 自动放行事件序号（进程内递增，重启后从现有文件恢复，避免与历史重复）
let eventSeq = 0
try {
  const existing = readFileSync(EVENTS_PATH, 'utf8')
  for (const line of existing.split('\n')) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line)
      if (Number.isInteger(ev.id) && ev.id > eventSeq) eventSeq = ev.id
    } catch { /* 跳过坏行 */ }
  }
} catch { /* 文件不存在：从 0 开始 */ }

/** 从 justification 提取涉及的文件/路径（供审查界面展示） */
function extractFiles(text) {
  const s = String(text || '')
  const found = []
  const seen = new Set()
  const add = (v) => {
    const seg = v.replace(/[，。；、,.;:：\s]+$/g, '').trim()
    if (seg.length < 3 || seg.length > 120) return
    // 按文件名（basename）去重：同一文件的绝对/相对/裸名只保留最先出现的完整形式（快照解析用）
    const base = String(seg).split('/').pop()
    if (!base || base.length < 2) return
    if (seen.has(base)) return
    seen.add(base)
    found.push(seg)
  }
  for (const m of s.matchAll(/(?:~\/|\/|\.\/)?[\w@.-]+\/[\w@.\/-]+/g)) add(m[0])
  for (const m of s.matchAll(/[\w@.-]+\.(?:md|js|json|ya?ml|env|txt|py|ts|css|html|log|mjs|cjs)/gi)) add(m[0])
  return found.slice(0, 8)
}

/**
 * 记录一次审批事件（结构化，供 client 审查界面轮询展示）。
 * kind: 'auto'（自动放行）/ 'manual-pending'（转人工等待）/ 'manual-approved'（人工通过）/
 *       'manual-rejected'（人工拒绝）
 * learningCount/threshold：人工通过时的学习进度（n/3）
 */
function recordApprovalEvent(sessionId, toolName, mode, reason, justification, verdict, opts) {
  eventSeq += 1
  const o = opts || {}
  const ev = {
    id: eventSeq,
    ts: new Date().toISOString(),
    sessionId: String(sessionId || ''),
    tool: String(toolName || 'unknown'),
    mode: String(mode || ''),
    reason: String(reason || '').slice(0, 600),
    justification: String(justification || '').slice(0, 400),
    verdict: String(verdict || 'auto'),
    files: extractFiles(justification)
  }
  if (o.kind) ev.kind = o.kind
  if (o.learningCount !== undefined) ev.learningCount = o.learningCount
  if (o.threshold !== undefined) ev.threshold = o.threshold
  if (o.consecutive !== undefined) ev.consecutive = o.consecutive
  if (o.total !== undefined) ev.total = o.total
  if (o.args) ev.args = String(o.args).slice(0, 600)
  if (o.category) ev.category = o.category
  // path：判定路径标识（hard-category / unknown-category / deny-rule / deny / flash-failed / neutral-reject / neutral-confirm）
  if (o.path) ev.path = o.path
  try {
    ensureDataDir()
    appendFileSync(EVENTS_PATH, JSON.stringify(ev) + '\n', 'utf8')
    // 自动放行且涉及文件 → 保存改动前快照（审批发生在写入前，此刻文件仍是旧内容）
    if (ev.kind === 'auto' && ev.files && ev.files.length > 0) {
      saveEventSnapshots(ev.id, ev.files, (o && o.baseDir) || null, sessionId)
    }
  } catch (error) {
    console.error(`[${NAME}] 记录审批事件失败`, error)
  }
  return ev
}

/** 兼容旧调用：记录自动放行事件（opts 透传给 recordApprovalEvent） */
function recordAutoAllow(sessionId, toolName, mode, reason, justification, verdict, opts) {
  return recordApprovalEvent(sessionId, toolName, mode, reason, justification, verdict, Object.assign({ kind: 'auto' }, opts || {}))
}

// 不可逆危险操作（deny 层，命中即转人工，优先级最高）
const DEFAULT_DENY_KEYWORDS = [
  'rm -rf', 'rm -fr', 'rm -r -f', 'rm --recursive --force',
  'push --force', 'force-push', 'force push', 'drop table', 'drop database',
  'mkfs', 'mkfs.ext', 'format', 'shutdown', 'reboot', 'dd of=',
  'delete from', 'truncate table', 'truncate ', 'terraform destroy', 'revoke',
  '清空数据库', '删除数据库', '格式化', 'sudo rm', 'chmod 777 /',
  'git reset --hard', 'git clean -fd', 'docker rm', 'docker system prune'
]

// 默认白名单规则：工作区写入（可回补）自动放行
const DEFAULT_ALLOW_RULES = [
  { mode: 'workspace-write', description: '工作区写入（可回补，对应 acceptEdits/workspace-write）' }
]

// 硬风险类别：flash 判 RISKY 且命中这些类别 → 直接转人工（不计数、不学习、永远人工）
const DEFAULT_HARD_CATEGORIES = ['deletion', 'credential', 'remote', 'system', 'bulk']

// ---- 规则管理 API 辅助 ----

/** 读取请求体 JSON（参考 dsh-vision-paste 的 POST 处理） */
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > limit) { req.destroy(new Error('payload too large')); reject(new Error('payload too large')) }
    })
    req.on('error', (err) => reject(err))
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}) } catch (e) { reject(e) }
    })
  })
}

/** 配置快照（供设置页展示；区分预置默认值与当前值） */
function getRulesSnapshot() {
  reloadConfig()
  return {
    warnings: scanOverbroadRules(),
    config: {
      version: config.version || 3,
      denyKeywords: config.denyKeywords || [],
      allowRules: (config.allowRules || []).map(decorateRule),
      denyRules: config.denyRules || [],
      hardCategories: config.hardCategories || [],
      riskyThreshold: config.riskyThreshold || 3,
      judgeTimeoutMs: config.judgeTimeoutMs || 20000,
      learning: { enabled: learning.enabled !== false },
      trustRoots: Array.isArray(config.trustRoots) ? config.trustRoots : [],
      sessionMemory: config.sessionMemory !== false,
      promotionSessions: config.promotionSessions || 2,
      graduationThreshold: config.graduationThreshold || 3,
      graduationSessions: config.graduationSessions || 2,
      twoStage: config.twoStage !== false,
      denyEscalateConsecutive: config.denyEscalateConsecutive || 3,
      denyEscalateTotal: config.denyEscalateTotal || 20,
      stage1Provider: config.stage1Provider || '',
      stage1Model: config.stage1Model || '',
      selfLearn: config.selfLearn === true,
      selfLearnThreshold: config.selfLearnThreshold || 5,
      selfLearnSessions: config.selfLearnSessions || 2,
      selfLearnMaxRules: config.selfLearnMaxRules || 50,
      onboarded: config.onboarded === true
    },
    graduation: Object.keys(memoryStore.graduation || {}).map((sig) => {
      const g = memoryStore.graduation[sig]
      return { signature: sig, tool: g.tool, mode: g.mode, count: g.count || 0, sessions: Object.keys(g.sessions || {}).length, lastTs: g.lastTs || 0 }
    }).sort((a, b) => b.lastTs - a.lastTs),
    learning: {
      stats: learning.stats || {},
      history: learning.history || {}
    },
    predefined: {
      denyKeywords: DEFAULT_DENY_KEYWORDS,
      allowRules: DEFAULT_ALLOW_RULES,
      hardCategories: DEFAULT_HARD_CATEGORIES
    },
    setup: getSetupState()
  }
}

/** 检查权限预设是否已配置（供设置页初始化卡片） */
function getSetupState() {
  try {
    const text = readFileSync(PROFILE_PATCH_PATH, 'utf8')
    return { configured: text.includes('auto-approve:'), patchPath: PROFILE_PATCH_PATH }
  } catch (e) {
    return { configured: false, patchPath: PROFILE_PATCH_PATH, error: String((e && e.message) || e) }
  }
}

/** 一键初始化：在 cordis.patch.yml 中写入 auto-approve 权限预设（文本级操作，保留注释格式） */
function ensureAutoApprovePreset() {
  try {
    const text = readFileSync(PROFILE_PATCH_PATH, 'utf8')
    if (text.includes('auto-approve:')) return { ok: true, status: 'already', needRestart: false }

    const lines = text.split('\n')
    let permIdx = -1
    for (let i = 0; i < lines.length; i++) {
      if (/^- id:\s*permission\s*$/.test(lines[i])) { permIdx = i; break }
    }

    if (permIdx === -1) {
      // 无 permission 条目：追加完整预设块
      const next = text.replace(/\s*$/, '') + FULL_PERMISSION_BLOCK + AUTO_APPROVE_PRESET_YAML
      writeFileSync(PROFILE_PATCH_PATH, next, 'utf8')
      return { ok: true, status: 'added-entry', needRestart: true }
    }

    // 有 permission 条目：在其 presets 块末尾插入 auto-approve
    // presets 子项缩进 6；找到 presets: 后的最后一个缩进 ≥6 的连续行，在其后插入
    let presetsIdx = -1
    for (let i = permIdx; i < lines.length; i++) {
      if (/^ {4}presets:\s*$/.test(lines[i])) { presetsIdx = i; break }
      if (i > permIdx && /^- /.test(lines[i]) && !/^ {2,}- /.test(lines[i])) break // 下一个顶层条目
    }
    if (presetsIdx === -1) {
      // permission 条目存在但没有 presets 键：在 config 下补 presets（简化处理）
      return { ok: false, status: 'no-presets-key', needRestart: false, error: 'permission 条目缺少 presets 键，请手动添加' }
    }
    // 从 presetsIdx 往下找最后一个 presets 子项行（缩进 6 且非注释空行），直到顶层条目/文件尾
    let insertAt = presetsIdx
    for (let i = presetsIdx + 1; i < lines.length; i++) {
      const line = lines[i]
      if (/^ {6}\S/.test(line) || /^ {8}\S/.test(line)) { insertAt = i; continue }
      if (/^ {0,4}\S/.test(line) && !/^ {6,}\S/.test(line)) break // 缩进 <6 的非空行 = 离开 presets 区
      if (/^\s*$/.test(line)) continue
    }
    lines.splice(insertAt + 1, 0, AUTO_APPROVE_PRESET_YAML.replace(/\n$/, ''))
    writeFileSync(PROFILE_PATCH_PATH, lines.join('\n'), 'utf8')
    return { ok: true, status: 'added-preset', needRestart: true }
  } catch (e) {
    return { ok: false, status: 'error', needRestart: false, error: String((e && e.message) || e) }
  }
}

/** 规则修改：op=add|remove|set，kind=allowRules|denyRules|denyKeywords|hardCategories|riskyThreshold|judgeTimeoutMs */
function applyRuleOp(op, kind, value) {
  reloadConfig()

  // 数值类配置（阈值/超时）
  if (kind === 'riskyThreshold' || kind === 'judgeTimeoutMs' || kind === 'graduationThreshold' || kind === 'graduationSessions' || kind === 'promotionSessions' || kind === 'denyEscalateConsecutive' || kind === 'denyEscalateTotal' || kind === 'selfLearnThreshold' || kind === 'selfLearnSessions' || kind === 'selfLearnMaxRules') {
    if (op !== 'set') return { ok: false, error: `${kind} 使用 set 操作` }
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: '无效数值' }
    config[kind] = n
    saveJson(ALLOWLIST_PATH, config)
    audit(`CONFIG  ${kind} → ${n}`)
    return { ok: true, set: true, value: n }
  }

  if (kind === 'onboarded') {
    if (op !== 'set') return { ok: false, error: 'onboarded 使用 set 操作' }
    config.onboarded = value === true
    saveJson(ALLOWLIST_PATH, config)
    return { ok: true, set: true, value: config.onboarded }
  }
  if (kind === 'selfLearn') {
    if (op !== 'set') return { ok: false, error: 'selfLearn 使用 set 操作' }
    config.selfLearn = value === true
    saveJson(ALLOWLIST_PATH, config)
    return { ok: true, set: true, value: config.selfLearn }
  }
  if (kind === 'stage1Provider' || kind === 'stage1Model') {
    if (op !== 'set') return { ok: false, error: kind + ' 使用 set 操作' }
    config[kind] = String(value || '').trim()
    saveJson(ALLOWLIST_PATH, config)
    return { ok: true, set: true, value: config[kind] }
  }
  if (kind === 'twoStage') {
    if (op !== 'set') return { ok: false, error: 'twoStage 使用 set 操作' }
    config.twoStage = value !== false
    saveJson(ALLOWLIST_PATH, config)
    return { ok: true, set: true, value: config.twoStage }
  }
  if (kind === 'sessionMemory') {
    if (op !== 'set') return { ok: false, error: 'sessionMemory 使用 set 操作' }
    config.sessionMemory = value !== false
    saveJson(ALLOWLIST_PATH, config)
    return { ok: true, set: true, value: config.sessionMemory }
  }
  if (kind === 'graduation') {
    if (op !== 'remove') return { ok: false, error: 'graduation 仅支持 remove' }
    const sig = String(value || '')
    if (!sig || !memoryStore.graduation || !memoryStore.graduation[sig]) return { ok: false, error: '未找到该学习进度' }
    delete memoryStore.graduation[sig]
    saveJson(MEMORY_PATH, memoryStore)
    audit(`CONFIG  graduation - ${sig}`)
    return { ok: true, removed: true }
  }
  const list = config[kind]
  if (!Array.isArray(list)) {
    // 学习状态终止：kind='learning'，value=key（tool|mode|category）
    if (kind === 'learning') {
      if (op !== 'remove') return { ok: false, error: 'learning 仅支持 remove' }
      const key = String(value || '').trim()
      if (!key) return { ok: false, error: 'key 不能为空' }
      if (learning.stats[key] !== undefined || learning.history[key] !== undefined) {
        delete learning.stats[key]
        delete learning.history[key]
        saveJson(LEARNING_PATH, learning)
        audit(`LEARN   ${key} 用户终止学习`)
        return { ok: true, removed: true }
      }
      return { ok: false, error: '未找到该学习项' }
    }
    return { ok: false, error: `未知规则类型: ${kind}` }
  }

  if (op === 'toggle') {
    const v = value || {}
    let found = 0
    for (const r of list) {
      if (!r || typeof r !== 'object') continue
      if (r.tool !== v.tool) continue
      if ((r.mode || '') !== (v.mode || '')) continue
      if ((r.category || '') !== (v.category || '')) continue
      if (String(r.contains || '') !== String(v.contains || '')) continue
      if (v.signature !== undefined && r.signature !== v.signature && r.graduation !== true) continue
      r.disabled = r.disabled !== true
      found++
    }
    if (!found) return { ok: false, error: '未找到匹配的规则' }
    saveJson(ALLOWLIST_PATH, config)
    audit(`CONFIG  ${kind} toggle count=${found}`)
    return { ok: true, toggled: true, count: found }
  }

  if (op === 'add') {
    if (kind === 'denyKeywords' || kind === 'hardCategories' || kind === 'trustRoots') {
      const str = String(value || '').trim()
      if (!str) return { ok: false, error: '值不能为空' }
      if (!list.includes(str)) {
        list.push(str)
        audit(`CONFIG  ${kind} + ${str}`)
      }
    } else {
      if (!value || typeof value !== 'object') return { ok: false, error: '规则必须是对象' }
      const hasAny = value.tool || value.mode || value.category || value.contains
      if (!hasAny) return { ok: false, error: '规则至少需要 tool/mode/category/contains 之一' }
      const dup = list.some((r) => r && r.tool === value.tool && r.mode === value.mode && r.category === value.category && r.contains === value.contains)
      if (!dup) {
        if (!value.description) value.description = '用户自定义'
        if (!value.source) value.source = 'user'
        if (!value.createdAt) value.createdAt = Date.now()
        if (value.hitCount === undefined) value.hitCount = 0
        list.push(value)
        audit(`CONFIG  ${kind} + ${JSON.stringify(value)}`)
      }
    }
    saveJson(ALLOWLIST_PATH, config)
    return { ok: true, added: true }
  }

  if (op === 'remove') {
    const before = list.length
    if (kind === 'denyKeywords' || kind === 'hardCategories' || kind === 'trustRoots') {
      const str = String(value || '').trim()
      for (let i = list.length - 1; i >= 0; i--) if (String(list[i]) === str) list.splice(i, 1)
      if (list.length !== before) audit(`CONFIG  ${kind} - ${str}`)
    } else {
      const v = value || {}
      for (let i = list.length - 1; i >= 0; i--) {
        const r = list[i] || {}
        if (r.tool === v.tool && r.mode === v.mode && r.category === v.category && r.contains === v.contains && (v.signature === undefined || r.signature === v.signature)) list.splice(i, 1)
      }
      if (list.length !== before) audit(`CONFIG  ${kind} - ${JSON.stringify(v)}`)
    }
    if (list.length === before) return { ok: false, error: '未找到匹配的规则' }
    saveJson(ALLOWLIST_PATH, config)
    return { ok: true, removed: true }
  }

  return { ok: false, error: `未知操作: ${op}` }
}

const CATEGORY_LABELS = {
  deletion: '删除/覆盖不可再生数据',
  credential: '凭据/密钥/授权修改',
  remote: '远程系统/生产环境/数据库',
  system: '系统级路径/配置',
  bulk: '批量不可回补操作',
  neutral: '中立（无硬风险特征）'
}

const SYSTEM_PROMPT = [
  '你是 AI 编程代理的操作风险评估器。DSH 的审批只发生在「沙箱越界」时，即命令需要比当前更宽的权限才能执行。',
  '',
  '你将收到：工具名、请求升级的目标沙箱模式、操作理由（justification）；若提供了「工具调用参数」，以参数为准。',
  '沙箱模式含义：',
  '- workspace-write：允许写当前工作区（可回补，通常安全）',
  '- danger-full-access：允许写任意文件/系统（不可回补风险高）',
  '',
  '输出规则（只输出一个词，SAFE 或 RISKY:<类别>）：',
  '- SAFE：操作不会造成不可回补后果，且不触碰敏感资源。例如：',
  '   工作区内常规读写、安装/构建、git 常规操作、可再生的临时数据、可撤销的修改、',
  '   个人目录（home）下的配置/项目文件常规编辑（可回补）',
  '- RISKY:<类别>：操作可能造成不可回补后果或触碰敏感资源，类别必须是以下之一：',
  '   deletion —— 删除/覆盖不可再生数据、rm 类危险删除',
  '   credential —— 修改/写入凭据、密钥、token、API key、授权配置',
  '   remote —— 影响远程系统/生产环境/数据库、发送消息/扣费、对外发布',
  '   system —— 系统级路径（/etc、/usr、启动项）、系统配置、shutdown/重启类',
  '   bulk —— 批量覆盖大量文件、格式化、dd 类不可回补操作',
  '   neutral —— 以上都不符合（如：工作区外普通文件的常规编辑、模型不确定但无明显硬风险）',
  '',
  '判定原则：',
  '- 优先按「工具调用参数」的实际效果判断；没有参数时才参考 justification（它是模型自述，可能不准）',
  '- 可回补、常规、不触碰敏感资源的操作 → SAFE',
  '- 工作区外写入（如 ~/.dsh、个人项目仓库）本身不构成硬风险：判断的是操作内容，不是路径位置',
  '- 拿不准、但无删除/凭据/远程/系统/批量特征的 → neutral（这是误判补偿区，系统会计数后请用户裁决）',
  '',
  '只输出一个词：SAFE 或 RISKY:<类别>。不要输出任何其他内容。'
].join('\n')

function ensureDataDir() {
  try { mkdirSync(DATA_DIR, { recursive: true }) } catch { /* 目录创建失败不影响主流程 */ }
}

function loadJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.error(`[${NAME}] 读取 ${path} 失败，用默认值`, error)
    return fallback
  }
}

function saveJson(path, data) {
  try {
    ensureDataDir()
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
  } catch (error) {
    console.error(`[${NAME}] 写入 ${path} 失败`, error)
  }
}

function audit(line) {
  try {
    ensureDataDir()
    appendFileSync(AUDIT_PATH, `[${new Date().toISOString()}] ${line}\n`, 'utf8')
  } catch { /* 审计失败不影响主流程 */ }
}

// 首次加载时初始化配置文件；旧版（v1）自动补齐 v3 字段
function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {}
  cfg.denyKeywords = cfg.denyKeywords || DEFAULT_DENY_KEYWORDS
  cfg.allowRules = (cfg.allowRules || DEFAULT_ALLOW_RULES).map(decorateRule)
  cfg.denyRules = cfg.denyRules || []
  cfg.hardCategories = cfg.hardCategories || DEFAULT_HARD_CATEGORIES
  cfg.riskyThreshold = cfg.riskyThreshold || 3
  cfg.judgeTimeoutMs = cfg.judgeTimeoutMs || 20000
  cfg.learning = cfg.learning || { enabled: true }
  cfg.trustRoots = Array.isArray(cfg.trustRoots) ? cfg.trustRoots : []
  cfg.sessionMemory = cfg.sessionMemory !== false
  cfg.promotionSessions = Number.isFinite(cfg.promotionSessions) && cfg.promotionSessions > 0 ? cfg.promotionSessions : 2
  cfg.graduationThreshold = Number.isFinite(cfg.graduationThreshold) && cfg.graduationThreshold > 0 ? cfg.graduationThreshold : 3
  cfg.graduationSessions = Number.isFinite(cfg.graduationSessions) && cfg.graduationSessions > 0 ? cfg.graduationSessions : 2
  cfg.twoStage = cfg.twoStage === true
  cfg.denyEscalateConsecutive = Number.isFinite(cfg.denyEscalateConsecutive) && cfg.denyEscalateConsecutive > 0 ? cfg.denyEscalateConsecutive : 3
  cfg.denyEscalateTotal = Number.isFinite(cfg.denyEscalateTotal) && cfg.denyEscalateTotal > 0 ? cfg.denyEscalateTotal : 20
  cfg.stage1Provider = typeof cfg.stage1Provider === 'string' ? cfg.stage1Provider : ''
  cfg.stage1Model = typeof cfg.stage1Model === 'string' ? cfg.stage1Model : ''
  cfg.selfLearn = cfg.selfLearn === true
  cfg.onboarded = cfg.onboarded === true
  cfg.selfLearnThreshold = Number.isFinite(cfg.selfLearnThreshold) && cfg.selfLearnThreshold > 0 ? cfg.selfLearnThreshold : 5
  cfg.selfLearnSessions = Number.isFinite(cfg.selfLearnSessions) && cfg.selfLearnSessions > 0 ? cfg.selfLearnSessions : 2
  cfg.selfLearnMaxRules = Number.isFinite(cfg.selfLearnMaxRules) && cfg.selfLearnMaxRules > 0 ? cfg.selfLearnMaxRules : 50
  return cfg
}

let config = loadJson(ALLOWLIST_PATH, null)
if (!config || typeof config !== 'object') {
  config = {
    version: 3,
    denyKeywords: DEFAULT_DENY_KEYWORDS,
    allowRules: DEFAULT_ALLOW_RULES,
    denyRules: [],
    hardCategories: DEFAULT_HARD_CATEGORIES,
    riskyThreshold: 3,
    judgeTimeoutMs: 20000,
    learning: { enabled: true },
    trustRoots: [],
    sessionMemory: true,
    promotionSessions: 2,
    graduationThreshold: 3,
    graduationSessions: 2,
    twoStage: false,
    denyEscalateConsecutive: 3,
    denyEscalateTotal: 20,
    stage1Provider: '',
    stage1Model: '',
    selfLearn: false,
    onboarded: false,
    selfLearnThreshold: 5,
    selfLearnSessions: 2,
    selfLearnMaxRules: 50
  }
  saveJson(ALLOWLIST_PATH, config)
} else {
  config = normalizeConfig(config)
  if (config.version !== 3) { config.version = 3; saveJson(ALLOWLIST_PATH, config) }
}

// 热更新：每次审批前重新读盘 allowlist.json（小文件、审批频率低，无性能问题），
// 使手动修改配置无需重启即可生效
function reloadConfig() {
  const disk = loadJson(ALLOWLIST_PATH, null)
  if (disk && typeof disk === 'object') {
    const prev = config
    config = normalizeConfig(disk)
    if (!config.version) config.version = prev.version || 3
    learning.enabled = config.learning.enabled !== false
  }
}

// 按 id 找审批事件；id 可能因热重载竞态重复，允许用 tool/mode/justification 精确消歧
function findApprovalEvent(eventId, body) {
  let fallback = null
  try {
    for (const line of readFileSync(EVENTS_PATH, 'utf8').split('\n')) {
      if (!line.trim()) continue
      let ev
      try { ev = JSON.parse(line) } catch { continue }
      if (Number(ev.id) !== eventId) continue
      if (!fallback) fallback = ev
      if (body && typeof body.justification === 'string') {
        const j = String(ev.justification || ev.reason || '')
        if (j === body.justification && (!body.tool || String(ev.tool || '') === String(body.tool))) return ev
      }
    }
  } catch { /* 读取失败 */ }
  return fallback
}
// ---- 拒绝计数与升级（deny-and-continue）：连续 3 次或累计 20 次拒绝 → 提示人工介入 ----
const rejectCounters = new Map() // sessionId -> { consecutive, total }
function recordOutcome(sid, tool, mode, reason, justification, category, outcome) {
  if (!sid) return
  let c = rejectCounters.get(sid)
  if (!c) { c = { consecutive: 0, total: 0 }; rejectCounters.set(sid, c) }
  if (outcome === 'allowed-once') { c.consecutive = 0; return }
  if (outcome !== 'rejected') return
  c.consecutive += 1
  c.total += 1
  const limitC = config.denyEscalateConsecutive || 3
  const limitT = config.denyEscalateTotal || 20
  if (c.consecutive === limitC || c.total === limitT) {
    recordApprovalEvent(sid, tool, mode, reason, justification, 'escalated', {
      kind: 'escalate', category: category || '', path: 'escalate', consecutive: c.consecutive, total: c.total,
    })
    audit(`ESCALATE ${sid} tool=${tool} consecutive=${c.consecutive} total=${c.total} → 建议人工介入`)
  }
  if (rejectCounters.size > 100) { const first = rejectCounters.keys().next().value; rejectCounters.delete(first) }
}
// ---- 自动学习：会话内批准记忆 + 跨会话晋升 + 负反馈（无需人工点击） ----
let memoryStore = loadJson(MEMORY_PATH, { cross: {} })
if (!memoryStore || typeof memoryStore !== 'object') memoryStore = { cross: {} }
if (!memoryStore.cross || typeof memoryStore.cross !== 'object') memoryStore.cross = {}
if (!memoryStore.graduation || typeof memoryStore.graduation !== 'object') memoryStore.graduation = {}
if (!memoryStore.selfLearn || typeof memoryStore.selfLearn !== 'object') memoryStore.selfLearn = {}
const sessionMemory = new Map() // sessionId -> Map<sig, {tool, mode, fp, category, ts}>
const MEMORY_TTL_MS = 12 * 60 * 60 * 1000
function memoryKey(tool, mode, fp) { return `${tool}|${mode || 'none'}|${String(fp || '')}` }
function sessionMemoryHit(sessionId, tool, mode, fp) {
  if (!config.sessionMemory || !fp) return null
  const m = sessionMemory.get(sessionId)
  if (!m) return null
  const entry = m.get(memoryKey(tool, mode, fp))
  if (!entry) return null
  if (Date.now() - entry.ts > MEMORY_TTL_MS) { m.delete(memoryKey(tool, mode, fp)); return null }
  if (entry.category !== 'neutral') return null
  return entry
}
function rememberApproved(sessionId, tool, mode, fp, category, justification) {
  if (!config.sessionMemory || category !== 'neutral' || !fp) return null
  let m = sessionMemory.get(sessionId)
  if (!m) { m = new Map(); sessionMemory.set(sessionId, m) }
  m.set(memoryKey(tool, mode, fp), { tool, mode, fp, category, ts: Date.now() })
  const key = memoryKey(tool, mode, fp)
  const prev = memoryStore.cross[key] || { tool, mode, fp, category, sessions: {}, count: 0, lastTs: 0 }
  prev.sessions = prev.sessions || {}
  prev.sessions[sessionId] = Date.now()
  prev.count = (prev.count || 0) + 1
  prev.lastTs = Date.now()
  memoryStore.cross[key] = prev
  saveJson(MEMORY_PATH, memoryStore)
  const sessions = Object.keys(prev.sessions).length
  // 跨会话沉淀只接受路径指纹，避免把泛词（如 commit/review）变成全局白名单
  const safeForRule = /[\/~]/.test(String(fp))
  const denyHit = (config.denyRules || []).some((r) => matchRule([r], tool, mode, 'neutral', justification))
  const intentOk = explicitIntent(justification)
  const requiredSessions = intentOk ? (config.promotionSessions || 2) : Math.max((config.promotionSessions || 2) + 1, 3)
  if (sessions >= requiredSessions && safeForRule && !denyHit) {
    const exists = (config.allowRules || []).some((r) => r.tool === tool && (r.mode || '') === (mode || '') && String(r.contains || '') === fp)
    if (!exists) {
      const rule = { tool, contains: fp, description: '自动沉淀：跨会话人工确认' }
      if (mode) rule.mode = mode
      config.allowRules.push(rule)
      saveJson(ALLOWLIST_PATH, config)
      audit(`PROMOTE ${key} 跨会话 ${sessions} 次人工确认，已沉淀白名单 ${JSON.stringify(rule)}`)
    }
    return { promoted: true, sessions }
  }
  if (sessions >= (config.promotionSessions || 2) && (!safeForRule || denyHit || !intentOk)) {
    audit(`PROMOTE-SKIP ${key} sessions=${sessions} path=${safeForRule} deny=${denyHit} intent=${intentOk}`)
  }
  return { promoted: false, sessions }
}
// 自学习：从 Flash 的 SAFE 判定中学习（不需要人工确认）；有路径签名、无拒绝历史、跨会话才毕业
function recordSelfObservation(sessionId, toolName, mode, justification, eventId) {
  if (config.selfLearn !== true) return null
  const sig = opSignature(toolName, mode, justification)
  if (!sig) return null
  const denyHit = (config.denyRules || []).some((r) => matchRule([r], toolName, mode, 'neutral', justification))
  if (denyHit) return null
  const prev = memoryStore.selfLearn[sig] || {
    tool: toolName, mode: mode || '', patterns: signaturePaths(justification),
    count: 0, sessions: {}, events: [], lastTs: 0,
  }
  prev.sessions = prev.sessions || {}
  prev.sessions[sessionId] = Date.now()
  prev.count = (prev.count || 0) + 1
  prev.lastTs = Date.now()
  prev.events = (prev.events || []).concat(eventId === undefined ? [] : [eventId]).slice(-10)
  memoryStore.selfLearn[sig] = prev
  saveJson(MEMORY_PATH, memoryStore)
  const threshold = config.selfLearnThreshold || 5
  const sessions = Object.keys(prev.sessions).length
  if (prev.count >= threshold && sessions >= (config.selfLearnSessions || 2)) {
    const exists = (config.allowRules || []).some((r) => r && r.signature === sig && (r.graduation || r.source === 'self-learned'))
    if (!exists) {
      const selfCount = (config.allowRules || []).filter((r) => r && r.source === 'self-learned').length
      if (selfCount >= (config.selfLearnMaxRules || 50)) {
        audit(`SELFLEARN-CAP ${sig} 已达自学习规则上限 ${config.selfLearnMaxRules || 50}`)
        return { graduated: false, count: prev.count, sessions, capped: true }
      }
      const rule = {
        tool: toolName, signature: sig, source: 'self-learned',
        description: `自学习：Flash 连续 SAFE ${prev.count} 次（${sessions} 个会话）`,
        createdAt: Date.now(), hitCount: 0, evidenceEventIds: (prev.events || []).slice(-5),
      }
      if (mode) rule.mode = mode
      config.allowRules.push(rule)
      saveJson(ALLOWLIST_PATH, config)
      audit(`SELFLEARN ${sig} count=${prev.count} sessions=${sessions} 已沉淀自学习规则`)
    }
    return { graduated: true, count: prev.count, sessions }
  }
  return { graduated: false, count: prev.count, sessions }
}
function recordSignatureApproval(sessionId, toolName, mode, justification) {
  const sig = opSignature(toolName, mode, justification)
  if (!sig) return null
  const prev = memoryStore.graduation[sig] || {
    tool: toolName, mode: mode || '', patterns: signaturePaths(justification),
    count: 0, sessions: {}, lastTs: 0,
  }
  prev.sessions = prev.sessions || {}
  prev.sessions[sessionId] = Date.now()
  const fpNow = extractOperationFingerprint(justification) || ''
  prev.fps = Array.isArray(prev.fps) ? prev.fps : []
  if (fpNow && prev.fps.indexOf(fpNow) < 0) prev.fps.push(fpNow)
  prev.count = (prev.count || 0) + 1
  prev.lastTs = Date.now()
  memoryStore.graduation[sig] = prev
  saveJson(MEMORY_PATH, memoryStore)
  const threshold = config.graduationThreshold || 3
  const sessions = Object.keys(prev.sessions).length
  const distinctFps = (prev.fps || []).length
  const denyHit = (config.denyRules || []).some((r) => matchRule([r], toolName, mode, 'neutral', justification))
  const intentOk = explicitIntent(justification)
  const needCount = intentOk ? threshold : threshold + 1
  if (prev.count >= needCount && sessions >= (config.graduationSessions || 2) && distinctFps >= 2 && !denyHit) {
    const exists = (config.allowRules || []).some((r) => r && r.graduation && r.signature === sig)
    if (!exists) {
      const rule = {
        tool: toolName, graduation: true, signature: sig,
        description: `自动毕业：同类操作累计 ${prev.count} 次人工确认（${sessions} 个会话）`,
        source: 'graduated',
        createdAt: Date.now(),
        hitCount: 0,
      }
      if (mode) rule.mode = mode
      config.allowRules.push(rule)
      saveJson(ALLOWLIST_PATH, config)
      audit(`GRADUATE ${sig} count=${prev.count} sessions=${sessions} 已沉淀毕业规则`)
    }
    return { graduated: true, count: prev.count, sessions }
  }
  if (prev.count >= threshold && (distinctFps < 2 || denyHit || !intentOk)) {
    audit(`GRADUATE-SKIP ${sig} count=${prev.count} sessions=${sessions} fps=${distinctFps} deny=${denyHit} intent=${intentOk}`)
  }
  return { graduated: false, count: prev.count, sessions }
}
function demoteLearned(tool, mode, fp, why, justification) {
  let removed = 0
  if (fp) {
    const before = (config.allowRules || []).length
    config.allowRules = (config.allowRules || []).filter((r) => !(r && r.tool === tool && (r.mode || '') === (mode || '') && String(r.contains || '') === fp))
    removed += before - config.allowRules.length
    const key = memoryKey(tool, mode, fp)
    if (memoryStore.cross[key]) { delete memoryStore.cross[key]; saveJson(MEMORY_PATH, memoryStore); removed += 1 }
    for (const m of sessionMemory.values()) m.delete(key)
    const sig = opSignature(tool, mode, justification)
    if (sig) {
      if (memoryStore.graduation[sig]) { delete memoryStore.graduation[sig]; saveJson(MEMORY_PATH, memoryStore); removed += 1 }
      if (memoryStore.selfLearn[sig]) { delete memoryStore.selfLearn[sig]; saveJson(MEMORY_PATH, memoryStore); removed += 1 }
      const beforeSig = (config.allowRules || []).length
      config.allowRules = (config.allowRules || []).filter((r) => !(r && r.signature === sig && (r.graduation || r.source === 'self-learned')))
      removed += beforeSig - config.allowRules.length
    }
    if (removed) {
      saveJson(ALLOWLIST_PATH, config)
      audit(`NEGATIVE ${tool} mode=${mode || 'none'} fp=${fp} why=${why} 已撤销 ${removed} 条学习记录/规则`)
    }
  }
  return removed
}
function trustHit(justification) {
  const roots = Array.isArray(config.trustRoots) ? config.trustRoots : []
  if (roots.length === 0) return null
  const text = String(justification || '')
  const paths = []
  for (const m of text.matchAll(/(?:~\/|\/)[\w@.\/-]+/g)) paths.push(m[0])
  if (paths.length === 0) return null
  for (const raw of paths) {
    const abs = resolveAbsPath(raw, '')
    for (const root of roots) {
      const r = String(root || '').trim()
      if (!r) continue
      const rabs = resolveAbsPath(r, '')
      if (abs === rabs || abs.startsWith(rabs.endsWith('/') ? rabs : rabs + '/')) return r
    }
  }
  return null
}

const learning = loadJson(LEARNING_PATH, { enabled: true, stats: {}, history: {} })
// enabled 以 allowlist.json 的 learning 段为单一配置源（旧 learning.json 的 enabled 仅作兼容回退）
learning.enabled = config.learning ? config.learning.enabled !== false : learning.enabled !== false
learning.stats = learning.stats || {}
// history：每个 key 最近人工确认过的操作样本（最多 10 个）：
//   { fp: 操作指纹（路径/文件名/项目名，可空）, ctx: 操作背景和目的（justification 摘要） }
// 供「flash 第三方同类验证」判断新操作是否与已确认样本同类。
// 兼容旧格式：字符串数组 → { fp, ctx } 对象数组
learning.history = learning.history || {}
for (const k of Object.keys(learning.history)) {
  if (!Array.isArray(learning.history[k])) learning.history[k] = []
  learning.history[k] = learning.history[k]
    .map((s) => typeof s === 'string' ? { fp: s, ctx: s } : s)
    .filter((s) => s && typeof s === 'object')
    .slice(-10)
}

function looksDeny(text) {
  const lower = String(text || '').toLowerCase()
  const keywords = config.denyKeywords || DEFAULT_DENY_KEYWORDS
  return keywords.some((keyword) => lower.includes(String(keyword).toLowerCase()))
}

// reason 格式：`escalate sandbox to <mode>: <justification>`
function parseReason(reason) {
  const m = String(reason || '').match(/escalate\s+sandbox\s+to\s+([^\s:]+):?\s*([\s\S]*)/i)
  if (m) return { mode: m[1], justification: (m[2] || '').trim() }
  return { mode: '', justification: String(reason || '') }
}

// 规则匹配：tool / mode / category / contains 均满足（缺省表示任意）
// 操作签名：工具 + 模式 + 归一化路径模式（目录 + 扩展名），用于泛化「同类但指纹不同」的操作
function signaturePaths(text) {
  const s = String(text || '')
  const out = new Set()
  for (const m of s.matchAll(/(?:~\/|\/)[\w@.\/-]+/g)) {
    const raw = m[0].replace(/[，。；、,.;:：\s]+$/g, '')
    if (!raw || raw.length < 4) continue
    const abs = resolveAbsPath(raw, '')
    let p = abs
    const home = homedir()
    if (p === home || p.startsWith(home + '/')) p = '~' + p.slice(home.length)
    const slash = p.lastIndexOf('/')
    const dir = slash > 0 ? p.slice(0, slash) : p
    const base = slash >= 0 ? p.slice(slash + 1) : p
    const dot = base.lastIndexOf('.')
    const ext = dot > 0 ? base.slice(dot) : ''
    out.add(dir + '/*' + ext)
  }
  return Array.from(out).sort()
}
function opSignature(toolName, mode, justification) {
  const patterns = signaturePaths(justification)
  if (patterns.length === 0) return null
  return `${toolName}|${mode || 'none'}|${patterns.join(',')}`
}
function matchRule(rules, toolName, mode, category, justification) {
  const list = rules || []
  const j = String(justification || '').toLowerCase()
  for (const rule of list) {
    if (rule.disabled === true) continue
    if (rule.tool && rule.tool !== toolName) continue
    if (rule.mode && rule.mode !== mode) continue
    if (rule.category && rule.category !== category) continue
    if (rule.signature && rule.signature !== opSignature(toolName, mode, justification)) continue
    if (rule.contains && !j.includes(String(rule.contains).toLowerCase())) continue
    return rule
  }
  return null
}

// 用户意图信号：理由里是否明确说明是用户要求（用于学习晋升/毕业的额外证据）
function explicitIntent(text) {
  return /用户(要求|指示|选择|确认|同意|批准|让我|要求我)|按用户|用户已|用户同意|user (asked|requested|approved|confirmed)/i.test(String(text || ''))
}
// 工具参数脱敏 + 截断（送给 Flash 判定用）
function redactArgs(text) {
  let out = String(text || '')
  out = out.replace(/("(?:[^"]*(?:api[_-]?key|token|secret|password|passwd|authorization|cookie)[^"]*)"\s*:\s*")[^"]*(")/gi, '$1***$2')
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1***')
  return out.slice(0, 4000)
}
// 过宽规则扫描：只提示不自动删（项目名等合法短词会误报）
const GENERIC_CONTAINS = new Set(['commit', 'review', 'ticket', 'partial', 'merge', 'push', 'deploy', 'install', 'update', 'build', 'test', 'fix', 'sync', 'clean', 'copy', 'move', 'delete', 'remove', 'change', 'config', 'profile', 'scripts', 'docs', 'main', 'master', 'pr', 'prs', 'crud', 'api'])
function ruleReasons(rule) {
  const reasons = []
  if (!rule || typeof rule !== 'object') return reasons
  const c = String(rule.contains || '')
  const hasPath = /[\/~]/.test(c)
  if (rule.source === 'default' || String(rule.description || '').indexOf('工作区写入') >= 0) return reasons
  if (!rule.tool && !c && !rule.category && !rule.signature) reasons.push('未限定 tool/contains，等于放行整个模式')
  if (c && !hasPath && c.length <= 12) {
    if (GENERIC_CONTAINS.has(c.toLowerCase())) reasons.push('contains 是通用词「' + c + '」，会匹配到未确认的操作')
    else reasons.push('contains 是不含路径/文件名的短词「' + c + '」，可能过宽')
  }
  if (rule.mode === 'danger-full-access' && !rule.tool && !c && !rule.signature) reasons.push('danger-full-access 裸规则')
  return reasons
}
function ruleSuggestion(rule) {
  const c = String(rule && rule.contains || '')
  const hasPath = /[\/~]/.test(c)
  if (!rule.tool) return '补上 tool 限定（如 bash/edit），并把 contains 换成具体路径或文件名'
  if (c && !hasPath) return '删除该规则，改为对具体操作点「记住」生成路径指纹；或在 ⑦ 规则库 → 信任目录 添加或配置 trustRoots 限定目录'
  if (rule.mode === 'danger-full-access' && !c) return '加 contains（具体路径）或改用 trustRoots'
  return '收窄条件（tool + mode + 具体路径/文件名）'
}
function scanOverbroadRules() {
  const allowRules = (config.allowRules || []).map((rule, index) => {
    const reasons = ruleReasons(rule)
    return reasons.length ? { index, rule, reasons, suggestion: ruleSuggestion(rule) } : null
  }).filter(Boolean)
  const trustRoots = []
  for (const root of Array.isArray(config.trustRoots) ? config.trustRoots : []) {
    const abs = resolveAbsPath(root, '')
    if (abs === homedir() || abs === '/' || abs === '/Users' || abs === '/tmp') {
      trustRoots.push({ root, reasons: ['信任目录范围过大：' + abs] })
    }
  }
  return { allowRules, trustRoots }
}
// 规则元数据：来源 / 创建时间 / 命中次数 / 最近命中
function ruleSourceOf(rule) {
  const d = String((rule && rule.description) || '')
  if (rule && rule.graduation) return 'graduated'
  if (d.indexOf('用户记住') === 0) return 'remember'
  if (d.indexOf('自动沉淀') === 0 || d.indexOf('人工确认后') >= 0 || d.indexOf('flash 同类') >= 0 || d.indexOf('自动毕业') === 0) return 'learned'
  if (d === '用户自定义') return 'user'
  return 'default'
}
function decorateRule(rule) {
  if (!rule || typeof rule !== 'object') return rule
  if (!rule.source) rule.source = ruleSourceOf(rule)
  if (rule.hitCount === undefined) rule.hitCount = 0
  if (rule.disabled === undefined) rule.disabled = false
  return rule
}
function touchRuleHit(rule) {
  try {
    rule.hitCount = (rule.hitCount || 0) + 1
    rule.lastHit = Date.now()
    saveJson(ALLOWLIST_PATH, config)
  } catch { /* 统计失败不影响放行 */ }
}
// 计数/学习 key：tool|mode|category（category 为 flash 判定的类别，neutral 走计数）
function learnKey(toolName, mode, category) {
  return `${toolName}|${mode || 'none'}|${category || 'none'}`
}

// 从 justification 提取「操作指纹」：路径 / 文件名 / 项目名等有区分度的片段。
// 沉淀/拒绝规则必须携带指纹，避免宽规则（如 edit+danger 放行所有工作区外编辑）
// 误放行用户未确认过的其他操作。提取不到 → 返回 null（调用方决定不沉淀）。
const GENERIC_EN_WORDS = new Set([
  'update', 'updates', 'updating', 'updated', 'install', 'installs', 'installing',
  'deploy', 'deploys', 'deploying', 'sync', 'syncing', 'copy', 'copies', 'move',
  'remove', 'removes', 'adding', 'change', 'changes', 'changing', 'set', 'clean',
  'test', 'verify', 'check', 'fix', 'fixes', 'fixing', 'modify', 'modifies'
])
// 记住规则专用指纹：只接受路径/目录片段（含 / 或 ~），避免 "commit"/"review" 这类泛词变成过宽规则
function pathFingerprint(text) {
  const s = String(text || '')
  const candidates = []
  for (const m of s.matchAll(/(?:~\/|\/)[\w@.\/-]+/g)) {
    const seg = m[0].replace(/[，。；、,.;:：\s]+$/g, '').trim()
    if (seg.length >= 5 && seg.length <= 120) candidates.push(seg)
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.length - a.length)
  return candidates[0].slice(0, 80)
}
// 记住规则指纹：优先路径片段；没有路径时退化为整条操作描述（截断），避免直接报错
function rememberFingerprint(text) {
  const p = pathFingerprint(text)
  if (p) return p
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (s.length < 8) return null
  return s.slice(0, 120)
}
function extractOperationFingerprint(text) {
  const s = String(text || '')
  const candidates = []
  // 1. 显式路径片段：~/xxx、/xxx/yyy、相对路径（含至少一段目录或文件名）
  for (const m of s.matchAll(/(?:~\/|\/|\.\/)?[\w@.-]+\/[\w@.\/-]+/g)) {
    const seg = m[0].replace(/[，。；、,.;:：\s]+$/g, '').trim()
    if (seg.length >= 5 && seg.length <= 80) candidates.push(seg)
  }
  // 2. 带扩展名的文件名：xxx.md/.js/.json/.yml/.env 等
  for (const m of s.matchAll(/[\w@.-]+\.(?:md|js|json|ya?ml|env|txt|py|ts|css|html|log|mjs|cjs)/gi)) {
    const seg = m[0]
    if (seg.length >= 4 && seg.length <= 60) candidates.push(seg)
  }
  // 3. 连字符/点分隔的项目或插件名（2-4 段英文标识符）
  for (const m of s.matchAll(/\b[a-z][\w-]*(?:[-.][a-z][\w-]*){1,3}\b/gi)) {
    const seg = m[0]
    if (seg.length >= 6 && seg.length <= 50 && !/^(workspace-write|danger-full-access)$/i.test(seg)) {
      candidates.push(seg)
    }
  }
  // 4. 单段英文标识符（≥5 字符，排除通用动词/操作词）：README、config 等文档/配置名
  for (const m of s.matchAll(/\b[a-z][a-z0-9-]{4,}\b/gi)) {
    const seg = m[0]
    if (GENERIC_EN_WORDS.has(seg.toLowerCase())) continue
    if (seg.length <= 40) candidates.push(seg)
  }
  if (candidates.length === 0) return null
  // 取最长片段（最长最有区分度），截断防超长
  candidates.sort((a, b) => b.length - a.length)
  return candidates[0].slice(0, 60)
}

export default {
  name: NAME,
  inject: ['llm', 'approval', 'permissionPresets', 'agentDefaultModel', 'timer', 'webServer'],
  apply(ctx) {
    const llm = ctx.llm
    const permissionPresets = ctx.permissionPresets
    const agentDefaultModel = ctx.get('agentDefaultModel')
    const PRESET_NAME = 'auto-approve'

    // ---- 真实工具调用缓存：approval 请求带 callId，用它取实际参数（而不是模型自述） ----
    const callCache = new Map() // sessionId -> Map<callId, { name, arguments, ts }>
    const CALL_CACHE_MAX = 400
    const SESSION_CACHE_MAX = 60
    try {
      ctx.on('session/event', (session, event) => {
        try {
          if (!event || event.type !== 'tool/call') return
          const sid = session && session.id ? String(session.id) : ''
          if (!sid) return
          const data = event.data || {}
          if (!data.callId) return
          let m = callCache.get(sid)
          if (!m) {
            m = new Map()
            callCache.set(sid, m)
            while (callCache.size > SESSION_CACHE_MAX) {
              const first = callCache.keys().next().value
              callCache.delete(first)
            }
          }
          const cid = String(data.callId)
          m.delete(cid)
          m.set(cid, { name: String(data.name || ''), arguments: String(data.arguments || '').slice(0, 8000), ts: Date.now() })
          while (m.size > CALL_CACHE_MAX) { m.delete(m.keys().next().value) }
        } catch (error) { /* 缓存失败不影响审批 */ }
      })
    } catch (error) {
      console.error(`[${NAME}] session/event 订阅失败，将回落 justification 判定`, error)
    }
    const getToolCall = (sid, callId) => {
      const m = callCache.get(String(sid))
      return m ? m.get(String(callId)) || null : null
    }

    // ---- 自动放行事件 API（client 审查界面轮询；按会话过滤 + since 增量） ----
    let offEventsRoute = null
    try {
      if (ctx.webServer && typeof ctx.webServer.register === 'function') {
        offEventsRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/events',
          handler: async (req, res) => {
            if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
            const url = new URL(req.url, 'http://localhost')
            const sessionId = url.searchParams.get('sessionId') || ''
            const since = Number.parseInt(url.searchParams.get('since') || '0', 10) || 0
            const events = []
            reloadConfig()
            try {
              const text = readFileSync(EVENTS_PATH, 'utf8')
              for (const line of text.split('\n')) {
                if (!line.trim()) continue
                try {
                  const ev = JSON.parse(line)
                  if (!Number.isInteger(ev.id) || ev.id <= since) continue
                  if (sessionId && ev.sessionId !== sessionId) continue
                  // 该事件是否已有「记住」规则（按工具+模式+操作指纹精确匹配），供界面按钮还原状态
                  const fp = rememberFingerprint(ev.justification || ev.reason || '')
                  const remembered = Boolean(fp) && (config.allowRules || []).some((r) => r && !r.category && r.tool === ev.tool && (r.mode || '') === (ev.mode || '') && String(r.contains || '') === fp)
                  events.push(Object.assign({}, ev, { remembered }))
                } catch { /* 跳过坏行 */ }
              }
            } catch { /* events 文件不存在：返回空 */ }
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
            res.end(JSON.stringify({ events }))
          },
        })
        console.log(`[${NAME}] 事件 API 已注册：/api/auto-approve/events`)
      } else {
        console.warn(`[${NAME}] webServer 不可用，审查事件 API 未注册`)
      }
    } catch (error) {
      console.error(`[${NAME}] 注册事件 API 失败`, error)
    }

    // ---- 规则管理 API（设置页：查看/修改放行与阻塞规则 + 一键初始化） ----
    let offRulesRoute = null
    let offSetupRoute = null
    let offRememberRoute = null
    let offForgetRoute = null
    let offCountersRoute = null
    let offCountersResetRoute = null
    try {
      if (ctx.webServer && typeof ctx.webServer.register === 'function') {
        offRulesRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/rules',
          handler: async (req, res) => {
            const send = (code, obj) => {
              res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
              res.end(JSON.stringify(obj))
            }
            try {
              if (req.method === 'GET' || req.method === 'HEAD') {
                return send(200, getRulesSnapshot())
              }
              if (req.method === 'POST') {
                const body = await readBody(req)
                const op = String(body.op || '')
                const kind = String(body.kind || '')
                const result = applyRuleOp(op, kind, body.value)
                return send(result.ok ? 200 : 400, result)
              }
              return send(405, { ok: false, error: 'method not allowed' })
            } catch (e) {
              send(400, { ok: false, error: String((e && e.message) || e) })
            }
          },
        })
        offSetupRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/setup',
          handler: async (req, res) => {
            const send = (code, obj) => {
              res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
              res.end(JSON.stringify(obj))
            }
            try {
              if (req.method === 'GET' || req.method === 'HEAD') {
                return send(200, getSetupState())
              }
              if (req.method === 'POST') {
                return send(200, ensureAutoApprovePreset())
              }
              return send(405, { ok: false, error: 'method not allowed' })
            } catch (e) {
              send(400, { ok: false, error: String((e && e.message) || e) })
            }
          },
        })
        offRememberRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/remember',
          handler: async (req, res) => {
            const send = (code, obj) => {
              res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
              res.end(JSON.stringify(obj))
            }
            try {
              if (req.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' })
              const body = await readBody(req)
              const eventId = Number(body.eventId)
              if (!Number.isFinite(eventId)) return send(400, { ok: false, error: 'eventId 无效' })
              reloadConfig()
              const event = findApprovalEvent(eventId, body)
              if (!event) return send(404, { ok: false, error: '未找到该审批事件' })
              const tool = String(event.tool || '')
              const mode = String(event.mode || '')
              const justification = String(event.justification || event.reason || '')
              if (!tool || !mode) return send(400, { ok: false, error: '该事件不是沙箱越界请求，无法记住' })
              const fingerprint = rememberFingerprint(justification)
              if (!fingerprint) return send(400, { ok: false, error: '该操作的描述太短，无法提取可记住的指纹' })
              const rule = { tool, mode, contains: fingerprint, description: '用户记住：' + new Date().toISOString().slice(0, 10), source: 'remember', createdAt: Date.now(), hitCount: 0, evidenceEventId: eventId }
              const exists = (config.allowRules || []).some((r) => !r.category && r.tool === rule.tool && (r.mode || '') === rule.mode && String(r.contains || '') === rule.contains)
              if (!exists) {
                config.allowRules = config.allowRules || []
                config.allowRules.push(rule)
                saveJson(ALLOWLIST_PATH, config)
                audit(`REMEMBER event=${eventId} tool=${tool} mode=${mode} contains=${fingerprint}`)
              }
              return send(200, { ok: true, rule, already: exists })
            } catch (e) {
              return send(400, { ok: false, error: String((e && e.message) || e) })
            }
          },
        })
        offForgetRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/forget',
          handler: async (req, res) => {
            const send = (code, obj) => {
              res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
              res.end(JSON.stringify(obj))
            }
            try {
              if (req.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' })
              const body = await readBody(req)
              const eventId = Number(body.eventId)
              if (!Number.isFinite(eventId)) return send(400, { ok: false, error: 'eventId 无效' })
              reloadConfig()
              const event = findApprovalEvent(eventId, body)
              if (!event) return send(404, { ok: false, error: '未找到该审批事件' })
              const fp = rememberFingerprint(event.justification || event.reason || '')
              if (!fp) return send(400, { ok: false, error: '该操作没有可提取的指纹' })
              const before = (config.allowRules || []).length
              config.allowRules = (config.allowRules || []).filter((r) => !(r && !r.category && r.tool === event.tool && (r.mode || '') === (event.mode || '') && String(r.contains || '') === fp))
              const removed = before - config.allowRules.length
              if (removed > 0) {
                saveJson(ALLOWLIST_PATH, config)
                audit(`FORGET  event=${eventId} tool=${event.tool} mode=${event.mode || 'none'} contains=${fp}`)
              }
              return send(200, { ok: true, removed, already: removed === 0 })
            } catch (e) {
              return send(400, { ok: false, error: String((e && e.message) || e) })
            }
          },
        })
        offCountersRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/counters',
          handler: async (req, res) => {
            const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' }); res.end(JSON.stringify(obj)) }
            try {
              const url = new URL(req.url, 'http://localhost')
              const sid = url.searchParams.get('sessionId') || ''
              const c = rejectCounters.get(sid) || { consecutive: 0, total: 0 }
              return send(200, { ok: true, sessionId: sid, consecutive: c.consecutive, total: c.total, limits: { consecutive: config.denyEscalateConsecutive || 3, total: config.denyEscalateTotal || 20 } })
            } catch (e) { return send(400, { ok: false, error: String((e && e.message) || e) }) }
          },
        })
        offCountersResetRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/counters-reset',
          handler: async (req, res) => {
            const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' }); res.end(JSON.stringify(obj)) }
            try {
              if (req.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' })
              const body = await readBody(req)
              const sid = String(body.sessionId || '')
              if (!sid) return send(400, { ok: false, error: 'sessionId 必填' })
              rejectCounters.delete(sid)
              audit(`COUNTERS-RESET ${sid}`)
              return send(200, { ok: true, sessionId: sid })
            } catch (e) { return send(400, { ok: false, error: String((e && e.message) || e) }) }
          },
        })
        console.log(`[${NAME}] 规则/初始化 API 已注册：/api/auto-approve/rules, /setup, /remember, /forget, /counters`)
      } else {
        console.warn(`[${NAME}] webServer 不可用，规则/初始化 API 未注册`)
      }
    } catch (error) {
      console.error(`[${NAME}] 注册规则/初始化 API 失败`, error)
    }

    // ---- diff / 撤销 / 快照管理 API ----
    let offDiffRoute = null
    let offRevertRoute = null
    let offSnapStatsRoute = null
    let offSnapClearRoute = null

    /** 投递消息到会话（撤销指令）；复用 workspace-panels 的 chatSend 机制 */
    const sendToSession = async (sessionId, content) => {
      // DSH 用户消息 content 必须是块数组；裸字符串会被 GUI 渲染器按字符迭代，
      // 每个字符渲染成一个「附加内容块」占位符，导致对话界面错乱（v0.5.0 事故根因）。
      const textBlock = [{ type: 'text', text: content }]
      const typertGateway = ctx.get('typertGateway')
      if (typertGateway && typeof typertGateway.invoke === 'function') {
        try {
          await typertGateway.invoke({ namespace: 'session', method: 'prompt', args: { sessionId, mode: 'queue', content: textBlock } })
          return { ok: true, via: 'gateway' }
        } catch (e) {
          console.log(`[${NAME}] gateway 投递失败，改用 followup：${(e && e.message) || e}`)
        }
      }
      const agents = ctx.get('agents')
      if (agents && typeof agents.get === 'function') {
        const agent = agents.get(sessionId)
        if (agent && typeof agent.followup === 'function') {
          agent.followup({
            id: 'ag-revert-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36),
            role: 'user',
            content: textBlock,
            source: { kind: 'user' },
          })
          return { ok: true, via: 'followup' }
        }
      }
      return { ok: false, error: '没有可用的消息投递通道' }
    }

    try {
      if (ctx.webServer && typeof ctx.webServer.register === 'function') {
        const send = (res, code, obj) => {
          res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(JSON.stringify(obj))
        }

        offDiffRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/diff',
          handler: async (req, res) => {
            try {
              if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false, error: 'method not allowed' })
              const url = new URL(req.url, 'http://localhost')
              const eventId = Number.parseInt(url.searchParams.get('eventId') || '', 10)
              const path = url.searchParams.get('path') || ''
              if (!Number.isInteger(eventId) || !path) return send(res, 400, { ok: false, error: 'eventId/path 必填' })
              const snaps = loadEventSnapshots(eventId)
              // client 传的是 justification 中的原始路径（可能绝对/相对/裸文件名），多基准对齐快照的绝对路径
              const base = resolveAbsPath(path)
              const baseName = String(path).split('/').pop()
              const snap = snaps.find((s) => s.path === base || s.path === path)
                || snaps.find((s) => s.path.endsWith('/' + path) || (baseName && s.path.endsWith('/' + baseName)))
              if (!snap) return send(res, 404, { ok: false, error: '该事件没有此文件的快照' })
              const before = snap.content
              const after = readSnapshotFile(snap.path)
              const result = diffLines(before, after == null ? null : after)
              send(res, 200, {
                ok: true,
                path,
                eventId,
                beforeExists: before != null,
                afterExists: after != null,
                changedLines: result.changedLines,
                hunks: result.hunks || [],
                stats: result.stats,
              })
            } catch (e) {
              send(res, 400, { ok: false, error: String((e && e.message) || e) })
            }
          },
        })

        offRevertRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/revert',
          handler: async (req, res) => {
            try {
              if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' })
              const body = await readBody(req)
              const sessionId = String(body.sessionId || '')
              const eventId = Number.parseInt(String(body.eventId || ''), 10)
              if (!sessionId || !Number.isInteger(eventId)) return send(res, 400, { ok: false, error: 'sessionId/eventId 必填' })
              // 读取事件信息组装撤销指令
              const event = (() => {
                try {
                  const text = readFileSync(EVENTS_PATH, 'utf8')
                  for (const line of text.split('\n')) {
                    if (!line.trim()) continue
                    try {
                      const ev = JSON.parse(line)
                      if (ev.id === eventId) return ev
                    } catch { /* 跳过 */ }
                  }
                } catch { /* 无 */ }
                return null
              })()
              if (!event) return send(res, 404, { ok: false, error: '未找到该事件' })
              const files = (event.files || []).map((f) => '`' + f + '`').join('、')
              const snapDir = SNAPSHOTS_DIR
              // 快照缺失保护：快照被清除后，撤销指令应如实告知 agent，避免其盲目恢复
              const snaps = loadEventSnapshots(eventId)
              const snapHint = snaps.length > 0
                ? '改动前的文件内容快照保存在 ' + snapDir + '（按事件 ID 命名），可参考恢复；请确认改动内容后执行撤销。'
                : '注意：该事件已无可用快照（可能已被清除），请基于当前文件内容判断如何恢复原状；无法确定时请先说明再操作。'
              const content = '请撤销以下自动审批操作带来的文件改动（恢复为审批前的状态）：\n' +
                '- 操作：' + (event.justification || event.reason || '(无说明)') + '\n' +
                '- 涉及文件：' + (files || '(未知)') + '\n' +
                '- 判定：' + (event.verdict || 'auto') + '（自动放行）\n' +
                '- 事件时间：' + (event.ts || '') + '\n' +
                snapHint
              const result = await sendToSession(sessionId, content)
              audit(`REVERT  event=${eventId} session=${sessionId} via=${result.via || 'none'} | ${event.justification ? event.justification.slice(0, 80) : ''}`)
              if (result.ok) {
                const fp = extractOperationFingerprint(event.justification || event.reason || '')
                const removed = demoteLearned(event.tool, event.mode, fp, 'revert', event.justification || event.reason || '')
                const negRule = { tool: event.tool }
                if (event.mode) negRule.mode = event.mode
                if (fp) negRule.contains = fp
                const dup = (config.denyRules || []).some((r) => r.tool === negRule.tool && r.mode === negRule.mode && r.contains === negRule.contains)
                if (!dup) { config.denyRules.push(negRule); saveJson(ALLOWLIST_PATH, config) }
                audit(`NEGATIVE revert event=${eventId} removed=${removed} → 撤销操作已降级为永久人工`)
              }
              send(res, result.ok ? 200 : 500, result)
            } catch (e) {
              send(res, 400, { ok: false, error: String((e && e.message) || e) })
            }
          },
        })

        offSnapStatsRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/snapshots-stats',
          handler: async (req, res) => {
            try {
              const url = new URL(req.url, 'http://localhost')
              const filterSession = url.searchParams.get('sessionId') || ''
              let count = 0
              let bytes = 0
              const ids = []
              try {
                for (const name of readdirSyncSafe(SNAPSHOTS_DIR)) {
                  if (!name.endsWith('.json')) continue
                  const id = String(name).slice(0, -'.json'.length)
                  // 按会话过滤：读快照 JSON 匹配 sessionId（无过滤时全部计入）
                  if (filterSession && !snapshotMatchesSession(join(SNAPSHOTS_DIR, name), filterSession)) continue
                  count++
                  ids.push(id)
                  try { bytes += statSyncSafe(join(SNAPSHOTS_DIR, name)) } catch { /* 跳过 */ }
                }
              } catch { /* 目录不存在 */ }
              send(res, 200, { ok: true, count, bytes, ids, sessionId: filterSession || null })
            } catch (e) {
              send(res, 400, { ok: false, error: String((e && e.message) || e) })
            }
          },
        })

        offSnapClearRoute = ctx.webServer.register({
          kind: 'exact',
          path: '/api/auto-approve/snapshots-clear',
          handler: async (req, res) => {
            try {
              if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' })
              const body = await readBody(req)
              const filterSession = String((body && body.sessionId) || '')
              let removed = 0
              try {
                for (const name of readdirSyncSafe(SNAPSHOTS_DIR)) {
                  if (!name.endsWith('.json')) continue
                  // 按会话过滤：不匹配则跳过（无过滤时全清）
                  if (filterSession && !snapshotMatchesSession(join(SNAPSHOTS_DIR, name), filterSession)) continue
                  try { rmSyncSafe(join(SNAPSHOTS_DIR, name)); removed++ } catch { /* 跳过 */ }
                }
              } catch { /* 目录不存在 */ }
              audit(`CONFIG  snapshots-clear session=${filterSession || '*'} removed=${removed}`)
              send(res, 200, { ok: true, removed, sessionId: filterSession || null })
            } catch (e) {
              send(res, 400, { ok: false, error: String((e && e.message) || e) })
            }
          },
        })

        console.log(`[${NAME}] diff/撤销/快照 API 已注册`)
      } else {
        console.warn(`[${NAME}] webServer 不可用，diff/快照 API 未注册`)
      }
    } catch (error) {
      console.error(`[${NAME}] 注册 diff/快照 API 失败`, error)
    }
    ctx.effect(() => () => {
      if (offEventsRoute) { try { offEventsRoute() } catch (e) {} }
      if (offRulesRoute) { try { offRulesRoute() } catch (e) {} }
      if (offSetupRoute) { try { offSetupRoute() } catch (e) {} }
      if (offRememberRoute) { try { offRememberRoute() } catch (e) {} }
      if (offForgetRoute) { try { offForgetRoute() } catch (e) {} }
      if (offCountersRoute) { try { offCountersRoute() } catch (e) {} }
      if (offCountersResetRoute) { try { offCountersResetRoute() } catch (e) {} }
      if (offDiffRoute) { try { offDiffRoute() } catch (e) {} }
      if (offRevertRoute) { try { offRevertRoute() } catch (e) {} }
      if (offSnapStatsRoute) { try { offSnapStatsRoute() } catch (e) {} }
      if (offSnapClearRoute) { try { offSnapClearRoute() } catch (e) {} }
    })

    const resolveModel = () => {
      try {
        const sel = agentDefaultModel && typeof agentDefaultModel.currentSelection === 'function'
          ? agentDefaultModel.currentSelection()
          : undefined
        if (sel && typeof sel.provider === 'string' && sel.provider && typeof sel.model === 'string' && sel.model) {
          return { provider: sel.provider, model: sel.model }
        }
      } catch (error) {
        console.error(`[${NAME}] agentDefaultModel.currentSelection() failed`, error)
      }
      return { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    }

    /**
     * 底层 flash 调用：流式请求并累积文本输出（可取消）。
     * 由 judgeOnce / verifySimilarity 共用；异常向上抛，由 withRetry 决定重试或降级。
     * @returns {Promise<string>} 模型原始输出文本
     */
    const callFlash = async (userText, systemPrompt, signal, maxTokens, modelOverride) => {
      const base = resolveModel()
      const provider = modelOverride && modelOverride.provider ? modelOverride.provider : base.provider
      const model = modelOverride && modelOverride.model ? modelOverride.model : base.model
      // 中转/自定义 provider 的能力表常不声明 reasoning effort "off"，dsh llm 在发出请求前
      // 即抛 UNSUPPORTED_REASONING_EFFORT。先按 off 尝试；被拒则去掉该参数重试一次（回退
      // 尝试忽略 reasoning-delta，避免思考文本污染 SAFE/RISKY 判定文本）。
      const attempts = [
        { reasoningEffort: 'off', collectReasoning: true },
        { reasoningEffort: undefined, collectReasoning: false }
      ]
      let lastError = null
      for (const attempt of attempts) {
        let text = ''
        try {
          for await (const chunk of llm.stream({
            provider,
            model,
            messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
            system: systemPrompt,
            temperature: 0,
            ...(attempt.reasoningEffort === undefined ? {} : { reasoningEffort: attempt.reasoningEffort }),
            // 256：结论仅几个词，但模型偶发先输出复述/思考文本，64 会被截断导致解析失败
            maxTokens: maxTokens || 256,
            signal
          })) {
            if (chunk.type === 'text-delta') text += chunk.text
            else if (chunk.type === 'reasoning-delta' && attempt.collectReasoning) text += chunk.text
            else if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
              const failure = chunk.reason.failure && chunk.reason.failure.message ? chunk.reason.failure.message : chunk.reason.kind
              throw new Error('flash 调用失败: ' + failure)
            }
          }
          return text
        } catch (error) {
          lastError = error
          const failureText = String((error && error.message) || error)
          // 仅对「不支持 reasoning effort」降级到默认 effort 重试；其余错误原样抛出（fail-safe）
          if (!failureText.includes('does not support reasoning effort')) throw error
        }
      }
      throw lastError
    }

    /**
     * 单次 flash 判定：输出 SAFE 或 RISKY:<category>。
     * @returns {Promise<{verdict:'safe'|'risky', category?:string}>}
     */
    const STAGE1_PROMPT = [
      '你是操作风险快筛器。只输出一个词：ALLOW 或 REVIEW。',
      '判断依据是「工具调用参数」里的实际动作，而不是请求的沙箱模式。',
      'ALLOW：明确只读或可回补的常规操作，例如 cat/ls/head/grep、读取文件、在测试/临时目录写入、常规编辑。',
      'REVIEW：删除/覆盖、凭据/密钥、远程或生产、系统路径、批量、参数缺失、任何拿不准的情况。',
      '拿不准时输出 REVIEW；不要解释，只输出一个词。'
    ].join('\n')
    const stage1Once = async (toolName, mode, justification, signal, toolArgs) => {
      const user = [
        `工具: ${toolName}`,
        `目标沙箱模式: ${mode || '(非越界审批)'}`,
        toolArgs ? `工具调用参数:\n${toolArgs}` : '',
        `操作理由: ${justification || '(无说明)'}`,
        '',
        '输出 ALLOW 或 REVIEW。'
      ].filter(function (x) { return x !== '' }).join('\n')
      const override = (config.stage1Provider && config.stage1Model) ? { provider: config.stage1Provider, model: config.stage1Model } : null
      const text = (await callFlash(user, STAGE1_PROMPT, signal, 8, override)).trim().toUpperCase()
      if (text.indexOf('REVIEW') >= 0) return { verdict: 'review' }
      if (text.indexOf('ALLOW') >= 0) return { verdict: 'allow' }
      return { verdict: 'review', unparsed: true }
    }
    const judgeOnce = async (toolName, mode, justification, signal, toolArgs) => {
      const user = [
        `工具: ${toolName}`,
        `目标沙箱模式: ${mode || '(非越界审批)'}`,
        toolArgs ? `工具调用参数:\n${toolArgs}` : '',
        `操作理由: ${justification || '(无说明)'}`,
        '',
        '请判断：执行该操作是否会造成无法回补的后果或触碰敏感资源？输出 SAFE 或 RISKY:<类别>。'
      ].join('\n')
      const text = await callFlash(user, SYSTEM_PROMPT, signal)
      const trimmed = text.trim().toUpperCase()
      const riskyMatch = trimmed.match(/RISKY\s*[:：]\s*([A-Z_]+)/)
      if (riskyMatch) {
        const category = riskyMatch[1].toLowerCase()
        return { verdict: 'risky', category }
      }
      // 裸 RISKY（无类别，旧协议残留）→ 按中立处理（有计数/裁决兜底）
      if (trimmed.includes('RISKY')) return { verdict: 'risky', category: 'neutral' }
      if (trimmed.includes('SAFE')) return { verdict: 'safe' }
      // 模型表达不确定/无法判断（而非复述 prompt）→ 按中立处理（走确认制，fail-safe）
      if (/无法判断|无法确定|不确定|不能确定|无法评估|UNCERTAIN|CANNOT (JUDGE|DETERMINE|ASSESS)/i.test(text)) {
        return { verdict: 'risky', category: 'neutral' }
      }
      throw new Error('flash 输出无法解析: ' + JSON.stringify(text.slice(0, 120)))
    }

    const SIMILARITY_PROMPT = [
      '你是操作意图一致性判断器。用户已人工批准过一些操作（同一工具、同一沙箱模式的例行操作），现在要判断一个新请求是否属于同类。',
      '',
      '你将收到：',
      '- 用户已批准的操作样本（每个样本包含操作背景和目的）',
      '- 一个新操作的背景和目的',
      '',
      '判断规则：',
      '- SAME：新操作与某个样本属于同类操作——操作对象（同一文件/目录/项目/配置/系统）或目的（同一类例行维护、同一次任务的延续）一致或高度相似',
      '- DIFFERENT：新操作的操作对象或目的与所有样本明显不同（不同文件/不同系统/不同性质的操作）',
      '',
      '只输出一个词：SAME 或 DIFFERENT。拿不准时输出 DIFFERENT。不要输出任何其他内容。'
    ].join('\n')

    /**
     * 单次「第三方同类验证」：把本次操作的背景和目的 + 用户历史确认样本给 flash，
     * 判断是否属于已确认的同类操作（语义级，不依赖关键词）。
     * @returns {Promise<{verdict:'same'|'different'}>}
     */
    const verifySimilarity = async (toolName, mode, justification, samples, signal) => {
      const sampleLines = samples
        .map((s, i) => `样本${i + 1}: ${s.ctx || s.fp || '(无描述)'}`)
        .join('\n')
      const user = [
        `工具: ${toolName}`,
        `目标沙箱模式: ${mode || '(非越界审批)'}`,
        '',
        '【用户已批准的操作样本】',
        sampleLines || '（无样本）',
        '',
        '【本次新操作】',
        `操作理由: ${justification || '(无说明)'}`,
        '',
        '请判断：新操作是否与某个已批准样本属于同类操作？输出 SAME 或 DIFFERENT。'
      ].join('\n')
      const text = await callFlash(user, SIMILARITY_PROMPT, signal)
      const trimmed = text.trim().toUpperCase()
      if (trimmed.includes('DIFFERENT')) return { verdict: 'different' }
      if (trimmed.includes('SAME')) return { verdict: 'same' }
      // 无法判断 → 按 different（fail-safe：验证不了就人工）
      if (/无法判断|不确定|无法确定|UNCERTAIN/i.test(text)) return { verdict: 'different' }
      throw new Error('同类验证输出无法解析: ' + JSON.stringify(text.slice(0, 120)))
    }

    /**
     * 通用超时 + 重试包装：runFn(signal) 返回结果对象；
     * 超时 abort 并重试 1 次，仍失败 → { failed: true }（调用方按 fail-safe 处理）。
     * judgeOnce / verifySimilarity 共用；rejection 在 race 内消化（防 unhandled rejection）。
     */
    const withRetry = async (runFn, label) => {
      const timeoutMs = config.judgeTimeoutMs || 20000
      const runOnce = async () => {
        const controller = new AbortController()
        const timer = ctx.timeout(timeoutMs).then(() => {
          controller.abort(`dsh-approval-gate: ${label} 超时`)
          return 'timeout'
        })
        try {
          const call = runFn(controller.signal)
            .then((r) => ({ ...r, timedOut: false }))
            .catch((error) => ({ judgeError: error }))
          const result = await Promise.race([call, timer.then(() => ({ timedOut: true }))])
          if (result.judgeError) throw result.judgeError
          return result
        } finally {
          controller.abort(`dsh-approval-gate: ${label} 结束`)
        }
      }

      try {
        const first = await runOnce()
        if (!first.timedOut) return first
        console.warn(`[${NAME}] ${label} 超时(${timeoutMs}ms)，重试 1 次`)
      } catch (error) {
        console.error(`[${NAME}] ${label} 异常，重试 1 次`, error)
      }
      try {
        const second = await runOnce()
        if (!second.timedOut) return second
      } catch (error) {
        console.error(`[${NAME}] ${label} 重试仍异常`, error)
        return { failed: true }
      }
      console.warn(`[${NAME}] ${label} 两次超时(${timeoutMs}ms×2)`)
      return { failed: true }
    }

    /** flash 风险判定（带超时重试）：失败 → { verdict:'risky', category:'neutral', failed:true }（fail-safe） */
    const judgeWithFlash = async (toolName, mode, justification, toolArgs) => {
      if (config.twoStage === true) {
        const fast = await withRetry((signal) => stage1Once(toolName, mode, justification, signal, toolArgs), 'fast 快筛')
        if (!fast.failed && fast.verdict === 'allow') return { verdict: 'safe', stage: 'fast' }
        audit(`STAGE1  review${fast.failed ? '（快筛失败，转复评）' : ''}`)
      }
      const result = await withRetry((signal) => judgeOnce(toolName, mode, justification, signal, toolArgs), 'flash 判断')
      if (result.failed) return { verdict: 'risky', category: 'neutral', timedOut: true, failed: true, stage: 'deep' }
      return Object.assign({ stage: 'deep' }, result)
    }

    /** 同类验证（带超时重试）：失败 → { verdict:'different', failed:true }（fail-safe：验证失败按不同类处理） */
    const verifySimilarityWithRetry = async (toolName, mode, justification, samples) => {
      const result = await withRetry((signal) => verifySimilarity(toolName, mode, justification, samples, signal), '同类验证')
      if (result.failed) return { verdict: 'different', failed: true }
      return result
    }

    /** 记录一次人工批准的样本（{fp, ctx}）；同指纹覆盖旧样本；返回本次指纹（可能为 null） */
    const recordSample = (key, justification) => {
      const fp = extractOperationFingerprint(justification)
      const ctx = String(justification || '').slice(0, 200)
      const list = (learning.history[key] || []).slice()
      const idx = fp ? list.findIndex((s) => s.fp === fp) : -1
      if (idx >= 0) list[idx] = { fp, ctx }
      else list.push({ fp, ctx })
      learning.history[key] = list.slice(-10)
      return fp
    }

    ctx.on('approval/request', async (req, next) => {
      try {
        reloadConfig()
        const session = req.agent && req.agent.session
        if (!session) return next()
        let preset
        try {
          preset = permissionPresets.current(session)
        } catch (error) {
          console.error(`[${NAME}] permissionPresets.current failed`, error)
          return next()
        }
        if (preset !== PRESET_NAME) return next()
        if (req.signal && req.signal.aborted) return next()

        const toolName = String(req.toolName || 'unknown')
        const reason = String(req.reason || '')
        const { mode, justification } = parseReason(reason)
        const sessionId = typeof session.id === 'string' ? session.id : ''
        const callInfo = req && req.callId ? getToolCall(sessionId, String(req.callId)) : null
        const judgeArgs = callInfo && callInfo.arguments ? redactArgs(callInfo.arguments) : ''
        if (judgeArgs) audit(`INPUT   ${toolName} callArgs=${judgeArgs.length}B`)
        // 会话工作目录：相对路径快照解析的基准（DSH SessionHeader.cwd）
        const sessionCwd = (typeof session.cwd === 'string' && session.cwd) ? session.cwd : ''

        // 转人工统一处理：记录 pending → 交下游（web answerer）→ 记录终态事件（关闭提示条）
        const forwardToHuman = async (sid, tName, tMode, rsn, jst, cat, why) => {
          recordApprovalEvent(sid, tName, tMode, rsn, jst, 'manual-pending', { kind: 'manual-pending', category: cat || '', path: why, args: judgeArgs })
          const out = await next()
          recordOutcome(sid, tName, tMode, rsn, jst, cat, out)
          if (out === 'allowed-once') {
            recordApprovalEvent(sid, tName, tMode, rsn, jst, 'manual-approved', { kind: 'manual-approved', category: cat || '', path: why, args: judgeArgs })
          } else if (out === 'rejected') {
            recordApprovalEvent(sid, tName, tMode, rsn, jst, 'manual-rejected', { kind: 'manual-rejected', category: cat || '', path: why, args: judgeArgs })
          }
          return out
        }

        // 1. DENY 层：不可逆危险词 → 转人工（fail-safe，最高优先）
        if (looksDeny(toolName + ' ' + reason)) {
          audit(`DENY    ${toolName} mode=${mode || 'none'} | ${reason.slice(0, 160)}`)
          return forwardToHuman(sessionId, toolName, mode, reason, justification, '', 'deny')
        }

        // 2a. 可写根目录信任：一次性配置，范围内的操作直接放行（零点击）
        const trustedRoot = trustHit(justification)
        if (trustedRoot) {
          audit(`TRUST   ${toolName} mode=${mode || 'none'} root=${trustedRoot}`)
          recordAutoAllow(sessionId, toolName, mode, reason, justification, 'trust', { baseDir: sessionCwd, args: judgeArgs })
          return 'allowed-once'
        }

        // 2b. 会话内记忆：本会话人工确认过的同指纹操作 → 直接放行（零点击，会话级）
        const earlyFp = extractOperationFingerprint(justification)
        const memEntry = sessionMemoryHit(sessionId, toolName, mode, earlyFp)
        if (memEntry) {
          audit(`SESSIONMEM ${toolName} mode=${mode || 'none'} fp=${earlyFp}`)
          recordAutoAllow(sessionId, toolName, mode, reason, justification, 'session-memory', { baseDir: sessionCwd, args: judgeArgs })
          return 'allowed-once'
        }

        // 2. 白名单层：命中规则 → 直接放行（确定性，不过 flash）
        const matchedRule = matchRule(config.allowRules, toolName, mode, null, justification)
        if (matchedRule) {
          touchRuleHit(matchedRule)
          audit(`ALLOW   ${toolName} mode=${mode || 'none'} (rule: ${matchedRule.description || 'matched'}${matchedRule.contains ? ',contains=' + matchedRule.contains : ''},hit=${matchedRule.hitCount || 0})`)
          recordAutoAllow(sessionId, toolName, mode, reason, justification, 'rule', { baseDir: sessionCwd, args: judgeArgs })
          return 'allowed-once'
        }

        // 3. flash 判定
        const { verdict, category, timedOut, failed, stage } = await judgeWithFlash(toolName, mode, justification, judgeArgs)

        if (verdict === 'safe') {
          audit(`ALLOW   ${toolName} mode=${mode || 'none'} (flash-safe${timedOut ? '，重试后' : ''}${stage === 'fast' ? ',fast' : ''})`)
          const ev = recordAutoAllow(sessionId, toolName, mode, reason, justification, 'flash-safe', { baseDir: sessionCwd, args: judgeArgs })
          recordSelfObservation(sessionId, toolName, mode, justification, ev && ev.id)
          return 'allowed-once'
        }

        const cat = category || 'neutral'

        // 4a. flash 完全失败（超时×2/异常×2）→ 转人工（fail-safe：无法判断绝不自动放行）
        if (failed) {
          audit(`FAILED  ${toolName} mode=${mode || 'none'} → 人工 | ${reason.slice(0, 120)}`)
          return forwardToHuman(sessionId, toolName, mode, reason, justification, cat, 'flash-failed')
        }

        // 4b. 硬风险类别（deletion/credential/remote/system/bulk）→ 直接转人工（必须人工确认，不计数不学习）
        const hard = config.hardCategories || DEFAULT_HARD_CATEGORIES
        if (hard.includes(cat)) {
          audit(`HARD    ${toolName} mode=${mode || 'none'} category=${cat} → 人工 | ${reason.slice(0, 120)}`)
          return forwardToHuman(sessionId, toolName, mode, reason, justification, cat, 'hard-category')
        }

        // 4c. 协议外类别（模型输出未知类别）→ 判定不可靠，fail-safe 转人工
        if (cat !== 'neutral') {
          audit(`UNKNOWN ${toolName} mode=${mode || 'none'} category=${cat} → 人工 | ${reason.slice(0, 120)}`)
          return forwardToHuman(sessionId, toolName, mode, reason, justification, cat, 'unknown-category')
        }

        // 4d. denyRules 命中（此前用户裁决拒绝过的 key）→ 直接转人工（拒绝优先于沉淀）
        if (matchRule(config.denyRules, toolName, mode, cat, justification)) {
          audit(`DENYRULE ${toolName} mode=${mode || 'none'} category=${cat} → 人工 | ${reason.slice(0, 120)}`)
          return forwardToHuman(sessionId, toolName, mode, reason, justification, cat, 'deny-rule')
        }

        // 4e. 沉淀规则（带 category 的学习规则，用户批准过）→ 直接放行，不再计数
        const key = learnKey(toolName, mode, cat)
        const learnedRule = matchRule(config.allowRules, toolName, mode, cat, justification)
        if (learnedRule) {
          touchRuleHit(learnedRule)
          audit(`ALLOW   ${toolName} mode=${mode || 'none'} (rule: ${learnedRule.description || '沉淀规则'}${learnedRule.contains ? ',contains=' + learnedRule.contains : ''},hit=${learnedRule.hitCount || 0})`)
          delete learning.stats[key]
          saveJson(LEARNING_PATH, learning)
          recordAutoAllow(sessionId, toolName, mode, reason, justification, 'learned', { baseDir: sessionCwd, args: judgeArgs })
          return 'allowed-once'
        }

        // 4f. 中立类别（neutral）：人工确认学习制——确认满 N 次后，第 N+1 次起自动放行并沉淀
        //     （同一 key 被用户确认 N 次后视为可信，后续自动放行并写入沉淀规则）
        const threshold = config.riskyThreshold || 3
        const confirmed = learning.stats[key] || 0

        if (confirmed >= threshold) {
          const fingerprint = extractOperationFingerprint(justification)
          const samples = learning.history[key] || []
          const fpHit = Boolean(fingerprint) && samples.some((s) => s.fp === fingerprint)

          if (fpHit) {
            // ① 指纹确定性命中（用户确认过该操作）→ 自动放行 + 沉淀规则
            if (learning.enabled) {
              const rule = { tool: toolName, category: cat, contains: fingerprint }
              if (mode) rule.mode = mode
              if (!config.allowRules.some((r) => r.tool === rule.tool && r.mode === rule.mode && r.category === rule.category && r.contains === rule.contains)) {
                rule.description = `自动沉淀：${cat === 'neutral' ? '中立' : CATEGORY_LABELS[cat] || cat} 人工确认后自动放行`
                rule.source = 'learned'
                rule.createdAt = Date.now()
                rule.hitCount = 0
                config.allowRules.push(rule)
                saveJson(ALLOWLIST_PATH, config)
                audit(`LEARN   ${key} 已沉淀白名单 ${JSON.stringify(rule)}`)
              }
            }
            audit(`ALLOW   ${toolName} mode=${mode || 'none'} (neutral-learned=${confirmed + 1}/${threshold}) | ${reason.slice(0, 100)}`)
            delete learning.stats[key]
            delete learning.history[key]
            saveJson(LEARNING_PATH, learning)
            recordAutoAllow(sessionId, toolName, mode, reason, justification, 'fpHit', { baseDir: sessionCwd, args: judgeArgs })
            return 'allowed-once'
          }

          if (samples.length > 0) {
            // 指纹未命中 → flash 第三方同类验证：把本次操作背景 + 用户确认样本给 flash，
            // 语义判断是否属于已确认的同类操作（不依赖关键词）
            const sim = await verifySimilarityWithRetry(toolName, mode, justification, samples)
            if (sim.verdict === 'same') {
              // 判同类 → 自动放行；有指纹则沉淀规则（无指纹不沉淀，保留样本供后续验证）
              if (learning.enabled && fingerprint) {
                const rule = { tool: toolName, category: cat, contains: fingerprint }
                if (mode) rule.mode = mode
                if (!config.allowRules.some((r) => r.tool === rule.tool && r.mode === rule.mode && r.category === rule.category && r.contains === rule.contains)) {
                  rule.description = `自动沉淀：${cat === 'neutral' ? '中立' : CATEGORY_LABELS[cat] || cat} flash 同类验证`
                  rule.source = 'learned'
                  rule.createdAt = Date.now()
                  rule.hitCount = 0
                  config.allowRules.push(rule)
                  saveJson(ALLOWLIST_PATH, config)
                  audit(`LEARN   ${key} flash 判同类，已沉淀白名单 ${JSON.stringify(rule)}`)
                }
                delete learning.stats[key]
                delete learning.history[key]
                saveJson(LEARNING_PATH, learning)
              } else {
                // 无指纹：不沉淀，保留样本与阈值位（下次同操作仍靠 flash 验证放行）
                audit(`SAME    ${toolName} mode=${mode || 'none'} category=${cat} flash 判同类（无指纹，未沉淀）| ${reason.slice(0, 100)}`)
              }
              audit(`ALLOW   ${toolName} mode=${mode || 'none'} (flash-same) | ${reason.slice(0, 100)}`)
              recordAutoAllow(sessionId, toolName, mode, reason, justification, 'flash-same', { baseDir: sessionCwd, args: judgeArgs })
              return 'allowed-once'
            }
            // 判 DIFFERENT / 验证失败 → 落人工确认
            audit(`SIMDIFF ${toolName} mode=${mode || 'none'} category=${cat} flash 判不同类 → 人工 | ${reason.slice(0, 120)}`)
          }

          // 指纹未命中（且无样本可验证 / 判不同类）：转人工确认
          audit(`RISKY   ${toolName} mode=${mode || 'none'} category=${cat} confirm=${confirmed + 1}/${threshold}（操作未确认过）→ 人工 outcome=? | ${reason.slice(0, 120)}`)
          recordApprovalEvent(sessionId, toolName, mode, reason, justification, 'manual-pending', { kind: 'manual-pending', category: cat, path: 'neutral-confirm', args: judgeArgs })
          const outcome = await next()
          recordOutcome(sessionId, toolName, mode, reason, justification, cat, outcome)
          audit(`OUTCOME ${key} outcome=${outcome} | ${reason.slice(0, 80)}`)
          if (outcome === 'allowed-once' && learning.enabled) {
            // 批准 → 记录本次操作样本（背景+指纹）；计数保持阈值位
            recordSample(key, justification)
            saveJson(LEARNING_PATH, learning)
            recordApprovalEvent(sessionId, toolName, mode, reason, justification, 'manual-approved', { kind: 'manual-approved', learningCount: confirmed, threshold, category: cat, path: 'neutral-confirm', args: judgeArgs })
          } else if (outcome === 'rejected') {
            // 拒绝 → 永久人工（带指纹；提取不到则拦全部同类，拒绝从严）
            const rule = { tool: toolName, category: cat }
            if (mode) rule.mode = mode
            if (fingerprint) rule.contains = fingerprint
            if (!config.denyRules.some((r) => r.tool === rule.tool && r.mode === rule.mode && r.category === rule.category && r.contains === rule.contains)) {
              config.denyRules.push(rule)
              saveJson(ALLOWLIST_PATH, config)
              audit(`LEARN   ${key} 被人工拒绝，已升级永久人工 ${JSON.stringify(rule)}`)
            }
            delete learning.stats[key]
            delete learning.history[key]
            saveJson(LEARNING_PATH, learning)
            recordApprovalEvent(sessionId, toolName, mode, reason, justification, 'manual-rejected', { kind: 'manual-rejected', category: cat, path: 'neutral-reject', args: judgeArgs })
          }
          const fpMemoryA = fingerprint || extractOperationFingerprint(justification)
          if (outcome === 'allowed-once') {
            const promoA = rememberApproved(sessionId, toolName, mode, fpMemoryA, cat, justification)
            if (promoA && promoA.promoted) audit(`PROMOTE ${memoryKey(toolName, mode, fpMemoryA)} 跨会话 ${promoA.sessions} 次确认`)
            recordSignatureApproval(sessionId, toolName, mode, justification)
          } else if (outcome === 'rejected') {
            demoteLearned(toolName, mode, fpMemoryA, 'reject', justification)
          }
          return outcome
        }

        // 前 N 次 → 人工确认
        audit(`RISKY   ${toolName} mode=${mode || 'none'} category=${cat} confirm=${confirmed + 1}/${threshold} → 人工 outcome=? | ${reason.slice(0, 120)}`)
        recordApprovalEvent(sessionId, toolName, mode, reason, justification, 'manual-pending', { kind: 'manual-pending', category: cat, path: 'neutral-confirm', args: judgeArgs })
        const outcome = await next()
        recordOutcome(sessionId, toolName, mode, reason, justification, cat, outcome)
        audit(`OUTCOME ${key} outcome=${outcome} | ${reason.slice(0, 80)}`)

        if (outcome === 'allowed-once' && learning.enabled) {
          // 批准 → 确认计数 +1，并记录本次操作样本（未达阈值，下次同类仍人工确认）
          learning.stats[key] = confirmed + 1
          recordSample(key, justification)
          saveJson(LEARNING_PATH, learning)
          recordApprovalEvent(sessionId, toolName, mode, reason, justification, 'manual-approved', { kind: 'manual-approved', learningCount: confirmed + 1, threshold, category: cat, path: 'neutral-confirm', args: judgeArgs })
        } else if (outcome === 'rejected') {
          // 拒绝 → 升级为永久人工规则（带操作指纹；提取不到则拦全部同类，拒绝从严）
          const fingerprint = extractOperationFingerprint(justification)
          const rule = { tool: toolName, category: cat }
          if (mode) rule.mode = mode
          if (fingerprint) rule.contains = fingerprint
          if (!config.denyRules.some((r) => r.tool === rule.tool && r.mode === rule.mode && r.category === rule.category && r.contains === rule.contains)) {
            config.denyRules.push(rule)
            saveJson(ALLOWLIST_PATH, config)
            audit(`LEARN   ${key} 被人工拒绝，已升级永久人工 ${JSON.stringify(rule)}`)
          }
          delete learning.stats[key]
          delete learning.history[key]
          saveJson(LEARNING_PATH, learning)
          recordApprovalEvent(sessionId, toolName, mode, reason, justification, 'manual-rejected', { kind: 'manual-rejected', category: cat, path: 'neutral-reject', args: judgeArgs })
        }
        const fpMemoryB = extractOperationFingerprint(justification)
        if (outcome === 'allowed-once') {
          const promoB = rememberApproved(sessionId, toolName, mode, fpMemoryB, cat, justification)
          if (promoB && promoB.promoted) audit(`PROMOTE ${memoryKey(toolName, mode, fpMemoryB)} 跨会话 ${promoB.sessions} 次确认`)
          recordSignatureApproval(sessionId, toolName, mode, justification)
        } else if (outcome === 'rejected') {
          demoteLearned(toolName, mode, fpMemoryB, 'reject', justification)
        }
        // cancelled/unavailable：不计数（用户未表态，下次仍人工确认）
        return outcome
      } catch (error) {
        console.error(`[${NAME}] 判断过程出错，回退人工`, error)
        return next()
      }
    }, { prepend: true })

    try {
      const w = scanOverbroadRules()
      const n = (w.allowRules || []).length + (w.trustRoots || []).length
      if (n > 0) audit(`SCAN ${n} 条可能过宽的规则/信任目录（见设置页 ⑦ 规则库）`)
    } catch (error) { /* 扫描失败不影响挂载 */ }

    console.log(`[${NAME}] v3 已挂载：DENY→白名单→denyRules→flash(SAFE/硬类别/中立计数${config.riskyThreshold})→裁决学习（配置: ${ALLOWLIST_PATH}）`)
  },
}
