/**
 * dsh-approval-gate — 自动审批审查界面（浏览器端 bundle）
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
  id: 'dsh-approval-gate',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

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
.ag-row-top{display:flex;align-items:center;gap:8px;min-width:0}
.ag-row-tool{flex:none;color:var(--dsw-alias-label-primary);font:500 12px/18px var(--ds-font-family-code)}
.ag-row-reason{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;word-break:break-all;white-space:pre-wrap}
.ag-row-files{display:flex;flex-wrap:wrap;gap:4px}
.ag-row-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
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
.ag-set-row{flex-wrap:wrap;gap:8px;display:flex}
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
`

    const VERDICT_LABELS = {
      rule: '白名单规则',
      'flash-safe': 'Flash 判定安全',
      learned: '沉淀规则',
      fpHit: '已确认操作',
      'flash-same': 'Flash 同类验证'
    }
    const VERDICT_NEUTRAL = new Set(['rule', 'learned', 'fpHit', 'flash-same'])
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
        title = '等待人工审批：' + (notice.justification || notice.reason || '')
        tagText = '人工审批中'
        glyph = React.createElement('span', { className: 'ag-notice-glyph-warn' }, '◔')
      } else if (kind === 'manual-approved') {
        const lc = notice.learningCount !== undefined ? notice.learningCount : null
        const th = notice.threshold || 3
        title = '人工审批通过：' + (notice.justification || notice.reason || '')
        tagText = lc !== null ? ('学习 ' + lc + '/' + th + '，满 ' + th + ' 次后自动放行') : '人工审批通过'
        glyph = React.createElement('span', { className: 'ag-notice-glyph-warn' }, '✓')
      } else if (kind === 'manual-rejected') {
        title = '已拒绝：' + (notice.justification || notice.reason || '')
        tagText = rejectLabel(notice).replace('人工拒绝', '已拒绝')
        glyph = React.createElement('span', { className: 'ag-notice-glyph-err' }, '✕')
      } else if (kind === 'escalate') {
        title = '需人工介入：连续拒绝 ' + (notice.consecutive || '?') + ' 次 / 累计 ' + (notice.total || '?') + ' 次'
        tagText = '需人工介入'
        glyph = React.createElement('span', { className: 'ag-notice-glyph-err' }, '⚠')
      } else {
        title = (notice.justification || notice.reason || '')
        const label = VERDICT_LABELS[notice.verdict] || notice.verdict || '自动放行'
        tagText = '自动放行 · ' + label
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
            title: '关闭提示',
            'aria-label': '关闭提示',
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
            setRevertMsg((res && res.error) || '发送失败')
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

      return React.createElement('div', { className: 'ag-diff-overlay', onClick: function (e) { if (e.target === e.currentTarget) onClose() } },
        React.createElement('div', { className: 'ag-diff-panel' },
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
                ? React.createElement('div', { className: 'ag-diff-empty' }, '加载中…')
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
              ? React.createElement('span', { className: revertMsg.indexOf('已发送') === 0 ? 'ag-set-ok' : 'ag-set-err' }, revertMsg)
              : null,
            React.createElement('button', {
              type: 'button', className: 'ag-set-btn ag-set-btn-primary',
              onClick: doRevert,
              disabled: reverting || revertDone,
            }, reverting ? '发送中…' : (revertDone ? '已发送撤销指令' : '撤销此改动')),
            React.createElement('button', { type: 'button', className: 'ag-set-btn', onClick: onClose }, '关闭'),
          ),
        ),
      )
    }

    // ================= 审批历史视图（conversation.view，order=20，轨迹右侧） =================
    function HistoryView(props) {
      const sessionId = (props && (props.sessionId || (props.slotsProps && props.slotsProps.sessionId))) || null
      const [events, setEvents] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [snapStats, setSnapStats] = React.useState(null) // {count, bytes} | null（当前会话）
      const [globalSnapStats, setGlobalSnapStats] = React.useState(null) // {count, bytes} | null（全部会话）
      const [counters, setCounters] = React.useState(null) // {consecutive, total, limits} | null
      const [kindFilter, setKindFilter] = React.useState('all')
      const [query, setQuery] = React.useState('')
      const [rulesSnap, setRulesSnap] = React.useState(null)
      const [snapIds, setSnapIds] = React.useState(null) // Set<eventId> | null（当前存在快照的事件）
      const [diffOpen, setDiffOpen] = React.useState(null) // {eventId, path} | null
      const [remembered, setRemembered] = React.useState({}) // eventId -> 'remembered' | 'forgotten' | 'busy' | 'error:…'

      const loadSnapStats = function (sid) {
        const q = sid ? ('?sessionId=' + encodeURIComponent(sid)) : ''
        fetch('/api/auto-approve/snapshots-stats' + q, { headers: { 'cache-control': 'no-cache' } })
          .then(function (r) { return r.json() })
          .then(function (res) {
            if (!res || !res.ok) return
            setSnapStats({ count: res.count || 0, bytes: res.bytes || 0 })
            setSnapIds(new Set((res.ids || []).map(String)))
          })
          .catch(function () {})
        fetch('/api/auto-approve/snapshots-stats', { headers: { 'cache-control': 'no-cache' } })
          .then(function (r) { return r.json() })
          .then(function (res) {
            if (!res || !res.ok) return
            setGlobalSnapStats({ count: res.count || 0, bytes: res.bytes || 0 })
          })
          .catch(function () {})
      }

      // 清除快照：mode='session' 仅本会话（默认），mode='all' 清全部（含其他会话，需二次确认）
      const loadRules = function () {
        fetch('/api/auto-approve/rules', { headers: { 'cache-control': 'no-cache' } })
          .then(function (r) { return r.json() })
          .then(function (res) { if (res && res.config) setRulesSnap(res) })
          .catch(function () {})
      }

      const loadCounters = function (sid) {
        if (!sid) return
        fetch('/api/auto-approve/counters?sessionId=' + encodeURIComponent(sid), { headers: { 'cache-control': 'no-cache' } })
          .then(function (r) { return r.json() })
          .then(function (res) { if (res && res.ok) setCounters({ consecutive: res.consecutive, total: res.total, limits: res.limits }) })
          .catch(function () {})
      }

      const doClearSnapshots = function (mode) {
        const sid = mode === 'session' ? sessionId : ''
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
          else setOverride(ev.id, 'error:' + ((res && res.error) || '未知错误'))
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
          else setOverride(ev.id, 'error:' + ((res && res.error) || '未知错误'))
        }).catch(function (e) { setOverride(ev.id, 'error:' + String((e && e.message) || e)) })
      }

      React.useEffect(function () {
        setEvents(null)
        setError(null)
        loadSnapStats(sessionId)
        loadCounters(sessionId)
        loadRules()
        if (!sessionId) { setEvents([]); return }
        let alive = true
        const load = function () {
          fetchEvents(sessionId, 0).then(function (evs) {
            if (!alive) return
            evs.sort(function (a, b) { return b.id - a.id }) // 时间倒序：最新在最上面
            setEvents(evs)
            setError(null)
          }).catch(function (e) {
            if (!alive) return
            setError(String((e && e.message) || e))
          })
          loadSnapStats(sessionId)
          loadCounters(sessionId)
          loadRules()
        }
        load()
        const timer = setInterval(load, 5000)
        return function () { alive = false; clearInterval(timer) }
      }, [sessionId])

      const kindKey = function (ev) {
        const k = ev.kind || 'auto'
        if (k === 'manual-approved') return 'approved'
        if (k === 'manual-rejected') return 'rejected'
        if (k === 'escalate') return 'escalate'
        return 'auto'
      }
      const rows = (events || []).filter(function (ev) { return (ev.kind || 'auto') !== 'manual-pending' })
      const counts = { auto: 0, approved: 0, rejected: 0, escalate: 0 }
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
        if (kindFilter !== 'all' && kindKey(ev) !== kindFilter) return false
        if (q === '') return true
        return [ev.tool, ev.justification, ev.reason, ev.args, ev.verdict].join(' ').toLowerCase().indexOf(q) >= 0
      })
      const groups = []
      const groupMap = {}
      filtered.forEach(function (ev) {
        const day = String(ev.ts || '').slice(0, 10) || '未知日期'
        if (!groupMap[day]) { groupMap[day] = { day: day, items: [] }; groups.push(groupMap[day]) }
        groupMap[day].items.push(ev)
      })
      const chips = [
        ['all', '全部', total],
        ['auto', '自动放行', counts.auto],
        ['approved', '人工通过', counts.approved],
        ['rejected', '已拒绝', counts.rejected],
        ['escalate', '需人工介入', counts.escalate],
      ]
      const stat = function (label, value, sub) {
        return React.createElement('div', { className: 'ag-stat', key: label },
          React.createElement('span', { className: 'ag-stat-label' }, label),
          React.createElement('span', { className: 'ag-stat-value' }, String(value)),
          React.createElement('span', { className: 'ag-stat-sub' }, sub || ''),
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
          tagText = lc !== null ? ('人工通过 · 学习 ' + lc + '/' + th) : '人工通过'
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
        } else {
          tagText = '自动放行 · ' + (VERDICT_LABELS[ev.verdict] || ev.verdict || 'auto')
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
            ev.args
              ? React.createElement('div', { className: 'ag-args', title: ev.args }, '参数：' + String(ev.args).slice(0, 240))
              : null,
            React.createElement('div', { className: 'ag-row-actions' },
              kind !== 'manual-rejected'
                ? React.createElement('button', {
                    type: 'button', className: 'ag-set-btn ag-btn-xs',
                    disabled: busy,
                    onClick: function () { if (isRemembered) doForget(ev); else doRemember(ev) },
                    title: isRemembered ? '取消记住：删除该操作的白名单规则' : '把这次操作沉淀为白名单规则',
                  }, busy ? '处理中…' : (errored ? '重试' : (isRemembered ? '取消记住' : '记住这次操作')))
                : null,
            ),
            files.length > 0
              ? React.createElement('div', { className: 'ag-row-files' }, files.map(function (f, i) {
                  const chipProps = { key: i, className: 'ag-file-chip' }
                  if (hasSnap) {
                    chipProps.className += ' ag-file-chip-snap'
                    chipProps.title = '查看该文件改动对比'
                    chipProps.role = 'button'
                    chipProps.onClick = function () { setDiffOpen({ eventId: ev.id, path: f }) }
                  }
                  return React.createElement('span', chipProps, String(f).split('/').pop())
                }))
              : null,
          ),
        )
      }
      return React.createElement('div', { className: 'ag-view' },
        React.createElement('div', { className: 'ag-view-head' },
          React.createElement('div', { className: 'ag-view-title' }, '自动放行审批'),
          React.createElement('div', { className: 'ag-view-sub' }, '本会话审批记录、学习规则与快照（最新在上）'),
        ),
        React.createElement('div', { className: 'ag-dash' },
          React.createElement('div', { className: 'ag-stat-grid' },
            stat('自动放行', counts.auto, pct(counts.auto) + '% · Flash / 规则'),
            stat('人工通过', counts.approved, pct(counts.approved) + '%'),
            stat('已拒绝', counts.rejected, pct(counts.rejected) + '%'),
            stat('需人工介入', counts.escalate, pct(counts.escalate) + '%'),
          ),
          React.createElement('div', { className: 'ag-dist' },
            React.createElement('div', { className: 'ag-dist-bar' },
              distSeg(counts.auto, 'var(--dsw-alias-state-success-primary)'),
              distSeg(counts.approved, 'var(--dsw-alias-state-warn-primary)'),
              distSeg(counts.rejected, 'var(--dsw-alias-state-error-primary)'),
              distSeg(counts.escalate, 'var(--dsw-alias-state-error-label)'),
            ),
            React.createElement('div', { className: 'ag-dist-legend' },
              React.createElement('span', null, '自动 ' + counts.auto),
              React.createElement('span', null, '人工 ' + counts.approved),
              React.createElement('span', null, '拒绝 ' + counts.rejected),
              React.createElement('span', null, '升级 ' + counts.escalate),
            ),
          ),
          React.createElement('div', { className: 'ag-stat-grid' },
            stat('规则总数', ruleStats.total, '白名单规则'),
            stat('自学习规则', ruleStats.self, 'Flash SAFE 毕业'),
            stat('毕业规则', ruleStats.graduated, '人工确认毕业'),
            stat('信任目录', ruleStats.trust, '免审批目录'),
          ),
        ),
        React.createElement('div', { className: 'ag-toolbar2' },
          chips.map(function (c) {
            return React.createElement('button', {
              key: c[0], type: 'button',
              className: 'ag-chip' + (kindFilter === c[0] ? ' ag-chip-active' : ''),
              onClick: function () { setKindFilter(c[0]) },
            }, c[1] + ' ' + c[2])
          }),
          React.createElement('span', { style: { flex: '1 1 auto' } }),
          React.createElement('input', {
            className: 'ag-set-input ag-search', placeholder: '搜索工具 / 理由 / 参数',
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
            disabled: !snapStats || snapStats.count === 0,
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
          ? React.createElement('div', { className: 'ag-loading' }, '加载中…')
          : filtered.length === 0
            ? React.createElement('div', { className: 'ag-empty' }, error ? ('加载失败：' + error) : (rows.length === 0 ? '本会话暂无审批记录' : '没有匹配的记录'))
            : React.createElement('div', { className: 'ag-list' },
                groups.map(function (g) {
                  return React.createElement('div', { className: 'ag-group', key: g.day },
                    React.createElement('div', { className: 'ag-group-label' }, g.day),
                    g.items.map(renderRow),
                  )
                }),
              ),
        diffOpen
          ? React.createElement(DiffPanel, {
              sessionId: sessionId,
              eventId: diffOpen.eventId,
              path: diffOpen.path,
              onClose: function () { setDiffOpen(null) },
            })
          : null,
      )
    }

    // ================= 设置页：自动审批规则管理（settings.section） =================
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
      const [stage1Provider, setStage1Provider] = React.useState('')
      const [stage1Model, setStage1Model] = React.useState('')
      const [selfLearnThreshold, setSelfLearnThreshold] = React.useState('5')
      const [selfLearnSessions, setSelfLearnSessions] = React.useState('2')
      const [promotionSessions, setPromotionSessions] = React.useState('2')
      const [graduationThreshold, setGraduationThreshold] = React.useState('3')
      const [graduationSessions, setGraduationSessions] = React.useState('2')

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
      React.useEffect(function () { load() }, [])

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
          if (res && res.ok) { load(); showFeedback('已生效（热更新，无需重启）'); return res }
          showFeedback((res && res.error) || '操作失败', false)
          return res
        }).catch(function (e) {
          showFeedback('请求失败：' + String((e && e.message) || e), false)
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
        return React.createElement('div', { className: 'ag-set' },
          React.createElement('div', { className: error ? 'ag-set-err' : 'ag-set-ok' }, error || '加载中…'))
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

      return React.createElement('div', { className: 'ag-set' },
        React.createElement('h3', { className: 'ag-set-title' }, '自动审批'),
        React.createElement('p', { className: 'ag-set-intro' },
          '管理自动审批的放行与阻塞规则：查看当前判定管道、黑/白名单与学习进度，可自行添加规则（如把 edit 加入白名单后自动放行）或终止错误的学习。修改即时生效（热更新）。'),

        // ---- 初始化卡片 ----
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
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
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
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
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
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
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
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
          React.createElement('div', { className: 'ag-set-empty', style: { padding: '0 0 2px' } }, '筛选 / 启停 / 导出 / 证据：见下方 ⑦ 规则库。'),
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
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
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
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, '④ Flash 判定'),
              '阈值与超时'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '管道第四步：确认阈值 N（学习满 N 次后第 N+1 次自动放行）与 Flash 判断超时（超时自动重试 1 次，仍失败转人工）。')),
          React.createElement('div', { className: 'ag-set-row' },
            React.createElement('span', { className: 'ag-set-item-meta' }, '确认阈值 N：'),
            React.createElement('input', {
              className: 'ag-set-input ag-set-input-num', type: 'number', min: 1, value: threshold,
              onChange: function (e) { setThreshold(e.target.value) },
            }),
            React.createElement('button', {
              type: 'button', className: 'ag-set-btn', disabled: busy,
              onClick: function () { api({ op: 'set', kind: 'riskyThreshold', value: Number(threshold) }) },
            }, '保存'),
            React.createElement('span', { className: 'ag-set-item-meta' }, '满 ' + Number(threshold) + ' 次后第 ' + (Number(threshold) + 1) + ' 次起自动'),
          ),
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

        // ---- 学习状态（⑤ 学习沉淀） ----
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, '⑤ 学习沉淀'),
              '正在学习'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '中立操作人工确认制：同一「工具|模式|类别」每确认一次计数 +1，确认满 ' + cfg.riskyThreshold + ' 次后，第 ' + (cfg.riskyThreshold + 1) + ' 次起自动放行并沉淀规则。若学习有误可终止（删除计数与样本）。')),
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

        // ---- 自动学习（⑥ 会话记忆 / 晋升 / 毕业 / 自学习） ----
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, '⑥ 自动学习'),
              '会话记忆 · 晋升 · 毕业 · 自学习'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '零点击学习参数：人工批准过的同操作本会话直放；同类累计后自动沉淀；自学习可直接从 Flash SAFE 判定毕业。信任目录与毕业进度在 ⑦ 规则库管理。')),
          !cfg.onboarded
            ? React.createElement('div', { className: 'ag-alert' },
                React.createElement('div', { className: 'ag-alert-title' }, '自动学习默认是保守的'),
                React.createElement('div', { className: 'ag-alert-text' },
                  '会话记忆 / 跨会话晋升 / 签名毕业已默认开启（都基于你的人工批准）；自学习默认关闭（会从 Flash 判定自学）。可以保持推荐，也可以现在开启更激进的自学习。'),
                React.createElement('div', { className: 'ag-set-row' },
                  React.createElement('button', {
                    type: 'button', className: 'ag-set-btn ag-btn-xs',
                    onClick: function () { api({ op: 'set', kind: 'onboarded', value: true }) },
                  }, '保持推荐（保守）'),
                  React.createElement('button', {
                    type: 'button', className: 'ag-set-btn ag-btn-xs',
                    onClick: function () { api({ op: 'set', kind: 'selfLearn', value: true }); api({ op: 'set', kind: 'onboarded', value: true }) },
                  }, '开启自学习（激进）'),
                ),
              )
            : null,
          React.createElement('div', { className: 'ag-set-group' },
            field('会话记忆',
              React.createElement('button', { type: 'button', className: 'ag-set-btn ag-btn-xs', disabled: busy, onClick: function () { api({ op: 'set', kind: 'sessionMemory', value: !(cfg.sessionMemory !== false) }) } }, cfg.sessionMemory !== false ? '开' : '关'),
              '本会话人工批准过的同操作直接放行'),
            field('两段式判定',
              React.createElement('button', { type: 'button', className: 'ag-set-btn ag-btn-xs', disabled: busy, onClick: function () { api({ op: 'set', kind: 'twoStage', value: !(cfg.twoStage === true) }) } }, cfg.twoStage === true ? '开' : '关'),
              '快筛 + 复评；当前快筛模型偏保守，默认关'),
            field('自学习',
              React.createElement('button', { type: 'button', className: 'ag-set-btn ag-btn-xs', disabled: busy, onClick: function () { api({ op: 'set', kind: 'selfLearn', value: !(cfg.selfLearn === true) }) } }, cfg.selfLearn === true ? '开' : '关'),
              '从 Flash 连续 SAFE 判定毕业（无人工确认）'),
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
              '连续 SAFE 判定次数'),
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

        // ---- 规则库（⑦ 统一管理） ----
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, '⑦ 规则库'),
              '统一管理 · 白名单 / 永久人工 / 信任目录 / 毕业进度'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '查看所有生效规则的来源、命中与状态；支持搜索、启停、删除、导出与证据。')),
          React.createElement('div', { className: 'ag-set-toolbar' },
            React.createElement('div', { className: 'ag-set-seg' },
              [['allow', '白名单', (cfg.allowRules || []).length], ['deny', '永久人工', (cfg.denyRules || []).length], ['trust', '信任目录', (cfg.trustRoots || []).length], ['graduation', '毕业进度', (snapshot.graduation || []).length]].map(function (tab) {
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
              const rules = (cfg.allowRules || []).filter(function (r) { return hit([r.tool, r.mode, r.category, r.contains, r.description, r.signature].join(' ')) })
              if (rules.length === 0) return empty('没有匹配的白名单规则')
              return React.createElement('div', { className: 'ag-set-list' }, rules.map(function (rule, idx) {
                const parts = []
                if (rule.tool) parts.push('tool=' + rule.tool)
                if (rule.mode) parts.push('mode=' + rule.mode)
                if (rule.category) parts.push('category=' + rule.category)
                if (rule.contains) parts.push('contains=' + rule.contains)
                if (rule.signature) parts.push('sig=' + String(rule.signature).split('|').slice(2).join('|'))
                const actions = []
                if (rule.evidenceEventId) actions.push(React.createElement('button', { key: 'e', type: 'button', className: 'ag-set-btn ag-btn-xs', title: '复制触发该规则的事件 ID', onClick: function () { copyText(rule.evidenceEventId) } }, '证据 #' + rule.evidenceEventId))
                actions.push(React.createElement('button', { key: 't', type: 'button', className: 'ag-set-btn ag-btn-xs', onClick: function () { api({ op: 'toggle', kind: 'allowRules', value: { tool: rule.tool, mode: rule.mode, category: rule.category, contains: rule.contains, signature: rule.signature } }) } }, rule.disabled ? '启用' : '停用'))
                actions.push(React.createElement('button', { key: 'd', type: 'button', className: 'ag-set-item-del ag-icon-btn', title: '删除', 'aria-label': '删除规则', onClick: function () { api({ op: 'remove', kind: 'allowRules', value: { tool: rule.tool, mode: rule.mode, category: rule.category, contains: rule.contains, signature: rule.signature } }) } }, '✕'))
                const tags = [RULE_SOURCE_TAGS[ruleSource(rule)] || RULE_SOURCE_TAGS.default]
                if (rule.disabled) tags.push(React.createElement('span', { key: 'x', className: 'ag-set-tag ag-set-tag-gray' }, '已停用'))
                tags.push(React.createElement('span', { key: 'h', className: 'ag-set-item-meta' }, '命中 ' + (rule.hitCount || 0) + ' 次' + (rule.lastHit ? ' · 最近 ' + new Date(rule.lastHit).toLocaleString() : '')))
                return ruleItem('lib-a-' + idx, parts.join('  ') || '(任意)', rule.description || '', tags, actions)
              }))
            }
            if (libTab === 'deny') {
              const rules = (cfg.denyRules || []).filter(function (r) { return hit([r.tool, r.mode, r.category, r.contains, r.description].join(' ')) })
              if (rules.length === 0) return empty('没有匹配的永久人工规则')
              return React.createElement('div', { className: 'ag-set-list' }, rules.map(function (rule, idx) {
                const parts = []
                if (rule.tool) parts.push('tool=' + rule.tool)
                if (rule.mode) parts.push('mode=' + rule.mode)
                if (rule.category) parts.push('category=' + rule.category)
                if (rule.contains) parts.push('contains=' + rule.contains)
                const actions = [
                  React.createElement('button', { key: 't', type: 'button', className: 'ag-set-btn ag-btn-xs', onClick: function () { api({ op: 'toggle', kind: 'denyRules', value: { tool: rule.tool, mode: rule.mode, category: rule.category, contains: rule.contains } }) } }, rule.disabled ? '启用' : '停用'),
                  React.createElement('button', { key: 'd', type: 'button', className: 'ag-set-item-del ag-icon-btn', title: '删除', 'aria-label': '删除规则', onClick: function () { api({ op: 'remove', kind: 'denyRules', value: { tool: rule.tool, mode: rule.mode, category: rule.category, contains: rule.contains } }) } }, '✕'),
                ]
                const tags = [rule.disabled ? React.createElement('span', { key: 'x', className: 'ag-set-tag ag-set-tag-gray' }, '已停用') : null].filter(Boolean)
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
              return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, addRow, list)
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
          styleEl.setAttribute('data-plugin-css', 'dsh-approval-gate')
          styleEl.textContent = CSS
          document.head.appendChild(styleEl)
        } catch (e) {
          console.error('[dsh-approval-gate] 注入样式失败：' + String((e && e.message) || e))
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

        // 设置页：自动审批规则管理（settings.section）
        slots.inject('settings.section', function () {
          return slots.register(
            { name: 'settings.section', id: 'dsh-approval-gate.settings', order: 60, label: '自动审批' },
            function (props) { return React.createElement(RulesSettings, { slotsProps: props }) },
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
