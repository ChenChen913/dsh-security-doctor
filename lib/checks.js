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
 * C1: `!!js` in any composed patch/config — config-as-code, i.e. eval at load.
 * Comments are stripped first: a `!!js` mention inside a comment is not a
 * directive and must not raise a false high-severity alarm.
 */
async function checkJsDirectives(configFiles, home, locale) {
  const en = locale === 'en'
  const hits = []
  for (const file of configFiles.filter((f) => !f.endsWith('package.json'))) {
    const text = await readTextIfExists(file)
    if (text === null) continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const code = stripYamlComment(lines[i])
      if (/!!js(?=$|[\s/'"])/.test(code)) {
        hits.push(`${displayPath(file, home)}:${i + 1}: ${maskSecrets(lines[i].trim())}`)
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
  for (const dir of profileDirs) {
    const pkg = JSON.parse(await readTextIfExists(path.join(dir, 'package.json')) ?? '{}')
    const deps = pkg.dependencies ?? {}
    for (const [name, spec] of Object.entries(deps)) {
      if (name.startsWith('@deepseek-ai/')) continue
      const isGit = /^(github:|git[+:]|https?:\/\/.+\.git)/.test(spec)
      const pinned = !isGit || /#[0-9a-f]{7,40}$/.test(spec) || /#v\d+\.\d+\.\d+/.test(spec)
      let installScript = false
      const depPkg = JSON.parse(await readTextIfExists(path.join(dir, 'node_modules', name, 'package.json')) ?? '{}')
      const scripts = depPkg.scripts ?? {}
      installScript = Boolean(scripts.prepare || scripts.postinstall || scripts.preinstall)
      external.push({ name, spec, isGit, pinned, installScript, dir: path.join(dir, 'node_modules', name) })
    }
  }
  return { profileDirs, external }
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
  const lines = external.map((p) => {
    const flags = []
    if (p.name === SELF_NAME) flags.push(en ? 'this plugin itself' : '本插件自身')
    if (p.isGit && !p.pinned) flags.push(en ? 'git ref not pinned' : 'git 引用未锁定版本')
    if (p.installScript) flags.push(en ? 'ships prepare/postinstall install scripts' : '携带 prepare/postinstall 安装脚本')
    return `- ${p.name} (${p.spec})${flags.length ? ' ⚠ ' + flags.join(en ? ', ' : '、') : ''}`
  })
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
    ? 'Run every external plugin through the security review guide before continued use; pin unpinned git refs to a commit or version tag; install packages with install scripts in an isolated environment first.'
    : '每个外来插件按《安全检测指南》过一遍再继续使用；未锁定的 git 引用建议锁定到具体提交或版本标签；携带安装脚本的包优先在隔离环境安装。'
  if (self) advice += en
    ? ` To pin this plugin itself: set dependencies to "${SELF_REPO}${pluginVersion ? `#v${pluginVersion}` : '#<release-tag>'}".`
    : ` 本插件自身的锁定安装方式：dependencies 写 "${SELF_REPO}${pluginVersion ? `#v${pluginVersion}` : '#<发版标签>'}"，消除未锁定提示。`
  return { id: 'third-party-plugins', title, severity: 'medium', status: 'finding',
    detail: en ? `${external.length} external plugin dependenc${external.length === 1 ? 'y' : 'ies'} found:\n${lines.join('\n')}\n(Deep code review: see the security review guide)`
      : `发现 ${external.length} 个外来插件依赖：\n${lines.join('\n')}\n（深度代码审查见《安全检测指南》）`,
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

const WIDE_GROUPS = /(^|\\)Users$|Everyone|Authenticated Users/i

/** An account entry grants read/write if it has F/M/RX/R/W and is not deny-only. */
function grantsAccess(entry) {
  if (/\(D\)/.test(entry.perms)) return false
  return /\(([FM]|RX|R|W)\)/.test(entry.perms.replace('(I)', ''))
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
    const wide = entries.filter((e) => WIDE_GROUPS.test(e.account) && grantsAccess(e))
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

/** C4: workspace instruction files that get injected into model context, with content hashes. */
async function checkInstructionFiles(workspace, locale) {
  const en = locale === 'en'
  const candidates = ['AGENTS.md', 'CLAUDE.md', '.agents', '.cursorrules', '.windsurfrules', '.clinerules']
  const found = []
  for (const name of candidates) {
    const target = path.join(workspace, name)
    if (!(await exists(target))) continue
    let sha256 = null
    try {
      const stat = await fs.stat(target)
      if (stat.isFile()) {
        sha256 = createHash('sha256').update(await fs.readFile(target)).digest('hex')
      } else if (name === '.agents') {
        // hash a deterministic listing of the directory (names + file hashes, depth-capped)
        const parts = []
        const walk = async (dir, depth) => {
          if (depth > 3) return
          let entries = []
          try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
          entries.sort((a, b) => a.name.localeCompare(b.name))
          for (const entry of entries) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) { parts.push(`d ${entry.name}`); await walk(full, depth + 1) }
            else {
              try { parts.push(`f ${entry.name} ${createHash('sha256').update(await fs.readFile(full)).digest('hex')}`) }
              catch { parts.push(`f ${entry.name} <unreadable>`) }
            }
          }
        }
        await walk(target, 0)
        sha256 = createHash('sha256').update(parts.join('\n')).digest('hex')
      }
    } catch {
      sha256 = null
    }
    found.push({ name, sha256 })
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
 */
const ENDPOINT_KEY_RE = /(?:^|\s)(?:base[_-]?url|api[_-]?url|api[_-]?base|api[_-]?endpoint|endpoint)\s*[:=]/i
const ENDPOINT_ENV_KEYS = ['DEEPSEEK_BASE_URL', 'DEEPSEEK_API_BASE', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'ANTHROPIC_BASE_URL']

async function checkExternalEndpoints(configFiles, home, env, locale) {
  const en = locale === 'en'
  const hits = []
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
 * no nested node_modules, 512 KB per file).
 */
async function collectSourceFiles(root) {
  const files = []
  const walk = async (dir, depth) => {
    if (files.length >= 200 || depth > 4) return
    let entries = []
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (files.length >= 200) return
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
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
 * C7: static network-egress scan over external plugin source — the first
 * risk dimension of plugin security, aligned with review guide threat T5.
 * Hostnames only; localhost is excluded; this is a best-effort initial
 * filter, not a substitute for the deep review workflow.
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
    for (const file of files) {
      let text = null
      try {
        const stat = await fs.stat(file)
        if (stat.size > 512 * 1024) continue
        text = stripJsComments(await fs.readFile(file, 'utf8'))
      } catch { continue }
      const re = /(?:https?|wss?):\/\/([^"'`\s)<>\\]+)/g
      let m
      while ((m = re.exec(text)) !== null) {
        const host = m[1].split('/')[0].split('@').pop().split(':')[0].toLowerCase()
        if (!host || LOCAL_HOST.test(host) || host.includes('${')) continue
        hosts.set(host, (hosts.get(host) ?? 0) + 1)
      }
    }
    perPlugin.push({ name: dep.name, hosts: [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8) })
  }
  const opaque = perPlugin.filter((p) => p.note)
  const withHosts = perPlugin.filter((p) => p.hosts.length > 0)
  if (withHosts.length === 0 && opaque.length === 0) {
    return { id: 'plugin-egress', title, severity: 'info', status: 'pass',
      detail: en ? `Scanned the source of ${external.length} external plugin(s); no outbound addresses found.`
        : `扫描了 ${external.length} 个外来插件的源码，未发现外联地址。`,
      advice: en ? 'Stay watchful: re-run the checkup after upgrading any plugin.' : '保持关注：升级插件后重新体检。' }
  }
  const lines = perPlugin.map((p) => {
    if (p.note) return `- ${p.name}${en ? ': ' : '：'}${p.note}`
    if (p.hosts.length === 0) return `- ${p.name}${en ? ': no outbound addresses in source' : '：源码中未发现外联地址'}`
    return `- ${p.name} → ${p.hosts.map(([h, n]) => `${h}${n > 1 ? `(×${n})` : ''}`).join(en ? ', ' : '、')}`
  })
  const severity = opaque.length > 0 ? 'medium' : 'info'
  return { id: 'plugin-egress', title, severity, status: 'finding',
    detail: `${lines.join('\n')}${opaque.length > 0 ? (en ? '\n(plugins without scannable source exist; the static scan cannot cover them)' : '\n（存在无法扫描源码的插件，静态扫描无法覆盖）') : ''}`,
    advice: en ? 'Confirm each hostname matches the plugin README and is necessary; deep-review any plugin with unknown hostnames per the security review guide (T5). This is a first-pass filter — obfuscated or runtime-assembled addresses are undetectable.'
      : '逐个确认域名是否与插件 README 声明一致、是否必要；出现不认识的域名，按《安全检测指南》T5 深查该插件。此项是初筛，深链混淆与运行时拼接的地址检测不到。',
    extra: { perPlugin } }
}

/**
 * C6: core protection services — presence via `ctx.get()` plus the effective
 * policy values that are cheaply readable on the service configs.
 * @param {object} servicesInfo `{ present: Record<string, boolean>, approvalPolicy?: string, defaultPreset?: string }`
 */
function checkSecurityServices(servicesInfo, locale) {
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
  const facts = []
  if (typeof servicesInfo?.approvalPolicy === 'string') facts.push(`${en ? 'approval policy (service default): ' : '审批策略（服务默认）:'}${servicesInfo.approvalPolicy}`)
  if (typeof servicesInfo?.defaultPreset === 'string') facts.push(`${en ? 'permission preset (combined default): ' : '权限预设（组合默认）:'}${servicesInfo.defaultPreset}`)
  const factText = facts.length > 0 ? (en ? `Current effective values: ${facts.join('; ')}.` : `当前生效值：${facts.join('；')}。`)
    : (en ? 'Could not read the effective values (presence confirmed only).' : '未能读取当前生效值（仅确认装载状态）。')
  const dangerous = []
  if (servicesInfo?.approvalPolicy === 'never') dangerous.push(en ? 'approval policy is never — tool calls no longer ask you' : '审批策略为 never——工具调用不再询问你')
  if (typeof servicesInfo?.defaultPreset === 'string' && /danger-full-access/i.test(servicesInfo.defaultPreset)) {
    dangerous.push(en ? `permission preset is ${servicesInfo.defaultPreset} — the model executes with full access` : `权限预设为 ${servicesInfo.defaultPreset}——模型以完全权限执行`)
  }
  if (dangerous.length > 0) {
    // user finding v0.5-9: the old advice invented a settings path
    // ("设置 → 插件配置 → Shell") that does not exist in the DSH UI. The
    // policy actually derives from the permission preset (and from the
    // DSH_PERMISSION_MODE env var at startup), so the advice points there.
    return { id: 'security-services', title, severity: 'high', status: 'finding',
      detail: `${dangerous.join(en ? '; ' : '；')}${en ? '. ' : '。'}${factText}`,
      advice: en ? 'Switch the permission preset back to workspace-write or read-only in the Web UI (the approval policy returns to ask with the preset); if started with the DSH_PERMISSION_MODE env var, remove danger-full-access and restart. Use broad policies only in fully trusted throwaway environments.'
        : '在 Web 界面把权限档位切回 workspace-write 或 read-only（审批策略会随档位恢复 ask）；若以 DSH_PERMISSION_MODE 环境变量启动，去掉 danger-full-access 后重启。宽策略只用于完全可信的一次性环境。' }
  }
  if (missing.length > 0) {
    return { id: 'security-services', title, severity: 'medium', status: 'finding',
      detail: en ? `These protection services were not detected in this process: ${missing.join(', ')}. ${factText}`
        : `以下防护服务未在本进程探测到：${missing.join('、')}。${factText}`,
      advice: en ? 'Make sure no patch disabled a security layer; danger-full-access / approval=never belong only in fully trusted environments.'
        : '确认没有通过 patch 关掉安全层；danger-full-access / approval=never 只在完全可信的环境使用。' }
  }
  return { id: 'security-services', title, severity: 'info', status: 'pass',
    detail: en ? `permissionPresets / approval / sandbox / webServer are all mounted. ${factText}`
      : `permissionPresets / approval / sandbox / webServer 均已装载。${factText}`,
    advice: en ? 'Keep the defaults: ask approval + workspace-write preset.' : '保持默认的 ask 审批 + workspace-write 预设即可。' }
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
  let verdict
  if (summary.high > 0) verdict = en ? 'High-risk signals found — act now' : '发现高危信号，建议立即处理'
  else if (summary.medium > 0) verdict = en ? 'Items need your attention' : '存在需要关注的事项'
  else if (summary.low > 0) verdict = en ? 'Mostly healthy, a few suggestions' : '基本健康，有少量建议'
  else verdict = en ? 'No anomaly signals (best-effort; not a guarantee of safety)' : '未见异常信号（尽力检测，不等于绝对安全）'
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
    await guard('third-party-plugins', { zh: '第三方插件盘点', en: 'Third-party plugin inventory' }, () => checkThirdPartyPlugins(home, pluginVersion, locale), locale),
    await guard('credentials-file', { zh: '凭据文件权限', en: 'Credential file permissions' }, () => checkCredentialsFile(home, { platform, icacls, statFile }, locale), locale),
    await guard('instruction-files', { zh: '工作区指令文件', en: 'Workspace instruction files' }, () => checkInstructionFiles(workspace, locale), locale),
    await guard('external-endpoints', { zh: '外部端点配置', en: 'External endpoint config' }, () => checkExternalEndpoints(configFiles, home, env, locale), locale),
    checkSecurityServices(services, locale),
    await guard('plugin-egress', { zh: '已装插件出网扫描', en: 'Installed-plugin egress scan' }, () => checkPluginEgress(home, locale), locale),
  ]
  const { summary, verdict } = summarize(checks, locale)
  const report = { generatedAt: new Date().toISOString(), home, workspace, locale, checks, summary, verdict }
  if (pluginVersion) report.pluginVersion = pluginVersion
  return report
}
