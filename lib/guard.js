/**
 * dsh-security-doctor — runtime outbound audit hook (v1.0.0, guard mode).
 *
 * EXPERIMENTAL, default OFF, opt-in from the report footer switch. When
 * enabled, the host half wraps the node:http / node:https module exports
 * (.request / .get) so every outbound call made by ANY code in this process
 * (third-party plugins, harness internals) is recorded into a bounded
 * in-memory ring buffer: who (best-effort call-stack attribution), where
 * (hostname), how (method), and whether credential-like patterns were
 * present in the headers or the first request-body chunk.
 *
 * Honest limitations, stated up front (plan 3-1 "best-effort" / 3-4 boundary):
 * - Attribution parses the synchronous call stack; advanced code can spoof
 *   or hide its frames. The UI labels every record as best-effort.
 * - Only the http/https MODULE EXPORTS are wrapped. fetch (undici), raw
 *   net/tls sockets, and modules that captured the original function
 *   references before the hook are NOT covered.
 * - Bodies are never stored — only a boolean "credential-like" flag matched
 *   against common key/token shapes; hosts are recorded as hostnames only.
 *   No secrets enter the buffer.
 * - The hook lives in plugin process memory: disable() restores the original
 *   exports, and the host route registers a ctx.effect rollback so an
 *   unloaded plugin leaves no wrapper behind.
 *
 * The factory is dependency-injected ({ http, https, now, stackOf, limit })
 * so the unit tests (test/guard.mjs) drive it with fake modules instead of
 * patching the real ones.
 */

import http from 'node:http'
import https from 'node:https'

/** Ring-buffer cap for the audit records (oldest dropped first). */
const DEFAULT_LIMIT = 50

/** Header names whose mere presence means credentials ride the request. */
const CRED_HEADER_RE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$/i

/**
 * Credential-like SHAPES sniffed from the first body chunk. Deliberately
 * shape-based (key/token prefixes), not content-based: we record a boolean,
 * never the matching text itself.
 */
const CRED_BODY_RE = /(?:sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/=-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|api[_-]?key\s*[=:]["']?\w{8,}|(?:secret|token|password|credential)[_a-z]*\s*[=:]\s*["']?[A-Za-z0-9._~+/=-]{12,})/i

/** Largest first-chunk size we are willing to stringify for the sniff. */
const SNIFF_MAX_CHARS = 65536

/** Strip a port from a raw host string ("h:1" / "[::1]:1" / "h"). */
function hostOf(raw) {
  if (typeof raw !== 'string' || raw === '') return null
  const bracket = /^\[([^\]]+)\]/.exec(raw)
  if (bracket) return bracket[1]
  const idx = raw.indexOf(':')
  return idx === -1 ? raw : raw.slice(0, idx)
}

/**
 * Best-effort attribution: the first stack frame that names a package under
 * node_modules/<name>/ and is not this plugin's own wrapper frames. Frames
 * from harness core (no node_modules) attribute to null → "(host)".
 */
function attributeStack(stack) {
  const lines = String(stack ?? '').split('\n')
  for (const line of lines) {
    if (line.includes('dsh-security-doctor')) continue // our own wrapper path
    const m = /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(line)
    if (m) return m[1].replace(/\\/g, '/') // Windows stacks use backslashes
  }
  return null
}

/**
 * Normalize (url | URL-like | options[, options][, cb]) call shapes into
 * { host, method, credHeaders }. Never throws — a malformed call shape must
 * not break the audited request itself.
 */
function targetOf(args) {
  const a0 = args[0]
  const a1 = args[1]
  let options = null
  let urlString = null
  if (typeof a0 === 'string') {
    urlString = a0
    if (a1 && typeof a1 === 'object') options = a1
  } else if (a0 && typeof a0 === 'object' && typeof a0.href === 'string') {
    // URL instance (or lookalike): http.request(new URL(...), options, cb)
    urlString = a0.href
    if (a1 && typeof a1 === 'object') options = a1
  } else if (a0 && typeof a0 === 'object') {
    options = a0
  }
  let host = null
  let method = 'GET'
  let credHeaders = false
  if (options) {
    if (typeof options.method === 'string' && options.method) method = options.method.toUpperCase()
    host = hostOf(options.hostname ?? options.host ?? null)
    // url-embedded credentials (options.auth = "user:pass") count too
    if (options.auth) credHeaders = true
    const headers = options.headers
    if (headers && typeof headers === 'object') {
      if (Array.isArray(headers)) {
        for (let i = 0; i + 1 < headers.length; i += 2) {
          if (CRED_HEADER_RE.test(String(headers[i]))) { credHeaders = true; break }
        }
      } else {
        for (const key of Object.keys(headers)) {
          if (CRED_HEADER_RE.test(key)) { credHeaders = true; break }
        }
      }
    }
  }
  if (urlString) {
    try {
      const u = new URL(urlString)
      if (!host) host = u.hostname
      // credentials in the URL itself (https://key@host/) are credential-ish
      if (u.username || u.password) credHeaders = true
    } catch { /* not a full URL (a bare path?) — keep what options gave us */ }
  }
  return { host: host || '(unknown)', method, credHeaders }
}

/**
 * Create a guard instance. Nothing is wrapped until enable() — the default
 * state is OFF and the factory stays pure until the user opts in.
 *
 * @param {object} [options]
 * @param {object} [options.http] module whose .request/.get get wrapped (default node:http)
 * @param {object} [options.https] second module (default node:https)
 * @param {() => string} [options.now] timestamp factory (injectable for tests)
 * @param {() => string} [options.stackOf] call-stack factory (injectable for tests)
 * @param {number} [options.limit] ring-buffer cap (default 50)
 * @returns {{ enable(): void, disable(): void, records(): object[], enabled: boolean, limit: number }}
 */
export function createGuard(options = {}) {
  const httpMod = options.http ?? http
  const httpsMod = options.https ?? https
  const now = options.now ?? (() => new Date().toISOString())
  const stackOf = options.stackOf ?? (() => (new Error('guard').stack ?? ''))
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT)
  const records = []
  let enabled = false
  const patches = []

  function enable() {
    if (enabled) return
    enabled = true
    for (const mod of [httpMod, httpsMod]) {
      wrap(mod, 'request')
      wrap(mod, 'get')
    }
  }

  /** Unwrap every patch; records are kept so a just-disabled guard stays readable. */
  function disable() {
    enabled = false
    while (patches.length > 0) {
      const p = patches.pop()
      try { p.mod[p.key] = p.original } catch { /* frozen module — leave the wrapper */ }
    }
  }

  function listRecords() { return records.slice() }

  /** Wrap one module export; the wrapper must never break the audited call. */
  function wrap(mod, key) {
    const original = mod[key]
    if (typeof original !== 'function') return
    const wrapped = function (...args) {
      let rec = null
      try {
        const target = targetOf(args)
        rec = {
          at: now(),
          plugin: attributeStack(stackOf()),
          host: target.host,
          method: target.method,
          credHeaders: target.credHeaders,
          credBody: false,
        }
        records.push(rec)
        if (records.length > limit) records.splice(0, records.length - limit)
      } catch { /* auditing must never throw into the audited call */ }
      const req = original.apply(this, args)
      try {
        if (rec && req && typeof req.write === 'function') sniffWrites(req, rec)
      } catch { /* attach failed — record keeps header-level info only */ }
      return req
    }
    mod[key] = wrapped
    patches.push({ mod, key, original })
  }

  /** Watch the FIRST write only: flag credential-like bodies, store nothing. */
  function sniffWrites(req, rec) {
    const originalWrite = req.write
    let sniffed = false
    req.write = function (chunk, ...rest) {
      if (!sniffed && chunk !== null && chunk !== undefined) {
        sniffed = true
        try {
          let text
          if (typeof chunk === 'string') text = chunk
          else if (typeof chunk === 'object' && typeof chunk.length === 'number') text = Buffer.from(chunk).toString('utf8')
          else text = String(chunk)
          if (text.length <= SNIFF_MAX_CHARS && CRED_BODY_RE.test(text)) rec.credBody = true
        } catch { /* opaque chunk — leave the flag untouched */ }
      }
      return originalWrite.call(req, chunk, ...rest)
    }
  }

  return { enable, disable, records: listRecords, get enabled() { return enabled }, get limit() { return limit } }
}
