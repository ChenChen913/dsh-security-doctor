# dsh-security-doctor · DSH 安全医生

中文 | [English](README.en.md)

**DeepSeek Harness（DSH）Web 界面的一键安全体检插件**：侧栏底部多一个「🛡 安全体检」按钮，单击即对本机 DSH 环境做**只读**安全检查，弹出按严重度分级（高危 / 关注 / 建议 / 说明）的体检报告。不执行被检查对象的任何代码，不联网外发数据，不需要 API Key。

> 生态现状：`awesome-dsh-plugin` 官方清单自己写着"装插件等于以你自己的权限运行第三方代码，本清单不是安全审查"。这个插件把"我现在的环境安全吗？"变成一次点击。

## 功能

- **一键体检按钮**：侧栏底部（设置旁边），宽侧栏显示图标+文字，窄栏仅图标；点击后秒级返回报告弹层，支持重新检测、Esc 关闭。
- **六项只读检查**（见下表），单项失败不影响其余项。
- **配套两份指南**（`docs/`）：外部插件《安全检测指南》（可直接作为提示词或 skill 交给 AI 审插件）与《安全开发指南》（插件作者安全底线）。`skills/` 下有可直接安装的 SKILL.md 版本。

## 检查项

| 检查 | 说明 | 命中级别 |
| --- | --- | --- |
| 配置中的 `!!js` 表达式 | 扫描 `~/.dsh` 下所有 cordis 补丁/配置文件；`!!js` 会在加载时被求值执行 | 高危 |
| 第三方插件盘点 | 解析各 profile 依赖，区分官方 `@deepseek-ai/*` 与外来插件；标记未锁定 commit 的 git 引用、携带 `prepare`/`postinstall` 脚本的包 | 关注 |
| 凭据文件权限 | `~/.dsh/.credentials.yaml` 存在时检查权限位（期望 600）；**只看权限，永不读取内容** | 关注 |
| 工作区指令文件 | `AGENTS.md` / `CLAUDE.md` / `.agents/` 等会注入模型上下文的文件 | 说明 |
| 外部端点配置 | 配置中的 `baseURL` 行——它决定请求和凭据发往哪里 | 说明 |
| 核心防护服务 | `permissionPresets` / `approval` / `sandbox` / `webServer` 是否装载（仅探测存在性） | 关注 |

## 安装

```bash
dsh plugin --profile web add github:ChenChen913/dsh-security-doctor
```

然后重启一次 `dsh web` 让 bundle 层加载，侧栏底部即出现「安全体检」按钮。

<details>
<summary>手动安装（编辑 profile 文件）</summary>

```jsonc
// ~/.dsh/profiles/web/package.json
{
  "dependencies": {
    "dsh-security-doctor": "github:ChenChen913/dsh-security-doctor"
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
| 宿主 | `lib/index.js` | 注册只读 GET 路由 `/dsh-security-doctor/check`，组装报告 JSON |
| 检查引擎 | `lib/checks.js` | 纯函数检查器（路径可注入、可单测），全部只读 |
| 客户端 | `lib/client.js` | `sidebar.footer.action` 插槽注册按钮；React 渲染报告弹层 |
| Bundle | `cordis.patch.yml` | 挂载宿主/客户端两半的加载行 |

## 安全承诺（本插件自己先达标）

- **只读**：只做文件读取与存在性探测；不执行任何被检查代码，无 shell，无网络外发。
- **凭据零接触**：凭据文件只查权限位，内容一概不读不传。
- **无安装脚本**：无 `prepare`/`postinstall`；无构建步骤（手写线格式，`node --check` 即可验证）。
- **可逆**：`dsh plugin --profile web remove dsh-security-doctor` 完整卸载。

路由 `/dsh-security-doctor/check` 与 DSH 现有 Web 路由同信任域（本机回环），不接受参数、无写操作，返回内容为低敏感的环境清单。详见《[安全开发指南](docs/guide-secure-development.md)》末尾的本插件达标对照。

## 局限（诚实声明）

- 本插件是**尽力检测（best-effort）**："未见异常"不等于"绝对安全"。
- v1 不做外部插件的代码级深度审查（只做清单盘点与供应链信号）；深度审查请用《[安全检测指南](docs/guide-security-review.md)》交给 AI 完成，该能力将在 v0.3 内置。
- 权限预设/审批模式的**实际生效值**依赖配置快照对比，规划在 v0.2 接入；v1 只探测防护服务是否装载。

## 开发规划与文档

- [docs/PLAN.md](docs/PLAN.md) — 开发规划（背景、版本路线图、检查项设计依据）
- [docs/guide-security-review.md](docs/guide-security-review.md) — 安全检测指南（检测外来插件，AI 提示词/skill 可用）
- [docs/guide-secure-development.md](docs/guide-secure-development.md) — 安全开发指南（自研插件安全底线）
- `skills/dsh-security-review/SKILL.md`、`skills/dsh-secure-dev/SKILL.md` — 上述两指南的 skill 版本，复制进 `.agents/skills/` 即可安装

## 兼容性

- DeepSeek Harness `0.1.0-rc` 系列（web profile）。目录布局以官方 publish 文档为准；布局变化时单项检查降级为"检查失败"而非崩溃。

## 许可

MIT
