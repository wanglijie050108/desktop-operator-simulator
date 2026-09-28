# pywinauto 架构迁移评估

## 元信息

- 日期：2026-09-28
- 状态：已完成
- 环境：macOS；Node.js 24 工程依赖、.NET 10；Python/Windows 环境尚未确认

## 目标

- 梳理项目用途、现有 Node.js/C# 架构及实现边界。
- 评估引入 Python pywinauto 时复用现有系统、并行实现新 Agent、或整体重写三种方案。
- 给出可执行的分支与迁移建议，不在本任务中实施架构迁移。

## 上下文与证据

- 已阅读 `AGENTS.md` 指定的项目守卫 Skill、`README.md`、
  `docs/08-development-status.md` 和 `changelog/README.md`。
- 已完整阅读需求、架构、契约、实施计划、测试验收、技术决策和 Windows 环境文档，
  并核对最近的全项目审计与真实环境接入路线记录。
- 当前仓库已完成 Node 控制服务、Vue 管理台、SQLite、WebSocket 协议和 C# Agent
  的模拟闭环；真实 Windows UI 执行器尚未开发和验证。
- 实际代码中不存在 FlaUI、pywinauto 或其他真实桌面自动化依赖；C# Host 使用
  `PlaceholderDesktopActionExecutor`，所有桌面动作失败关闭为 `NOT_IMPLEMENTED`。
- C# 产品代码约 1277 行、测试约 979 行，主要实现语言无关协议对应的连接、心跳、
  串行派发、过期/去重、取消/急停和参数校验，不含真实微信控件定位。
- Node 控制服务产品代码约 3905 行、测试约 3343 行；连同 Vue 管理台、SQLite、
  商品排序、任务状态机和 Playwright Adapter 边界，是当前最主要的可复用资产。
- `AgentGateway.sendCommand()` 已能向指定 Agent 下发并持久化桌面命令，但生产工作流
  尚未接入它；真实 `ChatReplyAdapter` 和微信读取调度均未实现。
- WebSocket 1.0 契约是严格 JSON DTO，可由 Python 客户端直接实现；不存在必须通过
  .NET 调用的进程内接口。
- `git status --short --branch` 显示当前位于 `main`，另有一份既有未跟踪 changelog，
  本任务不修改该文件。
- `rg` 在当前 macOS 环境不可用，后续文件检索改用 `find`。

## 分析与决策

- 推荐保留 Node.js Control Server、Vue、SQLite、Playwright、共享契约和现有测试，
  新建 Python Desktop Agent 替换 C# Desktop Agent 的运行角色。
- 不建议整仓改写 Python：pywinauto 只解决 Windows UI Automation，不替代 Node
  已有的编排、Web 自动化、数据与管理界面能力，重写会扩大风险而没有验收收益。
- 不建议长期让 C# 和 Python 两个 Agent 共同执行桌面动作：当前相同 Agent ID 会互相
  替换，不同 ID 又缺少能力路由；双实现还会增加取消、急停和状态一致性复杂度。
- 迁移期可保留 C# 代码和测试作为协议行为参考，待 Python 达到契约、安全和实机验收
  等价后再决定归档或删除。该方式既满足 pywinauto 要求，也避免一次性废弃已有资产。
- 应在独立功能分支开发 Python Agent；本次仅提出建议，不创建分支或实施迁移。
- 对“逐步替换”的进一步澄清：默认目标态是 Python Desktop Agent 完全退出 C# Agent
  的生产运行链路，但不是删除或重写整个 Node.js 系统。C# 在迁移期保留为行为参考
  和回退基线，只有 Python 通过协议、可靠性、安全和 Windows 实机验收后才停止使用；
  是否从仓库删除 C# 源码可在验收后单独决定。
- 用户确认先将本评审提交到仓库实际默认分支 `main`，再建立
  `archive/csharp-agent-baseline-20260928` 存档分支和
  `feature/pywinauto-desktop-agent` 迁移分支。

## 操作记录

1. 完成项目强制启动检查并建立本任务记录。
   - 结果：成功。
   - 影响：仅新增本 changelog。
2. 核对规范、实际源码、协议、测试与依赖边界。
   - 结果：成功；确认 Python 可通过既有 WebSocket 契约替换桌面进程。
   - 影响：无产品代码改动。
3. 运行共享契约、Control Server 和 Desktop Agent Core 测试。
   - 结果：成功；分别通过 5、207、58 项测试。
   - 影响：无产品代码改动。
4. 向用户澄清渐进替换的运行态与代码保留边界。
   - 结果：最终运行态使用 Python Agent，原 Node/Web/数据库部分不替换。
   - 影响：仅更新本任务记录。
5. 核对远端分支。
   - 结果：远端不存在 `master`，`origin/HEAD` 指向 `origin/main`；按实际主分支
     `main` 执行用户要求。
   - 影响：本评审以提交 `675edee` 推送到 `origin/main`。
6. 创建并推送 C# 基线存档分支。
   - 结果：成功；`archive/csharp-agent-baseline-20260928` 固定在 `675edee`。
   - 影响：远端保留迁移前可直接回溯的 C# 版本。
7. 创建并推送 pywinauto 迁移分支。
   - 结果：成功；已切换到 `feature/pywinauto-desktop-agent` 并跟踪同名远端分支。
   - 影响：后续 Python Agent 开发将在该分支进行。

## 文件变更

- `changelog/2026-09-28-pywinauto-architecture-assessment.md`：记录本次架构评估。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git rev-parse --show-toplevel` | PASSED | 确认为当前仓库根目录。 |
| `git status --short --branch` | PASSED | 位于 `main`，识别到既有未跟踪文件。 |
| 架构与代码核对 | PASSED | 已核对主要组件、协议、Agent 实现和生产接线。 |
| `npm run test --workspace @hos/contracts` | PASSED | 5 项协议测试通过，覆盖率 100%。 |
| `npm run test --workspace @hos/control-server` | PASSED | 207 项测试通过。 |
| `dotnet test apps/desktop-agent/tests/DesktopAgent.Core.Tests/DesktopAgent.Core.Tests.csproj --no-restore` | PASSED | 58 项测试通过。 |
| `git push origin main` | PASSED | 评审提交 `675edee` 已推送至实际默认分支。 |
| 创建并推送 C# 存档分支 | PASSED | 远端分支指向 `675edee`。 |
| 创建并推送 pywinauto 迁移分支 | PASSED | 当前分支已跟踪同名远端分支。 |
| Windows/pywinauto 实机验证 | NOT_EXECUTED | 当前为 macOS，且本任务为方案评估。 |

## 问题与处理

- 现象：`rg` 命令不可用。
- 根因：当前环境未安装 ripgrep。
- 处理：使用 `find`、`grep`、`sed` 等只读工具替代。
- 结果：不影响架构评估。

## 风险与限制

- 当前没有 Windows 交互桌面，无法验证 FlaUI 或 pywinauto 的真实兼容性。
- 导师对“必须使用 pywinauto”的具体验收口径尚未写入仓库规范。
- 现有规范把 C# + FlaUI 写成固定架构；实施 Python 迁移时必须同步 README、
  `docs/02`、`docs/04`、`docs/05`、`docs/06`、`docs/07`、`docs/08` 和 CI/安装说明。
- Python 版本不能只实现 UI 点击；必须补齐现有 Agent 的严格 Schema、消息大小上限、
  心跳重连、串行执行、命令去重与过期、取消、两秒急停、双重策略和日志脱敏。
- `pywinauto` 的微信控件可访问性仍取决于目标微信版本，必须先做 Windows M0 Spike。

## 最终结果

- 推荐采用“保留 Node/TypeScript 控制平面与 Web 层，新建 Python pywinauto Desktop
  Agent，迁移期保留 C# 参考实现，Python 达到等价验收后再退役 C#”的渐进替换方案。
- 不建议整仓重写，也不建议长期并行运行两个桌面执行 Agent。
- 本评审已推送至 `main`；C# 存档分支和 pywinauto 迁移分支均已创建并推送。
- 当前位于 `feature/pywinauto-desktop-agent`，尚未实施代码迁移。
