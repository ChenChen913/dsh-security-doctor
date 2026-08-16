/**
 * dsh-security-doctor — host half.
 *
 * Registers one exact GET route `/dsh-security-doctor/check` on the webServer.
 * The route runs the read-only checkup (lib/checks.js) and returns the report
 * as JSON. It accepts no parameters and performs no writes, no shell, and no
 * network egress. The client half (lib/client.js) is the sidebar button that
 * fetches this route and renders the report panel.
 */

import path from 'node:path'
import os from 'node:os'
import { runSecurityCheckup } from './checks.js'

export const name = 'dsh-security-doctor'
export const inject = ['webServer']

/** Probe service presence by property access; absent services stay undefined. */
function probeServices(ctx) {
  const probe = (key) => {
    try {
      return Boolean(ctx[key])
    } catch {
      return false
    }
  }
  return {
    permissionPresets: probe('permissionPresets'),
    approval: probe('approval'),
    sandbox: probe('sandbox'),
    webServer: probe('webServer'),
  }
}

export function apply(ctx) {
  const disposeRoute = ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-security-doctor/check',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
        return
      }
      try {
        const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
        const report = await runSecurityCheckup({
          home,
          workspace: process.cwd(),
          services: probeServices(ctx),
        })
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: true, report }))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, message: String((error && error.message) || error) }))
      }
    },
  })

  return () => { disposeRoute() }
}
