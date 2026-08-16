/**
 * dsh-security-doctor — check engine (v0.2).
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
async function checkJsDirectives(configFiles, home) {
  const hits = []
  for (const file of configFiles.filter((f) => !f.endsWith('package.json'))) {
    const text = await readTextIfExists(file)
    if (text === null) continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const code = stripYamlComment(lines[i])
      if (/!!js(?=$|[\s/'"])/.test(code)) {
        hits.push(`${displayPath(file, home)}:${i + 1}: ${lines[i].trim()}`)
      }
    }
  }
  if (hits.length === 0) {
    return { id: 'js-directives', title: '配置中的 !!js 表达式', severity: 'info', status: 'pass',
      detail: '未在 harness 主目录的任何 cordis 补丁/配置文件中发现 !!js 指令。',
      advice: '保持现状：分发或粘贴来源不明的含 !!js 的配置前先人工审读——它在加载时会被求值，等同于执行代码。' }
  }
  return { id: 'js-directives', title: '配置中的 !!js 表达式', severity: 'high', status: 'finding',
    detail: `发现 ${hits.length} 处 !!js（加载时会被求值执行）：\n${hits.join('\n')}`,
    advice: '逐条确认每个 !!js 表达式的来源与作用；不认识的先注释掉再重启。自己写的也应尽量改成声明式字段。',
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
async function checkThirdPartyPlugins(home) {
  let collected
  try {
    collected = await collectExternalPlugins(home)
  } catch (error) {
    return { id: 'third-party-plugins', title: '第三方插件盘点', severity: 'error', status: 'error',
      detail: `盘点失败：${error && error.message ? error.message : String(error)}`,
      advice: '可到插件仓库提 issue 附上本条信息。' }
  }
  const { profileDirs, external } = collected
  if (external.length === 0) {
    return { id: 'third-party-plugins', title: '第三方插件盘点', severity: 'info', status: 'pass',
      detail: `已检查 ${profileDirs.length} 个 profile，未发现官方 @deepseek-ai/* 之外的插件依赖。`,
      advice: '安装新插件时（dsh plugin add）记得先用安全检测流程审一遍来源。' }
  }
  const lines = external.map((p) => {
    const flags = []
    if (p.name === SELF_NAME) flags.push('本插件自身')
    if (p.isGit && !p.pinned) flags.push('git 引用未锁定版本')
    if (p.installScript) flags.push('携带 prepare/postinstall 安装脚本')
    return `- ${p.name} (${p.spec})${flags.length ? ' ⚠ ' + flags.join('、') : ''}`
  })
  const hasSelf = external.some((p) => p.name === SELF_NAME)
  let advice = '每个外来插件按《安全检测指南》过一遍再继续使用；未锁定的 git 引用建议锁定到具体提交或版本标签；携带安装脚本的包优先在隔离环境安装。'
  if (hasSelf) advice += ` 本插件自身的锁定安装方式：dependencies 写 "${SELF_REPO}#v0.2.0"（发版标签），消除本条未锁定提示。`
  return { id: 'third-party-plugins', title: '第三方插件盘点', severity: 'medium', status: 'finding',
    detail: `发现 ${external.length} 个外来插件依赖：\n${lines.join('\n')}\n（深度代码审查见《安全检测指南》或本插件 v0.3 的内置扫描）`,
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
async function checkCredentialsFile(home, options) {
  const platform = options.platform ?? process.platform
  const statFile = options.statFile ?? ((file) => fs.stat(file))
  const file = path.join(home, '.credentials.yaml')
  let stat
  try {
    stat = await statFile(file)
  } catch {
    return { id: 'credentials-file', title: '凭据文件权限', severity: 'info', status: 'pass',
      detail: '未发现 ~/.dsh/.credentials.yaml（Key 可能来自环境变量或 .env）。',
      advice: '环境变量中的 Key 同样敏感：不要让插件打印 env，也不要把 Key 写进工作区文件。' }
  }
  if (platform === 'win32') {
    if (typeof options.icacls !== 'function') {
      return { id: 'credentials-file', title: '凭据文件权限', severity: 'info', status: 'finding',
        detail: `存在凭据文件 ${file}（本环境未提供 ACL 查询，无法自动判断）。`,
        advice: '在文件属性 → 安全 中确认该文件仅当前用户与 SYSTEM/管理员可读。' }
    }
    let entries
    try {
      entries = parseIcaclsAcl(await options.icacls(file))
    } catch {
      return { id: 'credentials-file', title: '凭据文件权限', severity: 'info', status: 'finding',
        detail: `存在凭据文件 ${file}（icacls 查询失败，无法自动判断）。`,
        advice: '在文件属性 → 安全 中确认该文件仅当前用户与 SYSTEM/管理员可读。' }
    }
    const wide = entries.filter((e) => WIDE_GROUPS.test(e.account) && grantsAccess(e))
    const listing = entries.map((e) => `${e.account}:${e.perms}`).join('\n')
    if (wide.length > 0) {
      return { id: 'credentials-file', title: '凭据文件权限', severity: 'medium', status: 'finding',
        detail: `${file} 的 ACL 包含宽泛账户访问：\n${wide.map((e) => `${e.account}:${e.perms}`).join('\n')}\n完整 ACL：\n${listing}`,
        advice: '在文件属性 → 安全 中移除 Users/Everyone 等宽泛账户的访问，仅保留当前用户、SYSTEM 与 Administrators。' }
    }
    return { id: 'credentials-file', title: '凭据文件权限', severity: 'info', status: 'pass',
      detail: `${file} 的 ACL 未包含宽泛账户（当前可访问账户如下，请自行确认均为预期）：\n${listing}`,
      advice: '保持现状。' }
  }
  const mode = stat.mode & 0o777
  if ((mode & 0o077) === 0) {
    return { id: 'credentials-file', title: '凭据文件权限', severity: 'info', status: 'pass',
      detail: `${file} 权限为 ${mode.toString(8).padStart(3, '0')}（组/其他位为空，仅所有者可访问），符合预期。`, advice: '保持现状。' }
  }
  return { id: 'credentials-file', title: '凭据文件权限', severity: 'medium', status: 'finding',
    detail: `${file} 权限为 ${mode.toString(8).padStart(3, '0')}，组或其他账户可访问。`,
    advice: `执行 chmod 600 ${file} 收紧权限。` }
}

/** C4: workspace instruction files that get injected into model context, with content hashes. */
async function checkInstructionFiles(workspace) {
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
    return { id: 'instruction-files', title: '工作区指令文件', severity: 'info', status: 'pass',
      detail: `当前工作目录（${workspace}）没有会被注入模型上下文的指令文件。`, advice: '无需处理。' }
  }
  return { id: 'instruction-files', title: '工作区指令文件', severity: 'info', status: 'finding',
    detail: `发现 ${found.map((f) => f.name).join('、')}——它们的内容会原样进入模型上下文。`,
    advice: '在 workspace-write 权限下模型也能改写这些文件：定期 diff 指令文件，来源不明的"提示"不要写进去；高敏感工作区可改用 read-only 预设。报告会比对每次体检的内容哈希，出现"上次之后新增/变更"要立即人工检查。',
    extra: { files: found, workspace } }
}

/**
 * C5: external endpoints — user-composed config lines plus the effective
 * `DEEPSEEK_BASE_URL` environment override (hostname only, never the full URL).
 */
async function checkExternalEndpoints(configFiles, home, env) {
  const hits = []
  for (const file of configFiles.filter((f) => !f.endsWith('package.json'))) {
    const text = await readTextIfExists(file)
    if (text === null) continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (/base[_-]?url\s*[:=]/i.test(lines[i])) {
        hits.push(`${displayPath(file, home)}:${i + 1}: ${lines[i].trim()}`)
      }
    }
  }
  const envUrl = env.DEEPSEEK_BASE_URL
  if (envUrl) {
    let hostname = null
    try { hostname = new URL(envUrl).hostname } catch { hostname = null }
    hits.push(`环境变量 DEEPSEEK_BASE_URL 生效中${hostname ? `（指向 ${hostname}）` : '（值不是合法 URL）'}——它的优先级高于配置文件`)
  }
  if (hits.length === 0) {
    return { id: 'external-endpoints', title: '外部端点配置', severity: 'info', status: 'pass',
      detail: '用户配置与环境变量中没有出现 baseURL 类端点改写。', advice: '保持 Key 与端点来自官方渠道。' }
  }
  return { id: 'external-endpoints', title: '外部端点配置', severity: 'info', status: 'finding',
    detail: `以下端点配置会决定请求（含凭据）发往哪里：\n${hits.join('\n')}`,
    advice: '确认每个 baseURL 都指向你信任的官方域名；插件若改写 baseURL，等于能把你的 API Key 送往任意服务器。' }
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
async function checkPluginEgress(home) {
  let collected
  try {
    collected = await collectExternalPlugins(home)
  } catch (error) {
    return { id: 'plugin-egress', title: '已装插件出网扫描', severity: 'error', status: 'error',
      detail: `扫描失败：${error && error.message ? error.message : String(error)}`, advice: '可到插件仓库提 issue。' }
  }
  const { external } = collected
  if (external.length === 0) {
    return { id: 'plugin-egress', title: '已装插件出网扫描', severity: 'info', status: 'pass',
      detail: '没有外来插件，无出网面可扫描。', advice: '无需处理。' }
  }
  const perPlugin = []
  for (const dep of external) {
    if (!(await exists(dep.dir))) {
      perPlugin.push({ name: dep.name, hosts: [], note: '未找到安装目录（未安装或被移除）' })
      continue
    }
    const files = await collectSourceFiles(dep.dir)
    if (files.length === 0) {
      perPlugin.push({ name: dep.name, hosts: [], note: '无可扫描源码（可能只分发编译产物或二进制）' })
      continue
    }
    const hosts = new Map()
    for (const file of files) {
      let text = null
      try {
        const stat = await fs.stat(file)
        if (stat.size > 512 * 1024) continue
        text = await fs.readFile(file, 'utf8')
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
    return { id: 'plugin-egress', title: '已装插件出网扫描', severity: 'info', status: 'pass',
      detail: `扫描了 ${external.length} 个外来插件的源码，未发现外联地址。`, advice: '保持关注：升级插件后重新体检。' }
  }
  const lines = perPlugin.map((p) => {
    if (p.note) return `- ${p.name}：${p.note}`
    if (p.hosts.length === 0) return `- ${p.name}：源码中未发现外联地址`
    return `- ${p.name} → ${p.hosts.map(([h, n]) => `${h}${n > 1 ? `(×${n})` : ''}`).join('、')}`
  })
  const severity = opaque.length > 0 ? 'medium' : 'info'
  return { id: 'plugin-egress', title: '已装插件出网扫描', severity, status: 'finding',
    detail: `${lines.join('\n')}${opaque.length > 0 ? '\n（存在无法扫描源码的插件，静态扫描无法覆盖）' : ''}`,
    advice: '逐个确认域名是否与插件 README 声明一致、是否必要；出现不认识的域名，按《安全检测指南》T5 深查该插件。此项是初筛，深链混淆与运行时拼接的地址检测不到。',
    extra: { perPlugin } }
}

/**
 * C6: core protection services — presence via `ctx.get()` plus the effective
 * policy values that are cheaply readable on the service configs.
 * @param {object} servicesInfo `{ present: Record<string, boolean>, approvalPolicy?: string, defaultPreset?: string }`
 */
function checkSecurityServices(servicesInfo) {
  const expected = [
    { key: 'permissionPresets', label: 'permissionPresets（权限预设）' },
    { key: 'approval', label: 'approval（工具审批）' },
    { key: 'sandbox', label: 'sandbox（进程隔离）' },
    { key: 'webServer', label: 'webServer（Web 服务）' },
  ]
  const present = servicesInfo?.present ?? {}
  const missing = expected.filter((s) => !present[s.key]).map((s) => s.label)
  const facts = []
  if (typeof servicesInfo?.approvalPolicy === 'string') facts.push(`审批策略（服务默认）:${servicesInfo.approvalPolicy}`)
  if (typeof servicesInfo?.defaultPreset === 'string') facts.push(`权限预设（组合默认）:${servicesInfo.defaultPreset}`)
  const factText = facts.length > 0 ? `当前生效值：${facts.join('；')}。` : '未能读取当前生效值（仅确认装载状态）。'
  const dangerous = []
  if (servicesInfo?.approvalPolicy === 'never') dangerous.push('审批策略为 never——工具调用不再询问你')
  if (typeof servicesInfo?.defaultPreset === 'string' && /danger-full-access/i.test(servicesInfo.defaultPreset)) {
    dangerous.push(`权限预设为 ${servicesInfo.defaultPreset}——模型以完全权限执行`)
  }
  if (dangerous.length > 0) {
    return { id: 'security-services', title: '核心防护服务', severity: 'high', status: 'finding',
      detail: `${dangerous.join('；')}。${factText}`,
      advice: '把审批策略改回 ask、权限预设改回 workspace-write/read-only（设置 → 模式/插件配置），只在完全可信的一次性环境里使用宽策略。' }
  }
  if (missing.length > 0) {
    return { id: 'security-services', title: '核心防护服务', severity: 'medium', status: 'finding',
      detail: `以下防护服务未在本进程探测到：${missing.join('、')}。${factText}`,
      advice: '确认没有通过 patch 关掉安全层；danger-full-access / approval=never 只在完全可信的环境使用。' }
  }
  return { id: 'security-services', title: '核心防护服务', severity: 'info', status: 'pass',
    detail: `permissionPresets / approval / sandbox / webServer 均已装载。${factText}`,
    advice: '保持默认的 ask 审批 + workspace-write 预设即可。' }
}

/** Wrap one check so a throw degrades to an error finding. */
async function guard(id, title, fn) {
  try {
    return await fn()
  } catch (error) {
    return { id, title, severity: 'error', status: 'error',
      detail: `检查本身失败：${error && error.message ? error.message : String(error)}`,
      advice: '可到插件仓库提 issue 附上本条信息。' }
  }
}

function summarize(checks) {
  const count = (severity) => checks.filter((c) => c.severity === severity && c.status !== 'pass').length
  const summary = { high: count('high'), medium: count('medium'), low: count('low'), info: count('info'), error: count('error') }
  let verdict
  if (summary.high > 0) verdict = '发现高危信号，建议立即处理'
  else if (summary.medium > 0) verdict = '存在需要关注的事项'
  else if (summary.low > 0) verdict = '基本健康，有少量建议'
  else verdict = '未见异常信号（尽力检测，不等于绝对安全）'
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
 * @returns {Promise<{generatedAt: string, home: string, workspace: string, checks: CheckResult[], summary: object, verdict: string}>}
 */
export async function runSecurityCheckup(options) {
  const { home, workspace, services, env = process.env, platform, statFile, icacls } = options
  const configFiles = await collectConfigFiles(home)

  const checks = [
    await guard('js-directives', '配置中的 !!js 表达式', () => checkJsDirectives(configFiles, home)),
    await guard('third-party-plugins', '第三方插件盘点', () => checkThirdPartyPlugins(home)),
    await guard('credentials-file', '凭据文件权限', () => checkCredentialsFile(home, { platform, icacls, statFile })),
    await guard('instruction-files', '工作区指令文件', () => checkInstructionFiles(workspace)),
    await guard('external-endpoints', '外部端点配置', () => checkExternalEndpoints(configFiles, home, env)),
    checkSecurityServices(services),
    await guard('plugin-egress', '已装插件出网扫描', () => checkPluginEgress(home)),
  ]
  const { summary, verdict } = summarize(checks)
  return { generatedAt: new Date().toISOString(), home, workspace, checks, summary, verdict }
}
