/**
 * dsh-security-doctor — client half (v0.3).
 *
 * Hand-written bundle in the exact wire format the DSH web shell expects:
 * a CJS factory handed to window.__ModuleLoader__.load({ id, factory }),
 * with platform modules (react) resolved through the injected require.
 *
 * Sidebar footer "安全体检" button. On mount it runs the checkup once and
 * shows a red badge while any high-severity finding is unacknowledged. The
 * modal renders findings sorted high→medium→low→info with a11y dialog
 * semantics, last-run diff, instruction-file hash comparison, per-item and
 * all-in-one repair "prescriptions" (markdown the user pastes into a NEW
 * session — the plugin itself stays read-only), copy-markdown and
 * export-json. UI chrome strings are zh/en; report bodies are zh.
 *
 * v0.3 versioning: the report footer shows which plugin version produced it
 * (report.pluginVersion, V3), and a manual "check update" button queries the
 * latest GitHub release — the plugin's ONLY egress, one request, fired only
 * on an explicit user click (V4). No automatic/background update checks.
 */
window.__ModuleLoader__.load({
  id: 'dsh-security-doctor',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var inject = ['slots'];

    var STR = {
      zh: {
        button: '安全体检', running: '体检中…', failed: '体检失败', viewReport: '查看体检报告',
        title: '🛡 安全体检报告', rerun: '重新检测', rerunning: '检测中…', close: '关闭',
        errorTitle: '🛡 体检未完成', retry: '重试',
        pass: '通过', high: '高危', medium: '关注', low: '建议', info: '说明', error: '检查失败',
        advice: '建议：', expand: '展开全部', collapse: '收起',
        copyMd: '复制 Markdown', exportJson: '导出 JSON', rxAll: '一键生成全部处方', rx: '处方',
        copied: '已复制到剪贴板', copyFailed: '复制失败',
        footer: '尽力检测（best-effort），"未见异常"不等于绝对安全；深度检测请配合仓库 docs/ 下的《安全检测指南》。本插件只读；唯一外发是你手动点「检查更新」时查询 GitHub 的一次请求。',
        generatedAt: '生成于', lastTime: '上次', thisTime: '本次', newFindings: '新增命中', resolved: '已消失',
        firstRun: '首次体检（下次体检将显示变化趋势）',
        instrChanged: '与上次体检相比变更', instrNew: '上次体检后新增', instrSame: '与上次一致', instrNoSnap: '（本工作区首次记录，下次体检开始比对）',
        prescriptionNote: '处方单仅供粘贴到新会话执行；插件自身不修改任何文件。',
        pluginVer: '插件', checkUpdate: '检查更新',
        checkUpdateNote: '点击后浏览器会向 api.github.com 查询本插件最新 Release——这是本插件唯一的显式外发（仅此一次请求、只读版本信息、默认不发送）。',
        checking: '查询中…', upToDate: '已是最新版本', newVersion: '有新版', updateHow: '更新步骤见 README「更新」一节', updateFailed: '检查更新失败（网络或 GitHub 不可达）',
      },
      en: {
        button: 'Security checkup', running: 'Checking…', failed: 'Checkup failed', viewReport: 'View report',
        title: '🛡 Security checkup report', rerun: 'Re-run', rerunning: 'Checking…', close: 'Close',
        errorTitle: '🛡 Checkup incomplete', retry: 'Retry',
        pass: 'pass', high: 'high', medium: 'attention', low: 'suggestion', info: 'info', error: 'error',
        advice: 'Advice: ', expand: 'Expand all', collapse: 'Collapse',
        copyMd: 'Copy Markdown', exportJson: 'Export JSON', rxAll: 'All prescriptions', rx: 'Fix',
        copied: 'Copied to clipboard', copyFailed: 'Copy failed',
        footer: 'Best-effort detection: "no findings" is not "safe". Deep review: see the security-review guide in the repo docs. Read-only plugin; the only egress is a single GitHub query when you click "Check update" yourself.',
        generatedAt: 'Generated at', lastTime: 'Last', thisTime: 'This run', newFindings: 'New findings', resolved: 'Resolved',
        firstRun: 'First checkup (trend vs last run appears next time)',
        instrChanged: 'changed since last checkup', instrNew: 'added since last checkup', instrSame: 'unchanged', instrNoSnap: '(first snapshot for this workspace; diff starts next run)',
        prescriptionNote: 'Prescriptions are meant to paste into a NEW session; the plugin itself never modifies files.',
        pluginVer: 'plugin', checkUpdate: 'Check update',
        checkUpdateNote: 'On click the browser queries api.github.com for this plugin\u2019s latest release — the plugin\u2019s only explicit egress (one request, version info only, nothing sent by default).',
        checking: 'Checking…', upToDate: 'Up to date', newVersion: 'Update available', updateHow: 'Update steps: see the "Update" section in README', updateFailed: 'Update check failed (network or GitHub unreachable)',
      },
    };
    var lang = (typeof navigator !== 'undefined' && String(navigator.language || '').toLowerCase().indexOf('zh') === 0) ? 'zh' : 'en';
    var t = function (k) { return (STR[lang][k] !== undefined ? STR[lang][k] : STR.zh[k]); };

    var SEVERITY_LABEL = { high: t('high'), medium: t('medium'), low: t('low'), info: t('info'), error: t('error') };
    var SEVERITY_ORDER = { high: 0, error: 1, medium: 2, low: 3, info: 4 };
    var SEVERITY_COLOR = {
      high: 'var(--dsw-alias-state-error-primary, #ef4444)',
      medium: 'var(--dsw-alias-state-warning-primary, #f59e0b)',
      low: 'var(--dsw-alias-state-info-primary, #3b82f6)',
      info: 'var(--dsw-alias-label-secondary, #6b7280)',
      error: '#a855f7',
    };
    var SEVERITY_BG = {
      high: 'rgba(239,68,68,.14)', medium: 'rgba(245,158,11,.14)',
      low: 'rgba(59,130,246,.14)', info: 'rgba(107,114,128,.14)', error: 'rgba(168,85,247,.14)',
    };

    // V4: the plugin's only outbound URL — fetched solely inside the manual
    // "check update" click handler, never on mount, never in the background.
    var RELEASE_API = 'https://api.github.com/repos/ChenChen913/dsh-security-doctor/releases/latest';

    /** 'v1.2.3' / '1.2.3' → [1,2,3]; anything else → null. */
    function verNum(v) {
      var m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v == null ? '' : v));
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    }
    function verLt(a, b) {
      for (var i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0) }
      return false;
    }

    function lsGet(key, fallback) {
      try { var raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback }
      catch { return fallback }
    }
    function lsSet(key, value) {
      try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode — history is best-effort */ }
    }

    function loadHistory() { return lsGet('dsd.history', []) }
    function saveHistory(entry) {
      var h = loadHistory();
      h.unshift(entry);
      lsSet('dsd.history', h.slice(0, 10));
    }

    /** Diff this run against the previous stored run. */
    function diffLastRun(report) {
      var prev = loadHistory()[0];
      if (!prev) return null;
      var curIds = report.checks.filter(function (c) { return c.status === 'finding' }).map(function (c) { return c.id });
      var prevIds = prev.findingIds || [];
      var added = curIds.filter(function (id) { return prevIds.indexOf(id) === -1 });
      var gone = prevIds.filter(function (id) { return curIds.indexOf(id) === -1 });
      return { prev: prev, added: added, gone: gone };
    }

    function instrSnapshotKey(workspace) { return 'dsd.instr.' + String(workspace).replace(/[^A-Za-z0-9._-]+/g, '_') }
    function compareInstrSnapshots(report) {
      var check = report.checks.filter(function (c) { return c.id === 'instruction-files' })[0];
      if (!check || !check.extra || !Array.isArray(check.extra.files)) return null;
      var key = instrSnapshotKey(check.extra.workspace || report.workspace);
      var prev = lsGet(key, null);
      var out = { key: key, files: [] };
      for (var i = 0; i < check.extra.files.length; i++) {
        var f = check.extra.files[i];
        var old = prev && prev[f.name];
        out.files.push({ name: f.name, state: !prev || !prev[f.name] ? 'new-snap' : (old === f.sha256 ? 'same' : 'changed') });
      }
      var snap = {};
      for (var j = 0; j < check.extra.files.length; j++) snap[check.extra.files[j].name] = check.extra.files[j].sha256;
      lsSet(key, snap);
      return out;
    }

    function severityOf(check) { return check.status === 'pass' ? 'info' : check.severity }
    function sortChecks(checks) {
      return checks.slice().sort(function (a, b) {
        var ap = a.status === 'pass' ? 1 : 0, bp = b.status === 'pass' ? 1 : 0;
        if (ap !== bp) return ap - bp;
        return (SEVERITY_ORDER[severityOf(a)] ?? 9) - (SEVERITY_ORDER[severityOf(b)] ?? 9);
      });
    }

    function renderMarkdown(report) {
      var lines = ['# DSH 安全体检报告', '', '> ' + report.verdict, '', '- 生成时间: ' + report.generatedAt,
        '- 生成插件: dsh-security-doctor' + (report.pluginVersion ? ' v' + report.pluginVersion : ''),
        '- 高危 ' + report.summary.high + ' / 关注 ' + report.summary.medium + ' / 建议 ' + report.summary.low + ' / 说明 ' + report.summary.info + ' / 失败 ' + report.summary.error, ''];
      for (var i = 0; i < report.checks.length; i++) {
        var c = report.checks[i];
        lines.push('## ' + c.title + '（' + (c.status === 'pass' ? '通过' : SEVERITY_LABEL[c.severity] || c.severity) + '）');
        lines.push('', c.detail, '');
        if (c.status !== 'pass') lines.push('**建议**: ' + c.advice, '');
      }
      lines.push('---', '', '尽力检测（best-effort）；由 dsh-security-doctor' + (report.pluginVersion ? ' v' + report.pluginVersion : '') + ' 生成。');
      return lines.join('\n');
    }

    var RX_STEPS = {
      'js-directives': ['打开报告中列出的每个文件与行号', '确认每处 !!js 的来源与作用；不认识的注释掉该行', '重启 dsh web 后重新体检确认消失'],
      'third-party-plugins': ['对每个外来插件决定：保留（按《安全检测指南》审查并锁定版本）/ 移除（dsh plugin --profile web remove <包名>）', '未锁定的 git 引用改为 #<tag 或 sha> 锁定', '携带安装脚本的包优先在隔离环境评估'],
      'credentials-file': ['POSIX：chmod 600 <凭据文件路径>', 'Windows：文件属性 → 安全 → 移除 Users/Everyone 等宽泛账户', '完成后重新体检确认'],
      'instruction-files': ['对"新增/变更"的指令文件做 git diff 或人工比对', '来源不明的新指令整段删除', '高敏感工作区考虑切到 read-only 预设'],
      'external-endpoints': ['逐一确认列出的 baseURL 指向官方/预期域名', '来历不明的端点先注释再重启验证'],
      'security-services': ['审批策略改回 ask（设置 → 插件配置 → Shell）', '权限预设改回 workspace-write 或 read-only', '重启后重新体检确认'],
      'plugin-egress': ['对含不明域名的插件按《安全检测指南》T5 深查', '确认域名与插件 README 声明一致，否则移除该插件'],
    };

    function prescriptionFor(check, home) {
      var steps = RX_STEPS[check.id] || [check.advice];
      var out = ['### 处方：' + check.title + '（' + (SEVERITY_LABEL[check.severity] || check.severity) + '）', '',
        '证据：', '```', String(check.detail).slice(0, 2000), '```', '', '步骤：'];
      for (var i = 0; i < steps.length; i++) out.push(String(i + 1) + '. ' + steps[i]);
      out.push('');
      return out.join('\n');
    }

    function buildPrescription(report, only) {
      var checks = report.checks.filter(function (c) { return c.status === 'finding' && (!only || c.id === only); });
      var head = ['# DSH 安全体检处方单', '',
        '- 生成时间: ' + report.generatedAt,
        '- harness 主目录: ' + report.home,
        '- 执行建议：新开一个会话执行本处方单；工作区选择空目录并使用 read-only 预设；所有路径均为绝对路径；涉及文件与命令的每一步都逐项审批，不要一键全跑。',
        '- 完成后回到原会话点击"重新检测"复检。', ''];
      var body = checks.map(function (c) { return prescriptionFor(c, report.home) }).join('\n');
      return head.join('\n') + '\n' + body;
    }

    function copyText(text, onDone) {
      var done = function (ok) { onDone && onDone(ok) };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true) }, function () { done(legacyCopy(text)) });
      } else done(legacyCopy(text));
    }
    function legacyCopy(text) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy');
        ta.remove(); return ok;
      } catch { return false }
    }

    function downloadJson(report) {
      try {
        var blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'dsh-security-doctor-' + report.generatedAt.replace(/[:.]/g, '-') + '.json';
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove() }, 0);
      } catch (e) { console.warn('[dsh-security-doctor] export failed', e) }
    }

    /** Split a detail line into text/path tokens; path tokens become copyable code chips. */
    var PATH_RE = /([A-Za-z]:\\[^\s:，。;；]+|[~/][^\s:，。;；]+|(?:[\w.-]+\/){2,}[\w.-]+)/g;
    function renderDetailLine(line, key) {
      var parts = String(line).split(PATH_RE);
      var children = [];
      for (let i = 0; i < parts.length; i++) {
        const token = parts[i]
        if (token === undefined || token === '') continue
        if (i % 2 === 1) {
          children.push(React.createElement('code', {
            key: key + '-' + i, className: 'dsd-path', title: token,
            onClick: function (e) {
              copyText(token)
              var el = e.currentTarget
              el.classList.add('dsd-path--copied')
              setTimeout(function () { el.classList.remove('dsd-path--copied') }, 900)
            }
          }, token))
        } else {
          children.push(React.createElement('span', { key: key + '-' + i }, token))
        }
      }
      return children;
    }

    function CheckCard(props) {
      var check = props.check;
      var instr = props.instrDiff && props.instrDiff.files
        ? props.instrDiff.files.filter(function (f) { return f.name && check.detail.indexOf(f.name) !== -1 })
        : [];
      var lines = String(check.detail).split('\n');
      var expandedState = React.useState(false);
      var expanded = expandedState[0];
      var setExpanded = expandedState[1];
      var longList = lines.length > 8;
      var shown = longList && !expanded ? lines.slice(0, 8) : lines;
      var sev = severityOf(check);
      var chipClass = check.status === 'pass' ? 'dsd-chip dsd-chip--pass' : 'dsd-chip';
      var chipStyle = check.status === 'pass' ? undefined : { background: SEVERITY_BG[sev], color: SEVERITY_COLOR[sev] };

      var listItems = shown.map(function (line, i) {
        return React.createElement('li', { key: 'l' + i, className: 'dsd-check__line' }, renderDetailLine(line, 'l' + i));
      });
      var instrNotes = instr.length > 0 && props.instrDiff
        ? [React.createElement('p', { key: 'instr', className: 'dsd-check__instr' },
            props.instrDiff.firstSnap ? t('instrNoSnap') :
            instr.map(function (f) { return f.name + ': ' + (f.state === 'same' ? t('instrSame') : f.state === 'changed' ? '⚠ ' + t('instrChanged') : '⚠ ' + t('instrNew')) }).join('；'))]
        : [];

      var headChildren = [
        React.createElement('span', { key: 'chip', className: chipClass, style: chipStyle },
          check.status === 'pass' ? t('pass') : (SEVERITY_LABEL[check.severity] || check.severity)),
        React.createElement('span', { key: 'title', className: 'dsd-check__title' }, check.title),
      ];
      if (check.status === 'finding' && RX_STEPS[check.id]) {
        headChildren.push(React.createElement('button', {
          key: 'rx', type: 'button', className: 'dsd-mini', onClick: function () {
            copyText(prescriptionFor(check), function (ok) { console.info('[dsh-security-doctor] prescription copied:', ok) });
          }, title: t('prescriptionNote')
        }, '📋 ' + t('rx')));
      }

      return React.createElement('div', {
        className: 'dsd-check' + (check.status !== 'pass' && sev === 'high' ? ' dsd-check--high' : '')
      }, [
        React.createElement('div', { key: 'head', className: 'dsd-check__head' }, headChildren),
        React.createElement('ul', { key: 'detail', className: 'dsd-check__list' }, listItems),
      ].concat(instrNotes, [
        longList ? React.createElement('button', {
          key: 'toggle', type: 'button', className: 'dsd-mini', onClick: function () { setExpanded(!expanded) }
        }, expanded ? t('collapse') : t('expand') + '（' + lines.length + '）') : null,
        check.status !== 'pass' ? React.createElement('p', { key: 'advice', className: 'dsd-check__advice' }, t('advice') + check.advice) : null,
      ]));
    }

    function ReportModal(props) {
      var report = props.report;
      var onClose = props.onClose;
      var onRerun = props.onRerun;
      var running = props.running;
      var errMsg = props.errMsg;
      var dialogRef = React.useRef(null);
      var prevFocus = React.useRef(null);
      var toastState = React.useState('');
      var toast = toastState[0];
      var setToast = toastState[1];
      // V4 manual update check: null until the user clicks; then
      // {status:'checking'} → {status:'done', latest, newer} | {status:'error'}
      var updateState = React.useState(null);
      var update = updateState[0];
      var setUpdate = updateState[1];

      var trend = report ? diffLastRun(report) : null;
      var instrDiff = report ? compareInstrSnapshots(report) : null;
      if (instrDiff) instrDiff.firstSnap = instrDiff.files.length > 0 && instrDiff.files.every(function (f) { return f.state === 'new-snap' });

      var flashToast = function (ok) {
        setToast(ok ? t('copied') : t('copyFailed'));
        setTimeout(function () { setToast('') }, 1400);
      };

      // The ONLY outbound request in the whole plugin — and it runs only here,
      // behind a user click (V4). Default behaviour stays zero-egress.
      var checkUpdate = function () {
        if (update && update.status === 'checking') return;
        setUpdate({ status: 'checking' });
        fetch(RELEASE_API, { headers: { accept: 'application/vnd.github+json' } })
          .then(function (res) {
            if (!res.ok) throw new Error('GitHub API HTTP ' + res.status)
            return res.json()
          })
          .then(function (rel) {
            var latest = rel && typeof rel.tag_name === 'string' ? rel.tag_name : null;
            var cur = report && verNum(report.pluginVersion);
            var lat = verNum(latest);
            setUpdate({ status: 'done', latest: latest, newer: Boolean(cur && lat && verLt(cur, lat)) });
            // V8: hand the fetched tag to the host self-test so a curl rerun
            // shows current AND latest side by side (localhost echo only)
            if (lat) fetch('/dsh-security-doctor/self-test?latest=' + encodeURIComponent(latest), { headers: { 'x-dsh-security-doctor': '1' } })
              .then(function () {}, function () {});
          })
          .catch(function () { setUpdate({ status: 'error' }) });
      };

      var updateNote = null;
      if (update && update.status === 'done' && report && report.pluginVersion) {
        updateNote = update.newer
          ? '↑ ' + t('newVersion') + '：' + update.latest + '（' + t('pluginVer') + ' v' + report.pluginVersion + '）— ' + t('updateHow')
          : '✓ ' + t('upToDate') + '（v' + report.pluginVersion + '）';
      } else if (update && update.status === 'error') {
        updateNote = '⚠ ' + t('updateFailed');
      }

      React.useEffect(function () {
        prevFocus.current = document.activeElement;
        var node = dialogRef.current;
        if (node) node.focus();
        var onKey = function (e) {
          if (e.key === 'Escape') { onClose(); return }
          if (e.key !== 'Tab' || !dialogRef.current) return;
          var focusables = dialogRef.current.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
          if (focusables.length === 0) return;
          var first = focusables[0], last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
        };
        window.addEventListener('keydown', onKey);
        return function () {
          window.removeEventListener('keydown', onKey);
          if (prevFocus.current && prevFocus.current.focus) prevFocus.current.focus();
        };
      }, [onClose]);

      var counts = report
        ? [['high', SEVERITY_LABEL.high, report.summary.high], ['medium', SEVERITY_LABEL.medium, report.summary.medium],
           ['low', SEVERITY_LABEL.low, report.summary.low], ['info', SEVERITY_LABEL.info, report.summary.info],
           ['error', SEVERITY_LABEL.error, report.summary.error]]
          .filter(function (c) { return c[2] > 0; })
        : [];

      var sorted = report ? sortChecks(report.checks) : [];

      var bodyChildren = report ? [
        React.createElement('p', { key: 'verdict', className: 'dsd-verdict' }, report.verdict),
        counts.length > 0 ? React.createElement('div', { key: 'counts', className: 'dsd-counts' },
          counts.map(function (c) {
            return React.createElement('span', {
              key: c[0], className: 'dsd-chip', style: { background: SEVERITY_BG[c[0]], color: SEVERITY_COLOR[c[0]] }
            }, c[1] + ' × ' + c[2]);
          })) : null,
        trend ? React.createElement('p', { key: 'trend', className: 'dsd-trend' },
          t('lastTime') + '：' + new Date(trend.prev.generatedAt).toLocaleString() + '；'
          + t('newFindings') + (trend.added.length ? '：' + trend.added.join('、') : '：0') + '；'
          + t('resolved') + (trend.gone.length ? '：' + trend.gone.join('、') : '：0')) : React.createElement('p', { key: 'trend', className: 'dsd-trend' }, t('firstRun')),
      ].concat(sorted.map(function (check) {
        return React.createElement(CheckCard, {
          key: check.id, check: check, instrDiff: check.id === 'instruction-files' ? instrDiff : null
        });
      })) : [
        React.createElement('p', { key: 'err', className: 'dsd-verdict dsd-verdict--err' }, errMsg || t('failed')),
        React.createElement('button', { key: 'retry', type: 'button', className: 'dsd-rerun', onClick: onRerun }, t('retry')),
      ];

      return React.createElement('div', { className: 'dsd-overlay', onClick: onClose }, [
        React.createElement('div', {
          key: 'modal', ref: dialogRef, tabIndex: -1, role: 'dialog', 'aria-modal': 'true',
          'aria-labelledby': 'dsd-modal-title', className: 'dsd-modal', onClick: function (e) { e.stopPropagation() }
        }, [
          React.createElement('div', { key: 'header', className: 'dsd-modal__header' }, [
            React.createElement('h2', { key: 't', id: 'dsd-modal-title', className: 'dsd-modal__title' }, report ? t('title') : t('errorTitle')),
            toast ? React.createElement('span', { key: 'toast', className: 'dsd-toast' }, toast) : null,
            report ? React.createElement('button', {
              key: 'rx-all', type: 'button', className: 'dsd-rerun',
              onClick: function () { copyText(buildPrescription(report), flashToast) },
              title: t('prescriptionNote')
            }, '📋 ' + t('rxAll')) : null,
            report ? React.createElement('button', {
              key: 'rerun', type: 'button', className: 'dsd-rerun', onClick: onRerun, disabled: running, 'aria-busy': running
            }, running ? t('rerunning') : '↻ ' + t('rerun')) : null,
            React.createElement('button', {
              key: 'x', type: 'button', className: 'dsd-modal__close', onClick: onClose, 'aria-label': t('close')
            }, '✕'),
          ]),
          React.createElement('div', { key: 'body', className: 'dsd-modal__body' }, bodyChildren),
          report ? React.createElement('div', { key: 'footer', className: 'dsd-modal__footer' }, [
            React.createElement('div', { key: 'note' },
              t('generatedAt') + ' ' + new Date(report.generatedAt).toLocaleString()
              + (report.pluginVersion ? ' · ' + t('pluginVer') + ' v' + report.pluginVersion : '')
              + ' · ' + t('footer')),
            updateNote ? React.createElement('p', {
              key: 'updnote',
              className: 'dsd-upd' + (update && update.status === 'done' && !update.newer ? ' dsd-upd--ok' : '')
            }, updateNote) : null,
            React.createElement('div', { key: 'actions', className: 'dsd-modal__actions' }, [
              React.createElement('button', {
                key: 'upd', type: 'button', className: 'dsd-mini', onClick: checkUpdate,
                title: t('checkUpdateNote'), disabled: Boolean(update && update.status === 'checking')
              }, (update && update.status === 'checking') ? t('checking') : '⟳ ' + t('checkUpdate')),
              React.createElement('button', { key: 'md', type: 'button', className: 'dsd-mini', onClick: function () { copyText(renderMarkdown(report), flashToast) } }, t('copyMd')),
              React.createElement('button', { key: 'json', type: 'button', className: 'dsd-mini', onClick: function () { downloadJson(report) } }, t('exportJson')),
            ]),
          ]) : null,
        ]),
      ]);
    }

    function apply(ctx) {
      // ── stylesheet (package-owned, cleaned up on teardown; theme-adaptive via tokens + translucent severity tints) ──
      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {};
        var existing = document.querySelector('style[data-dsh-security-doctor-css]');
        if (existing !== null) return () => {};
        var tag = document.createElement('style');
        tag.dataset.dshSecurityDoctorCss = '1';
        tag.textContent = [
          '.dsd-btn{flex:none;align-items:center;width:100%;height:49px;color:var(--dsw-alias-label-primary);cursor:pointer;background:transparent;border:none;border-radius:12px;gap:8px;padding:0 8px 0 6px;font-family:inherit;font-size:14px;display:inline-flex;overflow:visible;position:relative}',
          '.dsd-btn:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.dsd-btn--running{color:var(--dsw-alias-label-secondary);cursor:progress}',
          '.dsd-btn--rail{width:36px;height:36px;border-radius:50%;justify-content:center;gap:0;padding:0}',
          '.dsd-btn__label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}',
          '.dsd-badge{position:absolute;top:2px;right:0;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 0 4px rgba(239,68,68,.5)}',
          '.dsd-spin{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:dsd-rot .8s linear infinite}',
          '@keyframes dsd-rot{to{transform:rotate(360deg)}}',
          '.dsd-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px}',
          '.dsd-modal{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);width:min(780px,100%);max-height:85vh;display:flex;flex-direction:column;overflow:hidden;outline:none}',
          '.dsd-modal__header{display:flex;align-items:center;gap:8px;padding:16px 20px;border-bottom:1px solid var(--dsw-alias-label-tertiary,#e5e7eb);flex:none;flex-wrap:wrap}',
          '.dsd-modal__title{font-size:16px;font-weight:600;margin:0;flex:1;min-width:0}',
          '.dsd-modal__close{flex:none;border:none;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:20px;line-height:1;padding:4px 8px;border-radius:8px}',
          '.dsd-modal__close:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.dsd-modal__body{overflow:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px}',
          '.dsd-modal__footer{flex:none;padding:12px 20px;border-top:1px solid var(--dsw-alias-label-tertiary,#e5e7eb);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;display:flex;flex-direction:column;gap:8px}',
          '.dsd-modal__actions{display:flex;gap:8px}',
          '.dsd-verdict{font-size:15px;font-weight:600;margin:0}',
          '.dsd-verdict--err{color:var(--dsw-alias-state-error-primary,#ef4444)}',
          '.dsd-trend{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0}',
          '.dsd-counts{display:flex;gap:8px;flex-wrap:wrap}',
          '.dsd-chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}',
          '.dsd-chip--pass{background:rgba(34,197,94,.14);color:var(--dsw-alias-state-success-primary,#16a34a)}',
          '.dsd-check{border:1px solid var(--dsw-alias-label-tertiary,#e5e7eb);border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-2,transparent)}',
          '.dsd-check--high{border-color:rgba(239,68,68,.55);background:rgba(239,68,68,.06)}',
          '.dsd-check__head{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}',
          '.dsd-check__title{font-size:14px;font-weight:600;flex:1;min-width:0}',
          '.dsd-check__list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}',
          '.dsd-check__line{font-size:13px;line-height:20px;word-break:break-word}',
          '.dsd-path{font-family:ui-monospace,Consolas,monospace;font-size:12px;padding:1px 5px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));cursor:pointer;border:1px dashed transparent}',
          '.dsd-path:hover{border-color:var(--dsw-alias-label-tertiary)}',
          '.dsd-path--copied{border-color:var(--dsw-alias-state-success-primary,#22c55e)}',
          '.dsd-check__instr{font-size:12px;color:var(--dsw-alias-label-secondary);margin:6px 0 0}',
          '.dsd-check__advice{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin:6px 0 0;padding-top:6px;border-top:1px dashed var(--dsw-alias-label-tertiary,#e5e7eb)}',
          '.dsd-mini{border:1px solid var(--dsw-alias-label-tertiary,#e5e7eb);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:3px 9px;font-size:12px;cursor:pointer;font-family:inherit;flex:none}',
          '.dsd-mini:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.dsd-rerun{border:1px solid var(--dsw-alias-label-tertiary,#e5e7eb);background:transparent;color:var(--dsw-alias-label-primary);border-radius:10px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:inherit;flex:none}',
          '.dsd-rerun:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.dsd-toast{font-size:12px;color:var(--dsw-alias-state-success-primary,#16a34a)}',
          '.dsd-upd{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0}',
          '.dsd-upd--ok{color:var(--dsw-alias-state-success-primary,#16a34a)}',
        ].join('\n');
        document.head.appendChild(tag);
        return () => { tag.remove(); };
      }, 'dsh-security-doctor: stylesheet');

      // ── sidebar footer button ──
      ctx.effect(() => {
        var disposeSlot = ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'security-doctor',
          order: 20,
          label: () => t('button')
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
          var badgeSeenState = React.useState(false);
          var badgeSeen = badgeSeenState[0];
          var setBadgeSeen = badgeSeenState[1];
          var btnRef = React.useRef(null);

          var record = function (r) {
            saveHistory({
              generatedAt: r.generatedAt,
              summary: r.summary,
              findingIds: r.checks.filter(function (c) { return c.status === 'finding' }).map(function (c) { return c.id }),
            });
          };

          var run = function () {
            setPhase('running')
            fetch('/dsh-security-doctor/check', { method: 'GET', headers: { 'x-dsh-security-doctor': '1' } })
              .then(function (res) { return res.json(); })
              .then(function (data) {
                if (!data || !data.ok || !data.report) throw new Error((data && data.message) || 'check route returned an error');
                record(data.report);
                setReport(data.report);
                setPhase('open');
              })
              .catch(function (err) {
                setErrMsg(String((err && err.message) || err));
                setPhase('error');
              });
          };

          // mount: auto checkup once + host pairing breadcrumb
          React.useEffect(function () {
            fetch('/dsh-security-doctor/self-test', { method: 'GET', headers: { 'x-dsh-security-doctor': '1' } })
              .then(function (res) { return res.json(); })
              .then(function (d) { console.info('[dsh-security-doctor] client loaded; host self-test:', d && d.version ? 'v' + d.version : d); })
              .catch(function () { console.warn('[dsh-security-doctor] host self-test unreachable — host half not loaded?'); });
            run();
          }, []);

          var click = function () {
            if (phase === 'running') return;
            if (phase === 'open' || phase === 'error') { setPhase('idle'); return; }
            setBadgeSeen(true);
            run();
          };

          var highCount = report && phase !== 'open' ? report.summary.high : 0;
          var showBadge = highCount > 0 && !badgeSeen;
          var label = phase === 'running' ? t('running')
            : phase === 'error' ? t('failed')
            : phase === 'open' ? t('viewReport')
            : t('button');
          var title = phase === 'error' ? (errMsg + ' — click to retry') : (phase === 'open' ? t('viewReport') : t('button'));

          var children = [
            phase === 'running'
              ? React.createElement('span', { key: 'spin', className: 'dsd-spin', role: 'progressbar', 'aria-label': t('running') })
              : React.createElement('svg', {
                  key: 'icon', width: 14, height: 14, viewBox: '0 0 24 24',
                  fill: 'none', stroke: 'currentColor', strokeWidth: 2,
                  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true'
                }, [React.createElement('path', { key: 'a', d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' })]),
            wide && React.createElement('span', { key: 'l', className: 'dsd-btn__label' }, label),
            showBadge ? React.createElement('span', { key: 'badge', className: 'dsd-badge', 'aria-label': SEVERITY_LABEL.high + ' × ' + highCount }, String(highCount)) : null,
          ];
          if (phase === 'open' || phase === 'error') {
            children.push(React.createElement(ReportModal, {
              key: 'modal', report: phase === 'open' ? report : null,
              errMsg: errMsg, onClose: function () { setPhase('idle') }, onRerun: run, running: false
            }));
          }

          return React.createElement('button', {
            type: 'button', ref: btnRef,
            className: 'dsd-btn' + (wide ? '' : ' dsd-btn--rail') + (phase === 'running' ? ' dsd-btn--running' : ''),
            onClick: click, title: title, 'aria-label': t('button'), disabled: phase === 'running'
          }, children);
        }));
        return () => disposeSlot();
      }, 'dsh-security-doctor: footer action');
    }

    module.exports = { apply: apply, inject: inject };
    return module.exports;
  }
});
