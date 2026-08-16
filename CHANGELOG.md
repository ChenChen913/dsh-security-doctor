# 更新日志（CHANGELOG）

本插件遵循 [semver](https://semver.org/)：修复 → patch，新增功能 → minor，破坏性变更 → major（0.x 阶段 minor 也可能含行为变化，会在条目里写明）。

**发布规范**（v0.3.0 起固化，见 [docs/release.md](docs/release.md)）：每个版本打 annotated tag（`vX.Y.Z`）并附 GitHub Release，Release 正文含变更摘要、与上一版的 diff 链接、tag commit SHA 与实测 harness 版本矩阵。更新前请先看 [Releases](https://github.com/ChenChen913/dsh-security-doctor/releases) 或本文件的对应条目。

## [0.3.0] — 2026-08-16

针对用户反馈《[版本管理与分发问题](docs/feedback/2026-08-16-versioning-feedback.md)》的修复（计划与执行记录：[docs/VERSIONING-PLAN.md](docs/VERSIONING-PLAN.md)）。

### 新增

- **报告自带版本（V3）**：`/check` 报告增加 `pluginVersion` 字段；报告页脚显示「插件 vX.Y.Z」，导出 JSON 与复制的 Markdown 同样标注生成版本——更新后一眼确认跑的确实是新版。
- **手动检查更新（V4）**：报告页脚新增「检查更新」按钮，**仅在你点击时**向 `api.github.com` 查询本插件最新 Release（本插件唯一的显式外发：单次请求、只读版本信息、默认零请求、无自动后台检查）；有新版时显示最新 tag 并指向 README「更新」一节。
- **self-test 版本口径补齐（V8）**：`/self-test` 响应增加 `reportVersion`（与 `/check` 报告所盖版本同源）与 `latestTagHint`（客户端「检查更新」拿到最新 tag 后回传，curl 复跑即可同时看到当前与最新版本）。
- **CHANGELOG 与发布流程（V1/V5）**：本文件回填全部历史版本；新增 [docs/release.md](docs/release.md) 发布清单（改版本 → CHANGELOG → tag → Release 附 SHA/diff/实测矩阵）。
- **README「更新」一节（V2）**：改 tag → 重装 → 重启 → 刷新 的完整链路与原因（宿主代码驻内存 + 客户端元数据缓存重启才刷新）、0.1.x 未锁版本存量迁移路径、回退旧版步骤、锁 commit SHA 的更严格选项。
- **README 兼容性矩阵（V7）**：插件版本 × 实测 harness 版本 × OS 对照表。

### 变更（安全承诺措辞）

- 「零外发」修订为「**默认零外发**」：唯一显式例外是用户手动点击「检查更新」时浏览器向 `api.github.com` 发起的一次只读版本查询（不上行任何数据）。[SECURITY.md](SECURITY.md) 与 [docs/SELF-AUDIT.md](docs/SELF-AUDIT.md) 已同步修订并公示。

### 实测环境

| 项 | 值 |
| --- | --- |
| harness | DSH `0.1.0-rc.5`（Windows，源码运行） |
| OS | Windows 实测；macOS / Linux 由 CI（ubuntu/macos/windows × Node 22/24）覆盖 |
| Node | ≥ 22（22/24 CI 通过） |

## [0.2.1] — 2026-08-16

用自家《安全检测指南》T1–T10 标准自审（医者自测），发现并修复 3 处可加固点（详见 [docs/SELF-AUDIT.md](docs/SELF-AUDIT.md)）：

- **S1 防跨站读取**：`/check` 与 `/self-test` 要求配对头 `x-dsh-security-doctor: 1`（自定义头无法被其他源无预检附加），同时拒绝 `Sec-Fetch-Site: cross-site`；本机其他网页从此读不到你的体检报告。
- **S2 回显脱敏**：新增 `maskSecrets()`——URL userinfo、query 凭据参数、`sk-`/`gh?_` 令牌在回显前遮蔽；smoke 测试含"凭据值零泄漏"断言。
- **S3 CI 钉 SHA**：GitHub Actions 由可变 tag 改为钉 commit SHA。
- CI 修复：client 测试钉 `navigator.language`，en-US runner 与中文开发机跑同一套断言。

实测环境：DSH `0.1.0-rc.5`（Windows 源码运行）；CI 三平台 × Node 22/24。

## [0.2.0] — 2026-08-16

修复实测反馈 28 项（P0×5 + P1×15 + P2×8，逐项记录见 [docs/FIX-PLAN.md](docs/FIX-PLAN.md)）。要点：

- **服务探测改走 `ctx.get()`**（F2）：修复 `0.1.0-rc` 系列 harness 上"防护服务未挂载"的误报——属性访问只对注入服务生效，官方路径是 `ctx.get()`。
- **插件自辨身份**（F3）：盘点中标注"本插件自身"，未锁定时直接给出锁定命令——先管好自己再谈示范。
- **新增检查**：环境变量 `DEEPSEEK_BASE_URL` 实际生效值（F5）、已装插件出网扫描（F4）、Windows icacls ACL 凭据检查（F6）。
- **趋势对比**：指令文件 SHA-256 哈希跨次比对，"上次体检后新增/变更"提示（F7）。
- **安装自检**（I4）：`GET /dsh-security-doctor/self-test` 路由 + 控制台配对回显。
- **README 重启警告**（I2）：装完必须重启 `dsh web` 的两个必读提示。
- 移除已不需要的 `@deepseek-ai/cordis` peer 声明（安装不再出 warning）。

实测环境：DSH `0.1.0-rc.5`（Windows 源码运行）；CI 三平台 × Node 22/24。

## [0.1.0] — 2026-08-16

初版。侧栏「安全体检」按钮 + 七项只读检查（`!!js` 表达式、第三方插件盘点、凭据文件权限、工作区指令文件、外部端点配置、核心防护服务与策略）+ 分级报告 + 修复处方单；《安全检测指南》《安全开发指南》两份配套文档与 `skills/` 可安装版。

实测环境：DSH `0.1.0-rc.5`（Windows 源码运行）。

[0.3.0]: https://github.com/ChenChen913/dsh-security-doctor/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/ChenChen913/dsh-security-doctor/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ChenChen913/dsh-security-doctor/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ChenChen913/dsh-security-doctor/tree/v0.1.0
