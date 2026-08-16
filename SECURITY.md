# Security Policy / 安全政策

中文 | [English](#english)

## 我们的安全立场

dsh-security-doctor 是一个**安全检测插件**——帮用户发现别的插件和环境带来的风险。正因如此，**它自己必须先经得起同样的检验**：本仓库用自己发布的《[安全检测指南](docs/guide-security-review.md)》T1–T10 十类威胁标准**审过自己**，自审报告（含发现、修复与测试证据）完整公开在 [docs/SELF-AUDIT.md](docs/SELF-AUDIT.md)。

对用户的三条硬承诺：

1. **只读**：不执行任何被检查对象的代码；不改用户的任何文件（唯一的浏览器本地存储是体检历史与哈希快照）；唯一的外部命令是 Windows 下 `icacls <文件>` 只读 ACL 查询（固定参数、无 shell、无用户输入拼接）。
2. **零外发**：不访问任何外部域名；唯一网络行为是页面到本机 dsh web 的两个 GET 路由，且自 v0.2.1 起要求配对头 `x-dsh-security-doctor: 1` 防跨站读取。
3. **凭据零接触**：凭据文件只查权限位/ACL，内容一概不读不传不回显；回显的配置行经自动脱敏（URL 内嵌凭据、query 密钥、`sk-`/`gh?_` 令牌）。测试中有"凭据值零泄漏"的专门断言。

供应链方面：**零运行时依赖、零安装脚本、零构建步骤**（全部为可直接阅读的源码，`node --check` 即可验证）；CI 的 GitHub Actions 钉在具体 commit SHA；每次推送自动跑三平台 × Node 22/24 测试矩阵。

## 如何验证我们说的

```bash
git clone https://github.com/ChenChen913/dsh-security-doctor
cd dsh-security-doctor
node test/smoke.mjs && node test/host.mjs && node test/client.mjs
grep -rn "!!js\|eval(\|new Function\|child_process" lib/   # 亲手核对，只有 icacls 一处 execFile
```

数据流三问（读什么/写什么/发什么）速查表见 [README](README.md#数据流三问10-秒速查)。

## 报告漏洞

发现本插件的安全问题请开 issue 或通过 GitHub 私密披露（Security advisories）报告。我们承诺：修复后在本仓库公示问题与修复过程（追加到 SELF-AUDIT 的发现记录），不掩盖、不静默修改。

---

## English

dsh-security-doctor is a **security-checking plugin**, so it holds itself to the same bar it sets for others: the repo has been audited against its own published review guide (threats T1–T10), with the full report — findings, fixes, and test evidence — public in [docs/SELF-AUDIT.md](docs/SELF-AUDIT.md). Hard commitments: read-only (the only external command is a fixed-argument `icacls` read-only ACL query), zero egress (two localhost GET routes, guarded by a pairing header since v0.2.1), zero credential exposure (permission bits/ACL only; echoed config lines are auto-redacted; asserted by tests). Supply chain: zero runtime dependencies, no install scripts, no build step, SHA-pinned CI actions, automated 3-OS × Node 22/24 test matrix on every push. Verify yourself: `node test/smoke.mjs && node test/host.mjs && node test/client.mjs`. Report vulnerabilities via issues or GitHub private security advisories; fixes are disclosed publicly in the self-audit log.
