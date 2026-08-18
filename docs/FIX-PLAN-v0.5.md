# v0.5 修复计划（FIX-PLAN）

> 依据：用户《dsh-security-doctor v0.3 更新安装与使用记录》（2026-08-16，含 v0.4 追加与 UI 实测定位）。
> 原则：逐项修复 → 逐项验证（跑对应测试）→ 验证通过才在下面打勾 → **全部完成后一次性推送 GitHub**。
> 注：本计划是本轮工作文档；按同一份反馈的"文档跟着版本走"原则，历史计划（PLAN/FIX-PLAN/VERSIONING-PLAN）将在 P11 清理，本文件保留为 v0.5 的修复记录。

## 修复项清单

### 引擎（lib/checks.js）

- [x] **P1（3.2-1，C7 出网扫描误报 `host`）**：`checkPluginEgress` 先剥 JS 注释（块注释 + 行注释，行注释保护 `scheme://` 的冒号前缀）再做 URL 提取。验证：smoke 新增用例——注释里的 `https://commented.example/`、块注释里的 URL 不得出现在扫描结果，真实代码 URL 仍命中。
- [x] **P2（3.2-2，C2 自身盘点降噪）**：唯一外来插件是本插件自身、且已锁定、且无安装脚本时，盘点降为 `info/pass`，detail 明确"除本插件自身（已锁定 vX.Y.Z）外，未发现其他外来插件"。验证：smoke 新增两个场景（仅自身+已锁 → pass；仅自身+未锁 → 仍 medium finding）。
- [x] **P3（3.2-3，处方建议版本号硬编码）**：`checkThirdPartyPlugins` 的 advice 不再写死 `#v0.2.0`，改用 `runSecurityCheckup` 已注入的 `pluginVersion` 动态生成；无版本时回退通用文案。验证：smoke 传 `pluginVersion:'9.9.9'` 断言 advice 含 `#v9.9.9`；同时清理 detail 里"本插件 v0.3 的内置扫描"这类过时版本引用。
- [x] **P4（3.2-7，icacls 未解析 SID）**：ACL 列表中 `S-1-5-…` 形态的账户后追加"（未解析 SID）"标注。验证：smoke 的 Windows ACL 用例加入未解析 SID 行并断言标注出现。

### 客户端（lib/client.js）

- [x] **P5（V5-1 🔴，PATH_RE 把中文正文吞进路径 chip）**：重写路径识别——Windows 盘符与 `~/` 分支限定"路径字符 + CJK"字符集（遇全角标点即停）；多段相对路径分支保持 ASCII-only；删除会吞中文的 `[~/][^\s…]+` 宽匹配。验证：client 测试——"补丁/配置文件中发现"整句不产生 chip；`~/.dsh/.credentials.yaml（Key…` 的 chip 恰为 `~/.dsh/.credentials.yaml`；`…#v0.4.0)` 依赖串不产生 chip。
- [x] **P6（V5-2，卡片头窄窗口换行）**：`.dsd-check__head` 改 `flex-wrap:nowrap`，标题加 ellipsis 截断。验证：CSS 审查 + 全量测试回归。
- [x] **P7（3.2-5 / v0.4-2，挂载自动弹窗）**：mount 自动体检不再直接打开弹层，仅更新报告与徽标；**存在未确认高危时才自动弹出**，其余等用户点击。验证：client 测试新增场景——无高危报告挂载后不出现 dialog、按钮回到 idle；手动点击仍能打开。
- [x] **P8（3.2-4，检查更新文案不分原因）**：HTTP 404 单独识别为"未查询到已发布的 Release"，与"网络或 GitHub 不可达"区分。验证：client 测试模拟 404 响应断言新文案。
- [x] **P9（v0.4-3，backdrop-filter 低端设备降级）**：`prefers-reduced-motion` 下关闭多层 backdrop-filter 并回退不透明背景。验证：CSS 审查 + 回归。

### 仓库与文档

- [x] **P10（v0.4-1，中文目录名 Windows 解包乱码）**：`界面/` 重命名为 `design/`；`screen.png` 从 git 移除、改为 GitHub Release 附件；`DESIGN.md`/`code.html` 留在 `design/`。验证：grep 无 `界面` 残留引用；Release 附件上传成功。
- [x] **P11（仓库文件清理）**：删除 `docs/PLAN.md`、`docs/FIX-PLAN.md`、`docs/VERSIONING-PLAN.md`、`docs/feedback/`（结论已在 CHANGELOG，按"长期文档应当现在依然有效"原则）；CHANGELOG 中指向已删文件的链接改为纯文本。验证：全仓 grep 无指向已删文件的死链。
- [x] **P12（README 瘦身）**：README.md 压到约 80 行——功能列表并入简介与检查项表；安装+更新+迁移+回退合并为「安装与更新」；删「工作原理」；安全承诺压缩为三条+链接；常见问题只留高频 3 条；「开发规划与文档」改一行文档索引；README.en.md 同步。验证：行数统计 + 链接完整性检查。

### 版本与发布

- [x] **P13（版本 0.5.0）**：package.json → 0.5.0；三套测试全绿；README 引用、兼容矩阵、CHANGELOG 条目齐备；`node --check` 通过；外发口径 grep 不变。
- [x] **P14（推送与发布）**：commit + tag `v0.5.0` + push + GitHub Release（SHA/diff/实测矩阵/安装命令）+ `screen.png` 作为 Release 附件 + Latest 指向 v0.5.0 + 修正 v0.4.0 Release 里指向旧 `界面/` 的链接。验证：CI 绿 + `/releases/latest` 返回 v0.5.0。

## 不采纳/不改说明

- **3.2-6（会话级策略覆盖读不到）**：反馈自己标注"无需改"，README「局限」保留一句声明（P12 中保留）。
- 其余意见全部采纳。
