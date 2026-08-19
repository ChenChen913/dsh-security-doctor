/**
 * dsh-security-doctor — check engine (v0.4).
 *
 * Pure read-only checks over the harness home (`~/.dsh`) and the workspace.
 * Every check is independent: one failing check degrades to `error` and the
 * rest still run. Nothing here evaluates config, executes plugin code, or
 * makes network requests — the only external command ever spawned (Windows
 * credential-ACL query via `icacls`) is injected by the caller and runs with
 * fixed arguments. Credential *contents* are never read: permission bits and
 * ACL account names only.
 *
 * Path layout expectations follow the official publish docs (profiles/,
 * cordis.patch.yml, settings.yaml). Unknown layout degrades to `error`
 * findings, never a crash.
 *
 * v0.4 i18n (user finding v0.5-4): every title/detail/advice is bilingual.
 * `runSecurityCheckup({ locale })` picks the table ('zh' default, 'en'
 * available); the host route forwards ?lang= from the client so an English
 * system gets an English report instead of "English buttons + Chinese body".
 */

import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { scanCodeSignals, combineFileSignals, scanTextInjection, suspicionScore } from './signals.js'

/** @typedef {'high'|'medium'|'low'|'info'} Severity */
/** @typedef {'finding'|'pass'|'error'} Status */

/**
 * A single check result.
 * @typedef {object} CheckResult
 * @property {string} id
 * @property {string} title
 * @property {Severity|'error'} severity
 * @property {Status} status
 * @property {string} detail
 * @property {string} advice
 * @property {Record<string, unknown>} [extra] machine-readable payloads for the client (e.g. file hashes)
 */

const SELF_NAME = 'dsh-security-doctor'
const SELF_REPO = 'github:ChenChen913/dsh-security-doctor'

async function readTextIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'EISDIR')) return null
    throw error
  }
}

async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

/** Strip a YAML comment (a `#` outside quotes at start or after whitespace). */
function stripYamlComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; continue }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

/**
 * Strip JS block and line comments before the egress scan counts URLs: an
 * example URL inside a comment is documentation, not an outbound call (user
 * finding 3.2-1 — our own docstring example was reported as host `host`).
 * A `//` directly preceded by `:` is a scheme separator (`https://`), never a
 * comment, so real URLs in code and strings survive.
 */
function stripJsComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?<![:\w])\/\/[^\n\r]*/g, '')
}

/**
 * Redact secrets before a config line is echoed into a report (self-audit S2):
 * URL-embedded userinfo (`https://user:pass@host`) and common query-parameter
 * credentials, plus bare API-key/token assignments.
 */
export function maskSecrets(text) {
  return String(text)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s:'"]+):([^/@\s'"]+)@/gi, '$1***@')
    .replace(/([?&](?:key|token|api[_-]?key|secret|password|sig|signature|access[_-]?token)=)[^&\s'"]+/gi, '$1***')
    .replace(/\b(sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, '***')
}

/** Patch/config files that compose the running plugin tree. */
async function collectConfigFiles(home) {
  const files = [path.join(home, 'cordis.patch.yml'), path.join(home, 'settings.yaml')]
  const profilesRoot = path.join(home, 'profiles')
  let profileDirs = []
  try {
    profileDirs = (await fs.readdir(profilesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(profilesRoot, entry.name))
  } catch (error) {
    // only "no profiles directory" is expected here; anything else (permissions,
    // a programming error) must surface instead of silently skipping the checks
    if (!error || error.code !== 'ENOENT') throw error
  }
  for (const dir of profileDirs) {
    files.push(path.join(dir, 'cordis.patch.yml'), path.join(dir, 'cordis.yml'), path.join(dir, 'package.json'))
  }
  return files
}

/** Display path relative to home when inside it, else as-is. */
function displayPath(file, home) {
  const rel = path.relative(home, file)
  return rel && !rel.startsWith('..') ? rel : file
}

/**
 * Iterate YAML lines as EFFECTIVE lines: comments stripped, and literal /
 * folded block scalars (`key: |`, `key: >`, `- |`, with optional chomping
 * `-`/`+` and explicit-indent `1..9` indicators) skipped entirely.
 * v0.7.1 (feedback #2): a `!!js` or `- remove:` mention INSIDE such a block
 * is string CONTENT (documentation, code samples), not an active directive —
 * the naive per-line scan used to flag it. Block content is "every line
 * indented deeper than the opener's key"; the first non-blank line at or
 * above that indent closes the block and is processed normally.
 * @param {string[]} lines
 * @returns {{ index: number, code: string }[]}
 */
function yamlEffectiveLines(lines) {
  const out = []
  let blockIndent = -1
  for (let i = 0; i < lines.length; i++) {
    const code = stripYamlComment(lines[i])
    const indent = code.match(/^[ \t]*/)[0].length
    if (blockIndent >= 0) {
      if (code.trim() === '') continue // blank lines belong to the block
      if (indent > blockIndent) continue // still inside the block scalar
      blockIndent = -1 // dedent closes it; fall through and process this line
    }
    // opener: a `:` or `-` value position whose whole value is a block
    // indicator, e.g. `note: |`, `script: >-2`, `- |` (a bare value ending
    // in `|`/`>` with other content before it does not open a block)
    if (/[:\-]\s*[|>][+-]?\d?[+-]?\s*$/.test(code)) {
      blockIndent = indent
      continue
    }
    out.push({ index: i, code })
  }
  return out
}

/**
 * C1: `!!js` in any composed patch/config — config-as-code, i.e. eval at load.
 * Comments are stripped first: a `!!js` mention inside a comment is not a
 * directive and must not raise a false high-severity alarm. v0.7.1: mentions
 * inside literal/folded blocks are skipped too (string content, not code).
 */
async function checkJsDirectives(configFiles, home, locale) {
  const en = locale === 'en'
  const hits = []
  for (const file of configFiles.filter((f) => !f.endsWith('package.json'))) {
    const text = await readTextIfExists(file)
    if (text === null) continue
    for (const { index, code } of yamlEffectiveLines(text.split(/\r?\n/))) {
      if (/!!js(?=$|[\s/'"])/.test(code)) {
        hits.push(`${displayPath(file, home)}:${index + 1}: ${maskSecrets(text.split(/\r?\n/)[index].trim())}`)
      }
    }
  }
  if (hits.length === 0) {
    return { id: 'js-directives', title: en ? '!!js directives in config' : '配置中的 !!js 表达式', severity: 'info', status: 'pass',
      detail: en ? 'No !!js directives found in any cordis patch/config file under the harness home.'
        : '未在 harness 主目录的任何 cordis 补丁/配置文件中发现 !!js 指令。',
      advice: en ? 'Keep as is: manually review any !!js config from unknown sources before pasting it in — it is evaluated at load time, equivalent to executing code.'
        : '保持现状：分发或粘贴来源不明的含 !!js 的配置前先人工审读——它在加载时会被求值，等同于执行代码。' }
  }
  return { id: 'js-directives', title: en ? '!!js directives in config' : '配置中的 !!js 表达式', severity: 'high', status: 'finding',
    detail: en ? `${hits.length} !!js directive(s) found (evaluated at load time):\n${hits.join('\n')}`
      : `发现 ${hits.length} 处 !!js（加载时会被求值执行）：\n${hits.join('\n')}`,
    advice: en ? 'Verify the origin and effect of every !!js expression; comment out unknown ones and restart. Prefer declarative fields even for your own.'
      : '逐条确认每个 !!js 表达式的来源与作用；不认识的先注释掉再重启。自己写的也应尽量改成声明式字段。',
    extra: { hits } }
}

/**
 * External (non-official) plugin dependencies across all profiles, with
 * supply-chain signals. Shared by C2 (inventory) and C7 (egress scan).
 *
 * v0.7 (review): the inventory used to read ONLY the profile's direct
 * dependencies — code hidden in transitively installed packages (hoisted
 * into node_modules by npm's flat layout) was invisible to both the
 * inventory and the egress scan. The collector now also walks what is
 * ACTUALLY installed under each profile's node_modules and marks every
 * non-official package that is not a direct dependency as transitive.
 */
async function collectExternalPlugins(home) {
  const external = []
  const profilesRoot = path.join(home, 'profiles')
  let profileDirs
  try {
    profileDirs = (await fs.readdir(profilesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(profilesRoot, entry.name))
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
    return { profileDirs: [], external }
  }
  const hasInstallScript = (scripts) => Boolean(scripts.prepare || scripts.postinstall || scripts.preinstall)
  for (const dir of profileDirs) {
    const pkg = JSON.parse(await readTextIfExists(path.join(dir, 'package.json')) ?? '{}')
    const deps = pkg.dependencies ?? {}
    const directNames = new Set()
    for (const [name, spec] of Object.entries(deps)) {
      if (name.startsWith('@deepseek-ai/')) continue
      directNames.add(name)
      const isGit = /^(github:|git[+:]|https?:\/\/.+\.git)/.test(spec)
      // v0.7 (review): pinned means immutable. Git refs need #<sha or tag>.
      // npm specs are pinned ONLY by an exact version (or a local file:
      // path) — ranges (^ ~ > < * latest, bare tags) resolve through the
      // registry at install time and are NOT a lock: the old "!isGit →
      // pinned" let '^1.0.0' pass as locked, contradicting the plugin's own
      // pinning advice.
      let pinned
      if (isGit) {
        pinned = /#[0-9a-f]{7,40}$/.test(spec) || /#v\d+\.\d+\.\d+/.test(spec)
      } else {
        const s = String(spec).trim()
        pinned = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(s) || s.startsWith('file:')
      }
      const depPkg = JSON.parse(await readTextIfExists(path.join(dir, 'node_modules', name, 'package.json')) ?? '{}')
      const installScript = hasInstallScript(depPkg.scripts ?? {})
      // v0.8 (plan 0-4): raw scripts ride along so the egress scan can read
      // WHAT the install step executes, not merely that it exists
      external.push({ name, spec, isGit, pinned, installScript, scripts: depPkg.scripts ?? {}, transitive: false, dir: path.join(dir, 'node_modules', name) })
    }
    // v0.7: sweep the physically installed tree — anything foreign that is
    // not a direct dependency (and not official) is transitive supply chain
    const nmRoot = path.join(dir, 'node_modules')
    // v0.8 (plan 0-3): name → real directory inside the pnpm virtual store
    const pnpmDirs = new Map()
    const deduped = new Set()
    let installed = []
    try {
      installed = await fs.readdir(nmRoot, { withFileTypes: true })
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error
      continue
    }
    const names = []
    for (const entry of installed) {
      if (!entry.isDirectory() || entry.name === '.bin' || entry.name.startsWith('.')) continue
      if (entry.name.startsWith('@')) {
        let scoped = []
        try { scoped = await fs.readdir(path.join(nmRoot, entry.name), { withFileTypes: true }) } catch { continue }
        for (const s of scoped) if (s.isDirectory()) names.push(`${entry.name}/${s.name}`)
      } else {
        names.push(entry.name)
      }
    }
    // v0.8 (plan 0-3): pnpm isolated layout. Top-level entries are SYMLINKS
    // (isDirectory() is false for them), so the sweep above saw only hoisted
    // npm layouts; the real packages live under node_modules/.pnpm/
    // <name>@<version>/node_modules/<name>. Enumerate the virtual store and
    // add every foreign package not already collected as transitive.
    const pnpmRoot = path.join(nmRoot, '.pnpm')
    if (await exists(pnpmRoot)) {
      let storeEntries = []
      try { storeEntries = await fs.readdir(pnpmRoot, { withFileTypes: true }) } catch { storeEntries = [] }
      for (const entry of storeEntries) {
        if (!entry.isDirectory()) continue
        let name = entry.name
        if (name.startsWith('@')) {
          const idx = name.indexOf('@', 1)
          if (idx > 0) name = name.slice(0, idx)
        } else {
          const idx = name.indexOf('@')
          if (idx > 0) name = name.slice(0, idx)
        }
        if (!name || name.startsWith('@deepseek-ai/')) continue
        names.push(name)
        const storeDir = path.join(pnpmRoot, entry.name, 'node_modules', ...name.split('/'))
        pnpmDirs.set(name, storeDir)
      }
    }
    for (const name of names) {
      if (name.startsWith('@deepseek-ai/') || directNames.has(name)) continue
      // the pnpm store can hold SEVERAL versions of one package
      // (name@1.0.0, name@2.0.0…) — one inventory line per name is enough
      if (deduped.has(name)) continue
      deduped.add(name)
      const depDir = pnpmDirs.get(name) ?? path.join(nmRoot, ...name.split('/'))
      const depPkg = JSON.parse(await readTextIfExists(path.join(depDir, 'package.json')) ?? '{}')
      const installScript = hasInstallScript(depPkg.scripts ?? {})
      external.push({
        name, spec: depPkg.version ? `v${depPkg.version} (transitive${pnpmDirs.has(name) ? ', pnpm' : ''})` : '(transitive)',
        isGit: false, pinned: true, installScript, scripts: depPkg.scripts ?? {}, transitive: true, dir: depDir,
      })
    }
  }
  return { profileDirs, external }
}

/**
 * C1b (v0.7, review #8): patches that remove/replace official SECURITY-layer
 * plugins. Threat T3 — a malicious profile patch quietly switching the
 * approval/sandbox/permission layer off — used to be caught only at runtime
 * (C6 service probing, if the removal failed silently). This check inspects
 * the patch/config files themselves: a remove:/replace: block whose item
 * names an official protection plugin is surfaced at configuration level.
 * Best-effort line scan (the project is YAML-parser-free by design).
 */
const SEC_LAYER_RE = /(approval|sandbox|permission|security|guard)/i
async function checkSecurityLayerPatches(configFiles, home, locale) {
  const en = locale === 'en'
  const title = en ? 'Security-layer patch operations' : '安全层补丁操作'
  const hits = []
  for (const file of configFiles.filter((f) => !f.endsWith('package.json'))) {
    const text = await readTextIfExists(file)
    if (text === null) continue
    const rel = displayPath(file, home)
    // v0.7.1 (feedback #2): scan EFFECTIVE lines only — a `- remove:` sample
    // inside a `|`/`>` literal block is documentation, not an active patch op
    const effective = yamlEffectiveLines(text.split(/\r?\n/))
    let i = 0
    while (i < effective.length) {
      const head = /^(\s*)-\s*(remove|replace)\s*:\s*(#.*)?$/.exec(effective[i].code)
      if (!head) {
        // v0.8 (plan 0-1): flow-style single-line form `- remove: { id: x }`.
        // The old head regex demanded an empty value followed by an indented
        // block body, so YAML flow mappings were silently invisible — a
        // one-line `- remove: { id: dsh-approval }` patch escaped the check.
        const flow = /^(\s*)-\s*(remove|replace)\s*:\s*\{(.*)\}\s*$/.exec(effective[i].code)
        if (flow) {
          const kind = flow[2]
          const kv = /(?:^|,)\s*(?:id|name)\s*:\s*['"]?([^'",}\n]+?)['"]?\s*(?=$|,)/g
          let m
          while ((m = kv.exec(flow[3])) !== null) {
            if (SEC_LAYER_RE.test(m[1])) {
              hits.push(`${rel}:${effective[i].index + 1}: ${kind} → ${maskSecrets(m[1])}`)
            }
          }
        }
        i++
        continue
      }
      const indent = head[1].length
      const kind = head[2]
      // collect the block body: effective lines indented deeper than the op
      const body = []
      let j = i + 1
      while (j < effective.length) {
        const code = effective[j].code
        if (code.trim() === '') { j++; continue }
        if (code.match(/^\s*/)[0].length <= indent) break
        body.push(code)
        j++
      }
      for (const b of body) {
        const kv = /^\s*-?\s*(?:id|name)\s*:\s*['"]?([^'"\n]+?)['"]?\s*$/.exec(b)
        if (kv && SEC_LAYER_RE.test(kv[1])) {
          hits.push(`${rel}:${effective[i].index + 1}: ${kind} → ${maskSecrets(kv[1])}`)
        }
      }
      i = j
    }
  }
  if (hits.length > 0) {
    return { id: 'security-layer-patches', title, severity: 'high', status: 'finding',
      detail: (en ? 'Patch operations targeting official protection plugins:\n' : '发现针对官方防护插件的补丁操作：\n') + hits.map((h) => `- ${h}`).join('\n'),
      advice: en ? 'Removing or replacing the approval/sandbox/permission layer is threat T3. Unless you wrote this patch yourself on purpose, delete it and re-run the checkup; verify the C6 services check still passes afterwards.'
        : '移除或替换审批/沙箱/权限层属于威胁 T3。除非你本人有意为之，否则删除该补丁后重新体检，并确认 C6「核心防护服务」仍为通过。' }
  }
  return { id: 'security-layer-patches', title, severity: 'info', status: 'pass',
    detail: en ? 'No remove/replace patch operations against official protection plugins.'
      : '未发现针对官方防护插件的移除/替换补丁操作。',
    advice: en ? 'Nothing to do.' : '无需处理。' }
}

/** C2: third-party plugin inventory + supply-chain signals; self-aware. */
async function checkThirdPartyPlugins(home, pluginVersion, locale) {
  const en = locale === 'en'
  const title = en ? 'Third-party plugin inventory' : '第三方插件盘点'
  let collected
  try {
    collected = await collectExternalPlugins(home)
  } catch (error) {
    return { id: 'third-party-plugins', title, severity: 'error', status: 'error',
      detail: `${en ? 'Inventory failed: ' : '盘点失败：'}${error && error.message ? error.message : String(error)}`,
      advice: en ? 'Please open an issue on the plugin repo with this entry.' : '可到插件仓库提 issue 附上本条信息。' }
  }
  const { profileDirs, external } = collected
  if (external.length === 0) {
    return { id: 'third-party-plugins', title, severity: 'info', status: 'pass',
      detail: en ? `Checked ${profileDirs.length} profile(s); no plugin dependencies beyond the official @deepseek-ai/* ones.`
        : `已检查 ${profileDirs.length} 个 profile，未发现官方 @deepseek-ai/* 之外的插件依赖。`,
      advice: en ? 'When installing new plugins (dsh plugin add), review the source through the security-check workflow first.'
        : '安装新插件时（dsh plugin add）记得先用安全检测流程审一遍来源。' }
  }
  // v0.7 (review): transitive packages carry a flag; the ones with no risk
  // signal at all collapse into one summary line so a busy node_modules does
  // not bury the direct dependencies in noise (they still get egress-scanned)
  const listed = external.filter((p) => !p.transitive || p.installScript || !p.pinned)
  const quietTransitive = external.filter((p) => p.transitive && !p.installScript && p.pinned)
  const lines = listed.map((p) => {
    const flags = []
    if (p.name === SELF_NAME) flags.push(en ? 'this plugin itself' : '本插件自身')
    if (p.transitive) flags.push(en ? 'transitive dependency' : '传递依赖')
    if (!p.pinned) flags.push(en ? 'version not pinned' : '版本引用未锁定')
    if (p.installScript) flags.push(en ? 'ships prepare/postinstall install scripts' : '携带 prepare/postinstall 安装脚本')
    return `- ${p.name} (${p.spec})${flags.length ? ' ⚠ ' + flags.join(en ? ', ' : '、') : ''}`
  })
  if (quietTransitive.length > 0) {
    lines.push(en
      ? `- …plus ${quietTransitive.length} unflagged transitive package(s): ${quietTransitive.map((p) => p.name).slice(0, 5).join(', ')}${quietTransitive.length > 5 ? '…' : ''}`
      : `- …另有 ${quietTransitive.length} 个无风险标记的传递依赖：${quietTransitive.map((p) => p.name).slice(0, 5).join('、')}${quietTransitive.length > 5 ? '…' : ''}`)
  }
  const self = external.find((p) => p.name === SELF_NAME)
  const hasOthers = external.some((p) => p.name !== SELF_NAME)
  // user finding 3.2-2: when the ONLY external dependency is a pinned,
  // script-free copy of this plugin itself, the inventory has nothing to act
  // on — report a quiet pass instead of a permanent "attention" finding.
  if (self && !hasOthers && self.pinned && !self.installScript) {
    return { id: 'third-party-plugins', title, severity: 'info', status: 'pass',
      detail: en ? `No external plugin dependencies other than this plugin itself (${SELF_NAME}${pluginVersion ? ' v' + pluginVersion : ''}, ${self.spec}, pinned, no install scripts).`
        : `除本插件自身（${SELF_NAME}${pluginVersion ? ' v' + pluginVersion : ''}，${self.spec}，已锁定、无安装脚本）外，未发现其他外来插件依赖。`,
      advice: en ? 'Keep as is; review new plugins (dsh plugin add) through the security-check workflow before installing.'
        : '保持现状；安装新插件时（dsh plugin add）记得先用安全检测流程审一遍来源。',
      extra: { plugins: external.map((p) => ({ name: p.name, spec: p.spec })) } }
  }
  let advice = en
    ? 'Run every external plugin through the security review guide before continued use; pin unpinned refs to an exact version, commit or version tag (npm ranges like ^1.2.3 are not pins); install packages with install scripts in an isolated environment first.'
    : '每个外来插件按《安全检测指南》过一遍再继续使用；未锁定的引用改为精确版本号、提交或版本标签（^1.2.3 这类范围不算锁定）；携带安装脚本的包优先在隔离环境安装。'
  if (self) advice += en
    ? ` To pin this plugin itself: set dependencies to "${SELF_REPO}${pluginVersion ? `#v${pluginVersion}` : '#<release-tag>'}".`
    : ` 本插件自身的锁定安装方式：dependencies 写 "${SELF_REPO}${pluginVersion ? `#v${pluginVersion}` : '#<发版标签>'}"，消除未锁定提示。`
  const directCount = external.filter((p) => !p.transitive).length
  const transitiveCount = external.length - directCount
  const countText = transitiveCount > 0
    ? (en ? `${directCount} direct + ${transitiveCount} transitive external package(s) found:\n` : `发现 ${directCount} 个直接依赖 + ${transitiveCount} 个传递依赖的外来包：\n`)
    : (en ? `${directCount} external plugin dependenc${directCount === 1 ? 'y' : 'ies'} found:\n` : `发现 ${directCount} 个外来插件依赖：\n`)
  return { id: 'third-party-plugins', title, severity: 'medium', status: 'finding',
    detail: `${countText}${lines.join('\n')}${en ? '\n(Official @deepseek-ai/* packages are treated as trusted and not scanned; deep code review: see the security review guide)'
      : '\n（官方 @deepseek-ai/* 包按信任基线处理、不在扫描范围；深度代码审查见《安全检测指南》）'}`,
    advice,
    extra: { plugins: external.map((p) => ({ name: p.name, spec: p.spec })) } }
}

/**
 * Parse `icacls <file>` output into `{account, perms}` entries.
 * Sample line: `  DESKTOP\user:(I)(F)` or `BUILTIN\\Users:(RX)`.
 * @param {string} text
 */
export function parseIcaclsAcl(text) {
  const entries = []
  for (const line of String(text).split(/\r?\n/).slice(1)) {
    const re = /([^\s:]+(?: [^\s:]+)*?):\s*((?:\([A-Z]+\))+)/g
    let m
    while ((m = re.exec(line)) !== null) {
      entries.push({ account: m[1], perms: m[2] })
    }
  }
  return entries
}

/**
 * v0.7.1 (feedback): localized Windows systems. icacls resolves well-known
 * groups to the SYSTEM LOCALE (zh-CN shows 所有人 / 经过身份验证的用户; some
 * builds localize BUILTIN\Users as well), and unresolvable accounts come out
 * as raw SIDs — the English-only pattern silently missed both. Match the
 * well-known SIDs (Everyone S-1-1-0, Authenticated Users S-1-5-11,
 * BUILTIN\Users S-1-5-32-545) and the common zh-CN spellings alongside the
 * English names; SID patterns are anchored so S-1-5-32-544 (Administrators)
 * and friends never match.
 */
const WIDE_GROUPS = /(^|\\)Users$|Everyone|Authenticated Users|所有人|经过身份验证的用户/i
const WIDE_SIDS = /(?:^|\\)(?:S-1-1-0|S-1-5-11|S-1-5-32-545)$/i

/**
 * An account entry grants read/write if its permission set is not deny-only
 * and includes a read- or write-capable code. v0.7 (review): icacls also
 * emits the specific/generic right codes — FA (file all), GA (generic all),
 * FR (generic read), FW (generic write), WD (write data), AD (append data) —
 * and the old pattern (F/M/RX/R/W only) silently MISSED wide accounts whose
 * ACE used them. Delete-only rights (DE/D) grant no content access, so they
 * still don't count.
 */
const ACCESS_PERM_RE = /\((?:FA|GA|FR|FW|RX|WD|AD|F|M|R|W)\)/
function grantsAccess(entry) {
  if (/\(D\)/.test(entry.perms)) return false
  return ACCESS_PERM_RE.test(entry.perms.replace('(I)', ''))
}

/**
 * C3: credential file permission bits (POSIX) or ACL accounts (Windows).
 * Contents are never read.
 * @param {string} home
 * @param {object} options
 * @param {string} options.platform process.platform override for tests
 * @param {(file: string) => Promise<string>} [options.icacls] injected icacls runner (host only)
 */
async function checkCredentialsFile(home, options, locale) {
  const en = locale === 'en'
  const title = en ? 'Credential file permissions' : '凭据文件权限'
  const platform = options.platform ?? process.platform
  const statFile = options.statFile ?? ((file) => fs.stat(file))
  const file = path.join(home, '.credentials.yaml')
  let stat
  try {
    stat = await statFile(file)
  } catch {
    return { id: 'credentials-file', title, severity: 'info', status: 'pass',
      detail: en ? 'No ~/.dsh/.credentials.yaml found (the key may come from environment variables or .env).'
        : '未发现 ~/.dsh/.credentials.yaml（Key 可能来自环境变量或 .env）。',
      advice: en ? 'Keys in environment variables are just as sensitive: do not let plugins print env, and never write keys into workspace files.'
        : '环境变量中的 Key 同样敏感：不要让插件打印 env，也不要把 Key 写进工作区文件。' }
  }
  if (platform === 'win32') {
    const propAdvice = en ? 'In file Properties → Security, confirm only your user, SYSTEM and Administrators can read the file.'
      : '在文件属性 → 安全 中确认该文件仅当前用户与 SYSTEM/管理员可读。'
    if (typeof options.icacls !== 'function') {
      return { id: 'credentials-file', title, severity: 'info', status: 'finding',
        detail: en ? `Credential file ${file} exists (no ACL query available in this environment; cannot judge automatically).`
          : `存在凭据文件 ${file}（本环境未提供 ACL 查询，无法自动判断）。`,
        advice: propAdvice }
    }
    let entries
    try {
      entries = parseIcaclsAcl(await options.icacls(file))
    } catch {
      return { id: 'credentials-file', title, severity: 'info', status: 'finding',
        detail: en ? `Credential file ${file} exists (icacls query failed; cannot judge automatically).`
          : `存在凭据文件 ${file}（icacls 查询失败，无法自动判断）。`,
        advice: propAdvice }
    }
    // user finding 3.2-7: accounts that stay as raw S-1-5-… SIDs (deleted or
    // sandbox accounts) get an explicit "unresolved SID" tag instead of a
    // cryptic machine string
    const label = (e) => `${/^S-1-\d/i.test(e.account) ? `${e.account}${en ? ' (unresolved SID)' : '（未解析 SID）'}` : e.account}:${e.perms}`
    const wide = entries.filter((e) => (WIDE_GROUPS.test(e.account) || WIDE_SIDS.test(e.account)) && grantsAccess(e))
    const listing = entries.map(label).join('\n')
    if (wide.length > 0) {
      return { id: 'credentials-file', title, severity: 'medium', status: 'finding',
        detail: en ? `${file} ACL grants broad accounts access:\n${wide.map(label).join('\n')}\nFull ACL:\n${listing}`
          : `${file} 的 ACL 包含宽泛账户访问：\n${wide.map(label).join('\n')}\n完整 ACL：\n${listing}`,
        advice: en ? 'In file Properties → Security remove broad accounts such as Users/Everyone; keep only your user, SYSTEM and Administrators.'
          : '在文件属性 → 安全 中移除 Users/Everyone 等宽泛账户的访问，仅保留当前用户、SYSTEM 与 Administrators。' }
    }
    return { id: 'credentials-file', title, severity: 'info', status: 'pass',
      detail: en ? `${file} ACL contains no broad accounts (accounts with access listed below — confirm each is expected):\n${listing}`
        : `${file} 的 ACL 未包含宽泛账户（当前可访问账户如下，请自行确认均为预期）：\n${listing}`,
      advice: en ? 'Keep as is.' : '保持现状。' }
  }
  const mode = stat.mode & 0o777
  if ((mode & 0o077) === 0) {
    return { id: 'credentials-file', title, severity: 'info', status: 'pass',
      detail: en ? `${file} permission bits are ${mode.toString(8).padStart(3, '0')} (group/other bits empty; owner-only access) — as expected.`
        : `${file} 权限为 ${mode.toString(8).padStart(3, '0')}（组/其他位为空，仅所有者可访问），符合预期。`,
      advice: en ? 'Keep as is.' : '保持现状。' }
  }
  return { id: 'credentials-file', title, severity: 'medium', status: 'finding',
    detail: en ? `${file} permission bits are ${mode.toString(8).padStart(3, '0')}; group or other accounts can access it.`
      : `${file} 权限为 ${mode.toString(8).padStart(3, '0')}，组或其他账户可访问。`,
    advice: en ? `Run chmod 600 ${file} to tighten permissions.` : `执行 chmod 600 ${file} 收紧权限。` }
}

/**
 * Deterministic content fingerprint of a directory tree (v0.8, plan 1-5):
 * sorted entries, per-file sha256, depth- and count-capped. Shared by the
 * instruction-file directory hashes (C4) and the per-plugin code-tree
 * fingerprints (C7) — the same machine, so a plugin tree and an instruction
 * dir change-detect identically. Content-hashed on purpose: a reinstall
 * that restores byte-identical files keeps the same fingerprint (mtime
 * would lie), while any code drift — an upgrade swapping code, a neighbor
 * plugin editing files in place — moves it.
 */
async function hashTree(root, opts = {}) {
  // v0.8 (plan 1-5): `exts` restricts WHICH files enter the fingerprint —
  // plugin code trees hash only code+manifest artifacts (.js/.mjs/.cjs/
  // .ts/.json/.node) so a README edit does not read as "code changed",
  // while instruction-dir hashes keep every file (prose IS the payload)
  const { maxDepth = 3, maxFiles = 500, exts = null } = opts
  const parts = []
  let fileCount = 0
  let truncated = false
  const walk = async (dir, depth) => {
    if (depth > maxDepth) return
    let entries = []
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { parts.push(`d ${entry.name}`); await walk(full, depth + 1) }
      else {
        if (exts && !exts.some((e) => entry.name.endsWith(e))) continue
        if (fileCount >= maxFiles) { truncated = true; return }
        fileCount++
        try { parts.push(`f ${entry.name} ${createHash('sha256').update(await fs.readFile(full)).digest('hex')}`) }
        catch { parts.push(`f ${entry.name} <unreadable>`) }
      }
    }
  }
  await walk(root, 0)
  return { fingerprint: createHash('sha256').update(parts.join('\n')).digest('hex'), files: fileCount, partial: truncated }
}

/** C4: workspace instruction files that get injected into model context, with content hashes. */
async function checkInstructionFiles(workspace, locale) {
  const en = locale === 'en'
  // v0.7 (review): added the CLAUDE.local.md variant and the .cursor/rules
  // directory — both get injected into model context on current tooling.
  // v0.7.1 (feedback #4): added GEMINI.md (Gemini CLI) and
  // .github/copilot-instructions.md (GitHub Copilot); .vscode/settings.json
  // is tracked CONDITIONALLY below (only when it carries prompt/(instruction
  // keys — tracking it unconditionally would flag every unrelated editor
  // setting change as an instruction-file change)
  const candidates = ['AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md', 'GEMINI.md', '.github/copilot-instructions.md', '.agents', '.cursor/rules', '.cursorrules', '.windsurfrules', '.clinerules']
  const found = []
  for (const name of candidates) {
    const target = path.join(workspace, name)
    if (!(await exists(target))) continue
    let sha256 = null
    try {
      const stat = await fs.stat(target)
      if (stat.isFile()) {
        sha256 = createHash('sha256').update(await fs.readFile(target)).digest('hex')
      } else {
        // hash a deterministic listing of the directory (shared hashTree)
        sha256 = (await hashTree(target, { maxDepth: 3 })).fingerprint
      }
    } catch {
      sha256 = null
    }
    found.push({ name, sha256 })
  }
  // v0.8 (plan 0-2): RECURSIVE instruction files. AGENTS.md / CLAUDE.md are
  // loaded per-subtree by current tooling, so a planted nested copy injects
  // instructions while staying invisible to the root-only candidates list.
  // Bounded walk: ≤ 3 levels below the workspace root, known noise dirs and
  // dot-dirs skipped, max 20 hits, results sorted for deterministic output.
  const NESTED_NAMES = new Set(['AGENTS.md', 'CLAUDE.md'])
  const NOISE_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '.pnpm', 'dist', 'build', 'out', 'target', '.next', '.cache', '.venv', 'venv', '__pycache__'])
  const nestedHits = []
  const walkSub = async (dir, depth) => {
    if (nestedHits.length >= 20 || depth > 3) return
    let entries = []
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (nestedHits.length >= 20) return
      if (NOISE_DIRS.has(entry.name) || (entry.name.startsWith('.') && entry.name !== '.github')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walkSub(full, depth + 1)
      else if (NESTED_NAMES.has(entry.name)) {
        const rel = path.relative(workspace, full).split(path.sep).join('/')
        try {
          nestedHits.push({ name: rel, sha256: createHash('sha256').update(await fs.readFile(full)).digest('hex') })
        } catch {
          nestedHits.push({ name: rel, sha256: null })
        }
      }
    }
  }
  try {
    const top = await fs.readdir(workspace, { withFileTypes: true })
    for (const entry of top) {
      if (entry.isDirectory() && !NOISE_DIRS.has(entry.name) && !(entry.name.startsWith('.') && entry.name !== '.github')) {
        await walkSub(path.join(workspace, entry.name), 1)
      }
    }
  } catch { /* unreadable workspace — root candidates already handled */ }
  nestedHits.sort((a, b) => a.name.localeCompare(b.name))
  for (const hit of nestedHits) found.push(hit)
  // v0.7.1 (feedback #4): .vscode/settings.json is tracked ONLY when it
  // actually carries prompt/instruction keys (chat prompt files, custom
  // instructions) — a plain editor-settings file has no context injection
  const vscodeSettings = path.join(workspace, '.vscode', 'settings.json')
  if (await exists(vscodeSettings)) {
    const text = await readTextIfExists(vscodeSettings)
    if (text && /prompt|instruction/i.test(text)) {
      let sha256 = null
      try { sha256 = createHash('sha256').update(text).digest('hex') } catch { sha256 = null }
      found.push({ name: '.vscode/settings.json (prompt keys)', sha256 })
    }
  }
  if (found.length === 0) {
    return { id: 'instruction-files', title: en ? 'Workspace instruction files' : '工作区指令文件', severity: 'info', status: 'pass',
      detail: en ? `No instruction files that get injected into the model context exist in the current working directory (${workspace}).`
        : `当前工作目录（${workspace}）没有会被注入模型上下文的指令文件。`,
      advice: en ? 'Nothing to do.' : '无需处理。' }
  }
  return { id: 'instruction-files', title: en ? 'Workspace instruction files' : '工作区指令文件', severity: 'info', status: 'finding',
    detail: en ? `Found ${found.map((f) => f.name).join(', ')} — their contents enter the model context verbatim.`
      : `发现 ${found.map((f) => f.name).join('、')}——它们的内容会原样进入模型上下文。`,
    advice: en ? 'Under workspace-write the model can rewrite these files too: diff them regularly, never add prompts from unknown sources, and consider the read-only preset for high-sensitivity workspaces. The report hashes their contents on every checkup — treat any "added/changed since last time" as a reason to inspect immediately.'
      : '在 workspace-write 权限下模型也能改写这些文件：定期 diff 指令文件，来源不明的"提示"不要写进去；高敏感工作区可改用 read-only 预设。报告会比对每次体检的内容哈希，出现"上次之后新增/变更"要立即人工检查。',
    extra: { files: found, workspace } }
}

/**
 * C5: external endpoints — user-composed config lines plus the effective
 * environment overrides (hostname only, never the full URL).
 *
 * v0.4 (user finding v0.5-3): the grep used to match only `baseURL:` lines,
 * so a provider block configured under an alias key was invisible. The key
 * pattern now covers the common spellings (baseURL / base_url / apiUrl /
 * api_url / apiBase / api_base / apiEndpoint / api_endpoint / endpoint) at
 * key position, and the env sweep covers the well-known LLM endpoint
 * override variables, not just DEEPSEEK_BASE_URL.
 *
 * v0.6.1 (review #7): the grep was still "guess the key name" — a nested
 * settings.yaml structure or a key outside the list was invisible. When the
 * host passes services.endpoints (probed from the settings service, see
 * lib/index.js probeEffectiveEndpoints), those EFFECTIVE values are reported
 * first; the config grep and env sweep stay as the net underneath.
 */
const ENDPOINT_KEY_RE = /(?:^|\s)(?:base[_-]?url|api[_-]?url|api[_-]?base|api[_-]?endpoint|endpoint)\s*[:=]/i
const ENDPOINT_ENV_KEYS = ['DEEPSEEK_BASE_URL', 'DEEPSEEK_API_BASE', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'ANTHROPIC_BASE_URL']

async function checkExternalEndpoints(configFiles, home, env, locale, services) {
  const en = locale === 'en'
  const hits = []
  // effective values from the settings service (highest precedence — what
  // the running system ACTUALLY uses), each already "path.key = value"
  for (const line of services?.endpoints ?? []) {
    hits.push(en ? `Settings service (effective): ${maskSecrets(line)}` : `settings 服务（实际生效）：${maskSecrets(line)}`)
  }
  for (const file of configFiles.filter((f) => !f.endsWith('package.json'))) {
    const text = await readTextIfExists(file)
    if (text === null) continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (ENDPOINT_KEY_RE.test(lines[i])) {
        hits.push(`${displayPath(file, home)}:${i + 1}: ${maskSecrets(lines[i].trim())}`)
      }
    }
  }
  for (const key of ENDPOINT_ENV_KEYS) {
    const envUrl = env[key]
    if (!envUrl) continue
    let hostname = null
    try { hostname = new URL(envUrl).hostname } catch { hostname = null }
    hits.push(en
      ? `Environment variable ${key} is in effect${hostname ? ` (pointing at ${hostname})` : ' (value is not a valid URL)'} — it takes precedence over config files`
      : `环境变量 ${key} 生效中${hostname ? `（指向 ${hostname}）` : '（值不是合法 URL）'}——它的优先级高于配置文件`)
  }
  if (hits.length === 0) {
    return { id: 'external-endpoints', title: en ? 'External endpoint config' : '外部端点配置', severity: 'info', status: 'pass',
      detail: en ? 'No baseURL/endpoint-style overrides found in user config or environment variables.'
        : '用户配置与环境变量中没有出现 baseURL/端点类改写。',
      advice: en ? 'Keep keys and endpoints from official channels.' : '保持 Key 与端点来自官方渠道。' }
  }
  return { id: 'external-endpoints', title: en ? 'External endpoint config' : '外部端点配置', severity: 'info', status: 'finding',
    detail: en ? `These endpoint settings decide where requests (including credentials) are sent:\n${hits.join('\n')}`
      : `以下端点配置会决定请求（含凭据）发往哪里：\n${hits.join('\n')}`,
    advice: en ? 'Confirm every endpoint points at a domain you trust; a plugin that rewrites baseURL/apiBase can send your API key to an arbitrary server.'
      : '确认每个端点都指向你信任的域名；插件若改写 baseURL/apiBase，等于能把你的 API Key 送往任意服务器。' }
}

/**
 * Walk a plugin directory collecting source files (caps: 200 files, depth 4,
 * no nested node_modules, 512 KB per file). v0.7 (review): dot-named entries
 * are no longer skipped wholesale — that blinded the scan to source hidden in
 * dotted directories; only known-noise dirs (.git/.hg/.svn/.bin) are skipped.
 */
async function collectSourceFiles(root) {
  const files = []
  const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '.bin'])
  const walk = async (dir, depth) => {
    if (files.length >= 200 || depth > 4) return
    let entries = []
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (files.length >= 200) return
      if (SKIP_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, depth + 1)
      else if (/\.(js|mjs|cjs|ts)$/.test(entry.name)) files.push(full)
    }
  }
  await walk(root, 0)
  return files
}

const LOCAL_HOST = /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$)/i

/**
 * v0.7.1 (feedback #3): obfuscation / dynamic-call first-pass signals for
 * the egress scan. A static URL regex cannot see `'h'+'ttps://…'`, base64-
 * assembled addresses or raw socket/DNS tunnels — these patterns do not
 * prove malice (base64 decoding is routine), but they mark files whose
 * egress surface the static scan CANNOT vouch for, for manual review (T5).
 */
const SUSPICIOUS_API_PATTERNS = [
  { re: /\beval\s*\(/, label: 'eval(' },
  { re: /new\s+Function\s*\(/, label: 'new Function(' },
  { re: /Buffer\.from\s*\([^)]*['"]base64['"]/i, label: 'Buffer.from(base64)' },
  { re: /(?:require\s*\(\s*['"]|from\s*['"]|import\s*\(\s*['"])(?:node:)?(?:net|dgram|dns|child_process|worker_threads)['"]/i, label: 'raw net/dns/process import' },
  { re: /\bdns\.(?:resolve|lookup)\s*\(/, label: 'dns.resolve/lookup' },
]

/**
 * Collect plugin-carried TEXT files (*.md / *.txt) for the injection scan
 * (plan 1-4) — bounded harder than source: 10 files, 256 KB each.
 */
async function collectTextFiles(root) {
  const files = []
  const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '.bin'])
  const walk = async (dir, depth) => {
    if (files.length >= 10 || depth > 3) return
    let entries = []
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (files.length >= 10) return
      if (SKIP_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, depth + 1)
      else if (/\.(md|txt)$/i.test(entry.name)) files.push(full)
    }
  }
  await walk(root, 0)
  return files
}

/** Extract http(s)/wss hostnames from arbitrary text (shared by script scans). */
function extractHosts(text, hosts) {
  const re = /(?:https?|wss?):\/\/([^"'`\s)<>\\]+)/g
  let m
  while ((m = re.exec(text)) !== null) {
    const host = m[1].split('/')[0].split('@').pop().split(':')[0].toLowerCase()
    if (!host || LOCAL_HOST.test(host) || host.includes('${')) continue
    hosts.set(host, (hosts.get(host) ?? 0) + 1)
  }
}

/**
 * v0.8 (plan 0-4): scan WHAT an install script executes. The command
 * strings from package.json scripts plus any local .js/.sh/.ps1 file they
 * reference are run through the SAME destination/signal scanner as plugin
 * source — a postinstall that curls a payload was previously only "has an
 * install script", never "downloads from X".
 */
async function scanInstallScript(dep, locale) {
  const en = locale === 'en'
  const scripts = dep.scripts ?? {}
  const commandText = Object.entries(scripts).filter(([k]) => /^(?:pre|post)?install$|^prepare$/.test(k))
    .map(([, v]) => String(v)).join('\n')
  if (!commandText.trim()) return null
  const hosts = new Map()
  extractHosts(commandText, hosts)
  const sig = scanCodeSignals(commandText)
  // referenced local script files (node setup.js / sh install.sh / …)
  const refRe = /[\w./@-]+\.(?:js|mjs|cjs|sh|ps1)\b/g
  let m
  while ((m = refRe.exec(commandText)) !== null) {
    const ref = path.join(dep.dir, m[0])
    try {
      const stat = await fs.stat(ref)
      if (stat.size <= 256 * 1024) {
        const text = m[0].endsWith('.js') || m[0].endsWith('.mjs') || m[0].endsWith('.cjs')
          ? stripJsComments(await fs.readFile(ref, 'utf8')) : await fs.readFile(ref, 'utf8')
        extractHosts(text, hosts)
        const refSig = scanCodeSignals(text)
        sig.emails += refSig.emails
        for (const s of refSig.emailSamples) if (!sig.emailSamples.includes(s) && sig.emailSamples.length < 3) sig.emailSamples.push(s)
        sig.credFile += refSig.credFile
        sig.hardcodedKey += refSig.hardcodedKey
        // netTool MUST ride along — `node setup.js` where setup.js shells
        // `curl …` is a downloader even though the command text is bare
        sig.netTool += refSig.netTool
      }
    } catch { /* referenced file absent — the command text still scanned */ }
  }
  const destCount = hosts.size + sig.emails
  if (destCount === 0 && sig.credFile === 0 && sig.hardcodedKey === 0) return null
  const bits = []
  if (hosts.size > 0) bits.push([...hosts.keys()].slice(0, 4).join(en ? ', ' : '、'))
  if (sig.emails > 0 && sig.emailSamples.length > 0) bits.push(sig.emailSamples.slice(0, 2).join(en ? ', ' : '、'))
  if (sig.credFile > 0) bits.push(en ? 'credential-file access' : '访问凭据文件')
  if (sig.hardcodedKey > 0) bits.push(en ? `hardcoded key literal (×${sig.hardcodedKey})` : `硬编码密钥字面量（×${sig.hardcodedKey}）`)
  return {
    downloader: sig.netTool > 0 && hosts.size > 0,
    text: bits.join(en ? '; ' : '；'),
  }
}

/**
 * C7: static network-egress + intent-signal scan over external plugin source
 * (review guide threat T5). v0.8 layers the intent engine (lib/signals.js)
 * on top of the URL scan: single features annotate, COMBINATIONS (credential
 * access + egress in one file; exec API + net-tool strings; write API +
 * startup locations) are the high findings. Hostnames only; localhost
 * excluded; still a best-effort first filter, never a substitute for the
 * deep review workflow.
 */
async function checkPluginEgress(home, locale) {
  const en = locale === 'en'
  const title = en ? 'Installed-plugin egress scan' : '已装插件出网扫描'
  let collected
  try {
    collected = await collectExternalPlugins(home)
  } catch (error) {
    return { id: 'plugin-egress', title, severity: 'error', status: 'error',
      detail: `${en ? 'Scan failed: ' : '扫描失败：'}${error && error.message ? error.message : String(error)}`,
      advice: en ? 'Please open an issue on the plugin repo.' : '可到插件仓库提 issue。' }
  }
  const { external } = collected
  if (external.length === 0) {
    return { id: 'plugin-egress', title, severity: 'info', status: 'pass',
      detail: en ? 'No external plugins; nothing to scan.' : '没有外来插件，无出网面可扫描。',
      advice: en ? 'Nothing to do.' : '无需处理。' }
  }
  const COMBO_LABEL = {
    'cred-exfil': en ? 'suspected credential-exfil chain (credential access + outbound destination in the SAME file)' : '疑似凭据外发链（同一文件内凭据访问 + 外联目的地）',
    'exec-channel': en ? 'suspected covert exec channel (child_process + curl/wget/netcat strings)' : '疑似隐蔽执行通道（child_process + curl/wget/netcat 字符串）',
    persistence: en ? 'suspected persistence (file write + startup location)' : '疑似持久化（写文件 + 启动项位置）',
  }
  const perPlugin = []
  for (const dep of external) {
    if (!(await exists(dep.dir))) {
      perPlugin.push({ name: dep.name, hosts: [], note: en ? 'install directory not found (not installed or removed)' : '未找到安装目录（未安装或被移除）' })
      continue
    }
    const files = await collectSourceFiles(dep.dir)
    if (files.length === 0) {
      perPlugin.push({ name: dep.name, hosts: [], note: en ? 'no scannable source (may ship only compiled artifacts or binaries)' : '无可扫描源码（可能只分发编译产物或二进制）' })
      continue
    }
    const hosts = new Map()
    const sus = new Map()
    // v0.8 aggregates (plan 1-1..1-6)
    const emailSamples = []
    const bareHosts = []
    const envKeys = []
    let singles = 0 // files carrying at least one single signal
    let credHits = 0, mailHits = 0, envHits = 0, keyHits = 0
    const comboCounts = new Map()
    const comboFiles = []
    const injectionHits = []
    // v0.8 (plan 1-4): plugin-carried text (README/rules) — injection markers
    for (const file of await collectTextFiles(dep.dir)) {
      try {
        const stat = await fs.stat(file)
        if (stat.size > 256 * 1024) continue
        const text = await fs.readFile(file, 'utf8')
        for (const hit of scanTextInjection(text)) {
          if (injectionHits.length < 3) injectionHits.push(hit)
        }
      } catch { continue }
    }
    for (const file of files) {
      let text = null
      try {
        const stat = await fs.stat(file)
        if (stat.size > 512 * 1024) continue
        text = stripJsComments(await fs.readFile(file, 'utf8'))
      } catch { continue }
      extractHosts(text, hosts)
      // v0.7.1 (feedback #3): obfuscation / dynamic-call signals alongside
      // the URL scan — they mark where the STATIC scan cannot vouch
      for (const p of SUSPICIOUS_API_PATTERNS) {
        let count = 0
        const pre = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g')
        while (pre.exec(text) !== null) count++
        if (count > 0) sus.set(p.label, (sus.get(p.label) ?? 0) + count)
      }
      // v0.8 (plan 1-1..1-3): intent signals + file-level combination rules
      const sig = scanCodeSignals(text)
      const urlCount = [...text.matchAll(/(?:https?|wss?):\/\//g)].length
      const combos = combineFileSignals(sig, urlCount)
      let fileHasSingle = false
      if (sig.emails > 0) {
        mailHits += sig.emails
        for (const s of sig.emailSamples) if (emailSamples.length < 3 && !emailSamples.includes(s)) emailSamples.push(s)
        fileHasSingle = true
      }
      if (sig.mailChannel > 0) { mailHits += sig.mailChannel; fileHasSingle = true }
      if (sig.bareHosts.length > 0) {
        for (const h of sig.bareHosts) if (!bareHosts.includes(h) && bareHosts.length < 5) bareHosts.push(h)
        fileHasSingle = true
      }
      if (sig.credFile > 0) { credHits += sig.credFile; fileHasSingle = true }
      if (sig.envKeyReads.length > 0) {
        envHits += sig.envKeyReads.length
        for (const k of sig.envKeyReads) if (!envKeys.includes(k) && envKeys.length < 5) envKeys.push(k)
        fileHasSingle = true
      }
      if (sig.hardcodedKey > 0) { keyHits += sig.hardcodedKey; fileHasSingle = true }
      if (fileHasSingle) singles++
      for (const combo of combos) {
        comboCounts.set(combo, (comboCounts.get(combo) ?? 0) + 1)
        if (comboFiles.length < 3) comboFiles.push(path.basename(file))
      }
    }
    // v0.8 (plan 0-4): install-script content
    const installScriptScan = dep.installScript ? await scanInstallScript(dep, locale) : null
    // exec-channel ONLY when the script actually shells a downloader
    // (netTool + destination) — a fetch()-only script is a content finding,
    // not a covert exec channel, and must not inflate the combo count
    if (installScriptScan && installScriptScan.downloader) {
      comboCounts.set('exec-channel', (comboCounts.get('exec-channel') ?? 0) + 1)
      comboFiles.push('package.json (install script)')
    }
    // v0.8 (plan 1-5): code-tree fingerprint for cross-run drift detection —
    // code+manifest extensions only, so README churn is not "code drift"
    let tree = null
    try { tree = await hashTree(dep.dir, { maxDepth: 4, maxFiles: 200, exts: ['.js', '.mjs', '.cjs', '.ts', '.json', '.node'] }) } catch { tree = null }
    // v0.8 (plan 1-6): suspicion score
    const { score, tier } = suspicionScore({
      combos: [...comboCounts.values()].reduce((a, b) => a + b, 0),
      singles,
      obfuscation: sus.size,
      injection: injectionHits.length,
      installScript: Boolean(dep.installScript),
      pinned: dep.pinned,
      opaqueNoSource: false,
    })
    perPlugin.push({
      name: dep.name,
      dir: dep.dir,
      hosts: [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      suspicious: [...sus.entries()].sort((a, b) => b[1] - a[1]),
      signals: { emailSamples, bareHosts, envKeys, credHits, mailHits, envHits, keyHits, singles },
      combos: [...comboCounts.entries()],
      comboFiles,
      injection: injectionHits,
      installScriptHits: installScriptScan,
      tree,
      score,
      tier,
    })
  }
  const opaque = perPlugin.filter((p) => p.note)
  const withHosts = perPlugin.filter((p) => p.hosts.length > 0)
  // v0.7.1 (feedback #3): obfuscation / dynamic-call signals participate in
  // the verdict — a plugin can show zero static URLs yet assemble them at
  // runtime; those signals alone still surface as a finding
  const suspicious = perPlugin.filter((p) => p.suspicious && p.suspicious.length > 0)
  // v0.8: intent-combination hits (plan 1-3) and injection text (1-4)
  const comboPlugins = perPlugin.filter((p) => p.combos && p.combos.length > 0)
  const injected = perPlugin.filter((p) => p.injection && p.injection.length > 0)
  const signalled = perPlugin.filter((p) => p.signals && (p.signals.singles > 0))
  const scriptHit = perPlugin.filter((p) => p.installScriptHits)
  if (withHosts.length === 0 && opaque.length === 0 && suspicious.length === 0
    && comboPlugins.length === 0 && injected.length === 0 && signalled.length === 0 && scriptHit.length === 0) {
    return { id: 'plugin-egress', title, severity: 'info', status: 'pass',
      detail: en ? `Scanned the source of ${external.length} external plugin(s); no outbound addresses found.`
        : `扫描了 ${external.length} 个外来插件的源码，未发现外联地址。`,
      advice: en ? 'Stay watchful: re-run the checkup after upgrading any plugin.' : '保持关注：升级插件后重新体检。' }
  }
  const lines = perPlugin.map((p) => {
    if (p.note) return `- ${p.name}${en ? ': ' : '：'}${p.note}`
    const parts = []
    if (p.hosts.length > 0) parts.push(p.hosts.map(([h, n]) => `${h}${n > 1 ? `(×${n})` : ''}`).join(en ? ', ' : '、'))
    else parts.push(en ? 'no outbound addresses in source' : '源码中未发现外联地址')
    if (p.suspicious && p.suspicious.length > 0) {
      parts.push(`${en ? '⚠ obfuscation/dynamic-call signals (static scan cannot vouch): ' : '⚠ 动态/混淆特征（静态扫描无法覆盖）：'}${p.suspicious.map(([l, n]) => `${l}${n > 1 ? `(×${n})` : ''}`).join(en ? ', ' : '、')}`)
    }
    // v0.8 (plan 1-1/1-2): single intent signals — annotation only
    if (p.signals) {
      const sigBits = []
      if (p.signals.emailSamples.length > 0) sigBits.push(`${en ? 'email ' : '邮箱 '}${p.signals.emailSamples.slice(0, 2).join(en ? ', ' : '、')}`)
      if (p.signals.mailHits > 0 && p.signals.emailSamples.length === 0) sigBits.push(en ? 'mail-channel markers' : '邮件通道特征')
      if (p.signals.bareHosts.length > 0) sigBits.push(`${en ? 'config hostnames: ' : '配置式主机名：'}${p.signals.bareHosts.slice(0, 3).join(en ? ', ' : '、')}`)
      if (p.signals.credHits > 0) sigBits.push(`${en ? 'credential-file access ' : '凭据文件访问 '}(×${p.signals.credHits})`)
      if (p.signals.envKeys.length > 0) sigBits.push(`${en ? 'secret-ish env keys: ' : '敏感环境变量键：'}${p.signals.envKeys.slice(0, 3).join(en ? ', ' : '、')}`)
      if (p.signals.keyHits > 0) sigBits.push(en ? `hardcoded key literals (×${p.signals.keyHits})` : `硬编码密钥字面量（×${p.signals.keyHits}）`)
      if (sigBits.length > 0) parts.push(`${en ? '⚠ intent signals (single features, review only): ' : '⚠ 意图特征信号（单特征，仅供复核）：'}${sigBits.join(en ? '; ' : '；')}`)
    }
    // v0.8 (plan 1-3): combination hits — the high findings
    if (p.combos && p.combos.length > 0) {
      parts.push(`${en ? '⚠ COMBINATION: ' : '⚠ 组合命中：'}${p.combos.map(([c, n]) => `${COMBO_LABEL[c] ?? c}${n > 1 ? (en ? ` (×${n} files)` : `（×${n} 个文件）`) : ''}`).join(en ? '; ' : '；')}`)
    }
    // v0.8 (plan 0-4): install-script content findings
    if (p.installScriptHits) {
      parts.push(`${en ? '⚠ install script content: ' : '⚠ 安装脚本内容：'}${p.installScriptHits.text}`)
    }
    // v0.8 (plan 1-4): prompt-injection text markers
    if (p.injection && p.injection.length > 0) {
      parts.push(`${en ? '⚠ prompt-injection text markers: ' : '⚠ 注入文本特征：'}${p.injection.map((h) => `"${h.slice(0, 60)}"`).join(en ? '; ' : '；')}`)
    }
    // v0.8 (plan 1-6): suspicion score rides the line tail
    if (p.tier && p.tier !== 'low') {
      parts.push(`${en ? 'suspicion ' : '可疑度 '}${p.score}/100${en ? ' (' + p.tier + ')' : '（' + (p.tier === 'high' ? '高' : '中') + '）'}`)
    }
    return `- ${p.name}${en ? ': ' : '：'}${parts.join(en ? '; ' : '；')}`
  })
  const severity = comboPlugins.length > 0 ? 'high'
    : (opaque.length > 0 || suspicious.length > 0 || injected.length > 0 || signalled.length > 0 || scriptHit.length > 0) ? 'medium' : 'info'
  return { id: 'plugin-egress', title, severity, status: 'finding',
    detail: `${lines.join('\n')}${comboPlugins.length > 0 ? (en ? '\n(COMBINATION hits are file-level co-occurrence, not proven data flow — treat as high-priority review targets, not as verdicts.)' : '\n（组合命中是文件级共现，不是被证实的数据流——按高优先级复核对象对待，不等于定论。）') : ''}${opaque.length > 0 ? (en ? '\n(plugins without scannable source exist; the static scan cannot cover them)' : '\n（存在无法扫描源码的插件，静态扫描无法覆盖）') : ''}${suspicious.length > 0 ? (en ? '\n(obfuscation/dynamic-call signals listed above are first-pass markers for manual review, not proof of malice)' : '\n（上面的动态/混淆特征是供人工复核的初筛信号，不等于恶意）') : ''}${injected.length > 0 ? (en ? '\n(prompt-injection markers were found in plugin-carried TEXT — these attack the model context, not the file system.)' : '\n（在插件携带的文本中发现注入特征——它们攻击的是模型上下文，不是文件系统。）') : ''}`,
    advice: en ? 'Confirm each hostname matches the plugin README and is necessary; deep-review any plugin with unknown hostnames per the security review guide (T5). Single intent signals are routine features flagged for review; COMBINATION hits (credential access + egress in one file) deserve immediate review. Official @deepseek-ai/* packages are treated as trusted and NOT scanned. This is a first-pass filter — obfuscated or runtime-assembled addresses are undetectable.'
      : '逐个确认域名是否与插件 README 声明一致、是否必要；出现不认识的域名，按《安全检测指南》T5 深查该插件。单一意图特征是常规功能、仅供复核；组合命中（同一文件内凭据访问 + 外联）应立即审查。官方 @deepseek-ai/* 包按信任基线处理、不在扫描范围。此项是初筛，深链混淆与运行时拼接的地址检测不到。',
    extra: { perPlugin } }
}

/**
 * C6: core protection services — presence via `ctx.get()` plus the effective
 * policy values that are cheaply readable on the service configs.
 * v0.8 (plan 1-7): also reports the SESSION-level policy. The service
 * configs carry the defaults, but a session started with
 * DSH_PERMISSION_MODE=danger-full-access runs with effective approval
 * 'never' regardless of the service default — without this line the report
 * would read SAFER than the real environment.
 * @param {object} servicesInfo `{ present: Record<string, boolean>, approvalPolicy?: string, defaultPreset?: string }`
 * @param {string} locale
 * @param {object} env process environment (injected for tests)
 */
function checkSecurityServices(servicesInfo, locale, env = {}) {
  const en = locale === 'en'
  const title = en ? 'Core protection services' : '核心防护服务'
  const expected = [
    { key: 'permissionPresets', label: en ? 'permissionPresets (permission presets)' : 'permissionPresets（权限预设）' },
    { key: 'approval', label: en ? 'approval (tool approval)' : 'approval（工具审批）' },
    { key: 'sandbox', label: en ? 'sandbox (process isolation)' : 'sandbox（进程隔离）' },
    { key: 'webServer', label: en ? 'webServer (web server)' : 'webServer（Web 服务）' },
  ]
  const present = servicesInfo?.present ?? {}
  const missing = expected.filter((s) => !present[s.key]).map((s) => s.label)
  // v0.8 (plan 1-7): session-effective preset from the startup env override
  const sessionPreset = typeof env.DSH_PERMISSION_MODE === 'string' && env.DSH_PERMISSION_MODE.trim()
    ? env.DSH_PERMISSION_MODE.trim() : null
  const sessionDanger = sessionPreset !== null && /danger-full-access/i.test(sessionPreset)
  const facts = []
  if (typeof servicesInfo?.approvalPolicy === 'string') facts.push(`${en ? 'approval policy (service default): ' : '审批策略（服务默认）：'}${servicesInfo.approvalPolicy}`)
  if (typeof servicesInfo?.defaultPreset === 'string') facts.push(`${en ? 'permission preset (combined default): ' : '权限预设（组合默认）：'}${servicesInfo.defaultPreset}`)
  if (sessionPreset !== null) {
    // the plan's line: "服务默认 ask / 本会话实际 never ⚠" — the mismatch is
    // ⚠-worthy only in the MORE dangerous direction; a read-only session
    // over a workspace-write default is accuracy, not alarm
    const differs = typeof servicesInfo?.defaultPreset === 'string' && sessionPreset !== servicesInfo.defaultPreset
    facts.push(`${en ? 'permission preset (this session, from DSH_PERMISSION_MODE): ' : '权限预设（本会话实际，来自 DSH_PERMISSION_MODE）：'}${sessionPreset}`
      + (differs ? (sessionDanger
        ? (en ? ` ⚠ (service default ${servicesInfo.defaultPreset})` : ` ⚠（服务默认 ${servicesInfo.defaultPreset}）`)
        : (en ? ` (service default ${servicesInfo.defaultPreset})` : `（服务默认 ${servicesInfo.defaultPreset}）`))
        : (en ? ' (matches the service default)' : '（与服务默认一致）')))
  }
  const factText = facts.length > 0 ? (en ? `Current effective values: ${facts.join('; ')}.` : `当前生效值：${facts.join('；')}。`)
    : (en ? 'Could not read the effective values (presence confirmed only).' : '未能读取当前生效值（仅确认装载状态）。')
  // v0.8 (plan 1-7): structured session policy for the client — it carries
  // the service default too so the UI can render the "服务默认 X / 本会话
  // 实际 Y ⚠" comparison line without parsing prose
  const sessionPolicyExtra = sessionPreset !== null
    ? { sessionPolicy: { preset: sessionPreset, source: 'DSH_PERMISSION_MODE', serviceDefault: typeof servicesInfo?.defaultPreset === 'string' ? servicesInfo.defaultPreset : null } }
    : {}
  const dangerous = []
  if (servicesInfo?.approvalPolicy === 'never') dangerous.push(en ? 'approval policy is never — tool calls no longer ask you' : '审批策略为 never——工具调用不再询问你')
  if (typeof servicesInfo?.defaultPreset === 'string' && /danger-full-access/i.test(servicesInfo.defaultPreset)) {
    dangerous.push(en ? `permission preset is ${servicesInfo.defaultPreset} — the model executes with full access` : `权限预设为 ${servicesInfo.defaultPreset}——模型以完全权限执行`)
  }
  // v0.8 (plan 1-7): a danger-full-access SESSION is high even when every
  // service default is safe — the env override wins at runtime
  if (sessionDanger) {
    dangerous.push(en ? `this session actually runs danger-full-access (DSH_PERMISSION_MODE) — effective approval is never, tool calls no longer ask you`
      : `本会话实际以 danger-full-access 运行（DSH_PERMISSION_MODE）——等效审批为 never，工具调用不再询问你`)
  }
  if (dangerous.length > 0) {
    // user finding v0.5-9: the old advice invented a settings path
    // ("设置 → 插件配置 → Shell") that does not exist in the DSH UI. The
    // policy actually derives from the permission preset (and from the
    // DSH_PERMISSION_MODE env var at startup), so the advice points there.
    return { id: 'security-services', title, severity: 'high', status: 'finding',
      detail: `${dangerous.join(en ? '; ' : '；')}${en ? '. ' : '。'}${factText}`,
      advice: en ? 'Switch the permission preset back to workspace-write or read-only in the Web UI (the approval policy returns to ask with the preset); if started with the DSH_PERMISSION_MODE env var, remove danger-full-access and restart. Use broad policies only in fully trusted throwaway environments.'
        : '在 Web 界面把权限档位切回 workspace-write 或 read-only（审批策略会随档位恢复 ask）；若以 DSH_PERMISSION_MODE 环境变量启动，去掉 danger-full-access 后重启。宽策略只用于完全可信的一次性环境。',
      extra: sessionPolicyExtra }
  }
  if (missing.length > 0) {
    return { id: 'security-services', title, severity: 'medium', status: 'finding',
      detail: en ? `These protection services were not detected in this process: ${missing.join(', ')}. ${factText}`
        : `以下防护服务未在本进程探测到：${missing.join('、')}。${factText}`,
      advice: en ? 'Make sure no patch disabled a security layer; danger-full-access / approval=never belong only in fully trusted environments.'
        : '确认没有通过 patch 关掉安全层；danger-full-access / approval=never 只在完全可信的环境使用。',
      extra: sessionPolicyExtra }
  }
  return { id: 'security-services', title, severity: 'info', status: 'pass',
    detail: en ? `permissionPresets / approval / sandbox / webServer are all mounted. ${factText}`
      : `permissionPresets / approval / sandbox / webServer 均已装载。${factText}`,
    advice: en ? 'Keep the defaults: ask approval + workspace-write preset.' : '保持默认的 ask 审批 + workspace-write 预设即可。',
    extra: sessionPolicyExtra }
}

/** Wrap one check so a throw degrades to an error finding. */
async function guard(id, titles, fn, locale) {
  const en = locale === 'en'
  try {
    return await fn()
  } catch (error) {
    return { id, title: en ? titles.en : titles.zh, severity: 'error', status: 'error',
      detail: `${en ? 'Check failed: ' : '检查本身失败：'}${error && error.message ? error.message : String(error)}`,
      advice: en ? 'Please open an issue on the plugin repo with this entry.' : '可到插件仓库提 issue 附上本条信息。' }
  }
}

function summarize(checks, locale) {
  const en = locale === 'en'
  const count = (severity) => checks.filter((c) => c.severity === severity && c.status !== 'pass').length
  const summary = { high: count('high'), medium: count('medium'), low: count('low'), info: count('info'), error: count('error') }
  // v0.7 (review): error means THE TOOL failed on that check, not that the
  // environment got riskier — it must not decide the verdict's risk wording
  // (that used to collapse into "mostly healthy"), but it IS appended so a
  // partially-blind report never reads as fully-verified.
  let verdict
  if (summary.high > 0) verdict = en ? 'High-risk signals found — act now' : '发现高危信号，建议立即处理'
  else if (summary.medium > 0) verdict = en ? 'Items need your attention' : '存在需要关注的事项'
  else if (summary.low > 0) verdict = en ? 'Mostly healthy, a few suggestions' : '基本健康，有少量建议'
  else verdict = en ? 'No anomaly signals (best-effort; not a guarantee of safety)' : '未见异常信号（尽力检测，不等于绝对安全）'
  if (summary.error > 0) verdict += en
    ? ` (${summary.error} check(s) themselves failed — coverage incomplete)`
    : `（另有 ${summary.error} 项检查自身失败，覆盖不完整）`
  return { summary, verdict }
}

/**
 * Run the full read-only checkup.
 * @param {object} options
 * @param {string} options.home harness home (usually ~/.dsh)
 * @param {string} options.workspace working directory to inspect
 * @param {object} options.services service presence + policy values from the host
 * @param {object} [options.env] environment override for tests
 * @param {string} [options.platform] process.platform override for tests
 * @param {(file: string) => Promise<{mode: number}>} [options.statFile] stat override for tests
 * @param {(file: string) => Promise<string>} [options.icacls] injected icacls runner (Windows ACL query)
 * @param {string} [options.pluginVersion] plugin semver stamped into the report so the
 *   client (and exported/copied reports) state which version produced them (V3)
 * @param {string} [options.locale] report language: 'zh' (default) or 'en' (v0.5-4)
 * @returns {Promise<{generatedAt: string, home: string, workspace: string, pluginVersion?: string, locale: string, checks: CheckResult[], summary: object, verdict: string}>}
 */
export async function runSecurityCheckup(options) {
  const { home, workspace, services, env = process.env, platform, statFile, icacls, pluginVersion, locale = 'zh' } = options
  const configFiles = await collectConfigFiles(home)

  const checks = [
    await guard('js-directives', { zh: '配置中的 !!js 表达式', en: '!!js directives in config' }, () => checkJsDirectives(configFiles, home, locale), locale),
    await guard('security-layer-patches', { zh: '安全层补丁操作', en: 'Security-layer patch operations' }, () => checkSecurityLayerPatches(configFiles, home, locale), locale),
    await guard('third-party-plugins', { zh: '第三方插件盘点', en: 'Third-party plugin inventory' }, () => checkThirdPartyPlugins(home, pluginVersion, locale), locale),
    await guard('credentials-file', { zh: '凭据文件权限', en: 'Credential file permissions' }, () => checkCredentialsFile(home, { platform, icacls, statFile }, locale), locale),
    await guard('instruction-files', { zh: '工作区指令文件', en: 'Workspace instruction files' }, () => checkInstructionFiles(workspace, locale), locale),
    await guard('external-endpoints', { zh: '外部端点配置', en: 'External endpoint config' }, () => checkExternalEndpoints(configFiles, home, env, locale, services), locale),
    checkSecurityServices(services, locale, env),
    await guard('plugin-egress', { zh: '已装插件出网扫描', en: 'Installed-plugin egress scan' }, () => checkPluginEgress(home, locale), locale),
  ]
  const { summary, verdict } = summarize(checks, locale)
  const report = { generatedAt: new Date().toISOString(), home, workspace, locale, checks, summary, verdict }
  if (pluginVersion) report.pluginVersion = pluginVersion
  return report
}
