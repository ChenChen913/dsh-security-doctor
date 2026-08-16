# dsh-security-doctor · DSH 安全医生

中文 | [English](README.en.md)

**DeepSeek Harness（DSH）Web 界面的一键安全体检插件**：侧栏底部「🛡 安全体检」按钮，单击（或安装后自动）对本机 DSH 环境做**只读**安全检查，弹出按严重度排序的分级报告（高危置顶）。不执行被检查对象的任何代码，默认不联网外发数据，不需要 API Key。

> 生态现状：`awesome-dsh-plugin` 官方清单自己写着"装插件等于以你自己的权限运行第三方代码，本清单不是安全审查"。这个插件把"我现在的环境安全吗？"变成一次点击。

## 功能（v0.3）

- **自动体检 + 高危徽标**：安装后挂载即自动体检一次；存在高危项时按钮角标显示红色计数，点开报告后清除。
- **七项只读检查**（见下表），报告按 高危 → 关注 → 建议 → 说明 排序，高危卡片置顶强调。
- **版本自检 + 手动检查更新（v0.3）**：报告页脚显示「插件 vX.Y.Z」（导出/复制的报告同样标注生成版本）；「检查更新」按钮**仅在你点击时**向 `api.github.com` 查询最新 Release——这是本插件唯一的显式外发（单次请求、只读版本信息、默认零请求），有新版会提示并指向下面「更新」一节。
- **趋势对比**：记录最近 10 次体检（浏览器 localStorage），显示与上次相比新增/消失的命中；指令文件按内容哈希比对，提示"上次体检后新增/变更"。
- **修复处方单**：每个可处置项配「处方」按钮，支持一键生成全部处方——生成 Markdown 处方单（绝对路径、步骤、逐项审批提示、新会话执行建议）复制后粘贴到**新会话**执行。**插件自身不修改任何文件**。
- **复制 Markdown / 导出 JSON**、路径一键复制、长清单折叠、中英文界面、弹层无障碍（dialog 语义 / 焦点圈 / Esc 关闭）。
- **安装自检**：宿主半提供 `GET /dsh-security-doctor/self-test`，浏览器控制台会回显配对结果。
- **配套两份指南**（`docs/`）：外部插件《安全检测指南》（可直接作为提示词或 skill 交给 AI 审插件）与《安全开发指南》（插件作者安全底线）；`skills/` 下有可直接安装的 SKILL.md 版本。

## 检查项

| 检查 | 说明 | 命中级别 |
| --- | --- | --- |
| 配置中的 `!!js` 表达式 | 扫描 `~/.dsh` 下所有 cordis 补丁/配置文件（**已剥离注释**，注释里提到不算）；`!!js` 会在加载时被求值执行 | 高危 |
| 第三方插件盘点 | 各 profile 依赖盘点，区分官方 `@deepseek-ai/*` 与外来插件；标记未锁定版本的 git 引用、携带 `prepare`/`postinstall` 的包；**自辨身份**（本插件自身会标注） | 关注 |
| 已装插件出网扫描 | 静态扫描外来插件源码中的外联地址（`https?://`/`wss?://`，排除本机回环），按插件列出域名；无可扫描源码的插件单独提示 | 说明/关注 |
| 凭据文件权限 | `~/.dsh/.credentials.yaml`：POSIX 检查组/其他位（0400/0600 均算合格）；**Windows 通过 icacls 只读查询 ACL**，列出实际可访问账户，Users/Everyone 可读则报关注。**只看权限，永不读取内容** | 关注 |
| 工作区指令文件 | `AGENTS.md` / `CLAUDE.md` / `.agents/` 等（含 SHA-256 哈希，跨次比对变更） | 说明 |
| 外部端点配置 | yml 配置中的 `baseURL` 行 + **环境变量 `DEEPSEEK_BASE_URL` 实际生效值**（只显示主机名） | 说明 |
| 核心防护服务与策略 | 经 `ctx.get()` 探测 `permissionPresets`/`approval`/`sandbox`/`webServer` 装载；读取**实际策略值**：审批策略为 `never` 或预设为 `danger-full-access` 直接升高危 | 关注/高危 |

## 安装

> ⚠️ **两个必读**
>
> 1. **装完必须重启 `dsh web` 才生效**：正在运行的实例不会热加载新插件层，CLI 装完也没有提醒（这是上游体验问题，已建议上游改进；在此之前请以本条为准）。看不到按钮 ≠ 装失败，先重启。
> 2. **重启会短暂中断当前对话**：Web GUI 与你的会话同进程，重启前请先保存/告一段落（会话数据本身落盘，刷新后可恢复）。

### 常规安装（已安装 dsh）

```bash
dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.3.0
```

（`#v0.3.0` 锁定版本标签，安装的就是 Release 页对应的那个 commit，可复现、可回退；npm 发布后可直接 `dsh plugin --profile web add dsh-security-doctor`。）

### 源码 checkout 运行的 DSH（无全局 `dsh` 命令）

在 DSH 源码仓库目录内：

```bash
# pnpm 可用时
pnpm dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.3.0

# 或直接走 CLI 入口
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.3.0
```

### 安装自检（装没装上，一条命令确认）

```bash
curl -H 'x-dsh-security-doctor: 1' http://127.0.0.1:3080/dsh-security-doctor/self-test   # {"ok":true,"plugin":"dsh-security-doctor","version":"0.3.0","reportVersion":"0.3.0",...}
```

三查：① 上面 self-test 返回 `ok:true`；② 浏览器控制台出现 `[dsh-security-doctor] client loaded; host self-test: v0.3.0`；③ 侧栏底部出现「安全体检」按钮。

<details>
<summary>手动安装（编辑 profile 文件）</summary>

```jsonc
// ~/.dsh/profiles/web/package.json
{
  "dependencies": {
    "dsh-security-doctor": "github:ChenChen913/dsh-security-doctor#v0.3.0"
  }
}
```

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: dsh-security-doctor
      name: dsh-security-doctor
```

在 profile 目录执行 `pnpm install` 后重启 `dsh web`。

</details>

## 更新（含存量迁移与回退）

三步链路，**每步都必要**：

1. **换版本重装**（任选其一）：
   ```bash
   dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.3.0
   # 或手动：编辑 ~/.dsh/profiles/web/package.json，把依赖改为 "...#v0.3.0"，
   # 然后在 profile 目录执行 pnpm install
   ```
2. **重启 `dsh web`**。原因：宿主插件代码驻留在运行中的进程内存里，不会热加载；客户端对插件元数据也有缓存，同样要重启才刷新。**不重启 = 还在跑旧版**。
3. **刷新浏览器页面**。

更新后自检（10 秒确认跑的确实是新版）：报告页脚的「插件 vX.Y.Z」、上面 curl self-test 的 `version` 字段、控制台的 `host self-test: vX.Y.Z`，三处任看一处。

- **更新前先看改了什么**：[CHANGELOG.md](CHANGELOG.md)（逐版变更 + 实测 harness 矩阵）；每个 [GitHub Release](https://github.com/ChenChen913/dsh-security-doctor/releases) 附与上一版的 diff 链接与 tag commit SHA。
- **存量迁移（0.1.x 装的未锁版本）**：早期 README 的安装命令不带 `#tag`，装上的是追 main 的滚动引用——开发者推一次 main、你重装一次，装的到底是什么无从对账。请按上面第 1 步把依赖改为带 `#v0.3.0` 的锁定引用，从此每次更新都走「改 tag → 重装 → 重启」。
- **回退上一版**：把依赖里的 tag 改回旧版本（如 `#v0.2.1`）→ `pnpm install` → 重启。已发布的版本与各自的 SHA 见 Releases 页。
- **更严格的锁定**：`#v0.3.0` 锁的是 tag（可读性好，指向 Release 对应 commit）；要绝对不可变，可锁 commit SHA：`github:ChenChen913/dsh-security-doctor#<Release 页标注的 tag SHA>`。

## 工作原理

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 宿主 | `lib/index.js` | 注册只读 GET 路由 `/check` 与 `/self-test`；`ctx.get()` 探测服务与策略值 |
| 检查引擎 | `lib/checks.js` | 纯函数检查器（路径/stat/icacls/env 可注入，可单测），全部只读 |
| 客户端 | `lib/client.js` | 侧栏按钮 + 徽标 + 报告弹层（无构建手写线格式） |
| Bundle | `cordis.patch.yml` | 挂载宿主/客户端两半的加载行 |

## 数据流三问（10 秒速查）

| 问题 | 答案 |
| --- | --- |
| **读什么** | `~/.dsh` 的配置/依赖清单/凭据文件**权限位与 ACL 账户名**（内容零读取）、工作区指令文件名与哈希、外来插件源码文本、服务装载与策略值、`DEEPSEEK_BASE_URL` 主机名 |
| **写什么** | 无文件写入。仅浏览器 localStorage（体检历史、指令文件哈希快照） |
| **发什么** | **默认无任何外发**：唯一网络行为是浏览器→本机 dsh web 的 GET 路由。唯一显式例外：你手动点击「检查更新」时，浏览器向 `api.github.com` 发一次查询最新 Release 的请求（只读版本信息，不上行任何数据） |

## 安全承诺（打铁自身硬）

这个插件替用户审查别的插件，所以它**先用自己发布的检测标准审过自己**：自审报告（T1–T10 十类威胁逐条对照 + 自审发现 S1–S3 的修复与测试证据）公开在 [docs/SELF-AUDIT.md](docs/SELF-AUDIT.md)，安全政策见 [SECURITY.md](SECURITY.md)。

对用户的三条硬承诺：

1. **只读**：不执行被检查对象的任何代码，不改用户任何文件；唯一外部命令是 Windows 下 `icacls <文件>` 只读 ACL 查询（固定参数、无 shell、无用户输入拼接）。
2. **默认零外发**：不访问任何外部域名；唯一网络行为是页面到本机 dsh web 的 GET 路由，且**要求配对头 `x-dsh-security-doctor: 1` 防止本机其他网页跨站读取你的体检报告**。唯一显式例外：你手动点击「检查更新」时，浏览器向 `api.github.com` 发一次只读版本查询（不上行任何数据、无自动后台检查）——这是 v0.3 起的受控变更，已在 [SECURITY.md](SECURITY.md) 与 [自审报告](docs/SELF-AUDIT.md) 同步公示。
3. **凭据零接触**：凭据文件只查权限位/ACL，内容一概不读不传不回显；回显的配置行自动脱敏（URL 内嵌凭据、query 密钥、`sk-`/`gh?_` 令牌）。测试含"凭据值零泄漏"专门断言，任何人可复跑。

供应链：**零运行时依赖、零安装脚本、零构建**（`lib/` 即源码本体，`node --check` 可验）；CI actions 钉 commit SHA；每次推送自动跑三平台 × Node 22/24 矩阵。**验证命令**：

```bash
node test/smoke.mjs && node test/host.mjs && node test/client.mjs
grep -rn "eval(\|new Function\|child_process" lib/   # 只有 icacls 一处 execFile
```

发现本插件的安全问题请按 [SECURITY.md](SECURITY.md) 报告，修复过程公开公示。详见《[安全开发指南](docs/guide-secure-development.md)》末尾的本插件达标对照。

## 常见问题

- **安装时报 `missing peer @deepseek-ai/cordis` 警告？** v0.1 曾声明该 peer；v0.2.0 起已移除——插件运行时只用 Node 内置模块，宿主由 dsh 提供，该警告无害且不再出现。
- **体检把 dsh-security-doctor 自己列为"未锁定"？** 0.1.x 的 github: 安装确实未锁版本；0.2.0 起报告会标注"本插件自身"并给出锁定命令，README 安装命令也已默认带 `#v0.3.0`。旧安装的迁移步骤见上面「更新」一节。
- **怎么知道我现在跑的是哪个版本、有没有新版？** 报告页脚显示「插件 vX.Y.Z」；点「检查更新」按钮查最新 Release（唯一一次显式外发）；或 curl self-test 看 `version` 字段。更新/回退步骤见「更新」一节。
- **Windows 凭据检查说"无法判断"？** 0.1.x 的旧文案；0.2.0 起会用 icacls 读 ACL 列出实际可访问账户（查询失败时才回退提示）。
- **curl 访问 `/check`/`/self-test` 返回 403？** v0.2.1 起两路由要求配对头 `x-dsh-security-doctor: 1`（防本机其他网页跨站读取你的报告），curl 加 `-H 'x-dsh-security-doctor: 1'` 即可，插件自身界面不受影响。

## 局限（诚实声明）

- 尽力检测（best-effort）："未见异常"不等于"绝对安全"。
- 出网扫描是**初筛**：混淆编码、运行时拼接的地址检测不到；编译产物与源码不一致无法完全排除。
- POSIX 权限位不等于完整 ACL（macOS 扩展 ACL、POSIX ACL 未覆盖）；凭据文件若是符号链接，`stat` 会跟随链接。
- 报告正文当前为中文（界面框架已中英双语）。
- 策略值读取覆盖服务默认配置；按会话/按 agent 覆盖的值不在此列。
- 深度审查仍不内置——用《[安全检测指南](docs/guide-security-review.md)》交给 AI，或等 v0.4（v0.3 交付了版本管理与分发修复，见 [CHANGELOG](CHANGELOG.md)）。

## 开发规划与文档

- [CHANGELOG.md](CHANGELOG.md) — 逐版变更日志（含每版实测 harness 矩阵）
- [docs/PLAN.md](docs/PLAN.md) — 开发规划（背景、版本路线图、检查项设计依据）
- [docs/FIX-PLAN.md](docs/FIX-PLAN.md) — v0.2 修复计划（针对实测反馈的 28 项逐项修复与验证记录）
- [docs/VERSIONING-PLAN.md](docs/VERSIONING-PLAN.md) — v0.3 版本管理修复计划（反馈核实 + V1–V8 执行记录）
- [docs/release.md](docs/release.md) — 发布清单（每次发版照此执行）
- [docs/guide-security-review.md](docs/guide-security-review.md) — 安全检测指南（AI 提示词/skill 可用）
- [docs/guide-secure-development.md](docs/guide-secure-development.md) — 安全开发指南（自研插件安全底线）
- `skills/dsh-security-review/SKILL.md`、`skills/dsh-secure-dev/SKILL.md` — 可安装技能版
- 测试：`node test/smoke.mjs && node test/host.mjs && node test/client.mjs`（零依赖；CI 三平台 × Node 22/24 矩阵）

## 兼容性

| 插件版本 | 实测 harness | OS | 备注 |
| --- | --- | --- | --- |
| v0.3.0 | DSH 0.1.0-rc.5 | Windows（源码运行） | macOS/Linux 由 CI 矩阵覆盖；Node ≥ 22 |
| v0.2.1 | DSH 0.1.0-rc.5 | Windows（源码运行） | 同上 |
| v0.2.0 | DSH 0.1.0-rc.5 | Windows（源码运行） | 同上 |
| v0.1.0 | DSH 0.1.0-rc.5 | Windows（源码运行） | 同上 |

目录布局与 `ctx.get()` 语义以实测 harness 版本为准，布局变化时单项检查降级为"检查失败"而非崩溃；每版的实测矩阵也写在 [CHANGELOG.md](CHANGELOG.md) 与对应 GitHub Release。

## 许可

MIT
