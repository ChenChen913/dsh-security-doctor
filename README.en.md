# dsh-security-doctor

English | [中文](README.md)

A one-click **local security checkup plugin** for the DeepSeek Harness (DSH) Web UI: a "Security checkup" button in the sidebar footer, one auto-checkup on install, click for a severity-graded report. Fully **read-only**: it never executes code from the things it checks, sends nothing by default, and needs no API key.

> Context: the official plugin list warns that "installing a plugin runs third-party code with your own permissions — this list is not a security review." This plugin turns "is my environment okay?" into a single click.

## Features

- **Graded report**: circular 0–100 score, high cards first, trend vs the last checkup, one-click repair "prescriptions", copy-markdown / export-json, zh/en UI
- **AI deep review**: one-click structured review prompt for suspicious plugins — run it with your own agent, paste conclusions back, anchored to code fingerprints (clipboard loop, zero API)
- **Guard mode** (experimental, default off): runtime outbound auditing + a high-value file-change sentinel — see below

## What it checks

| Check | What | Level |
| --- | --- | --- |
| `!!js` in config | every cordis patch/config under `~/.dsh` (comments and doc samples stripped); the expression is evaluated at load | High |
| Security-layer patches | `remove:`/`replace:` targeting official protection plugins (approval / sandbox / permission…) — flagged with file+line | High |
| Third-party plugin inventory | per-profile deps, official vs external; unpinned git refs and `postinstall` scripts flagged; npm-flat and pnpm layouts | Attention |
| Egress & intent signals | static scan of external plugin source: outbound hosts, `eval`/base64 obfuscation, email/credential-access intent annotated; credential-access + egress co-occurring in one file upgrades to High; 3-tier suspicion score; code-tree fingerprints diffed across runs | Info → High |
| Credential file permissions | `~/.dsh/.credentials.yaml`: POSIX bits / Windows ACL accounts — **bits only, contents never read** | Attention |
| Instruction files | `AGENTS.md` / `CLAUDE.md` / `.cursor/rules/` etc., recursive scan, SHA-256 diffed across runs | Info |
| External endpoints | `baseURL` in config + the effective `DEEPSEEK_BASE_URL` (hostname only) | Info |
| Protection services & policy | service presence + effective policy values: approval `never` or `danger-full-access` preset (session-level `DSH_PERMISSION_MODE` included) is High | Attention / High |

## Guard mode (experimental, default off)

A switch in the report footer. On, the plugin shifts from "doctor" (periodic checkups) to "monitor" (continuous observation) — entirely local:

- **Outbound auditing**: wraps in-process `http`/`https` `.request`/`.get`, records "which plugin → which host → method → credential-like present" into a bounded in-memory ring buffer (cap 50; hostnames and booleans only, **payload contents never recorded**). Attribution is best-effort from the call stack; `fetch` and raw sockets are not covered
- **Change sentinel**: every 45s snapshots `~/.dsh` patch/config + workspace instruction files (mtime+hash); a change lights the badge, opening the report lists the changed files. First snapshot is a silent baseline; the host side is stateless (a restart cannot fake "everything changed")
- **One-click off, uninstall rolls back**: the switch stops polling and unwraps hooks immediately; unloading restores original module exports via `ctx.effect`

## Install & update

> ⚠️ **Restart `dsh web` after installing** — a running instance does not hot-load plugin layers (restarting briefly interrupts conversations; wind down first).

```bash
dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v1.0.0
```

The `#v1.0.0` tag pins the exact release (reproducible, rollback-able); once on npm: `dsh plugin --profile web add dsh-security-doctor`; from a source checkout, run inside the harness repo: `pnpm dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v1.0.0`.

Verify (returns `ok:true` and the button appears in the sidebar):

```bash
curl -H 'x-dsh-security-doctor: 1' http://127.0.0.1:3080/dsh-security-doctor/self-test
```

**Update / rollback**: repin the tag → reinstall (same command) → restart `dsh web` → refresh the page — all four steps required. Check [CHANGELOG](CHANGELOG.md) and [Releases](https://github.com/ChenChen913/dsh-security-doctor/releases) first.

## Data flow in one glance

| Question | Answer |
| --- | --- |
| Reads | `~/.dsh` config/dependency manifests, credential-file **permission bits and ACL accounts** (never contents), instruction-file names+hashes, external plugin source, service presence/policy; guard mode adds outbound hostnames and file fingerprints |
| Writes | no files; browser localStorage only (history, preferences, sentinel baselines); guard audit records are memory-only and vanish on refresh |
| Sends | zero by default (localhost routes only); the single exception is the manual check-update query to `api.github.com` |

## Security commitments

1. **Read-only**: never executes code from checked objects, never modifies user files; the only external command is the Windows `icacls` read-only ACL query (fixed arguments, no user input)
2. **Zero egress by default**: localhost routes require the pairing header `x-dsh-security-doctor: 1` and a local `Host` header (blocks cross-site reads and DNS rebinding); LAN deployments can extend the allowlist via `DSH_ALLOWED_HOSTS`
3. **Zero credential exposure**: permission bits only — contents never read, sent, or echoed; echoes are auto-redacted; leak-free asserted by tests anyone can re-run
4. **Experimental features labeled honestly**: guard-mode boundaries (best-effort attribution, no `fetch`/raw-socket coverage, polling gaps) are stated in the UI and docs

It audits itself with its own published standard: [self-audit report](docs/SELF-AUDIT.md) · [security policy](SECURITY.md). Zero runtime dependencies, no install scripts, no build step; SHA-pinned CI, 3-OS × Node 22/24 matrix. Verify: `node test/smoke.mjs && node test/host.mjs && node test/client.mjs && node test/guard.mjs && node test/watch.mjs`.

## FAQ

- **No button?** Restart `dsh web` — a missing button ≠ failed install
- **curl returns 403?** Routes require the pairing header: add `-H 'x-dsh-security-doctor: 1'`
- **Which version?** Report footer, the self-test `version` field, or the console breadcrumb

## Limitations (honest)

Best-effort: "no findings" is not "safe".

- The static scan is a first filter: obfuscated or runtime-assembled URLs are invisible; combination hits are file-level co-occurrence, not proven data flow
- Official `@deepseek-ai/*` packages are a trust baseline and not scanned (transitive dependencies covered)
- Guard mode likewise: attribution can be spoofed by advanced code; modify-and-revert between sentinel polls is invisible; large files degrade to size+mtime fingerprints
- POSIX mode bits are not the full ACL story; other per-session/agent policy overrides are not read
- Deep semantic review goes to the AI deep-review loop: [security-review guide](docs/guide-security-review.md)

## Compatibility

Tested with DSH 0.1.0-rc.5 on Windows (source run); macOS/Linux covered by the CI 3-OS × Node 22/24 matrix, Node ≥ 22. Per-version tested matrices: [CHANGELOG](CHANGELOG.md).

More docs: [release checklist](docs/release.md) · [secure-development guide](docs/guide-secure-development.md) · [design spec](design/DESIGN.md) (installable `skills/` versions included).

## License

MIT
