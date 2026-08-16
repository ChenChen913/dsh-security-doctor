# dsh-security-doctor

English | [中文](README.md)

A one-click **local security checkup plugin** for the DeepSeek Harness (DSH) Web UI: a "🛡 安全体检" (Security checkup) button in the sidebar footer that runs **read-only** checks against your local DSH environment (auto-run once on install, red badge while high findings are unacknowledged) and shows a severity-sorted report with high cards first. It never executes code from the things it checks, sends nothing anywhere by default, and needs no API key. v0.4 redesigns the report modal with a "Liquid Glass" look: frosted translucent panels, a circular 0–100 security score gauge, status dots + capsule counters, glass cards (high severity = side-bar accent, not a red wash), inline-SVG line icons, light/dark adaptive. Since v0.3 the report footer states the producing plugin version and a manual "Check update" button queries the latest GitHub release — the plugin's only explicit egress, one request on your click only.

> Context: the official `awesome-dsh-plugin` list warns that "installing a plugin runs third-party code with your own permissions — this list is not a security review." This plugin turns "is my environment okay?" into a single click.

## What it checks (v0.4)

| Check | What | Hit level |
| --- | --- | --- |
| `!!js` in config | Every cordis patch/config under `~/.dsh`, comments stripped (mentions in comments don't count) | High |
| Third-party plugin inventory | Per-profile deps; flags non-`@deepseek-ai` plugins, unpinned git refs, `prepare`/`postinstall` scripts; identifies itself | Attention |
| Plugin egress scan | Static scan of external plugin source for `http(s)://`/`ws(s)://` hosts (loopback excluded), per plugin; plugins without scannable source flagged | Info/Attention |
| Credential file permissions | POSIX: group/other bits must be empty (0400/0600 both pass); **Windows: read-only `icacls` ACL query, Users/Everyone read access flagged**. Bits/ACL only, contents never read | Attention |
| Workspace instruction files | `AGENTS.md` / `CLAUDE.md` / `.agents/` with SHA-256 hashes, diffed against last checkup (localStorage) | Info |
| External endpoints | `baseURL` lines in config plus the effective `DEEPSEEK_BASE_URL` env override (hostname only) | Info |
| Protection services & policy | Presence via `ctx.get()`; reads the **effective policy values** — approval `never` or `danger-full-access` preset is high | Attention/High |

## Install

> ⚠️ **Read first**: (1) a running `dsh web` does NOT hot-load new plugin layers — **restart `dsh web` after installing** or the button won't appear; (2) restarting briefly interrupts conversations in the GUI — wind down first (sessions persist on disk).

```bash
dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.4.0
```

The `#v0.4.0` tag pins the exact released commit (reproducible, rollback-able). Running DSH from a source checkout (no global `dsh`)? From the harness repo: `pnpm dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.4.0` or `node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.4.0`.

Install self-verification: `curl -H 'x-dsh-security-doctor: 1' http://127.0.0.1:3080/dsh-security-doctor/self-test` should return `{"ok":true,"version":"0.4.0","reportVersion":"0.4.0",...}`, and the browser console should log `[dsh-security-doctor] client loaded; host self-test: v0.4.0`. (Since v0.2.1 both routes require this pairing header — a custom header cannot be attached by another origin without a CORS preflight this server never grants, so other local pages cannot read your report cross-site.)

## Update (incl. legacy migration & rollback)

Three mandatory steps: (1) repin the dependency — `dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#vX.Y.Z`, or edit `~/.dsh/profiles/web/package.json` to `"…#vX.Y.Z"` and run `pnpm install` in the profile dir; (2) **restart `dsh web`** — host plugin code lives in the running process's memory (no hot reload) and the client caches plugin metadata until restart, so no restart means you're still on the old version; (3) refresh the browser page. Verify you're on the new version via the report footer ("plugin vX.Y.Z"), the self-test `version` field, or the console breadcrumb.

- **See what changed first**: [CHANGELOG.md](CHANGELOG.md) (per-version changes + tested-harness matrix); each [GitHub Release](https://github.com/ChenChen913/dsh-security-doctor/releases) carries a diff link and the tag commit SHA.
- **Legacy 0.1.x installs** used an unpinned rolling reference to `main` — migrate by repinning the dependency with `#vX.Y.Z` as above.
- **Rollback** = repin the old tag (e.g. `#v0.2.1`) → `pnpm install` → restart.
- **Stricter pinning**: lock the commit SHA instead of the tag: `github:ChenChen913/dsh-security-doctor#<tag SHA from the Release page>`.

## How it works

| Layer | File | Role |
| --- | --- | --- |
| Host | `lib/index.js` | Read-only GET routes `/dsh-security-doctor/check` and `/self-test`; service/policy probes via `ctx.get()` |
| Engine | `lib/checks.js` | Pure path/stat/icacls/env-injectable checks, all read-only |
| Client | `lib/client.js` | Sidebar button + badge + report modal (hand-written wire format, no build) |
| Bundle | `cordis.patch.yml` | The loader row mounting both halves |

## Data flow in one glance

**Reads**: `~/.dsh` config/dependency manifests, credential-file **permission bits and ACL account names only** (never contents), workspace instruction-file names+hashes, external plugin source text, service presence/policy, `DEEPSEEK_BASE_URL` hostname. **Writes**: no files; browser localStorage only (history, hash snapshots). **Sends**: nothing by default — the only network traffic is localhost GET routes from the page to your own dsh web; the single explicit exception is a one-shot read-only release query to `api.github.com` when you click "Check update" yourself (nothing uploaded, no automatic background checks).

## Security commitments (physician, heal thyself)

This plugin audits other plugins, so it audits **itself first** with the same published T1–T10 standard: the full self-audit report (findings S1–S3, fixes, and test evidence) is public at [docs/SELF-AUDIT.md](docs/SELF-AUDIT.md); the policy lives in [SECURITY.md](SECURITY.md). Hard guarantees: read-only (single fixed-argument `icacls` read-only query aside); zero egress by default (localhost GET routes, pairing-header guarded; the only explicit exception since v0.3 is the manual, click-triggered release query to api.github.com — read-only, nothing uploaded); zero credential exposure (bits/ACL only, echoed lines auto-redacted, leak-free asserted by tests); zero runtime dependencies, no install scripts, no build step; SHA-pinned CI actions. Verify: `node test/smoke.mjs && node test/host.mjs && node test/client.mjs`.

## Extras

Trend vs last checkup, per-item and all-in-one repair "prescriptions" (markdown you paste into a NEW session — the plugin never modifies files), copy-markdown / export-json, clickable path copy, collapsible lists, zh/en UI, dialog a11y (role/aria-modal/focus trap), GitHub Actions CI on ubuntu/macos/windows × Node 22/24.

Docs: [CHANGELOG](CHANGELOG.md) · [PLAN](docs/PLAN.md) · [FIX-PLAN (v0.2 feedback fixes)](docs/FIX-PLAN.md) · [VERSIONING-PLAN (v0.3 fixes)](docs/VERSIONING-PLAN.md) · [release checklist](docs/release.md) · [security-review guide](docs/guide-security-review.md) · [secure-development guide](docs/guide-secure-development.md) · `skills/` installable SKILL.md versions. Tests: `node test/smoke.mjs && node test/host.mjs && node test/client.mjs` (zero dependencies).

## Compatibility

| Plugin | Tested harness | OS | Notes |
| --- | --- | --- | --- |
| v0.4.0 | DSH 0.1.0-rc.5 | Windows (source run) | macOS/Linux via CI matrix; Node ≥ 22 |
| v0.3.0 | DSH 0.1.0-rc.5 | Windows (source run) | same |
| v0.2.0 – v0.2.1 | DSH 0.1.0-rc.5 | Windows (source run) | same |
| v0.1.0 | DSH 0.1.0-rc.5 | Windows (source run) | same |

Per-version tested matrices also live in [CHANGELOG.md](CHANGELOG.md) and the matching GitHub Release.

## Limitations

Best-effort: "no findings" is not "safe". Egress scan is a first filter (obfuscated/runtime-assembled URLs invisible); POSIX mode bits are not the full ACL story (macOS extended ACLs, symlinks followed); report bodies are currently Chinese; per-session policy overrides are not read; deep code review of external plugins remains with the [security-review guide](docs/guide-security-review.md) (built-in scanning planned for v0.4; v0.3 shipped versioning/distribution fixes). Verified on harness 0.1.0-rc.5; Windows manually, macOS/Linux via CI.

## License

MIT
