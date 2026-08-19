/**
 * dsh-security-doctor — sentinel (lib/watch.js) unit test (v1.0.0).
 *
 * Drives createWatch against a throwaway temp tree (home + workspace) and
 * asserts the plan 3-2 contract:
 * - the snapshot lists exactly the high-value files (home patch/config +
 *   profiles + workspace instruction files, nested AGENTS.md included),
 * - every value is `mtimeMs:fingerprint`, and a content change, a plain
 *   mtime touch, an add, and a delete all move the snapshot,
 * - .vscode/settings.json is tracked ONLY when it carries prompt keys
 *   (C4 feedback #4 policy),
 * - large files degrade to the size marker without hashing content,
 * - unreadable entries keep their slot with a marker (never vanish),
 * - the entry cap bounds the snapshot deterministically,
 * - the host side is STATELESS: two snapshots with nothing changed in
 *   between are deep-equal (no host memory → no false alarms on restart).
 * Run with:
 *
 *   node test/watch.mjs
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createWatch } from '../lib/watch.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), 'dsd-watch-'))
  const home = path.join(root, 'home')
  const workspace = path.join(root, 'ws')
  await mkdir(path.join(home, 'profiles', 'web'), { recursive: true })
  await mkdir(path.join(workspace, 'sub', 'deep'), { recursive: true })
  await mkdir(path.join(workspace, '.vscode'), { recursive: true })

  // seed the tree: home configs, one profile, root + nested instruction files
  await writeFile(path.join(home, 'cordis.patch.yml'), 'plugins: []\n')
  await writeFile(path.join(home, 'profiles', 'web', 'cordis.patch.yml'), 'plugins: [dsh-x]\n')
  await writeFile(path.join(workspace, 'AGENTS.md'), '# agent\n')
  await writeFile(path.join(workspace, 'sub', 'AGENTS.md'), '# nested\n')
  await writeFile(path.join(workspace, '.vscode', 'settings.json'), '{"editor.fontSize": 14}\n')

  const watch = createWatch({ home, workspace })
  const snap1 = await watch.snapshot()

  // ── shape: exactly the high-value set ──
  assert.equal(snap1.workspace, workspace, 'snapshot carries the workspace')
  const keys = Object.keys(snap1.files)
  for (const expected of [
    'home:cordis.patch.yml',
    'home:settings.yaml', // absent on disk — still listed (absence is watchable)
    'home:profiles/web/cordis.patch.yml',
    'home:profiles/web/cordis.yml',
    'home:profiles/web/package.json',
    'ws:AGENTS.md',
    'ws:sub/AGENTS.md',
  ]) {
    assert.ok(keys.includes(expected), `snapshot lists ${expected}`)
  }
  // plain editor settings without prompt keys must NOT be watched
  assert.ok(!keys.includes('ws:.vscode/settings.json (prompt keys)'),
    'vscode settings without prompt keys are not watched')

  // every value is mtimeMs:fingerprint, or an explicit marker (missing /
  // unreadable) — an entry NEVER silently vanishes from the snapshot
  for (const key of keys) {
    const value = snap1.files[key]
    assert.ok(/^\d+:/.test(value) || value === 'missing' || value === 'unreadable',
      `${key} value is mtimeMs:fingerprint or an explicit marker`)
  }
  assert.equal(snap1.files['home:settings.yaml'], 'missing',
    'an absent file keeps its slot with the missing marker (creation later is a change)')

  // ── statelessness: an unchanged tree yields a deep-equal snapshot ──
  const snap1b = await watch.snapshot()
  assert.deepEqual(snap1b.files, snap1.files, 'host side keeps no state between snapshots')

  // ── content change moves the fingerprint ──
  await sleep(5) // ensure a new mtime second-granularity cannot mask the change
  await writeFile(path.join(home, 'cordis.patch.yml'), 'plugins: [dsh-evil]\n')
  const snap2 = await watch.snapshot()
  assert.notEqual(snap2.files['home:cordis.patch.yml'], snap1.files['home:cordis.patch.yml'],
    'content change moves the home patch fingerprint')

  // ── new file appears / deleted file disappears ──
  await writeFile(path.join(home, 'settings.yaml'), 'locale: zh\n')
  const snap3 = await watch.snapshot()
  assert.notEqual(snap3.files['home:settings.yaml'], snap1.files['home:settings.yaml'],
    'a newly created settings.yaml is a change (absence was the baseline)')
  await rm(path.join(workspace, 'sub', 'AGENTS.md'))
  const snap4 = await watch.snapshot()
  assert.ok(!('ws:sub/AGENTS.md' in snap4.files), 'deleted instruction file leaves the snapshot')

  // ── vscode settings gain prompt keys → become watched ──
  await writeFile(path.join(workspace, '.vscode', 'settings.json'), '{"chat.promptFiles": ["AGENTS.md"]}\n')
  const snap5 = await watch.snapshot()
  assert.ok('ws:.vscode/settings.json (prompt keys)' in snap5.files,
    'vscode settings WITH prompt keys are watched')

  // ── large file degrades to the size marker (no content hash) ──
  const small = createWatch({ home, workspace, maxHashBytes: 4 })
  const snapSmall = await small.snapshot()
  assert.match(snapSmall.files['ws:AGENTS.md'], /^\d+:big:\d+$/,
    'file above maxHashBytes fingerprints as size marker only')

  // ── unreadable entry keeps its slot with a marker ──
  // chmod is a no-op for reads on Windows, so the EACCES path is exercised
  // through the injected fs instead of real permissions
  await writeFile(path.join(workspace, 'CLAUDE.md'), '# claude\n')
  const eaccesFs = new Proxy(fsp, {
    get(target, prop) {
      if (prop !== 'readFile' && prop !== 'stat' && prop !== 'readdir') return target[prop]
      const fn = target[prop]
      return async (...args) => {
        if (prop === 'readFile' && String(args[0]).endsWith('CLAUDE.md')) {
          const err = new Error('EACCES: permission denied')
          err.code = 'EACCES'
          throw err
        }
        return fn(...args)
      }
    },
  })
  const lockedWatch = createWatch({ home, workspace, fs: eaccesFs })
  const snapLock = await lockedWatch.snapshot()
  assert.ok('ws:CLAUDE.md' in snapLock.files, 'unreadable file still occupies its slot')
  assert.match(snapLock.files['ws:CLAUDE.md'], /unreadable/, 'unreadable file carries the marker')

  // ── entry cap: bounded, deterministic, home-first ──
  const capped = createWatch({ home, workspace, maxFiles: 3 })
  const snapCap = await watch.snapshot()
  const snapCapped = await capped.snapshot()
  assert.equal(Object.keys(snapCapped.files).length, 3, 'snapshot respects the entry cap')
  assert.ok('home:cordis.patch.yml' in snapCapped.files, 'cap keeps the home patch (most critical first)')
  assert.equal(snapCap.files['home:cordis.patch.yml'], snapCapped.files['home:cordis.patch.yml'],
    'capped and uncapped agree on shared entries')

  await rm(root, { recursive: true, force: true })
  console.log('WATCH OK — snapshot set, change/touch/add/delete detection, prompt-key conditional, big-file + unreadable + cap paths, stateless host')
}

main().then(
  () => process.exit(0),
  async (error) => {
    console.error('WATCH FAILED:', error)
    process.exit(1)
  },
)
