# dsh-security-doctor 自审报告（SELF-AUDIT）

> **原则**：这个插件替用户审查别的插件，所以它必须先用**自己发布的标准**审自己。本报告用《[安全检测指南](guide-security-review.md)》的 T1–T10 十类威胁逐条对照本插件代码；自审中发现的真实问题（S1–S3）当轮修复并有测试为证。本文件随版本更新持续追加，不做静默修改。
>
> 审查对象：v0.3.0 ｜ 审查方式：静态源码审查 + 测试断言 ｜ 结论：**未发现 T1–T10 命中项；自审另发现 3 处可加固点（S1–S3），已全部修复并覆盖测试；v0.3.0 新增一处受控外发（手动检查更新），作为 V4 变更在第六节公示。**

## 一、用自家 T1–T10 审自己

| 威胁 | 对照结果 | 证据 |
| --- | --- | --- |
| T1 安装期代码执行 | ✅ 无命中 | `package.json` 无 `scripts` 字段；无 `bin`；`files` 白名单只含 lib/docs/skills/patch |
| T2 配置即代码 | ✅ 无命中 | 仓库 grep `!!js` 零命中（`cordis.patch.yml` 为一行声明式 insert） |
| T3 权限提升/安全层改写 | ✅ 无命中 | patch 只 insert 自身一行，不 replace 任何行；不写 approval/permission/sandbox 配置 |
| T4 宿主代码危险行为 | ✅ 无命中 | 两个无参数 GET 路由（无法被指向任意文件）；无 `eval`/`new Function`/`vm`；唯一子进程是 `execFile('icacls', [固定路径])`（无 shell、无用户输入）；零文件写入 |
| T5 数据外发 | ✅ 无自动外发命中 | 宿主半零外部域名；客户端唯一外部 URL 是 `api.github.com` 的 Release 查询，**仅在用户手动点击「检查更新」时发一次**（V4，见第六节公示）；无遥测、无自动后台检查。client 测试断言：点击前零外发请求、点击后恰好一次且 URL 唯一 |
| T6 凭据接触 | ✅ 无命中 | `.credentials.yaml` 只 `stat`/`icacls`；内容零读取（smoke 测试断言凭据值不出现在任何输出） |
| T7 指令文件与上下文注入 | ✅ 无命中 | 不写 AGENTS.md/CLAUDE.md/.agents；不注入系统提示 |
| T8 客户端代码 | ✅ 无命中 | 只注册侧栏 footer 一个插槽；无键盘监听；不读其他插件 DOM；localStorage 只存体检摘要与哈希（内容见下表） |
| T9 供应链 | ✅ 无命中 | 零运行时依赖（无 dependencies）；peer 已移除；CI actions 钉 commit SHA（S3）；安装命令钉版本标签 |
| T10 隐藏与混淆 | ✅ 无命中 | 无 base64/长串/混淆；无构建步骤，所见即所执行 |

## 二、自审发现与修复（S1–S3）

自审不止过了十类，还以"如果我是攻击者，怎么滥用这个插件"的视角复查了一轮，发现三处可加固点并当轮修复：

| # | 发现 | 风险 | 修复 | 验证 |
| --- | --- | --- | --- | --- |
| S1 | `/check` 与 `/self-test` 继承了 dsh web 路由的既有信任域（回环无鉴权，同类问题在 DSH 审计中为 F-001）。本机其他网页可跨站读取体检报告（插件清单、配置行、ACL 账户名属低敏感但不必暴露） | 中 | 双路由要求配对头 `x-dsh-security-doctor: 1`：跨站页面无法附加自定义头（需 CORS 预检，本服务永不授予）；同时拒绝 `Sec-Fetch-Site: cross-site`。curl 自检命令在 README 同步更新 | host 测试：无头 → 403；`cross-site` → 403；带头 → 200。client 测试：每次 fetch 均带头 |
| S2 | 回显的配置行若含 `https://user:pass@host` 或 `?key=...` 会把凭据带进报告/复制内容 | 中 | 新增 `maskSecrets()`：遮蔽 URL userinfo、常见 query 凭据参数、`sk-`/`gh?_` 令牌；应用于 `!!js` 行与 baseURL 行回显 | smoke 测试：`hunter2secret` 与 query key 不出现在输出，主机名仍显示；`maskSecrets` 单元断言 |
| S3 | CI 用 `actions/checkout@v4` 等可变 tag——对安全工具不可接受（tag 可被移动） | 低 | 两个 action 钉到 commit SHA（注释标版本） | workflow 文件审查；每次推送 CI 复跑 |

## 三、数据透明化（插件到底碰了什么）

| 类别 | 明细 |
| --- | --- |
| **读（文件）** | `~/.dsh` 下：cordis.patch.yml / cordis.yml / settings.yaml / profiles/*/package.json（全文本）；`.credentials.yaml`（**仅** stat 权限位 + Windows icacls 账户名）；profiles/*/node_modules/&lt;外来插件&gt;/ 源码（出网扫描用，限 200 文件/512KB）；工作区指令文件（读入后立即哈希，内容不留存） |
| **读（进程内）** | `ctx.get()` 探测 4 个服务存在性 + `approval.config.policy`、`permissionPresets.config.defaultPreset` 两个策略值；`DSH_HOME`、`DEEPSEEK_BASE_URL`（只取主机名）两个环境变量 |
| **写（文件）** | **无** |
| **写（浏览器）** | localStorage：`dsd.history`（最近 10 次体检的时间/级别计数/命中项 id）、`dsd.instr.<工作区>`（指令文件名→哈希）。无凭据、无报告全文、无个人信息 |
| **网络** | 默认仅页面 → 本机 dsh web 的 GET（`/check`、`/self-test`，带头、`no-store`），**零自动外发**。唯一显式外部请求：用户点击「检查更新」时浏览器 GET `api.github.com/repos/ChenChen913/dsh-security-doctor/releases/latest`（只读版本信息，不上行数据）；查询到的 tag 会作为 `?latest=` 参数回传本机 self-test 供排障 |
| **子进程** | 仅 Windows：`icacls <凭据文件>`（execFile 直调、固定参数、只读查询） |

## 四、为什么你可以亲自验证

- **零构建**：`lib/` 三个文件就是运行的代码本体，`node --check` 可验语法，逐行可读。
- **零依赖**：`npm ls --all` 为空（无 dependencies）；不存在"看不完的依赖树"。
- **测试即证据**：三个测试断言了承诺里最要害的部分——凭据值零泄漏（smoke）、无头 403/跨站 403（host）、每次请求带头（client）。任何人 `node test/*.mjs` 即可复跑。
- **持续约束**：CI 三平台 × Node 22/24 每次推送自动执行；本文档随每次安全相关变更更新并公示。

## 五、已知边界（诚实声明）

- 报告会显示外来插件名/依赖引用/配置行（已脱敏）——这是它的工作内容，但意味着报告本身别随手公开粘贴（导出 JSON 同理）。
- localStorage 中的体检历史存在浏览器里，清浏览器数据即清空（属预期行为，不做云同步）。
- `execFile('icacls', …)` 在 Windows 上由系统自带 icacls.exe 执行；若你对该二进制不信任，可在代码中直接看到并移除该分支（会退化为"属性→安全"提示）。
- 我们承诺修复漏洞后在本文件公示过程；但对"尽力检测"的固有局限（详见 README 局限节）不承诺消除。

## 六、v0.3.0 变更公示：版本管理与分发修复（含一处受控外发）

针对用户反馈《版本管理与分发问题》（2026-08-16，"一个安全插件整天警告别人 git 引用未锁定，自己却以最不被推荐的方式分发"），v0.3.0 执行修复（计划文档已按"文档跟着版本走"原则清理，结论沉淀在 CHANGELOG 0.3.0 条目）。与安全承诺相关的变更在此逐条公示：

| 变更 | 内容 | 为什么可接受 | 验证 |
| --- | --- | --- | --- |
| **V4 受控外发（本节核心）** | 报告页脚「检查更新」按钮：点击时浏览器 GET `api.github.com/repos/ChenChen913/dsh-security-doctor/releases/latest`，读取 `tag_name` 与报告自带的 `pluginVersion` 比较 | ① 仅用户显式点击触发，默认零请求；② URL 为代码内单一常量，grep 可核；③ GET 只读，请求不携带体检报告、路径、凭据等任何本机数据；④ 结果只用于界面提示，不写文件 | client 测试：点击前断言零 `api.github.com` 请求；点击后断言恰好 1 次且 URL 为钉死常量；tag 经校验后回传本机 self-test（回环） |
| V3 报告自带版本 | `/check` 报告与导出/复制内容标注 `pluginVersion` | 纯新增字段，无新读取 | host 测试：`report.pluginVersion` 与 self-test `version` 同源一致 |
| V8 self-test 补齐 | 响应增加 `reportVersion` 与 `latestTagHint`（回显校验过的 `?latest=` 参数） | 纯回显，正则限定 semver，不写不取 | host 测试：默认 null、合法回显、非法拒绝 |
| 文档口径 | SECURITY.md / README 中英 / 本文件"零外发"修订为"默认零外发 + 唯一显式例外" | 与代码实际行为一致，避免承诺与实现脱节 | `grep -rn "api.github.com" lib/` 恰好一处 |

**明确不做**：自动/后台检查更新（与默认零外发承诺冲突且收益低）；除上述按钮外的任何外部请求。
