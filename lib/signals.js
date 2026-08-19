/**
 * dsh-security-doctor — intent-signal engine (v0.8).
 *
 * Layered on top of the URL-level egress scan (checks.js C7): single
 * features are routine noise ("read .env", "spawn git", "send a request"),
 * COMBINATIONS are the signal ("read credentials + send somewhere in the
 * same file" is an exfil chain). Everything here is regex over
 * comment-stripped source — no execution, no parsing, and no claim of real
 * data-flow analysis: co-occurrence is file-level and labeled as such.
 *
 * Design rules (终极加固方案 v0.8, 1-1..1-6):
 * - single signals never raise severity alone (annotation only);
 * - combos cred-exfil / exec-channel / persistence are the high findings;
 * - suspicionScore is a transparent weighted sum, weights defined here in
 *   ONE place so calibration is a table edit, not a hunt;
 * - echoed samples are counts/hostnames/key NAMES only — key VALUES must
 *   never enter a report (S2 self-audit), so hardcoded-key hits report a
 *   count, never the literal.
 */

/** 1-1: hardcoded email addresses (the URL regex only saw schemes). */
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g

/** 1-1: mail-channel markers — nodemailer / smtp client config / mailto. */
const MAIL_CHANNEL_RE = /\bnodemailer\b|\bsmtp\b|\bmailto:|\bSendMail\b|\bsendmail\b/gi

/**
 * 1-1: config-style bare hostnames — `host: 'evil.example'` etc. The egress
 * scan only matched full URLs; a destination assembled from a config field
 * plus a scheme elsewhere was invisible.
 */
const BARE_HOST_RE = /(?:host|server|hostname|domain|endpoint|apiHost|baseUrl|base_url)\s*[:=]\s*['"]([A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,})['"]/g

/** 1-1: IP literals (excluding loopback / broadcast / version-like 4-part numbers are rare in code). */
const IP_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g

/** 1-2: credential-file string literals (covers path.join(dir, '.env') too). */
const CRED_FILE_RE = /['"][^'"]*\.credentials(?:\.yaml|\.yml)?['"]|['"][^'"]*\.env['"]/g

/** 1-2: env-var reads whose KEY looks like a secret (NODE_ENV/HOME stay out). */
const ENV_KEY_RE = /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[['"]([^'"]+)['"]\])/g
const SECRETISH_KEY_RE = /(?:key|token|secret|cred|passwd|password|apikey|api_key)/i

/** 1-2: a literal that IS a key (sk-…). Count only — the value never echoes. */
const HARDCODED_KEY_RE = /['"`](?:sk|rk|ghp|gho|xoxb|AKIA)[-_][A-Za-z0-9_-]{8,}['"`]/g

/** 1-3: process-execution API surface. */
const EXEC_API_RE = /child_process|\bexecSync\s*\(|\bspawnSync\s*\(|\bexec\s*\(|\bspawn\s*\(/g
/** 1-3: network-tool invocations smuggled through the exec API. */
const NET_TOOL_RE = /['"][^'"`\n]*(?:\bcurl\b|\bwget\b|\bnetcat\b|\bncat\b|\bnc\s)/g
/** 1-3: write API + startup-location literals → persistence combo. */
const WRITE_API_RE = /\bwriteFileSync\s*\(|\bwriteFile\s*\(|\bappendFileSync\s*\(|\bcreateWriteStream\s*\(/g
const STARTUP_RE = /shell:startup|CurrentVersion\\\\?Run|LaunchAgents|\.bashrc|\.zshrc|\.profile['"]|systemd|autorun|StartupItems/gi

/** 1-4: prompt-injection text markers (plugin-carried docs/rules). */
const INJECTION_RE_LIST = [
  /(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|rules?|prompts?|directives?|context)/i,
  /(?:忽略|无视|忘记|不理会)[^\n]{0,40}?(?:之前|以上|上述|上面|先前|前面)[^\n]{0,30}?(?:指令|指示|规则|提示|上下文|要求)/,
  /(?:send|email|upload|post|exfiltrate|抄送|发送到|发送至|上传至)[^\n]{0,120}?[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/i,
  /(?:secret|credential|token|api\s*key|密钥|凭据|令牌)[^\n]{0,80}?(?:send|upload|post|copy|抄送|发送|上传)/i,
]

/**
 * Count matches of one global regex (safe against zero-length loops).
 * @returns {number}
 */
function countMatches(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let n = 0
  while (g.exec(text) !== null) n++
  return n
}

/**
 * Scan one file's comment-stripped source for intent signals.
 * @param {string} text
 * @returns {{emails:number, emailSamples:string[], mailChannel:number, bareHosts:string[], ips:number, credFile:number, envKeyReads:string[], hardcodedKey:number, execApi:number, netTool:number, writeApi:number, startup:number}}
 */
export function scanCodeSignals(text) {
  const src = String(text ?? '')
  const emailSamples = []
  {
    const g = new RegExp(EMAIL_RE.source, EMAIL_RE.flags)
    let m
    while ((m = g.exec(src)) !== null && emailSamples.length < 3) emailSamples.push(m[0])
  }
  const bareHosts = []
  {
    const g = new RegExp(BARE_HOST_RE.source, BARE_HOST_RE.flags)
    let m
    while ((m = g.exec(src)) !== null) {
      const host = m[1].toLowerCase()
      if (host !== 'localhost' && !host.startsWith('127.') && !bareHosts.includes(host) && bareHosts.length < 5) bareHosts.push(host)
    }
  }
  const envKeyReads = []
  {
    const g = new RegExp(ENV_KEY_RE.source, ENV_KEY_RE.flags)
    let m
    while ((m = g.exec(src)) !== null) {
      const key = m[1] ?? m[2] ?? ''
      if (SECRETISH_KEY_RE.test(key) && !envKeyReads.includes(key) && envKeyReads.length < 5) envKeyReads.push(key)
    }
  }
  return {
    emails: countMatches(src, EMAIL_RE),
    emailSamples,
    mailChannel: countMatches(src, MAIL_CHANNEL_RE),
    bareHosts,
    ips: countMatches(src, IP_RE),
    credFile: countMatches(src, CRED_FILE_RE),
    envKeyReads,
    hardcodedKey: countMatches(src, HARDCODED_KEY_RE),
    execApi: countMatches(src, EXEC_API_RE),
    netTool: countMatches(src, NET_TOOL_RE),
    writeApi: countMatches(src, WRITE_API_RE),
    startup: countMatches(src, STARTUP_RE),
  }
}

/**
 * File-level combination rules (1-3) — the point where "routine" becomes
 * "chain". @param {ReturnType<scanCodeSignals>} s @param {number} urlCount
 * @returns {Array<'cred-exfil'|'exec-channel'|'persistence'>}
 */
export function combineFileSignals(s, urlCount = 0) {
  const combos = []
  const hasEgress = urlCount > 0 || s.emails > 0 || s.mailChannel > 0 || s.bareHosts.length > 0 || s.ips > 0
  const hasCred = s.credFile > 0 || s.envKeyReads.length > 0 || s.hardcodedKey > 0
  if (hasCred && hasEgress) combos.push('cred-exfil')
  if (s.execApi > 0 && s.netTool > 0) combos.push('exec-channel')
  if (s.writeApi > 0 && s.startup > 0) combos.push('persistence')
  return combos
}

/**
 * 1-4: scan plugin-carried TEXT (README / rules / docs) for prompt-injection
 * markers. Text is scanned verbatim (no comment stripping — prose has none)
 * and hit samples are echoed for human review (they are the evidence).
 * @returns {string[]} matched marker descriptions (first line of context, capped)
 */
export function scanTextInjection(text) {
  const src = String(text ?? '')
  const hits = []
  for (const re of INJECTION_RE_LIST) {
    const m = re.exec(src)
    if (m) hits.push(m[0].slice(0, 120))
  }
  return hits
}

/**
 * 1-6: per-plugin suspicion score, 0-100. Transparent weighted sum over
 * host-known facts only (tree drift is a CLIENT-side diff, appended there).
 * Weights live in this one table on purpose.
 * @param {object} p
 * @param {number} p.combos combo hits across the plugin's files
 * @param {number} p.singles single-signal files
 * @param {number} p.obfuscation obfuscation/dynamic-call signal files (v0.7.1)
 * @param {number} p.injection prompt-injection text hits
 * @param {boolean} p.installScript ships prepare/postinstall
 * @param {boolean} p.pinned version reference pinned
 * @param {boolean} p.opaqueNoSource no scannable source at all
 * @returns {{score:number, tier:'low'|'medium'|'high'}}
 */
export function suspicionScore(p) {
  let score = 0
  score += Math.min(2, p.combos) * 50
  score += Math.min(3, p.injection) * 25
  score += p.obfuscation > 0 ? 12 : 0
  score += p.installScript ? 10 : 0
  score += p.pinned ? 0 : 10
  score += p.opaqueNoSource ? 15 : 0
  score += Math.min(5, p.singles) * 4
  score = Math.max(0, Math.min(100, score))
  const tier = score >= 50 ? 'high' : score >= 20 ? 'medium' : 'low'
  return { score, tier }
}
