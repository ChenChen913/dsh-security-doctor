# dsh-security-doctor

English | [中文](README.md)

A one-click **local security checkup plugin** for the DeepSeek Harness (DSH) Web UI: a "安全体检" (Security checkup) button in the sidebar footer that auto-runs once on install (red badge while high findings are unacknowledged) and, on click, opens a "Liquid Glass" severity-graded report — a circular 0–100 security score, high cards first, trend vs the last checkup, one-click repair "prescriptions", copy-markdown / export-json, clickable path copy, zh/en UI. Fully **read-only**: it never executes code from the things it checks, sends nothing anywhere by default, and needs no API key. Design spec archive: [design/](design/DESIGN.md).

> Context: the official `awesome-dsh-plugin` list warns that "installing a plugin runs third-party code with your own permissions — this list is not a security review." This plugin turns "is my environment okay?" into a single click.

## What it checks

| Check | What | Hit level |
| --- | --- | --- |
| `!!js` in config | Every cordis patch/config under `~/.dsh`, comments stripped (mentions in comments don't count); `!!js` is evaluated at load | High |
| Third-party plugin inventory | Per-profile deps; flags non-`@deepseek-ai` plugins, unpinned git refs, `prepare`/`postinstall` scripts; identifies itself | Attention |
| Plugin egress scan | Static scan of external plugin source for `http(s)://`/`ws(s)://` hosts (comments stripped, loopback excluded), per plugin; plugins without scannable source flagged | Info/Attention |
| Credential file permissions | `~/.dsh/.credentials.yaml`: POSIX group/other bits (0400/0600 pass); **Windows: read-only `icacls` ACL query, Users/Everyone read access flagged**. Bits/ACL only, contents never read | Attention |
| Workspace instruction files | `AGENTS.md` / `CLAUDE.md` / `.agents/` with SHA-256 hashes, diffed against the last checkup | Info |
| External endpoints | `baseURL` lines in config plus the effective `DEEPSEEK_BASE_URL` env override (hostname only) | Info |
| Protection services & policy | Presence via `ctx.get()`; reads the effective policy values — approval `never` or `danger-full-access` preset is high | Attention/High |

The report footer states the producing version; a manual "Check update" button queries the latest GitHub release **only when you click it** — the plugin's only explicit egress (one request, version info only, zero by default).

## Install & update

> ⚠️ **Read first**: (1) a running `dsh web` does NOT hot-load new plugin layers — **restart `dsh web` after installing** or the button won't appear; (2) restarting briefly interrupts conversations — wind down first.

```bash
dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.7.0
```

The `#v0.7.0` tag pins the exact released commit (reproducible, rollback-able; once published to npm: `dsh plugin --profile web add dsh-security-doctor`). Running DSH from a source checkout? From the harness repo: `pnpm dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.7.0`, or `node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.7.0`.

Install self-verification (curl returns `ok:true` + console logs `[dsh-security-doctor] client loaded; host self-test: v0.7.0` + the button appears):

```bash
curl -H 'x-dsh-security-doctor: 1' http://127.0.0.1:3080/dsh-security-doctor/self-test
```

**Update / rollback / migration**: repin the dependency tag to the target version → reinstall (same command) → restart `dsh web` → refresh the page — all four steps required (host code lives in process memory; the client caches plugin metadata). Check [CHANGELOG.md](CHANGELOG.md) and the [Releases](https://github.com/ChenChen913/dsh-security-doctor/releases) first (each carries a diff link and the tag commit SHA). Legacy 0.1.x unpinned installs should migrate to a `#tag` reference; for absolute immutability pin the commit SHA: `github:ChenChen913/dsh-security-doctor#<tag SHA from the Release page>`.

## Data flow in one glance

**Reads**: `~/.dsh` config/dependency manifests, credential-file **permission bits and ACL account names only** (never contents), workspace instruction-file names+hashes, external plugin source text, service presence/policy, `DEEPSEEK_BASE_URL` hostname. **Writes**: no files; browser localStorage only (history, hash snapshots). **Sends**: nothing by default (localhost GET routes from the page to your own dsh web); the single explicit exception is the manual, click-triggered release query to `api.github.com`.

## Security commitments

1. **Read-only**: never executes code from checked objects, never modifies user files; the only external command is the Windows `icacls` read-only ACL query (fixed arguments, no shell, no user input).
2. **Zero egress by default**: localhost GET routes require the pairing header `x-dsh-security-doctor: 1` (cross-site pages cannot read your report); since v0.7.0 the `Host` header must also name a local address, blocking same-origin-spoofed reads under DNS rebinding; no external domain exists in the code except the manual check-update query.
3. **Zero credential exposure**: permission bits/ACL only — contents are never read, sent, or echoed; echoed lines are auto-redacted; leak-free asserted by tests anyone can re-run.

It audits itself first with its own published standard: [self-audit report](docs/SELF-AUDIT.md) · [security policy](SECURITY.md). Zero runtime dependencies, no install scripts, no build step (`node --check` verifiable); SHA-pinned CI actions, 3-OS × Node 22/24 matrix. Verify: `node test/smoke.mjs && node test/host.mjs && node test/client.mjs`.

## FAQ

- **No "Security checkup" button?** Restart `dsh web` after installing (see above) — a missing button ≠ failed install.
- **curl to `/check`/`/self-test` returns 403?** Both routes require the pairing header: add `-H 'x-dsh-security-doctor: 1'` to curl.
- **Which version am I running?** Report footer ("plugin vX.Y.Z"), the self-test `version` field, or the console breadcrumb — any of the three.

## Limitations (honest)

Best-effort: "no findings" is not "safe". The egress scan is a first filter (obfuscated/runtime-assembled URLs invisible; official `@deepseek-ai/*` packages are treated as a trust baseline and NOT scanned — transitive dependencies are covered since v0.7.0); POSIX mode bits are not the full ACL story; report bodies are bilingual (UI language or `?lang=`); per-session policy overrides are not read; deep code review of external plugins stays with the [security-review guide](docs/guide-security-review.md).

Docs index: [CHANGELOG](CHANGELOG.md) (per-version changes + tested matrices) · [release checklist](docs/release.md) · [v0.5 fix plan](FIX-PLAN-v0.5.md) · [security-review](docs/guide-security-review.md) / [secure-development](docs/guide-secure-development.md) guides (installable `skills/` versions included).

## Compatibility

| Plugin | Tested harness | OS | Notes |
| --- | --- | --- | --- |
| v0.7.0 | DSH 0.1.0-rc.5 | Windows (source run) | Review-fix release: transitive-dep scanning, security-layer patch detection, Host-header guard; macOS/Linux via CI matrix; Node ≥ 22 |
| v0.6.0 | DSH 0.1.0-rc.5 | Windows (source run) | macOS/Linux via CI matrix; Node ≥ 22 |
| v0.5.0 | DSH 0.1.0-rc.5 | Windows (source run) | same |
| v0.2.0 – v0.4.0 | DSH 0.1.0-rc.5 | Windows (source run) | same |
| v0.1.0 | DSH 0.1.0-rc.5 | Windows (source run) | same |

## License

MIT
