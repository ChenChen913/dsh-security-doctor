/**
 * dsh-security-doctor — host half (v0.3).
 *
 * Registers exact GET routes on the webServer:
 * - `/dsh-security-doctor/check` — runs the read-only checkup (lib/checks.js)
 *   and returns the report JSON (stamped with pluginVersion). No parameters,
 *   no writes, no host-side egress.
 * - `/dsh-security-doctor/self-test` — install self-verification: proves the
 *   host half loaded and the route is reachable, reports its version plus the
 *   version /check reports carry, and echoes an optional validated `?latest=`
 *   tag the client obtained from GitHub (V8 support hint — echo only).
 * - `/dsh-security-doctor/guard` — v1.0.0 guard mode (EXPERIMENTAL, default
 *   OFF): `?enable=1|0` toggles the runtime outbound-audit hook (lib/guard.js
 *   wraps http/https .request/.get and records who → where → credential-like
 *   into a bounded in-memory ring buffer); no param is a pure status query.
 *   Same pairing-header + Host guards as the other routes; the hook is
 *   registered for rollback via ctx.effect, so an unloaded plugin restores
 *   the original module exports.
 * - `/dsh-security-doctor/watch` — v1.0.0 sentinel (EXPERIMENTAL, polled
 *   only while guard mode is ON): stateless snapshot of the high-value small
 *   files (patch/config under the harness home + workspace instruction
 *   files, lib/watch.js) as `mtimeMs:fingerprint` strings. The client diffs
 *   consecutive snapshots per workspace (first = silent baseline) and raises
 *   the badge; the host keeps no memory, so restarts cannot false-alarm.
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
import { createGuard } from './guard.js'
import { createWatch } from './watch.js'

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
 *
 * v0.7 (review #9): DNS-rebinding guard. The pairing header alone is not
 * enough when a rebound origin is "same-origin from the browser's point of
 * view": a page at http://evil.com rebinds to 127.0.0.1, the browser treats
 * its fetch as same-origin and allows custom headers WITHOUT a preflight.
 * A rebound request still carries `Host: evil.com`, so the Host header must
 * name a local address (localhost / loopback / ::1 / 0.0.0.0) for the read
 * to be allowed. A missing Host header (HTTP/1.0 tools) is still accepted.
 *
 * v0.7.1 (feedback #5): LAN / reverse-proxy deployments. DSH accessed via a
 * LAN IP or an internal reverse-proxy domain would carry that Host and get a
 * blanket 403. `DSH_ALLOWED_HOSTS` (comma-separated hostnames, port optional)
 * extends the LOCAL whitelist for exactly those setups — default behavior
 * stays strictly local, and a rebinding attacker on an unlisted domain is
 * still rejected.
 */
const ALLOWED_HOSTS = String(process.env.DSH_ALLOWED_HOSTS ?? '')
  .split(',').map((entry) => entry.trim().toLowerCase())
  .map((entry) => {
    const bracket = /^\[([^\]]+)\]/.exec(entry)
    return (bracket ? bracket[1] : entry.split(':')[0])
  })
  .filter(Boolean)

function sameOriginRequest(req) {
  const headers = req.headers ?? {}
  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  if (headers[CLIENT_HEADER] !== '1') return false
  const host = headers.host
  if (typeof host === 'string' && host.length > 0) {
    const bracket = /^\[([^\]]+)\]/.exec(host)
    const hostname = (bracket ? bracket[1] : host.split(':')[0]).toLowerCase()
    const isLocal = hostname === 'localhost' || hostname === '::1' || hostname === '0.0.0.0' || /^127\./.test(hostname)
    if (!isLocal && !ALLOWED_HOSTS.includes(hostname)) return false
  }
  return true
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
 * v0.6.1 (review #7): also deep-walks the settings service (bounded) for
 * effective endpoint-ish values — the endpoint check then reports what is
 * ACTUALLY in effect, with the config grep as fallback only.
 * @returns {{ present: Record<string, boolean>, approvalPolicy?: string, defaultPreset?: string, endpoints?: string[] }}
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
  const endpoints = probeEffectiveEndpoints(ctx)
  if (endpoints.length > 0) info.endpoints = endpoints
  return info
}

/**
 * Bounded deep walk of the settings service config for endpoint overrides:
 * keys from the endpoint family, or any string value that is a full http(s)
 * URL, become "path.to.key = value" facts (max 20, depth 3 — this runs on
 * every checkup and must stay cheap). Returns [] when the service is absent
 * or exposes nothing endpoint-like; the config-file grep remains the net
 * underneath. Read-only property access, never throws.
 */
function probeEffectiveEndpoints(ctx) {
  const out = []
  const KEY_RE = /^(?:base[_-]?url|api[_-]?url|api[_-]?base|api[_-]?endpoint|endpoint|api[_-]?server|server[_-]?url)$/i
  const walk = (obj, path, depth) => {
    if (!obj || typeof obj !== 'object' || out.length >= 20 || depth > 3) return
    for (const key of Object.keys(obj)) {
      const value = obj[key]
      const p = path ? `${path}.${key}` : key
      if (typeof value === 'string') {
        // v0.7 (review): match by KEY only. The old extra test "value is a
        // full http(s) URL" reported every URL-shaped setting (docs links,
        // feedback URLs, update sources…) as an "endpoint", which is not what
        // the check means — it means where requests carrying credentials go.
        if (KEY_RE.test(key)) out.push(`${p} = ${value}`)
      } else if (typeof value === 'object') {
        walk(value, p, depth + 1)
      }
    }
  }
  for (const name of ['settings', 'llmSettings']) {
    const svc = getService(ctx, name)
    if (!svc) continue
    // service shape convention: live values under .config (see probeServices)
    walk(svc.config ?? svc, '', 0)
    if (out.length > 0) break
  }
  return out
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

  // ── v1.0.0 guard mode (experimental, default OFF) ─────────────────────────
  // The outbound-audit hook is created inert and only wraps http/https after
  // the user flips the report-footer switch (which drives the /guard route
  // below). Two rollback paths guarantee an unloaded plugin leaves no wrapper
  // behind: the ctx.effect cleanup Cordis runs on dispose, and the dispose
  // function apply() itself returns.
  const guard = createGuard()
  ctx.effect(() => () => { guard.disable() }, 'dsh-security-doctor: guard rollback')

  const disposeGuard = ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-security-doctor/guard',
    handler: async (req, res) => {
      if (!sameOriginRequest(req)) { forbidden(res); return }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
        return
      }
      // ?enable=1|0 toggles the hook; no param is a pure status query. The
      // state lives in host process memory only — nothing is persisted.
      let enableParam = null
      try {
        const raw = new URL(req.url ?? '', 'http://localhost').searchParams.get('enable')
        if (raw === '1' || raw === '0') enableParam = raw
        else if (raw !== null) {
          res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ ok: false, message: 'enable must be 1 or 0' }))
          return
        }
      } catch { /* unparseable URL — treat as a status query */ }
      if (enableParam === '1') guard.enable()
      if (enableParam === '0') guard.disable()
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({
        ok: true,
        enabled: guard.enabled,
        records: guard.records(),
        limit: guard.limit,
        // the UI must never present best-effort attribution as fact (plan 3-4)
        bestEffort: true,
      }))
    },
  })

  // ── v1.0.0 sentinel /watch (experimental, polled only while guard is ON) ──
  // Stateless on the host side: every call returns a fresh snapshot of the
  // high-value small files (patch/config under home + workspace instruction
  // files, lib/watch.js) as `mtimeMs:fingerprint` strings. The CLIENT diffs
  // consecutive snapshots per workspace (first one is a silent baseline) and
  // lights the badge — so a host restart produces no false alarm, and the
  // route itself can never be talked into remembering anything.
  const watch = createWatch({ home: home(), workspace: process.cwd() })

  const disposeWatch = ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-security-doctor/watch',
    handler: async (req, res) => {
      if (!sameOriginRequest(req)) { forbidden(res); return }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
        return
      }
      try {
        const snap = await watch.snapshot()
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({
          ok: true,
          workspace: snap.workspace,
          files: snap.files,
          count: Object.keys(snap.files).length,
          // polling sees point-in-time state only (plan 3-4 honesty label)
          bestEffort: true,
        }))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, message: String((error && error.message) || error) }))
      }
    },
  })

  // client half breadcrumb: announce the pairing in the browser console once
  ctx.effect(() => {
    if (typeof console === 'undefined') return () => {}
    console.info(`[dsh-security-doctor] host v${VERSION} loaded; routes: /dsh-security-doctor/check, /dsh-security-doctor/self-test, /dsh-security-doctor/guard, /dsh-security-doctor/watch`)
    return () => {}
  }, 'dsh-security-doctor: boot log')

  return () => { disposeSelfTest(); disposeRoute(); disposeGuard(); disposeWatch(); guard.disable() }
}
