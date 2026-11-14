/**
 * dsh-moongate — 自动审批审查界面（浏览器端 bundle）
 *
 * 提供两处 UI（严格按 DSH 设计语言，--dsw-alias-* tokens）：
 * 1. ✅ 自动放行提示条：conversation.input.dock（输入框上方独立行，order=30，
 *    排在 todo/goal/queue 之下；无事件时完全隐藏不占位；不随流式对话滚动）
 * 2. 「审批」历史视图：conversation.view（order=20，chat=0/trajectory=10 →
 *    tab 显示在「轨迹」右侧），展示当前会话所有自动放行的动作时间线
 *    （命令、原因、涉及文件、判定路径、时间）
 *
 * 数据源：轮询 host 提供的 GET /api/auto-approve/events?sessionId=&since=
 * （events.jsonl 由 host 插件在每次自动放行时追加）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-moongate',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    // UI locale: follow the browser language; Chinese remains the default.
    const UI_EN = (function () {
      try { return /^en\b/i.test((typeof navigator !== 'undefined' && navigator.language) || '') } catch (e) { return false }
    })()
    function T(zh, en) { return UI_EN ? (en || zh) : zh }

    const CSS = `
.ag-notice{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));margin:0 auto;flex:none}
.ag-notice-card{box-sizing:border-box;display:flex;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:6px 10px 6px 12px;box-shadow:var(--dsw-shadow-lv1)}
.ag-notice-card-pending{border-color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-tertiary)}
.ag-notice-card-manual{border-color:var(--dsw-alias-state-warn-primary)}
.ag-notice-glyph{color:var(--dsw-alias-state-success-primary);flex:none;display:inline-flex;align-items:center;justify-content:center}
.ag-notice-glyph-warn{color:var(--dsw-alias-state-warn-label);flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:16px;width:16px;height:16px}
.ag-notice-glyph-err{color:var(--dsw-alias-state-error-primary);flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:16px;width:16px;height:16px}
.ag-notice-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.ag-notice-head{display:flex;align-items:center;gap:8px;min-width:0}
.ag-notice-tool{flex:none;color:var(--dsw-alias-label-primary);font:500 12px/18px var(--ds-font-family-code)}
.ag-notice-text{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.ag-notice-meta{display:flex;align-items:center;gap:8px}
.ag-tag{box-sizing:border-box;flex:none;height:18px;color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-tertiary);border-radius:9px;align-items:center;padding:0 8px;font-size:11px;line-height:18px;display:inline-flex;letter-spacing:.02em}
.ag-tag-neutral{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform)}
.ag-tag-warn{box-sizing:border-box;flex:none;height:18px;color:var(--dsw-alias-state-warn-label);background:var(--dsw-alias-state-warn-tertiary);border-radius:9px;align-items:center;padding:0 8px;font-size:11px;line-height:18px;display:inline-flex;letter-spacing:.02em}
.ag-tag-err{box-sizing:border-box;flex:none;height:18px;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger);border-radius:9px;align-items:center;padding:0 8px;font-size:11px;line-height:18px;display:inline-flex;letter-spacing:.02em}
.ag-time{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
.ag-notice-close{width:24px;height:24px;flex:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:none;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;padding:0}
.ag-notice-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.ag-view{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);position:relative}
.ag-view::after{content:"";pointer-events:none;position:absolute;left:0;right:0;bottom:0;height:32px;z-index:3;background:linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-layer-1) 0%, transparent) 0px, var(--dsw-alias-bg-layer-1) 32px)}
.ag-view-head{box-sizing:border-box;flex:none;border-bottom:1px solid var(--dsw-alias-border-l2);padding:10px 14px 8px;display:flex;flex-direction:column;gap:2px}
.ag-view-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.ag-view-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.ag-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 14px 48px;display:flex;flex-direction:column;gap:2px}
.ag-row{box-sizing:border-box;display:flex;gap:10px;padding:9px 10px;border-radius:10px;transition:background .1s ease}
.ag-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ag-row-rail{flex:none;display:flex;flex-direction:column;align-items:center;gap:4px;padding-top:2px}
.ag-row-glyph{color:var(--dsw-alias-state-success-primary);flex:none;display:inline-flex}
.ag-row-glyph-warn{color:var(--dsw-alias-state-warn-label);flex:none;display:inline-flex;font-size:12px;line-height:16px;width:14px;height:14px;align-items:center;justify-content:center}
.ag-row-glyph-err{color:var(--dsw-alias-state-error-primary);flex:none;display:inline-flex;font-size:12px;line-height:16px;width:14px;height:14px;align-items:center;justify-content:center}
.ag-row-line{flex:1 1 auto;flex:none;width:1px;background:var(--dsw-alias-border-l1);min-height:10px}
.ag-row:last-child .ag-row-line{display:none}
.ag-row-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px}
.ag-row-top{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.ag-row-tool,.ag-tag{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.ag-row-tool{flex:none;color:var(--dsw-alias-label-primary);font:500 12px/18px var(--ds-font-family-code)}
.ag-row-reason{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;word-break:break-all;white-space:pre-wrap}
.ag-row-files{display:flex;flex-wrap:wrap;gap:4px}
.ag-row-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ag-dash-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.ag-panel{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-width:0}
.ag-panel-title{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-weight:500}
.ag-trend{display:flex;align-items:flex-end;gap:8px;height:90px}
.ag-trend-col{flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;min-width:0}
.ag-trend-value{font-size:10px;line-height:14px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}
.ag-trend-bar{width:70%;max-width:34px;border-radius:4px 4px 2px 2px;background:linear-gradient(180deg,var(--dsw-alias-state-business-primary),color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent))}
.ag-trend-label{font-size:10px;line-height:14px;color:var(--dsw-alias-label-caption);white-space:nowrap}
.ag-top{display:flex;flex-direction:column;gap:6px}
.ag-top-row{display:grid;grid-template-columns:72px 1fr 24px;align-items:center;gap:6px;font-size:11px;line-height:16px}
.ag-top-name{color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ag-top-bar{height:6px;border-radius:3px;background:var(--dsw-alias-state-success-primary);opacity:.75;min-width:4px}
.ag-top-count{color:var(--dsw-alias-label-tertiary);text-align:right;font-variant-numeric:tabular-nums}
.ag-project-panel{margin-top:2px}
.ag-project-list{display:flex;flex-direction:column;gap:5px}
.ag-project-row{display:grid;grid-template-columns:120px minmax(0,1fr) 96px 170px 64px;align-items:center;gap:8px;min-width:0;font-size:11px;line-height:16px}
.ag-project-name{color:var(--dsw-alias-label-primary);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ag-project-path{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ag-project-bar{height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.ag-project-fill{display:block;height:100%;border-radius:3px;background:var(--dsw-alias-state-success-primary);opacity:.8}
.ag-project-meta{color:var(--dsw-alias-label-tertiary);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ag-project-foot{margin-top:2px;color:var(--dsw-alias-label-caption);font-size:10px;line-height:15px}
.ag-file-chip{box-sizing:border-box;max-width:260px;height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;align-items:center;padding:0 7px;font:11px/18px var(--ds-font-family-code);display:inline-flex;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.ag-empty{flex:1 1 auto;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;justify-content:center;font-size:13px;line-height:20px;padding:24px}
.ag-loading{flex:1 1 auto;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;justify-content:center;font-size:13px;line-height:20px;padding:24px}
.ag-mono{font-family:var(--ds-font-family-code)}
.ag-set{box-sizing:border-box;width:100%;max-width:720px;padding:0 0 28px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}
.ag-set-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}
.ag-set-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}
.ag-set-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;gap:12px;padding:12px 14px;display:flex}
.ag-set-card-head{flex-direction:column;gap:4px;display:flex}
.ag-set-card-title{color:var(--dsw-alias-label-primary);align-items:center;gap:8px;font-size:14px;font-weight:500;line-height:20px;display:flex}
.ag-set-stage{box-sizing:border-box;flex:none;height:20px;color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary);border-radius:10px;align-items:center;padding:0 8px;font-size:11px;font-weight:500;line-height:20px;display:inline-flex;letter-spacing:.02em}
.ag-set-card-sub{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.ag-set-note{color:var(--dsw-alias-state-warn-label);margin:0;font-size:13px;line-height:20px}
.ag-set-ok{color:var(--dsw-alias-state-success-primary);margin:0;font-size:13px;line-height:20px}
.ag-set-err{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px}
.ag-set-row{flex-wrap:wrap;gap:8px;display:flex;align-items:center}
.ag-set-input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);height:32px;min-width:0;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;outline:none;padding:0 10px;font-size:13px;line-height:20px;font-family:var(--ds-font-family-code)}
.ag-set-input:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent)}
.ag-set-input::placeholder{color:var(--dsw-alias-label-caption)}
.ag-set-input-num{width:96px}
.ag-set-btn{box-sizing:border-box;height:32px;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;border:1px solid var(--dsw-alias-border-l2);background:transparent;border-radius:16px;justify-content:center;align-items:center;gap:4px;padding:0 14px;font-size:13px;line-height:20px;display:inline-flex;white-space:nowrap}
.ag-set-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.ag-set-btn:disabled{opacity:.4;cursor:default}
.ag-set-btn-primary{border:none;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.ag-set-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.ag-set-btn-danger{color:var(--dsw-alias-state-error-primary)}
.ag-set-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.ag-set-list{flex-direction:column;gap:6px;display:flex}
.ag-set-item{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;align-items:center;gap:8px;padding:6px 10px;min-width:0;display:flex}
.ag-set-item-label{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-family:var(--ds-font-family-code);word-break:break-all}
.ag-set-item-meta{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap}
.ag-set-item-del{flex:none;width:24px;height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:none;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;padding:0}
.ag-set-item-del:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.ag-set-empty{color:var(--dsw-alias-label-caption);margin:0;font-size:13px;line-height:20px;padding:4px 2px}
.ag-set-suggest-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}
.ag-set-suggest-list{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.ag-set-suggest{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}
.ag-set-suggest-main{display:flex;flex-direction:column;gap:2px;min-width:0}
.ag-set-suggest-main code{font-size:12px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:420px}
.ag-set-tag{box-sizing:border-box;flex:none;height:18px;border-radius:9px;align-items:center;padding:0 8px;font-size:11px;line-height:18px;display:inline-flex;letter-spacing:.02em}
.ag-set-tag-blue{color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary)}
.ag-set-tag-green{color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-tertiary)}
.ag-set-tag-gray{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform)}
.ag-set-tag-red{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger)}
.ag-set-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;display:grid}
.ag-set-hc{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;color:var(--dsw-alias-label-secondary);align-items:center;justify-content:center;gap:6px;height:30px;font-size:12px;line-height:18px;display:inline-flex}
.ag-set-learn{flex-direction:column;gap:8px;display:flex}
.ag-set-learn-item{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;align-items:center;gap:8px;padding:6px 10px;min-width:0;display:flex}
.ag-set-learn-info{flex:1 1 auto;min-width:0;flex-direction:column;gap:2px;display:flex}
.ag-set-learn-key{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-family:var(--ds-font-family-code);word-break:break-all}
.ag-set-learn-sub{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.ag-set-learn-stop{flex:none;height:24px;color:var(--dsw-alias-state-error-primary);cursor:pointer;font:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;align-items:center;padding:0 10px;font-size:12px;line-height:24px;display:inline-flex;white-space:nowrap}
.ag-set-learn-stop:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}
.ag-diff-overlay{position:fixed;inset:0;z-index:900;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)}
.ag-diff-panel{box-sizing:border-box;width:min(760px,calc(100vw - 48px));max-height:min(720px,calc(100vh - 48px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;box-shadow:var(--dsw-shadow-lv3);overflow:hidden}
.ag-diff-head{box-sizing:border-box;flex:none;border-bottom:1px solid var(--dsw-alias-border-l2);padding:12px 14px;display:flex;flex-direction:column;gap:4px}
.ag-diff-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;display:flex;align-items:center;gap:8px}
.ag-diff-path{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-family:var(--ds-font-family-code);word-break:break-all}
.ag-diff-stats{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.ag-diff-stats-add{color:var(--dsw-alias-state-success-primary)}
.ag-diff-stats-del{color:var(--dsw-alias-state-error-primary)}
.ag-diff-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;font-family:var(--ds-font-family-code);font-size:12px;line-height:19px}
.ag-diff-line{box-sizing:border-box;display:flex;gap:8px;padding:1px 8px;white-space:pre-wrap;word-break:break-all;min-width:0}
.ag-diff-line-add{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-label-primary)}
.ag-diff-line-del{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.ag-diff-line-ctx{background:transparent;color:var(--dsw-alias-label-secondary)}
.ag-diff-line-add .ag-diff-marker{color:var(--dsw-alias-state-success-primary)}
.ag-diff-line-del .ag-diff-marker{color:var(--dsw-alias-state-error-primary)}
.ag-diff-line-ctx .ag-diff-marker{color:var(--dsw-alias-label-tertiary)}
.ag-diff-marker{flex:none;width:16px;user-select:none}
.ag-diff-line-no{flex:none;width:52px;color:var(--dsw-alias-label-caption);text-align:right;user-select:none;font-variant-numeric:tabular-nums}
.ag-diff-text{flex:1 1 auto;min-width:0}
.ag-diff-hunk-sep{box-sizing:border-box;flex:none;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;padding:2px 8px;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);margin:2px 0;user-select:none}
.ag-diff-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;padding:16px;text-align:center}
.ag-diff-foot{box-sizing:border-box;flex:none;border-top:1px solid var(--dsw-alias-border-l2);padding:10px 14px;display:flex;align-items:center;gap:8px;justify-content:flex-end}
.ag-file-chip-snap{cursor:pointer;border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.ag-file-chip-snap:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ag-snap-bar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 14px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;flex-wrap:wrap}
.ag-snap-bar b{color:var(--dsw-alias-label-secondary);font-weight:500}
.ag-snap-bar-spacer{flex:1 1 auto}
.ag-set-card{padding:14px 16px;gap:14px}
.ag-set-card-title{font-size:15px}
.ag-set-group{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.ag-set-group-title{grid-column:1/-1;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:4px 0 2px}
.ag-field{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.ag-field-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-weight:500}
.ag-field-control{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ag-field-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.ag-set-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ag-set-seg{display:inline-flex;gap:2px;padding:2px;border-radius:10px;background:var(--dsw-alias-bg-module-platform)}
.ag-set-seg-btn{border:none;background:transparent;height:28px;padding:0 10px;border-radius:8px;font:inherit;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.ag-set-seg-btn:hover{color:var(--dsw-alias-label-primary)}
.ag-set-seg-active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv1)}
.ag-rule-item{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0}
.ag-rule-main{display:flex;align-items:center;gap:8px;min-width:0}
.ag-rule-label{flex:1 1 auto;min-width:0;font:12px/18px var(--ds-font-family-code);color:var(--dsw-alias-label-primary);word-break:break-all}
.ag-rule-actions{flex:none;display:flex;align-items:center;gap:6px;margin-left:auto}
.ag-rule-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.ag-rule-sub{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.ag-alert{border:1px solid var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-tertiary);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.ag-alert-title{font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-label);font-weight:500}
.ag-alert-row{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap}
.ag-alert-text{flex:1 1 240px;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.ag-btn-xs{height:24px;padding:0 10px;border-radius:12px;font-size:12px;line-height:22px}
.ag-icon-btn{width:24px;height:24px;border-radius:6px;padding:0;font-size:12px}
.ag-args{font:11px/17px var(--ds-font-family-code);color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-module-platform);border-radius:6px;padding:4px 8px;word-break:break-all;max-height:72px;overflow:hidden}
.ag-snap-bar{padding:8px 14px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 92%, var(--dsw-alias-bg-module-platform))}
.ag-dash{flex:none;display:flex;flex-direction:column;gap:10px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.ag-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.ag-stat{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:8px 10px;display:flex;flex-direction:column;gap:2px;min-width:0}
.ag-stat-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.ag-stat-value{font-size:20px;line-height:26px;font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.ag-stat-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}
.ag-dist{display:flex;flex-direction:column;gap:4px}
.ag-dist-bar{display:flex;height:8px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-module-platform)}
.ag-dist-seg{height:100%}
.ag-dist-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.ag-toolbar2{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.ag-chip{border:1px solid var(--dsw-alias-border-l2);background:transparent;border-radius:999px;height:26px;padding:0 10px;font:inherit;font-size:12px;line-height:24px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.ag-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ag-chip-active{background:var(--dsw-alias-state-business-tertiary);border-color:transparent;color:var(--dsw-alias-state-business-primary)}
.ag-search{width:200px}
.ag-group{display:flex;flex-direction:column;gap:2px}
.ag-group-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);padding:8px 10px 2px;position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);z-index:1}
.ag-onboard{display:flex;align-items:center;gap:14px;margin:10px 14px 0;padding:11px 13px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.ag-onboard-body{min-width:0}
.ag-onboard-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:2px}
.ag-onboard-text{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.ag-onboard-actions{display:flex;gap:8px;margin-left:auto;flex:none}
.ag-learn-note{margin:8px 0 10px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.ag-tabbar{flex:none;display:flex;align-items:center;gap:4px;padding:6px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.ag-tab{border:none;background:transparent;height:28px;padding:0 10px;border-radius:8px;font:inherit;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);cursor:pointer;position:relative}
.ag-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ag-tab-active{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}
.ag-records{flex:1 1 auto;min-height:0;flex-direction:column}
.ag-settings-embed{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 12px 48px}
.ag-settings-nav{position:sticky;top:0;z-index:2;display:flex;flex-direction:column;gap:6px;padding:10px 2px 8px;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:10px}
.ag-settings-title{font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary)}
.ag-settings-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}
.ag-settings-chip{flex:none;border:1px solid var(--dsw-alias-border-l2);background:transparent;border-radius:999px;height:24px;padding:0 9px;font:inherit;font-size:11px;line-height:22px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.ag-settings-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ag-settings-embed .ag-set-card{scroll-margin-top:96px;padding:12px 14px}
.ag-settings-embed .ag-set{max-width:none}
.ag-tab-count{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;margin-left:5px;padding:0 4px;border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}
.ag-dash-head{flex:none;display:flex;align-items:center;gap:8px;padding:8px 14px 0}
.ag-attention{flex:none;display:flex;align-items:center;gap:8px;margin:8px 14px 0;padding:8px 10px;border:1px solid var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-tertiary);border-radius:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}
.ag-attention-text{flex:1 1 auto;min-width:0}
.ag-row-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}
.ag-dash-title{font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.ag-dash-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}
/* ---- 2026 visual polish: calmer hierarchy, softer surfaces, overview first ---- */
.ag-view-head{padding:16px 18px 0;border-bottom:none;background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-state-business-tertiary) 42%,var(--dsw-alias-bg-layer-1)) 0%,var(--dsw-alias-bg-layer-1) 100%);gap:0}
.ag-view-hero{display:flex;align-items:flex-start;gap:12px;min-width:0}
.ag-view-mark{flex:none;width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-state-business-primary);background:linear-gradient(145deg,var(--dsw-alias-bg-layer-1),color-mix(in srgb,var(--dsw-alias-state-business-tertiary) 70%,var(--dsw-alias-bg-layer-1)));border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,var(--dsw-alias-border-l1));box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 45%,transparent),0 4px 12px color-mix(in srgb,var(--dsw-alias-state-business-primary) 9%,transparent)}
.ag-view-heading{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px;padding-top:1px}
.ag-view-title{font-size:17px;line-height:24px;font-weight:600;letter-spacing:-.015em}
.ag-view-sub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.ag-view-badges{flex:none;display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;padding-top:4px}
.ag-view-pill{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 82%,transparent);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:20px;white-space:nowrap}
.ag-view-pill-dot{width:5px;height:5px;border-radius:999px;background:var(--dsw-alias-state-success-primary)}
.ag-tabbar{padding:12px 18px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;gap:6px}
.ag-tab{height:30px;padding:0 12px;border-radius:999px;font-weight:500;border:1px solid transparent}
.ag-tab-active{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px color-mix(in srgb,#000 7%,transparent)}
.ag-tab-count{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 11%,transparent);color:var(--dsw-alias-state-business-primary);font-weight:500}
.ag-dash-head{padding:14px 18px 0;gap:10px}
.ag-dash-heading{display:flex;align-items:baseline;gap:8px;min-width:0;flex-wrap:wrap}
.ag-dash-title{font-size:14px;line-height:20px;font-weight:600;letter-spacing:-.01em}
.ag-dash-hint{font-size:11px}
.ag-dash{padding:10px 18px 16px;gap:12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-module-platform) 38%,transparent) 0%,transparent 110px)}
.ag-stat-grid-primary{grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.ag-stat{position:relative;overflow:hidden;border-radius:12px;padding:10px 12px 11px;background:linear-gradient(180deg,var(--dsw-alias-bg-layer-1),color-mix(in srgb,var(--dsw-alias-bg-module-platform) 45%,var(--dsw-alias-bg-layer-1)));box-shadow:0 1px 2px color-mix(in srgb,#000 4%,transparent);transition:transform .14s ease,box-shadow .14s ease,border-color .14s ease}
.ag-stat::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:2px;border-radius:0 2px 2px 0;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent)}
.ag-stat:hover{transform:translateY(-1px);box-shadow:0 6px 16px color-mix(in srgb,#000 7%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 22%,var(--dsw-alias-border-l1))}
.ag-stat-label{font-size:11px;line-height:15px}
.ag-stat-value{font-size:23px;line-height:29px;font-weight:650;letter-spacing:-.02em}
.ag-stat-sub{font-size:10px;line-height:14px}
.ag-substat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.ag-substat{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;padding:7px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 84%,transparent)}
.ag-substat-label{min-width:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ag-substat-value{flex:none;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;font-weight:600;font-variant-numeric:tabular-nums}
.ag-panel{border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px color-mix(in srgb,#000 4%,transparent)}
.ag-panel-title{display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);font-weight:600}
.ag-panel-title::before{content:"";width:5px;height:5px;border-radius:999px;background:var(--dsw-alias-state-business-primary);flex:none;opacity:.8}
.ag-dist{gap:6px;padding:2px 0}
.ag-dist-bar{height:10px;box-shadow:inset 0 1px 2px color-mix(in srgb,#000 8%,transparent)}
.ag-dist-legend{gap:14px;color:var(--dsw-alias-label-secondary)}
.ag-project-panel{margin-top:0}
.ag-project-row{grid-template-columns:130px minmax(0,1fr) 84px 170px 64px;padding:3px 0}
.ag-project-name{font-size:12px}
.ag-project-bar{height:7px}
.ag-project-foot{border-top:1px dashed var(--dsw-alias-border-l1);padding-top:6px}
.ag-project-trust{display:flex;justify-content:flex-end;min-width:0}
.ag-project-trust .ag-set-btn{height:24px!important;padding:0 9px!important;font-size:11px!important}
.ag-attention{margin:10px 18px 0;border-radius:10px}
.ag-toolbar2{padding:9px 18px}
.ag-snap-bar{padding:8px 18px}
.ag-list{padding:6px 18px 48px}
.ag-empty,.ag-loading{color:var(--dsw-alias-label-tertiary)}
@media (max-width:760px){
  .ag-stat-grid-primary{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ag-substat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ag-view-badges{display:none}
  .ag-project-row{grid-template-columns:minmax(0,1fr) 90px}
  .ag-project-trust{display:none}
  .ag-project-path,.ag-project-bar{display:none}
}
/* ---- settings controls: calmer buttons, real switches ---- */
.ag-set-btn{height:30px;border-radius:9px;padding:0 12px;font-size:12px;line-height:18px;border-color:color-mix(in srgb,var(--dsw-alias-border-l2) 78%,transparent);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 78%,transparent);transition:background .14s ease,border-color .14s ease,transform .1s ease,box-shadow .14s ease}
.ag-set-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.ag-set-btn:active:not(:disabled){transform:translateY(1px)}
.ag-set-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);box-shadow:0 1px 2px color-mix(in srgb,#000 12%,transparent)}
.ag-set-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);border-color:transparent}
.ag-set-btn-danger{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 24%,var(--dsw-alias-border-l2));background:transparent}
.ag-btn-xs{height:26px;border-radius:7px;padding:0 9px;font-size:11px;line-height:16px}
.ag-field-control{gap:8px}
.ag-switch{box-sizing:border-box;position:relative;flex:none;width:36px;height:21px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-module-platform);cursor:pointer;transition:background .18s ease,border-color .18s ease;box-shadow:inset 0 1px 2px color-mix(in srgb,#000 7%,transparent);corner-shape:round}
.ag-switch:hover:not(:disabled){border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 38%,var(--dsw-alias-border-l2))}
.ag-switch:focus-visible,.ag-remember-btn:focus-visible,.ag-set-btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.ag-switch:disabled{opacity:.45;cursor:default}
.ag-switch-thumb{position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:999px;background:var(--dsw-alias-switch-thumb);box-shadow:0 1px 3px color-mix(in srgb,#000 22%,transparent);transition:transform .18s cubic-bezier(.2,.8,.2,1),background .18s ease;corner-shape:round}
.ag-switch-on{background:var(--dsw-alias-state-business-primary);border-color:transparent;box-shadow:inset 0 0 0 1px color-mix(in srgb,#fff 10%,transparent)}
.ag-switch-on .ag-switch-thumb{transform:translateX(15px);background:var(--dsw-alias-label-primary-foreground)}
.ag-switch-pair{display:inline-flex;align-items:center;gap:8px}
.ag-switch-state{min-width:30px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;white-space:nowrap}
.ag-switch-on + .ag-switch-state{color:var(--dsw-alias-label-primary)}
/* ---- remember action: high-contrast in both themes ---- */
.ag-remember-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:26px;padding:0 10px;border:1px solid transparent;border-radius:7px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:11px;font-weight:500;line-height:16px;white-space:nowrap;cursor:pointer;box-shadow:0 1px 2px color-mix(in srgb,#000 14%,transparent);transition:background .14s ease,border-color .14s ease,transform .1s ease,opacity .14s ease}
.ag-remember-btn:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.ag-remember-btn:active:not(:disabled){transform:translateY(1px)}
.ag-remember-btn:disabled{opacity:.5;cursor:default}
.ag-remember-btn-on{border-color:var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);box-shadow:none}
.ag-remember-btn-on:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ag-remember-btn-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,var(--dsw-alias-border-l2));background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);box-shadow:none}
.ag-remember-btn-error:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,var(--dsw-alias-bg-layer-1))}
/* ---- settings typography: make card headings readable ---- */
.ag-set-title{font-size:18px;font-weight:600;line-height:26px;letter-spacing:-.01em}
.ag-set-intro{font-size:14px;line-height:21px}
.ag-set-card-head{gap:6px}
.ag-set-card-title{font-size:16px;font-weight:600;line-height:24px;letter-spacing:-.005em}
.ag-set-stage{height:24px;border-radius:12px;padding:0 10px;font-size:12px;line-height:24px;font-weight:600;letter-spacing:.01em}
.ag-set-card-sub{font-size:13.5px;line-height:20px}
.ag-set-item-label{font-size:13.5px;line-height:20px}

/* ---- collapsible settings cards + dark-mode button contrast ---- */
.ag-set-card-head{cursor:pointer;position:relative;padding-right:28px;user-select:none;border-radius:6px}
.ag-set-card-head::after{content:'⌄';position:absolute;right:1px;top:0;color:var(--dsw-alias-label-tertiary);font-size:16px;line-height:24px;transition:transform .15s ease}
.ag-set-card.ag-set-collapsed .ag-set-card-head::after{content:'›';transform:none}
.ag-set-card.ag-set-collapsed > :not(.ag-set-card-head){display:none}
.ag-set-card-head:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.ag-set-btn{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);box-shadow:0 1px 2px color-mix(in srgb,#000 8%,transparent)}
.ag-set-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-label-tertiary)}
.ag-set-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.ag-set-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);border-color:transparent}
.ag-settings-chip{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:500}
.ag-settings-chip:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-label-tertiary)}
.ag-set-item-del{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
`

    const VERDICT_LABELS = {
      rule: '白名单规则',
      'flash-safe': 'Flash 判定安全',
      learned: '沉淀规则',
      fpHit: '已确认操作',
      'flash-same': 'Flash 同类验证',
      readonly: T('只读命令','Read-only command'),
      'project-trust': T('项目信任','Project trust'),
      'shadow-candidate': T('Shadow 候选','Shadow candidates')
    }
    const VERDICT_NEUTRAL = new Set(['rule', 'learned', 'fpHit', 'flash-same', 'readonly', 'project-trust'])
    const SHADOW_PATH_LABELS = {
      trust: '信任目录',
      'session-memory': '会话记忆',
      rule: '白名单规则',
      'flash-safe': 'Flash SAFE',
      learned: '沉淀规则',
      fpHit: '已确认操作',
      'flash-same': '同类验证',
      semantic: '语义复用',
      'project-trust': T('项目信任','Project trust'),
      readonly: T('只读命令','Read-only command')
    }
    const HARD_CATEGORIES = new Set(['deletion', 'credential', 'remote', 'system', 'bulk'])

    // 拒绝记录文案：按 host 记录的 path（判定路径）精确分类
    function rejectLabel(ev) {
      const p = ev && ev.path
      if (p === 'hard-category') return '人工拒绝（硬风险类别，本就永久人工）'
      if (p === 'unknown-category') return '人工拒绝（协议外类别，不升级）'
      if (p === 'deny-rule') return '人工拒绝（永久人工规则命中）'
      if (p === 'neutral-reject' || (ev && ev.category === 'neutral')) return '人工拒绝 · 已升级永久人工'
      // 兜底：旧事件无 path——按 category 兼容
      if (ev && HARD_CATEGORIES.has(ev.category)) return '人工拒绝（硬风险类别，本就永久人工）'
      return '人工拒绝'
    }

    function fmtTime(iso) {
      try {
        const d = new Date(iso)
        const p = (n) => String(n).padStart(2, '0')
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
      } catch (e) { return String(iso || '') }
    }

    function GlyphCheck() {
      return React.createElement('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
      },
        React.createElement('circle', { cx: 8, cy: 8, r: 7, fill: 'var(--dsw-alias-state-success-tertiary)' }),
        React.createElement('path', { d: 'M5 8.3L7.1 10.4L11 6', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function resolveFrame(sp) {
      let sessionId = (sp && sp.sessionId) || null
      try {
        if (!sessionId && sp && typeof sp.useSessions === 'function') {
          const state = sp.useSessions(function (s) { return s })
          sessionId = (state && state.current) || null
        }
      } catch (e) {}
      return { sessionId }
    }

    function fetchEvents(sessionId, since) {
      const q = '/api/auto-approve/events?sessionId=' + encodeURIComponent(sessionId || '') + (since ? '&since=' + since : '')
      return fetch(q, { headers: { 'cache-control': 'no-cache' } }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      }).then(function (data) {
        return (data && Array.isArray(data.events)) ? data.events : []
      })
    }

    // ================= ✅ 自动放行提示条（conversation.input.dock，order=30） =================
    function NoticeStrip(props) {
      const frame = resolveFrame(props.slotsProps || {})
      const sessionId = frame.sessionId
      const [notice, setNotice] = React.useState(null)
      const sinceRef = React.useRef(0)
      const lastShownIdRef = React.useRef(0) // 已弹过的事件最大 id（跨会话全局递增，防重复弹历史）
      const hideTimerRef = React.useRef(null)

      React.useEffect(function () {
        let alive = true
        let timer = null
        sinceRef.current = 0
        setNotice(null)
        if (!sessionId) return

        // 轮询主体：拉取游标之后的新事件；去重兜底（id 不大于已弹过的最大 id 直接跳过）
        const startPolling = function () {
          if (!alive) return
          timer = setInterval(function () {
            fetchEvents(sessionId, sinceRef.current).then(function (evs) {
              if (!alive) return
              if (evs.length === 0) return
              const last = evs[evs.length - 1]
              if (!last || last.id <= lastShownIdRef.current) return
              lastShownIdRef.current = last.id
              sinceRef.current = last.id
              const kind = last.kind || 'auto'
              setNotice(last)
              // pending（等待人工审批）不自动收起；其余按类型定时收起
              if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
              if (kind !== 'manual-pending') {
                const hold = kind === 'manual-approved' ? 5000 : 4000
                hideTimerRef.current = setTimeout(function () { setNotice(null) }, hold)
              }
            }).catch(function () {})
          }, 2000)
        }

        // 打开会话：先静默拉一次全量，仅把游标推进到最新，不弹任何历史提示；完成后再开始轮询
        fetchEvents(sessionId, 0).then(function (evs) {
          if (!alive) return
          if (evs.length > 0) sinceRef.current = evs[evs.length - 1].id
          startPolling()
        }).catch(function () {
          // 静默拉取失败：游标保持 0，靠 lastShownIdRef 去重兜底，仍启动轮询
          if (!alive) return
          startPolling()
        })

        return function () {
          alive = false
          if (timer) clearInterval(timer)
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
        }
      }, [sessionId])

      if (!notice) return null
      const kind = notice.kind || 'auto'
      const isPending = kind === 'manual-pending'
      const isManual = kind === 'manual-approved' || kind === 'manual-rejected'
      // 文案
      let title = ''
      let tagText = ''
      let glyph = null
      if (isPending) {
        title = T('等待人工审批：','Waiting for approval: ') + (notice.justification || notice.reason || '')
        tagText = T('人工审批中','Pending approval')
        glyph = React.createElement('span', { className: 'ag-notice-glyph-warn' }, '◔')
      } else if (kind === 'manual-approved') {
        const lc = notice.learningCount !== undefined ? notice.learningCount : null
        const th = notice.threshold || 3
        title = T('人工审批通过：','Approved by you: ') + (notice.justification || notice.reason || '')
        tagText = lc !== null ? ('学习 ' + lc + '/' + th + '，满 ' + th + ' 次后自动放行') : T('人工审批通过','Approved by you')
        glyph = React.createElement('span', { className: 'ag-notice-glyph-warn' }, '✓')
      } else if (kind === 'manual-rejected') {
        title = T('已拒绝：','Rejected: ') + (notice.justification || notice.reason || '')
        tagText = rejectLabel(notice).replace('人工拒绝', T('已拒绝','Rejected'))
        glyph = React.createElement('span', { className: 'ag-notice-glyph-err' }, '✕')
      } else if (kind === 'escalate') {
        title = '需人工介入：连续拒绝 ' + (notice.consecutive || '?') + ' 次 / 累计 ' + (notice.total || '?') + ' 次'
        tagText = T('需人工介入','Needs human attention')
        glyph = React.createElement('span', { className: 'ag-notice-glyph-err' }, '⚠')
      } else {
        title = (notice.justification || notice.reason || '')
        const label = VERDICT_LABELS[notice.verdict] || notice.verdict || T('自动放行','Auto-approved')
        tagText = T('自动放行 · ','Auto-approved · ') + label
        glyph = React.createElement(GlyphCheck, null)
      }
      const cardCls = 'ag-notice-card' + (isPending ? ' ag-notice-card-pending' : isManual ? ' ag-notice-card-manual' : '')
      return React.createElement('div', { className: 'ag-notice' },
        React.createElement('div', { className: cardCls },
          React.createElement('span', { className: 'ag-notice-glyph' }, glyph),
          React.createElement('div', { className: 'ag-notice-body' },
            React.createElement('div', { className: 'ag-notice-head' },
              React.createElement('span', { className: 'ag-notice-tool' }, notice.tool || 'tool'),
              React.createElement('span', { className: 'ag-notice-text' }, title),
            ),
            React.createElement('div', { className: 'ag-notice-meta' },
              React.createElement('span', { className: isPending ? 'ag-tag-warn' : (kind === 'manual-rejected' || kind === 'escalate') ? 'ag-tag-err' : kind === 'manual-approved' ? 'ag-tag-warn' : 'ag-tag' + (VERDICT_NEUTRAL.has(notice.verdict) ? ' ag-tag-neutral' : '') }, tagText),
              React.createElement('span', { className: 'ag-time' }, fmtTime(notice.ts)),
            ),
          ),
          React.createElement('button', {
            type: 'button',
            className: 'ag-notice-close',
            title: T('关闭提示','Close'),
            'aria-label': T('关闭提示','Close'),
            onClick: function () { setNotice(null) },
          }, '✕'),
        ),
      )
    }

    // ================= diff 面板（审批记录文件改动查看 + 撤销） =================
    function fmtBytes(n) {
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(2) + ' MB'
    }

    function DiffPanel(props) {
      const sessionId = props.sessionId
      const eventId = props.eventId
      const path = props.path
      const onClose = props.onClose
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [revertMsg, setRevertMsg] = React.useState(null)
      const [reverting, setReverting] = React.useState(false)
      const [revertDone, setRevertDone] = React.useState(false)

      const panelRef = React.useRef(null)
      const onCloseRef = React.useRef(onClose)
      React.useEffect(function () { onCloseRef.current = onClose }, [onClose])
      React.useEffect(function () {
        const prevFocus = typeof document !== 'undefined' ? document.activeElement : null
        const panel = panelRef.current
        if (panel && panel.focus) panel.focus()
        const onKey = function (e) {
          if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); return }
          if (e.key !== 'Tab' || !panel) return
          const nodes = panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
          const list = Array.prototype.filter.call(nodes, function (n) { return !n.disabled && n.offsetParent !== null })
          if (list.length === 0) { e.preventDefault(); panel.focus(); return }
          if (!panel.contains(document.activeElement)) { e.preventDefault(); list[0].focus(); return }
          const first = list[0]
          const last = list[list.length - 1]
          if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
            e.preventDefault(); last.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault(); first.focus()
          }
        }
        window.addEventListener('keydown', onKey)
        return function () {
          window.removeEventListener('keydown', onKey)
          if (prevFocus && prevFocus.focus) { try { prevFocus.focus() } catch (e) {} }
        }
      }, [])

      React.useEffect(function () {
        setData(null)
        setError(null)
        setRevertDone(false)
        fetch('/api/auto-approve/diff?eventId=' + eventId + '&path=' + encodeURIComponent(path), { headers: { 'cache-control': 'no-cache' } })
          .then(function (r) { return r.json() })
          .then(function (res) {
            if (res && res.ok) setData(res)
            else setError((res && res.error) || '加载 diff 失败')
          })
          .catch(function (e) { setError('加载 diff 失败：' + String((e && e.message) || e)) })
      }, [eventId, path])

      const doRevert = function () {
        // 防重复：同一事件只允许投递一次撤销指令（v0.5.0 事故中同一 event 被重复撤销 4 次）
        if (reverting || revertDone) return
        setReverting(true)
        setRevertMsg(null)
        fetch('/api/auto-approve/revert', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId, eventId: eventId }),
        }).then(function (r) { return r.json() }).then(function (res) {
          if (res && res.ok) {
            setRevertMsg('撤销指令已发送到对话框，AI 将按指令恢复文件')
            setRevertDone(true)
          } else {
            setRevertMsg((res && res.error) || T('发送失败','Send failed'))
          }
        }).catch(function (e) {
          setRevertMsg('发送失败：' + String((e && e.message) || e))
        }).finally(function () {
          setReverting(false)
        })
      }

      const changedLines = data ? (data.changedLines || []) : []
      const hunks = data && Array.isArray(data.hunks) ? data.hunks : null
      const stats = data ? (data.stats || {}) : null

      return React.createElement('div', { className: 'ag-diff-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': '改动对比', onClick: function (e) { if (e.target === e.currentTarget) onClose() } },
        React.createElement('div', { className: 'ag-diff-panel', ref: panelRef, tabIndex: -1 },
          React.createElement('div', { className: 'ag-diff-head' },
            React.createElement('div', { className: 'ag-diff-title' },
              React.createElement('span', null, '文件改动对比'),
              React.createElement('button', { type: 'button', className: 'ag-notice-close', title: '关闭', 'aria-label': '关闭', onClick: onClose }, '✕'),
            ),
            React.createElement('div', { className: 'ag-diff-path' }, path),
            stats
              ? React.createElement('div', { className: 'ag-diff-stats' },
                  React.createElement('span', { className: 'ag-diff-stats-add' }, '+' + stats.added),
                  ' / ',
                  React.createElement('span', { className: 'ag-diff-stats-del' }, '-' + stats.removed),
                  ' 行变更 · ' + stats.contextLines + ' 行未变' + (data.afterExists === false ? '（文件当前已不存在）' : ''),
                )
              : null,
          ),
          React.createElement('div', { className: 'ag-diff-body' },
            error
              ? React.createElement('div', { className: 'ag-diff-empty' }, error)
              : !data
                ? React.createElement('div', { className: 'ag-diff-empty' }, T('加载中…','Loading…'))
                : hunks
                  ? hunks.map(function (h, hi) {
                      return React.createElement('div', { key: 'hunk' + hi },
                        h.hiddenBefore > 0
                          ? React.createElement('div', { className: 'ag-diff-hunk-sep' }, h.hiddenBefore + ' unmodified lines')
                          : null,
                        h.lines.map(function (c, i) {
                          const isAdd = c.type === 'add'
                          const isDel = c.type === 'del'
                          const cls = isAdd ? 'ag-diff-line-add' : (isDel ? 'ag-diff-line-del' : 'ag-diff-line-ctx')
                          const marker = isAdd ? '+' : (isDel ? '-' : ' ')
                          const aNo = c.aNo != null ? String(c.aNo) : ''
                          const bNo = c.bNo != null ? String(c.bNo) : ''
                          return React.createElement('div', { className: 'ag-diff-line ' + cls, key: 'hl' + i },
                            React.createElement('span', { className: 'ag-diff-marker' }, marker),
                            React.createElement('span', { className: 'ag-diff-line-no' }, aNo + (aNo && bNo ? ' ' : '') + bNo),
                            React.createElement('span', { className: 'ag-diff-text' }, c.text),
                          )
                        }),
                      )
                    })
                  : changedLines.length === 0
                    ? React.createElement('div', { className: 'ag-diff-empty' }, '该文件无内容变化（或文件不可读）')
                    : changedLines.map(function (c, i) {
                        return React.createElement('div', {
                          className: 'ag-diff-line ' + (c.type === 'add' ? 'ag-diff-line-add' : 'ag-diff-line-del'),
                          key: i,
                        },
                          React.createElement('span', { className: 'ag-diff-marker' }, c.type === 'add' ? '+' : '-'),
                          React.createElement('span', { className: 'ag-diff-line-no' }, String(c.line)),
                          React.createElement('span', { className: 'ag-diff-text' }, c.text),
                        )
                      }),
          ),
          React.createElement('div', { className: 'ag-diff-foot' },
            revertMsg
              ? React.createElement('span', { className: revertMsg.indexOf('已发送') >= 0 ? 'ag-set-ok' : 'ag-set-err' }, revertMsg)
              : null,
            React.createElement('button', {
              type: 'button', className: 'ag-set-btn ag-set-btn-primary',
              onClick: doRevert,
              disabled: reverting || revertDone,
            }, reverting ? '发送中…' : (revertDone ? '已发送撤销指令' : T('撤销此改动','Revert this change'))),
            React.createElement('button', { type: 'button', className: 'ag-set-btn', onClick: onClose }, '关闭'),
          ),
        ),
      )
    }

    // ================= 审批历史视图（conversation.view，order=20，轨迹右侧） =================
    function HistoryView(props) {
      const sessionId = (props && (props.sessionId || (props.slotsProps && props.slotsProps.sessionId))) || null
      const VIEW_PREF_KEY = 'ag-view-prefs-v1'
      const initialPrefs = React.useMemo(function () {
        try {
          if (typeof window === 'undefined') return {}
          return JSON.parse(window.localStorage.getItem(VIEW_PREF_KEY) || '{}') || {}
        } catch (e) { return {} }
      }, [])
      const allowedFilters = ['all', 'auto', 'approved', 'rejected', 'escalate', 'attention']
      const [events, setEvents] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [snapStats, setSnapStats] = React.useState(null) // {count, bytes} | null（当前会话）
      const [globalSnapStats, setGlobalSnapStats] = React.useState(null) // {count, bytes} | null（全部会话）
      const [projectStats, setProjectStats] = React.useState(null) // {projects,total,projectCount} | null
      const [counters, setCounters] = React.useState(null) // {consecutive, total, limits} | null
      const [kindFilter, setKindFilter] = React.useState(allowedFilters.indexOf(initialPrefs.kindFilter) >= 0 ? initialPrefs.kindFilter : 'all')
      const [viewTab, setViewTab] = React.useState(initialPrefs.viewTab === 'settings' ? 'settings' : 'records')
      const [dashOpen, setDashOpen] = React.useState(true) // 概览默认展开；折叠只影响当前页面
      const [query, setQuery] = React.useState(typeof initialPrefs.query === 'string' ? initialPrefs.query : '')
      const lastIdRef = React.useRef(0)
      const loadRef = React.useRef(null)
      const prevTabRef = React.useRef(viewTab)
      React.useEffect(function () {
        if (prevTabRef.current === viewTab) return
        prevTabRef.current = viewTab
        if (viewTab === 'records' && loadRef.current) {
          tabRef.current = 'records'
          loadRef.current()
        }
      }, [viewTab])
      React.useEffect(function () {
        if (typeof window === 'undefined') return
        const timer = setTimeout(function () {
          try {
            window.localStorage.setItem(VIEW_PREF_KEY, JSON.stringify({ kindFilter: kindFilter, viewTab: viewTab, query: query }))
          } catch (e) {}
        }, 200)
        return function () { clearTimeout(timer) }
      }, [kindFilter, viewTab, query])
      const [rulesSnap, setRulesSnap] = React.useState(null)
      const [snapIds, setSnapIds] = React.useState(null) // Set<eventId> | null（当前存在快照的事件）
      const [diffOpen, setDiffOpen] = React.useState(null) // {eventId, path} | null
      const [remembered, setRemembered] = React.useState({}) // eventId -> 'remembered' | 'forgotten' | 'busy' | 'error:…'
      const sessionRef = React.useRef(sessionId)
      const tabRef = React.useRef(viewTab)
      React.useEffect(function () { tabRef.current = viewTab }, [viewTab])

      const loadSnapStats = function (sid) {
        const q = sid ? ('?sessionId=' + encodeURIComponent(sid)) : ''
        fetch('/api/auto-approve/snapshots-stats' + q, { headers: { 'cache-control': 'no-cache' } })
          .then(function (r) { return r.json() })
          .then(function (res) {
            if (!res || !res.ok) return
            if (sid !== sessionRef.current) return
            const nextStats = { count: res.count || 0, bytes: res.bytes || 0 }
            setSnapStats(function (prev) {
              return prev && prev.count === nextStats.count && prev.bytes === nextStats.bytes ? prev : nextStats
            })
            const nextIds = new Set((res.ids || []).map(String))
            setSnapIds(function (prev) {
              if (!prev || prev.size !== nextIds.size) return nextIds
              for (const id of nextIds) { if (!prev.has(id)) return nextIds }
              return prev
            })
          })
          .catch(function () {})
        fetch('/api/auto-approve/snapshots-stats', { headers: { 'cache-control': 'no-cache' } })
          .then(function (r) { return r.json() })
          .then(function (res) {
            if (!res || !res.ok) return
            const nextGlobal = { count: res.count || 0, bytes: res.bytes || 0 }
            setGlobalSnapStats(function (prev) {
              return prev && prev.count === nextGlobal.count && prev.bytes === nextGlobal.bytes ? prev : nextGlobal
            })
          })
          .catch(function () {})
      }

      // 清除快照：mode='session' 仅本会话（默认），mode='all' 清全部（含其他会话，需二次确认）
      const loadRules = function () {
        fetch('/api/auto-approve/rules', { headers: { 'cache-control': 'no-cache' } })
          .then(function (r) { return r.json() })
          .then(function (res) {
            if (!res || !res.config) return
            setRulesSnap(function (prev) {
              try { if (prev && JSON.stringify(prev) === JSON.stringify(res)) return prev } catch (e) {}
              return res
            })
          })
          .catch(function () {})
      }

      const projectTrusted = function (path) {
        const roots = Array.isArray(rulesCfg.projectTrust) ? rulesCfg.projectTrust : []
        return roots.some(function (root) {
          const r = String(root || '').replace(/\/+$/, '')
          return r && (path === r || String(path).startsWith(r + '/'))
        })
      }
      const trustProject = function (path) {
        if (!path || projectTrusted(path)) return
        fetch('/api/auto-approve/rules', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op: 'add', kind: 'projectTrust', value: path }),
        }).then(function (r) { return r.json() }).then(function (res) {
          if (res && res.ok) loadRules()
        }).catch(function () {})
      }

      const loadProjectStats = function () {
        fetch('/api/auto-approve/project-stats', { headers: { 'cache-control': 'no-cache' } })
          .then(function (r) { return r.json() })
          .then(function (res) {
            if (!res || !res.ok) return
            const next = { projects: Array.isArray(res.projects) ? res.projects : [], total: res.total || 0, projectCount: res.projectCount || 0 }
            setProjectStats(function (prev) {
              try { if (prev && JSON.stringify(prev) === JSON.stringify(next)) return prev } catch (e) {}
              return next
            })
          })
          .catch(function () {})
      }

      const loadCounters = function (sid) {
        if (!sid) return
        fetch('/api/auto-approve/counters?sessionId=' + encodeURIComponent(sid), { headers: { 'cache-control': 'no-cache' } })
          .then(function (r) { return r.json() })
          .then(function (res) {
            if (!res || !res.ok) return
            if (sid !== sessionRef.current) return
            const nextCounters = { consecutive: res.consecutive, total: res.total, limits: res.limits }
            setCounters(function (prev) {
              try { if (prev && JSON.stringify(prev) === JSON.stringify(nextCounters)) return prev } catch (e) {}
              return nextCounters
            })
          })
          .catch(function () {})
      }

      const doClearSnapshots = function (mode) {
        const sid = mode === 'session' ? sessionId : ''
        if (mode === 'session' && !sid) return
        const msg = mode === 'all'
          ? '确定清除【全部会话】的 diff 快照？这可能删除其他会话还没看过的改动对比记录，且不可恢复。'
          : '确定清除【本会话】的 diff 快照？仅删除本会话审批产生的改动对比数据，不影响审批记录本身。'
        if (!window.confirm(msg)) return
        const body = {}
        if (sid) body.sessionId = sid
        fetch('/api/auto-approve/snapshots-clear', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).then(function (r) { return r.json() }).then(function (res) {
          if (res && res.ok) {
            if (mode === 'all') { setSnapStats({ count: 0, bytes: 0 }); setGlobalSnapStats({ count: 0, bytes: 0 }); setSnapIds(new Set()) }
            else loadSnapStats(sessionId)
          }
        }).catch(function () {})
      }

      const setOverride = function (id, value) {
        setRemembered(function (m) { const n = Object.assign({}, m); if (value === undefined) delete n[id]; else n[id] = value; return n })
      }
      const doRemember = function (ev) {
        if (remembered[ev.id] === 'busy') return
        setOverride(ev.id, 'busy')
        fetch('/api/auto-approve/remember', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ eventId: ev.id, tool: ev.tool, mode: ev.mode, justification: ev.justification || ev.reason || '' }),
        }).then(function (r) { return r.json() }).then(function (res) {
          if (res && res.ok) setOverride(ev.id, 'remembered')
          else setOverride(ev.id, 'error:' + ((res && res.error) || T('未知错误','Unknown error')))
        }).catch(function (e) { setOverride(ev.id, 'error:' + String((e && e.message) || e)) })
      }
      const doForget = function (ev) {
        if (remembered[ev.id] === 'busy') return
        setOverride(ev.id, 'busy')
        fetch('/api/auto-approve/forget', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ eventId: ev.id, tool: ev.tool, mode: ev.mode, justification: ev.justification || ev.reason || '' }),
        }).then(function (r) { return r.json() }).then(function (res) {
          if (res && res.ok) setOverride(ev.id, 'forgotten')
          else setOverride(ev.id, 'error:' + ((res && res.error) || T('未知错误','Unknown error')))
        }).catch(function (e) { setOverride(ev.id, 'error:' + String((e && e.message) || e)) })
      }

      React.useEffect(function () {
        sessionRef.current = sessionId
        setEvents(null)
        setError(null)
        setSnapStats(null)
        setGlobalSnapStats(null)
        setSnapIds(null)
        setCounters(null)
        setRulesSnap(null)
        setProjectStats(null)
        setDiffOpen(null)
        setRemembered({})
        lastIdRef.current = 0
        if (!sessionId) { setEvents([]); loadSnapStats(null); loadProjectStats(); return }
        let alive = true
        let tick = 0
        const load = function (force) {
          if (!force && tabRef.current !== 'records') return
          if (!force && typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          const full = (tick % 12) === 0 // 首次全量；之后增量，每分钟兜底全量
          tick += 1
          const since = full ? 0 : lastIdRef.current
          fetchEvents(sessionId, since).then(function (evs) {
            if (!alive) return
            const maxId = evs.reduce(function (m, ev) { return Math.max(m, Number(ev.id) || 0) }, 0)
            if (full) {
              evs.sort(function (a, b) { return b.id - a.id }) // 时间倒序：最新在最上面
              lastIdRef.current = maxId
              setEvents(evs)
            } else if (evs.length > 0) {
              lastIdRef.current = Math.max(lastIdRef.current, maxId)
              setEvents(function (prev) {
                const map = new Map()
                ;(prev || []).forEach(function (ev) { map.set(ev.id, ev) })
                evs.forEach(function (ev) { map.set(ev.id, ev) })
                return Array.from(map.values()).sort(function (a, b) { return b.id - a.id })
              })
            }
            setError(null)
          }).catch(function (e) {
            if (!alive) return
            setError(String((e && e.message) || e))
          })
          loadSnapStats(sessionId)
          loadCounters(sessionId)
          loadRules()
          if (full) loadProjectStats()
        }
        loadRef.current = load
        load(true)
        const timer = setInterval(function () { load(false) }, 5000)
        return function () {
          alive = false
          clearInterval(timer)
          if (loadRef.current === load) loadRef.current = null
        }
      }, [sessionId])

      const kindKey = function (ev) {
        const k = ev.kind || 'auto'
        if (k === 'manual-approved') return 'approved'
        if (k === 'manual-rejected') return 'rejected'
        if (k === 'escalate') return 'escalate'
        if (k === 'shadow-candidate') return 'shadow'
        return 'auto'
      }
      const rows = (events || []).filter(function (ev) { return (ev.kind || 'auto') !== 'manual-pending' })
      const counts = { auto: 0, approved: 0, rejected: 0, escalate: 0, shadow: 0 }
      rows.forEach(function (ev) { counts[kindKey(ev)] = (counts[kindKey(ev)] || 0) + 1 })
      const total = rows.length
      const pct = function (n) { return total ? Math.round(n * 100 / total) : 0 }
      const rulesCfg = (rulesSnap && rulesSnap.config) || {}
      const allowRules = rulesCfg.allowRules || []
      const trustRoots = rulesCfg.trustRoots || []
      const ruleStats = {
        total: allowRules.length,
        self: allowRules.filter(function (r) { return r && r.source === 'self-learned' }).length,
        graduated: allowRules.filter(function (r) { return r && r.graduation }).length,
        trust: trustRoots.length,
      }
      const q = String(query || '').trim().toLowerCase()
      const filtered = rows.filter(function (ev) {
        if (kindFilter === 'attention') return kindKey(ev) === 'rejected' || kindKey(ev) === 'escalate'
        if (kindFilter !== 'all' && kindKey(ev) !== kindFilter) return false
        if (q === '') return true
        return [ev.tool, ev.justification, ev.reason, ev.args, ev.verdict].join(' ').toLowerCase().indexOf(q) >= 0
      })
      const dayKey = function (ts) {
        const d = new Date(ts)
        if (isNaN(d.getTime())) return ''
        const p = function (n) { return (n < 10 ? '0' : '') + n }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      }
      const groups = []
      const groupMap = {}
      filtered.forEach(function (ev) {
        const day = dayKey(ev.ts) || '未知日期'
        if (!groupMap[day]) { groupMap[day] = { day: day, items: [] }; groups.push(groupMap[day]) }
        groupMap[day].items.push(ev)
      })
      const now = new Date()
      const trend = []
      for (let i = 6; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
        const p = function (n) { return (n < 10 ? '0' : '') + n }
        trend.push({ key: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), label: (d.getMonth() + 1) + '/' + d.getDate(), count: 0 })
      }
      const trendMap = {}
      trend.forEach(function (t) { trendMap[t.key] = t })
      rows.forEach(function (ev) { const k = dayKey(ev.ts); if (trendMap[k]) trendMap[k].count += 1 })
      const trendMax = Math.max.apply(null, trend.map(function (t) { return t.count }).concat([1]))
      const toolCounts = {}
      rows.forEach(function (ev) { const t = ev.tool || 'tool'; toolCounts[t] = (toolCounts[t] || 0) + 1 })
      const topTools = Object.keys(toolCounts).map(function (t) { return { tool: t, count: toolCounts[t] } }).sort(function (a, b) { return b.count - a.count }).slice(0, 5)
      const topMax = topTools.length ? topTools[0].count : 1
      const chips = [
        ['all', T('全部','All'), total],
        ['auto', T('自动放行','Auto-approved'), counts.auto],
        ['shadow', T('Shadow 候选','Shadow candidates'), counts.shadow],
        ['approved', T('人工通过','Approved by you'), counts.approved],
        ['rejected', T('已拒绝','Rejected'), counts.rejected],
        ['escalate', T('需人工介入','Needs human attention'), counts.escalate],
        ['attention', T('需关注','Needs attention'), counts.rejected + counts.escalate],
      ]
      const scrollToSection = function (id) {
        const el = document.getElementById(id)
        if (el && el.classList.contains('ag-set-collapsed')) {
          const head = el.firstElementChild
          if (head && head.click) head.click()
        }
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      const stat = function (label, value, sub) {
        return React.createElement('div', { className: 'ag-stat', key: label },
          React.createElement('span', { className: 'ag-stat-label' }, label),
          React.createElement('span', { className: 'ag-stat-value' }, String(value)),
          React.createElement('span', { className: 'ag-stat-sub' }, sub || ''),
        )
      }
      const substat = function (label, value) {
        return React.createElement('div', { className: 'ag-substat', key: label },
          React.createElement('span', { className: 'ag-substat-label' }, label),
          React.createElement('span', { className: 'ag-substat-value' }, String(value)),
        )
      }
      const distSeg = function (n, color) {
        const p = pct(n)
        if (p <= 0) return null
        return React.createElement('span', { key: color, className: 'ag-dist-seg', style: { width: p + '%', background: color } })
      }
      const renderRow = function (ev) {
        const kind = ev.kind || 'auto'
        const files = Array.isArray(ev.files) ? ev.files : []
        const hasSnap = snapIds !== null && snapIds.has(String(ev.id))
        let tagText = ''
        let tagCls = 'ag-tag'
        let glyph = React.createElement(GlyphCheck, null)
        let glyphCls = 'ag-row-glyph'
        if (kind === 'manual-approved') {
          const lc = ev.learningCount !== undefined ? ev.learningCount : null
          const th = ev.threshold || 3
          tagText = lc !== null ? ('人工通过 · 学习 ' + lc + '/' + th) : T('人工通过','Approved by you')
          tagCls = 'ag-tag-warn'
          glyphCls = 'ag-row-glyph-warn'
          glyph = React.createElement('span', null, '✓')
        } else if (kind === 'manual-rejected') {
          tagText = rejectLabel(ev)
          tagCls = 'ag-tag-err'
          glyphCls = 'ag-row-glyph-err'
          glyph = React.createElement('span', null, '✕')
        } else if (kind === 'escalate') {
          tagText = '需人工介入 · 连续拒绝 ' + (ev.consecutive || '?') + ' 次 / 累计 ' + (ev.total || '?') + ' 次'
          tagCls = 'ag-tag-err'
          glyphCls = 'ag-row-glyph-err'
          glyph = React.createElement('span', null, '⚠')
        } else if (kind === 'shadow-candidate') {
          const wp = ev.wouldPath || ev.path || ''
          tagText = 'Shadow 候选 · 本可自动放行' + (SHADOW_PATH_LABELS[wp] ? ' · ' + SHADOW_PATH_LABELS[wp] : '')
          tagCls = 'ag-tag-neutral'
          glyph = React.createElement('span', null, '◌')
        } else {
          tagText = T('自动放行 · ','Auto-approved · ') + (VERDICT_LABELS[ev.verdict] || ev.verdict || 'auto')
          tagCls = 'ag-tag' + (VERDICT_NEUTRAL.has(ev.verdict) ? ' ag-tag-neutral' : '')
        }
        const ov = remembered[ev.id]
        const busy = ov === 'busy'
        const errored = typeof ov === 'string' && ov.indexOf('error:') === 0
        const isRemembered = ov === 'remembered' ? true : (ov === 'forgotten' ? false : ev.remembered === true)
        return React.createElement('div', { className: 'ag-row', key: ev.id + '@' + (ev.ts || '') },
          React.createElement('div', { className: 'ag-row-rail' },
            React.createElement('span', { className: glyphCls }, glyph),
            React.createElement('span', { className: 'ag-row-line' }),
          ),
          React.createElement('div', { className: 'ag-row-body' },
            React.createElement('div', { className: 'ag-row-top' },
              React.createElement('span', { className: 'ag-row-tool' }, ev.tool || 'tool'),
              React.createElement('span', { className: tagCls }, tagText),
              React.createElement('span', { className: 'ag-time' }, fmtTime(ev.ts)),
            ),
            React.createElement('div', { className: 'ag-row-reason' }, ev.justification || ev.reason || '(无说明)'),
            ev.commandPattern
              ? React.createElement('div', { className: 'ag-args', title: ev.commandPattern }, T('命令：','Command: ') + ev.commandPattern)
              : null,
            ev.args
              ? React.createElement('div', { className: 'ag-args', title: ev.args }, T('参数：','Args: ') + String(ev.args).slice(0, 240))
              : null,
            ev.cwd
              ? React.createElement('div', { className: 'ag-row-meta', title: ev.cwd }, T('目录：','Cwd: ') + String(ev.cwd).slice(0, 180))
              : null,
            React.createElement('div', { className: 'ag-row-actions' },
              kind !== 'manual-rejected' && kind !== 'escalate' && kind !== 'shadow-candidate' && ev.mode
                ? React.createElement('button', {
                    type: 'button', className: 'ag-remember-btn' + (isRemembered ? ' ag-remember-btn-on' : '') + (errored ? ' ag-remember-btn-error' : ''),
                    disabled: busy,
                    onClick: function () { if (isRemembered) doForget(ev); else doRemember(ev) },
                    title: errored ? ('记住失败：' + ov.slice(6)) : (isRemembered ? '取消记住：删除该操作的白名单规则' : '把这次操作沉淀为白名单规则'),
                  }, busy ? '处理中…' : (errored ? '重试' : (isRemembered ? T('取消记住','Cancel remember') : T('记住这次操作','Remember this operation'))))
                : null,
            ),
            files.length > 0
              ? React.createElement('div', { className: 'ag-row-files' }, files.map(function (f, i) {
                  const chipProps = { key: i, className: 'ag-file-chip' }
                  if (hasSnap) {
                    chipProps.className += ' ag-file-chip-snap'
                    chipProps.title = T('查看该文件改动对比','View file diff')
                    chipProps.role = 'button'
                    chipProps.tabIndex = 0
                    chipProps.onClick = function () { setDiffOpen({ eventId: ev.id, path: f }) }
                    chipProps.onKeyDown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDiffOpen({ eventId: ev.id, path: f }) } }
                  }
                  return React.createElement('span', chipProps, String(f).split('/').pop())
                }))
              : null,
            hasSnap
              ? React.createElement('div', { className: 'ag-row-meta' }, '已保留改动快照 · 可在下方 diff 中撤销')
              : null,
          ),
        )
      }
      const dismissOnboarding = function () {
        fetch('/api/auto-approve/rules', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op: 'set', kind: 'onboarded', value: true }),
        }).then(function (r) { return r.json() }).then(function (res) {
          if (!res || !res.ok) return
          setRulesSnap(function (prev) {
            if (!prev || !prev.config) return prev
            return Object.assign({}, prev, { config: Object.assign({}, prev.config, { onboarded: true }) })
          })
        }).catch(function () {})
      }
      return React.createElement('div', { className: 'ag-view' },
        React.createElement('div', { className: 'ag-view-head' },
          React.createElement('div', { className: 'ag-view-hero' },
            React.createElement('div', { className: 'ag-view-mark', 'aria-hidden': 'true' },
              React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none' },
                React.createElement('path', { d: 'M12 3.2 19 6v5.2c0 4.4-3 7.6-7 9.3-4-1.7-7-4.9-7-9.3V6l7-2.8Z', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' }),
                React.createElement('path', { d: 'm9.1 12.1 2 2 3.9-4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
              ),
            ),
            React.createElement('div', { className: 'ag-view-heading' },
              React.createElement('div', { className: 'ag-view-title' }, T('自动放行审批','Approval audit')),
              React.createElement('div', { className: 'ag-view-sub' }, T('本会话审批记录、学习规则与快照（最新在上）','Session approvals, learned rules, and snapshots (newest first)')),
            ),
            React.createElement('div', { className: 'ag-view-badges' },
              React.createElement('span', { className: 'ag-view-pill' },
                React.createElement('span', { className: 'ag-view-pill-dot' }),
                T('本地运行','Local'),
              ),
              React.createElement('span', { className: 'ag-view-pill' }, T('可追溯','Auditable')),
            ),
          ),
        ),
        rulesSnap && rulesCfg.onboarded !== true
          ? React.createElement('div', { className: 'ag-onboard' },
              React.createElement('div', { className: 'ag-onboard-body' },
                React.createElement('div', { className: 'ag-onboard-title' },
                  rulesCfg.selfLearn !== false
                    ? T('自学习已开启（推荐）','Self-learning is on (recommended)')
                    : T('自学习当前关闭','Self-learning is currently off')),
                React.createElement('div', { className: 'ag-onboard-text' },
                  rulesCfg.selfLearn !== false
                    ? T('你批准过的同类操作会先在当前会话复用，再跨会话沉淀为全局规则；Flash 累计 SAFE 判定也会自动学习。删除、凭据、远程/生产等危险类别仍然转人工。','Approved repeats are reused in this session and promoted across sessions; repeated Flash SAFE verdicts also learn automatically. Dangerous categories still ask you.')
                    : T('你仍然可以开启自学习，让 Flash 累计 SAFE 的操作自动沉淀；跨会话晋升和签名毕业不受影响。','You can enable self-learning so repeated Flash SAFE operations are learned; cross-session promotion and graduation still work.')),
              ),
              React.createElement('div', { className: 'ag-onboard-actions' },
                React.createElement('button', {
                  type: 'button', className: 'ag-set-btn ag-btn-xs',
                  onClick: function () { setViewTab('settings') },
                }, T('去设置','Settings')),
                React.createElement('button', {
                  type: 'button', className: 'ag-set-btn ag-btn-xs ag-set-btn-primary',
                  onClick: dismissOnboarding,
                }, T('知道了','Got it')),
              ),
            )
          : null,
        React.createElement('div', { className: 'ag-tabbar', role: 'tablist', 'aria-label': T('审批视图','Approval audit') },
          [['records', T('记录','Records')], ['settings', T('设置','Settings')]].map(function (t) {
            return React.createElement('button', {
              key: t[0], type: 'button',
              className: 'ag-tab' + (viewTab === t[0] ? ' ag-tab-active' : ''),
              role: 'tab',
              'aria-selected': viewTab === t[0],
              onClick: function () { setViewTab(t[0]) },
            }, t[1], t[0] === 'records' ? React.createElement('span', { className: 'ag-tab-count' }, String(total)) : null)
          }),
        ),
        React.createElement('div', { className: 'ag-records', style: { display: viewTab === 'settings' ? 'none' : 'flex' } },
        React.createElement('div', { className: 'ag-dash-head' },
          React.createElement('div', { className: 'ag-dash-heading' },
            React.createElement('span', { className: 'ag-dash-title' }, T('概览','Overview')),
            React.createElement('span', { className: 'ag-dash-hint' }, T('全部 ','All ') + total + T(' 条 · 最近 7 天趋势',' records · 7-day trend')),
          ),
          React.createElement('span', { style: { flex: '1 1 auto' } }),
          React.createElement('button', {
            type: 'button', className: 'ag-set-btn ag-btn-xs',
            onClick: function () { setDashOpen(!dashOpen) },
          }, dashOpen ? T('收起','Collapse') : T('展开','Expand')),
        ),
        React.createElement('div', { className: 'ag-dash', style: { display: dashOpen ? 'flex' : 'none' } },
          React.createElement('div', { className: 'ag-stat-grid ag-stat-grid-primary' },
            stat(T('自动放行','Auto-approved'), counts.auto, pct(counts.auto) + '% · Flash / 规则'),
            stat(T('Shadow 候选','Shadow candidates'), counts.shadow, pct(counts.shadow) + '% · 仅观察'),
            stat(T('人工通过','Approved by you'), counts.approved, pct(counts.approved) + '%'),
            stat(T('已拒绝','Rejected'), counts.rejected, pct(counts.rejected) + '%'),
            stat(T('需人工介入','Needs human attention'), counts.escalate, pct(counts.escalate) + '%'),
          ),
          React.createElement('div', { className: 'ag-panel ag-dist' },
            React.createElement('div', { className: 'ag-panel-title' }, T('放行构成','Decision mix')),
            React.createElement('div', { className: 'ag-dist-bar' },
              distSeg(counts.auto, 'var(--dsw-alias-state-success-primary)'),
              distSeg(counts.shadow, 'var(--dsw-alias-state-business-primary)'),
              distSeg(counts.approved, 'var(--dsw-alias-state-warn-primary)'),
              distSeg(counts.rejected, 'var(--dsw-alias-state-error-primary)'),
              distSeg(counts.escalate, 'var(--dsw-alias-state-error-label)'),
            ),
            React.createElement('div', { className: 'ag-dist-legend' },
              React.createElement('span', null, '自动 ' + counts.auto),
              React.createElement('span', null, 'Shadow ' + counts.shadow),
              React.createElement('span', null, '人工 ' + counts.approved),
              React.createElement('span', null, '拒绝 ' + counts.rejected),
              React.createElement('span', null, '升级 ' + counts.escalate),
            ),
          ),
          React.createElement('div', { className: 'ag-substat-grid' },
            substat(T('规则总数','Rules'), ruleStats.total),
            substat(T('自学习','Self-learned'), ruleStats.self),
            substat(T('已毕业','Graduated'), ruleStats.graduated),
            substat(T('信任目录','Trusted dirs'), ruleStats.trust),
          ),
          React.createElement('div', { className: 'ag-dash-cols' },
            React.createElement('div', { className: 'ag-panel' },
              React.createElement('div', { className: 'ag-panel-title' }, T('最近 7 天审批趋势','7-day approval trend')),
              React.createElement('div', { className: 'ag-trend' },
                trend.map(function (t) {
                  return React.createElement('div', { className: 'ag-trend-col', key: t.key },
                    React.createElement('span', { className: 'ag-trend-value' }, t.count ? String(t.count) : ''),
                    React.createElement('span', { className: 'ag-trend-bar', style: { height: Math.max(2, Math.round(t.count / trendMax * 64)) + 'px' } }),
                    React.createElement('span', { className: 'ag-trend-label' }, t.label),
                  )
                }),
              ),
            ),
            React.createElement('div', { className: 'ag-panel' },
              React.createElement('div', { className: 'ag-panel-title' }, T('Top 工具','Top tools')),
              topTools.length === 0
                ? React.createElement('div', { className: 'ag-set-empty' }, T('暂无数据','No data'))
                : React.createElement('div', { className: 'ag-top' },
                    topTools.map(function (t) {
                      return React.createElement('div', { className: 'ag-top-row', key: t.tool },
                        React.createElement('span', { className: 'ag-top-name' }, t.tool),
                        React.createElement('span', { className: 'ag-top-bar', style: { width: Math.max(4, Math.round(t.count / topMax * 100)) + '%' } }),
                        React.createElement('span', { className: 'ag-top-count' }, String(t.count)),
                      )
                    }),
                  ),
            ),
          ),
          projectStats
            ? React.createElement('div', { className: 'ag-panel ag-project-panel' },
                React.createElement('div', { className: 'ag-panel-title' }, T('按项目 / 目录（全部会话）','By project / directory (all sessions)')),
                projectStats.projects.length === 0
                  ? React.createElement('div', { className: 'ag-set-empty' }, '暂无带目录的审批记录')
                  : React.createElement('div', { className: 'ag-project-list' },
                      projectStats.projects.slice(0, 8).map(function (p) {
                        return React.createElement('div', { className: 'ag-project-row', key: p.path || 'unknown', title: p.path || '历史事件没有 cwd' },
                          React.createElement('span', { className: 'ag-project-name' }, p.name),
                          React.createElement('span', { className: 'ag-project-path' }, p.path || '—'),
                          React.createElement('span', { className: 'ag-project-bar' },
                            React.createElement('span', { className: 'ag-project-fill', style: { width: Math.max(2, p.autoRate) + '%' } }),
                          ),
                          React.createElement('span', { className: 'ag-project-meta' },
                            p.total + ' 条 · 自动 ' + p.auto + ' · 拒绝 ' + p.rejected + (p.shadow ? ' · Shadow ' + p.shadow : '')),
                          React.createElement('span', { className: 'ag-project-trust' },
                            p.path
                              ? (projectTrusted(p.path)
                                  ? React.createElement('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-tertiary)' } }, T('已信任','Trusted'))
                                  : (p.approved > 0
                                      ? React.createElement('button', {
                                          type: 'button', className: 'ag-set-btn ag-btn-xs', title: T('以后项目内 edit/write 与已识别测试自动放行','Auto-approve edit/write and recognized tests in this project'),
                                          onClick: function () { trustProject(p.path) },
                                        }, T('信任','Trust'))
                                      : null))
                              : null,
                          ),
                        )
                      }),
                    ),
                React.createElement('div', { className: 'ag-project-foot' },
                  '共 ' + projectStats.projectCount + ' 个项目 · ' + projectStats.total + ' 条已落地记录；历史无 cwd 归入“未知目录”，不做回溯推断。'),
              )
            : null,
        ),
        (counts.rejected + counts.escalate) > 0
          ? React.createElement('div', { className: 'ag-attention' },
              React.createElement('span', { className: 'ag-attention-text' },
                T('需要关注：','Attention: ') + (counts.rejected + counts.escalate) + ' 条（拒绝 ' + counts.rejected + ' · 升级 ' + counts.escalate + '）'),
              React.createElement('button', {
                type: 'button', className: 'ag-chip',
                onClick: function () { setKindFilter('attention') },
              }, '只看这些'),
            )
          : null,
        React.createElement('div', { className: 'ag-toolbar2' },
          chips.map(function (c) {
            return React.createElement('button', {
              key: c[0], type: 'button',
              className: 'ag-chip' + (kindFilter === c[0] ? ' ag-chip-active' : ''),
              'aria-pressed': kindFilter === c[0],
              onClick: function () { setKindFilter(c[0]) },
            }, c[1] + ' ' + c[2])
          }),
          (kindFilter !== 'all' || query)
            ? React.createElement('button', {
                type: 'button', className: 'ag-chip',
                onClick: function () { setKindFilter('all'); setQuery('') },
              }, '清除筛选 ×')
            : null,
          React.createElement('span', { style: { flex: '1 1 auto' } }),
          React.createElement('input', {
            className: 'ag-set-input ag-search', placeholder: T('搜索工具 / 理由 / 参数','Search tool / reason / args'),
            'aria-label': T('搜索审批记录','Search approvals'),
            value: query, onChange: function (e) { setQuery(e.target.value) },
          }),
        ),
        React.createElement('div', { className: 'ag-snap-bar' },
          React.createElement('span', null,
            'diff 快照 ',
            React.createElement('b', null, snapStats ? (fmtBytes(snapStats.bytes) + ' · ' + snapStats.count + ' 条') : '…'),
            globalSnapStats && globalSnapStats.count !== (snapStats ? snapStats.count : -1)
              ? React.createElement('span', { style: { marginLeft: 6, opacity: 0.75 } },
                  '（全部会话 ' + fmtBytes(globalSnapStats.bytes) + ' · ' + globalSnapStats.count + ' 条）')
              : null,
          ),
          counters
            ? React.createElement('span', { style: { marginLeft: 8 } },
                '拒绝计数：连续 ' + counters.consecutive + ' / 累计 ' + counters.total + '（上限 ' + counters.limits.consecutive + ' / ' + counters.limits.total + '）',
                React.createElement('button', {
                  type: 'button', className: 'ag-set-btn ag-btn-xs', style: { marginLeft: 6 },
                  onClick: function () {
                    fetch('/api/auto-approve/counters-reset', {
                      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sessionId }),
                    }).then(function () { loadCounters(sessionId) }).catch(function () {})
                  },
                }, '重置'),
              )
            : null,
          React.createElement('span', { className: 'ag-snap-bar-spacer' }),
          React.createElement('button', {
            type: 'button', className: 'ag-set-btn ag-btn-xs',
            onClick: function () { doClearSnapshots('session') },
            disabled: !sessionId || !snapStats || snapStats.count === 0,
            title: '仅清除本会话的 diff 快照（不影响其他会话）',
          }, '仅清本会话'),
          React.createElement('button', {
            type: 'button', className: 'ag-set-btn ag-btn-xs',
            onClick: function () { doClearSnapshots('all') },
            disabled: !globalSnapStats || globalSnapStats.count === 0,
            title: '清空全部会话（含其他会话未查看过的）diff 快照，需二次确认',
          }, '清空全部'),
        ),
        events === null
          ? React.createElement('div', { className: 'ag-loading' }, T('加载中…','Loading…'))
          : filtered.length === 0
            ? React.createElement('div', { className: 'ag-empty' }, error ? (T('加载失败：','Load failed: ') + error) : (rows.length === 0 ? T('本会话暂无审批记录','No approvals in this session yet') : T('没有匹配的记录','No matching records')))
            : React.createElement('div', { className: 'ag-list' },
                groups.map(function (g) {
                  return React.createElement('div', { className: 'ag-group', key: g.day },
                    React.createElement('div', { className: 'ag-group-label' }, g.day + ' · ' + g.items.length + ' 条'),
                    g.items.map(renderRow),
                  )
                }),
              ),
        ),
        viewTab === 'settings'
          ? React.createElement('div', { className: 'ag-settings-embed' },
              React.createElement('div', { className: 'ag-settings-nav' },
                React.createElement('div', { className: 'ag-settings-title' }, T('自动审批设置','Auto-approval settings')),
                React.createElement('div', { className: 'ag-settings-chips' },
                  [['setup', '初始化'], ['pipeline', '判定管道'], ['deny', '① DENY'], ['allow', '② 白名单'], ['denyrules', '③ 永久人工'], ['flash', '④ Flash'], ['shadow', 'Shadow'], ['learning', '⑤ 学习与沉淀'], ['library', '⑥ 规则库']].map(function (item) {
                    return React.createElement('button', {
                      type: 'button', key: item[0], className: 'ag-settings-chip',
                      onClick: function () { scrollToSection('ag-tabsec-' + item[0]) },
                    }, item[1])
                  }),
                ),
              ),
              React.createElement(RulesSettings, { idPrefix: 'ag-tabsec-' }),
            )
          : null,
        diffOpen
          ? React.createElement(DiffPanel, {
              key: diffOpen.eventId + '|' + diffOpen.path,
              sessionId: sessionId,
              eventId: diffOpen.eventId,
              path: diffOpen.path,
              onClose: function () { setDiffOpen(null) },
            })
          : null,
      )
    }

    // ================= 审批页设置 tab：自动审批规则管理 =================
    const RULE_SOURCE_TAGS = {
      default: React.createElement('span', { className: 'ag-set-tag ag-set-tag-blue' }, '预置'),
      learned: React.createElement('span', { className: 'ag-set-tag ag-set-tag-green' }, '学习沉淀'),
      user: React.createElement('span', { className: 'ag-set-tag ag-set-tag-gray' }, '用户'),
      remember: React.createElement('span', { className: 'ag-set-tag ag-set-tag-blue' }, '记住'),
      graduated: React.createElement('span', { className: 'ag-set-tag ag-set-tag-green' }, '毕业'),
    }
    function ruleSource(rule) {
      if (rule && rule.source) return rule.source
      const d = String(rule && rule.description || '')
      if (d.indexOf('自动沉淀') === 0 || d.indexOf('人工确认后') >= 0 || d.indexOf('flash 同类') >= 0 || d.indexOf('自动毕业') === 0) return 'learned'
      if (d === '用户自定义' || d.indexOf('用户记住') === 0) return 'user'
      return 'default'
    }

    function RulesSettings(props) {
      const idPrefix = (props && props.idPrefix) || 'ag-sec-'
      const [snapshot, setSnapshot] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [feedback, setFeedback] = React.useState(null)
      const [newKeyword, setNewKeyword] = React.useState('')
      const [ruleFilter, setRuleFilter] = React.useState('all')
      const [libTab, setLibTab] = React.useState('allow')
      const [libQuery, setLibQuery] = React.useState('')
      const [newRule, setNewRule] = React.useState({ tool: '', mode: '', category: '', contains: '' })
      const [threshold, setThreshold] = React.useState('3')
      const [timeoutMs, setTimeoutMs] = React.useState('20000')
      const [newTrustRoot, setNewTrustRoot] = React.useState('')
      const [newLibTrustRoot, setNewLibTrustRoot] = React.useState('')
      const [newLibProjectRoot, setNewLibProjectRoot] = React.useState('')
      const [editingRule, setEditingRule] = React.useState(null)
      const [editError, setEditError] = React.useState('')
      const [stage1Provider, setStage1Provider] = React.useState('')
      const [stage1Model, setStage1Model] = React.useState('')
      const [selfLearnThreshold, setSelfLearnThreshold] = React.useState('3')
      const [selfLearnSessions, setSelfLearnSessions] = React.useState('1')
      const [promotionSessions, setPromotionSessions] = React.useState('2')
      const [graduationThreshold, setGraduationThreshold] = React.useState('3')
      const [graduationSessions, setGraduationSessions] = React.useState('2')
      const [shadowSuggestions, setShadowSuggestions] = React.useState({ groups: [], total: 0 })

      const [collapsedCards, setCollapsedCards] = React.useState({ setup: true, pipeline: true, deny: true, allow: true, denyrules: true, flash: true, shadow: true, learning: true, library: true })

      const toggleSettingCard = function (e) {
        const target = e.target
        const head = target && target.closest ? target.closest('.ag-set-card-head') : null
        if (!head) return
        if (target.closest && target.closest('button,a,input,select,textarea')) return
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return
        if (e.type === 'keydown') e.preventDefault()
        const card = head.parentElement
        const key = card && card.id && card.id.indexOf(idPrefix) === 0 ? card.id.slice(idPrefix.length) : ''
        if (!key) return
        setCollapsedCards(function (prev) {
          const next = Object.assign({}, prev)
          next[key] = !next[key]
          return next
        })
      }

      const loadShadowSuggestions = function () {
        fetch('/api/auto-approve/shadow-suggestions', { headers: { 'cache-control': 'no-cache' } })
          .then(function (r) { return r.json() })
          .then(function (data) { if (data && data.ok) setShadowSuggestions({ groups: data.groups || [], total: data.total || 0 }) })
          .catch(function () { /* 建议是可选的，失败不阻塞设置 */ })
      }

      const load = function () {
        fetch('/api/auto-approve/rules', { headers: { 'cache-control': 'no-cache' } })
          .then(function (r) { return r.json() })
          .then(function (data) {
            if (data && data.config) {
              setSnapshot(data)
              setThreshold(String(data.config.riskyThreshold))
              setTimeoutMs(String(data.config.judgeTimeoutMs))
              if (data.config.promotionSessions) setPromotionSessions(String(data.config.promotionSessions))
              if (data.config.graduationThreshold) setGraduationThreshold(String(data.config.graduationThreshold))
              if (data.config.graduationSessions) setGraduationSessions(String(data.config.graduationSessions))
              setStage1Provider(String(data.config.stage1Provider || ''))
              setStage1Model(String(data.config.stage1Model || ''))
              if (data.config.selfLearnThreshold) setSelfLearnThreshold(String(data.config.selfLearnThreshold))
              if (data.config.selfLearnSessions) setSelfLearnSessions(String(data.config.selfLearnSessions))
              setError(null)
            } else {
              setError('加载规则失败：' + JSON.stringify(data).slice(0, 200))
            }
          })
          .catch(function (e) { setError('加载规则失败：' + String((e && e.message) || e)) })
      }
      React.useEffect(function () { load(); loadShadowSuggestions() }, [])

      const showFeedback = function (msg, ok) {
        setFeedback({ msg: String(msg), ok: ok !== false })
        setTimeout(function () { setFeedback(null) }, 4000)
      }

      const api = function (body) {
        setBusy(true)
        return fetch('/api/auto-approve/rules', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).then(function (r) { return r.json() }).then(function (res) {
          if (res && res.ok) { load(); loadShadowSuggestions(); showFeedback('已生效（热更新，无需重启）'); return res }
          showFeedback((res && res.error) || T('操作失败','Operation failed'), false)
          return res
        }).catch(function (e) {
          showFeedback(T('请求失败：','Request failed: ') + String((e && e.message) || e), false)
        }).finally(function () { setBusy(false) })
      }

      const copyText = function (text) {
        try { navigator.clipboard.writeText(String(text)); showFeedback('已复制：' + text) } catch (e) { showFeedback('复制失败：' + String((e && e.message) || e), false) }
      }
      const exportRules = function () {
        try {
          const data = {
            exportedAt: new Date().toISOString(),
            allowRules: (snapshot && snapshot.config && snapshot.config.allowRules) || [],
            denyRules: (snapshot && snapshot.config && snapshot.config.denyRules) || [],
            trustRoots: (snapshot && snapshot.config && snapshot.config.trustRoots) || [],
            projectTrust: (snapshot && snapshot.config && snapshot.config.projectTrust) || [],
            graduation: (snapshot && snapshot.graduation) || [],
          }
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = 'dsh-approval-rules-' + new Date().toISOString().slice(0, 10) + '.json'
          document.body.appendChild(a)
          a.click()
          a.remove()
          setTimeout(function () { URL.revokeObjectURL(url) }, 1000)
          showFeedback('已导出规则 JSON')
        } catch (e) { showFeedback('导出失败：' + String((e && e.message) || e), false) }
      }

      const setupNow = function () {
        setBusy(true)
        fetch('/api/auto-approve/setup', { method: 'POST' })
          .then(function (r) { return r.json() })
          .then(function (res) {
            if (res && res.ok) {
              if (res.status === 'already') showFeedback('权限预设已配置，无需操作')
              else showFeedback('已写入 cordis.patch.yml，请重启 dsh web 生效（status=' + res.status + '）')
            } else {
              showFeedback((res && res.error) || '初始化失败', false)
            }
            load()
          })
          .catch(function (e) { showFeedback('初始化请求失败：' + String((e && e.message) || e), false) })
          .finally(function () { setBusy(false) })
      }

      if (!snapshot) {
        return React.createElement('div', { className: 'ag-set', onClick: toggleSettingCard, onKeyDown: toggleSettingCard },
          React.createElement('div', { className: error ? 'ag-set-err' : 'ag-set-ok' }, error || T('加载中…','Loading…')))
      }

      const cfg = snapshot.config
      const setup = snapshot.setup || { configured: false }
      const predefined = snapshot.predefined || {}
      const preDeny = new Set(predefined.denyKeywords || [])
      const preAllow = (predefined.allowRules || []).map(function (r) { return JSON.stringify(r) })
      const preHard = new Set(predefined.hardCategories || [])
      const learnStats = snapshot.learning && snapshot.learning.stats ? snapshot.learning.stats : {}
      const learnHistory = snapshot.learning && snapshot.learning.history ? snapshot.learning.history : {}
      const statKeys = Object.keys(learnStats)
      const histKeys = Object.keys(learnHistory)
      const field = function (label, control, hint) {
        return React.createElement('div', { className: 'ag-field', key: label },
          React.createElement('span', { className: 'ag-field-label' }, label),
          React.createElement('div', { className: 'ag-field-control' }, control),
          hint ? React.createElement('span', { className: 'ag-field-hint' }, hint) : null,
        )
      }
      const switchToggle = function (checked, onClick, label) {
        return React.createElement('span', { className: 'ag-switch-pair' },
          React.createElement('button', {
            type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label,
            className: 'ag-switch' + (checked ? ' ag-switch-on' : ''),
            disabled: busy, onClick: onClick,
          }, React.createElement('span', { className: 'ag-switch-thumb' })),
          React.createElement('span', { className: 'ag-switch-state' }, checked ? '已开启' : '已关闭'),
        )
      }
      const ruleItem = function (key, label, desc, tags, actions) {
        return React.createElement('div', { className: 'ag-rule-item', key: key },
          React.createElement('div', { className: 'ag-rule-main' },
            React.createElement('span', { className: 'ag-rule-label' }, label),
            React.createElement('div', { className: 'ag-rule-actions' }, actions || []),
          ),
          desc ? React.createElement('div', { className: 'ag-rule-desc' }, desc) : null,
          tags && tags.length ? React.createElement('div', { className: 'ag-rule-sub' }, tags) : null,
        )
      }

      const beginEdit = function (kind, rule) {
        setEditError('')
        setEditingRule({
          kind: kind, id: rule.id,
          tool: rule.tool || '', mode: rule.mode || '', category: rule.category || '',
          contains: rule.contains || '', description: rule.description || '',
        })
      }
      const editField = function (field, width, placeholder) {
        return React.createElement('input', {
          className: 'ag-set-input', style: { width: width }, placeholder: placeholder,
          value: editingRule && editingRule[field] !== undefined ? editingRule[field] : '',
          onChange: function (e) {
            const v = e.target.value
            setEditingRule(function (prev) { return prev ? Object.assign({}, prev, { [field]: v }) : prev })
          },
        })
      }
      const ruleEditor = function (rule) {
        return React.createElement('div', { className: 'ag-rule-item ag-rule-editor', key: 'edit-' + rule.id },
          React.createElement('div', { className: 'ag-rule-main' },
            React.createElement('span', { className: 'ag-rule-label' }, '行内编辑 · ' + (rule.id || '')),
            React.createElement('div', { className: 'ag-rule-actions' },
              React.createElement('button', {
                type: 'button', className: 'ag-set-btn ag-set-btn-primary ag-btn-xs', disabled: busy,
                onClick: function () {
                  setEditError('')
                  api({
                    op: 'set', kind: editingRule.kind,
                    value: {
                      id: editingRule.id,
                      rule: {
                        tool: editingRule.tool, mode: editingRule.mode, category: editingRule.category,
                        contains: editingRule.contains, description: editingRule.description,
                      },
                    },
                  }).then(function (res) {
                    if (res && res.ok) setEditingRule(null)
                    else setEditError((res && res.error) || T('保存失败','Save failed'))
                  })
                },
              }, '保存'),
              React.createElement('button', {
                type: 'button', className: 'ag-set-btn ag-btn-xs', disabled: busy,
                onClick: function () { setEditingRule(null); setEditError('') },
              }, '取消'),
            ),
          ),
          React.createElement('div', { className: 'ag-set-row' },
            editField('tool', 130, 'tool'),
            editField('mode', 160, 'mode（可空）'),
            editField('category', 130, 'category（可空）'),
            editField('contains', 180, 'contains（可空）'),
            editField('description', 220, '描述'),
          ),
          editError ? React.createElement('div', { className: 'ag-rule-sub', style: { color: 'var(--dsw-alias-state-danger-primary)' } }, editError) : null,
        )
      }

      return React.createElement('div', { className: 'ag-set' },
        React.createElement('h3', { className: 'ag-set-title' }, '自动审批'),
        React.createElement('p', { className: 'ag-set-intro' },
          '管理自动审批的放行与阻塞规则：查看当前判定管道、黑/白名单与学习进度，可自行添加规则（如把 edit 加入白名单后自动放行）或终止错误的学习。修改即时生效（热更新）。'),

        // ---- 初始化卡片 ----
        React.createElement('div', { className: 'ag-set-card' + (collapsedCards.setup ? ' ag-set-collapsed' : ''), id: idPrefix + 'setup' },
          React.createElement('div', { className: 'ag-set-card-head', role: 'button', tabIndex: 0 },
            React.createElement('div', { className: 'ag-set-card-title' }, '初始化权限预设'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '安装后需在 profile 的 cordis.patch.yml 添加 auto-approve 权限预设（预设表在配置构造时冻结，无法自动扩展）。' +
              (setup.configured ? '当前已配置 ✓' : '当前未检测到，可一键写入。'))),
          React.createElement('div', { className: 'ag-set-row' },
            React.createElement('button', {
              type: 'button',
              className: 'ag-set-btn' + (setup.configured ? '' : ' ag-set-btn-primary'),
              disabled: busy,
              onClick: setupNow,
            }, setup.configured ? '重新检查' : '一键配置权限预设'),
            !setup.configured ? React.createElement('span', { className: 'ag-set-note' }, '写入后需重启 dsh web 生效') : null,
          ),
        ),

        // ---- 管道总览 ----
        React.createElement('div', { className: 'ag-set-card' + (collapsedCards.pipeline ? ' ag-set-collapsed' : ''), id: idPrefix + 'pipeline' },
          React.createElement('div', { className: 'ag-set-card-head', role: 'button', tabIndex: 0 },
            React.createElement('div', { className: 'ag-set-card-title' }, '当前判定管道'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '每次沙箱越界按下述链路判定，下面的配置卡片按管道顺序排列：')),
          React.createElement('div', { className: 'ag-set-grid' },
            (cfg.hardCategories || []).map(function (c) {
              const isPre = preHard.has(c)
              return React.createElement('span', { className: 'ag-set-hc', key: c },
                c + (isPre ? '' : ' · 自定义'))
            })),
        ),

        // ---- 黑名单（denyKeywords） ----
        React.createElement('div', { className: 'ag-set-card' + (collapsedCards.deny ? ' ag-set-collapsed' : ''), id: idPrefix + 'deny' },
          React.createElement('div', { className: 'ag-set-card-head', role: 'button', tabIndex: 0 },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, '① DENY 层'),
              '黑名单 · 不可逆危险词'),
            React.createElement('p', { className: 'ag-set-card-sub' }, '管道第一步：命中即转人工（fail-safe，最高优先）。可添加自定义危险词；删除预置词有风险，请谨慎。')),
          React.createElement('div', { className: 'ag-set-row' },
            React.createElement('input', {
              className: 'ag-set-input', value: newKeyword, placeholder: '输入危险词，如 sudo rm',
              onChange: function (e) { setNewKeyword(e.target.value) },
              onKeyDown: function (e) { if (e.key === 'Enter' && newKeyword.trim()) { api({ op: 'add', kind: 'denyKeywords', value: newKeyword.trim() }); setNewKeyword('') } },
            }),
            React.createElement('button', {
              type: 'button', className: 'ag-set-btn', disabled: busy || !newKeyword.trim(),
              onClick: function () { api({ op: 'add', kind: 'denyKeywords', value: newKeyword.trim() }); setNewKeyword('') },
            }, '添加'),
          ),
          (cfg.denyKeywords || []).length === 0
            ? React.createElement('div', { className: 'ag-set-empty' }, '无黑名单词')
            : React.createElement('div', { className: 'ag-set-list' },
                cfg.denyKeywords.map(function (kw) {
                  return React.createElement('div', { className: 'ag-set-item', key: kw },
                    React.createElement('span', { className: 'ag-set-item-label' }, kw),
                    preDeny.has(kw)
                      ? React.createElement('span', { className: 'ag-set-item-meta' }, '预置')
                      : null,
                    React.createElement('button', {
                      type: 'button', className: 'ag-set-item-del', title: '删除', 'aria-label': '删除 ' + kw,
                      onClick: function () {
                        if (preDeny.has(kw) && !window.confirm('删除预置危险词「' + kw + '」会降低安全性，确定？')) return
                        api({ op: 'remove', kind: 'denyKeywords', value: kw })
                      },
                    }, '✕'),
                  )
                }),
              ),
        ),

        // ---- 白名单（allowRules） ----
        React.createElement('div', { className: 'ag-set-card' + (collapsedCards.allow ? ' ag-set-collapsed' : ''), id: idPrefix + 'allow' },
          React.createElement('div', { className: 'ag-set-card-head', role: 'button', tabIndex: 0 },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, '② 白名单层'),
              '白名单 · 自动放行规则'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '管道第二步：命中规则直接自动放行（不过 Flash）。示例：tool=edit + mode=danger-full-access → 所有工作区外 edit 自动放行。')),
          React.createElement('div', { className: 'ag-set-row' },
            React.createElement('input', { className: 'ag-set-input', style: { width: 110 }, placeholder: 'tool', value: newRule.tool, onChange: function (e) { setNewRule(Object.assign({}, newRule, { tool: e.target.value })) } }),
            React.createElement('input', { className: 'ag-set-input', style: { width: 150 }, placeholder: 'mode（可选）', value: newRule.mode, onChange: function (e) { setNewRule(Object.assign({}, newRule, { mode: e.target.value })) } }),
            React.createElement('input', { className: 'ag-set-input', style: { width: 110 }, placeholder: 'category（可选）', value: newRule.category, onChange: function (e) { setNewRule(Object.assign({}, newRule, { category: e.target.value })) } }),
            React.createElement('input', { className: 'ag-set-input', style: { width: 130 }, placeholder: 'contains（可选）', value: newRule.contains, onChange: function (e) { setNewRule(Object.assign({}, newRule, { contains: e.target.value })) } }),
            React.createElement('button', {
              type: 'button', className: 'ag-set-btn ag-set-btn-primary', disabled: busy || !(newRule.tool || newRule.mode || newRule.category || newRule.contains),
              onClick: function () {
                api({ op: 'add', kind: 'allowRules', value: newRule })
                setNewRule({ tool: '', mode: '', category: '', contains: '' })
              },
            }, '添加'),
          ),
          React.createElement('div', { className: 'ag-set-empty', style: { padding: '0 0 2px' } }, '筛选 / 启停 / 导出 / 证据：见下方 ⑥ 规则库。'),
          (cfg.allowRules || []).length === 0
            ? React.createElement('div', { className: 'ag-set-empty' }, '无白名单规则')
            : React.createElement('div', { className: 'ag-set-list' },
                cfg.allowRules.map(function (rule, idx) {
                  const parts = []
                  if (rule.tool) parts.push('tool=' + rule.tool)
                  if (rule.mode) parts.push('mode=' + rule.mode)
                  if (rule.category) parts.push('category=' + rule.category)
                  if (rule.contains) parts.push('contains=' + rule.contains)
                  if (rule.signature) parts.push('sig=' + String(rule.signature).split('|').slice(2).join('|'))
                  const src = ruleSource(rule)
                  return ruleItem('b2-' + idx, parts.join('  ') || '(任意)', rule.description || '',
                    [RULE_SOURCE_TAGS[src] || RULE_SOURCE_TAGS.default,
                     React.createElement('span', { key: 'h', className: 'ag-set-item-meta' }, '命中 ' + (rule.hitCount || 0) + ' 次')],
                    [React.createElement('button', {
                      key: 'd', type: 'button', className: 'ag-set-item-del ag-icon-btn', title: '删除', 'aria-label': '删除规则',
                      onClick: function () { api({ op: 'remove', kind: 'allowRules', value: { tool: rule.tool, mode: rule.mode, category: rule.category, contains: rule.contains, signature: rule.signature } }) },
                    }, '✕')])
                }),
              ),
        ),

        // ---- 永久人工（denyRules） ----
        React.createElement('div', { className: 'ag-set-card' + (collapsedCards.denyrules ? ' ag-set-collapsed' : ''), id: idPrefix + 'denyrules' },
          React.createElement('div', { className: 'ag-set-card-head', role: 'button', tabIndex: 0 },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, '③ denyRules 层'),
              '永久人工 · 拒绝升级规则'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '管道第三步：neutral 操作被你拒绝后自动升级到这里，命中直接转人工（永不自动放行）。硬风险类别（删除/凭据/远程/系统/批量）本身永久人工，不在此记录。可手动移除。')),
          (cfg.denyRules || []).length === 0
            ? React.createElement('div', { className: 'ag-set-empty' }, '无升级规则（硬风险类别本就永久人工，不在此记录）')
            : React.createElement('div', { className: 'ag-set-list' },
                cfg.denyRules.map(function (rule, idx) {
                  const parts = []
                  if (rule.tool) parts.push('tool=' + rule.tool)
                  if (rule.mode) parts.push('mode=' + rule.mode)
                  if (rule.category) parts.push('category=' + rule.category)
                  if (rule.contains) parts.push('contains=' + rule.contains)
                  return React.createElement('div', { className: 'ag-set-item', key: idx },
                    React.createElement('span', { className: 'ag-set-item-label' }, parts.join('  ') || '(任意)'),
                    React.createElement('button', {
                      type: 'button', className: 'ag-set-item-del', title: '移除', 'aria-label': '移除规则',
                      onClick: function () {
                        api({ op: 'remove', kind: 'denyRules', value: { tool: rule.tool, mode: rule.mode, category: rule.category, contains: rule.contains } })
                      },
                    }, '✕'),
                  )
                }),
              ),
        ),

        // ---- 阈值 / 超时（④ Flash 判定参数） ----
        React.createElement('div', { className: 'ag-set-card' + (collapsedCards.flash ? ' ag-set-collapsed' : ''), id: idPrefix + 'flash' },
          React.createElement('div', { className: 'ag-set-card-head', role: 'button', tabIndex: 0 },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, '④ Flash 判定'),
              '判定超时'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '管道第四步：Flash 判断超时（超时自动重试 1 次，仍失败转人工）。人工确认阈值已移到 ⑤ 学习与沉淀。')),
          React.createElement('div', { className: 'ag-set-row' },
            React.createElement('span', { className: 'ag-set-item-meta' }, 'Flash 判断超时(ms)：'),
            React.createElement('input', {
              className: 'ag-set-input ag-set-input-num', type: 'number', min: 1000, value: timeoutMs,
              onChange: function (e) { setTimeoutMs(e.target.value) },
            }),
            React.createElement('button', {
              type: 'button', className: 'ag-set-btn', disabled: busy,
              onClick: function () { api({ op: 'set', kind: 'judgeTimeoutMs', value: Number(timeoutMs) }) },
            }, '保存'),
          ),
        ),

        // ---- Shadow 模式（观察期：只记录本可自动放行的候选，不真正放行） ----
        React.createElement('div', { className: 'ag-set-card' + (collapsedCards.shadow ? ' ag-set-collapsed' : ''), id: idPrefix + 'shadow' },
          React.createElement('div', { className: 'ag-set-card-head', role: 'button', tabIndex: 0 },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, 'Shadow'),
              '观察模式'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '开启后，命中原有自动放行路径（信任目录、会话记忆、白名单规则、Flash SAFE、沉淀规则、已确认操作）的请求仍转人工；系统只记录一条 Shadow 候选，告诉你“如果关闭观察，这次本可自动放行”。观察期不写规则、不写学习计数、不生成快照。')),
          React.createElement('div', { className: 'ag-set-row' },
            React.createElement('span', { className: 'ag-set-item-meta' }, 'Shadow 模式：'),
            switchToggle(cfg.shadow === true, function () { api({ op: 'set', kind: 'shadow', value: !(cfg.shadow === true) }) }, 'Shadow 模式'),
            React.createElement('span', { className: 'ag-set-item-meta' },
              cfg.shadow === true ? '观察中：所有候选转人工，仅记录' : '当前关闭：按正常策略自动放行'),
          ),
          React.createElement('div', { className: 'ag-set-row' },
            React.createElement('span', { className: 'ag-set-item-meta' },
              '提示：候选记录在「记录」页的 Shadow 筛选中查看；确认候选足够可信后再关闭观察。'),
          ),
          React.createElement('div', { className: 'ag-set-suggest-head' },
            React.createElement('span', { className: 'ag-set-item-meta' }, 'Shadow 候选分组（≥2 次）'),
            React.createElement('span', { className: 'ag-set-item-meta' }, shadowSuggestions.groups.length + ' 组 · ' + shadowSuggestions.total + ' 条')),
          shadowSuggestions.groups.length === 0
            ? React.createElement('div', { className: 'ag-set-empty' }, '暂无重复候选；继续观察一段时间。')
            : React.createElement('div', { className: 'ag-set-suggest-list' },
                shadowSuggestions.groups.map(function (g) {
                  const label = g.commandPattern || g.sampleJustification || '(无描述)'
                  return React.createElement('div', { className: 'ag-set-suggest', key: g.key },
                    React.createElement('div', { className: 'ag-set-suggest-main' },
                      React.createElement('code', null, label),
                      React.createElement('span', { className: 'ag-set-item-meta' }, g.count + ' 次 · ' + (g.wouldPath || 'candidate') + (g.cwd ? ' · ' + g.cwd : ''))),
                    g.suggestion
                      ? React.createElement('button', {
                          type: 'button', className: 'ag-set-btn ag-btn-xs', disabled: busy,
                          onClick: function () { api({ op: 'add', kind: 'allowRules', value: g.suggestion }) },
                        }, '创建规则')
                      : React.createElement('span', { className: 'ag-set-item-meta' }, '已有规则路径，无需建议'))
                })),
        ),

        // ---- 自动学习（⑤ 会话记忆 / 晋升 / 毕业 / 自学习） ----
        React.createElement('div', { className: 'ag-set-card' + (collapsedCards.learning ? ' ag-set-collapsed' : ''), id: idPrefix + 'learning' },
          React.createElement('div', { className: 'ag-set-card-head', role: 'button', tabIndex: 0 },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, '⑤ 学习与沉淀'),
              '人工确认 · 会话记忆 · 晋升 · 毕业 · 自学习'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '两层学习合并：人工确认累计会沉淀为规则；会话记忆/晋升/毕业/自学习则从批准和 Flash SAFE 判定中零点击沉淀。信任目录与规则管理在 ⑥ 规则库。'),
          React.createElement('div', { className: 'ag-learn-note' },
            cfg.selfLearn !== false
              ? '自学习已开启：Flash 累计 ' + (cfg.selfLearnThreshold || 3) + ' 次 SAFE（至少 ' + (cfg.selfLearnSessions || 1) + ' 个会话）后自动沉淀为全局规则；可随时关闭。'
              : '自学习当前关闭：会话记忆、跨会话晋升、签名毕业仍会基于你的人工批准工作。')),
          React.createElement('div', { className: 'ag-set-group' },
            React.createElement('div', { className: 'ag-set-group-title' }, '人工确认学习'),
            field('人工确认阈值（次数）',
              [React.createElement('input', { key: 'i', className: 'ag-set-input ag-set-input-num', type: 'number', min: 1, value: threshold, onChange: function (e) { setThreshold(e.target.value) } }),
               React.createElement('button', { key: 'b', type: 'button', className: 'ag-set-btn ag-btn-xs', disabled: busy, onClick: function () { api({ op: 'set', kind: 'riskyThreshold', value: Number(threshold) }) } }, '保存')],
              '同一「工具|模式|类别」确认满 N 次后，第 N+1 次起自动放行并沉淀规则'),
            statKeys.length === 0
              ? React.createElement('div', { className: 'ag-set-empty' }, '暂无正在学习的内容')
              : React.createElement('div', { className: 'ag-set-learn' },
                  statKeys.map(function (k) {
                    const samples = (learnHistory[k] || []).map(function (s) { return (s && (s.fp || s.ctx)) || '' }).join(' / ').slice(0, 160)
                    return React.createElement('div', { className: 'ag-set-learn-item', key: k },
                      React.createElement('div', { className: 'ag-set-learn-info' },
                        React.createElement('span', { className: 'ag-set-learn-key' }, k),
                        React.createElement('span', { className: 'ag-set-learn-sub' },
                          '已确认 ' + learnStats[k] + '/' + cfg.riskyThreshold + (samples ? ' · ' + samples : '')),
                      ),
                      React.createElement('button', {
                        type: 'button', className: 'ag-set-learn-stop', title: '终止学习（删除计数与样本）',
                        onClick: function () {
                          if (!window.confirm('终止「' + k + '」的学习？将删除其确认计数与样本。')) return
                          api({ op: 'remove', kind: 'learning', value: k })
                        },
                      }, '终止'),
                    )
                  }),
                ),
          ),
          React.createElement('div', { className: 'ag-set-group-title' }, '自动学习（零点击）'),
          !cfg.onboarded
            ? React.createElement('div', { className: 'ag-alert' },
                React.createElement('div', { className: 'ag-alert-title' },
                  cfg.selfLearn !== false ? '自动学习已开启（推荐）' : '自动学习已就绪'),
                React.createElement('div', { className: 'ag-alert-text' },
                  cfg.selfLearn !== false
                    ? '自学习、会话记忆、跨会话晋升默认开启。你不需要先配置：正常批准几次，规则会自动沉淀并在不同会话间复用；危险类别仍转人工。'
                    : '会话记忆与跨会话晋升已开启；自学习当前关闭。可以现在开启，让 Flash SAFE 的同类操作也自动沉淀。'),
                React.createElement('div', { className: 'ag-set-row' },
                  React.createElement('button', {
                    type: 'button', className: 'ag-set-btn ag-btn-xs ag-set-btn-primary',
                    onClick: function () { api({ op: 'set', kind: 'onboarded', value: true }) },
                  }, '知道了，开始使用'),
                  cfg.selfLearn === false
                    ? React.createElement('button', {
                        type: 'button', className: 'ag-set-btn ag-btn-xs',
                        onClick: function () { api({ op: 'set', kind: 'selfLearn', value: true }); api({ op: 'set', kind: 'onboarded', value: true }) },
                      }, '开启自学习')
                    : React.createElement('button', {
                        type: 'button', className: 'ag-set-btn ag-btn-xs',
                        onClick: function () { api({ op: 'set', kind: 'selfLearn', value: false }); api({ op: 'set', kind: 'onboarded', value: true }) },
                      }, '暂时关闭自学习'),
                ),
              )
            : null,
          React.createElement('div', { className: 'ag-set-group' },
            React.createElement('div', { className: 'ag-set-group-title' }, '自动学习参数'),
            field('会话记忆',
              switchToggle(cfg.sessionMemory !== false, function () { api({ op: 'set', kind: 'sessionMemory', value: !(cfg.sessionMemory !== false) }) }, '会话记忆'),
              '本会话人工批准过的同操作直接放行'),
            field('两段式判定',
              switchToggle(cfg.twoStage === true, function () { api({ op: 'set', kind: 'twoStage', value: !(cfg.twoStage === true) }) }, '两段式判定'),
              '快筛 + 复评；当前快筛模型偏保守，默认关'),
            field('语义近似复用',
              switchToggle(cfg.semanticReuse === true, function () { api({ op: 'set', kind: 'semanticReuse', value: !(cfg.semanticReuse === true) }) }, '语义近似复用'),
              '一次人工批准后，同类操作由 Flash 语义验证；默认关，不沉淀规则'),
            field('自学习',
              switchToggle(cfg.selfLearn === true, function () { api({ op: 'set', kind: 'selfLearn', value: !(cfg.selfLearn === true) }) }, '自学习'),
              '从 Flash 累计 SAFE 判定毕业（无人工确认）'),
            field('跨会话晋升（会话数）',
              [React.createElement('input', { key: 'i', className: 'ag-set-input ag-set-input-num', type: 'number', min: 1, value: promotionSessions, onChange: function (e) { setPromotionSessions(e.target.value) } }),
               React.createElement('button', { key: 'b', type: 'button', className: 'ag-set-btn ag-btn-xs', disabled: busy, onClick: function () { api({ op: 'set', kind: 'promotionSessions', value: Number(promotionSessions) }) } }, '保存')],
              '同一操作在多个会话确认后沉淀全局规则'),
            field('毕业阈值（次数）',
              [React.createElement('input', { key: 'i', className: 'ag-set-input ag-set-input-num', type: 'number', min: 1, value: graduationThreshold, onChange: function (e) { setGraduationThreshold(e.target.value) } }),
               React.createElement('button', { key: 'b', type: 'button', className: 'ag-set-btn ag-btn-xs', disabled: busy, onClick: function () { api({ op: 'set', kind: 'graduationThreshold', value: Number(graduationThreshold) }) } }, '保存')],
              '同类操作人工确认次数'),
            field('毕业会话数',
              [React.createElement('input', { key: 'i', className: 'ag-set-input ag-set-input-num', type: 'number', min: 1, value: graduationSessions, onChange: function (e) { setGraduationSessions(e.target.value) } }),
               React.createElement('button', { key: 'b', type: 'button', className: 'ag-set-btn ag-btn-xs', disabled: busy, onClick: function () { api({ op: 'set', kind: 'graduationSessions', value: Number(graduationSessions) }) } }, '保存')],
              '毕业需要的不同会话数'),
            field('自学习阈值（次数）',
              [React.createElement('input', { key: 'i', className: 'ag-set-input ag-set-input-num', type: 'number', min: 1, value: selfLearnThreshold, onChange: function (e) { setSelfLearnThreshold(e.target.value) } }),
               React.createElement('button', { key: 'b', type: 'button', className: 'ag-set-btn ag-btn-xs', disabled: busy, onClick: function () { api({ op: 'set', kind: 'selfLearnThreshold', value: Number(selfLearnThreshold) }) } }, '保存')],
              '累计 SAFE 判定次数'),
            field('自学习会话数',
              [React.createElement('input', { key: 'i', className: 'ag-set-input ag-set-input-num', type: 'number', min: 1, value: selfLearnSessions, onChange: function (e) { setSelfLearnSessions(e.target.value) } }),
               React.createElement('button', { key: 'b', type: 'button', className: 'ag-set-btn ag-btn-xs', disabled: busy, onClick: function () { api({ op: 'set', kind: 'selfLearnSessions', value: Number(selfLearnSessions) }) } }, '保存')],
              '自学习需要的不同会话数'),
            field('快筛模型（可选）',
              [React.createElement('input', { key: 'p', className: 'ag-set-input', style: { width: 110 }, placeholder: 'provider', value: stage1Provider, onChange: function (e) { setStage1Provider(e.target.value) } }),
               React.createElement('input', { key: 'm', className: 'ag-set-input', style: { width: 130 }, placeholder: 'model', value: stage1Model, onChange: function (e) { setStage1Model(e.target.value) } }),
               React.createElement('button', { key: 'b', type: 'button', className: 'ag-set-btn ag-btn-xs', disabled: busy, onClick: function () { api({ op: 'set', kind: 'stage1Provider', value: stage1Provider }); api({ op: 'set', kind: 'stage1Model', value: stage1Model }) } }, '保存')],
              '两段式开启时生效；留空用默认模型'),
          ),
        ),

        // ---- 规则库（⑥ 统一管理） ----
        React.createElement('div', { className: 'ag-set-card' + (collapsedCards.library ? ' ag-set-collapsed' : ''), id: idPrefix + 'library' },
          React.createElement('div', { className: 'ag-set-card-head', role: 'button', tabIndex: 0 },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, '⑥ 规则库'),
              '统一管理 · 白名单 / 永久人工 / 信任目录 / 毕业进度'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '查看所有生效规则的来源、命中与状态；支持搜索、启停、删除、导出与证据。')),
          React.createElement('div', { className: 'ag-set-toolbar' },
            React.createElement('div', { className: 'ag-set-seg' },
              [['allow', '白名单', (cfg.allowRules || []).length], ['deny', '永久人工', (cfg.denyRules || []).length], ['trust', '信任目录', (cfg.trustRoots || []).length + (cfg.projectTrust || []).length], ['graduation', '毕业进度', (snapshot.graduation || []).length]].map(function (tab) {
                return React.createElement('button', {
                  type: 'button', key: tab[0],
                  className: 'ag-set-seg-btn' + (libTab === tab[0] ? ' ag-set-seg-active' : ''),
                  onClick: function () { setLibTab(tab[0]) },
                }, tab[1] + ' ' + tab[2])
              }),
            ),
            React.createElement('span', { style: { flex: '1 1 auto' } }),
            React.createElement('input', {
              className: 'ag-set-input', style: { width: 200 }, placeholder: '搜索 tool / mode / contains / 描述',
              value: libQuery, onChange: function (e) { setLibQuery(e.target.value) },
            }),
            React.createElement('button', { type: 'button', className: 'ag-set-btn ag-btn-xs', onClick: exportRules }, '导出 JSON'),
          ),
          (function () {
            const warns = (snapshot.warnings && snapshot.warnings.allowRules) || []
            const tWarns = (snapshot.warnings && snapshot.warnings.trustRoots) || []
            const total = warns.length + tWarns.length
            if (total === 0) return null
            return React.createElement('div', { className: 'ag-alert' },
              React.createElement('div', { className: 'ag-alert-title' }, '规则体检 · ' + total + ' 条可能过宽'),
              warns.map(function (w, i) {
                const rule = w.rule || {}
                const label = [rule.tool, rule.mode, rule.contains ? ('contains=' + rule.contains) : ''].filter(Boolean).join(' · ') || '(任意)'
                return React.createElement('div', { className: 'ag-alert-row', key: 'w' + i },
                  React.createElement('span', { className: 'ag-alert-text' }, label + ' — ' + w.reasons.join('；') + (w.suggestion ? '。建议：' + w.suggestion : '')),
                  React.createElement('button', {
                    type: 'button', className: 'ag-set-btn ag-btn-xs',
                    onClick: function () { api({ op: 'toggle', kind: 'allowRules', value: { tool: rule.tool, mode: rule.mode, category: rule.category, contains: rule.contains, signature: rule.signature } }) },
                  }, '停用'),
                )
              }),
              tWarns.map(function (w, i) {
                return React.createElement('div', { className: 'ag-alert-row', key: 'tw' + i },
                  React.createElement('span', { className: 'ag-alert-text' }, w.root + ' — ' + w.reasons.join('；')),
                  React.createElement('button', { type: 'button', className: 'ag-set-btn ag-btn-xs', onClick: function () { api({ op: 'remove', kind: 'trustRoots', value: w.root }) } }, '移除'),
                )
              }),
            )
          })(),
          (function () {
            const q = String(libQuery || '').trim().toLowerCase()
            const hit = function (text) { return q === '' || String(text || '').toLowerCase().indexOf(q) >= 0 }
            const empty = function (text) { return React.createElement('div', { className: 'ag-set-empty' }, text) }
            if (libTab === 'allow') {
              const rules = (cfg.allowRules || []).filter(function (r) { return hit([r.tool, r.mode, r.category, r.contains, r.description, r.signature, r.commandPattern, r.cwdPrefix].join(' ')) })
              if (rules.length === 0) return empty('没有匹配的白名单规则')
              return React.createElement('div', { className: 'ag-set-list' }, rules.map(function (rule, idx) {
                const parts = []
                if (rule.tool) parts.push('tool=' + rule.tool)
                if (rule.mode) parts.push('mode=' + rule.mode)
                if (rule.category) parts.push('category=' + rule.category)
                if (rule.commandPattern) parts.push('cmd=' + rule.commandPattern)
                if (rule.cwdPrefix) parts.push('cwd=' + rule.cwdPrefix)
                if (rule.contains) parts.push('contains=' + rule.contains)
                if (rule.signature) parts.push('sig=' + String(rule.signature).split('|').slice(2).join('|'))
                const actions = []
                if (rule.evidenceEventId) actions.push(React.createElement('button', { key: 'e', type: 'button', className: 'ag-set-btn ag-btn-xs', title: T('复制触发该规则的事件 ID','Copy triggering event ID'), onClick: function () { copyText(rule.evidenceEventId) } }, '证据 #' + rule.evidenceEventId))
                if (!rule.signature) actions.push(React.createElement('button', { key: 'm', type: 'button', className: 'ag-set-btn ag-btn-xs', onClick: function () { beginEdit('allowRules', rule) } }, '编辑'))
                actions.push(React.createElement('button', { key: 't', type: 'button', className: 'ag-set-btn ag-btn-xs', onClick: function () { api({ op: 'toggle', kind: 'allowRules', value: { tool: rule.tool, mode: rule.mode, category: rule.category, contains: rule.contains, signature: rule.signature, commandPattern: rule.commandPattern, cwdPrefix: rule.cwdPrefix } }) } }, rule.disabled ? '启用' : '停用'))
                actions.push(React.createElement('button', { key: 'd', type: 'button', className: 'ag-set-item-del ag-icon-btn', title: '删除', 'aria-label': '删除规则', onClick: function () { api({ op: 'remove', kind: 'allowRules', value: { tool: rule.tool, mode: rule.mode, category: rule.category, contains: rule.contains, signature: rule.signature, commandPattern: rule.commandPattern, cwdPrefix: rule.cwdPrefix } }) } }, '✕'))
                const tags = [RULE_SOURCE_TAGS[ruleSource(rule)] || RULE_SOURCE_TAGS.default]
                if (rule.disabled) tags.push(React.createElement('span', { key: 'x', className: 'ag-set-tag ag-set-tag-gray' }, '已停用'))
                tags.push(React.createElement('span', { key: 'h', className: 'ag-set-item-meta' }, '命中 ' + (rule.hitCount || 0) + ' 次' + (rule.lastHit ? ' · 最近 ' + new Date(rule.lastHit).toLocaleString() : '')))
                if (editingRule && editingRule.kind === 'allowRules' && editingRule.id === rule.id) return ruleEditor(rule)
                return ruleItem('lib-a-' + idx, parts.join('  ') || '(任意)', rule.description || '', tags, actions)
              }))
            }
            if (libTab === 'deny') {
              const rules = (cfg.denyRules || []).filter(function (r) { return hit([r.tool, r.mode, r.category, r.contains, r.description, r.commandPattern, r.cwdPrefix].join(' ')) })
              if (rules.length === 0) return empty('没有匹配的永久人工规则')
              return React.createElement('div', { className: 'ag-set-list' }, rules.map(function (rule, idx) {
                const parts = []
                if (rule.tool) parts.push('tool=' + rule.tool)
                if (rule.mode) parts.push('mode=' + rule.mode)
                if (rule.category) parts.push('category=' + rule.category)
                if (rule.commandPattern) parts.push('cmd=' + rule.commandPattern)
                if (rule.cwdPrefix) parts.push('cwd=' + rule.cwdPrefix)
                if (rule.contains) parts.push('contains=' + rule.contains)
                const actions = [
                  React.createElement('button', { key: 'm', type: 'button', className: 'ag-set-btn ag-btn-xs', onClick: function () { beginEdit('denyRules', rule) } }, '编辑'),
                  React.createElement('button', { key: 't', type: 'button', className: 'ag-set-btn ag-btn-xs', onClick: function () { api({ op: 'toggle', kind: 'denyRules', value: { tool: rule.tool, mode: rule.mode, category: rule.category, contains: rule.contains, commandPattern: rule.commandPattern, cwdPrefix: rule.cwdPrefix } }) } }, rule.disabled ? '启用' : '停用'),
                  React.createElement('button', { key: 'd', type: 'button', className: 'ag-set-item-del ag-icon-btn', title: '删除', 'aria-label': '删除规则', onClick: function () { api({ op: 'remove', kind: 'denyRules', value: { tool: rule.tool, mode: rule.mode, category: rule.category, contains: rule.contains, commandPattern: rule.commandPattern, cwdPrefix: rule.cwdPrefix } }) } }, '✕'),
                ]
                const tags = [rule.disabled ? React.createElement('span', { key: 'x', className: 'ag-set-tag ag-set-tag-gray' }, '已停用') : null].filter(Boolean)
                if (editingRule && editingRule.kind === 'denyRules' && editingRule.id === rule.id) return ruleEditor(rule)
                return ruleItem('lib-d-' + idx, parts.join('  ') || '(任意)', rule.description || '', tags, actions)
              }))
            }
            if (libTab === 'trust') {
              const roots = (cfg.trustRoots || []).filter(function (r) { return hit(r) })
              const addRow = React.createElement('div', { className: 'ag-set-row' },
                React.createElement('input', {
                  className: 'ag-set-input', style: { flex: '1 1 240px' }, placeholder: '信任目录，如 ~/src 或 /tmp/work', value: newLibTrustRoot,
                  onChange: function (e) { setNewLibTrustRoot(e.target.value) },
                  onKeyDown: function (e) { if (e.key === 'Enter' && newLibTrustRoot.trim()) { api({ op: 'add', kind: 'trustRoots', value: newLibTrustRoot.trim() }); setNewLibTrustRoot('') } },
                }),
                React.createElement('button', {
                  type: 'button', className: 'ag-set-btn ag-btn-xs', disabled: busy || !newLibTrustRoot.trim(),
                  onClick: function () { api({ op: 'add', kind: 'trustRoots', value: newLibTrustRoot.trim() }); setNewLibTrustRoot('') },
                }, '添加'),
              )
              const list = roots.length === 0
                ? empty('没有匹配的信任目录')
                : React.createElement('div', { className: 'ag-set-list' }, roots.map(function (root, idx) {
                    return ruleItem('lib-t-' + idx, root, '范围内的操作直接放行', [],
                      [React.createElement('button', { key: 'd', type: 'button', className: 'ag-set-item-del ag-icon-btn', title: '移除', 'aria-label': '移除信任目录', onClick: function () { api({ op: 'remove', kind: 'trustRoots', value: root }) } }, '✕')])
                  }))
              const proots = (cfg.projectTrust || []).filter(function (r) { return hit(r) })
              const projectAddRow = React.createElement('div', { className: 'ag-set-row' },
                React.createElement('input', {
                  className: 'ag-set-input', style: { flex: '1 1 240px' }, placeholder: '项目根目录，如 ~/src/my-project', value: newLibProjectRoot,
                  onChange: function (e) { setNewLibProjectRoot(e.target.value) },
                  onKeyDown: function (e) { if (e.key === 'Enter' && newLibProjectRoot.trim()) { api({ op: 'add', kind: 'projectTrust', value: newLibProjectRoot.trim() }); setNewLibProjectRoot('') } },
                }),
                React.createElement('button', {
                  type: 'button', className: 'ag-set-btn ag-btn-xs', disabled: busy || !newLibProjectRoot.trim(),
                  onClick: function () { api({ op: 'add', kind: 'projectTrust', value: newLibProjectRoot.trim() }); setNewLibProjectRoot('') },
                }, '添加'),
              )
              const projectList = proots.length === 0
                ? empty('没有项目信任；添加后仅该目录内的 edit/write 与 test/build 自动放行')
                : React.createElement('div', { className: 'ag-set-list' }, proots.map(function (root, idx) {
                    return ruleItem('lib-p-' + idx, root, '仅 edit/write + 已识别 test/build；push/网络/删除仍人工', [],
                      [React.createElement('button', { key: 'd', type: 'button', className: 'ag-set-item-del ag-icon-btn', title: '移除', 'aria-label': '移除项目信任', onClick: function () { api({ op: 'remove', kind: 'projectTrust', value: root }) } }, '✕')])
                  }))
              return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  React.createElement('div', { className: 'ag-set-card-sub' }, '全局信任目录：范围内的所有操作直接放行（含 push/网络，风险更高）。'),
                  addRow, list),
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  React.createElement('div', { className: 'ag-set-card-sub' }, '项目信任：只放行该目录内的 edit/write 和已识别的 test/build 命令；push、网络、删除仍需人工。'),
                  projectAddRow, projectList))
            }
            const gs = (snapshot.graduation || []).filter(function (g) { return hit(g.signature + ' ' + (g.tool || '') + ' ' + (g.mode || '')) })
            if (gs.length === 0) return empty('没有匹配的毕业进度')
            return React.createElement('div', { className: 'ag-set-list' }, gs.map(function (g, idx) {
              return ruleItem('lib-g-' + idx, String(g.signature).split('|').slice(2).join('|'), '',
                [React.createElement('span', { key: 'm', className: 'ag-set-item-meta' }, (g.tool || '') + ' · ' + (g.mode || '任意') + ' · 已确认 ' + g.count + ' 次 · ' + g.sessions + ' 个会话')],
                [React.createElement('button', { key: 'd', type: 'button', className: 'ag-set-item-del ag-icon-btn', title: '清除该学习进度', 'aria-label': '清除学习进度', onClick: function () { api({ op: 'remove', kind: 'graduation', value: g.signature }) } }, '✕')])
            }))
          })(),
        ),

        // ---- 反馈 ----
        feedback
          ? React.createElement('div', { className: feedback.ok ? 'ag-set-ok' : 'ag-set-err' }, feedback.msg)
          : null,
      )
    }

    const plugin = {
      inject: ['timer'],
      async apply(ctx) {
        const slots = ctx.get('slots')
        if (slots === undefined) return

        let styleEl = null
        try {
          styleEl = document.createElement('style')
          styleEl.setAttribute('data-plugin-css', 'dsh-moongate')
          styleEl.textContent = CSS
          document.head.appendChild(styleEl)
        } catch (e) {
          console.error('[dsh-moongate] 注入样式失败：' + String((e && e.message) || e))
        }
        ctx.effect(() => {
          return () => {
            if (styleEl && styleEl.parentNode) {
              try { styleEl.parentNode.removeChild(styleEl) } catch (e) {}
            }
          }
        })

        // ✅ 自动放行提示条：输入框上方独立行（order=30，排在 todo/goal/queue 之下，天然不重叠）
        slots.inject('conversation.input.dock', function () {
          return slots.register(
            { name: 'conversation.input.dock', id: 'dsh-approval-gate.notice', order: 30, label: '自动放行提示' },
            function (props) { return React.createElement(NoticeStrip, { slotsProps: props }) },
          )
        })

        // 审批历史视图：conversation.view（order=20，位于轨迹 order=10 右侧）
        slots.inject('conversation.view', function () {
          return slots.register(
            {
              name: 'conversation.view',
              id: 'dsh-approval-gate.history',
              order: 20,
              label: '审批',
              inject: (sessionId) => ({ sessionId }),
            },
            function (props) { return React.createElement(HistoryView, { slotsProps: props }) },
          )
        })

      },
    }

    exports.default = plugin
    exports.apply = plugin.apply
    exports.inject = plugin.inject
    return module.exports
  },
})
