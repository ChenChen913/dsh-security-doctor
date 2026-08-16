/**
 * dsh-security-doctor — client-half structural test (v0.2).
 *
 * Loads lib/client.js through a fake `window.__ModuleLoader__`, calls the
 * captured factory with a stubbed `require('react')` (a tiny hooks-capable
 * fake), applies the plugin to a fake slots context, renders the footer
 * component, and asserts the v0.2 UI contract: button a11y labels, mount-time
 * auto checkup (fake fetch), open modal with dialog semantics, severity-sorted
 * cards with the high card first, and prescription/copy/export controls.
 * Run with:
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
  verdict: '测试判词',
  summary: { high: 1, medium: 1, low: 0, info: 0, error: 0 },
  checks: [
    { id: 'third-party-plugins', title: '盘点', severity: 'medium', status: 'finding', detail: '- dsh-x', advice: '审' },
    { id: 'js-directives', title: 'JS 检查', severity: 'high', status: 'finding', detail: 'profiles\\web\\cordis.patch.yml:6: x', advice: '查' },
    { id: 'external-endpoints', title: '端点', severity: 'info', status: 'pass', detail: '无', advice: 'ok' },
  ],
}

let capturedModule = null
let fetchCalls = []
globalThis.window = {
  __ModuleLoader__: { load(m) { capturedModule = m } },
  fetch(url) {
    fetchCalls.push(String(url))
    if (String(url).includes('/self-test')) {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, version: '0.2.0' }) })
    }
    return Promise.resolve({ json: () => Promise.resolve({ ok: true, report: sampleReport }) })
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
  assert.ok(fetchCalls.some((u) => u.includes('/dsh-security-doctor/self-test')), 'self-test pinged on mount')
  assert.ok(fetchCalls.some((u) => u.includes('/dsh-security-doctor/check')), 'auto checkup ran on mount')
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
}

main().then(
  () => process.exit(0),
  (error) => { console.error('CLIENT FAILED:', error); process.exit(1) },
)
