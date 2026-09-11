# FIX-PLAN — v1.1.0 体验修复（报告可读性 + 守护模式说明）

> 交接文档：写给后续接手的 AI 或人。读完本节即可了解全貌。
> 当前进度：**T1–T9 全部完成**（见第七节进度表）。用户已确认推送与本文档入库。
> 本文档为工作文档，默认不提交 GitHub（完成后按用户指示处理）。

---

## 一、问题背景

v1.0.0 发布后，用户（插件作者）在自己的真实环境实测了体检报告，反馈了两个体验问题，并在讨论中又确认了一个更严重的隐藏 bug。用户画像明确：**插件的大部分使用者不懂计算机**，报告必须让他们一眼看懂。

## 二、发生了什么问题（4 项）

### P1 · 出网扫描卡"高危"展开后是一锅粥
高危（plugin-egress）检查展开后是 60+ 行逐插件原始清单（`- 包名：域名(×N)；⚠ 特征…`）。60 行里只有 3 行是真凶（组合命中），57 行是"源码中未发现外联地址"这类噪音。用户原话："就像在打印系统日志，完全没必要让用户看到。"

**用户要求的呈现：只回答三个问题——哪个地方高危？为什么高危？应该怎么解决？**

### P2 · 守护模式说明严重缺失
左下角"守护模式"开关只有一个 hover title（还塞满术语：归属尽力推断、fetch/原始套接字…）。用户最关心的信任问题完全没有回答：
- 开启之后会怎么样？
- 关掉 DSH 后它是否还在后台偷偷运行？（事实：**不会**——它不是系统服务，DSH 进程一退出就彻底停止；这必须明说）

### P3 · 插件把自己报成高危（自伤 bug）
本插件 `lib/checks.js` 里合法使用 `child_process`（跑 icacls 查 ACL）和源码含 'curl' 字样，被自己的 exec-channel 组合规则命中。用户实测报告里 dsh-security-doctor 自己出现在高危清单——"安全医生建议你卸载安全医生"，报告可信度直接归零。

### P4 · 文档域名虚增提醒数
zod 的文档里 `example.com(×57)`、`json-schema.org(×177)` 这类规范/示例域名被当成外联信号展示，吓到用户且毫无意义。

## 三、解决方案（设计已获用户确认）

**总原则：结论前置，证据收底（三明治结构）。技术信息不删除，只是降层。**

用户已确认的两个决策：
1. 白话文案风格 = **直白带点冲击力**（先让用户警觉，再补"不等于一定在作恶"的诚实说明）
2. 文档域名降噪 = **本次一起做**

### 方案 A（对 P1）：出网扫描卡三明治渲染

| 层 | 内容 | 默认状态 |
| --- | --- | --- |
| 第一层 | critical 插件每个一块三行卡：**谁**（包名加粗）+ **为什么**（白话）+ **怎么办**（白话动作） | 直接可见 |
| 第二层 | 一行折叠条「N 个插件带提醒信号（绝大多数是正常功能）」，展开后每插件一句白话 | 折叠 |
| 第三层 | 原始 60 行清单，标注"技术明细，供专业人员核查" | 二次折叠 |
| 兼容 | 旧版本报告（无 tiers 字段）回退到现有渲染，不炸 | — |

白话对照表（已写入 checks.js 的 `COMBO_PLAIN`）：

| 组合命中 | 白话（中文） |
| --- | --- |
| cred-exfil | 同一份文件里同时出现「读密钥」和「对外发送」的代码——拼起来就是一条把你的密钥偷运出去的完整通道 |
| exec-channel | 同一份文件里同时出现「执行系统命令」和「联网下载」的代码——拼起来就能在幕后做几乎任何事 |
| persistence | 同一份文件里同时出现「写文件」和「开机自启」相关的代码——具备把自己变成常驻程序的完整链条 |

critical 卡的"怎么办"统一文案（CAVEAT + ACTION，已写入 checks.js）：
> 这是能力共现，不等于一定在作恶——但说不清来源的插件不该带这种组合。确认你认识这个插件、知道它从哪来的；说不清就卸载它。

### 方案 B（对 P2）：守护模式说明重做

1. 开关旁**常驻一行小字**（不用悬停就能看见）：
   > 仅 DSH 运行时生效 · 关闭即停 · 卸载无残留
2. 点击「这是什么？」展开白话说明卡（4 问 4 答原文已在 client.js i18n 里）：
   - 开启后做什么：① 记录哪个插件往哪个网站发请求（只记网站名，不记内容）② 配置/指令文件被改动时提醒
   - 会拖慢电脑吗？——几乎不占资源
   - 会把数据发出去吗？——不会，只存本机内存，刷新即消失
   - 关掉 DSH 后还在后台跑吗？——**不会，它不是系统服务，DSH 一关就彻底停止、不留任何残留**
   - 为什么默认关？——实验特性

### 方案 C（对 P3）：扫描排除自身，但明说而非静默

C7 出网扫描跳过 `SELF_NAME = 'dsh-security-doctor'`，并在 detail 与 tiers.selfNote 中声明："本插件自身不列入扫描（已按公开自审报告核查：仓库 docs/SELF-AUDIT.md）"。静默排除不诚实，所以必须留说明行。

### 方案 D（对 P4）：文档域名降噪

`DOC_HOST_SUFFIXES = ['example.com', 'json-schema.org', 'w3.org', 'semver.org', 'iana.org']`，按后缀匹配（覆盖子域，且先把 query 残渣切掉，如 `example.com?key=value`）。降噪域名：
- **仍保留**在第三层技术清单（标注"仅文档/示例域名（已降噪）"）
- **不再计入**外联信号（hosts 分流为 realHosts / docHosts；只有文档域名的插件按"干净"计）

## 四、如何测试

引擎侧（smoke.mjs 扩展或新增断言）：
- [ ] fixture 造一个名为 `dsh-security-doctor` 的外来插件且带组合特征 → 断言被排除、`tiers.selfNote` 非空、severity 不受它影响
- [ ] fixture 造一个只有 `https://example.com/x` 的插件 → 断言 hosts 为空、docHosts 非空、行文案为"仅文档/示例域名（已降噪）"、不计入 advisory
- [ ] fixture 造组合命中插件 → 断言 tiers.critical[0].why 是白话文案、what 含"说不清就卸载"
- [ ] detail 首行是 lead 结论行（高危时含"⚠ N 个插件命中高危组合"）

客户端侧（client.mjs 扩展）：
- [ ] 带 tiers 的 plugin-egress 卡：默认渲染 critical 三行卡（name/why/what 可见），advisory 折叠条存在且默认收起，技术清单默认不可见
- [ ] 点击 advisory 折叠条 → 展开每插件一句白话
- [ ] 点击"查看完整技术清单" → 原始行渲染（深审按钮等原有功能不丢）
- [ ] 旧格式报告（无 tiers）→ 走旧渲染不报错
- [ ] 守护模式：常驻小字文本存在；点击"这是什么？"展开 4 问 4 答卡；再点收起

全量回归：`node test/smoke.mjs && node test/host.mjs && node test/client.mjs && node test/guard.mjs && node test/watch.mjs`

## 五、预计效果

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 小白用户看到高危卡 | 60 行日志，一头雾水 | 3 张三行卡："哪个插件、为什么、怎么办"，一眼懂 |
| 想多看的用户 | 无处可看 | 提醒层一句白话 + 技术明细完整保留 |
| 看到守护模式开关 | 不知何物，不敢开/不敢关 | 常驻一句话 + 4 问 4 答，确信"关掉就不运行" |
| 报告可信度 | "安全插件自己是高危" | 自身排除并明说自审依据 |
| 提醒数字 | 被 example.com×57 虚增 | 只计真实外联，文档域名静音 |

## 六、涉及文件与关键锚点（给接手 AI）

| 文件 | 改动 |
| --- | --- |
| `lib/checks.js` | ✅ 已完成，共 5 处：① `isDocHost` + `DOC_HOST_SUFFIXES`（extractHosts 之后，~L846-858）② C7 入口自排除 `externalAll.filter(d => d.name !== SELF_NAME)`（~L931-945）③ perPlugin 的 hosts/docHosts 分流（~L1054-1057）④ 技术明细行 docHosts 分支（~L1090-1092）⑤ tiers 组装 + COMBO_PLAIN/CAVEAT/ACTION + detail lead 首行 + `extra: { perPlugin, tiers }`（~L1128-1198）。**注意**：tiers 结构 = `{ critical: [{name, why, what, files, combos}], advisory: [{name, summary}], cleanCount, opaqueCount, selfNote }` |
| `lib/client.js` | 进行中：zh i18n 词条已加（~L127-144，guardAlways/guardHelpQ1-4/egWhy/egWhat/egAdvisoryLead/egAdvisoryShow/egAdvisoryHide/egRawShow/egRawHide/egRawNote/egSelfNote）。**待做**：en 词条（en 表在 ~L185 起对应位置）、CheckCard 三明治渲染（CheckCard 函数 ~L915 起，需加 tiers 分支：critical 块 + advisory 折叠 useState + raw 二次折叠复用 expanded 状态；raw 展开时要跳过 detail 的 lead 首行与空行——lead 后跟 `\n\n` 再接清单行）、守护模式 guardbar（~L1400 附近，开关旁加常驻小字 + "这是什么？"展开卡，可复用 guardRecords 区的展开模式）、CSS 新 class（捕获的样式表里 dsd-guard 附近） |
| `test/smoke.mjs` | 待扩展（引擎断言，见第四节） |
| `test/client.mjs` | 待扩展（渲染断言，见第四节） |
| `package.json` | 版本 1.0.0 → 1.1.0 |
| `CHANGELOG.md` | 新增 1.1.0 条目（模板：搜 `## [1.0.0]`） |
| `README.md` / `README.en.md` | 核对守护模式段落（行为未变，预计只需在报告呈现处提一句"结论前置"） |

设计决策备忘（改动时别破坏）：
1. detail 文本保留完整清单（复制 Markdown / 导出 JSON 场景仍要全量信息），tiers 只是 UI 呈现层
2. 深审按钮（v0.9 功能）挂在 meta 行上——三明治渲染后 raw 层展开时必须仍能触发；critical 块建议也挂（从 `susMap[名字]` 取 entry，名字即 key）
3. 自排除用 SELF_NAME 常量（checks.js 顶部 L42 已有），别硬编码字符串
4. 白话文案已获用户风格确认，别改写成中性版

## 七、任务进度表（每完成一项打勾）

- [x] T1 · checks.js：isDocHost 降噪 + C7 自排除 + hosts 分流 + tiers 组装 + detail lead —— 已完成，`node --check` 与 smoke 通过
- [x] T1.5 · client.js zh i18n 词条（守护说明 + 三明治渲染词条）—— 已完成
- [x] T2 · client.js en i18n 词条（与 zh 一一对应，en 表 ~L185 起）—— 已完成
- [x] T3 · client.js CheckCard 三明治渲染分支 + 旧报告兼容 + critical 块深审按钮 —— 已完成（criticalBlock 挂深审按钮；advisory 折叠独立 state；raw 层复用 expanded；旧渲染分支原样保留）
- [x] T4 · client.js 守护模式常驻小字 + 「这是什么？」展开卡 —— 已完成（guardbar 加 `这是什么？` 按钮 + guardAlways 小字；guardhelp 卡 4 问 4 答）
- [x] T5 · CSS：dsd-critical / dsd-advisory 折叠条 / guard 帮助卡样式 —— 已完成（dsd-check__lead/dsd-critical*/dsd-advisory*/dsd-guardbar__always/__what/dsd-guardhelp*，遵循液态玻璃 token）
- [x] T6 · 测试：smoke.mjs 引擎断言 + client.mjs 渲染断言（清单见第四节，逐条核对覆盖：自排除+selfNote、文档域名分流+降噪行、组合白话 why/what、lead 首行、critical 三行卡默认可见、advisory 默认折叠可展开、raw 二次折叠保留深审按钮、旧格式回退、守护常驻小字+4问4答展开收起）—— 五套全绿
- [x] T7 · package.json → 1.1.0 + CHANGELOG 条目（含 compare 链接，顺手补齐 1.0.0/0.7.x 缺失引用）+ README 中英核对（结论前置一句、守护说明一句、安装 tag 全部改 #v1.1.0）
- [x] T8 · 全量回归五套测试全绿（smoke/host/client/guard/watch + node --check ×3）
- [x] T9 · 已向用户汇报；用户确认：推送 GitHub，本文档随版本入库（第八节第 1 条按此执行）

> T6 实施注记：client.mjs 现有 v0.9 断言统计 `dsd-mini--ghost` 按钮数，故"这是什么？"按钮用专属 class `dsd-guardbar__what`（虚线下划链接样式），勿改回 ghost。

## 八、完成后的收尾

1. 本文档按用户惯例属于"已执行完毕的工作文档"——用户上次把这类文档全删了。完成后询问用户：删除 / 保留本地不入库 / 入库
2. 提交信息建议：`v1.1.0: UX overhaul — conclusion-first egress report (plain-language tiers), guard-mode briefing card, self-scan exclusion, doc-host noise reduction`
