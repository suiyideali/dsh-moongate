# dsh-moongate (learning-enhanced fork)

Auto-approval gate for DeepSeek Harness: Flash risk judging + confirmation-based learning + zero-click learning (session memory, cross-session promotion, signature graduation) + a rule library.

> **Upstream & license**: forked from [moon09300731/dsh-approval-gate](https://github.com/moon09300731/dsh-approval-gate) v0.5.0 (MIT). Original copyright belongs to the upstream author; modifications are released under MIT as well. See `LICENSE` and `FORK-CHANGES.md`.

## Features

**Upstream**
- Flash judging pipeline: `DENY → allowlist → denyRules → flash (SAFE / hard category / neutral) → learning`
- Confirmation-based learning for neutral operations; fingerprint + semantic similarity checks
- Settings cards, approval history view, diff & revert, snapshot cleanup

**Fork additions**
- **Real tool arguments**: resolve `callId` to the actual `tool/call` arguments from session events (redacted, truncated to 4 KB) instead of trusting model-written justifications
- **Remember / forget**: one click in the approval view; persisted state; path fingerprint when available, exact-description matching otherwise
- **Trust roots** (`trustRoots`): configure once, operations inside are approved without prompting
- **Session memory + cross-session promotion**: approved-once operations repeat silently in the same session; repeated across sessions becomes a global rule
- **Signature graduation**: operations are normalized to `tool|mode|directory/ext` signatures and graduated into rules after enough human confirmations (multi-fingerprint, no deny history, intent signal)
- **Self-learning** (opt-in): graduates a signature from repeated Flash `SAFE` verdicts without any human confirmation (`selfLearn`, threshold/sessions configurable), with deny-history guard and a per-source rule cap
- **Negative feedback**: rejecting or reverting an auto-approved change removes the learned rule/memory and makes the pattern permanently manual
- **Rule library (⑦)**: unified management for allow/deny/trust/graduation; search, enable/disable, delete, JSON export, evidence event
- **Rule metadata**: source/createdAt/hitCount/lastHit; over-broad rule scan (generic `contains`, blanket mode, huge trust roots) with narrowing suggestions
- **Reject counters (D)**: consecutive 3 / total 20 rejections → `escalate` event and a red “needs human” badge
- **Two-stage judging (B, defaults off)**: fast `ALLOW/REVIEW` screen + deep re-check; configurable fast model. Current fast model is too conservative to pay off, so it is off by default
- **Compatibility fixes**: `reasoningEffort` fallback, `permissionPresets.current(session)` API, snapshot-button statistics, duplicate event-id disambiguation

## Install (DSH 0.2.x)

**Option 1 (recommended): install the fork package**

```sh
dsh plugin --profile desktop add github:suiyideali/dsh-moongate
# after publishing to npm: dsh plugin --profile desktop add dsh-moongate
```

**Option 2: patch the upstream package** (keeps the upstream package name; full diff in `patches/`)

```sh
dsh plugin --profile desktop add dsh-approval-gate@0.5.0
cp patches/dsh-approval-gate@0.5.0.patch ~/.dsh/profiles/desktop/patches/
# add to ~/.dsh/profiles/desktop/pnpm-workspace.yaml:
# patchedDependencies:
#   'dsh-approval-gate@0.5.0': patches/dsh-approval-gate@0.5.0.patch
cd ~/.dsh/profiles/desktop
"$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node" \
  "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs" install
```

**Permission preset** (must be added to the profile `cordis.patch.yml`; the preset table is frozen at composition):

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

Reload the plugin after host changes (toggle the plugin row or restart the app). Client-only changes need a page refresh.

## Configuration (`~/.dsh/auto-approve/allowlist.json`, hot-reloaded)

| Field | Default | Meaning |
| --- | --- | --- |
| `denyKeywords` | built-in | Always manual when matched |
| `allowRules` | workspace-write | allowlist rules (tool/mode/category/contains/signature/disabled) |
| `denyRules` | `[]` | permanently manual rules |
| `hardCategories` | deletion/credential/remote/system/bulk | never learned |
| `riskyThreshold` | 3 | neutral confirmation threshold |
| `judgeTimeoutMs` | 20000 | Flash judge timeout |
| `trustRoots` | `[]` | trusted directories (allowed without prompting) |
| `sessionMemory` | true | session-scoped approval memory |
| `promotionSessions` | 2 | sessions needed for cross-session promotion (+1 without intent signal) |
| `graduationThreshold` | 3 | human confirmations needed for graduation (+1 without intent signal) |
| `graduationSessions` | 2 | sessions needed for graduation |
| `selfLearn` | false | learn from Flash SAFE verdicts without human confirmation |
| `selfLearnThreshold` | 5 | SAFE observations needed to graduate a signature |
| `selfLearnSessions` | 2 | sessions needed for self-learning |
| `selfLearnMaxRules` | 50 | cap on self-learned rules |
| `twoStage` | false | two-stage judging switch |
| `stage1Provider` / `stage1Model` | empty | fast-screen model (empty = default) |
| `denyEscalateConsecutive` | 3 | consecutive rejections before escalation |
| `denyEscalateTotal` | 20 | total rejections before escalation |

## UI

- **Approval view** (right of the trajectory): per-session records, auto/manual/rejected/needs-human badges, diff & revert, remember/forget, argument line, reject counter + reset.
- **Settings → Auto approval**: ① DENY ② allowlist ③ denyRules ④ Flash thresholds ⑤ learning progress ⑥ auto-learning ⑦ rule library.
- The rule library includes the health check, enable/disable, JSON export and evidence copy.

## Safety

- Hard-risk categories are never auto-approved and never learned.
- Auto approval significantly reduces human oversight; use it in trusted environments and keep manual approval for production/payments.
- Learned rules can be disabled/deleted in ⑦ at any time; reverting a change triggers negative feedback.

## Tests

```sh
npm test   # node --check + smoke tests
```

CI (`.github/workflows/ci.yml`) runs syntax checks, smoke tests, and verifies that the patch applies cleanly to upstream `0.5.0`.

## Known limitations

- Judgments rely on approval justifications plus real tool arguments; a misleading justification can still be wrong, which is why real arguments are preferred.
- Session memory is in-process and cleared on plugin reload; cross-session memory lives in `memory.json`.
- Fast-screen model overrides fail on some provider routes (falls back safely); `twoStage` stays off by default.
- API adaptation targets DSH 0.2.x; re-verify after DSH upgrades.

## Credits / homage

This project is a derivative of [moon09300731/dsh-approval-gate](https://github.com/moon09300731/dsh-approval-gate) v0.5.0 (MIT). The upstream Flash judging pipeline, confirmation-based learning and approval view are the foundation. The name `moongate` is a nod to the upstream author's handle `moon09300731`. Original copyright remains with the upstream author; modifications are released under MIT.

If you like the idea, please give upstream a star too.

## License

MIT, see `LICENSE` (upstream copyright preserved). Modifications are provided under MIT without warranty.
