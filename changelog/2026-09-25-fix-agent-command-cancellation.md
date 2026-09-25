# 修复 H1：命令执行期间取消/急停无法送达 Agent

## 元信息

- 日期：2026-09-25
- 状态：已完成
- 环境：macOS；Node.js 24.21.0（仅用于集成测试）；.NET 10.0.401
- 分支：`fix/agent-cancel-during-execution`（基线：`main` `602a6eb`）

## 目标

- 修复全项目通查发现的高危问题 H1：`AgentClient` 接收循环与命令派发串行，
  桌面动作执行期间 `task.cancel` / `system.emergency-stop` 帧无法被读取，
  导致任务取消与紧急停止不能中断在执行的动作。
- 保持原有语义不变：单 Agent 命令串行执行；取消的命令回送
  REJECTED/TASK_CANCELLED；急停后新命令被拒绝、心跳转 PAUSED。
- 增加能复现该缺陷的自动化测试（阻塞执行器 + 执行中到达取消帧）。

## 上下文与证据

- 详见通查记录 `changelog/2026-09-25-full-project-audit.md` 的 H1 条目。
- `CommandDispatcher` 已具备活动命令登记与 linked CTS 取消机制并有单测，
  缺陷仅在 `AgentClient` 的接线层：`ReceiveLoopAsync` 在 `HandleCommandAsync`
  （含 `DispatchAsync` 全程）完成前不会发起下一次接收。

## 分析与决策

- 采用"接收与执行解耦"方案：
  - 接收循环只负责持续排空服务端帧：桌面命令写入 unbounded `Channel`，
    控制帧（cancel/emergency/error）立即处理。
  - 新增单一命令 worker 循环从 Channel 读取并执行，天然保持"单 Agent 串行"。
  - 会话结束（socket 关闭）时：取消 session token（中断在执行命令）、
    完成 Channel（不再有新命令）；命令结果若此时 socket 已关闭则不再回送。
- 备选方案（在派发循环中用 `Task.WhenAny` 并发接收）被否决：手写 per-command
  接收状态机易出错，且无法保证取消帧按到达顺序即时处理。

## 操作记录

1. 从 `main` `602a6eb` 创建 `fix/agent-cancel-during-execution`。
   - 结果：成功。
2. 创建本 changelog 记录。
   - 结果：成功。
3. 重构 `AgentClient`：接收循环持续排空，桌面命令入 unbounded `Channel`，
   新增单一命令 worker 串行消费；取消/急停帧在接收循环中立即处理。
   - 结果：成功。
4. 先用 spike 验证 macOS 下 `HttpListener.AcceptWebSocketAsync` 可用（端口由
   `TcpListener(0)` 探测），再新建 `AgentClientTests`，3 个场景：成功命令、
   执行中 cancel（断言 <2 秒到达执行器）、执行中 emergency-stop + 后续命令
   被 POLICY_DENIED 拒绝。
   - 结果：成功。
5. 回归验证：暂存本次修改使工作区回到旧实现后运行新测试，3 项全部失败
   （cancel/emergency 15 秒超时，成功项在清理阶段抛 TaskCanceledException）；
   恢复新代码后 3 项全部通过。
   - 结果：成功，证明测试确能复现缺陷。
6. 更新 `docs/08-development-status.md` 并运行完整 `npm run check`。
   - 结果：成功。

## 文件变更

- 修改：`apps/desktop-agent/src/DesktopAgent.Core/AgentClient.cs`
- 新增：`apps/desktop-agent/tests/DesktopAgent.Core.Tests/AgentClientTests.cs`
- 修改：`docs/08-development-status.md`（M4 条目、可靠性结论、测试计数、日期）

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| 分支创建 | PASSED | 已切换到修复分支。 |
| 旧实现上运行新测试 | FAILED（预期） | 3/3 失败：取消类超时、清理阶段异常。 |
| `dotnet format --verify-no-changes` | PASSED | 无格式差异。 |
| `dotnet build` | PASSED | 0 警告 0 错误（TreatWarningsAsErrors）。 |
| `dotnet test`（全量） | PASSED | 58/58 通过（原 55 + 新增 3）。 |
| `npm run check`（Node 24.21.0） | PASSED | Node 格式/ESLint/类型/单测/构建、.NET 全门、M1 集成测试均通过。 |

## 问题与处理

- 测试首跑时发现相关潜伏缺陷：`RunAsync` 的重连退避 `Task.Delay` 在
  try-catch 之外，外部 token 取消（包括"会话因取消而正常结束后"落到退避）
  时 `TaskCanceledException` 逃逸出 RunAsync。处理：退避前先检查 token，
  退避本身包 try/catch OCE；该缺陷在旧代码上同样存在，一并修复。

## 风险与限制

- 真实 FlaUI 执行器尚未接入；本修复在跨平台层面保证取消帧能即时中断
  dispatcher，真实执行器仍需自己尊重 CancellationToken 并在 2 秒内释放输入。
- 命令队列采用 unbounded `Channel`：在服务端高频下发、长命令执行时理论上
  无背压上限；但命令在派发时统一做有效期/策略校验（过期命令被拒绝），
  且威胁模型中服务端为回环可信对端，按既有决策接受。

## 最终结果

- H1 已修复：命令执行期间接收循环不再被阻塞，`task.cancel` /
  `system.emergency-stop` 帧到达后立即取消活动命令的 linked CTS，执行器
  token 毫秒级取消，结果按 REJECTED/TASK_CANCELLED（急停后新命令
  POLICY_DENIED）回送；单 Agent 串行执行语义不变。
- 全部门验证通过（.NET 58 项、Node 全量与 M1 集成）。
- 已提交并以 `--no-ff` 合并入 `main`，修复分支保留不删除。
