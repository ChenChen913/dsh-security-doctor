/**
 * dsh-security-doctor — high-value file change sentinel (v1.0.0, guard mode).
 *
 * EXPERIMENTAL, default OFF, opt-in from the report footer switch (the same
 * switch that drives the runtime outbound-audit hook). The host /watch route
 * calls snapshot() on every client poll; the CLIENT compares consecutive
 * snapshots and raises the badge — the host side itself keeps no state, so a
 * host restart cannot produce a false "everything changed" alarm.
 *
 * What is watched (plan 3-2 "高价值小文件集" — the files whose silent
 * modification changes what code runs or what enters the model context):
 * - harness home: cordis.patch.yml + settings.yaml + every profile's
 *   cordis.patch.yml / cordis.yml / package.json (mirrors checks.js
 *   collectConfigFiles — keep in sync);
 * - workspace instruction files: the root candidates checks.js C4 tracks
 *   (AGENTS.md / CLAUDE.md / … / .cursorrules), plus the bounded recursive
 *   AGENTS.md / CLAUDE.md walk, plus .vscode/settings.json ONLY when it
 *   carries prompt/instruction keys (same conditional as C4 — tracking it
 *   unconditionally would flag every unrelated editor setting change).
 *
 * Honest limitations, stated up front:
 * - Polling sees point-in-time state only: a modify-and-revert between two
 *   polls is invisible. The interval (45s client-side) is a compromise
 *   between coverage and cost, not a guarantee.
 * - Files larger than maxHashBytes are fingerprinted by size+mtime only (no
 *   content hash) so a poll stays cheap; the UI presents the feature as
 *   best-effort for exactly this reason.
 * - The snapshot is bounded (maxFiles). Beyond the cap, deeper entries are
 *   simply not watched — no error, no partial lies.
 *
 * The factory is dependency-injected ({ home, workspace, fs, hash, maxFiles,
 * maxHashBytes }) so the unit tests (test/watch.mjs) drive it against a temp
 * directory tree instead of the real harness home.
 */

import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

/** Total entries per snapshot — the sentinel must stay cheap to poll. */
const DEFAULT_MAX_FILES = 50

/** Files above this size skip the content hash (size+mtime still tracked). */
const DEFAULT_MAX_HASH_BYTES = 512 * 1024

/** Root instruction-file candidates — mirrors checks.js C4 (keep in sync). */
const ROOT_CANDIDATES = [
  'AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md', 'GEMINI.md',
  '.github/copilot-instructions.md', '.agents', '.cursor/rules',
  '.cursorrules', '.windsurfrules', '.clinerules',
]

/** Nested instruction names current tooling loads per subdirectory (C4 0-2). */
const NESTED_NAMES = new Set(['AGENTS.md', 'CLAUDE.md'])

/** Directories a bounded walk never descends into (C4 0-2 policy). */
const NOISE_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.pnpm', 'dist', 'build', 'out',
  'target', '.next', '.cache', '.venv', 'venv', '__pycache__',
])

/**
 * Deterministic fingerprint of a directory entry tree (bounded depth): sorted
 * `type:name:size:mtimeMs` lines hashed together. A file added, removed, or
 * touched inside the directory changes the fingerprint without hashing file
 * CONTENTS — instruction directories (.agents, .cursor/rules) are meant to be
 * small, but the sentinel refuses to assume it.
 */
async function dirFingerprint(dir, fs, hash, depth, maxDepth) {
  const parts = []
  const walk = async (current, level) => {
    if (level > maxDepth) return
    let entries = []
    try { entries = await fs.readdir(current, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      let size = -1
      let mtimeMs = -1
      try {
        const stat = await fs.stat(full)
        size = stat.size
        mtimeMs = Math.round(stat.mtimeMs)
      } catch { /* unreadable entry — the marker itself is the fingerprint */ }
      parts.push(`${entry.isDirectory() ? 'd' : 'f'} ${entry.name} ${size} ${mtimeMs}`)
      if (entry.isDirectory()) await walk(full, level + 1)
    }
  }
  await walk(dir, 0)
  return 'tree:' + hash(parts.join('\n'))
}

export function createWatch(options = {}) {
  const home = options.home ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh')
  const workspace = options.workspace ?? process.cwd()
  const fs = options.fs ?? fsp
  const hash = options.hash ?? ((data) => createHash('sha256').update(data).digest('hex'))
  const maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_MAX_FILES)
  const maxHashBytes = Math.max(0, options.maxHashBytes ?? DEFAULT_MAX_HASH_BYTES)

  /**
   * One entry's fingerprint value: `mtimeMs:<fp>`. mtime rides along so even
   * a same-content rewrite (touch, chmod-then-restore) is visible; the hash
   * makes content changes detectable regardless of mtime granularity.
   * @returns {Promise<string>} never rejects — an unreadable entry keeps its
   * slot with an `unreadable` marker so a later readable state counts as a
   * change instead of silently vanishing.
   */
  async function entryValue(target) {
    let stat
    try {
      stat = await fs.stat(target)
    } catch (error) {
      // ENOENT keeps the slot with a `missing` marker — creation later is a
      // change; other failures (permissions) use `unreadable`
      if (!error || error.code === 'ENOENT') return 'missing'
      return 'unreadable'
    }
    const mtimeMs = Math.round(stat.mtimeMs)
    if (stat.isDirectory()) return `${mtimeMs}:${await dirFingerprint(target, fs, hash, 0, 3)}`
    if (stat.size > maxHashBytes) return `${mtimeMs}:big:${stat.size}` // cheap path
    try {
      const data = await fs.readFile(target)
      return `${mtimeMs}:${hash(data)}`
    } catch {
      return `${mtimeMs}:unreadable`
    }
  }

  /** Add one entry under a display key unless the cap is already reached. */
  async function addEntry(files, key, target) {
    if (Object.keys(files).length >= maxFiles) return
    files[key] = await entryValue(target)
  }

  /** Home-side patch/config files (collectConfigFiles layout). */
  async function collectHome(files) {
    await addEntry(files, 'home:cordis.patch.yml', path.join(home, 'cordis.patch.yml'))
    await addEntry(files, 'home:settings.yaml', path.join(home, 'settings.yaml'))
    let profileDirs = []
    try {
      profileDirs = (await fs.readdir(path.join(home, 'profiles'), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b))
    } catch { /* no profiles directory — nothing to watch */ }
    for (const name of profileDirs) {
      for (const file of ['cordis.patch.yml', 'cordis.yml', 'package.json']) {
        await addEntry(files, `home:profiles/${name}/${file}`, path.join(home, 'profiles', name, file))
      }
    }
  }

  /** Workspace instruction files (C4 layout, bounded). */
  async function collectWorkspace(files) {
    for (const name of ROOT_CANDIDATES) {
      await addEntry(files, `ws:${name}`, path.join(workspace, name))
    }
    // .vscode/settings.json only when it actually carries prompt/instruction
    // keys (C4 feedback #4 policy) — a plain editor-settings file is noise
    const vscode = path.join(workspace, '.vscode', 'settings.json')
    try {
      const text = await fs.readFile(vscode, 'utf8')
      if (/prompt|instruction/i.test(text)) await addEntry(files, 'ws:.vscode/settings.json (prompt keys)', vscode)
    } catch { /* absent or unreadable — not watched */ }
    // bounded recursive AGENTS.md / CLAUDE.md walk, same policy as C4 0-2
    const nested = []
    const walkSub = async (dir, depth) => {
      if (nested.length >= 20 || depth > 3) return
      let entries = []
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (nested.length >= 20) return
        if (NOISE_DIRS.has(entry.name) || (entry.name.startsWith('.') && entry.name !== '.github')) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) await walkSub(full, depth + 1)
        else if (NESTED_NAMES.has(entry.name)) {
          nested.push(path.relative(workspace, full).split(path.sep).join('/'))
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
    nested.sort((a, b) => a.localeCompare(b))
    for (const rel of nested) await addEntry(files, `ws:${rel}`, path.join(workspace, rel))
  }

  /**
   * Current snapshot: `{ workspace, files }` where files maps display keys to
   * `mtimeMs:fingerprint` strings. Stable shape, no state on the host side —
   * consecutive snapshots are diffed by the client.
   */
  async function snapshot() {
    const files = {}
    await collectHome(files)
    await collectWorkspace(files)
    return { workspace, files }
  }

  return { snapshot, home, workspace, maxFiles }
}
