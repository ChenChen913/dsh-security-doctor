/**
 * dsh-security-doctor — host-half integration test.
 *
 * Loads lib/index.js with a fake `ctx.webServer` that captures route
 * registrations, then drives the registered handler with mock req/res to
 * verify: exact path + method guard (405 on POST) and a full JSON report on
 * GET. Run with:
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

async function main() {
  assert.equal(name, 'dsh-security-doctor')
  assert.deepEqual(inject, ['webServer'])

  const registrations = []
  const ctx = {
    webServer: {
      register(spec) { registrations.push(spec); return () => registrations.pop() },
    },
    // services probed by the checkup: presets/approval mounted, sandbox absent
    permissionPresets: {},
    approval: {},
  }

  const dispose = apply(ctx)
  assert.equal(registrations.length, 1, 'exactly one route registered')
  assert.equal(registrations[0].kind, 'exact')
  assert.equal(registrations[0].path, '/dsh-security-doctor/check')

  const handler = registrations[0].handler

  const res405 = mockRes()
  await handler({ method: 'POST' }, res405)
  assert.equal(res405.code, 405)

  const res = mockRes()
  await handler({ method: 'GET' }, res)
  assert.equal(res.code, 200)
  assert.equal(res.headers['cache-control'], 'no-store')
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, true)
  assert.equal(payload.report.checks.length, 6)
  const byId = Object.fromEntries(payload.report.checks.map((c) => [c.id, c]))
  assert.equal(byId['security-services'].severity, 'medium', 'sandbox absent → medium')
  assert.match(byId['security-services'].detail, /sandbox/)

  dispose()
  assert.ok(typeof dispose === 'function')
  console.log('HOST OK — route returns', payload.report.verdict)
}

main().then(
  () => process.exit(0),
  (error) => { console.error('HOST FAILED:', error); process.exit(1) },
)
