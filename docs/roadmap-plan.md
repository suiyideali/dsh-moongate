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

- 抽出客户端文案表，至少覆盖记录页、设置页、通知条和错误提示。
- 优先跟随 DSH 现有 locale 能力；没有则用本地 locale 状态。

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
