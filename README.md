# dsh-moongate（学习增强版 / fork）

DeepSeek Harness 的自动审批插件：Flash 预判 + 确认制学习 + 零点击学习（会话记忆 / 跨会话晋升 / 签名毕业）+ 规则库管理。

> **来源与许可**：基于 [moon09300731/dsh-approval-gate](https://github.com/moon09300731/dsh-approval-gate) v0.5.0（MIT）修改。原版权归原作者所有，修改部分同样以 MIT 发布，详见 `LICENSE` 与 `FORK-CHANGES.md`。

## 特性

**上游原有**
- Flash 风险判定：`DENY → 白名单 → denyRules → flash(SAFE/硬类别/中立) → 学习`
- 确认制学习：neutral 操作人工确认到阈值后自动放行；指纹 / 语义同类验证
- 设置页规则卡片、审批视图、diff 对比与撤销、快照清理

**本 fork 新增**
- **真实工具参数判定**：按 `callId` 从 session 事件取实际 tool call 参数（不只是模型写的理由），脱敏、截断 4KB
- **记住 / 取消记住**：审批视图单行「记住这次操作」→ 写入白名单；状态持久化；可随时取消；有路径用路径指纹，没有路径用整句描述精确匹配
- **可写根目录信任** `trustRoots`：配置后范围内操作直接放行（零点击）
- **会话记忆 + 跨会话晋升**：本会话批准过的同指纹操作直接放行；跨会话确认后沉淀全局规则
- **签名毕业**：同类操作（工具+模式+目录/扩展名模式）累计人工确认后自动沉淀规则，要求多指纹、无拒绝历史、意图信号
- **自学习（可选）**：不看人工确认，直接从 Flash 的连续 SAFE 判定中毕业签名（`selfLearn`，阈值/会话数可配，带拒绝历史护栏与规则数量上限）
- **负反馈**：拒绝或「撤销改动」会删除对应学习规则/记忆并升级永久人工
- **规则库（⑦）**：白名单/永久人工/信任目录/毕业进度统一管理；搜索、启停、删除、导出 JSON、证据事件
- **规则元数据**：来源、创建时间、命中次数、最近命中；过宽规则体检（泛词 contains / 裸 mode / 过宽信任目录）并给收窄建议
- **拒绝计数升级（D）**：连续 3 次或累计 20 次拒绝 → `escalate` 事件 + 审批视图红色「需人工介入」
- **两段式判定（B，默认关）**：快筛 `ALLOW/REVIEW` + 复评；实测快筛模型偏保守，默认关闭，可在设置⑥开启并指定快筛模型
- **兼容修复**：Flash `reasoningEffort: off` 降级重试、`permissionPresets.current(session)` API 适配、快照按钮统计修复、重复事件 id 消歧

## 安装（当前 DSH 0.2.x）

**方式一（推荐）：直接安装 fork 包**

```sh
dsh plugin --profile desktop add github:suiyideali/dsh-moongate
# 发布 npm 后也可以：dsh plugin --profile desktop add dsh-moongate
```

**方式二：给上游打补丁**（保留上游包名；完整 diff 在 `patches/`）

```sh
# 1) 安装上游包（若尚未安装）
dsh plugin --profile desktop add dsh-approval-gate@0.5.0

# 2) 复制补丁
cp patches/dsh-approval-gate@0.5.0.patch ~/.dsh/profiles/desktop/patches/

# 3) 在 ~/.dsh/profiles/desktop/pnpm-workspace.yaml 增加
# patchedDependencies:
#   'dsh-approval-gate@0.5.0': patches/dsh-approval-gate@0.5.0.patch

# 4) 重装应用补丁（用 profile 自带的 pnpm 11）
cd ~/.dsh/profiles/desktop
"$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node" \
  "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs" install
```

> 上面的 pnpm 路径按本机运行时为准；也可以直接用 `pnpm install`（版本需匹配 profile 的 store）。

**权限预设**（必须手动加到 profile 的 `cordis.patch.yml`，presets 表是冻结的）：

```yaml
- id: permission
  name: '@deepseek-ai/dsh-permission-presets'
  config:
    presets:
      read-only: { sandbox: read-only, approval: ask }
      workspace-write: { sandbox: workspace-write, approval: ask }
      danger-full-access: { sandbox: danger-full-access, approval: never }
      auto-approve:
        sandbox: workspace-write
        approval: ask
        name: 自动审批（Flash）
        description: 学习式自动审批：写工作区自动放行，同类操作确认后自动同意，危险操作转人工。
```

安装/修改 host 代码后需要重载插件（禁用/启用该插件行，或重启 App）；client 改动刷新页面即可。

## 配置（`~/.dsh/auto-approve/allowlist.json`，热生效）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `denyKeywords` | 内置 | 命中即转人工（不可逆危险词） |
| `allowRules` | 工作区写入 | 白名单（支持 tool/mode/category/contains/signature/disabled） |
| `denyRules` | `[]` | 永久人工规则 |
| `hardCategories` | deletion/credential/remote/system/bulk | 硬风险类别，永不学习 |
| `riskyThreshold` | 3 | neutral 确认阈值 |
| `judgeTimeoutMs` | 20000 | Flash 判定超时 |
| `trustRoots` | `[]` | 信任目录（结果直接放行） |
| `sessionMemory` | true | 会话内批准记忆 |
| `promotionSessions` | 2 | 跨会话晋升所需会话数（无意图信号时 +1） |
| `graduationThreshold` | 3 | 毕业所需人工确认次数（无意图信号时 +1） |
| `graduationSessions` | 2 | 毕业所需会话数 |
| `selfLearn` | false | 自学习：从 Flash SAFE 判定毕业，不需要人工确认 |
| `selfLearnThreshold` | 5 | 自学习需要的 SAFE 次数 |
| `selfLearnSessions` | 2 | 自学习需要的会话数 |
| `selfLearnMaxRules` | 50 | 自学习规则数量上限 |
| `twoStage` | false | 两段式判定开关 |
| `stage1Provider` / `stage1Model` | 空 | 快筛模型（留空用默认模型） |
| `denyEscalateConsecutive` | 3 | 连续拒绝升级阈值 |
| `denyEscalateTotal` | 20 | 累计拒绝升级阈值 |

## UI

- **审批视图**（轨迹右侧「审批」）：本会话记录、自动放行/人工通过/拒绝/需人工介入、diff 与撤销、记住/取消记住、参数行、拒绝计数与重置。
- **设置 → 自动审批**：① DENY ② 白名单 ③ 永久人工 ④ Flash 阈值 ⑤ 学习沉淀 ⑥ 自动学习 ⑦ 规则库。
- ⑦ 规则库包含规则体检、启停、导出、证据事件复制。

## 测试与 CI

```sh
npm test   # node --check + smoke tests
```

CI（`.github/workflows/ci.yml`）会跑语法检查、smoke 测试，并验证补丁能干净地应用到上游 `0.5.0`。

## 安全说明

- 硬风险类别永不自动放行、永不学习。
- 自动审批会显著降低人工介入，请在可信环境使用；生产/支付等场景保持人工审批。
- 学习规则可随时在 ⑦ 停用/删除；撤销改动会触发负反馈降级。
- 两段式默认关闭：实测当前 Flash 快筛对 `danger-full-access` 过于保守，收益有限。

## 已知限制

- 学习/决议基于 approval 请求的理由文本与工具参数；理由文本由模型生成时可能不准确（A 改造已优先使用真实参数）。
- 会话内批准记忆只在插件进程内，插件重载后清空；跨会话晋升/毕业持久化在 `memory.json`。
- 快筛模型覆盖在部分 provider/模型路由上会失败（会安全回退到复评）；`twoStage` 默认关闭。
- 针对 DSH 0.2.x 的 API 适配；DSH 升级后可能需要再次调整。

## 致敬 / Credits

本项目是 [moon09300731/dsh-approval-gate](https://github.com/moon09300731/dsh-approval-gate) v0.5.0（MIT）的衍生版。上游的 Flash 判定管道、确认制学习与审批视图是本项目的地基；包名 `moongate`（月门）取意自原作者的 ID `moon09300731`，作为致敬。原版权归原作者所有，修改部分同样以 MIT 发布。

如果你喜欢这套思路，也请给上游点一个 Star。

## License

MIT，见 `LICENSE`（保留原作者版权声明）。修改内容同样以 MIT 提供，不提供担保。
