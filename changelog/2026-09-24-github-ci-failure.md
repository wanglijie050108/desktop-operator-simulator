# GitHub CI 失败排查

## 元信息

- 日期：2026-09-24
- 状态：已完成
- 环境：macOS；GitHub CLI 已认证；当前分支 `feature/complete-m3-product-search`

## 目标

- 定位 GitHub 提交后的失败环节和根因，明确是否需要修改代码或 CI 配置。

## 上下文与证据

- 已阅读项目守卫 Skill、README、开发状态、changelog 规范和当前 M3 任务记录。
- 当前工作区包含未提交的 M3 开发改动，本次排查不回退或覆盖这些改动。
- GitHub CLI 已登录，HTTPS 远端配置正常。
- `main` 的提交 `570923b` 已成功推送，但对应 CI run `35962352887` 失败。
- 合并提交 `d9b5647` 对应的新 CI run `35962394466` 也已失败。
- 当前功能分支没有关联 PR，因此按 push 触发的 workflow run 排查。
- Node job 在 `npm run check:node` 的 ESLint 阶段报告 116 个类型解析连锁错误。
- `@hos/contracts` 的 package exports 指向 `dist/index.d.ts`，但 `dist/` 被 Git 忽略；
  CI 干净环境执行 lint 前没有构建该 workspace。
- Windows job 在 `dotnet format --verify-no-changes` 阶段对全部 C# 文件报告
  `ENDOFLINE`，要求把 CRLF 改为 LF；仓库规定 LF，但缺少强制 checkout 行尾的
  `.gitattributes`。

## 分析与决策

- 现有证据表明问题位于 GitHub Actions，而非本地 Git 提交或推送认证。
- Node 根因是质量脚本顺序依赖本地残留的 contracts 构建产物。最小修复是在 lint 前
  显式构建 `@hos/contracts`，使本地和干净 CI 行为一致。
- .NET 根因是 Git Windows checkout 行尾转换。最小修复是新增 `.gitattributes`，
  对文本文件统一 `eol=lf`，避免平台相关检出结果。
- 按 GitHub CI 修复流程，本轮先报告根因和方案，等待用户确认后再实施和提交。

## 操作记录

1. 检查仓库、远端、GitHub CLI 认证、当前 PR 和最近 workflow runs。
   - 结果：成功。
   - 影响：锁定一个失败 run 和一个运行中 run，未修改业务代码。
2. 读取两个失败 run 的 job 状态和失败日志。
   - 结果：成功。
   - 影响：确认 Node 与 .NET 两个 job 均为确定性配置问题。
3. 核对 contracts package exports、被忽略的 `dist/`、行尾配置和 CI 执行顺序。
   - 结果：成功。
   - 影响：形成两个聚焦修复项，未修改当前 M3 代码。

## 文件变更

- `changelog/2026-09-24-github-ci-failure.md`：记录本次 GitHub CI 排查证据和结论。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git status --short --branch` | PASSED | 当前为 M3 功能分支，已有未提交开发改动。 |
| `gh auth status` | PASSED | GitHub CLI 已认证，具备仓库读取权限。 |
| `gh pr view --json ...` | FAILED | 当前分支没有关联 PR；改按 push workflow run 排查。 |
| `gh run list --limit 10 --json ...` | PASSED | 发现 `main` 上一个失败 run 和一个运行中 run。 |
| `gh run view 35962352887 --log-failed` | FAILED | CI 的 Node lint 与 Windows .NET format job 均失败。 |
| `gh run view 35962394466 --json ...` | FAILED | 新合并 run 以相同两个原因失败。 |
| `git ls-files --eol '*.cs' ...` | PASSED | Git 索引和 macOS 工作区为 LF，Windows checkout 转换导致 CI 差异。 |

## 问题与处理

- 现象：提交已到达 GitHub，但 CI 显示失败。
- 根因：Node lint 在 contracts 声明构建前运行；Windows checkout 未通过
  `.gitattributes` 固定 LF。
- 处理：已提出先构建 contracts 和新增 LF 属性文件的最小修复方案。
- 结果：根因已定位，等待用户批准实施。

## 风险与限制

- 当前 GitHub token 未显示 `workflow` scope，但只读查询已可用；本次不修改 workflow。
- 尚未执行修复和修复后 CI；当前结论基于两个独立 push run 的相同失败日志。

## 最终结果

- Git 推送和 GitHub 认证正常；失败发生在 GitHub Actions。
- 两个失败根因及最小修复方案均已确认，未修改业务代码或当前 M3 开发内容。
