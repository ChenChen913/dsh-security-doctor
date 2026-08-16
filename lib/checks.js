/**
 * dsh-security-doctor — check engine.
 *
 * Pure read-only checks over the harness home (`~/.dsh`) and the workspace.
 * Every check is independent: one failing check degrades to `error` and the
 * rest still run. Nothing here evaluates config, executes plugin code, or
 * makes network requests. Credential *contents* are never read — only file
 * permission bits.
 *
 * Path layout expectations follow the official publish docs (profiles/,
 * cordis.patch.yml, settings.yaml). Unknown layout degrades to `error`
 * findings, never a crash.
 */

import { promises as fs } from 'node:fs'
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
 */

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

/** C1: `!!js` in any composed patch/config — config-as-code, i.e. eval at load. */
async function checkJsDirectives(configFiles, home) {
  const hits = []
  for (const file of configFiles.filter((f) => !f.endsWith('package.json'))) {
    const text = await readTextIfExists(file)
    if (text === null) continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('!!js')) {
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
    advice: '逐条确认每个 !!js 表达式的来源与作用；不认识的先注释掉再重启。自己写的也应尽量改成声明式字段。' }
}

/** C2: third-party plugin inventory per profile + supply-chain signals. */
async function checkThirdPartyPlugins(home) {
  const external = []
  const profilesRoot = path.join(home, 'profiles')
  let profileDirs = []
  try {
    profileDirs = (await fs.readdir(profilesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(profilesRoot, entry.name))
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
    return { id: 'third-party-plugins', title: '第三方插件盘点', severity: 'info', status: 'error',
      detail: '~/.dsh/profiles 目录不存在，无法盘点插件依赖。', advice: '确认 harness 主目录布局是否为新版格式。' }
  }
  for (const dir of profileDirs) {
    const pkg = JSON.parse(await readTextIfExists(path.join(dir, 'package.json')) ?? '{}')
    const deps = pkg.dependencies ?? {}
    for (const [name, spec] of Object.entries(deps)) {
      if (name.startsWith('@deepseek-ai/')) continue
      const isGit = /^(github:|git[+:]|https?:\/\/.+\.git)/.test(spec)
      const pinned = !isGit || /#[0-9a-f]{7,40}$/.test(spec)
      let installScript = false
      const depPkg = JSON.parse(await readTextIfExists(path.join(dir, 'node_modules', name, 'package.json')) ?? '{}')
      const scripts = depPkg.scripts ?? {}
      installScript = Boolean(scripts.prepare || scripts.postinstall || scripts.preinstall)
      external.push({ name, spec, isGit, pinned, installScript })
    }
  }
  if (external.length === 0) {
    return { id: 'third-party-plugins', title: '第三方插件盘点', severity: 'info', status: 'pass',
      detail: `已检查 ${profileDirs.length} 个 profile，未发现官方 @deepseek-ai/* 之外的插件依赖。`,
      advice: '安装新插件时（dsh plugin add）记得先用安全检测流程审一遍来源。' }
  }
  const lines = external.map((p) => {
    const flags = []
    if (p.isGit && !p.pinned) flags.push('git 引用未锁定 commit')
    if (p.installScript) flags.push('携带 prepare/postinstall 安装脚本')
    return `- ${p.name} (${p.spec})${flags.length ? ' ⚠ ' + flags.join('、') : ''}`
  })
  return { id: 'third-party-plugins', title: '第三方插件盘点', severity: 'medium', status: 'finding',
    detail: `发现 ${external.length} 个外来插件依赖：\n${lines.join('\n')}\n（本体检不做代码级深度审查）`,
    advice: '每个外来插件按《安全检测指南》过一遍再继续使用；未锁定 commit 的 git 引用建议锁定到具体提交；携带安装脚本的包优先在隔离环境安装。' }
}

/** C3: credential file permission bits. Contents are never read. */
async function checkCredentialsFile(home) {
  const file = path.join(home, '.credentials.yaml')
  let stat
  try {
    stat = await fs.stat(file)
  } catch {
    return { id: 'credentials-file', title: '凭据文件权限', severity: 'info', status: 'pass',
      detail: '未发现 ~/.dsh/.credentials.yaml（Key 可能来自环境变量或 .env）。',
      advice: '环境变量中的 Key 同样敏感：不要让插件打印 env，也不要把 Key 写进工作区文件。' }
  }
  if (process.platform === 'win32') {
    return { id: 'credentials-file', title: '凭据文件权限', severity: 'info', status: 'finding',
      detail: `存在凭据文件 ${file}（Windows 下无法用 POSIX 权限位判断）。`,
      advice: '在文件属性 → 安全 中确认该文件仅当前用户可读，不继承宽泛的组权限。' }
  }
  const mode = stat.mode & 0o777
  if (mode === 0o600) {
    return { id: 'credentials-file', title: '凭据文件权限', severity: 'info', status: 'pass',
      detail: `${file} 权限为 600（仅所有者可读写），符合预期。`, advice: '保持现状。' }
  }
  return { id: 'credentials-file', title: '凭据文件权限', severity: 'medium', status: 'finding',
    detail: `${file} 权限为 ${mode.toString(8)}，宽于 600，其他账户可能读取。`,
    advice: `执行 chmod 600 ${file} 收紧权限。` }
}

/** C4: workspace instruction files that get injected into model context. */
async function checkInstructionFiles(workspace) {
  const candidates = ['AGENTS.md', 'CLAUDE.md', '.agents', '.cursorrules', '.windsurfrules', '.clinerules']
  const found = []
  for (const name of candidates) {
    if (await exists(path.join(workspace, name))) found.push(name)
  }
  if (found.length === 0) {
    return { id: 'instruction-files', title: '工作区指令文件', severity: 'info', status: 'pass',
      detail: `当前工作目录（${workspace}）没有会被注入模型上下文的指令文件。`, advice: '无需处理。' }
  }
  return { id: 'instruction-files', title: '工作区指令文件', severity: 'info', status: 'finding',
    detail: `发现 ${found.join('、')}——它们的内容会原样进入模型上下文。`,
    advice: '在 workspace-write 权限下模型也能改写这些文件：定期 diff 指令文件，来源不明的"提示"不要写进去；高敏感工作区可改用 read-only 预设。' }
}

/** C5: external endpoint lines in user-composed config. */
async function checkExternalEndpoints(configFiles, home) {
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
  if (hits.length === 0) {
    return { id: 'external-endpoints', title: '外部端点配置', severity: 'info', status: 'pass',
      detail: '用户配置文件中没有出现 baseURL 类端点改写。', advice: '保持 Key 与端点来自官方渠道。' }
  }
  return { id: 'external-endpoints', title: '外部端点配置', severity: 'info', status: 'finding',
    detail: `以下端点配置会决定请求（含凭据）发往哪里：\n${hits.join('\n')}`,
    advice: '确认每个 baseURL 都指向你信任的官方域名；插件若改写 baseURL，等于能把你的 API Key 送往任意服务器。' }
}

/**
 * C6: core protection services mounted in this process. Presence only —
 * internal state is intentionally not probed.
 * @param {Record<string, boolean>} services
 */
function checkSecurityServices(services) {
  const expected = [
    { key: 'permissionPresets', label: 'permissionPresets（权限预设）' },
    { key: 'approval', label: 'approval（工具审批）' },
    { key: 'sandbox', label: 'sandbox（进程隔离）' },
    { key: 'webServer', label: 'webServer（Web 服务）' },
  ]
  const missing = expected.filter((s) => !services[s.key]).map((s) => s.label)
  if (missing.length === 0) {
    return { id: 'security-services', title: '核心防护服务', severity: 'info', status: 'pass',
      detail: 'permissionPresets / approval / sandbox / webServer 均已装载。', advice: '保持默认的 ask 审批 + workspace-write 预设即可。' }
  }
  return { id: 'security-services', title: '核心防护服务', severity: 'medium', status: 'finding',
    detail: `以下防护服务未在本进程探测到：${missing.join('、')}。`,
    advice: '确认没有通过 patch 关闭安全层；danger-full-access / approval=never 只在完全可信的环境使用。' }
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
 * @param {Record<string, boolean>} options.services mounted-service presence map
 * @returns {Promise<{generatedAt: string, home: string, workspace: string, checks: CheckResult[], summary: object, verdict: string}>}
 */
export async function runSecurityCheckup(options) {
  const { home, workspace, services } = options
  const configFiles = await collectConfigFiles(home)

  const checks = [
    await guard('js-directives', '配置中的 !!js 表达式', () => checkJsDirectives(configFiles, home)),
    await guard('third-party-plugins', '第三方插件盘点', () => checkThirdPartyPlugins(home)),
    await guard('credentials-file', '凭据文件权限', () => checkCredentialsFile(home)),
    await guard('instruction-files', '工作区指令文件', () => checkInstructionFiles(workspace)),
    await guard('external-endpoints', '外部端点配置', () => checkExternalEndpoints(configFiles, home)),
    checkSecurityServices(services),
  ]
  const { summary, verdict } = summarize(checks)
  return { generatedAt: new Date().toISOString(), home, workspace, checks, summary, verdict }
}
