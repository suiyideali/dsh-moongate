![dsh-moongate](docs/social-preview.svg)

# dsh-moongate

**一个会从你的审批里学习的 DeepSeek Harness 自动审批门控。**

> 越用越少点：安全操作自动放行，同类操作确认几次后自动沉淀规则，危险操作永远交给你。
>
> **致敬原项目**：本项目基于 [moon09300731/dsh-approval-gate](https://github.com/moon09300731/dsh-approval-gate) v0.5.0（MIT）扩展而来；`moongate`（月门）取意自原作者 ID `moon09300731`。详见 [原项目](#原项目--credits)。

[简体中文](README.md) · [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.x-4D6BFE)](https://www.deepseek.com/harness/)
[![CI](https://github.com/suiyideali/dsh-moongate/actions/workflows/ci.yml/badge.svg)](https://github.com/suiyideali/dsh-moongate/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)
[![GitHub stars](https://img.shields.io/github/stars/suiyideali/dsh-moongate?style=social)](https://github.com/suiyideali/dsh-moongate)

DeepSeek Harness 默认会在命令和文件修改前询问你。问题是：真实使用中大多数请求都是安全的，人会疲劳、会闭眼点"允许"——审批就变成了走过场。

`dsh-moongate` 在这个位置做三件事：

1. **先判断**：越界请求交给 Flash，结合真实 tool call 参数判断是否可回补、是否触碰敏感资源；
2. **从你的决定里学**：你批准/拒绝过的操作会被记住，本会话直接复用、跨会话晋升、同类操作毕业，全程不需要额外交互；
3. **给你透明度和控制权**：规则库、命中次数、证据事件、启停/删除/导出，以及审批页的统计、趋势与筛选。

危险类别（删除、凭据、远程/生产、系统、批量）**永不自动放行、也永不学习**。

---

## 目录

- [为什么是它](#为什么是它)
- [功能](#功能)
- [安装](#安装)
- [快速开始](#快速开始)
- [界面](#界面)
- [工作原理](#工作原理)
- [学习模型](#学习模型)
- [配置](#配置)
- [安全模型](#安全模型)
- [兼容性](#兼容性)
- [开发与测试](#开发与测试)
- [路线图](#路线图)
- [FAQ](#faq)
- [参与贡献](#参与贡献)
- [原项目 / Credits](#原项目--credits)
- [License](#license)

---

## 为什么是它

审批疲劳是真实问题：用户对权限弹窗的接受率极高，久而久之"允许"变成肌肉记忆。常见的两个极端是：

- **沙箱**很安全，但每个新能力都要配置，跨目录/网络很快就会打断工作；
- **跳过权限**很省事，但没有任何保护。

`dsh-moongate` 取中间路线：**模型判定 + 人类确认 + 渐进学习**。它不会替你决定删除生产库，但会记住"这个测试目录里的写入你已经批准过三次"，然后下次不再问。

## 功能

| 能力 | 说明 |
| --- | --- |
| **Flash 风险判定** | `DENY → 信任目录 / 会话记忆 / 白名单 → Flash（SAFE / 硬类别 / 中立）→ 学习` |
| **真实 tool call 判定** | 通过 `callId` 从 session 事件取实际参数（脱敏、截断 4 KB），不只看模型写的理由 |
| **确认制学习** | 中立操作人工确认到阈值后自动放行；指纹命中 / Flash 语义同类验证 |
| **记住 / 取消记住** | 审批页单行操作；有路径用路径指纹，无路径用整句描述精确匹配；可随时撤销 |
| **信任目录** | 配置一次，目录内操作直接放行（零点击）；支持 `~/src` 这类前缀 |
| **会话记忆** | 本会话批准过的同指纹操作重复出现时直接放行 |
| **跨会话晋升** | 多会话确认后沉淀全局规则（要求路径指纹、意图信号、无拒绝历史） |
| **签名毕业** | 同类操作累计人工确认后自动毕业为规则（多指纹、2 个会话、无拒绝历史） |
| **自学习（可选）** | 从 Flash 连续 `SAFE` 判定中毕业签名，无需人工确认；默认关，可配阈值/会话/上限 |
| **负反馈** | 拒绝或「撤销改动」会删除对应规则/记忆并升级为永久人工 |
| **规则库** | 白名单/永久人工/信任目录/毕业进度统一管理；搜索、启停、删除、导出 JSON、证据事件 |
| **规则体检** | 泛词 `contains`、裸 mode、过宽信任目录自动提示，并给出收窄建议 |
| **拒绝计数升级** | 连续 3 次 / 累计 20 次拒绝 → `escalate` 事件与红色"需人工介入"标记 |
| **两段式判定** | 快筛 `ALLOW/REVIEW` + 复评；默认关，可指定快筛模型 |
| **审批仪表盘** | 统计卡、四段分布、7 天趋势、Top 工具、筛选搜索、按日期分组时间线 |

## 安装

> 当前适配 **DeepSeek Harness 0.2.x**（实测 0.2.2-rc.1）。安装/更新 host 代码后重载插件（禁用/启用插件行或重启 App）；只改 client 时刷新页面即可。

### 方式一：安装 fork 包（推荐）

从 GitHub 安装：

```sh
dsh plugin --profile desktop add github:suiyideali/dsh-moongate
```

发布到 npm 后也可以：

```sh
dsh plugin --profile desktop add dsh-moongate
```

### 方式二：给上游包打补丁

如果你已经在用上游 `dsh-approval-gate@0.5.0`，可以只应用完整 diff（`patches/`）：

```sh
# 1) 安装上游包（若尚未安装）
dsh plugin --profile desktop add dsh-approval-gate@0.5.0

# 2) 复制补丁
cp patches/dsh-approval-gate@0.5.0.patch ~/.dsh/profiles/desktop/patches/

# 3) 在 ~/.dsh/profiles/desktop/pnpm-workspace.yaml 增加
# patchedDependencies:
#   'dsh-approval-gate@0.5.0': patches/dsh-approval-gate@0.5.0.patch

# 4) 重装应用补丁（pnpm 版本需匹配 profile 的 store）
cd ~/.dsh/profiles/desktop
pnpm install
```

### 配置权限预设（两种方式都需要）

权限预设表在组合时冻结，必须手动加一条到 profile 的 `cordis.patch.yml`：

```yaml
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
      auto-approve:
        sandbox: workspace-write
        approval: ask
        name: 自动审批（Flash）
        description: 学习式自动审批：写工作区自动放行，同类操作确认后自动同意，危险操作转人工。
```

重启或重载后，会话权限下拉会出现「自动审批（Flash）」。

## 快速开始

1. 在会话权限下拉选择 **「自动审批（Flash）」**——只对该会话生效，其他会话不受影响。
2. 第一次打开设置 → 自动审批 → **⑥ 自动学习** 时，会看到一次性引导：
   - **保持推荐（保守）**：会话记忆/跨会话晋升/签名毕业已开启，自学习关闭；
   - **开启自学习（激进）**：从 Flash 的 `SAFE` 判定直接学习，无需人工确认。
3. 正常干活：安全操作自动放行；不确定的操作弹窗给你；你批准的同类操作会逐渐沉淀。
4. 需要更可控时：
   - 审批页每行 **「记住这次操作」**：立刻写入白名单；已记住可 **「取消记住」**；
   - 设置 → **⑦ 规则库**：搜索、启停、删除、导出、复制证据事件；
   - 设置 → **⑥ 自动学习**：调阈值、会话数、自学习参数。

## 界面

审批页（轨迹右侧「审批」标签）是一个仪表盘，而不是简单列表：

- **统计卡**：自动放行 / 人工通过 / 已拒绝 / 需人工介入，带百分比；
- **分布条**：四类占比；**规则概览**：规则总数 / 自学习 / 毕业 / 信任目录；
- **最近 7 天趋势**：每日审批量柱状图；
- **Top 工具**：按工具聚合的前 5 名；
- **筛选与搜索**：类型 chips + 工具/理由/参数搜索；
- **时间线**：按日期分组，保留参数、记住/取消、diff 快照。

![审批页示意](docs/approval-view.svg)

> 示意图用于展示信息结构，实际样式以插件渲染为准。

设置页（设置 → 自动审批）分为 7 张卡片：

| 卡片 | 内容 |
| --- | --- |
| ① DENY 层 | 不可逆危险词黑名单 |
| ② 白名单 | 自动放行的规则（来源/命中次数） |
| ③ 永久人工 | 拒绝升级的规则 |
| ④ Flash 判定 | `riskyThreshold`、`judgeTimeoutMs` |
| ⑤ 学习沉淀 | 正在学习的 key、确认进度，可终止 |
| ⑥ 自动学习 | 会话记忆、晋升、毕业、自学习、两段式开关与参数 |
| ⑦ 规则库 | 四类规则统一管理 + 规则体检 + 导出 |

## 工作原理

```mermaid
flowchart TD
  A[沙箱越界 approval/request] --> B{会话预设 = auto-approve?}
  B -- 否 --> H[交给人工 / 其他应答者]
  B -- 是 --> C{DENY 危险词}
  C -- 命中 --> H
  C -- 未命中 --> D{信任目录 / 会话记忆 / 白名单}
  D -- 命中 --> E[自动放行]
  D -- 未命中 --> F[Flash 判定<br/>工具 + 真实参数]
  F -- SAFE --> E
  F -- 硬风险类别 --> H
  F -- 中立 --> G[确认制学习 n/N]
  G -- 批准 --> I[计数 / 样本 / 晋升 / 毕业]
  G -- 拒绝 --> J[denyRule 永久人工]
```

- **只拦截沙箱越界请求**：普通工作区内读写不会经过它。
- **按会话门控**：没有选择「自动审批（Flash）」的会话完全不受影响。
- **fail-safe**：Flash 超时/异常/输出无法解析 → 一律转人工，绝不自动放行。
- **真实参数优先**：判定输入来自 `tool/call` 事件（按 `callId` 关联），并对 `api_key`/`token`/`password`/`authorization`/`cookie` 等做脱敏；缓存上限 8 KB。

## 学习模型

| 层 | 信号来源 | 生效范围 | 默认 |
| --- | --- | --- | --- |
| 记住（手动） | 你点「记住这次操作」 | 全局规则 | 可用 |
| 信任目录 | 你的显式配置 | 目录前缀 | 空 |
| 会话记忆 | 本会话中的人工批准 | 当前会话 | 开 |
| 跨会话晋升 | 多个会话的人工批准 | 全局规则 | 开（2 会话） |
| 签名毕业 | 同类操作多次人工批准 | 全局规则 | 开（3 次 / 2 会话） |
| 自学习 | Flash 连续 `SAFE` 判定 | 全局规则 | **关**（可开） |

自学习默认关闭是有意的：它是唯一没有任何人工标签的层，默认打开会把模型误判固化成规则。开启后仍有护栏：路径签名、无拒绝历史、会话数/次数阈值、规则数量上限（50），拒绝/撤销会删除对应规则与进度。

## 配置

数据统一在 `~/.dsh/auto-approve/`，修改 `allowlist.json` 即时生效（热更新）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `denyKeywords` | 内置 | 命中即转人工的不可逆危险词 |
| `allowRules` | 工作区写入 | 白名单规则：`tool/mode/category/contains/signature/disabled` |
| `denyRules` | `[]` | 永久人工规则 |
| `hardCategories` | deletion/credential/remote/system/bulk | 硬风险类别，永不学习 |
| `riskyThreshold` | 3 | neutral 操作确认阈值 |
| `judgeTimeoutMs` | 20000 | Flash 判定超时（重试 1 次） |
| `trustRoots` | `[]` | 信任目录，范围内直接放行 |
| `sessionMemory` | true | 会话内批准记忆 |
| `promotionSessions` | 2 | 跨会话晋升所需会话数（无意图信号时 3） |
| `graduationThreshold` | 3 | 签名毕业所需人工确认次数（无意图信号时 4） |
| `graduationSessions` | 2 | 毕业所需会话数 |
| `selfLearn` | false | 自学习开关 |
| `selfLearnThreshold` | 5 | 自学习所需连续 SAFE 次数 |
| `selfLearnSessions` | 2 | 自学习所需会话数 |
| `selfLearnMaxRules` | 50 | 自学习规则上限 |
| `twoStage` | false | 两段式判定开关 |
| `stage1Provider` / `stage1Model` | 空 | 快筛模型（留空用默认） |
| `denyEscalateConsecutive` | 3 | 连续拒绝升级阈值 |
| `denyEscalateTotal` | 20 | 累计拒绝升级阈值 |

文件：

| 文件 | 用途 |
| --- | --- |
| `allowlist.json` | 规则与配置 |
| `learning.json` | 确认制学习计数与样本 |
| `memory.json` | 跨会话记忆与毕业/自学习进度 |
| `audit.log` | 判定审计（ALLOW / TRUST / SESSIONMEM / LEARN / GRADUATE / PROMOTE / NEGATIVE / ESCALATE / …） |
| `events.jsonl` | 审批事件（供审批页，含 `remembered`、`args` 等字段） |
| `snapshots/` | 自动放行前文件快照（供 diff / 撤销） |

## 安全模型

- **硬风险永不自动**：删除/覆盖不可再生数据、凭据、远程/生产、系统路径、批量不可回补，命中即人工，不计数、不学习。
- **拒绝优先**：被拒绝过的指纹/签名升级为永久人工，且会删除对应学习规则与记忆。
- **撤销降级**：在审批页撤销一次自动放行的改动，会触发负反馈，删除对应规则。
- **输入脱敏**：真实参数在进入模型前做密钥脱敏并截断。
- **规则可审计**：每条规则带来源、创建时间、命中次数、最近命中；记住/自学习规则带证据事件。
- **规则体检**：泛词 `contains`、无 `tool/contains` 的裸规则、`danger-full-access` 裸规则、`~`/`/` 级信任目录会被标红并可一键停用。

> ⚠️ 自动审批会显著降低人工介入。请在可信环境使用；生产数据、支付、远程系统等场景请保持人工审批或 `ask` 预设。

## 兼容性

- 面向 **DeepSeek Harness 0.2.x**，已在 0.2.2-rc.1 验证；
- 修复了上游在 0.2.x 上的 `permissionPresets.current(session)` API 适配与 Flash `reasoningEffort: off` 兼容问题；
- DSH 升级后如 API 变化，需要重新适配；欢迎提 Issue/PR。

## 开发与测试

```sh
npm test        # node --check + smoke tests
```

CI（`.github/workflows/ci.yml`）会执行：

1. `node --check src/index.mjs` 与 `node --check client.js`；
2. `scripts/smoke.mjs`（插件导出、client 关键标记、补丁存在性）；
3. 下载上游 `dsh-approval-gate@0.5.0` 并验证补丁可干净应用；
4. LICENSE 检查。

本地修改流程：

- host 改动：改 `src/index.mjs` → 重新应用 pnpm patch（或直接替换 profile 内包）→ 重载插件；
- client 改动：改 `client.js` → 刷新页面；
- 提交前跑 `npm test`。

## 路线图

- [ ] 规则库行内编辑（当前为启停/删除/新增）；
- [ ] 语义近似复用（从一次批准泛化到同类操作）；
- [ ] Shadow 模式：先记录"本可自动放行"的候选，观察期后启用；
- [ ] 更细的按项目/目录统计与趋势；
- [ ] i18n（界面文案目前以中文为主）。

## FAQ

**Q：为什么自学习默认关闭？**
A：它是唯一不从人工批准中学习的层。默认开启等于替用户做激进决定；需要时在⑥一键开启。

**Q：和上游 `dsh-approval-gate` 能同时装吗？**
A：不建议。两者会争夺同一个 `auto-approve` 预设与 `approval/request` 事件；请二选一。

**Q：学习数据存在哪？升级会丢吗？**
A：`~/.dsh/auto-approve/`。卸载/重装插件不会删除；DSH 升级后请先备份该目录。

**Q：只信任某个目录怎么写？**
A：⑥ 或 ⑦ → 信任目录，填 `~/src`（支持 `~` 前缀），范围直接放行，仍受 DENY 与硬风险规则约束。

**Q：为什么审批页看不到记录？**
A：当前会话还没有越界请求，或没有选中「自动审批（Flash）」预设。

## 参与贡献

- 先开 Issue 描述场景/复现，再提 PR；
- 保持 `npm test` 通过，新增行为尽量补 smoke 断言；
- 不要提交本地路径、凭据或测试残留；
- 涉及安全语义的改动请在 PR 里写清威胁模型与回退方式。

## 原项目 / Credits

本项目基于 **[moon09300731/dsh-approval-gate](https://github.com/moon09300731/dsh-approval-gate)** v0.5.0（MIT）：

- 原项目：<https://github.com/moon09300731/dsh-approval-gate>
- 作者：moon09300731
- 继承：Flash 判定管道、确认制学习、设置页规则卡片、审批视图、diff 撤销与快照
- 本 fork 新增：真实参数判定、记住/取消、信任目录、会话记忆/跨会话晋升、签名毕业、自学习、规则库、审批仪表盘等（详见 [FORK-CHANGES.md](FORK-CHANGES.md)）

`moongate`（月门）取意自原作者 ID `moon09300731`，作为致敬。感谢原作者的设计与实现；如果你喜欢这套思路，也请给原项目点一个 Star。

原版权归原作者所有，修改部分同样以 MIT 发布，见 [LICENSE](LICENSE)。

## License

[MIT](LICENSE) © 2026 moon09300731（原项目）及 dsh-moongate 贡献者。修改部分不提供担保。

[![Star History Chart](https://api.star-history.com/svg?repos=suiyideali/dsh-moongate&type=Date)](https://star-history.com/#suiyideali/dsh-moongate&Date)
