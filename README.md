# dsh-security-doctor · DSH 安全医生

中文 | [English](README.en.md)

DeepSeek Harness（DSH）Web 界面的一键安全体检插件：侧栏「安全体检」按钮，安装后自动体检一次，点击弹出分级报告。全程**只读**：不执行被检查对象的任何代码，默认零外发，不需要 API Key。

> 官方插件清单自己写着"装插件等于以你自己的权限运行第三方代码，本清单不是安全审查"。这个插件把"我现在的环境安全吗？"变成一次点击。

## 功能

- **分级报告**：环形评分（0–100）、高危置顶、趋势对比、修复处方单、复制 Markdown / 导出 JSON、中英双语
- **AI 深审**：可疑插件一键复制结构化深审提示词，交给自己的 Agent 审查，结论粘贴回填并锚定代码指纹（剪贴板闭环，零 API）
- **守护模式**（实验、默认关）：运行时出站审计 + 高价值文件变更哨兵，见下文

## 检查项

| 检查 | 说明 | 级别 |
| --- | --- | --- |
| `!!js` 表达式 | 扫描 `~/.dsh` 全部 cordis 补丁/配置（已剥注释与文档示例）；该写法加载时会被执行 | 高危 |
| 安全层补丁 | `remove:`/`replace:` 指向 approval / sandbox / permission 等防护插件即报，给出行号 | 高危 |
| 第三方插件盘点 | 各 profile 依赖盘点，区分官方与外来；标注未锁定的 git 引用与 `postinstall` 脚本；支持 npm / pnpm 布局 | 关注 |
| 出网与意图特征 | 静态扫描外来插件源码：外联域名、`eval`/base64 混淆特征、邮箱/凭据访问意图标注；同一文件"凭据访问 + 外联"组合升级高危；三档可疑度评分；代码树指纹跨次比对 | 说明 → 高危 |
| 凭据文件权限 | `~/.dsh/.credentials.yaml`：POSIX 权限位 / Windows ACL 账户检查，**只看权限，永不读内容** | 关注 |
| 指令文件 | `AGENTS.md` / `CLAUDE.md` / `.cursor/rules/` 等递归扫描，SHA-256 哈希跨次比对"新增/变更" | 说明 |
| 端点配置 | 配置中的 `baseURL` + 环境变量 `DEEPSEEK_BASE_URL`（只显示主机名） | 说明 |
| 防护服务与策略 | 服务装载 + 实际策略值：审批 `never`、`danger-full-access` 预设（含 `DSH_PERMISSION_MODE` 会话级覆盖）报高危 | 关注 / 高危 |

## 守护模式（实验，默认关）

报告页脚开关，开启后插件从「医生」（定期体检）变为「监护仪」（持续观察），完全本地：

- **出站审计**：包装进程内 `http`/`https` 的 `.request`/`.get`，记录「插件 → 域名 → 方法 → 是否含凭据特征」到内存环形缓冲（50 条；只记域名与布尔特征，**载荷内容永不记录**）。归属按调用栈尽力推断、不覆盖 `fetch` 与原始套接字
- **变更哨兵**：每 45 秒快照 `~/.dsh` 补丁/配置 + 工作区指令文件的 mtime+哈希；变更即亮角标，打开报告列出变更文件。首次快照是静默基线，host 侧无状态（重启不误报）
- **一键关、卸载即回滚**：关开关立即停轮询摘钩子；卸载经 `ctx.effect` 恢复原始模块导出

## 安装与更新

> ⚠️ 装完必须**重启 `dsh web`** 才生效（运行中的实例不热加载；重启会短暂中断对话，先保存）。

```bash
dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v1.0.0
```

`#v1.0.0` 锁定版本标签（可复现、可回退）；npm 发布后可直接 `dsh plugin --profile web add dsh-security-doctor`；源码运行 DSH 的在 harness 仓库内执行 `pnpm dsh plugin --profile web add github:ChenChen913/dsh-security-doctor#v1.0.0`。

验证安装（返回 `ok:true` 且侧栏出现按钮即成功）：

```bash
curl -H 'x-dsh-security-doctor: 1' http://127.0.0.1:3080/dsh-security-doctor/self-test
```

**更新 / 回退**：改 tag → 重装（同上命令）→ 重启 `dsh web` → 刷新页面，四步缺一不可。先看 [CHANGELOG](CHANGELOG.md) 与 [Releases](https://github.com/ChenChen913/dsh-security-doctor/releases)。

## 数据流三问

| 问题 | 答案 |
| --- | --- |
| 读什么 | `~/.dsh` 配置/依赖清单、凭据文件**权限位与 ACL 账户名**（内容零读取）、指令文件名与哈希、外来插件源码、服务装载与策略值；守护模式另记出站域名与文件指纹 |
| 写什么 | 无文件写入；仅浏览器 localStorage（历史、偏好、哨兵基线）；守护审计记录只在内存，刷新即失 |
| 发什么 | 默认零外发（全部走本机路由）；唯一例外是手动「检查更新」的一次只读 GitHub 查询 |

## 安全承诺

1. **只读**：不执行被检查对象的代码、不改用户文件；唯一外部命令是 Windows `icacls` 只读 ACL 查询（固定参数、无用户输入）
2. **默认零外发**：本机路由要求配对头 `x-dsh-security-doctor: 1` 并校验 `Host` 为本机地址（防跨站读取与 DNS rebinding）；局域网部署可用 `DSH_ALLOWED_HOSTS` 扩展白名单
3. **凭据零接触**：只查权限位，内容不读不传不回显；回显自动脱敏，测试含零泄漏断言，可复跑
4. **实验特性如实标注**：守护模式的边界（归属 best-effort、不覆盖 `fetch`/套接字、轮询间隙盲区）在 UI 与文档同步声明

用自家《[安全检测指南](docs/guide-security-review.md)》T1–T10 标准自审过自己（[自审报告](docs/SELF-AUDIT.md) · [安全政策](SECURITY.md)）。零运行时依赖、零安装脚本、零构建；CI 三平台 × Node 22/24 矩阵。验证：`node test/smoke.mjs && node test/host.mjs && node test/client.mjs && node test/guard.mjs && node test/watch.mjs`。

## 常见问题

- **看不到按钮？** 必须重启 `dsh web`；看不到 ≠ 装失败
- **curl 返回 403？** 路由要求配对头：加 `-H 'x-dsh-security-doctor: 1'`
- **跑的哪个版本？** 报告页脚 / self-test 的 `version` / 控制台回显，三处任看

## 局限

尽力检测（best-effort），"未见异常"不等于"绝对安全"：

- 静态扫描是初筛：混淆编码、运行时拼接的地址检测不到；组合命中是文件级共现，不是被证实的数据流
- 官方 `@deepseek-ai/*` 包按信任基线处理不在扫描范围（传递依赖已覆盖）
- 守护模式同理：审计归属可被高级代码伪造；哨兵轮询间隙的"改了又改回"不可见；大文件降级为大小+mtime 指纹
- POSIX 权限位不等于完整 ACL；其他按会话/agent 粒度的策略覆盖暂不读取
- 深度语义审查交给 AI 深审：《[安全检测指南](docs/guide-security-review.md)》

## 兼容性

实测 DSH 0.1.0-rc.5（Windows 源码运行）；macOS / Linux 由 CI 三平台 × Node 22/24 矩阵覆盖，Node ≥ 22。逐版实测矩阵见 [CHANGELOG](CHANGELOG.md)。

更多文档：[发布清单](docs/release.md) · [安全开发指南](docs/guide-secure-development.md) · [设计规范](design/DESIGN.md)（`skills/` 下有可安装的 SKILL.md 版本）。

## 许可

MIT
