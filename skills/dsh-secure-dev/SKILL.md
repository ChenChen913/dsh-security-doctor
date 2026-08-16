---
name: dsh-secure-dev
description: Security bottom lines for developing your own DSH plugin, plus a pre-publish self-review checklist. Use when writing, reviewing, or hardening a DeepSeek Harness plugin.
---

# DSH 插件安全开发底线

自己开发 DSH 插件时遵守以下十条；也可把本技能连同你的插件代码交给 AI，按文末清单逐条 review。完整版见仓库 docs/guide-secure-development.md。

## 十条底线

1. **最小权限**：inject 的每个服务、注册的每个路由、读的每个目录都是功能必需；能不用 `danger-full-access` 就不用；需要高权限必须在 README 显著说明。
2. **禁止分发 `!!js`**：cordis yml 里的 `!!js` 在用户机加载时求值，分发物里出现即越界；可配置需求用声明式字段。
3. **不碰安全层**：patch 不 replace/覆盖 approval、permission*、sandbox 行，不调松默认策略；让用户显式选择。
4. **网络出口最小化**：默认不出网；必须出网则域名固定且写进 README，绝不发送凭据、环境变量、会话内容、用户文件；遥测默认关闭。
5. **凭据纪律**：不直接读 .credentials.yaml/.env/环境变量中的 KEY/TOKEN/SECRET，复用官方 credentials/llm 服务；日志脱敏，任何凭据值不落 console/会话/报告。
6. **路由与输入安全**：校验方法；不把请求参数拼进命令或路径（白名单前缀+规范化）；响应不含凭据/会话正文/任意文件内容；破坏性路由加确认或一次性令牌。
7. **副作用可逆**：注册走 ctx.effect/返回 dispose；不留样式、定时器、监听器、全局变量；文件只写声明目录；卸载恢复原状。
8. **不带安装期脚本**：无 preinstall/postinstall/prepare；首选无构建分发（产物入库，`node --check` 可验）或可复现构建。
9. **依赖卫生**：依赖最小化；git 依赖锁定 commit；升级看 diff；防 typosquat。
10. **透明一致**：README 写数据流三问——读什么、写什么、发什么；声明之外的行为（含 bug 导致）都算缺陷。

## 发布前自查清单

- [ ] 分发物内 `grep -r "!!js"` 无命中
- [ ] scripts 无 install/prepare 族
- [ ] patch 无 replace 安全行
- [ ] 全部网络出口域名已写入 README 且不携带凭据/会话/文件
- [ ] 无 env KEY/凭据文件直接读取；日志脱敏
- [ ] webServer 路由方法校验、无参数拼接、响应无敏感内容
- [ ] 无 eval/new Function/vm.Script
- [ ] effect/dispose 成对；文件写入仅声明目录
- [ ] git 依赖锁定 commit；依赖最小
- [ ] README 数据流三问 + 安装/卸载/权限说明齐全
