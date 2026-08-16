# dsh-security-doctor

English | [中文](README.md)

A one-click **local security checkup plugin** for the DeepSeek Harness (DSH) Web UI: a "🛡 安全体检" (Security checkup) button in the sidebar footer that runs **read-only** checks against your local DSH environment and shows a severity-graded report (high / attention / suggestion / info). It never executes code from the things it checks, never sends data anywhere, and needs no API key.

> Context: the official `awesome-dsh-plugin` list warns that "installing a plugin runs third-party code with your own permissions — this list is not a security review." This plugin turns "is my environment okay?" into a single click.

## What it checks

| Check | What | Hit level |
| --- | --- | --- |
| `!!js` in config | Scans every cordis patch/config under `~/.dsh`; `!!js` expressions are evaluated at load time | High |
| Third-party plugin inventory | Parses per-profile dependencies; flags non-`@deepseek-ai` plugins, unpinned git refs, and packages shipping `prepare`/`postinstall` scripts | Attention |
| Credential file permissions | Checks mode bits of `~/.dsh/.credentials.yaml` (expect 600); **permission bits only, contents never read** | Attention |
| Workspace instruction files | `AGENTS.md` / `CLAUDE.md` / `.agents/` — files injected verbatim into model context | Info |
| External endpoints | `baseURL` lines in config — they decide where requests (and credentials) go | Info |
| Protection services | Presence probe for `permissionPresets` / `approval` / `sandbox` / `webServer` | Attention |

## Install

```bash
dsh plugin --profile web add github:ChenChen913/dsh-security-doctor
```

Restart `dsh web` once so the bundle layer loads; the button appears at the sidebar footer.

## How it works

| Layer | File | Role |
| --- | --- | --- |
| Host | `lib/index.js` | Registers the read-only GET route `/dsh-security-doctor/check` |
| Engine | `lib/checks.js` | Pure path-injectable check functions, all read-only |
| Client | `lib/client.js` | Sidebar footer button + React report modal |
| Bundle | `cordis.patch.yml` | The loader row mounting both halves |

## Security commitments

Read-only; no shell, no network egress, no install scripts, no build step; credential contents are never read; reversible uninstall. See the [secure-development guide](docs/guide-secure-development.md) (Chinese) for the full compliance table.

## Docs

- [docs/PLAN.md](docs/PLAN.md) — development plan (Chinese)
- [docs/guide-security-review.md](docs/guide-security-review.md) — security review guide for external plugins, usable as an AI prompt/skill (Chinese)
- [docs/guide-secure-development.md](docs/guide-secure-development.md) — secure development bottom lines for plugin authors (Chinese)
- `skills/` — installable SKILL.md versions of both guides

## Limitations

Best-effort detection: "no findings" is not "safe". v1 does not do code-level deep review of external plugins (inventory + supply-chain signals only) — use the security-review guide with any AI for that; it is planned to be built in at v0.3.

## License

MIT
