/**
 * dsh-security-doctor — host half (v0.3).
 *
 * Registers two exact GET routes on the webServer:
 * - `/dsh-security-doctor/check` — runs the read-only checkup (lib/checks.js)
 *   and returns the report JSON (stamped with pluginVersion). No parameters,
 *   no writes, no host-side egress.
 * - `/dsh-security-doctor/self-test` — install self-verification: proves the
 *   host half loaded and the route is reachable, reports its version plus the
 *   version /check reports carry, and echoes an optional validated `?latest=`
 *   tag the client obtained from GitHub (V8 support hint — echo only).
 *
 * The plugin's single explicit egress lives in the client half: a manual,
 * click-triggered "check update" query to api.github.com (V4). The host never
 * makes outbound requests.
 *
 * Service probing uses `ctx.get()` (the official Cordis access path for
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

/** Client-pairing header required on both routes (self-audit S1 guard). */
const CLIENT_HEADER = 'x-dsh-security-doctor'

export const name = 'dsh-security-doctor'
export const inject = ['webServer']

/**
 * Reject cross-site browser reads of the report routes. A custom header cannot
 * be attached by another origin without a CORS preflight, and this server
 * never grants one — so any request carrying it is our own client (or an
 * intentional same-origin caller). `Sec-Fetch-Site`, when the browser sends
 * it, is checked as a second, browser-native signal. Non-browser callers
 * (curl) pass by sending the header explicitly.
 */
function sameOriginRequest(req) {
  const headers = req.headers ?? {}
  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  return headers[CLIENT_HEADER] === '1'
}

function forbidden(res) {
  res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify({ ok: false, message: `forbidden: send the ${CLIENT_HEADER}: 1 header (cross-site read guard)` }))
}

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

/**
 * Echo the `?latest=<tag>` query param back as latestTagHint, but only when it
 * looks like a semver tag — the client passes the release tag it just fetched
 * from GitHub (V4) so a curl rerun of self-test shows current AND latest side
 * by side (V8). Pure echo of a validated string; nothing is ever written or
 * fetched host-side.
 */
function latestTagHint(req) {
  try {
    const raw = new URL(req.url ?? '', 'http://localhost').searchParams.get('latest')
    return typeof raw === 'string' && /^v?\d+\.\d+\.\d+$/.test(raw) ? raw : null
  } catch {
    return null
  }
}

/**
 * Report language (user finding v0.5-4): the client passes its UI locale via
 * `?lang=` so an English browser gets an English report body instead of
 * English buttons around Chinese text. Anything other than 'en' means zh.
 */
function reportLocale(req) {
  try {
    return new URL(req.url ?? '', 'http://localhost').searchParams.get('lang') === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

export function apply(ctx) {
  const home = () => process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')

  const disposeSelfTest = ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-security-doctor/self-test',
    handler: async (req, res) => {
      if (!sameOriginRequest(req)) { forbidden(res); return }
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
        reportVersion: VERSION, // the version /check reports carry — same const, same story (V8)
        latestTagHint: latestTagHint(req),
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
      if (!sameOriginRequest(req)) { forbidden(res); return }
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
          pluginVersion: VERSION, // shown in the report footer; flows into export/copy (V3)
          locale: reportLocale(req), // v0.5-4: report body language follows the client UI locale
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
