# 更新日志（CHANGELOG）

本插件遵循 [semver](https://semver.org/)：修复 → patch，新增功能 → minor，破坏性变更 → major（0.x 阶段 minor 也可能含行为变化，会在条目里写明）。

**发布规范**（v0.3.0 起固化，见 [docs/release.md](docs/release.md)）：每个版本打 annotated tag（`vX.Y.Z`）并附 GitHub Release，Release 正文含变更摘要、与上一版的 diff 链接、tag commit SHA 与实测 harness 版本矩阵。更新前请先看 [Releases](https://github.com/ChenChen913/dsh-security-doctor/releases) 或本文件的对应条目。

## [0.6.0] — 2026-08-19

两轮修改合并发版：用户实测反馈的 10 项修复（原计划 v0.5.1）+ 报告页布局精修。视觉方向（液态玻璃 / 半透明 / 黑白灰）与检测逻辑、评分公式、数据结构、外发口径均不变。

### 修复（引擎，用户反馈 10 项）

- **端点扫描别名键扩展**：出网端点检查补充 `apiUrl` / `apiEndpoint` / `endpoint` 别名键与更多 LLM 环境覆盖（`OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` 等）。
- **双语报告**：全部检查的标题 / 详情 / 建议与判词按客户端 locale 中英文渲染（`?lang=`，默认中文）。
- **安全服务建议修正**：建议指向真实的 Web UI 权限预设 / `DSH_PERMISSION_MODE`，移除虚构的 settings 路径。

### 修复（客户端）

- 单项处方复制增加 toast 反馈（此前静默复制）。
- 10 分钟内相同的自动体检在历史中去重（手动检测始终记录），趋势基线不被页面刷新淹没。
- 评分公式挂在评分环 tooltip 上；存在说明级发现时评分上限 99。
- 趋势行按检查项内容指纹追踪「内容有变」；新增「已阅」机制——确认后的发现不再驱动红色徽标与自动弹窗，直至内容变化。
- 路径识别正则 CJK 安全化：中文正文里的多段 ASCII 路径不再误判为可复制路径块。
- 打包：`FIX-PLAN-v0.5.md` 移出 `docs/`，不再随插件包分发。

### 变更（布局精修，视觉风格不变）

- **总览仪表盘化**：评分环 | 判词 / 趋势统计 / 级别胶囊统一垂直节奏，趋势统计以整体换行的独立单元渲染，窄窗口不重叠。
- **重点卡片统一骨架**：状态点 | 标题·正文·来源 | 级别+操作 三列结构，任何卡片多一行文字不再挤压其他卡片的对齐。
- **来源信息降级为 metadata 行**：盘点清单行（`- …`）渲染为小号灰色单行（ellipsis + tooltip，前缀「来源 ·」），不再像正文或撑高卡片。
- **通过项分组折叠**：通过的检查合并为一张轻量列表（绿点 + 标题 + 「正常」 + chevron），点击原位展开详情与建议。
- **Footer 分层**：生成元数据行与安全说明拆为两段；全部胶囊按钮统一 28px 高。
- **窄屏适配**：480px 以下收紧外边距；各区域按单元换行。

### 实测环境

| 项 | 值 |
| --- | --- |
| harness | DSH `0.1.0-rc.5`（Windows，源码运行） |
| OS | Windows 实测；macOS / Linux 由 CI（ubuntu/macos/windows × Node 22/24）覆盖 |
| Node | ≥ 22（22/24 CI 通过） |

## [0.5.0] — 2026-08-18

针对用户实测反馈（2026-08-16 起，含 v0.4 追加与 UI 实测定位）的修复，逐项计划与验证记录见 [FIX-PLAN-v0.5.md](FIX-PLAN-v0.5.md)。

### 修复（引擎）

- **出网扫描剥注释（P1）**：C7 扫描前先剥离 JS 块注释与行注释（保护 `scheme://` 冒号前缀）——注释里的示例 URL 不再计入外联结果，真实代码 URL 不受影响。
- **自身盘点降噪（P2）**：唯一外来插件是本插件自身、且已锁定、且无安装脚本时，盘点降为 `info/pass`，不再常驻"关注"。
- **处方建议版本动态化（P3）**：盘点建议不再写死旧版本标签，改用运行时注入的 `pluginVersion` 生成；无版本时回退通用文案。
- **icacls 未解析 SID 标注（P4）**：ACL 列表中 `S-1-5-…` 形态的账户追加"（未解析 SID）"标注。

### 修复（客户端）

- **路径 chip 不再吞中文（P5）**：重写路径识别正则——Windows 盘符与 `~/` 路径允许 CJK 字符但遇全角标点即停；多段相对路径保持 ASCII-only。"补丁/配置文件中发现"这类中文正文不再被切成等宽路径块。
- **卡片头窄窗口不换行（P6）**：卡片标题 ellipsis 截断，头部单行布局。
- **挂载不再自动弹窗（P7）**：安装后自动体检只更新报告与徽标；**仅存在未确认高危时才自动弹出**，刷新页面不再打扰。
- **检查更新区分 404 与网络失败（P8）**：HTTP 404 单独提示"未查询到已发布的 Release"，与"网络或 GitHub 不可达"区分。
- **低端设备 backdrop-filter 降级（P9）**：`prefers-reduced-motion` 下关闭多层磨砂效果并回退不透明背景。

### 仓库与文档

- **`界面/` → `design/`（P10）**：中文目录名在 Windows 解包时乱码，重命名为 `design/`；`screen.png` 从仓库移除，改为 GitHub Release 附件。
- **文件清理（P11）**：删除历史计划文档（`PLAN.md`/`FIX-PLAN.md`/`VERSIONING-PLAN.md`/`docs/feedback/`，结论已沉淀在 CHANGELOG），修复指向已删文件的死链。
- **README 瘦身（P12）**：中英两份 README 压到约 80 行——功能并入简介与检查项表、安装/更新/迁移/回退合并、删「工作原理」、常见问题只留高频 3 条。

### 实测环境

| 项 | 值 |
| --- | --- |
| harness | DSH `0.1.0-rc.5`（Windows，源码运行） |
| OS | Windows 实测；macOS / Linux 由 CI（ubuntu/macos/windows × Node 22/24）覆盖 |
| Node | ≥ 22（22/24 CI 通过） |

## [0.4.0] — 2026-08-16

报告弹窗「液态玻璃（Liquid Glass）」界面重设计。设计源文件与规范存档于 [`design/`](design/DESIGN.md)（DESIGN.md + code.html 原型；效果图见 v0.4.0 Release 附件）。

### 新增

- **总览评分环**：弹窗顶部新增环形安全评分（0–100，由 高危 −25 / 检查失败 −8 / 关注 −10 / 建议 −3 累计扣分推导），环体渐变颜色随最严重级别变化（红/琥珀/蓝/绿）；结论文字与评分同色系。复制的 Markdown 报告同步标注「安全评分: N/100」。
- **液态玻璃视觉体系**：磨砂半透明面板（backdrop blur 24px + saturate 180% + 边缘高光内描边）、嵌套玻璃卡片、全圆角胶囊按钮（hover 上浮）、状态用 8px 彩色圆点表达（高危带光晕）而非彩色底纹色块、高危卡片改为左侧细色条强调（替代整卡红底）、渐变发丝分隔线、细滚动条、弹窗入场缩放动画（尊重 `prefers-reduced-motion`）。
- **明暗自适应**：玻璃色调优先从宿主主题 token（`--dsw-alias-*`，经 `color-mix` 混入透明度）推导，宿主无 token 时回退静态值并跟随系统 `prefers-color-scheme`。

### 变更

- 图标全部改为**内联 SVG 细线图标**（1.8px 描边），移除 🛡/📋/↻/✕ 等 emoji 与 unicode 符号。**注意**：原型使用的 Material Symbols / Inter / Geist 均为 Google CDN 外部字体，与本插件"默认零外发"承诺冲突，实现时以系统字体栈与内联 SVG 等效替代——视觉效果一致，安全承诺不变。
- 卡片级别标签从彩色底纹 chip 改为「彩色圆点 + 标题 + 灰色级别文字」，色盲用户仍可读级别文字。

### 无变化（明确声明）

- 功能、数据流、路由、外发口径与 v0.3.0 完全一致：无新增网络请求（图标为内联 SVG，未引入任何外部字体/CDN）；DOM 契约（`dsd-check`/`--high`/`__head`/`__title` 等）保持不变，三套测试新增 UI 断言（评分环、状态点、胶囊、pass 修饰类）后全部通过。

### 实测环境

| 项 | 值 |
| --- | --- |
| harness | DSH `0.1.0-rc.5`（Windows，源码运行） |
| OS | Windows 实测；macOS / Linux 由 CI（ubuntu/macos/windows × Node 22/24）覆盖 |
| Node | ≥ 22（22/24 CI 通过） |

## [0.3.0] — 2026-08-16

针对用户反馈（版本管理与分发问题，2026-08-16）的修复。

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

修复实测反馈 28 项（P0×5 + P1×15 + P2×8）。要点：

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

[0.6.0]: https://github.com/ChenChen913/dsh-security-doctor/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/ChenChen913/dsh-security-doctor/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ChenChen913/dsh-security-doctor/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ChenChen913/dsh-security-doctor/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/ChenChen913/dsh-security-doctor/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ChenChen913/dsh-security-doctor/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ChenChen913/dsh-security-doctor/tree/v0.1.0
