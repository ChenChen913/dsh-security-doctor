# dsh-security-doctor

English | [中文](README.md)

A one-click **local security checkup plugin** for the DeepSeek Harness (DSH) Web UI: a "🛡 安全体检" (Security checkup) button in the sidebar footer that runs **read-only** checks against your local DSH environment (auto-run once on install, red badge while high findings are unacknowledged) and shows a severity-sorted report with high cards first. It never executes code from the things it checks, never sends data anywhere, and needs no API key.

> Context: the official `awesome-dsh-plugin` list warns that "installing a plugin runs third-party code with your own permissions — this list is not a security review." This plugin turns "is my environment okay?" into a single click.

## What it checks (v0.2)

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
dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.2.0
```

Running DSH from a source checkout (no global `dsh`)? From the harness repo: `pnpm dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.2.0` or `node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.2.0`.

Install self-verification: `curl http://127.0.0.1:3080/dsh-security-doctor/self-test` should return `{"ok":true,...}`, and the browser console should log `[dsh-security-doctor] client loaded; host self-test: v0.2.0`.

## How it works

| Layer | File | Role |
| --- | --- | --- |
| Host | `lib/index.js` | Read-only GET routes `/dsh-security-doctor/check` and `/self-test`; service/policy probes via `ctx.get()` |
| Engine | `lib/checks.js` | Pure path/stat/icacls/env-injectable checks, all read-only |
| Client | `lib/client.js` | Sidebar button + badge + report modal (hand-written wire format, no build) |
| Bundle | `cordis.patch.yml` | The loader row mounting both halves |

## Data flow in one glance

**Reads**: `~/.dsh` config/dependency manifests, credential-file **permission bits and ACL account names only** (never contents), workspace instruction-file names+hashes, external plugin source text, service presence/policy, `DEEPSEEK_BASE_URL` hostname. **Writes**: no files; browser localStorage only (history, hash snapshots). **Sends**: nothing — the only network traffic is two localhost GET routes from the page to your own dsh web.

## Extras

Trend vs last checkup, per-item and all-in-one repair "prescriptions" (markdown you paste into a NEW session — the plugin never modifies files), copy-markdown / export-json, clickable path copy, collapsible lists, zh/en UI, dialog a11y (role/aria-modal/focus trap), GitHub Actions CI on ubuntu/macos/windows × Node 22/24.

Docs: [PLAN](docs/PLAN.md) · [FIX-PLAN (v0.2 feedback fixes)](docs/FIX-PLAN.md) · [security-review guide](docs/guide-security-review.md) · [secure-development guide](docs/guide-secure-development.md) · `skills/` installable SKILL.md versions. Tests: `node test/smoke.mjs && node test/host.mjs && node test/client.mjs` (zero dependencies).

## Limitations

Best-effort: "no findings" is not "safe". Egress scan is a first filter (obfuscated/runtime-assembled URLs invisible); POSIX mode bits are not the full ACL story (macOS extended ACLs, symlinks followed); report bodies are currently Chinese; per-session policy overrides are not read; deep code review of external plugins remains with the [security-review guide](docs/guide-security-review.md) (built-in scanning planned for v0.3). Verified on harness 0.1.0-rc.5; Windows manually, macOS/Linux via CI.

## License

MIT
