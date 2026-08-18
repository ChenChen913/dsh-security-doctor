# dsh-security-doctor · DSH 安全医生

中文 | [English](README.en.md)

**DeepSeek Harness（DSH）Web 界面的一键安全体检插件**：侧栏底部「安全体检」按钮，安装后自动体检一次（高危时按钮亮红色角标），单击弹出「液态玻璃」质感分级报告——环形安全评分（0–100）、按严重度排序（高危置顶）、与上次体检的趋势对比、一键生成修复处方单、复制 Markdown / 导出 JSON、路径一键复制、中英双语。全程**只读**：不执行被检查对象的任何代码，默认零外发，不需要 API Key。界面设计规范存档见 [design/](design/DESIGN.md)。

> 生态现状：`awesome-dsh-plugin` 官方清单自己写着"装插件等于以你自己的权限运行第三方代码，本清单不是安全审查"。这个插件把"我现在的环境安全吗？"变成一次点击。

## 检查项

| 检查 | 说明 | 命中级别 |
| --- | --- | --- |
| 配置中的 `!!js` 表达式 | 扫描 `~/.dsh` 下所有 cordis 补丁/配置文件（已剥离注释，注释里提到不算）；`!!js` 在加载时会被求值执行 | 高危 |
| 第三方插件盘点 | 各 profile 依赖盘点，区分官方 `@deepseek-ai/*` 与外来插件；标记未锁定的 git 引用、携带 `prepare`/`postinstall` 的包；自辨身份 | 关注 |
| 已装插件出网扫描 | 静态扫描外来插件源码外联地址（`https?://`/`wss?://`，已剥注释，排除本机回环），按插件列域名；无可扫描源码的插件单独提示 | 说明/关注 |
| 凭据文件权限 | `~/.dsh/.credentials.yaml`：POSIX 查组/其他位（0400/0600 合格）；Windows 经 `icacls` 只读查 ACL 账户，Users/Everyone 可读报关注。**只看权限，永不读内容** | 关注 |
| 工作区指令文件 | `AGENTS.md` / `CLAUDE.md` / `.agents/` 等（SHA-256 哈希，跨次比对"新增/变更"） | 说明 |
| 外部端点配置 | yml 配置中的 `baseURL` 行 + 环境变量 `DEEPSEEK_BASE_URL` 实际生效值（只显示主机名） | 说明 |
| 核心防护服务与策略 | 经 `ctx.get()` 探测装载；读实际策略值，审批策略 `never` 或预设 `danger-full-access` 直接升高危 | 关注/高危 |

报告页脚显示生成版本；「检查更新」按钮**仅在你点击时**向 `api.github.com` 查询最新 Release——这是本插件唯一的显式外发（单次请求、只读版本信息、默认零请求）。

## 安装与更新

> ⚠️ **两个必读**：① 装完必须**重启 `dsh web`** 才生效（运行中的实例不热加载新插件层）；② 重启会短暂中断当前对话，先保存再重启。

```bash
dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.5.0
```

`#v0.5.0` 锁定版本标签（可复现、可回退；npm 发布后可直接 `dsh plugin --profile web add dsh-security-doctor`）。源码 checkout 运行的 DSH：在 harness 仓库内执行 `pnpm dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.5.0`，或 `node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.5.0`。

装没装上一条命令确认（curl 返回 `ok:true` + 控制台出现 `[dsh-security-doctor] client loaded; host self-test: v0.5.0` + 侧栏出现按钮）：

```bash
curl -H 'x-dsh-security-doctor: 1' http://127.0.0.1:3080/dsh-security-doctor/self-test
```

**更新 / 回退 / 迁移**：改依赖里的 tag 为目标版本 → 重装（同上命令）→ 重启 `dsh web` → 刷新页面，四步缺一不可（宿主代码驻内存、客户端元数据有缓存）。更新前先看 [CHANGELOG](CHANGELOG.md) 与 [Releases](https://github.com/ChenChen913/dsh-security-doctor/releases)（每版附 diff 链接与 tag commit SHA）。0.1.x 的未锁版本安装请改为带 `#tag` 的锁定引用；要绝对不可变可锁 commit SHA：`github:ChenChen913/dsh-security-doctor#<Release 页标注的 tag SHA>`。

## 数据流三问

| 问题 | 答案 |
| --- | --- |
| **读什么** | `~/.dsh` 配置/依赖清单/凭据文件**权限位与 ACL 账户名**（内容零读取）、指令文件名与哈希、外来插件源码文本、服务装载与策略值、`DEEPSEEK_BASE_URL` 主机名 |
| **写什么** | 无文件写入；仅浏览器 localStorage（体检历史、指令文件哈希快照） |
| **发什么** | 默认无外发（页面到本机 dsh web 的 GET 路由）；唯一例外是手动「检查更新」的一次只读 GitHub 查询 |

## 安全承诺

1. **只读**：不执行被检查对象的代码、不改用户文件；唯一外部命令是 Windows 下 `icacls <文件>` 只读 ACL 查询（固定参数、无 shell、无用户输入拼接）。
2. **默认零外发**：本机 GET 路由要求配对头 `x-dsh-security-doctor: 1`，防本机其他网页跨站读取报告；除手动检查更新外代码中不存在任何外部域名。
3. **凭据零接触**：只查权限位/ACL，内容不读不传不回显；回显行自动脱敏，测试含"凭据值零泄漏"断言，任何人可复跑。

先用自己发布的检测标准审过自己：[自审报告](docs/SELF-AUDIT.md) · [安全政策](SECURITY.md)。零运行时依赖、零安装脚本、零构建（`node --check` 可验）；CI actions 钉 commit SHA，三平台 × Node 22/24 矩阵。验证：`node test/smoke.mjs && node test/host.mjs && node test/client.mjs`。

## 常见问题

- **看不到「安全体检」按钮？** 装完必须重启 `dsh web`（见上），看不到按钮 ≠ 装失败。
- **curl 访问 `/check`/`/self-test` 返回 403？** 两路由要求配对头，curl 加 `-H 'x-dsh-security-doctor: 1'` 即可。
- **怎么确认跑的是哪个版本？** 报告页脚「插件 vX.Y.Z」、self-test 的 `version` 字段、控制台回显，三处任看一处。

## 局限（诚实声明）

尽力检测（best-effort），"未见异常"不等于"绝对安全"；出网扫描是初筛（混淆编码、运行时拼接的地址检测不到）；POSIX 权限位不等于完整 ACL；报告正文当前为中文；按会话/agent 覆盖的策略值不读取；深度审查用《[安全检测指南](docs/guide-security-review.md)》交给 AI 或等后续版本。

文档索引：[CHANGELOG](CHANGELOG.md)（逐版变更 + 实测矩阵）· [发布清单](docs/release.md) · [v0.5 修复计划](docs/FIX-PLAN-v0.5.md) · [安全检测指南](docs/guide-security-review.md) / [安全开发指南](docs/guide-secure-development.md)（`skills/` 下有可安装的 SKILL.md 版本）。

## 兼容性

| 插件版本 | 实测 harness | OS | 备注 |
| --- | --- | --- | --- |
| v0.5.0 | DSH 0.1.0-rc.5 | Windows（源码运行） | macOS/Linux 由 CI 矩阵覆盖；Node ≥ 22 |
| v0.2.0 – v0.4.0 | DSH 0.1.0-rc.5 | Windows（源码运行） | 同上 |
| v0.1.0 | DSH 0.1.0-rc.5 | Windows（源码运行） | 同上 |

## 许可

MIT
