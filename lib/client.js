/**
 * dsh-security-doctor — client half.
 *
 * Hand-written bundle in the exact wire format the DSH web shell expects:
 * a CJS factory handed to window.__ModuleLoader__.load({ id, factory }),
 * with platform modules (react) resolved through the injected require.
 *
 * Registers the "安全体检" button in the sidebar.footer.action slot. A click
 * fetches GET /dsh-security-doctor/check and renders the report in a modal
 * overlay: verdict line, severity chips, per-check detail and advice. Esc or
 * a backdrop click closes the modal.
 */
window.__ModuleLoader__.load({
  id: 'dsh-security-doctor',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var inject = ['slots'];

    var SEVERITY_LABEL = { high: '高危', medium: '关注', low: '建议', info: '说明', error: '检查失败' };
    var SEVERITY_CHIP = {
      high: 'dsd-chip dsd-chip--high', medium: 'dsd-chip dsd-chip--medium',
      low: 'dsd-chip dsd-chip--low', info: 'dsd-chip dsd-chip--info',
      error: 'dsd-chip dsd-chip--error'
    };

    function apply(ctx) {
      // ── stylesheet (package-owned, cleaned up on teardown) ──
      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {};
        var existing = document.querySelector('style[data-dsh-security-doctor-css]');
        if (existing !== null) return () => {};
        var tag = document.createElement('style');
        tag.dataset.dshSecurityDoctorCss = '1';
        tag.textContent = [
          '.dsd-btn{flex:none;align-items:center;width:100%;height:49px;color:var(--dsw-alias-label-primary);cursor:pointer;background:transparent;border:none;border-radius:12px;gap:8px;padding:0 8px 0 6px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden;position:relative}',
          '.dsd-btn:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.dsd-btn--running{color:var(--dsw-alias-label-secondary);cursor:progress}',
          '.dsd-btn--rail{width:36px;height:36px;border-radius:50%;justify-content:center;gap:0;padding:0}',
          '.dsd-btn__label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}',
          '.dsd-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px}',
          '.dsd-modal{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);width:min(760px,100%);max-height:85vh;display:flex;flex-direction:column;overflow:hidden}',
          '.dsd-modal__header{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--dsw-alias-label-tertiary,#e5e7eb);flex:none}',
          '.dsd-modal__title{font-size:16px;font-weight:600;margin:0;flex:1;min-width:0}',
          '.dsd-modal__close{flex:none;border:none;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:20px;line-height:1;padding:4px 8px;border-radius:8px}',
          '.dsd-modal__close:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.dsd-modal__body{overflow:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px}',
          '.dsd-modal__footer{flex:none;padding:12px 20px;border-top:1px solid var(--dsw-alias-label-tertiary,#e5e7eb);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
          '.dsd-verdict{font-size:15px;font-weight:600;margin:0}',
          '.dsd-counts{display:flex;gap:8px;flex-wrap:wrap}',
          '.dsd-chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}',
          '.dsd-chip--high{background:#fee2e2;color:#b91c1c}',
          '.dsd-chip--medium{background:#fef3c7;color:#b45309}',
          '.dsd-chip--low{background:#dbeafe;color:#1d4ed8}',
          '.dsd-chip--info{background:#f3f4f6;color:#4b5563}',
          '.dsd-chip--error{background:#f3e8ff;color:#7e22ce}',
          '.dsd-chip--pass{background:#dcfce7;color:#15803d}',
          '.dsd-check{border:1px solid var(--dsw-alias-label-tertiary,#e5e7eb);border-radius:12px;padding:12px 14px}',
          '.dsd-check__head{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
          '.dsd-check__title{font-size:14px;font-weight:600;flex:1;min-width:0}',
          '.dsd-check__detail{font-size:13px;line-height:20px;white-space:pre-wrap;word-break:break-word;margin:0;font-family:inherit}',
          '.dsd-check__advice{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin:6px 0 0;padding-top:6px;border-top:1px dashed var(--dsw-alias-label-tertiary,#e5e7eb)}',
          '.dsd-rerun{flex:none;border:1px solid var(--dsw-alias-label-tertiary,#e5e7eb);background:transparent;color:var(--dsw-alias-label-primary);border-radius:10px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:inherit}',
          '.dsd-rerun:hover{background:var(--dsw-alias-bg-layer-2)}'
        ].join('\n');
        document.head.appendChild(tag);
        return () => { tag.remove(); };
      }, 'dsh-security-doctor: stylesheet');

      // ── report modal (rendered while open) ──
      function ReportModal(props) {
        var report = props.report;
        var onClose = props.onClose;
        var onRerun = props.onRerun;
        var running = props.running;

        React.useEffect(function () {
          var onKey = function (e) { if (e.key === 'Escape') onClose(); };
          window.addEventListener('keydown', onKey);
          return function () { window.removeEventListener('keydown', onKey); };
        }, [onClose]);

        var counts = report
          ? [['high', '高危', report.summary.high], ['medium', '关注', report.summary.medium],
             ['low', '建议', report.summary.low], ['info', '说明', report.summary.info],
             ['error', '失败', report.summary.error]]
            .filter(function (c) { return c[2] > 0; })
          : [];

        return React.createElement('div', { className: 'dsd-overlay', onClick: onClose }, [
          React.createElement('div', {
            key: 'modal', className: 'dsd-modal',
            onClick: function (e) { e.stopPropagation(); }
          }, [
            React.createElement('div', { key: 'header', className: 'dsd-modal__header' }, [
              React.createElement('h2', { key: 't', className: 'dsd-modal__title' }, '🛡 安全体检报告'),
              React.createElement('button', {
                key: 'rerun', type: 'button', className: 'dsd-rerun',
                onClick: onRerun, disabled: running
              }, running ? '检测中…' : '重新检测'),
              React.createElement('button', {
                key: 'x', type: 'button', className: 'dsd-modal__close',
                onClick: onClose, 'aria-label': '关闭'
              }, '✕')
            ]),
            React.createElement('div', { key: 'body', className: 'dsd-modal__body' },
              report ? [].concat(
                [React.createElement('p', { key: 'verdict', className: 'dsd-verdict' }, report.verdict)],
                counts.length > 0
                  ? [React.createElement('div', { key: 'counts', className: 'dsd-counts' },
                      counts.map(function (c) {
                        return React.createElement('span', {
                          key: c[0], className: SEVERITY_CHIP[c[0]]
                        }, c[1] + ' × ' + c[2]);
                      }))]
                  : [],
                report.checks.map(function (check) {
                  return React.createElement('div', { key: check.id, className: 'dsd-check' }, [
                    React.createElement('div', { key: 'head', className: 'dsd-check__head' }, [
                      React.createElement('span', {
                        key: 'chip',
                        className: check.status === 'pass' ? 'dsd-chip dsd-chip--pass' : SEVERITY_CHIP[check.severity]
                      }, check.status === 'pass' ? '通过' : SEVERITY_LABEL[check.severity] || check.severity),
                      React.createElement('span', { key: 'title', className: 'dsd-check__title' }, check.title)
                    ]),
                    React.createElement('p', { key: 'detail', className: 'dsd-check__detail' }, check.detail),
                    React.createElement('p', { key: 'advice', className: 'dsd-check__advice' }, '建议：' + check.advice)
                  ]);
                })
              ) : [React.createElement('p', { key: 'wait', className: 'dsd-verdict' },
                   running ? '正在检测本机 DSH 环境…' : '尚未取得报告，点击"重新检测"。')]
            ),
            React.createElement('div', { key: 'footer', className: 'dsd-modal__footer' },
              (report ? '生成于 ' + new Date(report.generatedAt).toLocaleString() + ' · ' : '') +
              '尽力检测（best-effort），"未见异常"不等于绝对安全；深度检测请配合仓库 docs/ 下的《安全检测指南》。本插件只读、不外发数据。')
          ])
        ]);
      }

      // ── sidebar footer button ──
      ctx.effect(() => {
        var disposeSlot = ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'security-doctor',
          order: 20,
          label: () => '安全体检'
        }, (props) => {
          var wide = props.wide;
          var phaseState = React.useState('idle'); // 'idle' | 'running' | 'open' | 'error'
          var phase = phaseState[0];
          var setPhase = phaseState[1];
          var reportState = React.useState(null);
          var report = reportState[0];
          var setReport = reportState[1];
          var errMsgState = React.useState('');
          var errMsg = errMsgState[0];
          var setErrMsg = errMsgState[1];

          var run = function () {
            setPhase('running');
            fetch('/dsh-security-doctor/check', { method: 'GET' })
              .then(function (res) { return res.json(); })
              .then(function (data) {
                if (!data || !data.ok || !data.report) throw new Error((data && data.message) || '检查路由返回异常');
                setReport(data.report);
                setPhase('open');
              })
              .catch(function (err) {
                setErrMsg(String((err && err.message) || err));
                setPhase('error');
              });
          };

          var click = function () {
            if (phase === 'running') return;
            if (phase === 'open') { setPhase('idle'); return; }
            run();
          };

          var close = function () { setPhase('idle'); };
          var label = phase === 'running' ? '体检中…'
            : phase === 'error' ? '体检失败'
            : phase === 'open' ? '查看体检报告'
            : '安全体检';
          var title = phase === 'error' ? errMsg
            : phase === 'open' ? '报告已打开，再次点击关闭'
            : '对本机 DSH 环境做只读安全体检';

          var children = [
            React.createElement('svg', {
              key: 'icon', width: 14, height: 14, viewBox: '0 0 24 24',
              fill: 'none', stroke: 'currentColor', strokeWidth: 2,
              strokeLinecap: 'round', strokeLinejoin: 'round'
            }, [
              React.createElement('path', { key: 'a', d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' })
            ]),
            wide && React.createElement('span', { key: 'l', className: 'dsd-btn__label' }, label)
          ];
          if (phase === 'open') {
            children.push(React.createElement(ReportModal, {
              key: 'modal', report: report, onClose: close, onRerun: run, running: false
            }));
          }

          return React.createElement('button', {
            type: 'button',
            className: 'dsd-btn' + (wide ? '' : ' dsd-btn--rail') + (phase === 'running' ? ' dsd-btn--running' : ''),
            onClick: click,
            title: title,
            'aria-label': '安全体检',
            disabled: phase === 'running'
          }, children);
        }));
        return () => disposeSlot();
      }, 'dsh-security-doctor: footer action');
    }

    module.exports = { apply: apply, inject: inject };
    return module.exports;
  }
});
