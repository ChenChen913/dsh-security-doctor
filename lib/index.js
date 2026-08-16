/**
 * dsh-security-doctor — host half (v0.2).
 *
 * Registers two exact GET routes on the webServer:
 * - `/dsh-security-doctor/check` — runs the read-only checkup (lib/checks.js)
 *   and returns the report JSON. No parameters, no writes, no egress.
 * - `/dsh-security-doctor/self-test` — install self-verification: proves the
 *   host half loaded and the route is reachable, and reports which protection
 *   services it can see.
 *
 * Service probing uses `ctx.get(name)` (the official Cordis access path for
 * services the plugin does not inject); property access only resolves for
 * injected services, which made early builds report false "not mounted".
 * Optional policy values are read defensively from service configs and
 * degrade to presence-only when the shape is unknown.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runSecurityCheckup } from './checks.js'

const execFileAsync = promisify(execFile)

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

export const name = 'dsh-security-doctor'
export const inject = ['webServer']

/** Read one optional service via the official ctx.get() path; never throws. */
function getService(ctx, key) {
  try {
    if (typeof ctx.get === 'function') return ctx.get(key) ?? undefined
  } catch {
    // service not yet ready or name unknown — fall through to property probe
  }
  try {
    return ctx[key] ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Probe protection-service presence plus cheaply-readable policy values.
 * @returns {{ present: Record<string, boolean>, approvalPolicy?: string, defaultPreset?: string }}
 */
function probeServices(ctx) {
  const keys = ['permissionPresets', 'approval', 'sandbox', 'webServer']
  const present = {}
  for (const key of keys) present[key] = Boolean(getService(ctx, key))

  const info = { present }
  const approval = getService(ctx, 'approval')
  try {
    if (approval && typeof approval === 'object' && typeof approval.config === 'object'
      && (approval.config.policy === 'ask' || approval.config.policy === 'never')) {
      info.approvalPolicy = approval.config.policy
    }
  } catch { /* unknown service shape — presence only */ }
  const presets = getService(ctx, 'permissionPresets')
  try {
    if (presets && typeof presets === 'object' && typeof presets.config === 'object'
      && typeof presets.config.defaultPreset === 'string') {
      info.defaultPreset = presets.config.defaultPreset
    }
  } catch { /* unknown service shape — presence only */ }
  return info
}

/** Read-only icacls ACL query with fixed arguments (no shell, no user input). */
async function icaclsRunner(file) {
  const { stdout } = await execFileAsync('icacls', [file])
  return stdout
}

export function apply(ctx) {
  const home = () => process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')

  const disposeSelfTest = ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-security-doctor/self-test',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({
        ok: true,
        plugin: name,
        version: VERSION,
        hostLoaded: true,
        services: probeServices(ctx),
        selfTestAt: new Date().toISOString(),
      }))
    },
  })

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
        const report = await runSecurityCheckup({
          home: home(),
          workspace: process.cwd(),
          services: probeServices(ctx),
          platform: process.platform,
          icacls: process.platform === 'win32' ? icaclsRunner : undefined,
        })
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: true, report }))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, message: String((error && error.message) || error) }))
      }
    },
  })

  // client half breadcrumb: announce the pairing in the browser console once
  ctx.effect(() => {
    if (typeof console === 'undefined') return () => {}
    console.info(`[dsh-security-doctor] host v${VERSION} loaded; routes: /dsh-security-doctor/check, /dsh-security-doctor/self-test`)
    return () => {}
  }, 'dsh-security-doctor: boot log')

  return () => { disposeSelfTest(); disposeRoute() }
}
