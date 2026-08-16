# 发布清单（每次发版照此执行，防漏）

> 由 v0.3.0（反馈 V5）固化。目标：每个版本 **可复现（tag 指向确定 commit）、可对账（CHANGELOG/Release/diff/SHA 齐全）、可回退（用户改回旧 tag 即可）**。

## 发版步骤

1. **测试全绿**：`node test/smoke.mjs && node test/host.mjs && node test/client.mjs`
2. **版本号**：改 `package.json` 的 `version`（semver：bug 修复 patch / 新功能 minor / 破坏性 major；0.x 阶段 minor 可含行为变化，须在 CHANGELOG 写明）
3. **CHANGELOG.md**：新增本版条目——变更摘要（新增/变更/修复）+ **实测 harness 版本 × OS 矩阵**（在哪台环境实测就写哪台，不写"应该兼容"）
4. **全文扫旧版本号**：`grep -rn "v0\.[0-9]\+\.[0-9]\+" README.md README.en.md docs/ test/ package.json`，确认安装命令、self-test 示例输出、兼容矩阵等处都已指向新版本（历史条目如 CHANGELOG/反馈存档除外）
5. **提交**：commit 信息以版本号开头（如 `v0.3.0: …`）
6. **打 annotated tag**：`git tag -a vX.Y.Z -m "dsh-security-doctor vX.Y.Z"`
7. **推送**：`git push origin main --tags`
8. **建 GitHub Release**（tag 必须已推送）：
   ```bash
   SHA=$(git rev-parse "vX.Y.Z^{commit}")
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <notes>
   ```
   Release 正文五要素：
   - 变更摘要（与 CHANGELOG 该版条目一致，可链接过去）
   - **diff 链接**：`https://github.com/ChenChen913/dsh-security-doctor/compare/v上一版...vX.Y.Z`
   - **tag commit SHA**（`git rev-parse` 输出，供用户核对安装内容）
   - **实测 harness × OS 矩阵**
   - 安装 / 更新 / 回退命令（带 `#vX.Y.Z`）
9. **回填验证**：Releases 页五要素齐全；`CHANGELOG 版本 ↔ git tag ↔ Release` 三者一一对应无缺版

## 待办（有凭据后）

- **npm 发布**（反馈 V6）：`npm publish` 后 README 安装节启用 npm 位，获得 semver 升级语义、dist-tags（beta 通道）、精确回退；有条件接入 npm provenance 签名。发布后此清单第 6–8 步补充 `npm publish --tag` 步骤。

## 历史补录（2026-08-16）

v0.1.0 – v0.2.1 发布时本清单尚不存在：v0.1.0 曾漏打 tag、各版均无 Release。当日已补齐（v0.1.0 补 tag；三个版本补 Release，内容按 CHANGELOG 回填）。自 v0.3.0 起严格按本清单执行。
