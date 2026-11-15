# 路线图实施计划

本计划按「Shadow → 行内编辑 → 按项目统计 → i18n → 语义复用」推进。每一项都通过独立分支、测试、PR 和 superagent 复审后合并。

## 1. Shadow 模式 + 事件 `cwd`

**目标**：在正式启用更激进的自动放行前，记录“按当前策略本可自动放行”的候选，但不真正放行，也不写规则/学习/快照。

**范围**

- 配置新增 `shadow: false`（`allowlist.json`，设置页可开关）。
- 审批判断命中以下路径时，只写一条 `kind: "shadow-candidate"` 事件，然后转人工：
  - `trust`：可写根目录信任；
  - `session-memory`：本会话记忆；
  - `rule`：白名单规则（包括沉淀规则）；
  - `flash-safe`：Flash 判 SAFE；
  - `fpHit` / `flash-same`：中立类别达到阈值后的指纹/语义复用。
- 候选事件包含 `cwd`、`path`、`wouldPath`、`args`；不调用 `touchRuleHit`、不写 `learning.json`、不生成快照。
- 所有审批事件新增 `cwd`（来自 `session.cwd`），旧事件缺失时保持兼容。
- 记录页新增 Shadow 候选筛选/标签，不计入“自动放行”统计；设置页新增 Shadow 开关和说明。
- 观察期内的拒绝不写入 `denyRules`；README 明确说明关闭 Shadow 后需要手动添加永久人工规则。

**验收**

- Shadow 开启时，原本会命中的规则/信任/Flash SAFE 都仍转人工；事件流中出现候选记录。
- Shadow 关闭时行为与当前版本完全一致。
- `npm test` 通过；新增 smoke 覆盖候选事件字段、`cwd`、规则/`flash-safe`/`learned` 三条路径、不写规则命中/学习/快照，以及关闭 Shadow 后恢复自动放行。

## 2. 规则库行内编辑

- 为每条 allow/deny 规则生成稳定 ID（按 `tool|mode|category|contains|signature` 规范化元组计算）。
- API 增加 `set` 操作；校验工具名、mode、category、contains，拒绝空规则和过宽规则。
- UI 支持行内编辑、保存/取消、错误提示；安全类别不允许通过 UI 改成“无条件放行”。
- 签名规则（学习生成）不在行内编辑范围，避免破坏签名匹配；需要时删除后重建。

**验收**

- 快照中每条 allow/deny 规则都有稳定 `id`；`set` 能按 id 更新，未知 id 返回错误。
- 空规则、非法 mode/category、危险的无条件 `danger-full-access` 规则被拒绝；签名不可修改。
- UI 编辑保存后即时热更新，失败时保留编辑内容并显示原因。
- `npm test` 覆盖快照 id、set 成功、危险编辑拒绝。

## 3. 按项目/目录统计

- 事件已带 `cwd` 后，仪表盘按项目根/目录聚合展示数量、放行率、拒绝数。
- 历史无 `cwd` 的事件归入“未知目录”，不做回溯推断。
- 聚合在 host 端只读 `events.jsonl`，新增 `GET /api/auto-approve/project-stats`；只统计已落地结果（跳过 `manual-pending`），按总数倒序，最多返回 24 个项目。
- 仪表盘展示项目名、完整路径（title 提示）、自动率条、总数/自动/拒绝/Shadow；空数据显示引导文案。

**验收**

- 同一 `cwd` 的 auto/manual/rejected/shadow 事件聚合到一行；`autoRate` 按 auto/total 计算。
- 无 `cwd` 的历史事件进入“未知目录”，不与其他项目合并。
- API 只读，不触发规则/学习/快照副作用；`npm test` 覆盖当前目录与未知目录两类聚合。

## 4. i18n

- 客户端 `T(zh, en)` 文案函数，跟随 `navigator.language`（`en*` 显示英文，其余中文）。
- 覆盖记录页、设置页标题、通知条、主要错误提示；深层说明与动态拼接仍以中文为 fallback。
- 不引入额外依赖；语言切换在页面刷新后生效。

**验收**

- `en-US` 浏览器下主要界面显示英文；中文浏览器行为不变。
- `client.js` 保留中文原文作为 fallback，不出现 undefined/空标签。
- `npm test` 校验 `T` 函数与英文文案标记存在。


## 5. 语义近似复用

- 配置 `semanticReuse: false`（默认关，设置页 ⑥ 可开）。
- 仅在中立类别、已有至少一次人工确认样本、且未达到确认阈值时触发。
- 调 `verifySimilarityWithRetry`：`SAME` → 放行当前操作（`flash-same`，事件 `path:"semantic"`）；`DIFFERENT`/失败 → 转人工。
- 不写规则、不改变确认计数/样本；Shadow 开启时只记录 `wouldPath:"semantic"` 候选。
- 硬风险类别、DENY、denyRules、信任目录等优先级不变。

**验收**

- 一次批准后，相似操作 Flash `SAME` 自动放行，`next()` 不被调用；`DIFFERENT` 仍转人工。
- 不新增 allowRules，不改变 `learning.stats`/样本；Shadow 下只写候选。
- `npm test` 覆盖 SAME/DIFFERENT/无样本/Shadow 路径。

## 6. 命令意图学习（P0）

- 学习 key 从 `tool|mode|category` 扩展为可识别的安全 bash 命令：`tool|mode|category|cmd=<pattern>|cwd=<cwd>`。
- 只从真实 `tool/call` 参数解析；支持 `git status/diff/log/...`、`gh pr/issue/... view/list`、`npm/pnpm/yarn/bun test` 与已列出的安全脚本。
- 拒绝管道/重定向/命令替换、危险 git 分支/标签操作、写文件输出参数、非白名单 git/gh 子命令；`cd dir && cmd` 使用解析后的有效 cwd。
- 命令规则同时写 `commandPattern` + `cwdPrefix`，匹配时必须命令和目录都一致；旧规则保持兼容。
- 有真实 bash 入参但无法识别为安全意图时，不进入中性计数/学习，固定转人工（`path:"command-unverified"`）；显式用户规则仍可放行。
- 事件记录 `commandPattern`，规则库展示 `cmd=`/`cwd=`，便于审计。

**验收**

- `npm test` 首次人工、同命令同目录再次自动放行，并沉淀带 `commandPattern`/`cwdPrefix` 的规则。
- `npm publish` 不复用 `npm test` 的学习结果，重复出现也始终人工。
- 旧规则/非 bash 工具行为不变；Shadow 仍只记录候选、不写规则/学习/快照。

## 7. 语义匹配使用真实参数（P1）

- 人工批准样本除 `ctx` 外记录真实参数（`args`，已脱敏、截断 600 字符）。
- `verifySimilarity` 同时接收本次 `judgeArgs` 与 `commandCtx`；prompt 明确要求先比较工具、再比较 bash program，理由只作辅助。
- bash 且样本带 `commandPattern` 时，program 不同直接返回 `DIFFERENT`，不调用模型。
- 保持原策略：仅 neutral、已有至少一次人工样本、未达阈值、`semanticReuse` 开启时触发；SAME 只放行当前操作，不沉淀、不改计数。

**验收**

- 样本与本次请求的 prompt 均包含真实参数；`npm test` 的 SAME 路径仍只放行一次。
- 不同 program 不会因理由相似被判 SAME；无样本/验证失败继续转人工。
- `npm test` 覆盖真实参数写入与 prompt 内容。

## 8. Shadow 候选分组与规则建议（P2）

- 只读 `events.jsonl` 中的 `shadow-candidate`，按 `wouldPath|tool|mode|category|commandPattern|cwd` 分组。
- 只对 `flash-safe` / `semantic`（以及带命令的 `trust`）生成保守建议；已有规则路径（`rule`/`learned`/`fpHit`/`flash-same`）不再建议。
- 命令候选建议 `commandPattern + cwdPrefix`；非命令候选仅在能从理由提取路径指纹时建议 `contains`。
- API：`GET /api/auto-approve/shadow-suggestions`，只读、不自动建规则；设置页 Shadow 卡片展示 ≥2 次的分组，点「创建规则」才写入。
- 语音只作为未来的输入通道，不参与命令/语义匹配核心。

**验收**

- 同命令同目录的两次候选聚合为一组，建议规则带 `commandPattern` 与 `cwdPrefix`。
- 只有点击按钮才调用规则 API；端点本身无副作用。
- `npm test` 覆盖分组、计数和建议字段。

## 9. 首次使用：只读命令快速路径

- 新增 `READ_ONLY_PROGRAMS` 白名单：`ls/pwd/echo/printf/cat/head/tail/wc/grep/rg/sed/stat/file/du/df/ps/date/which/type/sort/jq`。
- `commandIntent` 对 `git`/`gh` 的只读子命令返回 `readOnly:true`；本地白名单命令要求有效 cwd、路径落在 cwd 内、无管道/重定向/命令替换；`sed` 必须 `-n` 且无 `-i`，`sort` 不得 `-o`。
- 审批处理器在 DENY 之后、信任/规则/Flash 之前处理 `commandCtx.readOnly`：直接自动放行，事件 `verdict/path = readonly`，不写规则、学习、快照；Shadow 开启时只记录 `wouldPath:'readonly'` 候选。
- 验收：`git status --short` 首次即自动放行；`sed -i`、`cat /etc/passwd` 等仍转人工；`npm publish` 不受影响。

## 10. 项目级信任（项目内编辑/测试）

**目标**：减少首次使用同一项目时的重复确认，但不把 push、网络、删除等不可逆操作自动放行。

**配置**：`allowlist.json` 增加 `projectTrust: []`，存绝对项目根目录；最多 20 个。API 使用 `op:'add'/'remove', kind:'projectTrust'`。

**判定**（在只读快速路径之后、全局 `trustRoots` 之前）：
- `edit`/`write`：从 tool arguments 的 `path`/`file_path`/`files` 提取路径；所有路径必须落在同一信任根目录下。
- `bash`：必须有 `commandCtx`（`commandIntent` 已识别）且 `commandCtx.cwd` 在信任根目录内；因此 `npm test`、`go test`、`npm run lint` 等可放行，`git push`、`curl`、`rm` 等没有 `commandCtx`，仍转人工。
- 显式 `denyRules` 优先；Shadow 开启时只记录 `wouldPath:'project-trust'` 候选。
- 自动放行事件 `path/verdict:'project-trust'`，带 `projectRoot`，不写规则/学习；edit/write 仍生成改动前快照。

**UI**：⑦ 规则库 → 信任目录，分「全局信任目录」和「项目信任」两段；项目信任可添加/移除。

**验收**：项目内 edit 自动放行；项目内 `npm test` 自动放行；`git push` 仍人工；移除信任后 edit 重新人工；`npm test` 覆盖 API 持久化与事件字段。
