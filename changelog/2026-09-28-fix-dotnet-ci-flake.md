# 调查主分支 .NET CI 失败

## 元信息

- 日期：2026-09-28
- 状态：已完成
- 环境：macOS；GitHub Actions Windows Server 2025、.NET SDK 10.0.401

## 目标

- 定位提交 `96a589d` 的 `.NET quality checks` 失败根因，提出最小修复和验证方案。

## 上下文与证据

- GitHub Actions 运行 `36376125978` 中，Node quality checks 成功，.NET quality
  checks 在 Test 步骤失败。
- .NET restore、format 和 build 均成功且无警告；58 个测试中 57 个通过。
- 唯一失败测试为
  `AgentClientTests.EmergencyStopFrameInterruptsCommandAndRejectsFollowUp`：
  `AgentClientTests.cs:104` 期望输入释放调用次数为 1，实际为 0。
- 提交 `96a589d` 只修改项目 Skill 和 changelog，不包含 C# 运行时代码。
- 前一主分支提交 `675edee` 的同一 CI workflow 成功。

## 分析与决策

- 已确认是既有测试同步竞态，而不是提交 `96a589d` 的行为回归：
  `CommandDispatcher.EmergencyStopAsync` 先取消活动命令，再调用执行器输入释放；
  命令 worker 可在输入释放调用前发送 `TASK_CANCELLED` 结果。
- 测试收到活动命令结果后立即读取 `EmergencyStopCount`，错误地把命令取消结果当成
  输入释放完成信号；Windows CI 本次调度恰好暴露该窗口。
- 生产代码顺序符合先中断活动命令、再执行两秒输入释放的安全设计，不应为满足测试
  而串行阻塞命令结果发送。
- 最小修复应只增强测试执行器同步：增加 `EmergencyStopObserved`
  `TaskCompletionSource`，在执行器计数后置为完成，测试显式等待该信号后再断言。
- 按 GitHub CI 修复流程，先向用户报告根因和最小方案，获得确认后再实施。

## 操作记录

1. 验证 GitHub CLI 登录并查询提交 Check Runs。
   - 结果：成功；定位 workflow run、失败 job 和日志。
   - 影响：只读。
2. 提取 `.NET quality checks` 完整日志。
   - 结果：成功；确认唯一失败断言及其源码位置。
   - 影响：只读。
3. 创建独立 `main` worktree 和本任务记录。
   - 结果：成功；不影响当前功能分支工作区。
   - 影响：新增本文件。
4. 阅读失败测试、`AgentClient`、`CommandDispatcher` 和原始取消修复记录。
   - 结果：成功；确认命令结果与输入释放在两个并发任务中完成。
   - 影响：只读。
5. 在 macOS 运行单个失败测试。
   - 结果：成功；测试通过，进一步证明该问题依赖调度时序而非确定性回归。
   - 影响：仅生成被 Git 忽略的 .NET 构建产物。
6. 向用户报告根因和最小测试同步方案。
   - 结果：成功；用户明确确认实施。
   - 影响：进入测试代码修改与验证阶段。
7. 为受控测试执行器增加 `EmergencyStopObserved` 完成信号。
   - 结果：成功；测试在读取计数前显式等待输入释放调用发生。
   - 影响：仅修改 `AgentClientTests.cs`，生产代码不变。
8. 复刻 .NET CI 的 restore、format、build 和完整 test 门禁。
   - 结果：成功；构建 0 警告、0 错误，58/58 测试通过。
   - 影响：验证测试同步修改未破坏其他 .NET 行为。
9. 对目标急停测试执行 20 次重复压力验证和第二遍并发审查。
   - 结果：成功；20/20 通过，完成信号在计数更新后发布，不会掩盖未调用或重复调用。
   - 影响：为时序修复提供聚焦证据。
10. 提交并推送最小修复到 `main`，跟踪新的 GitHub Actions 运行。
    - 结果：成功；Node 和 .NET quality checks 均通过。
    - 影响：主分支 CI 恢复为绿色。

## 文件变更

- `apps/desktop-agent/tests/DesktopAgent.Core.Tests/AgentClientTests.cs`：使用明确完成
  信号消除急停测试的跨任务竞态。
- `changelog/2026-09-28-fix-dotnet-ci-flake.md`：记录 CI 调查、决策与后续验证。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `gh auth status` | PASSED | GitHub CLI 已认证 |
| Check Runs API | PASSED | Node 成功，.NET 失败 |
| `gh run view 36376125978 --job 108782216380 --log` | PASSED | 获取完整失败日志 |
| 聚焦 `dotnet test` | PASSED | macOS 上 1/1 通过；与 Windows 偶发失败共同证明时序竞态 |
| .NET restore/format/build/test | PASSED | 0 警告、0 错误，58/58 测试通过 |
| 急停测试重复 20 次 | PASSED | 20/20 通过 |
| `git diff --check` | PASSED | 未发现空白错误 |
| GitHub Actions 复验 | PASSED | 新提交的 Node 和 .NET quality checks 均通过 |

## 问题与处理

- 现象：`gh run list --commit 96a589d` 未返回运行记录。
- 根因：该查询未使用完整提交 SHA 或当前 `gh` 版本未匹配短 SHA。
- 处理：改用提交 Check Runs API 和 `main` 最近运行列表交叉定位。
- 结果：成功定位 run `36376125978` 和 job `108782216380`。

## 风险与限制

- macOS 无法等价复现 Windows 调度时序；可执行跨平台 .NET 聚焦测试，但最终需由
  Windows GitHub Actions 验证。
- 该测试覆盖协议与调度层；真实 Windows 输入释放仍需按项目验收计划实机验证。

## 最终结果

- 已完成：测试同步竞态已修复，本地完整 .NET 门禁、20 次聚焦重复和 Windows
  GitHub Actions 均通过；生产代码未修改。
