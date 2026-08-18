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
 * −10·medium…), status dots, dot+count capsules. Run with:
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
  pluginVersion: '0.5.0',
  verdict: '测试判词',
  summary: { high: 1, medium: 1, low: 0, info: 0, error: 0 },
  checks: [
    // V5-1 fixture: line 1 has a slash inside Chinese prose (must stay plain
    // text), line 2 a home path followed by a full-width paren (chip must cut
    // exactly before it), line 3 a github dep spec (no chip)
    { id: 'third-party-plugins', title: '盘点', severity: 'medium', status: 'finding', detail: '- dsh-x', advice: '审' },
    { id: 'js-directives', title: 'JS 检查', severity: 'high', status: 'finding',
      detail: '在 cordis 补丁/配置文件中发现 !!js 指令\n未发现 ~/.dsh/.credentials.yaml（Key 可能来自环境变量）\n依赖 github:ChenChen913/dsh-security-doctor#v0.4.0) 已锁定', advice: '查' },
    { id: 'external-endpoints', title: '端点', severity: 'info', status: 'pass', detail: '无', advice: 'ok' },
  ],
}

let capturedModule = null
let fetchCalls = []
let ghLatest = { tag_name: 'v9.9.9' } // what the fake GitHub release API returns
let ghStatus = 200 // 404 → "no release published" path (user finding 3.2-4)
let checkPayload = sampleReport // mount/auto checkup response (user finding 3.2-5)
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
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, version: '0.5.0' }) })
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
// minimal DOM surface the style effect and modal focus-management touch
globalThis.document = {
  activeElement: null,
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '', remove() {}, style: {}, click() {} }),
  body: { appendChild() {} },
  head: { appendChild() {} },
}

// Node 21+ ships a built-in global navigator whose language follows the OS
// locale — pin it so the i18n branch under test is deterministic (CI runners
// are en-US; a Chinese dev machine is zh-CN; both must pass the same suite)
function setNavigator(language) {
  Object.defineProperty(globalThis, 'navigator', { value: { language }, configurable: true })
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
  const cards = findAll(open, (n) => typeof n.props.className === 'string' && /(^|\s)dsd-check(\s|$)/.test(n.props.className))
  assert.equal(cards.length, 3, 'three check cards')
  const titles = cards.map((c) => {
    const head = c.children.filter((ch) => typeof ch === 'object' && ch.props.className === 'dsd-check__head')[0]
    const title = head.children.filter((ch) => typeof ch === 'object' && ch.props.className === 'dsd-check__title')[0]
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
  assert.ok(upd0.text.includes('插件 v0.5.0'), 'report footer shows plugin version')
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
  const updBtn3 = manualOpen.nodes.filter((n) => n.type === 'button').find((b) => b.children.join('').includes('检查更新'))
  updBtn3.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))
  const after404 = renderAndCollect(slot3)
  assert.ok(after404.text.includes('未查询到已发布的 Release'), '404 surfaces the no-release message (3.2-4)')
  assert.ok(!after404.text.includes('不可达'), '404 is not reported as network failure')
  console.log('CLIENT OK (3.2-4/3.2-5) — no auto-open without high; 404 wording distinct')
}

main().then(
  () => process.exit(0),
  (error) => { console.error('CLIENT FAILED:', error); process.exit(1) },
)
