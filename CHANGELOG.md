# 更新日志（CHANGELOG）

本插件遵循 [semver](https://semver.org/)：修复 → patch，新增功能 → minor，破坏性变更 → major（0.x 阶段 minor 也可能含行为变化，会在条目里写明）。

**发布规范**（v0.3.0 起固化，见 [docs/release.md](docs/release.md)）：每个版本打 annotated tag（`vX.Y.Z`）并附 GitHub Release，Release 正文含变更摘要、与上一版的 diff 链接、tag commit SHA 与实测 harness 版本矩阵。更新前请先看 [Releases](https://github.com/ChenChen913/dsh-security-doctor/releases) 或本文件的对应条目。

## [0.6.2] — 2026-08-19

针对用户实测反馈的三点布局意见（文字腰斩截断 / 按钮溢出 / 底部遮挡）做专项复查与修复。视觉方向、检测逻辑、评分公式、数据结构、DOM 结构均不变。

### 修复（布局专项，3 点意见逐条）

- **卡片零裁切**：移除检测项卡片与通过组列表的 `overflow:hidden`——卡片本就是自适应高度（无固定 height/max-height），该裁切只剩隐患没有职责。高危红条（`::before`，内缩 12px）在卡片内部不受影响，圆角由 `border-radius` 自身处理背景。
- **文字自然换行**：卡片标题与通过行摘要把 `nowrap + ellipsis` 三件套换成 `word-break: break-word`，长检查名 / 长路径撑开卡片高度向下延展，不再被省略号截断。状态圆点保持与标题首行精确对齐（注释已锁定数值关系）。
- **通过组圆角补位**：组级裁切移除后，首行 / 末行 / 单行的 hover 背景改为逐行圆角（15px = 组圆角 16px 减 1px 边框），视觉效果与裁切方案一致。
- **按钮零绝对定位（复查确认）**：所有卡片操作按钮（处方 / 已阅 / 复检）均在 flex 流内（`flex-wrap` 换行），无 `position:absolute; bottom/right` 定位；上一轮的换行修复叠加本轮的零裁切，按钮被切一半的问题彻底消除。
- **三段式滚动（复查确认）**：弹窗标准三段结构（Header `flex:none` / Body `flex:1 + min-height:0` 独立滚动 / Footer `flex:none` 独立行）在 0.6.1 已落地，Footer 非悬浮层不覆盖内容，故无需 120px 备选方案；滚动区底部保持 24px 呼吸空间。

### 测试

样式契约断言新增：卡片与通过组无 `overflow:hidden`、标题 / 摘要含 `word-break` 且无 `nowrap`、通过组首末行圆角规则、操作列无绝对定位。三套测试（smoke / host / client）全绿。

## [0.6.1] — 2026-08-19

两轮反馈合并：v0.6.0 缺点清单 10 项修复 + 前端布局复查（排版对齐 / 三段式滚动 / 溢出裁切 / 对比度）。视觉方向（液态玻璃 / 半透明 / 黑白灰）、检测逻辑、评分公式、数据结构均不变。DOM 结构未再变动（`0.6.0` 已声明的 `.dsd-check__main` / `__side` 契约继续有效）。

### 修复（客户端，缺点清单 10 项）

- **已阅淡化收窄**：`已阅` 状态只淡化正文列（`.dsd-check__main`），高危红条、状态点与按钮保持全对比度——"看过"不再削弱红色信号。
- **已阅收纳出口**：新增「隐藏已阅 / 显示已阅」开关（含计数），已确认项可一键收起或找回。
- **通过行摘要**：折叠的通过项携带 detail 首行单行摘要（elliptic），「credentials 文件不存在」这类重要提示不再藏在点击之后。
- **来源行触屏可见**：来源 / 元数据行改为可点击按钮，点击原位展开完整内容（含可复制路径块），不再只依赖 hover tooltip。
- **10 分钟报告缓存**：窗口内的新挂载自动体检复用上次报告（同语言校验），刷新 / 多标签不再重跑全量引擎扫描；手动检测始终重跑并刷新缓存。
- **99 分封顶可见**：评分环内显示「有说明级发现，上限 99」提示。
- **已阅按钮撤销提示**：title 说明点击可撤销、内容变化后自动重新提醒。

### 修复（引擎与打包）

- **端点检查接 settings 服务**：优先上报 settings 服务中实际生效的端点（有界深度遍历，≤20 条、密钥脱敏），配置文件 / 环境变量扫描降为兜底。
- **release.md 移出发布包**：`files` 改为明确列举 docs 下的指南文件。

### 修复（布局复查 4 项，用户实测反馈）

- **排版对齐**：弹窗根节点显式 `text-align:left`——宿主容器的居中样式不再泄漏到 URL、路径、来源列表等结构化数据。
- **三段式滚动契约**：Body 区显式 `flex:1 + min-height:0`（此前依赖 overflow 隐式收缩，旧 Safari 上会失效），底部 padding 提至 24px，最后一张卡片完整可见，磨砂 Footer 永不遮挡内容。
- **操作列防裁切**：卡片右侧操作列（级别 / 处方 / 已阅）允许内部换行，窄屏不再被卡片 `overflow:hidden` 切掉一半。
- **层次与对比度**：卡片底色 44%→56%（hover 62%→72%）、总览 34%→42%、通过组 28%→38%，并加发丝投影——玻璃层级更分明，正文不再穿透底色。状态圆点与标题的对齐经核算为精确居中（8px 圆点 margin-top 6px 对 20px 行高标题），已加注释锁定数值关系。

### 实测环境

| 项 | 值 |
| --- | --- |
| harness | DSH `0.1.0-rc.5`（Windows，源码运行） |
| OS | Windows 实测；macOS / Linux 由 CI（ubuntu/macos/windows × Node 22/24）覆盖 |
| Node | ≥ 22（22/24 CI 通过） |

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

- **⚠ DOM 契约变更**：卡片头类名由 `.dsd-check__head` 拆分为 `.dsd-check__main`（标题/正文/来源区）+ `.dsd-check__side`（级别+操作区）——v0.4 承诺的「DOM 契约保持不变」在本版被打破，特此声明。若你写了依赖旧类名的第三方样式或脚本，请同步更新；其余类名（`dsd-check` / `--high` / `__title` / `__list` / `__advice` 等）不变。插件自身的类名均非稳定 API，跨版本升级前请核对本节。
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
