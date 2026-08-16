# dsh-security-doctor 开发规划（PLAN）

> DSH 安全医生：DeepSeek Harness（DSH）的一键安全体检插件。点一下侧栏按钮，对本地 DSH 环境做只读安全检查，在 Web 界面弹出体检报告。
>
> 本规划基于对 DSH 源码库的全栈安全审计（31 项发现：HIGH×7 / MEDIUM×13 / LOW×11）与 2026-08 的生态调研（GitHub topics/dsh-plugin 4700+ 仓库、awesome-dsh-plugin 清单、12 个现有安全检测工具对比）。审计报告结论详见仓库 `docs/` 两份指南的"背景"章节。

## 1. 为什么做这个插件

- **DSH 插件生态已经真实存在且零审查**：`awesome-dsh-plugin` 清单收录数百个社区插件，安装方式是 `dsh plugin add github:owner/repo`；该清单自己警告："装插件等于以你自己的权限运行第三方代码，工具审批不会隔离插件代码，本清单不是安全审查"。
- **官方 awesome 清单明确说"清单不等于安全审查"**，而生态中此前没有一个"装在 DSH 里、点按钮就能用"的安全体检工具（外部扫描器如 cisco skill-scanner、SkillWard 都是独立 CLI，不认识 DSH 的 `cordis.patch.yml` / `!!js` / bundle 格式）。
- 审计发现的高危问题（`!!js` 配置表达式任意执行、安装链 RCE 面、凭据文件权限、指令文件持久注入）**大多可以通过本地只读检查提前发现**，不需要执行任何插件代码。

## 2. 目标与非目标

### 目标（v1）

1. 以官方 bundle 插件形式发布，`dsh plugin --profile web add github:ChenChen913/dsh-security-doctor` 一步安装。
2. Web 界面侧栏底部出现「🛡 安全体检」按钮；单击即触发检查，弹出报告面板（严重度分级 + 建议）。
3. 全部检查**只读**：只做文件读取与存在性探测，不执行任何被检查对象（插件/配置/脚本）的代码，不联网外发数据。
4. 配套交付两份可独立使用的指南文档（见 §6），插件检测不到的深度项由指南 + AI 完成。

### 非目标（v1，明确不做）

- **不逐个深度扫描已安装的外部插件**（外部插件代码审计留给 v2 与「安全检测指南」AI 工作流；v1 只做清单级盘点）。
- 不修改任何 DSH 配置、不自动"修复"问题（只报告 + 给建议，改动永远由用户决定）。
- 不依赖模型/API Key——按钮点击后纯本地计算，秒级返回。
- 不做持续后台监控（无定时器、无轮询，只有点击时检查一次）。

## 3. 版本路线图

| 版本 | 范围 | 状态 |
| --- | --- | --- |
| v0.1 | 本机安全体检：6 项只读检查 + 按钮报告面板 + 两份指南 | 本仓库首个发布 |
| v0.2 | 接入 `--dump-config` 级配置快照对比（权限预设/审批模式实际生效值）；报告导出 Markdown | 规划中 |
| v0.3 | 单插件深度静态扫描（对外部插件的 `cordis.patch.yml`/宿主代码做规则检测，对齐检测指南 §3 的 10 类威胁） | 规划中 |
| v0.4 | LLM 辅助研判（可选，走当前会话模型，正则预筛后仅送可疑片段，参考 SkillGate 成本架构） | 规划中 |

v1 刻意做小：先交付一个**装得上、点得动、看得懂**的体检按钮，把最危险的 6 类本机信号覆盖掉，再逐步加深。

## 4. v1 检查项设计（全部只读）

| # | 检查项 | 对应审计发现 | 判定 |
| --- | --- | --- | --- |
| C1 | 配置中的 `!!js` 表达式：扫描 `~/.dsh/cordis.patch.yml` 与 `~/.dsh/profiles/*/cordis*.yml` | F-007（!!js = eval，配置即代码） | 命中即 **HIGH**（列出文件+行号+表达式原文，绝不执行） |
| C2 | 第三方插件盘点：解析 `~/.dsh/profiles/*/package.json` 依赖，区分官方 `@deepseek-ai/*` 与外来插件；标记未锁定 commit 的 git 引用与带 `prepare`/`postinstall` 的包 | F-005（安装链 RCE 面） | 有外来插件即 **MEDIUM**，未锁定引用/带安装脚本单独提示；v1 不深度扫描，提示用检测指南 |
| C3 | 凭据文件权限：`~/.dsh/.credentials.yaml` 存在时检查 POSIX mode（600 期望）；Windows 下提示改用系统级说明 | F-003（凭据在读取半径内） | 非 600 → **MEDIUM**；只报权限位，**永不读取/回显内容** |
| C4 | 工作区指令文件：cwd 下 `AGENTS.md` / `CLAUDE.md` / `.agents/` 等会被注入模型上下文的文件 | F-004（指令文件=可持久化注入点） | 存在即 **INFO**（提示 workspace-write 模式下模型可写这些文件） |
| C5 | 外部端点配置：上述 yml 与 `~/.dsh/settings.yaml` 中出现的 `baseURL`/`baseUrl` 行 | F-002（baseURL 改写→Key 外送） | 出现即 **INFO** 列出该行（用户手写配置，可回显），提示确认指向官方域名 |
| C6 | 核心安全服务在位：`permissionPresets` / `approval` / `sandbox` / `webServer` 服务装载探测（只探测存在性，不读内部状态） | F-001 等的缓解面 | 缺失即 **MEDIUM**（说明该防护层未装载） |

补充规则：

- 每项检查独立 try/catch，单项失败不影响其余项（失败=该项标 error 并继续）。
- 输出严重度四级：`high` / `medium` / `low` / `info`（另有 `error` 表示检查本身失败）。
- 报告含汇总（各级数量 + 一句话总评）与逐项建议；建议文案与指南文档口径一致。

## 5. 技术方案（对齐官方插件格式）

采用社区验证过的"双半插件"结构（与 dsh-web-restart 同构，全部为无构建步骤的 ESM JS）：

```text
dsh-security-doctor/
├── package.json          # dsh.bundle 清单 + dsh.client 注入声明（官方 publish 文档格式）
├── cordis.patch.yml      # 一行 insert：挂载宿主/客户端两半
├── lib/
│   ├── checks.js         # 纯函数检查器（路径可注入，可单测）
│   ├── index.js          # 宿主半：ctx.webServer.register GET /dsh-security-doctor/check
│   └── client.js         # 客户端半：window.__ModuleLoader__.load 线格式；sidebar.footer.action
│                         #   插槽注册按钮；点击 fetch 路由；React 渲染报告弹层
├── docs/                 # 本规划 + 两份指南
└── skills/               # 指南的可安装 SKILL.md 版本
```

- 宿主半 `inject: ['webServer']`；路由为 exact 路由、GET、`cache-control: no-store`；`apply` 返回 dispose。
- 客户端半 `inject: ['slots']`，`ctx.slots.inject('sidebar.footer.action', ...)` 注册按钮（宽侧栏图标+文字，窄栏仅图标），报告用全屏遮罩弹层渲染，Esc/点击遮罩关闭。
- 本插件自身遵守自家《安全开发指南》：只读、无网络外发、无安装脚本、无 shell、凭据只查权限位不查内容、peerDependency 仅 `@deepseek-ai/cordis`。

## 6. 配套文档（同为仓库交付物）

1. **《安全检测指南》**（`docs/guide-security-review.md`）：给 AI 用的外部插件检测工作流——用户把指南（或 `skills/dsh-security-review`）交给任意 Agent，即可对想安装的外部 DSH 插件做人工级审查。覆盖 10 类威胁（注入、配置投毒、`!!js`、越权路由、外发、安装脚本、typosquat 等）与 SAFE/REVIEW/REJECT 三档裁决口径。它就是 v0.3 深度扫描的"人肉/Agent 版前置"。
2. **《安全开发指南》**（`docs/guide-secure-development.md`）：给插件作者的安全底线——最小权限、禁止分发 `!!js`、凭据处理、路由鉴权、依赖锁定、清理义务等，并附本插件自身如何逐条达标。

## 7. 验证与发布

- 本地：`node --check` 三个 lib 文件；对 `checks.js` 用临时假目录（伪造 `!!js` 补丁、带外来依赖的 profile 等）跑冒烟断言；条件允许时从 DSH 源码库 `--patch` 绝对路径实启并 curl 路由。
- 发布：GitHub 仓库（MIT），topics：`dsh-plugin` / `deepseek-harness` / `dsh` / `security`；安装入口 `dsh plugin --profile web add github:ChenChen913/dsh-security-doctor`；后续可提交 awesome-dsh-plugin 清单 PR。
- 明确声明：本插件是**尽力检测**（best-effort），报告"未见异常"不等于"绝对安全"；所有检查只读且不外发数据。

## 8. 风险与边界

- **路由暴露面**：`/dsh-security-doctor/check` 与 DSH 现有 Web 路由同信任域（本机回环）。返回内容含插件名/路径清单，属低敏感；README 中说明。不接收任何参数、不支持写操作，降低滥用面。
- **跨版本兼容**：不读服务内部状态、只探测存在性；`~/.dsh` 目录布局（profiles/、settings.yaml、cordis.patch.yml）以 2026-08 官方 publish 文档与本地 0.1.0-rc 系列为基准，布局变化时单项降级为 error 而非崩溃。
- **误报**：`!!js` 与外来插件均为"需人工确认"信号而非实锤，报告文案明确区分"命中规则"与"确认恶意"。
