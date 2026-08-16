# dsh-security-doctor · DSH 安全医生

中文 | [English](README.en.md)

**DeepSeek Harness（DSH）Web 界面的一键安全体检插件**：侧栏底部「🛡 安全体检」按钮，单击（或安装后自动）对本机 DSH 环境做**只读**安全检查，弹出按严重度排序的分级报告（高危置顶）。不执行被检查对象的任何代码，不联网外发数据，不需要 API Key。

> 生态现状：`awesome-dsh-plugin` 官方清单自己写着"装插件等于以你自己的权限运行第三方代码，本清单不是安全审查"。这个插件把"我现在的环境安全吗？"变成一次点击。

## 功能（v0.2）

- **自动体检 + 高危徽标**：安装后挂载即自动体检一次；存在高危项时按钮角标显示红色计数，点开报告后清除。
- **七项只读检查**（见下表），报告按 高危 → 关注 → 建议 → 说明 排序，高危卡片置顶强调。
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
dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.2.0
```

（`#v0.2.0` 锁定版本标签；npm 发布后可直接 `dsh plugin --profile web add dsh-security-doctor`。）

### 源码 checkout 运行的 DSH（无全局 `dsh` 命令）

在 DSH 源码仓库目录内：

```bash
# pnpm 可用时
pnpm dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.2.0

# 或直接走 CLI 入口
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add github:ChenChen913/dsh-security-doctor#v0.2.0
```

### 安装自检（装没装上，一条命令确认）

```bash
curl http://127.0.0.1:3080/dsh-security-doctor/self-test   # {"ok":true,"plugin":"dsh-security-doctor","version":"0.2.0",...}
```

三查：① 上面 self-test 返回 `ok:true`；② 浏览器控制台出现 `[dsh-security-doctor] client loaded; host self-test: v0.2.0`；③ 侧栏底部出现「安全体检」按钮。

<details>
<summary>手动安装（编辑 profile 文件）</summary>

```jsonc
// ~/.dsh/profiles/web/package.json
{
  "dependencies": {
    "dsh-security-doctor": "github:ChenChen913/dsh-security-doctor#v0.2.0"
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
| **发什么** | 无任何外发。唯一网络行为是浏览器→本机 dsh web 的两个 GET 路由 |

## 安全承诺（本插件自己先达标）

- **只读**：不执行任何被检查代码，无网络外发；**唯一的外部命令是 Windows 下 `icacls <文件>` 只读 ACL 查询**（固定参数、无 shell、无用户输入拼接）。
- **凭据零接触**：凭据文件只查权限位/ACL，内容一概不读不传不回显（测试断言覆盖）。
- **无安装脚本、无运行时依赖、无构建**：`node --check` 即可验证。
- **可逆**：`dsh plugin --profile web remove dsh-security-doctor` 完整卸载。
- 详见《[安全开发指南](docs/guide-secure-development.md)》末尾的本插件达标对照。

## 常见问题

- **安装时报 `missing peer @deepseek-ai/cordis` 警告？** v0.1 曾声明该 peer；v0.2.0 起已移除——插件运行时只用 Node 内置模块，宿主由 dsh 提供，该警告无害且不再出现。
- **体检把 dsh-security-doctor 自己列为"未锁定"？** 0.1.x 的 github: 安装确实未锁版本；0.2.0 起报告会标注"本插件自身"并给出锁定命令，README 安装命令也已默认带 `#v0.2.0`。
- **Windows 凭据检查说"无法判断"？** 0.1.x 的旧文案；0.2.0 起会用 icacls 读 ACL 列出实际可访问账户（查询失败时才回退提示）。

## 局限（诚实声明）

- 尽力检测（best-effort）："未见异常"不等于"绝对安全"。
- 出网扫描是**初筛**：混淆编码、运行时拼接的地址检测不到；编译产物与源码不一致无法完全排除。
- POSIX 权限位不等于完整 ACL（macOS 扩展 ACL、POSIX ACL 未覆盖）；凭据文件若是符号链接，`stat` 会跟随链接。
- 报告正文当前为中文（界面框架已中英双语）。
- 策略值读取覆盖服务默认配置；按会话/按 agent 覆盖的值不在此列。
- v0.2 仍不做外部插件的代码级深度审查——用《[安全检测指南](docs/guide-security-review.md)》交给 AI，或等 v0.3 内置。

## 开发规划与文档

- [docs/PLAN.md](docs/PLAN.md) — 开发规划（背景、版本路线图、检查项设计依据）
- [docs/FIX-PLAN.md](docs/FIX-PLAN.md) — v0.2 修复计划（针对实测反馈的 28 项逐项修复与验证记录）
- [docs/guide-security-review.md](docs/guide-security-review.md) — 安全检测指南（AI 提示词/skill 可用）
- [docs/guide-secure-development.md](docs/guide-secure-development.md) — 安全开发指南（自研插件安全底线）
- `skills/dsh-security-review/SKILL.md`、`skills/dsh-secure-dev/SKILL.md` — 可安装技能版
- 测试：`node test/smoke.mjs && node test/host.mjs && node test/client.mjs`（零依赖；CI 三平台 × Node 22/24 矩阵）

## 兼容性

- DeepSeek Harness `0.1.0-rc.5`（源码运行实测）；目录布局与 `ctx.get()` 语义以该版本为准，布局变化时单项检查降级为"检查失败"而非崩溃。
- 操作系统：Windows 实测（icacls ACL 路径）；macOS / Linux 由 CI 矩阵覆盖（纯 Node 内置模块，路径已按跨平台处理）。
- Node ≥ 22。

## 许可

MIT
