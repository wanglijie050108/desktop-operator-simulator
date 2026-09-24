# 完成 M4 可靠性与安全（跨平台可开发部分）

## 元信息

- 日期：2026-09-24
- 状态：完成（代码与模拟验证；未 push，等待用户指示）
- 环境：macOS；Node.js（仓库要求 24 LTS）；.NET 10
- 分支：`feature/complete-m4-reliability`（基线：本地 `main` `124af0e`）

## 目标

- 在不依赖真实 Windows/微信/站点的前提下，完成 M4 中作用于跨平台核心层的工作：
  任务超时、有限重试（非幂等动作不自动重试）、取消与中断恢复、
  Control Server/Desktop Agent 双重策略校验、日志脱敏、
  截图/trace 保留与自动清理、禁止动作拦截补充。
- 所有新增能力通过单元/集成测试与 Fake 闭环验证；真实环境相关项
  （FlaUI 前台窗口校验、两秒急停实测、八小时稳定性）保持未验证。

## 上下文与证据

- 已通读：assistant/ai/product 三个工作流、TaskRepository、AgentGateway、
  CommandDispatcher、DesktopCommandValidator、AgentClient、Node 策略与商品解析器、
  根 package.json。
- 现状事实：
  - 任务状态枚举已含 INTERRUPTED，但无任何代码写入该状态。
  - 工作流仅靠 AbortController 响应取消，无超时；任务创建后进程崩溃会留下
    RUNNING/PLANNED/RECEIVED 孤儿任务。
  - Adapter 调用无重试；step 表有 attempt 列但 startStep 固定写 1。
  - Agent 侧仅校验结构/过期/去重/急停，无独立动作允许清单，也不限制命令有效期上限。
  - 两侧日志均无脱敏（C# 仅截断长度）。
  - 无截图/trace 保留清理机制。

## 分析与决策

- 超时：按任务类型固定上限（AI 90s、商品 120s），WAITING_FOR_HUMAN/INPUT
  不计时。工作流内部 setTimeout 触发 abort（TimeoutError），TaskReaper
  周期扫描兜底；两者共用纯函数 isTaskTimedOut。
- 启动恢复：reaper 在启动时将活动执行态（RECEIVED/PLANNED/RUNNING）置为
  INTERRUPTED，不自动重放（AT-12 要求不自动重复发送）。提供显式
  POST /tasks/:id/recover，由管理员决定重跑，生成新任务。
- 重试：仅对只读幂等操作（ai.ask、product.open/search/extract）且仅对瞬时错误码
  （ADAPTER_TIMEOUT/NETWORK_ERROR/TEMPORARY_UNAVAILABLE/SERVICE_UNAVAILABLE），
  最多 2 次尝试，指数退避；chat.send 不重试。每次重试递增 step attempt。
- Agent 双重策略：新增 AgentCommandPolicy（C# Core），独立动作允许清单
  （AGENT_ALLOWED_ACTIONS，默认全部六个）和命令有效期上限（默认 10 分钟），
  在去重登记前执行。
- 日志脱敏：两侧各实现 redactor（手机/卡号长数字保留后四位、邮箱、URL 凭据、
  key=value 密钥）；Node 侧另提供递归 redactValue 按敏感键整体遮蔽。
- Artifact：纯函数 selectArtifactsForRemoval（先按年龄、再按总量最旧优先），
  ArtifactCleanupService 周期扫描配置目录并删除，目录缺失即 no-op。
- 范围外：FlaUI 前台窗口校验、两秒急停实测、八小时稳定性、真实页面变化诊断。

## 操作记录

1. 提交路线澄清并创建分支。
   - 结果：成功。
2. 实现 Node 域层：redaction、retry-policy、task-timeout、artifact-retention。
   - 结果：成功，类型检查一次通过。
3. 实现应用层：task-reaper、artifact-cleanup，并接入两个工作流
   （setTimeout abort、retry.execute、bumpStepAttempt、timeout）。
   - 结果：成功。
4. 实现 C# Core：AgentCommandPolicy、LogRedactor；接入 CommandDispatcher、
   Program（AGENT_ALLOWED_ACTIONS）和 AgentClient 诊断输出。
   - 结果：成功。
5. 扩充禁止动作模式（下单/发红包 + 5 个英文模式）与 recover 路由。
   - 结果：成功。
6. 修复 4 项初始失败测试；补齐 task-timeout/task-reaper/assistant-workflow 等
   专项测试使覆盖率回到门槛之上；多轮修复 prettier/eslint/typecheck 问题。
   - 结果：成功。
7. 更新 `docs/08-development-status.md`。
   - 结果：成功。

## 文件变更

新增（Node control-server）：

- `src/domain/redaction.ts`：redactText/redactValue/redactError。
- `src/domain/retry-policy.ts`：操作白名单 + 瞬时错误码 + 指数退避重试。
- `src/domain/task-timeout.ts`：TASK_TIMEOUT_MS、ACTIVE_EXECUTION_STATES、
  isTaskTimedOut。
- `src/domain/artifact-retention.ts`：selectArtifactsForRemoval。
- `src/application/task-reaper.ts`：启动中断恢复 + 周期超时扫描。
- `src/application/artifact-cleanup.ts`：周期产物清理服务。
- `test/redaction.test.ts`、`test/retry-policy.test.ts`、
  `test/artifact-retention.test.ts`、`test/task-timeout.test.ts`、
  `test/task-reaper.test.ts`、`test/assistant-workflow.test.ts`。

新增（C# DesktopAgent.Core）：

- `AgentCommandPolicy.cs`：动作白名单与命令有效期上限。
- `LogRedactor.cs`（新文件）：邮箱/URL 凭据/密钥赋值/长数字脱敏。
- `tests/DesktopAgent.Core.Tests/AgentCommandPolicyTests.cs`、`LogRedactorTests.cs`。

修改（Node）：

- `src/app.ts`：装配 RetryPolicy/TaskReaper/ArtifactCleanupService；
  新增 `POST /api/v1/tasks/:taskId/recover`；启动恢复扫描与启动清理；
  preClose 关闭新服务。
- `src/application/assistant-workflow.ts`：timeout、recoverTask 及重放合成。
- `src/application/ai-question-workflow.ts`、`product-search-workflow.ts`：
  超时计时器、retry.execute、attempt 递增、timeout、TASK_TIMED_OUT 映射。
- `src/application/agent-gateway.ts`：错误日志改用 redactError。
- `src/infrastructure/database/task-repository.ts`：bumpStepAttempt。
- `src/domain/ai-question-command.ts`：禁止动作模式 4 → 10 个。
- `src/adapters/adapter-error.ts`：新增 4 个瞬时错误码。
- `src/config.ts`、`src/server.ts`：产物与 reaper 配置项。
- `test/config.test.ts`、`test/app.test.ts`、
  `test/ai-question-command.test.ts`、`test/ai-question-workflow.test.ts`、
  `test/product-search-workflow.test.ts`。

修改（C#）：

- `CommandDispatcher.cs`：过期检查后调用 AgentCommandPolicy。
- `AgentClient.cs`：FormatDiagnostic 先经 LogRedactor。
- `Program.cs`：解析 AGENT_ALLOWED_ACTIONS 并传入 dispatcher。

文档：

- `docs/08-development-status.md`：M4 跨平台部分完成，真实环境项保持未验证。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| 分支创建 | PASSED | `feature/complete-m4-reliability` 已切换。 |
| `npx vitest run`（control-server） | PASSED | 189/189。 |
| 覆盖率门槛 | PASSED | 语句 94.04%、分支 89.84%、函数 91.24%、行 94.35%（门槛 90/85/90/90）。 |
| `npm run check:node` | PASSED | format/lint/typecheck/test/build 全部通过。 |
| `npm run check:dotnet` | PASSED | format 验证、build 0 警告 0 错误、55/55 测试通过。 |
| `npm run test:integration:m1` | PASSED | Agent 重连集成 `result: passed`。 |

## 问题与处理

- C# LogRedactor 邮箱替换最初引用 Groups[1]（本地部分），应为 Groups[2]（域名）。
- URL 凭据替换最初拼出双斜杠（组1已含 `://`），改为 `$1[REDACTED]@`。
- C# Secret 正则最初无捕获组，补齐组1。
- 脱敏替换顺序确定为 email → URL 凭据 → secret → 长数字，避免遮蔽后二次匹配。
- JS 的 `\b` 即使在 u 标志下仍按 ASCII 单词判定，中文密钥名（如“密钥=abc123”）
  不匹配；两侧统一改为 `(?<![A-Za-z0-9_])` lookbehind，规则真正对齐。
- 英文凭据模式不支持 “send me the cookies”（中间有 the），模式补入
  `(?:the\s+)?`。
- 新测试 seeding 时 shortCode 重复触发 UNIQUE 约束，改为从随机 id 派生。
- recover 路由测试最初使用持续失败的适配器，改为先失败一次、重放成功。

## 风险与限制

- 无真实 Windows 环境，M4 退出验收不可达成；FlaUI 前台校验、两秒急停和
  八小时稳定性仅能用真实环境验证。
- 重试退避 sleep 未接入 AbortSignal；默认配置下取消最多多等一个退避间隔
  （500ms），下一次 attempt 会因已 abort 立即失败，后续真实适配器接入时
  可再评估。
- 所有真实适配器保持失败关闭默认。

## 最终结果

- M4 跨平台可开发部分全部完成：超时、有限重试、取消/中断恢复、双重策略、
  日志脱敏、产物保留清理和禁止动作扩充。
- 完整 `npm run check` 通过：Control Server 189 项、契约 5 项、C# 55 项测试
  及 M1 集成。
- 改动尚未提交、未 push，等待用户指示。
