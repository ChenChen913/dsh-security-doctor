# 版本管理与分发修复计划（VERSIONING-PLAN）

> 依据：[用户反馈存档 2026-08-16](feedback/2026-08-16-versioning-feedback.md)。
> 第一节为规划轮的核实结论（对照 v0.2.1 仓库逐条查证，只核实不改动）。
> **执行轮已完成（2026-08-16，产出 v0.3.0）**：第二节各项已勾选，第五节为执行与验证记录。除 V6（npm 凭据缺失）外全部落地。

## 一、逐条核实结论

| # | 反馈要点 | 核实结论 | 证据 |
| --- | --- | --- | --- |
| 1 | 无版本概念、追 main 滚动引用、不可回退 | **部分属实**。已做：v0.2.0 起打 git tag（v0.2.0/v0.2.1），README 安装命令默认带 `#v0.2.1`，体检报告对未锁定的自身标注"本插件自身"并给锁定命令（前轮 F3 修复）。仍缺：① 早期按 v0.1 README 装上的用户依赖仍是**未锁定滚动引用**，仓库没有"如何迁移到锁定引用"的说明——反馈者正是这种情况，说明迁移路径缺失是真实痛点；② 无 GitHub Release（tag 是裸的，无说明、无校验物）；③ 无法回退的体验问题属实：用户侧不知道"退回上一版"就是改依赖里的 tag 再重装 | README 安装节；git tag 列表；反馈者自述"装的没锁 commit 的滚动引用" |
| 2 | 无更新说明、无逐版兼容性声明 | **属实**。仓库无 CHANGELOG.md；两个 tag 均未附 Release notes；README 兼容性只写"0.1.0-rc.5 实测"，没有"每个版本在哪些 harness 版本实测"的矩阵 | 仓库文件清单；GitHub Releases 页为空 |
| 3 | 缺版本自检（当前版本 vs 最新版本） | **部分属实**。已做：`/self-test` 路由返回 `version` 字段（v0.2.0+，I4）。仍缺：体检报告不含自身版本；无"最新版本"检查。注意一个**设计矛盾**：检查最新版本需访问 api.github.com，与《SECURITY.md》"零外发"承诺冲突——方案必须显式处理（见 V4） | lib/index.js self-test；runSecurityCheckup 返回结构无版本字段；SELF-AUDIT 数据清单表"网络：零外部域名" |
| 4 | 更新生效链路无提示 | **部分属实**。已做：README 安装节有"装完必须重启"警告框（I2）。仍缺：没有独立「更新」一节（update 命令→重启→刷新 的三步链路与原因解释）；更新场景完全没有覆盖 | README 结构 |
| 5 | 分发规范未做全套（Release 附 SHA / diff 摘要 / npm provenance / dist-tags） | **属实**。无 GitHub Release 与 SHA 校验物；无发布 diff 摘要；npm 未发布（凭据缺失，前轮 I3 已备但未执行） | GitHub Releases 页；仓库状态 |

**总评**：5 条中 1 条属实（#2、#5），3 条"部分已修但链路不完整"（#1、#3、#4）——即前轮修复覆盖了"新装"场景，**"更新/存量用户迁移"场景整体缺位**，这正是反馈者"全程没有一处是顺的"的根源。反馈成立，值得全盘采纳。

## 二、修复项（2026-08-16 执行完毕，产出 v0.3.0）

- [x] **V1（P0）CHANGELOG.md + 逐版 Release notes**：新建 CHANGELOG.md（回填 v0.1.0/v0.2.0/v0.2.1，含"实测 harness 版本"行）；发布流程约定：每次 tag 附 GitHub Release，正文=变更摘要+diff 链接+校验信息。
- [x] **V2（P0）README「更新」一节 + 存量迁移说明**：三步链路（改依赖 tag 或 `dsh plugin add ...#vX.Y.Z` → `pnpm install`（profile 目录）→ 重启 dsh web → 刷新页面）+ 一句原因（宿主代码驻内存、客户端元数据缓存重启才刷新）+ "退回上一版=改回旧 tag 重装"。
- [x] **V3（P1）报告显示自身版本**：`/check` 返回体加 `pluginVersion`；客户端报告头部显示"插件 vX.Y.Z"；配合 self-test 形成"更新后一键确认跑的是新版"。
- [x] **V4（P1）"检查更新"（手动、默认关、透明外发）**：报告界面加"检查新版本"按钮，**仅在用户点击时**访问 `api.github.com/repos/ChenChen913/dsh-security-doctor/releases/latest`，按钮旁明示"此操作会访问 GitHub"；更新《SECURITY.md》《SELF-AUDIT》数据清单（零外发承诺改为"无自动外发；唯一的显式用户触达是检查更新"）。不做自动后台检查。
- [x] **V5（P1）发布脚本化**：`docs/release.md` 固化"改版本→打 tag→建 Release（附 tag commit SHA、diff 摘要、实测矩阵）"清单，防漏。
- [ ] **V6（P2）npm 发布执行**（待有凭据，未执行）：`npm publish` + README 安装节启用 npm 位；此后 semver/dist-tags/beta 通道与精确回退随 npm 获得；有条件接入 provenance。
- [x] **V7（P2）README 兼容性矩阵化**：`插件版本 × 实测 harness 版本 × OS` 小表，随每次发布更新（V1 的 Release 模板含同表）。
- [x] **V8（P2）自检路由补齐**：self-test 响应加 `latestTagHint`（若 V4 拿到过）与 `reportVersion`，报告与 self-test 口径一致。

## 三、验证口径（执行时）

- CHANGELOG/Release 与 git tag 一一对应，无缺版；
- README「更新」链路照抄可执行（以一台装旧版的环境实测走通）；
- V3/V4/V8 由 host/client 测试断言（版本字段存在；检查更新仅在点击时发请求且目标域名唯一、默认无请求）；
- SECURITY.md/SELF-AUDIT 同步修订并通过 grep 式自查（外发描述与代码一致）。

## 四、不做/缓做说明

- 自动后台检查更新：与零外发承诺冲突且收益低，明确不做（只做 V4 手动模式）。
- 锁 commit 分发改为默认：保留"锁 tag"为主推荐（可读性优于裸 SHA），README 同步给"锁 SHA"的更严选项。

## 五、执行与验证记录（2026-08-16，v0.3.0）

### 执行摘要

| 项 | 落地物 |
| --- | --- |
| V1 | `CHANGELOG.md`（回填 v0.1.0/v0.2.0/v0.2.1 + 本版，逐版含实测 harness 矩阵） |
| V2 | `README.md` 新增「更新（含存量迁移与回退）」一节；`README.en.md` 对应 Update 节 |
| V3 | `lib/checks.js` 报告对象新增 `pluginVersion`；`lib/index.js` `/check` 注入版本；`lib/client.js` 报告页脚显示「插件 vX.Y.Z」，导出 JSON / 复制 Markdown 均标注生成版本 |
| V4 | `lib/client.js` 报告页脚「⟳ 检查更新」按钮：仅点击时 GET `api.github.com/.../releases/latest`（代码内唯一外部 URL 常量），按钮 title 明示会访问 GitHub；有新版显示 tag 并指向 README「更新」；SECURITY.md（中英）、SELF-AUDIT（T5 行 + 数据清单 + 第六节公示）同步修订 |
| V5 | `docs/release.md` 发布清单（含五要素 Release 模板与回填验证步骤） |
| V7 | README 中英兼容性矩阵（插件版本 × 实测 harness × OS） |
| V8 | `/self-test` 响应新增 `reportVersion` 与 `latestTagHint`（回显经 semver 正则校验的 `?latest=` 参数；客户端检查更新成功后回传） |
| 分发补齐 | 补打 v0.1.0 tag；为 v0.1.0/v0.2.0/v0.2.1 补建 GitHub Release（变更摘要 + diff 链接 + tag SHA + 实测矩阵 + 安装命令）；v0.3.0 按发布清单正常发版 |

### 验证结果（第三节口径逐条）

1. **测试断言**：`node test/smoke.mjs && node test/host.mjs && node test/client.mjs` 全绿。其中新增断言：报告携带 `pluginVersion` 且与 self-test `version` 一致（host）；`reportVersion` 一致、`latestTagHint` 默认 null/合法回显/非法拒绝（host）；点击前零 `api.github.com` 请求、点击后恰好 1 次且 URL 为钉死常量、tag 回传 self-test（client）；有新版/已是最新两条展示路径（client）。
2. **grep 口径自查**：`grep -rn "api.github.com" lib/` 恰好一处（V4 按钮的 URL 常量）；`grep -rn "eval(\|new Function\|child_process" lib/` 仍只有 icacls 一处 execFile；SECURITY.md/SELF-AUDIT/README 的外发描述与代码行为一致。
3. **CHANGELOG ↔ tag ↔ Release 对应**：v0.1.0（补打）/v0.2.0/v0.2.1/v0.3.0 四版均有 tag、CHANGELOG 条目与 Release。
4. **README「更新」链路**：命令与 profile 路径逐字对照 v0.2.x 已验证过的安装路径书写；本轮环境无 DSH 实例，未做端到端重启实测（诚实声明：链路各环节——`dsh plugin add` 带 tag、profile 目录 `pnpm install`、重启生效——均为前轮实测过的既有机制，本轮新增的只是文档把它们串起来）。

### 遗留

- **V6（npm 发布）**：待 npm 凭据；已写入 `docs/release.md` 待办节。
- 端到端更新实测：下次有运行中的 DSH 环境时，按 README「更新」一节从 v0.2.1 走到 v0.3.0 复核一遍并在此回填。
