# Fork changes（相对上游 0.5.0）

基线：`dsh-approval-gate@0.5.0`（npm）→ 上游 [moon09300731/dsh-approval-gate](https://github.com/moon09300731/dsh-approval-gate)，MIT。

本 fork 只修改了两个文件：`src/index.mjs`（host）与 `client.js`（浏览器端）；未改 `package.json`、`cordis.patch.yml`、`README`（上游）。

## 1. 兼容性修复（必须）

| 改动 | 位置 | 说明 |
| --- | --- | --- |
| Flash `reasoningEffort` 降级重试 | `src/index.mjs` `callFlash` | 中转/自定义 provider 不支持 `reasoningEffort: 'off'` 时，去掉该参数重试一次；否则判定全部失败、插件退化为全人工 |
| `permissionPresets.current(session)` | `src/index.mjs` 门控 | 适配 DSH 0.2.x API（上游用 `current(session.events)` 会抛错并静默回落人工） |
| 快照按钮统计修复 | `client.js` | 「清空全部」按全局快照数启用，而不是被本会话 0 条禁用；快照栏显示本会话 + 全部会话 |
| 重复事件 id 消歧 | `src/index.mjs` remember/forget | 热重载竞态会产生重复 event id，按 tool/mode/justification 内容消歧；前端行 key 改为 `id@ts` |
| 记住状态持久化 | `client.js` + `/api/auto-approve/events` | 事件接口返回 `remembered`，按钮状态以服务端为准，切窗口不再回退 |

## 2. 功能新增

| 功能 | 说明 | 验证 |
| --- | --- | --- |
| 真实工具参数判定（A） | 订阅 `session/event` 缓存 `callId → {name, arguments}`（每会话 400 条、最多 60 会话、单条 8KB），审批时用 `req.callId` 取实际参数，脱敏（api_key/token/secret/password/authorization/cookie/Bearer）并截断 4KB 后交给 Flash | 审计出现 `INPUT ... callArgs=xxxB`；无参数时回落 justification |
| 记住 / 取消记住 | 审批行「记住这次操作」写入白名单（路径优先，无路径用整句描述精确匹配）；「取消记住」删除；规则带证据事件 id | 实测 remember → 事件 `remembered=true` → forget → 规则删除 |
| 可写根目录信任 | `trustRoots` 配置一次，范围内操作直接放行（零点击） | `TRUST` 审计，未调用 Flash |
| 会话记忆 | 本会话人工批准过的同指纹操作再次出现直接放行 | `SESSIONMEM` 审计，无弹窗 |
| 跨会话晋升 | 同一指纹在多个会话确认后沉淀全局规则；要求路径指纹、无拒绝历史、意图信号（否则需更多会话） | `PROMOTE` / `PROMOTE-SKIP` 审计 |
| 签名毕业 | 操作归一化签名（工具+模式+目录/扩展名模式），人工确认达阈值且 ≥2 会话、≥2 个不同指纹、无拒绝历史、意图信号（否则 +1 次）后自动沉淀 | `GRADUATE` / `GRADUATE-SKIP` 审计；同目录不同文件命中毕业规则 |
| 负反馈 | 拒绝或「撤销改动」→ 删除对应学习规则/记忆并升级永久人工 | `NEGATIVE` 审计 |
| 规则元数据（P1） | `source/createdAt/hitCount/lastHit/disabled`；命中累加并落盘 | 命中后 `hitCount` 增加 |
| 规则库（P2，设置⑦） | 白名单/永久人工/信任目录/毕业进度统一管理；搜索、启停、删除、导出 JSON、证据复制 | 启停：停用后走 Flash，启用后命中 |
| 规则体检 | 泛词 contains、裸 mode、过宽 trustRoots；只警告 + 一键停用，并给收窄建议 | `commit` 规则被标记并给出建议 |
| 参数透明化 | 审批事件记录实际参数（脱敏截断 600B），审批视图显示「参数：…」 | 事件 507 含实际命令 |
| 拒绝计数升级（D） | 连续 3 / 累计 20 次拒绝 → `escalate` 事件 + 审计 `ESCALATE` + 审批视图红色「需人工介入」；批准后连续计数清零；批量计数可通过 API 查看/重置 | `/api/auto-approve/counters`、`counters-reset` 已验证 |
| 两段式判定（B） | 快筛 `ALLOW/REVIEW` + 复评；`twoStage`、`stage1Provider/stage1Model` 可配；默认关闭 | 默认 Flash 快筛对 danger-full-access 一律 REVIEW（无收益）；pro/gpt 覆盖调用失败（模型路由），保持关闭 |
| 自学习（可选，默认关） | 从 Flash 连续 SAFE 判定毕业签名（`selfLearn`、阈值/会话/规则上限可配），无需人工确认；无拒绝历史才毕业，负反馈会删除 | 阈值 2/会话 1 下实测：2 次 SAFE 后生成规则，第 3 次命中规则跳过 Flash |
| 测试与 CI | `npm test`（node --check + smoke）；GitHub Actions 校验补丁可应用到上游 0.5.0；新增英文 README | smoke 可本地运行；CI 需 push 后验证 |
| 设置页 UI 排序 | 卡片顺序 ①→⑦；② 去掉重复筛选；⑥ 精简；⑦ 行支持换行 | 客户端刷新后生效 |

## 3. 未采用 / 已移除

- **全局门控 global**：曾实现「所有 workspace-write 会话都接管」，按用户要求整段移除，恢复按会话手动选档。
- **输入层 prompt-injection 探针**：Claude Code auto mode 的输入层防御依赖 tool 结果内容，本插件拿不到该上下文，暂不做。
- **子代理 handoff 两端判定**：DSH 的 review worker 直接 danger-full-access，没有审批层，暂不做。
- **B 两段式默认开启**：实测收益不足，默认关闭；换更强/更合适的快筛模型可再评估。

## 4. 数据文件

`$DSH_HOME/auto-approve/`：

- `allowlist.json`：规则与配置（含新增字段）
- `learning.json`：确认制学习计数与样本
- `memory.json`：会话批准记忆的跨会话累计 + 毕业进度
- `audit.log`：判定审计（ALLOW/TRUST/SESSIONMEM/LEARN/GRADUATE/PROMOTE/NEGATIVE/ESCALATE/…）
- `events.jsonl`：审批事件（供审批视图，含 remembered/args 等字段）
- `snapshots/`：自动放行前文件快照

## 5. 已验证场景（摘要）

- neutral 操作人工确认 3 次 → 第 4 次指纹命中自动放行并沉淀规则
- 无路径操作：整句描述匹配的记住/取消
- 重复 event id：按内容消歧后 remember/forget 正确
- trustRoots：范围内写入不调用 Flash
- 会话记忆：批准一次后同操作再次放行
- 签名毕业：同目录不同文件命中毕业规则
- 规则库启停：停用跳过、启用命中，`hitCount` 累加
- 拒绝计数 API：查询与重置
- 参数录入：事件与审批视图显示实际命令

## 6. 注意

- 本 fork 面向 DSH 0.2.x（实测 0.2.2-rc.1）；升级 DSH 后需重新验证 API。
- 学习/裁决依赖模型判定与用户批准历史，不能替代高风险场景的人工审查。
- 发布时保留上游 LICENSE 与署名，注明 "Based on moon09300731/dsh-approval-gate v0.5.0"。
