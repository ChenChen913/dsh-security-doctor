/**
 * dsh-security-doctor — host-half integration test (v0.3).
 *
 * Loads lib/index.js with a fake `ctx` whose services are reachable ONLY via
 * `ctx.get()` (not property access — the v0.2 F2 fix), drives the registered
 * routes with mock req/res, and asserts: two exact routes registered, 405 on
 * POST, full JSON report on GET with real policy values read from the fake
 * service configs, approval=never upgrading severity, and a self-test route
 * reporting host load + version. v0.3: the report carries pluginVersion (V3)
 * matching the self-test version, which also exposes reportVersion and a
 * validated ?latest= tag echo (V8). Run with:
 *
 *   node test/host.mjs
 */

import assert from 'node:assert/strict'
import { apply, name, inject } from '../lib/index.js'

function mockRes() {
  return {
    code: 0,
    headers: null,
    body: null,
    writeHead(code, headers) { this.code = code; this.headers = headers },
    end(body) { this.body = body ?? '' },
  }
}

function makeCtx() {
  const registrations = []
  // services hidden behind get() only — property access must NOT see them,
  // which is exactly the rc.5 situation that caused the false "not mounted"
  const services = {
    permissionPresets: { config: { defaultPreset: 'workspace-write' } },
    approval: { config: { policy: 'ask' } },
    sandbox: { config: {} },
    webServer: { register: undefined },
  }
  const ctx = {
    webServer: {
      register(spec) { registrations.push(spec); return () => registrations.pop() },
    },
    get(key) { return services[key] },
    effect(fn) { fn(); return () => {} },
  }
  return { ctx, registrations, services }
}

async function main() {
  assert.equal(name, 'dsh-security-doctor')
  assert.deepEqual(inject, ['webServer'])

  const { ctx, registrations } = makeCtx()
  const dispose = apply(ctx)

  assert.equal(registrations.length, 2, 'check + self-test routes')
  const byPath = Object.fromEntries(registrations.map((r) => [r.path, r]))
  assert.equal(byPath['/dsh-security-doctor/check'].kind, 'exact')
  assert.equal(byPath['/dsh-security-doctor/self-test'].kind, 'exact')

  // cross-site read guard (self-audit S1): no pairing header → 403;
  // cross-site Sec-Fetch-Site → 403 even with the header
  const H = { 'x-dsh-security-doctor': '1' }
  for (const path of ['/dsh-security-doctor/check', '/dsh-security-doctor/self-test']) {
    const noHeader = mockRes()
    await byPath[path].handler({ method: 'GET' }, noHeader)
    assert.equal(noHeader.code, 403, path + ' rejects missing pairing header')
    const crossSite = mockRes()
    await byPath[path].handler({ method: 'GET', headers: { ...H, 'sec-fetch-site': 'cross-site' } }, crossSite)
    assert.equal(crossSite.code, 403, path + ' rejects cross-site reads')
  }

  // method guards (with the pairing header)
  for (const path of ['/dsh-security-doctor/check', '/dsh-security-doctor/self-test']) {
    const res = mockRes()
    await byPath[path].handler({ method: 'POST', headers: H }, res)
    assert.equal(res.code, 405, path + ' rejects POST')
  }

  // self-test route: proves host half loaded, reports version
  const resSelf = mockRes()
  await byPath['/dsh-security-doctor/self-test'].handler({ method: 'GET', headers: H }, resSelf)
  assert.equal(resSelf.code, 200)
  const self = JSON.parse(resSelf.body)
  assert.equal(self.ok, true)
  assert.equal(self.plugin, 'dsh-security-doctor')
  assert.match(self.version, /^\d+\.\d+\.\d+$/)
  assert.equal(self.hostLoaded, true)
  assert.equal(self.services.present.permissionPresets, true)
  assert.equal(self.services.approvalPolicy, 'ask')
  assert.equal(self.services.defaultPreset, 'workspace-write')

  // v0.3 V8: self-test also carries the version /check reports, and echoes a
  // validated ?latest= tag (invalid or missing → null; never a write/fetch)
  assert.equal(self.reportVersion, self.version, 'reportVersion matches version')
  assert.equal(self.latestTagHint, null, 'no latest hint by default')
  const resHint = mockRes()
  await byPath['/dsh-security-doctor/self-test'].handler({ method: 'GET', headers: H, url: '/dsh-security-doctor/self-test?latest=v9.8.7' }, resHint)
  assert.equal(JSON.parse(resHint.body).latestTagHint, 'v9.8.7', 'valid ?latest is echoed')
  const resHintBad = mockRes()
  await byPath['/dsh-security-doctor/self-test'].handler({ method: 'GET', headers: H, url: '/dsh-security-doctor/self-test?latest=javascript:alert(1)' }, resHintBad)
  assert.equal(JSON.parse(resHintBad.body).latestTagHint, null, 'non-semver ?latest rejected')
  const resHintBare = mockRes()
  await byPath['/dsh-security-doctor/self-test'].handler({ method: 'GET', headers: H, url: '/dsh-security-doctor/self-test?latest=9.8.7' }, resHintBare)
  assert.equal(JSON.parse(resHintBare.body).latestTagHint, '9.8.7', 'bare semver accepted')

  // check route with ask + workspace-write → services check passes, values shown
  const res1 = mockRes()
  await byPath['/dsh-security-doctor/check'].handler({ method: 'GET', headers: H }, res1)
  assert.equal(res1.code, 200)
  assert.equal(res1.headers['cache-control'], 'no-store')
  const payload1 = JSON.parse(res1.body)
  assert.equal(payload1.ok, true)
  assert.equal(payload1.report.checks.length, 7)
  // v0.3 V3: the report states which plugin version produced it (client footer
  // + export/copy rely on it) and matches the self-test version
  assert.match(payload1.report.pluginVersion, /^\d+\.\d+\.\d+$/, 'report carries pluginVersion')
  assert.equal(payload1.report.pluginVersion, self.version, 'report version matches self-test version')
  const services1 = payload1.report.checks.filter((c) => c.id === 'security-services')[0]
  assert.equal(services1.status, 'pass')
  assert.match(services1.detail, /ask/)
  assert.match(services1.detail, /workspace-write/)

  // flip the fake policy to never → severity upgrades to high without reload
  const { ctx: ctx2, registrations: regs2 } = makeCtx()
  ctx2.get = (key) => key === 'approval'
    ? { config: { policy: 'never' } }
    : makeCtx().ctx.get(key)
  apply(ctx2)
  const check2 = regs2.filter((r) => r.path === '/dsh-security-doctor/check')[0]
  const res2 = mockRes()
  await check2.handler({ method: 'GET', headers: H }, res2)
  const services2 = JSON.parse(res2.body).report.checks.filter((c) => c.id === 'security-services')[0]
  assert.equal(services2.severity, 'high')
  assert.match(services2.detail, /never/)

  // services entirely absent (get returns undefined) → medium "not mounted"
  const ctx3 = {
    webServer: { register(spec) { regs3.push(spec); return () => {} } },
    get() { return undefined },
    effect(fn) { fn(); return () => {} },
  }
  const regs3 = []
  apply(ctx3)
  const check3 = regs3.filter((r) => r.path === '/dsh-security-doctor/check')[0]
  const res3 = mockRes()
  await check3.handler({ method: 'GET', headers: H }, res3)
  const services3 = JSON.parse(res3.body).report.checks.filter((c) => c.id === 'security-services')[0]
  assert.equal(services3.severity, 'medium')
  assert.match(services3.detail, /sandbox/)

  dispose()
  console.log('HOST OK — routes:', Object.keys(byPath).join(', '), '| verdict:', payload1.report.verdict)
}

main().then(
  () => process.exit(0),
  (error) => { console.error('HOST FAILED:', error); process.exit(1) },
)
