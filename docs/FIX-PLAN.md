# dsh-security-doctor v0.2.0 修复计划（针对体验反馈报告）

> 输入：用户实测反馈《dsh-security-doctor 插件体验反馈》（2026-08-16，DSH 0.1.0-rc.5 源码运行环境）。
> 修复原则：**P0 全修 + P1 全修 + P2 全修**；每项修复配对应测试/验证，通过后在下列清单打勾；全部完成后一次性推送 GitHub 并打 `v0.2.0` 标签。
> 环境事实（已核实）：`ctx.get(name)` 是 cordis 官方服务探测方式（vendor/cordis/src/reflect.ts:17）；`ApprovalService` 暴露 `config.policy`（'ask'|'never'，packages/interaction/user-approval/src/index.ts:194-198）——F2 的"读真实策略值"可以落地。

## 修复清单（全部完成，验证记录见文末）

### P0 必修

- [x] **F1 `!!js` 注释误报**：新增 `stripYamlComment()`（引号外 `#` 起注释），匹配前剥注释并要求数字/字母边界；测试：注释行（"!!js expressions allowed"）不命中、真指令命中且行号正确（smoke: `cordis.patch.yml:6`）。
- [x] **F2 服务探测失效 → 改 `ctx.get()`，并读取真实策略值**：`getService()` 优先 `ctx.get(key)`；`probeServices()` 读 `approval.config.policy` 与 `permissionPresets.config.defaultPreset`；`never`/`danger-full-access` 直接升高危并给出改回建议。测试：host 用"属性不可见、仅 get() 可见"的假 ctx 验证（present=true）；`ask`+`workspace-write` → pass；`never` → high；全缺失 → medium 且点名 sandbox。
- [x] **F3 医者不自辨**：盘点命中自身时标注"本插件自身"，advice 给出 `#v0.2.0` 锁定命令；README 安装命令默认带 `#v0.2.0`；发版打标签。测试：smoke 断言 `dsh-security-doctor[^\n]*本插件自身` 与 advice 含 `#v`。
- [x] **I1 源码 checkout 场景安装说明**：README 安装节新增"源码 checkout 运行的 DSH"小节（`pnpm dsh plugin …` 与 `node --import tsx/esm apps/cli/src/bin.ts plugin …`）。
- [x] **I2 装完必须重启无提示**：README 安装节顶部显眼警告框（重启才生效 + CLI 不提示是上游问题已注明建议上游改进）。

### P1 重要

- [x] **I3 npm 发布**：`package.json` 升 0.2.0；`npm pack --dry-run` 验证通过（14 文件/44.6kB，无测试与开发残留泄漏）；本机 npm 无登录凭据（`npm whoami` → ENEEDAUTH），**最终 `npm publish` 留给有 npm 账号的一方执行**；README 已写明 npm 安装位。
- [x] **I4 装完自检**：新增 `GET /dsh-security-doctor/self-test`（ok/插件名/版本/宿主已载/服务探测）；客户端挂载后 fetch self-test 并在浏览器控制台回显 `[dsh-security-doctor] client loaded; host self-test: v0.2.0`；README"安装自检"节给三查命令。测试：host 断言 200/字段；client 断言挂载即 ping self-test。
- [x] **I5 重启中断会话预警**：README 警告框第 2 条。
- [x] **U1 暗色/主题适配**：去掉硬编码浅色底；severity 芯片改半透明 rgba 底 + `--dsw-alias-*` token 色（error/warning/info/success 带 fallback）；卡片底/边/文字全部 token 化。
- [x] **U2 报告按严重度排序**：`sortChecks()` 按 high→error→medium→low→info、pass 沉底；高危卡片 `dsd-check--high` 红边+浅红底。测试：client 断言卡片顺序（high 首位、pass 末位）与强调类名。
- [x] **U4 失败原因可见**：fetch 失败进入错误弹层（红字错误信息 + 重试按钮），不再只藏 tooltip。
- [x] **U7+F10 历史与趋势**：报告摘要+命中 id 存 localStorage（最近 10 次）；弹层显示"上次时间/新增命中/已消失命中"。测试：client 断言 history 记录写入且 summary/findingIds 正确。
- [x] **U9+F9 主动告警**：挂载自动体检一次；有高危时按钮红色角标（计数），打开过报告后清除。测试：client 断言 idle 渲染含 `dsd-badge` 且计数正确。
- [x] **F4 已装插件出网扫描（新检查 C7）**：静态扫描外来插件源码（js/mjs/cjs/ts，跳过嵌套 node_modules 与点目录，限 200 文件/深度 4/单文件 512KB），提取 http(s)/ws(s) 主机名（排除回环与模板变量），按插件列出；无可扫描源码标"关注"。测试：smoke 断言 `dsh-evil-helper → evil.example`、`api.deepseek.com` 在列、`localhost` 排除、纯二进制插件触发"无可扫描源码"。
- [x] **F5 baseURL 读真实生效值**：新增 `DEEPSEEK_BASE_URL` 环境变量检查（只显示主机名，不显示路径/值），标注其优先级高于配置文件；yml 行匹配保持键名宽松。测试：smoke 注入 env 断言主机名出现且无 `/v1` 泄漏。
- [x] **F6 Windows 凭据 ACL**：Windows 分支 `execFile('icacls', [file])`（无 shell、固定参数）→ `parseIcaclsAcl()` 解析账户/权限 → Users/Everyone/Authenticated Users 可读判"关注"，否则列出账户判通过；查询失败回退提示。安全承诺与数据流三问同步更新（唯一外部命令=icacls 只读查询）。测试：parseIcaclsAcl 单元断言 + 注入 icacls 样例输出的宽/严两分支。
- [x] **F7 指令文件哈希与变更检测**：宿主对每个指令文件/`.agents` 目录清单算 SHA-256 随 `extra.files` 返回；客户端按工作区存快照并对比，弹层显示"与上次一致/变更/新增"（首次记录有说明）。测试：smoke 断言哈希为 64 位 hex。
- [x] **F8+F11 修复流程（插件保持只读）**：每项可处置检查配「📋 处方」按钮 + 弹层「📋 一键生成全部处方」：生成 Markdown 处方单（标题/证据/编号步骤/绝对路径/harness 主目录/新会话+空工作区+只读预设+逐项审批+复检闭环的执行须知），复制后粘贴到**新会话**执行；插件自身不改任何文件（安全承诺不变）。测试：client 断言处方按钮存在。
- [x] **X1 POSIX 权限语义**：改为 `(mode & 0o077) === 0`（0400/0600 及更严位型均通过），detail 显示八进制。测试：注入 stat `{mode: 0o100400}` 断言 pass（Windows 无法真实表达该位型，故用注入）。
- [x] **X2 CI + 平台声明**：`.github/workflows/ci.yml` 三平台 × Node 22/24 矩阵跑三个零依赖测试；README 兼容性标注（rc.5 实测；Windows 手测，macOS/Linux 走 CI；Node ≥22）。

### P2 打磨

- [x] **I6 peer 警告**：v0.2.0 移除 `peerDependencies`（运行时零 cordis import），README FAQ 解释历史与原因。
- [x] **U3 i18n**：内置中英字符串表（按钮/弹层/芯片/提示全套），按 `navigator.language` 自动选择；报告正文暂为中文（README 局限已声明）。
- [x] **U5 复制/导出**：弹层底部「复制 Markdown」（全量报告 md）与「导出 JSON」（blob 下载）。
- [x] **U6 命中项渲染**：detail 逐行列表化；路径 token 渲染为可点击 `code` 芯片（点击复制、复制成功高亮）；超过 8 行折叠/展开。
- [x] **U8 可访问性**：`role="dialog"` + `aria-modal` + `aria-labelledby`、Tab 焦点圈、关闭还焦、运行中 spinner（`role="progressbar"`/`aria-busy`）、按钮/徽标 aria-label。
- [x] **X3 盲区声明**：README 局限节补"POSIX 位≠完整 ACL（macOS 扩展 ACL）""凭据文件为符号链接时 stat 跟随"。
- [x] **反馈 4.3 杂项**：新增 `test/client.mjs`（伪 React + 伪 slots/d_fetch/localStorage 的结构测试：注册、aria、排序、徽标、处方、历史、自动体检）；README 补"数据流三问"速查表。

## 不修/外部项说明

- **I2 的上游部分**（`dsh plugin add` 装完打印重启提示）属 DSH CLI 行为，插件侧无实现点；README 警告框先行承担（上文 I2）。
- **I3 的最终 `npm publish`**：需要 npm 账号凭据（本机 `npm whoami` 未登录）；已完成 pack 验证与 README 就绪，执行留给有凭据的一方。
- **X4**：引用 F6，不单独计。

## 验证记录（2026-08-16，Windows 本机）

| 验证 | 命令/手段 | 结果 |
| --- | --- | --- |
| 语法 | `node --check lib/{checks,index,client}.js` | ✅ 全过（期间修掉 client.js 两处真实语法错误：IIFE 多括号、props 内误置字串） |
| 检查引擎 | `node test/smoke.mjs` | ✅ SMOKE OK — high×1（!!js 真命中）medium×3 info×2；凭据值零泄漏断言过；never/danger-full-access 升高危及 0400 通过分支均验证 |
| 宿主半 | `node test/host.mjs` | ✅ HOST OK — 双路由注册、405/200、ctx.get-only 探测、策略真值（ask/workspace-write→pass；never→high；全缺→medium 点名 sandbox）、self-test 字段 |
| 客户端 | `node test/client.mjs` | ✅ CLIENT OK — 插槽注册、aria 标签、挂载自动体检+self-test 回显、dialog 语义、排序（JS 检查/盘点/端点）、高危强调、处方/复制/导出按钮、徽标计数、history 写入 |
| npm 包 | `npm pack --dry-run` | ✅ 0.2.0 / 14 文件 / 44.6kB，无 test、.dev-patch.yml 泄漏 |
| 组合挂载 | `dsh --profile web --patch .dev-patch.yml --dump-config` | ✅ 补丁层出现在组合配置尾部（v0.1 时已验，v0.2 同路径复验） |
| CI | `.github/workflows/ci.yml` | 已配置三平台 × Node 22/24；推送后由 GitHub Actions 执行 |
