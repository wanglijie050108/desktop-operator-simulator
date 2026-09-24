# 修复 GitHub CI 干净检出失败

## 元信息

- 日期：2026-09-24
- 状态：已完成
- 环境：macOS；项目基线 Node.js 24 LTS、npm 11、.NET 10
- 分支：`fix/github-ci-clean-checkout`

## 目标

- 修复干净 GitHub Actions 环境中的 Node 类型解析和 Windows 行尾格式失败。
- 在独立 worktree 中完成修改、验证、提交和推送，不改动 M3 工作区。

## 上下文与证据

- 已阅读项目守卫 Skill、GitHub CI 修复 Skill、README、开发状态、changelog 规范、
  M2 交付记录、质量脚本和 CI workflow。
- `main` 的 Actions run `35962352887` 与 `35962394466` 均失败。
- Node job 在 ESLint 阶段报告 116 个类型解析错误；`@hos/contracts` 的 types export
  指向被忽略且在 lint 前未构建的 `dist/index.d.ts`。
- Windows job 在 `dotnet format --verify-no-changes` 阶段报告大量 `ENDOFLINE`；
  `.editorconfig` 要求 LF，但仓库没有 `.gitattributes` 固定 checkout 行尾。
- 当前修复使用独立 worktree，原 M3 分支和未提交文件保持隔离。

## 分析与决策

- 在 `lint` 脚本中先构建 `@hos/contracts`，确保该独立质量命令在干净检出中也满足
  自身类型依赖，不依赖本地残留构建产物。
- 使用 `.gitattributes` 的 `* text=auto eol=lf` 统一跨平台文本检出规则，并保留 Git
  对二进制文件的自动识别。
- 不修改业务代码、契约、M3 文件或开发状态；本任务只修复工程质量门。

## 操作记录

1. 从最新 `origin/main` 创建独立 worktree 和修复分支。
   - 结果：成功。
   - 影响：M3 工作区未被修改。
2. 增加跨平台 LF Git 属性，并让 lint 自行构建 contracts 声明。
   - 结果：成功。
   - 影响：修复 Windows checkout 行尾和干净 Node 环境类型解析。
3. 在无 `node_modules`、无 contracts `dist/` 的 worktree 使用 Node 24 执行干净安装
   和完整质量门。
   - 结果：成功。
   - 影响：Node、.NET、构建、测试和 Agent 重连均通过。
4. 执行 Operator Web Playwright 桌面与移动视口测试。
   - 结果：成功。
   - 影响：CI 中独立的 Web UI 测试步骤已在本地覆盖。
5. 提交并推送修复分支，创建 PR #2 触发 GitHub Actions。
   - 结果：成功。
   - 影响：Node 和 Windows .NET jobs 均在干净 runner 中通过。
6. 同步开发状态中的 GitHub Actions 实际验证结果。
   - 结果：成功。
   - 影响：M1 剩余验收不再包含已完成的 CI 确认项。

## 文件变更

- `changelog/2026-09-24-fix-github-ci.md`：记录修复、验证和发布结果。
- `.gitattributes`：对自动识别的文本文件强制使用 LF 检出。
- `package.json`：lint 前构建 `@hos/contracts`，消除未声明的本地构建产物依赖。
- `docs/08-development-status.md`：记录 Node 和 Windows .NET GitHub Actions 已通过。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| 修复 worktree 初始 `git status --short --branch` | PASSED | 分支从 `origin/main` 创建且工作树干净。 |
| Node 24.21.0 `npm ci && npm run check` | PASSED | 71 项服务测试、5 项契约测试、37 项 .NET 测试、全部构建和 Agent 重连通过。 |
| `git check-attr text eol -- ...` | PASSED | JSON、C# 等文本文件均解析为 `text=auto`、`eol=lf`。 |
| Node 24.21.0 `npm run test:ui:m2` | PASSED | 2 项 Playwright 测试通过。 |
| `git diff --check` | PASSED | 修复 diff 无空白错误。 |
| PR #2 GitHub Actions run `35963514052` | PASSED | Node quality checks 和 Windows .NET quality checks 均通过。 |

## 问题与处理

- 现象：干净 CI 中 Node lint 和 Windows .NET format 失败。
- 根因：contracts 声明未在 lint 前构建；Windows checkout 行尾未固定为 LF。
- 处理：新增 LF Git 属性，并在 lint 前构建 contracts 声明。
- 结果：本地完整质量门、UI 测试和 GitHub Actions 均已通过。

## 风险与限制

- 本次验证覆盖 GitHub Windows runner，但不替代目标 Windows 实机的桌面自动化验收。

## 最终结果

- 干净 Node checkout 的类型解析和 Windows checkout 的行尾问题均已修复。
- 修复分支已推送，PR #2 的 Node 与 Windows .NET GitHub Actions 均通过。
- 原 M3 分支和未提交工作区未被修改。
