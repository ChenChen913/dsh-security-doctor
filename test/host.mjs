/**
 * dsh-security-doctor — host-half integration test (v0.2).
 *
 * Loads lib/index.js with a fake `ctx` whose services are reachable ONLY via
 * `ctx.get()` (not property access — the v0.2 F2 fix), drives the registered
 * routes with mock req/res, and asserts: two exact routes registered, 405 on
 * POST, full JSON report on GET with real policy values read from the fake
 * service configs, approval=never upgrading severity, and a self-test route
 * reporting host load + version. Run with:
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

  // method guards
  for (const path of ['/dsh-security-doctor/check', '/dsh-security-doctor/self-test']) {
    const res = mockRes()
    await byPath[path].handler({ method: 'POST' }, res)
    assert.equal(res.code, 405, path + ' rejects POST')
  }

  // self-test route: proves host half loaded, reports version
  const resSelf = mockRes()
  await byPath['/dsh-security-doctor/self-test'].handler({ method: 'GET' }, resSelf)
  assert.equal(resSelf.code, 200)
  const self = JSON.parse(resSelf.body)
  assert.equal(self.ok, true)
  assert.equal(self.plugin, 'dsh-security-doctor')
  assert.match(self.version, /^\d+\.\d+\.\d+$/)
  assert.equal(self.hostLoaded, true)
  assert.equal(self.services.present.permissionPresets, true)
  assert.equal(self.services.approvalPolicy, 'ask')
  assert.equal(self.services.defaultPreset, 'workspace-write')

  // check route with ask + workspace-write → services check passes, values shown
  const res1 = mockRes()
  await byPath['/dsh-security-doctor/check'].handler({ method: 'GET' }, res1)
  assert.equal(res1.code, 200)
  assert.equal(res1.headers['cache-control'], 'no-store')
  const payload1 = JSON.parse(res1.body)
  assert.equal(payload1.ok, true)
  assert.equal(payload1.report.checks.length, 7)
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
  await check2.handler({ method: 'GET' }, res2)
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
  await check3.handler({ method: 'GET' }, res3)
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
