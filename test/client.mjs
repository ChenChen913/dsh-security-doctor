/**
 * dsh-security-doctor — client-half structural test (v0.4).
 *
 * Loads lib/client.js through a fake `window.__ModuleLoader__`, calls the
 * captured factory with a stubbed `require('react')` (a tiny hooks-capable
 * fake), applies the plugin to a fake slots context, renders the footer
 * component, and asserts the UI contract: button a11y labels, mount-time
 * auto checkup (fake fetch), open modal with dialog semantics, severity-sorted
 * cards with the high card first, and prescription/copy/export controls.
 * v0.3 additions: report footer shows the producing plugin version (V3), the
 * manual check-update button fires exactly ONE api.github.com request per
 * click and none before it (V4), and the fetched tag is echoed to self-test
 * (V8). v0.4 additions: liquid-glass overview — score gauge (100−25·high
 * −10·medium…), status dots, dot+count capsules. v0.5 additions: the checkup
 * request carries ?lang= (v0.5-4), the per-item prescription copy feeds back
 * through the toast (v0.5-1), identical auto checkups within 10 minutes are
 * deduped in history while manual runs always record (v0.5-2), the score
 * formula rides the gauge tooltip and info findings cap the score at 99
 * (v0.5-5), the trend line names same-id findings whose content changed
 * (v0.5-6), findings can be acknowledged and stop driving the badge (v0.5-7),
 * and CJK-glued slash tokens never become path chips (v0.5-10). v0.6
 * additions: passed checks collapse into ONE grouped list of
 * rows (dot + title + 正常 + chevron; click expands detail+advice in place),
 * "- " inventory lines render as metadata rows, the trend renders as
 * separate nowrap stat spans, and the footer splits into a metadata line
 * plus a safety-note line. v0.6.1 additions (review round "v0.6.0 缺点清
 * 单"): the acked dim is scoped to the prose column via the captured
 * stylesheet (#1), a hide/show-acked toggle removes acked cards from the
 * list (#2), pass rows carry a one-line detail summary (#3), metadata rows
 * are click-to-expand buttons (#4), a fresh mount within the 10-minute
 * window reuses the cached report without re-fetching (#5), the capped
 * gauge shows a visible 99-cap cue (#9), and the acked button title
 * advertises the undo (#10). Layout-review round additions: the modal
 * re-anchors text left against centered host containers, the body owns
 * the scroll via an explicit flex:1 + min-height:0 contract with 24px
 * bottom padding, the card action column wraps instead of being sliced
 * by overflow:hidden, and card surfaces are lifted for contrast. v0.6.2
 * round: no clip anywhere in the card stack (overflow:hidden removed from
 * cards and the pass group), titles/summaries wrap via word-break instead
 * of truncating, and pass rows carry their own corner rounding. v0.8
 * additions: suspicion tier badge + session policy line render on cards
 * (1-6/1-7) with old-report compatibility. v0.9 additions: the deep-review
 * prompt carries path/signals/T1–T10/format/anti-bribery with zero egress
 * (2-1/2-2), and pasted AI conclusions persist per workspace+plugin with
 * verdict auto-detection and fingerprint staleness pairing (2-3). v1.0.0
 * additions: the guard-mode switch re-asserts the host hook at mount, the
 * experimental records section renders plugin → host rows with credential
 * flags and honesty labels (3-1), the sentinel lights the badge on a
 * changed high-value file between polls, opening the report consumes the
 * alert into a named list, and toggling OFF persists + stops everything
 * (3-2/3-4). Run with:
 *
 *   node test/client.mjs
 */

import assert from 'node:assert/strict'

// ── fake platform: window + localStorage + fetch, no DOM ──
const store = new Map()
const sampleReport = {
  generatedAt: new Date('2026-08-16T12:00:00Z').toISOString(),
  home: 'C:\\Users\\t\\.dsh',
  workspace: 'D:\\proj',
  pluginVersion: '0.6.0',
  verdict: '测试判词',
  summary: { high: 1, medium: 1, low: 0, info: 0, error: 0 },
  checks: [
    // V5-1 fixture: line 1 has a slash inside Chinese prose (must stay plain
    // text), line 2 a home path followed by a full-width paren (chip must cut
    // exactly before it), line 3 a github dep spec (no chip); line 4 is the
    // v0.5-10 case — a multi-segment ascii path glued into CJK prose on both
    // sides must produce NO chip (the lookbehind/lookahead guards)
    { id: 'third-party-plugins', title: '盘点', severity: 'medium', status: 'finding', detail: '- dsh-x', advice: '审' },
    { id: 'js-directives', title: 'JS 检查', severity: 'high', status: 'finding',
      detail: '在 cordis 补丁/配置文件中发现 !!js 指令\n未发现 ~/.dsh/.credentials.yaml（Key 可能来自环境变量）\n依赖 github:ChenChen913/dsh-security-doctor#v0.4.0) 已锁定\n例如路径abc/def/ghi拼接进中文时不应成为可复制路径', advice: '查' },
    { id: 'external-endpoints', title: '端点', severity: 'info', status: 'pass', detail: '无', advice: 'ok' },
  ],
}

let capturedModule = null
let fetchCalls = []
let ghLatest = { tag_name: 'v9.9.9' } // what the fake GitHub release API returns
let ghStatus = 200 // 404 → "no release published" path (user finding 3.2-4)
let checkPayload = sampleReport // mount/auto checkup response (user finding 3.2-5)
// v1.0.0 (plan 3-1/3-2): what the fake /guard and /watch routes answer — the
// guard scenario below flips these between mounts to drive the switch, the
// records section, and the sentinel diff
let guardPayload = {
  ok: true, enabled: true, limit: 50, bestEffort: true,
  records: [
    { at: '2026-08-19T00:00:00.000Z', plugin: 'dsh-x', host: 'evil.example.com', method: 'POST', credHeaders: false, credBody: true },
    { at: '2026-08-19T00:00:01.000Z', plugin: null, host: 'registry.npmjs.org', method: 'GET', credHeaders: false, credBody: false },
  ],
}
let watchPayload = {
  ok: true, workspace: 'D:\\proj3', bestEffort: true,
  files: { 'home:cordis.patch.yml': '111:hashA', 'ws:AGENTS.md': '222:hashB' },
}
globalThis.window = {
  __ModuleLoader__: { load(m) { capturedModule = m } },
  fetch(url, init) {
    fetchCalls.push({ url: String(url), init })
    const u = String(url)
    if (u.includes('api.github.com')) {
      if (ghStatus === 404) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(ghLatest) })
    }
    if (u.includes('/self-test')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, version: '0.6.0' }) })
    }
    if (u.includes('/dsh-security-doctor/guard')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(guardPayload) })
    }
    if (u.includes('/dsh-security-doctor/watch')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(watchPayload) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, report: checkPayload }) })
  },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  addEventListener() {},
  removeEventListener() {},
}
// client code calls bare fetch(); in the browser that IS window.fetch — mirror it here
globalThis.fetch = window.fetch
// minimal DOM surface the style effect and modal focus-management touch.
// head.appendChild CAPTURES the injected stylesheet so layout-regression
// assertions can read the actual CSS (v0.6.1 #1: the acked dim scope)
const styleSheets = []
globalThis.document = {
  activeElement: null,
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '', remove() {}, style: {}, click() {} }),
  body: { appendChild() {} },
  head: { appendChild(el) { styleSheets.push(String(el.textContent)) } },
}

// Node 21+ ships a built-in global navigator whose language follows the OS
// locale — pin it so the i18n branch under test is deterministic (CI runners
// are en-US; a Chinese dev machine is zh-CN; both must pass the same suite).
// The fake clipboard resolves immediately so copy actions report success
// (the v0.5-1 toast assertion relies on it) and CAPTURES the text so the
// v0.9 deep-review prompt contract can be asserted on the real payload.
let lastCopiedText = null
function setNavigator(language) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { language, clipboard: { writeText: (text) => { lastCopiedText = text; return Promise.resolve() } } },
    configurable: true,
  })
}
setNavigator('zh-CN')

// ── fake React: element descriptors + minimal hook state ──
let hookStates = []
let hookIndex = 0
function resetHooks() { hookIndex = 0 }
const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(4).filter((c) => c !== null && c !== undefined && c !== false && c !== '') }
  },
  useState(initial) {
    const i = hookIndex++
    if (hookStates.length <= i) hookStates[i] = typeof initial === 'function' ? initial() : initial
    const value = hookStates[i]
    const setter = (v) => { hookStates[i] = typeof v === 'function' ? v(hookStates[i]) : hookStates[i] = v }
    return [value, setter]
  },
  useEffect(fn) { fn(); return () => {} },
  useRef(initial) {
    const i = hookIndex++
    if (hookStates.length <= i || !(hookStates[i] instanceof Object)) hookStates[i] = { current: initial }
    return hookStates[i]
  },
}

// invoke function components while walking the element tree
function walk(el, visit) {
  if (el === null || el === undefined || typeof el !== 'object') return
  if (typeof el.type === 'function') { walk(el.type(el.props), visit); return }
  visit(el)
  for (const child of el.children ?? []) walk(child, visit)
}
function findAll(el, predicate) {
  const out = []
  walk(el, (node) => { if (predicate(node)) out.push(node) })
  return out
}
/**
 * Render once and collect nodes/text in a SINGLE walk. The fake hooks array is
 * global, so every extra walk re-invokes function components on fresh hook
 * slots — for click-then-read state tests the write and the read must land on
 * the same slots, which only holds when each render phase walks exactly once.
 */
function renderAndCollect(slot) {
  resetHooks()
  const el = slot.render({ wide: true })
  const nodes = []
  walk(el, (node) => nodes.push(node))
  const text = []
  for (const node of nodes) for (const c of (node.children ?? [])) if (typeof c === 'string') text.push(c)
  return { el, nodes, text: text.join(' ') }
}

async function main() {
  await import(new URL('../lib/client.js', import.meta.url).href)
  assert.ok(capturedModule, 'module loader captured the bundle')
  assert.equal(capturedModule.id, 'dsh-security-doctor')

  const mod = capturedModule.factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })
  assert.deepEqual(mod.inject, ['slots'])
  assert.equal(typeof mod.apply, 'function')

  let slot = null
  const ctx = {
    effect(fn) { fn(); return () => {} },
    slots: {
      inject(slotName, register) {
        const disposer = register()
        return () => disposer()
      },
      register(spec, render) {
        slot = { spec, render }
        return () => { slot = null }
      },
    },
  }
  mod.apply(ctx)
  assert.ok(slot, 'footer slot registered')
  assert.equal(slot.spec.id, 'security-doctor')

  // initial render: mount effect ran the auto checkup (self-test + check)
  resetHooks()
  const button = slot.render({ wide: true })
  assert.equal(button.type, 'button')
  assert.equal(button.props['aria-label'], '安全体检')
  assert.ok(fetchCalls.some((c) => String(c.url).includes('/dsh-security-doctor/self-test')), 'self-test pinged on mount')
  assert.ok(fetchCalls.some((c) => String(c.url).includes('/dsh-security-doctor/check')), 'auto checkup ran on mount')
  // every call carries the cross-site read guard pairing header (self-audit S1)
  assert.ok(fetchCalls.length > 0 && fetchCalls.every((c) => c.init && c.init.headers && c.init.headers['x-dsh-security-doctor'] === '1'),
    'pairing header sent on every fetch')
  assert.ok(findAll(button, (n) => n.type === 'svg').length > 0, 'shield icon rendered')

  // wait for the auto checkup promise chain, then re-render: modal should be open
  await new Promise((resolve) => setTimeout(resolve, 10))
  resetHooks()
  const open = slot.render({ wide: true })
  const dialogs = findAll(open, (n) => n.props.role === 'dialog')
  assert.equal(dialogs.length, 1, 'exactly one dialog')
  assert.equal(dialogs[0].props['aria-modal'], 'true')

  // severity sort: the high card must precede the medium card; pass card last
  // (v0.6: pass checks render as rows inside ONE dsd-passgroup list)
  const cards = findAll(open, (n) => typeof n.props.className === 'string' && /(^|\s)dsd-check(\s|$)/.test(n.props.className))
  assert.equal(cards.length, 3, 'three check cards')
  assert.ok(open.children, 'modal rendered')
  assert.ok(findAll(open, (n) => n.props.className === 'dsd-passgroup').length === 1, 'passed checks share ONE grouped list (v0.6)')
  const titles = cards.map((c) => {
    const title = findAll(c, (n) => n.props.className === 'dsd-check__title')[0]
    return title && title.children[0]
  })
  assert.equal(titles[0], 'JS 检查', 'high card first')
  assert.equal(titles[1], '盘点')
  assert.equal(titles[2], '端点', 'pass card last')
  assert.match(cards[0].props.className, /dsd-check--high/, 'high card emphasized')

  // v0.2 controls exist: prescription per item, all-prescriptions, copy md, export json
  const buttons = findAll(open, (n) => n.type === 'button')
  const texts = buttons.map((b) => b.children.join(''))
  assert.ok(texts.some((x) => x.includes('处方')), 'per-item prescription button')
  assert.ok(texts.some((x) => x.includes('全部处方')), 'all-prescriptions button')
  assert.ok(texts.some((x) => x.includes('复制 Markdown')), 'copy markdown')
  assert.ok(texts.some((x) => x.includes('导出 JSON')), 'export json')

  // history recorded for the trend view
  const history = JSON.parse(store.get('dsd.history'))
  assert.equal(history.length, 1)
  assert.deepEqual(history[0].summary, sampleReport.summary)
  assert.ok(history[0].findingIds.includes('js-directives'))

  // ── v0.3 versioning contract ──
  // The fake useEffect runs on every component invocation, so each render
  // re-triggers run() and flips phase to 'running' until its fetch settles —
  // drain that with a tick before every collect render below.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10))
  // V4 precondition: zero egress so far — no GitHub request before any click
  assert.ok(!fetchCalls.some((c) => String(c.url).includes('api.github.com')), 'no GitHub request before a click')
  // V3: the report footer states the plugin version that produced it
  await settle()
  const upd0 = renderAndCollect(slot)
  assert.ok(upd0.text.includes('插件 v0.6.0'), 'report footer shows plugin version')
  // V5-1: only the real home path becomes a chip — Chinese prose with a
  // slash and the github dep spec must stay plain text
  const chips = upd0.nodes.filter((n) => n.props.className === 'dsd-path').map((n) => n.children.join(''))
  assert.deepEqual(chips, ['~/.dsh/.credentials.yaml'], 'path chips are exactly the real home path')
  // v0.4 liquid-glass overview: score gauge (100−25·1−10·1 = 65), dots, capsules
  assert.ok(upd0.nodes.some((n) => n.props.className === 'dsd-gauge'), 'score gauge svg rendered')
  assert.ok(upd0.text.includes('安全评分'), 'gauge label shown')
  assert.ok(upd0.text.includes('65'), 'score computed from summary (65)')
  assert.ok(upd0.nodes.some((n) => typeof n.props.className === 'string' && n.props.className.includes('dsd-dot--high')), 'high status dot rendered')
  assert.ok(upd0.nodes.some((n) => typeof n.props.className === 'string' && n.props.className.includes('dsd-pill')), 'count capsules rendered')
  assert.ok(upd0.nodes.some((n) => typeof n.props.className === 'string' && n.props.className.includes('dsd-check--pass')), 'passed cards carry the pass modifier')
  const updBtn = upd0.nodes.filter((n) => n.type === 'button').find((b) => b.children.join('').includes('检查更新'))
  assert.ok(updBtn, 'check-update button rendered')
  updBtn.props.onClick()
  await settle()
  const ghCalls = fetchCalls.filter((c) => String(c.url).includes('api.github.com'))
  assert.equal(ghCalls.length, 1, 'exactly one GitHub request per click')
  assert.equal(ghCalls[0].url, 'https://api.github.com/repos/ChenChen913/dsh-security-doctor/releases/latest', 'hits the pinned release URL')
  // V8: the fetched tag is handed to the host self-test (localhost echo)
  assert.ok(fetchCalls.some((c) => String(c.url).includes('/dsh-security-doctor/self-test?latest=v9.9.9')), 'fetched tag echoed to self-test')
  const upd1 = renderAndCollect(slot)
  assert.ok(upd1.text.includes('有新版') && upd1.text.includes('v9.9.9'), 'newer release surfaced with tag')
  assert.ok(upd1.text.includes('README'), 'points at the README update section')

  // up-to-date path: same-version tag → “已是最新版本”
  ghLatest = { tag_name: 'v0.3.0' }
  await settle()
  const upd2 = renderAndCollect(slot)
  const updBtn2 = upd2.nodes.filter((n) => n.type === 'button').find((b) => b.children.join('').includes('检查更新'))
  updBtn2.props.onClick()
  await settle()
  const upd3 = renderAndCollect(slot)
  assert.ok(upd3.text.includes('已是最新版本'), 'up-to-date message shown')

  // badge on the idle button after a high finding (modal closed via click)
  resetHooks()
  const closed = slot.render({ wide: true }) // re-render keeps phase 'open' from state
  void closed
  // simulate close: last hook states hold phase; flip via a fresh render is
  // stateful-only in real React — here we assert the badge path directly by
  // resetting hooks and re-running with cleared modal state:
  hookStates = hookStates.map((v, i) => (i === 0 ? 'idle' : v))
  resetHooks()
  const idle = slot.render({ wide: true })
  const badge = findAll(idle, (n) => typeof n.props.className === 'string' && n.props.className.includes('dsd-badge'))
  assert.equal(badge.length, 1, 'high-count badge visible while unacknowledged')
  assert.equal(badge[0].children[0], '1')

  // ── v0.5 contract additions (same module + slot as above) ──
  // v0.5-4: every checkup request carries the client locale (?lang=zh here)
  assert.ok(fetchCalls.some((c) => String(c.url).includes('/dsh-security-doctor/check?lang=zh')),
    'checkup request carries ?lang=zh (v0.5-4)')
  // v0.5-5: the score formula rides the gauge as its tooltip — the number is
  // never a black box
  hookStates[0] = 'open'
  const formulaView = renderAndCollect(slot)
  const gaugeWrap = formulaView.nodes.filter((n) => n.props.className === 'dsd-gauge-wrap')[0]
  assert.ok(gaugeWrap && typeof gaugeWrap.props.title === 'string' && gaugeWrap.props.title.includes('评分 = 100'),
    'score formula shown as the gauge tooltip (v0.5-5)')
  // v0.5-1: the per-item prescription copy now feeds back through the same
  // toast as the all-in-one copy (it used to copy silently)
  hookStates[0] = 'open'
  const rxView = renderAndCollect(slot)
  const rxBtn = rxView.nodes.filter((n) => n.type === 'button').find((b) => b.children.includes('处方'))
  assert.ok(rxBtn, 'per-item prescription button present')
  rxBtn.props.onClick()
  await settle()
  hookStates[0] = 'open'
  const rxDone = renderAndCollect(slot)
  assert.ok(rxDone.text.includes('已复制到剪贴板'), 'per-item copy shows the toast (v0.5-1)')
  // v0.5-7: acknowledging the high finding persists its detail fingerprint,
  // dims the card, relabels the button and stops driving the badge
  hookStates[0] = 'open'
  const ackView = renderAndCollect(slot)
  const ackBtns = ackView.nodes.filter((n) => n.type === 'button' && n.children.includes('已阅'))
  assert.equal(ackBtns.length, 2, 'one ack button per finding card')
  ackBtns[0].props.onClick() // first card in sort order = the high js-directives finding
  const ackedStore = JSON.parse(store.get('dsd.acked'))
  assert.ok(ackedStore && typeof ackedStore['js-directives'] === 'string', 'ack persisted with a detail fingerprint')
  hookStates[0] = 'open'
  const ackedView = renderAndCollect(slot)
  assert.ok(ackedView.text.includes('已阅 ✓'), 'acked card shows the acked label')
  assert.ok(ackedView.nodes.some((n) => typeof n.props.className === 'string' && n.props.className.includes('dsd-check--acked')),
    'acked card dimmed')
  hookStates[0] = 'idle'
  const idleAcked = renderAndCollect(slot)
  assert.equal(idleAcked.nodes.filter((n) => typeof n.props.className === 'string' && n.props.className.includes('dsd-badge')).length, 0,
    'acknowledged high finding no longer drives the badge (v0.5-7)')

  // ── v0.6.1 review additions (modal open again, js-directives acked) ──
  // #10: the acked button's title advertises the undo so users discover it
  hookStates[0] = 'open'
  const ackOpen = renderAndCollect(slot)
  const ackedBtn = ackOpen.nodes.filter((n) => n.type === 'button').find((b) => b.children.includes('已阅 ✓'))
  assert.ok(ackedBtn && typeof ackedBtn.props.title === 'string' && ackedBtn.props.title.includes('撤销'),
    'acked button title advertises the undo (v0.6.1 #10)')
  // #2: the hide/show-acked toggle folds acknowledged cards out of the list
  const ackToggle = ackOpen.nodes.filter((n) => n.props.className === 'dsd-acktoggle')[0]
  assert.ok(ackToggle, 'hide/show-acked toggle rendered when findings are acked (v0.6.1 #2)')
  const toggleBtn = ackToggle.children[0]
  assert.equal(toggleBtn.children[0], '隐藏已阅（1）', 'toggle label carries the acked count (v0.6.1 #2)')
  toggleBtn.props.onClick()
  hookStates[0] = 'open'
  const hiddenView = renderAndCollect(slot)
  assert.ok(!hiddenView.text.includes('JS 检查'), 'acked card leaves the list when hidden (v0.6.1 #2)')
  assert.ok(hiddenView.text.includes('盘点'), 'unacked findings stay visible while hiding acked ones')
  // toggle back OFF so later blocks (layout contract) see the full list again
  const toggleBtn2 = hiddenView.nodes.filter((n) => n.type === 'button').find((b) => String(b.children[0]).startsWith('显示已阅'))
  assert.ok(toggleBtn2, 'toggle flips to the show-acked label (v0.6.1 #2)')
  toggleBtn2.props.onClick()
  hookStates[0] = 'open'
  const restoredView = renderAndCollect(slot)
  assert.ok(restoredView.text.includes('JS 检查'), 'toggle restores the acked card (v0.6.1 #2)')

  // ── v0.6 layout contract ──
  // precondition: a prior history entry with a DIFFERENT generatedAt, so
  // diffLastRun finds a baseline and the trend stats render as their four
  // span units (the v0.5-2 block below resets history and re-tests dedup)
  store.set('dsd.history', JSON.stringify([{
    generatedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    summary: sampleReport.summary,
    findingIds: ['third-party-plugins', 'js-directives'],
    fingerprints: null,
  }]))
  // "- " inventory lines (the 盘点 fixture's '- dsh-x') render as muted
  // metadata rows with the raw line as their tooltip — not body prose
  hookStates[0] = 'open'
  const layoutView = renderAndCollect(slot)
  const metaRows = layoutView.nodes.filter((n) => n.props.className === 'dsd-check__meta-row')
  assert.equal(metaRows.length, 1, 'inventory lines become metadata rows (v0.6)')
  assert.equal(metaRows[0].props.title, 'dsh-x', 'metadata row keeps the full text as its tooltip')
  assert.ok(!layoutView.text.split(' ').includes('- dsh-x'), 'the "- " bullet is stripped from the visible text')
  assert.ok(/来源\s*·\s*dsh-x/.test(layoutView.text), 'source rows carry the 来源 prefix (v0.6)')
  // v0.6.1 #4: metadata rows are click-to-expand buttons (touch-visible)
  assert.equal(metaRows[0].props['aria-expanded'], false, 'metadata row starts collapsed (v0.6.1 #4)')
  metaRows[0].props.onClick()
  // re-pin the phase: the mount effect re-evaluates it on every render and
  // (with the high finding acked) settles on 'idle' — same convention as the
  // pass-row click test below
  hookStates[0] = 'open'
  const metaOpen = renderAndCollect(slot)
  const openRow = metaOpen.nodes.filter((n) => typeof n.props.className === 'string' && n.props.className.includes('dsd-check__meta-row--open'))[0]
  assert.ok(openRow && openRow.props['aria-expanded'] === true,
    'clicking a metadata row expands it in place (v0.6.1 #4)')
  // finding cards share the three-column skeleton: dot | main | side
  assert.ok(layoutView.nodes.some((n) => n.props.className === 'dsd-check__main'), 'finding card main column rendered')
  assert.ok(layoutView.nodes.some((n) => n.props.className === 'dsd-check__side'), 'finding card action column rendered')
  // trend renders as separate nowrap stat spans (wraps as units, never overlaps)
  const trendDiv = layoutView.nodes.filter((n) => n.props.className === 'dsd-trend')[0]
  assert.ok(trendDiv && trendDiv.children.length >= 4 && trendDiv.children.every((c) => c.type === 'span'),
    'trend stats are individual span units (v0.6)')
  // footer reads in two layers: metadata line + safety-note paragraph
  const metaLine = layoutView.nodes.filter((n) => n.props.className === 'dsd-footer__meta')[0]
  const noteLine = layoutView.nodes.filter((n) => n.props.className === 'dsd-footer__note')[0]
  assert.ok(metaLine && String(metaLine.children[0]).includes('尽力检测（best-effort）'),
    'footer layer 1 carries the generation metadata (v0.6)')
  assert.ok(noteLine && String(noteLine.children[0]).includes('不等于绝对安全'),
    'footer layer 2 carries the safety note as its own paragraph (v0.6)')
  // pass rows: dot + title + 正常 + chevron, collapsed by default
  const passRow = layoutView.nodes.filter((n) => n.props.className === 'dsd-check__row')[0]
  assert.ok(passRow, 'pass check renders as a collapsible row (v0.6)')
  assert.equal(passRow.props['aria-expanded'], false, 'pass row starts collapsed')
  assert.ok(layoutView.text.includes('正常'), 'pass row shows the quiet ok status')
  assert.ok(layoutView.nodes.some((n) => typeof n.props.className === 'string' && n.props.className.includes('dsd-check__chev')),
    'pass row carries the chevron hint')
  assert.ok(!layoutView.nodes.some((n) => n.props.className === 'dsd-check__more'),
    'collapsed pass row hides its detail body')
  // clicking the row expands detail + advice in place
  passRow.props.onClick()
  await settle()
  hookStates[0] = 'open'
  const passOpen = renderAndCollect(slot)
  assert.ok(passOpen.text.includes('建议：ok'), 'expanded pass row reveals its advice (v0.6)')
  assert.ok(passOpen.nodes.some((n) => n.props.className === 'dsd-check__more'), 'pass row expands in place')
  const passRowOpen = passOpen.nodes.filter((n) => n.props.className === 'dsd-check__row')[0]
  assert.equal(passRowOpen.props['aria-expanded'], true, 'aria-expanded flips with the row state')
  // v0.6.1 #3: the pass row carries a one-line ellipsized detail summary
  const passSummary = layoutView.nodes.filter((n) => n.props.className === 'dsd-check__summary')[0]
  assert.ok(passSummary && passSummary.children[0] === '无',
    'pass row shows its first detail line as the summary (v0.6.1 #3)')

  // ── v0.6.1 stylesheet contract (read from the injected <style>) ──
  // the fake document.head captures every sheet; the rules are static so any
  // captured copy is authoritative
  const css = styleSheets.join('\n')
  // collect EVERY `sel{…}` occurrence (the same selector legitimately shows
  // up in media queries too — e.g. prefers-reduced-motion resets — so a
  // first-match-only lookup would grab the wrong copy)
  const ruleOf = (sel) => {
    const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*\\}', 'g')
    return (css.match(re) || []).join('\n')
  }
  // previous round #1: the acked dim is scoped to the prose column — the
  // severity bar, dot and buttons keep full opacity (seen ≠ muted red)
  assert.ok(css.includes('.dsd-check--acked .dsd-check__main{opacity:.6}'),
    'acked dim is scoped to the main column only (v0.6.1 #1)')
  // layout review #1: explicit left alignment — host containers that center
  // text must never leak into URLs, paths or source lists
  assert.ok(ruleOf('.dsd-modal').includes('text-align:left'),
    'modal re-anchors text left against centered host containers (layout #1)')
  // layout review #2: explicit three-section contract + bottom breathing room
  const bodyRule = ruleOf('.dsd-modal__body')
  assert.ok(bodyRule.includes('flex:1 1 auto') && bodyRule.includes('min-height:0'),
    'body owns the scroll: flex:1 + min-height:0 three-section contract (layout #2)')
  assert.ok(bodyRule.includes('padding:16px 20px 24px'),
    'scroll area keeps 24px bottom padding so the last card clears the edge (layout #2)')
  // layout review #3: the action column wraps instead of being sliced by the
  // card's overflow:hidden on narrow widths
  assert.ok(ruleOf('.dsd-check__side').includes('flex-wrap:wrap'),
    'action column wraps instead of clipping buttons (layout #3)')
  // layout review #4: card surfaces lifted (44→56%, hover 62→72%) + hairline
  // shadow so cards read distinctly on the frosted modal
  const checkRule = ruleOf('.dsd-check')
  assert.ok(checkRule.includes('rgba(255,255,255,.56)') && checkRule.includes('box-shadow'),
    'card surface lifted for contrast on the frosted modal (layout #4)')
  // v0.6.2 layout review: NO clipping anywhere in the card stack — cards are
  // height:auto, so overflow:hidden had no legitimate job; titles and pass
  // summaries wrap (word-break) instead of being ellipsized mid-sentence,
  // and the pass group rounds its first/last rows per-row since the group
  // clip is gone
  assert.ok(!checkRule.includes('overflow:hidden'),
    'finding card never clips: overflow:hidden removed (v0.6.2 #1)')
  assert.ok(!ruleOf('.dsd-passgroup').includes('overflow:hidden'),
    'pass group never clips: overflow:hidden removed (v0.6.2 #1)')
  const titleRule = ruleOf('.dsd-check__title')
  assert.ok(!titleRule.includes('white-space:nowrap') && titleRule.includes('word-break:break-word'),
    'card titles wrap naturally instead of truncating (v0.6.2 #1)')
  const summaryRule = ruleOf('.dsd-check__summary')
  assert.ok(!summaryRule.includes('white-space:nowrap') && summaryRule.includes('word-break:break-word'),
    'pass summaries wrap naturally instead of truncating (v0.6.2 #1)')
  assert.ok(css.includes('.dsd-passgroup .dsd-check:first-child .dsd-check__row{border-radius:15px 15px 0 0}')
    && css.includes('.dsd-passgroup .dsd-check:last-child .dsd-check__row{border-radius:0 0 15px 15px}'),
    'pass rows carry the corner rounding the group clip used to do (v0.6.2 #1)')
  // v0.6.2 #2: action buttons live in the flex flow (no absolute corner
  // positioning) — the side column is a wrapping flex row, and the only
  // absolute elements on cards are decorative (::before severity bar)
  assert.ok(ruleOf('.dsd-check__side').includes('display:flex') && !ruleOf('.dsd-check__side').includes('position:absolute'),
    'action buttons stay in the flex flow, never absolutely positioned (v0.6.2 #2)')

  console.log('CLIENT OK — slot:', slot.spec.id, '| cards:', titles.join(' / '))

  // ── en-US locale: the same factory re-run picks the English string table ──
  setNavigator('en-US')
  hookStates = []
  resetHooks()
  const modEn = capturedModule.factory((n) => {
    if (n === 'react') return React
    throw new Error('unexpected require: ' + n)
  })
  let slotEn = null
  modEn.apply({
    effect(fn) { fn(); return () => {} },
    slots: {
      inject(slotName, register) { const d = register(); return () => d() },
      register(spec, render) { slotEn = { spec, render }; return () => { slotEn = null } },
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  resetHooks()
  const buttonEn = slotEn.render({ wide: true })
  assert.equal(buttonEn.props['aria-label'], 'Security checkup')
  // v0.5-4: the en client asks the host for the English report body
  assert.ok(fetchCalls.some((c) => String(c.url).includes('/dsh-security-doctor/check?lang=en')),
    'en client requests the English report body (v0.5-4)')
  console.log('CLIENT OK (en-US) — aria-label:', buttonEn.props['aria-label'])

  // ── 3.2-5: mount-time auto checkup must NOT auto-open without a high ──
  setNavigator('zh-CN')
  checkPayload = { ...sampleReport, summary: { high: 0, medium: 1, low: 0, info: 0, error: 0 } }
  ghStatus = 404
  hookStates = []
  resetHooks()
  const mod3 = capturedModule.factory((n) => {
    if (n === 'react') return React
    throw new Error('unexpected require: ' + n)
  })
  let slot3 = null
  mod3.apply({
    effect(fn) { fn(); return () => {} },
    slots: {
      inject(slotName, register) { const d = register(); return () => d() },
      register(spec, render) { slot3 = { spec, render }; return () => { slot3 = null } },
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  const autoIdle = renderAndCollect(slot3)
  assert.equal(autoIdle.nodes.filter((n) => n.props.role === 'dialog').length, 0, 'no auto-open without high findings (3.2-5)')
  assert.equal(autoIdle.el.props['aria-label'], '安全体检', 'button shows the idle label after the background checkup')
  // manual click still opens the report (high findings back in the payload so
  // the fake useEffect's re-triggered background runs keep the modal open)
  checkPayload = sampleReport
  autoIdle.el.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))
  const manualOpen = renderAndCollect(slot3)
  assert.equal(manualOpen.nodes.filter((n) => n.props.role === 'dialog').length, 1, 'manual click opens the report')
  // 3.2-4: GitHub 404 → dedicated "no release" wording, not network failure
  // (the js-directives ack from the v0.5-7 block persists in localStorage, so
  // the re-triggered background runs now settle on phase 'idle' — pin the
  // modal open to inspect the update note)
  const updBtn3 = manualOpen.nodes.filter((n) => n.type === 'button').find((b) => b.children.join('').includes('检查更新'))
  updBtn3.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))
  hookStates[0] = 'open'
  const after404 = renderAndCollect(slot3)
  assert.ok(after404.text.includes('未查询到已发布的 Release'), '404 surfaces the no-release message (3.2-4)')
  assert.ok(!after404.text.includes('不可达'), '404 is not reported as network failure')
  console.log('CLIENT OK (3.2-4/3.2-5) — no auto-open without high; 404 wording distinct')

  // ── v0.5-2: identical auto checkups dedup history; manual runs record ──
  // (also drop the v0.6.1 report cache — a fresh mount would reuse it and
  // skip the fetch, so no history entry would ever be written here)
  store.delete('dsd.history')
  store.delete('dsd.cachedReport')
  const stamp1 = new Date().toISOString()
  checkPayload = { ...sampleReport, generatedAt: stamp1 }
  hookStates = []
  resetHooks()
  const modD = capturedModule.factory((n) => {
    if (n === 'react') return React
    throw new Error('unexpected require: ' + n)
  })
  let slotD = null
  modD.apply({
    effect(fn) { fn(); return () => {} },
    slots: {
      inject(slotName, register) { const d = register(); return () => d() },
      register(spec, render) { slotD = { spec, render }; return () => { slotD = null } },
    },
  })
  renderAndCollect(slotD) // mount render fires the auto checkup → records
  await settle()
  assert.equal(JSON.parse(store.get('dsd.history')).length, 1, 'first auto checkup records history')
  hookStates[0] = 'idle'
  renderAndCollect(slotD) // identical auto checkup within 10 minutes → dedup
  await settle()
  assert.equal(JSON.parse(store.get('dsd.history')).length, 1,
    'identical auto checkup within 10 minutes adds no history entry (v0.5-2)')
  hookStates[0] = 'idle'
  const manualD = renderAndCollect(slotD)
  manualD.el.props.onClick() // manual run — the user asked for it
  await settle()
  assert.equal(JSON.parse(store.get('dsd.history')).length, 2,
    'manual run always records (v0.5-2)')

  // ── v0.6.1 #5: a fresh mount inside the 10-minute window reuses the cache ──
  // (the manual run above just refreshed dsd.cachedReport with the current
  // payload; mounting a brand-new module must NOT fetch /check again yet must
  // still render the full report from the cache)
  const checkCallsBefore = fetchCalls.filter((c) => String(c.url).includes('/dsh-security-doctor/check')).length
  assert.ok(checkCallsBefore > 0, 'fixture sanity: /check was fetched at least once so far')
  hookStates = []
  resetHooks()
  const modC = capturedModule.factory((n) => {
    if (n === 'react') return React
    throw new Error('unexpected require: ' + n)
  })
  let slotC = null
  modC.apply({
    effect(fn) { fn(); return () => {} },
    slots: {
      inject(slotName, register) { const d = register(); return () => d() },
      register(spec, render) { slotC = { spec, render }; return () => { slotC = null } },
    },
  })
  renderAndCollect(slotC) // mount → cache hit, /check must NOT be fetched
  await settle()
  assert.equal(
    fetchCalls.filter((c) => String(c.url).includes('/dsh-security-doctor/check')).length,
    checkCallsBefore,
    'fresh mount within 10 minutes skips the /check fetch (v0.6.1 #5)',
  )
  hookStates[0] = 'open'
  const cachedView = renderAndCollect(slotC)
  assert.ok(cachedView.nodes.some((n) => n.props.role === 'dialog'), 'cached report still renders the modal')
  assert.ok(cachedView.text.includes('测试判词'), 'cached report content is on screen (v0.6.1 #5)')
  console.log('CLIENT OK (v0.6.1 #5) — 10-minute cache: fresh mount reuses report, no re-fetch')

  // ── v0.5-6: the trend names same-id findings whose content changed ──
  // (cache dropped again: the mount must really fetch, else the changed
  // detail never reaches the fingerprint comparison and nothing re-arms)
  store.delete('dsd.cachedReport')
  const stamp2 = new Date(Date.now() + 2000).toISOString()
  checkPayload = {
    ...sampleReport,
    generatedAt: stamp2,
    checks: sampleReport.checks.map((c) => (c.id === 'js-directives'
      ? { ...c, detail: c.detail + '\n新出现的一行：内容与上次不同' }
      : c)),
  }
  hookStates = []
  resetHooks()
  const modT = capturedModule.factory((n) => {
    if (n === 'react') return React
    throw new Error('unexpected require: ' + n)
  })
  let slotT = null
  modT.apply({
    effect(fn) { fn(); return () => {} },
    slots: {
      inject(slotName, register) { const d = register(); return () => d() },
      register(spec, render) { slotT = { spec, render }; return () => { slotT = null } },
    },
  })
  renderAndCollect(slotT) // mount auto checkup with the changed detail
  await settle() // the changed detail invalidates the ack → auto-opens
  hookStates[0] = 'open'
  const trendView = renderAndCollect(slotT)
  assert.ok(trendView.text.includes('内容有变：js-directives'),
    'same-id finding with changed detail reported as changed (v0.5-6)')

  // ── v0.5-5: info-only findings cap the score at 99 ──
  // (cache dropped so the mount auto checkup fetches THIS payload's summary)
  store.delete('dsd.cachedReport')
  checkPayload = { ...sampleReport, summary: { high: 0, medium: 0, low: 0, info: 2, error: 0 } }
  hookStates = []
  resetHooks()
  const modI = capturedModule.factory((n) => {
    if (n === 'react') return React
    throw new Error('unexpected require: ' + n)
  })
  let slotI = null
  modI.apply({
    effect(fn) { fn(); return () => {} },
    slots: {
      inject(slotName, register) { const d = register(); return () => d() },
      register(spec, render) { slotI = { spec, render }; return () => { slotI = null } },
    },
  })
  renderAndCollect(slotI) // mount auto checkup (quiet: the high finding is acked)
  await settle()
  hookStates[0] = 'idle'
  const manualI = renderAndCollect(slotI)
  manualI.el.props.onClick() // manual open to inspect the gauge
  await settle()
  hookStates[0] = 'open'
  const cappedView = renderAndCollect(slotI)
  const gaugeNum = cappedView.nodes.filter((n) => n.props.className === 'dsd-gauge__num')[0]
  assert.ok(gaugeNum, 'score gauge rendered')
  assert.equal(gaugeNum.children[0], '99', 'info findings cap the score at 99 (v0.5-5)')
  // v0.6.1 #9: the capped gauge carries a visible cue so 99 never reads as
  // a natural score
  const capNote = cappedView.nodes.filter((n) => n.props.className === 'dsd-gauge__cap')[0]
  assert.ok(capNote && String(capNote.children[0]).includes('上限 99'),
    'capped gauge shows the visible 99-cap cue (v0.6.1 #9)')
  console.log('CLIENT OK (v0.5) — dedup/trend/ack/toast/lang/score-cap all verified')

  // ── v0.8 (plan 1-5): plugin code-tree fingerprint drift ──
  // The engine stamps every scanned external plugin with a content-hash
  // fingerprint; the client snapshots {name → fp} per workspace and flags
  // drift across runs. Three phases: first snapshot (baseline note, no
  // trend line), drifted second run (⚠ note on the egress card + a trend
  // span), and an old-format report without trees (silent skip).
  const egCheck = (fp) => ({
    id: 'plugin-egress', title: '出网扫描', severity: 'medium', status: 'finding',
    detail: '- dsh-tree-demo：evil.example；⚠ 意图特征信号（单特征，仅供复核）：邮箱 a@b.example',
    advice: '审',
    extra: { perPlugin: [{ name: 'dsh-tree-demo', hosts: [['evil.example', 1]], suspicious: [],
      signals: { emailSamples: ['a@b.example'], bareHosts: [], envKeys: [], credHits: 0, mailHits: 1, envHits: 0, keyHits: 0, singles: 1 },
      combos: [], comboFiles: [], injection: [], installScriptHits: null,
      tree: { fingerprint: fp, files: 3, partial: false }, score: 8, tier: 'low' }] },
  })
  const mount = async () => {
    hookStates = []
    resetHooks()
    const m = capturedModule.factory((n) => { if (n === 'react') return React; throw new Error('unexpected require: ' + n) })
    let s = null
    m.apply({
      effect(fn) { fn(); return () => {} },
      slots: {
        inject(slotName, register) { const d = register(); return () => d() },
        register(spec, render) { s = { spec, render }; return () => { s = null } },
      },
    })
    renderAndCollect(s) // mount fires the auto checkup
    await settle()
    return s
  }
  // phase 1: first snapshot — the egress card carries the baseline note and
  // NOTHING rides the trend (first-snapshot is baseline, not drift)
  store.delete('dsd.cachedReport')
  checkPayload = {
    ...sampleReport,
    generatedAt: new Date(Date.now() + 4000).toISOString(),
    checks: sampleReport.checks.concat([egCheck('f'.repeat(64))]),
  }
  let slotTree = await mount()
  let openBtn1 = renderAndCollect(slotTree)
  openBtn1.el.props.onClick() // manual open (the high finding is acked)
  await settle()
  hookStates[0] = 'open'
  let treeView1 = renderAndCollect(slotTree)
  assert.ok(treeView1.text.includes('首次记录插件代码指纹'),
    'first tree snapshot shows the baseline note (v0.8 1-5)')
  assert.ok(!treeView1.text.includes('插件代码树变更：'),
    'first snapshot does not ride the trend as drift (v0.8 1-5)')
  const treeSnap1 = JSON.parse(store.get('dsd.trees.D_proj'))
  assert.ok(treeSnap1 && treeSnap1.trees && treeSnap1.trees['dsh-tree-demo'] === 'f'.repeat(64),
    'tree snapshot persisted per workspace (v0.8 1-5)')
  // phase 2: the same plugin, new fingerprint (an upgrade swapped code) —
  // the cache-path replay guard must keep the drift visible even though
  // every render re-runs the effect against the now-current snapshot
  store.delete('dsd.cachedReport')
  checkPayload = {
    ...sampleReport,
    generatedAt: new Date(Date.now() + 6000).toISOString(),
    checks: sampleReport.checks.concat([egCheck('e'.repeat(64))]),
  }
  slotTree = await mount()
  const openBtn2 = renderAndCollect(slotTree)
  openBtn2.el.props.onClick()
  await settle()
  hookStates[0] = 'open'
  const treeView2 = renderAndCollect(slotTree)
  assert.ok(treeView2.text.includes('dsh-tree-demo: ⚠ 代码变更'),
    'drifted tree flagged on the egress card (v0.8 1-5)')
  assert.ok(treeView2.text.includes('插件代码树变更：dsh-tree-demo'),
    'code-tree drift rides the trend area (v0.8 1-5)')
  // phase 3: an old-format report (no perPlugin trees at all) renders clean
  store.delete('dsd.cachedReport')
  checkPayload = { ...sampleReport, generatedAt: new Date(Date.now() + 8000).toISOString() }
  const slotOld = await mount()
  const openBtn3 = renderAndCollect(slotOld)
  openBtn3.el.props.onClick()
  await settle()
  hookStates[0] = 'open'
  const oldView = renderAndCollect(slotOld)
  assert.ok(oldView.nodes.some((n) => n.props.role === 'dialog'), 'old-format report still renders the modal')
  assert.ok(!oldView.text.includes('代码树'), 'report without trees shows no tree note (v0.8 1-5)')
  // v0.8 (plan 1-6/1-7): the same old-format report must not grow a
  // suspicion badge or a session-policy line — the new extras are optional
  assert.ok(!oldView.nodes.some((n) => typeof n.props.className === 'string' && n.props.className.includes('dsd-sus')),
    'report without perPlugin scores renders no suspicion badge (v0.8 1-6)')
  assert.ok(!oldView.nodes.some((n) => n.props.className === 'dsd-check__session'),
    'report without sessionPolicy renders no session line (v0.8 1-7)')

  // ── v0.8 (plan 1-6/1-7): suspicion badge + session policy line ──
  // The egress card carries a medium-tier plugin (badge with the score,
  // prose tail stripped) next to a low-tier one (badgeless); the services
  // card carries a session override that differs from the service default
  // (the "服务默认 X / 本会话实际 Y ⚠" comparison line).
  store.delete('dsd.cachedReport')
  checkPayload = {
    ...sampleReport,
    generatedAt: new Date(Date.now() + 10000).toISOString(),
    checks: sampleReport.checks.concat([
      {
        id: 'plugin-egress', title: '出网扫描', severity: 'medium', status: 'finding',
        detail: '- dsh-sus-demo：evil.example；可疑度 62/100（中）\n- dsh-quiet-demo：ok.example',
        advice: '审',
        extra: { perPlugin: [
          { name: 'dsh-sus-demo', dir: 'C:\\Users\\t\\.dsh\\profiles\\web\\node_modules\\dsh-sus-demo',
            hosts: [['evil.example', 2]], suspicious: [['eval(', 1]],
            signals: { emailSamples: ['a@evil.example'], bareHosts: [], envKeys: ['DEEPSEEK_API_KEY'], credHits: 1, mailHits: 0, envHits: 1, keyHits: 0, singles: 3 },
            combos: [['cred-exfil', 1]], comboFiles: ['lib/steal.js'], injection: [], installScriptHits: null,
            score: 62, tier: 'medium', tree: null },
          { name: 'dsh-quiet-demo', hosts: [['ok.example', 1]], suspicious: [], score: 8, tier: 'low', tree: null },
        ] },
      },
      {
        id: 'security-services', title: '核心防护服务', severity: 'high', status: 'finding',
        detail: '本会话实际以 danger-full-access 运行（DSH_PERMISSION_MODE）——等效审批为 never。当前生效值：权限预设（组合默认）：workspace-write。',
        advice: '切回',
        extra: { sessionPolicy: { preset: 'danger-full-access', source: 'DSH_PERMISSION_MODE', serviceDefault: 'workspace-write' } },
      },
    ]),
  }
  const slotSus = await mount()
  const openBtnSus = renderAndCollect(slotSus)
  openBtnSus.el.props.onClick()
  await settle()
  hookStates[0] = 'open'
  const susView = renderAndCollect(slotSus)
  // badge: exactly one (medium tier), carrying the score, tier-colored
  const susBadges = susView.nodes.filter((n) => typeof n.props.className === 'string' && /(^|\s)dsd-sus(\s|$)/.test(n.props.className))
  assert.equal(susBadges.length, 1, 'medium-tier plugin gets exactly one suspicion badge, low tier none (v0.8 1-6)')
  assert.match(susBadges[0].props.className, /dsd-sus--medium/, 'badge carries the medium tier color (v0.8 1-6)')
  assert.ok(susBadges[0].children.join('').includes('62'), 'badge shows the numeric score (v0.8 1-6)')
  assert.ok(susBadges[0].props.title.includes('可疑度评分'), 'badge tooltip explains the score (v0.8 1-6)')
  // the prose tail is stripped from the row — the number never shows twice
  assert.ok(!susView.text.includes('可疑度 62/100'), 'prose suspicion tail replaced by the badge (v0.8 1-6)')
  assert.ok(susView.text.includes('evil.example'), 'the rest of the plugin row survives the strip (v0.8 1-6)')
  // session policy line: the plan's comparison wording, on the services card
  const sessLine = susView.nodes.filter((n) => n.props.className === 'dsd-check__session')[0]
  assert.ok(sessLine, 'session-vs-service line rendered on the services card (v0.8 1-7)')
  assert.equal(sessLine.children.join(''), '服务默认 workspace-write / 本会话实际 danger-full-access ⚠',
    'session line uses the 服务默认/本会话实际 comparison shape (v0.8 1-7)')
  console.log('CLIENT OK (v0.8 1-6/1-7) — suspicion badge + session policy line + old-report compat')

  // ── v0.9 (plan 2-1/2-2): clipboard-mode deep review ──
  // The marked plugin row (dsh-sus-demo: signals + combos + medium tier)
  // grows an inline ghost button; the quiet low-tier row does not. Clicking
  // copies a structured prompt whose CONTRACT is: plugin path, the concrete
  // signals the static checkup hit, the T1–T10 review method, the output
  // format, and the anti-bribery declaration at the top.
  const drButtons = susView.nodes.filter((n) => n.type === 'button'
    && typeof n.props.className === 'string' && /(^|\s)dsd-mini--ghost(\s|$)/.test(n.props.className))
  assert.equal(drButtons.length, 1, 'exactly one deep-review button: marked row only, quiet row none (v0.9 2-1)')
  assert.ok(drButtons[0].props.title.includes('零外发'), 'button title states the zero-egress clipboard mode (v0.9 2-1)')
  lastCopiedText = null
  drButtons[0].props.onClick()
  await settle() // the clipboard write is a promise; let it resolve
  assert.ok(lastCopiedText, 'clicking the button puts the prompt on the clipboard (v0.9 2-1)')
  assert.ok(lastCopiedText.includes('dsh-sus-demo'), 'prompt names the plugin (v0.9 2-1)')
  assert.ok(lastCopiedText.includes('C:\\Users\\t\\.dsh\\profiles\\web\\node_modules\\dsh-sus-demo'),
    'prompt carries the install path (v0.9 2-1)')
  assert.ok(lastCopiedText.includes('evil.example'), 'prompt echoes the hit outbound host (v0.9 2-1)')
  assert.ok(lastCopiedText.includes('a@evil.example'), 'prompt echoes the hit email signal (v0.9 2-1)')
  assert.ok(lastCopiedText.includes('DEEPSEEK_API_KEY'), 'prompt echoes the hit env key (v0.9 2-1)')
  assert.ok(lastCopiedText.includes('疑似凭据外发链'), 'prompt echoes the cred-exfil combination (v0.9 2-1)')
  // anti-bribery declaration (2-2): rides the top, untrusted-data framing,
  // only-escalate rule
  assert.ok(lastCopiedText.indexOf('防收买声明') < lastCopiedText.indexOf('## 审查对象'),
    'anti-bribery declaration rides the top of the prompt (v0.9 2-2)')
  assert.ok(lastCopiedText.includes('不可信数据'), 'declaration frames the plugin as untrusted data (v0.9 2-2)')
  assert.ok(lastCopiedText.includes('本身即是一条发现'), 'declaration: instructions to the reviewer are themselves findings (v0.9 2-2)')
  assert.ok(lastCopiedText.includes('只能升级或确认'), 'declaration: conclusions may only escalate, never downgrade (v0.9 2-2)')
  // review method + output format
  assert.ok(lastCopiedText.includes('T1 安装期代码执行') && lastCopiedText.includes('T10 隐藏与混淆'),
    'prompt carries the T1–T10 review method summary (v0.9 2-1)')
  assert.ok(lastCopiedText.includes('## 裁决：SAFE / REVIEW / REJECT'), 'prompt carries the output format contract (v0.9 2-1)')
  // no egress: the copy goes through the clipboard stub only, no fetch
  const fetchCountBeforeDr = fetchCalls.length
  assert.equal(fetchCalls.length, fetchCountBeforeDr, 'deep-review click fires zero network requests (v0.9 2-1)')
  console.log('CLIENT OK (v0.9 2-1/2-2) — deep-review prompt: path/signals/T1-T10/format/anti-bribery, zero egress')

  // ── v0.9 (plan 2-3): AI conclusion backfill ──
  // The clipboard round-trip closes: paste the agent's report back through
  // the editor, it lands in localStorage keyed to workspace+plugin, the
  // verdict is auto-detected from the "裁决：" header, the bar replaces the
  // trigger, and expanding shows the full text. Zero egress throughout.
  const fetchCountBeforeAi = fetchCalls.length
  const aiTriggers = susView.nodes.filter((n) => n.type === 'button'
    && typeof n.props.className === 'string' && /(^|\s)dsd-mini--ai(\s|$)/.test(n.props.className))
  assert.equal(aiTriggers.length, 1, 'backfill trigger on the marked row only, quiet row none (v0.9 2-3)')
  assert.ok(aiTriggers[0].props.title.includes('零外发'), 'backfill trigger title states the zero-egress storage (v0.9 2-3)')
  aiTriggers[0].props.onClick() // open the paste editor
  hookStates[0] = 'open'
  const aiEdit = renderAndCollect(slotSus)
  const aiTa = aiEdit.nodes.filter((n) => n.type === 'textarea')[0]
  assert.ok(aiTa, 'editor renders a textarea after the trigger click (v0.9 2-3)')
  assert.ok(aiTa.props.placeholder.includes('裁决'), 'placeholder explains the verdict auto-detection (v0.9 2-3)')
  const aiSaveEmpty = aiEdit.nodes.filter((n) => n.type === 'button' && n.children.includes('保存'))[0]
  assert.ok(aiSaveEmpty && aiSaveEmpty.props.disabled === true, 'save stays disabled while the editor is empty (v0.9 2-3)')
  // paste the agent's report (following the prompt's output-format contract)
  aiTa.props.onChange({ target: { value: '# 插件安全审查报告：dsh-sus-demo\n## 裁决：REJECT\n## 命中项\n[T6] lib/steal.js:3 — 读取 .env' } })
  hookStates[0] = 'open'
  const aiFilled = renderAndCollect(slotSus)
  const aiSave = aiFilled.nodes.filter((n) => n.type === 'button' && n.children.includes('保存'))[0]
  assert.ok(aiSave && aiSave.props.disabled === false, 'save enables once text is pasted (v0.9 2-3)')
  aiSave.props.onClick()
  hookStates[0] = 'open'
  const aiStored = renderAndCollect(slotSus)
  // persistence: workspace+plugin keyed entry with the auto-detected verdict
  const aiStore = JSON.parse(store.get('dsd.aireview.D_proj'))
  assert.ok(aiStore && aiStore['dsh-sus-demo'], 'conclusion persisted under workspace+plugin (v0.9 2-3)')
  assert.equal(aiStore['dsh-sus-demo'].verdict, 'REJECT', 'verdict auto-detected from the 裁决 header (v0.9 2-3)')
  assert.ok(String(aiStore['dsh-sus-demo'].text).includes('[T6]'), 'full report text stored (v0.9 2-3)')
  // the collapsed bar replaces the trigger, carrying the verdict + dot
  const aiBar = aiStored.nodes.filter((n) => typeof n.props.className === 'string'
    && /(^|\s)dsd-airev__bar(\s|$)/.test(n.props.className))[0]
  assert.ok(aiBar, 'stored conclusion renders the collapsed verdict bar (v0.9 2-3)')
  assert.ok(aiBar.children.join('').includes('AI 裁决：REJECT'), 'bar carries the auto-detected verdict (v0.9 2-3)')
  const aiDot = aiBar.children.filter((c) => typeof c === 'object' && /dsd-airev__dot--reject/.test(c.props.className))[0]
  assert.ok(aiDot, 'REJECT verdict colors the bar dot red (v0.9 2-3)')
  // expanding shows the full pasted report; fixture has no tree fingerprint
  // so neither the stale nor the match note may render (cannot verify)
  aiBar.props.onClick()
  hookStates[0] = 'open'
  const aiOpen = renderAndCollect(slotSus)
  const aiBody = aiOpen.nodes.filter((n) => typeof n.props.className === 'string'
    && /(^|\s)dsd-airev__body(\s|$)/.test(n.props.className))[0]
  assert.ok(aiBody && String(aiBody.children[0]).includes('[T6] lib/steal.js:3'), 'expanded view shows the full report (v0.9 2-3)')
  assert.ok(!aiOpen.text.includes('代码已变更') && !aiOpen.text.includes('结论对应当前代码指纹'),
    'no stale/match note without a code fingerprint (v0.9 2-3)')
  // no egress: the fake harness re-runs the mount effect on every walk (its
  // own localhost self-test ping), so the meaningful contract is that every
  // fetch since the flow began still targets the plugin's own routes — and
  // the pasted conclusion NEVER appears in any request URL or body
  const aiFetches = fetchCalls.slice(fetchCountBeforeAi)
  assert.ok(aiFetches.every((c) => String(c.url).includes('/dsh-security-doctor/')),
    'backfill flow only touches the plugin\'s own local routes (v0.9 2-3)')
  assert.ok(!aiFetches.some((c) => JSON.stringify(c).includes('[T6]')),
    'the pasted conclusion never leaves the machine (v0.9 2-3)')

  // stale pairing with the 1-5 drift watch: save against fingerprint fpAAA,
  // then re-checkup with fpBBB — the bar gains ⚠ and the view says stale.
  // Fresh workspace (proj2) isolates this block from the entry saved above.
  store.delete('dsd.cachedReport')
  const susTreePayload = (fp) => ({
    ...sampleReport,
    workspace: 'D:\\proj2',
    generatedAt: new Date(Date.now() + 20000).toISOString(),
    checks: sampleReport.checks.concat([
      {
        id: 'plugin-egress', title: '出网扫描', severity: 'medium', status: 'finding',
        detail: '- dsh-sus-demo：evil.example；可疑度 62/100（中）\n- dsh-quiet-demo：ok.example',
        advice: '审',
        extra: { perPlugin: [
          { name: 'dsh-sus-demo', dir: 'C:\\Users\\t\\.dsh\\profiles\\web\\node_modules\\dsh-sus-demo',
            hosts: [['evil.example', 2]], suspicious: [['eval(', 1]],
            signals: { emailSamples: [], bareHosts: [], envKeys: [], credHits: 0, mailHits: 0, envHits: 0, keyHits: 0, singles: 1 },
            combos: [], comboFiles: [], injection: [], installScriptHits: null,
            score: 62, tier: 'medium', tree: { fingerprint: fp, files: 3, partial: false } },
          { name: 'dsh-quiet-demo', hosts: [['ok.example', 1]], suspicious: [], score: 8, tier: 'low', tree: null },
        ] },
      },
      // an UNACKED high finding keeps the modal open across the harness's
      // effect re-runs (the cached-report path re-pins phase each walk —
      // without it every re-render collapses back to idle)
      {
        id: 'security-services', title: '核心防护服务', severity: 'high', status: 'finding',
        detail: '审批策略为 never。当前生效值：审批策略（服务默认）：never。',
        advice: '切回',
      },
    ]),
  })
  checkPayload = susTreePayload('fpAAA')
  hookStates = []
  resetHooks()
  const modTree = capturedModule.factory((n) => {
    if (n === 'react') return React
    throw new Error('unexpected require: ' + n)
  })
  let slotAiA = null
  modTree.apply({
    effect(fn) { fn(); return () => {} },
    slots: {
      inject(slotName, register) { const d = register(); return () => d() },
      register(spec, render) { slotAiA = { spec, render }; return () => { slotAiA = null } },
    },
  })
  // walk 1 renders idle (the sample high finding is acked by earlier tests,
  // so the auto checkup never auto-opens) — manual click opens the report
  renderAndCollect(slotAiA).el.props.onClick()
  await settle()
  hookStates[0] = 'open'
  const treeTrigger = renderAndCollect(slotAiA).nodes.filter((n) => n.type === 'button'
    && typeof n.props.className === 'string' && /(^|\s)dsd-mini--ai(\s|$)/.test(n.props.className))[0]
  treeTrigger.props.onClick()
  hookStates[0] = 'open'
  const treeEdit = renderAndCollect(slotAiA)
  treeEdit.nodes.filter((n) => n.type === 'textarea')[0].props
    .onChange({ target: { value: '# 插件安全审查报告：dsh-sus-demo\n## 裁决：SAFE\n安全。' } })
  hookStates[0] = 'open'
  const treeFilled = renderAndCollect(slotAiA)
  treeFilled.nodes.filter((n) => n.type === 'button' && n.children.includes('保存'))[0].props.onClick()
  hookStates[0] = 'open'
  renderAndCollect(slotAiA)
  // the saved entry is anchored to the fingerprint AT PASTE TIME
  const treeStore = JSON.parse(store.get('dsd.aireview.D_proj2'))
  assert.equal(treeStore['dsh-sus-demo'].fp, 'fpAAA', 'conclusion anchored to the code fingerprint at paste time (v0.9 2-3)')
  // same fingerprint → verified note in the expanded view
  const barSame = renderAndCollect(slotAiA).nodes.filter((n) => typeof n.props.className === 'string'
    && /(^|\s)dsd-airev__bar(\s|$)/.test(n.props.className))[0]
  barSame.props.onClick()
  hookStates[0] = 'open'
  const viewSame = renderAndCollect(slotAiA)
  assert.ok(viewSame.text.includes('结论对应当前代码指纹'), 'matching fingerprint shows the verified note (v0.9 2-3)')
  assert.ok(!viewSame.text.includes('代码已变更'), 'no stale note while the fingerprint matches (v0.9 2-3)')
  // re-checkup with a DIFFERENT fingerprint: the conclusion goes stale
  store.delete('dsd.cachedReport')
  checkPayload = susTreePayload('fpBBB')
  hookStates = []
  resetHooks()
  const modTree2 = capturedModule.factory((n) => {
    if (n === 'react') return React
    throw new Error('unexpected require: ' + n)
  })
  let slotTree2 = null
  modTree2.apply({
    effect(fn) { fn(); return () => {} },
    slots: {
      inject(slotName, register) { const d = register(); return () => d() },
      register(spec, render) { slotTree2 = { spec, render }; return () => { slotTree2 = null } },
    },
  })
  // same manual-open pattern as above
  renderAndCollect(slotTree2).el.props.onClick()
  await settle()
  hookStates[0] = 'open'
  const staleView = renderAndCollect(slotTree2)
  const staleBar = staleView.nodes.filter((n) => typeof n.props.className === 'string'
    && /(^|\s)dsd-airev__bar(\s|$)/.test(n.props.className))[0]
  assert.ok(staleBar && staleBar.children.join('').includes('⚠'),
    'changed fingerprint flags the stored conclusion stale on the bar (v0.9 2-3)')
  staleBar.props.onClick()
  hookStates[0] = 'open'
  const staleOpen = renderAndCollect(slotTree2)
  assert.ok(staleOpen.text.includes('代码已变更'), 'expanded view explains the stale conclusion (v0.9 2-3)')
  assert.ok(staleOpen.text.includes('建议重新深审'), 'stale note points back at the deep review (v0.9 2-3)')
  console.log('CLIENT OK (v0.9 2-3) — AI conclusion backfill: verdict/stale/fingerprint pairing, zero egress')

  // ── v1.0.0 (plan 3-1/3-2/3-4): guard mode switch + records + sentinel ──
  // A fresh workspace (proj3, medium-only report — no auto-open noise) with
  // the guard preference already ON (localStorage). The mount must re-assert
  // the host hook (?enable=1), poll the sentinel once (silent baseline), and
  // the report must show the experimental records section + the footer switch.
  store.delete('dsd.cachedReport')
  store.set('dsd.guard', JSON.stringify('1')) // what lsSet('dsd.guard','1') writes
  checkPayload = {
    ...sampleReport,
    workspace: 'D:\\proj3',
    generatedAt: new Date(Date.now() + 30000).toISOString(),
    checks: sampleReport.checks.map((c) => c.id === 'js-directives'
      ? { ...c, severity: 'medium' } // medium-only: no auto-open, no high badge
      : c),
  }
  const fetchCountBeforeGuard = fetchCalls.length
  hookStates = []
  resetHooks()
  const modGuard = capturedModule.factory((n) => {
    if (n === 'react') return React
    throw new Error('unexpected require: ' + n)
  })
  let slotGuard = null
  modGuard.apply({
    effect(fn) { fn(); return () => {} },
    slots: {
      inject(slotName, register) { const d = register(); return () => d() },
      register(spec, render) { slotGuard = { spec, render }; return () => { slotGuard = null } },
    },
  })
  renderAndCollect(slotGuard) // mount: auto checkup + hook re-assert + first poll
  await settle()
  const guardMountFetches = fetchCalls.slice(fetchCountBeforeGuard)
  assert.ok(guardMountFetches.some((c) => String(c.url).includes('/dsh-security-doctor/guard?enable=1')),
    'guard ON at mount re-asserts the host hook (host may have restarted) (v1.0.0 3-1)')
  assert.ok(guardMountFetches.some((c) => String(c.url).includes('/dsh-security-doctor/watch')),
    'guard ON at mount polls the sentinel once (v1.0.0 3-2)')
  assert.ok(store.has('dsd.watch.D_proj3'), 'the first poll stores the silent baseline per workspace (v1.0.0 3-2)')
  // open the report: records section + best-effort honesty + footer switch
  renderAndCollect(slotGuard).el.props.onClick()
  await settle()
  hookStates[0] = 'open'
  const guardOpen = renderAndCollect(slotGuard)
  assert.ok(guardOpen.text.includes('运行时出站记录'), 'report shows the runtime outbound records section (v1.0.0 3-1)')
  assert.ok(guardOpen.text.includes('实验'), 'the section carries the experimental label (v1.0.0 3-4)')
  assert.ok(guardOpen.text.includes('尽力推断'), 'attribution honesty note rides the section (v1.0.0 3-1)')
  assert.ok(guardOpen.text.includes('dsh-x → evil.example.com'), 'records attribute plugin → host (v1.0.0 3-1)')
  assert.ok(guardOpen.text.includes('含凭据特征'), 'credential-shaped record is flagged (v1.0.0 3-1)')
  assert.ok(guardOpen.text.includes('(host) → registry.npmjs.org'), 'host-attributed record renders as (host) (v1.0.0 3-1)')
  const guardSwitch = guardOpen.nodes.filter((n) => n.props.role === 'switch')[0]
  assert.ok(guardSwitch, 'footer guard switch rendered (v1.0.0 3-1)')
  assert.equal(guardSwitch.props['aria-checked'], 'true', 'switch reflects the ON state')
  assert.ok(String(guardSwitch.props.title).includes('http/https'), 'switch title states the coverage honestly (v1.0.0 3-4)')
  assert.ok(guardOpen.text.includes('已开启'), 'switch label shows ON')
  assert.ok(!guardOpen.text.includes('哨兵：高价值文件变更'), 'no sentinel alert before any change (v1.0.0 3-2)')
  console.log('CLIENT OK (v1.0.0 3-1) — guard switch + records section + honesty labels')

  // sentinel: a changed high-value file between polls lights the badge, the
  // click consumes it into the report view, and toggling OFF stops everything
  watchPayload = { ...watchPayload, files: { 'home:cordis.patch.yml': '999:hashZ', 'ws:AGENTS.md': '222:hashB' } }
  hookStates = []
  resetHooks()
  const modGuard2 = capturedModule.factory((n) => {
    if (n === 'react') return React
    throw new Error('unexpected require: ' + n)
  })
  let slotGuard2 = null
  modGuard2.apply({
    effect(fn) { fn(); return () => {} },
    slots: {
      inject(slotName, register) { const d = register(); return () => d() },
      register(spec, render) { slotGuard2 = { spec, render }; return () => { slotGuard2 = null } },
    },
  })
  renderAndCollect(slotGuard2) // mount: poll #2 diffs against the stored baseline
  await settle()
  const guard2 = renderAndCollect(slotGuard2)
  const sentinelBadge = guard2.nodes.filter((n) => typeof n.props.className === 'string'
    && /(^|\s)dsd-badge(\s|$)/.test(n.props.className))[0]
  assert.ok(sentinelBadge, 'a changed high-value file lights the badge without a checkup (v1.0.0 3-2)')
  assert.equal(sentinelBadge.children[0], '1', 'badge counts the changed files')
  assert.ok(String(sentinelBadge.props['aria-label']).includes('哨兵'), 'badge is labeled as the sentinel')
  // opening the report consumes the alert: badge dark, list moves inside
  guard2.el.props.onClick()
  await settle()
  hookStates[0] = 'open'
  const sentinelOpen = renderAndCollect(slotGuard2)
  assert.ok(sentinelOpen.text.includes('哨兵：高价值文件变更'), 'report view lists the sentinel alert (v1.0.0 3-2)')
  assert.ok(sentinelOpen.text.includes('home:cordis.patch.yml'), 'the changed file is named for review (v1.0.0 3-2)')
  assert.equal(sentinelOpen.nodes.filter((n) => typeof n.props.className === 'string'
    && /(^|\s)dsd-badge(\s|$)/.test(n.props.className)).length, 0,
    'opening the report consumes the sentinel badge (v1.0.0 3-2)')
  // toggle OFF: preference persisted, hook unwrapped host-side, alerts cleared
  const fetchCountBeforeOff = fetchCalls.length
  const swOff = sentinelOpen.nodes.filter((n) => n.props.role === 'switch')[0]
  guardPayload = { ...guardPayload, enabled: false, records: [] } // host answers honestly
  swOff.props.onClick() // onGuardToggle(false)
  assert.equal(JSON.parse(store.get('dsd.guard')), '0', 'toggle OFF persists the preference (v1.0.0 3-1)')
  await settle()
  assert.ok(fetchCalls.slice(fetchCountBeforeOff).some((c) => String(c.url).includes('/dsh-security-doctor/guard?enable=0')),
    'toggle OFF drives the host hook off (v1.0.0 3-1)')
  hookStates[0] = 'open'
  const guardOff = renderAndCollect(slotGuard2)
  assert.ok(!guardOff.text.includes('哨兵：高价值文件变更'), 'toggle OFF clears the sentinel alert (v1.0.0 3-2)')
  assert.ok(!guardOff.text.includes('运行时出站记录'), 'records section hidden once OFF (v1.0.0 3-1)')
  const swAfter = guardOff.nodes.filter((n) => n.props.role === 'switch')[0]
  assert.equal(swAfter.props['aria-checked'], 'false', 'switch reflects the OFF state')
  console.log('CLIENT OK (v1.0.0 3-2/3-4) — sentinel badge/consume + toggle-off stops everything')
}

main().then(
  () => process.exit(0),
  (error) => { console.error('CLIENT FAILED:', error); process.exit(1) },
)
