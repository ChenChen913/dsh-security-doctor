/**
 * dsh-security-doctor — smoke test for the check engine.
 *
 * Builds a fake harness home in the OS temp dir (with a `!!js` patch, an
 * external profile dependency, a credentials file, and a workspace holding
 * an AGENTS.md) and asserts the checkup classifies each signal. Run with:
 *
 *   node test/smoke.mjs
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { runSecurityCheckup } from '../lib/checks.js'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsd-smoke-'))
  const home = path.join(root, 'home')
  const workspace = path.join(root, 'workspace')
  const profile = path.join(home, 'profiles', 'web')

  await fs.mkdir(profile, { recursive: true })
  await fs.mkdir(workspace, { recursive: true })

  await fs.writeFile(path.join(home, 'cordis.patch.yml'), '# home patch\n- insert:\n    - id: mine\n      name: ./mine.ts\n')
  await fs.writeFile(path.join(profile, 'cordis.patch.yml'),
    '- insert:\n    - id: evil\n      name: dsh-evil\n      config:\n        greeting: !!js \'"pwn" + process.pid\'\n')
  await fs.writeFile(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: {
      '@deepseek-ai/dsh-base': 'workspace:^',
      'dsh-evil-helper': 'github:attacker/dsh-evil-helper',
      'dsh-packed': '^1.0.0',
    },
  }, null, 2))
  await fs.mkdir(path.dirname(path.join(profile, 'node_modules', 'dsh-packed', 'package.json')), { recursive: true })
  await fs.writeFile(path.join(profile, 'node_modules', 'dsh-packed', 'package.json'), JSON.stringify({
    name: 'dsh-packed', scripts: { postinstall: 'node collect.js' },
  }))
  await fs.writeFile(path.join(home, '.credentials.yaml'), 'DEEPSEEK_API_KEY: sk-not-a-real-key\n')
  await fs.writeFile(path.join(home, 'settings.yaml'), 'ui-theme: dark\n')
  await fs.writeFile(path.join(workspace, 'AGENTS.md'), '# workspace instructions\n')

  const report = await runSecurityCheckup({
    home,
    workspace,
    services: { permissionPresets: true, approval: true, sandbox: false, webServer: true },
  })

  const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]))

  assert.equal(byId['js-directives'].severity, 'high')
  assert.match(byId['js-directives'].detail, /cordis\.patch\.yml:5/)
  assert.ok(!byId['js-directives'].detail.includes('not-a-real-key'), 'credential value must never appear')

  assert.equal(byId['third-party-plugins'].severity, 'medium')
  assert.match(byId['third-party-plugins'].detail, /dsh-evil-helper/)
  assert.match(byId['third-party-plugins'].detail, /未锁定 commit/)
  assert.match(byId['third-party-plugins'].detail, /dsh-packed[^\n]*安装脚本/)
  assert.ok(!byId['third-party-plugins'].detail.includes('dsh-base'))

  assert.equal(byId['credentials-file'].status !== 'error', true)
  assert.ok(!JSON.stringify(report).includes('not-a-real-key'), 'credential value must never appear anywhere')

  assert.equal(byId['instruction-files'].status, 'finding')
  assert.match(byId['instruction-files'].detail, /AGENTS\.md/)

  assert.equal(byId['security-services'].severity, 'medium')
  assert.match(byId['security-services'].detail, /sandbox/)

  assert.equal(report.summary.high, 1)
  assert.equal(report.summary.medium, 2)
  assert.match(report.verdict, /高危/)

  console.log('SMOKE OK — verdict:', report.verdict)
  console.log('summary:', JSON.stringify(report.summary))
}

main().then(
  () => process.exit(0),
  (error) => { console.error('SMOKE FAILED:', error); process.exit(1) },
)
