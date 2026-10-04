# pywinauto 迁移启动与全项目审计收口（2026-09-25 ~ 2026-09-28 合并摘要）

> 本文件合并自 8 条原始 changelog（原文件名见文末索引）。原文可用
> `git show <commit>:changelog/<原文件名>` 找回。

## 阶段目标

- 拉取 `main`（无 `master`）并三重只读确认：全项目通查 → 复核 H1 修复 → 逐行精读 + Node/C# 双审查代理 + 竞态实证。
- 修复 H1：动作执行期间 `task.cancel` / `system.emergency-stop` 帧送不到 Agent。
- 评估 pywinauto 迁移三方案，产出七阶段计划与第一阶段 Python 骨架。
- 质量证据闭环入主 Skill；归档遗留 changelog；修复 .NET CI flake。

## 关键决策与依据

- H1 根因与修复：`AgentClient.ReceiveLoopAsync` 在 `HandleCommandAsync` 完成前不发起下一次接收，使 `CommandDispatcher` 的 linked CTS 取消被接线架空 → 改为接收/执行解耦（接收循环持续排空帧，桌面命令入 unbounded `Channel` 由单一 worker 串行消费，控制帧即时处理），否决 `Task.WhenAny` 并发接收；语义不变（单 Agent 串行、取消回 `REJECTED`/`TASK_CANCELLED`、急停后新命令 `POLICY_DENIED` 且心跳 PAUSED）；顺带修复 `RunAsync` 退避 `Task.Delay` 在 try/catch 外致 `TaskCanceledException` 逃逸。
- 审计定性：占位执行器 + 模拟适配器形态无正在发生的恶性故障，门禁全绿；分级 H1 高、M1–M3 中、L1–L4 低。
- 中危三项：M1 `command-repository.ts` 的 `complete()` 只匹配 `PENDING`、不校验 `expiresAt` 且无过期扫描（Agent 端 10 分钟 TTL 成唯一执行点，应加 `expires_at > now`）；M2 `WAITING_FOR_HUMAN` 时活动步骤留 RUNNING（时间线误显"执行中"）；M3 本地变更端点无鉴权、WS 无 Origin 校验 → 可 CSRF 急停/取消、冒名注册踢掉真实 Agent，进真实环境前先加 Origin 白名单。
- H2 竞态（三重确认实证）：`CommandDispatcher` 的 Cancel/EmergencyStop 锁内快照 CTS、锁外 `Cancel()`，`DispatchAsync` finally 锁内 Remove、锁外 Dispose（TOCTOU）；生产精确形态 1,000,000 次复现 37 次，加宽窗口 200,000 次复现 274 次；`ObjectDisposedException` 穿透 WhenAll 的 OCE 过滤 → 取消帧被误记"连接故障"重连，急停路径跳过 `executor.EmergencyStopAsync` 物理释放、首个 ODE 即中止 foreach。
- 修复顺序：H2 → M3 Origin 收口 → M1/M2 → 关闭与急停接线（`ResetEmergencyStop()` 仅测试调用、急停 latch 无复位入口、`cancelledTasks` 无界跨重连、`EmergencyStopAsync` 忽略 session token）；另驳回"EMAIL 规则泄漏 URL 凭据"误报。
- pywinauto 结论：保留 Node Control Server / Vue / SQLite / Playwright / WebSocket 1.0 契约，新建 Python Agent 替换 C# Agent 运行角色；否决整仓重写（pywinauto 只解决 Windows UIA，不替代编排/Web/数据能力）与长期双 Agent 并行（同 ID 互替、异 ID 缺能力路由）；C# 迁移期留作行为参考与回退基线（`675edee` 推 `main`，`archive/csharp-agent-baseline-20260928` 固定该提交，`feature/pywinauto-desktop-agent` 承载开发）。
- 七阶段：①架构与工具链基线 ②最小协议 Agent（严格 DTO/hello/welcome/心跳/重连/消息上限/优雅退出）③Windows M0 Spike（记事本动作 + 微信 UIA 树）④安全可靠性等价（串行队列、过期去重、白名单、取消、急停、脱敏）⑤Node 命令桥（结果关联、Agent 选择、真实 ChatReplyAdapter、读取调度）⑥Windows/微信 Adapter ⑦全链路验收与切换。
- Python 实现边界：同步 UIA 入专用串行线程 + 有界等待，异步 WS 接收循环独立，急停直接设线程安全取消事件；pywinauto 0.6.9 未声明 `requires_python`，不以本机 3.9.6 为基线，版本须 Windows Spike 实装后锁定；微信 backend 优先 `uia` 但可访问性不可预设；估 15–25 人日。
- 质量闭环：增强唯一强制主 Skill `.trae/skills/human-operation-simulator-guardrails/SKILL.md`（不建第二个 Skill），强制上下文取证/范围控制/对抗式检查/分层验证/最终复核；并发、生命周期、安全、持久化、协议、跨组件改动需第二遍独立审查或聚焦实验。
- 对账：删除本地"进行中"旧质量记录副本（main `96a589d` 已含最终版、对象哈希不同），三重审计记录入库，Skill 从 `origin/main` 单文件恢复（哈希 `0b70659e…` 一致）；仅动 Markdown，未跑运行时测试。
- .NET CI flake（run `36376125978`）：唯一失败是既有测试同步竞态而非 `96a589d` 回归——`EmergencyStopAsync` 先取消命令再释放输入，worker 可先发 `TASK_CANCELLED` 而被误当释放完成信号；最小修复仅在测试侧加 `EmergencyStopObserved` 完成信号，生产代码不动。

## 验证证据

| 范围 / 命令 | 状态 | 结果 |
|---|---|---|
| 审计基线 `602a6eb`：`npm run check` | PASSED | 格式/lint/typecheck/build 全绿；control-server 207 项、C# 55 项 |
| H1 回归（旧 vs 新实现） | PASSED | 旧 3/3 失败（15 秒超时）；新 3/3 通过；`dotnet test` 58/58 |
| 审计后全门 + `test:integration:m1`（`1a6e82d`） | PASSED | Node 全绿；.NET 0 警告 0 错误、58/58；M1 注册/重连/急停 `result=passed` |
| CTS cancel-after-dispose / TOCTOU 实证 | PASSED | Dispose 后 `Cancel()` 必抛 ODE；1,000,000 次命中 37 次（加宽 200,000 次 274 次） |
| 契约 / Control Server / C# 测试 | PASSED | 5 项（覆盖率 100%）/ 207 项 / 58 项 |
| .NET CI run `36376125978` | FAILED | 57/58 通过；`AgentClientTests.cs:104` 期望释放次数 1、实际 0 |
| flake 修复后 .NET 门 + 20 次聚焦重复 | PASSED | 0 警告 0 错误、58/58；20/20；GitHub Actions Node 与 .NET 均转绿 |
| Python 骨架 `npm run check:python` | PASSED | Ruff/mypy/14 项 pytest，覆盖率 100% |
| 迁移分支 `npm run check` | PASSED | Node 212 + Python 14 + C# 58 项及跨进程重连检查 |
| 密钥/危险 API 扫描、`git diff --check` | PASSED | 无 .env/eval/child_process、仅 2 处 TODO；无空白错误 |
| Windows/pywinauto 实机 Spike 与输入释放 | NOT_EXECUTED | 无 Windows 交互桌面；Spike 未过前不开发微信 Adapter |

## 未完成与后续

- H2、8 项条件触发中危、M1–M3、L1–L4 均未修复，仅有位置、触发条件与修复方向。
- 迁移期接线缺口：Node `sendCommand()` 只返回是否发送、`desktop.command.result` 仅落库，生产工作流仍用 `UnavailableChatReplyAdapter`；结果关联、Agent 选择、真实 ChatReplyAdapter、微信读取调度未实现。
- Windows M0 Spike 与 Python 版本锁定未执行；Spike 通过前不开发完整微信 Adapter、不删除 `apps/desktop-agent/`。
- 文档待同步：README、`docs/02`–`docs/09`、`docs/11`、CI 与安装说明。
- 真实 Windows/微信/站点与物理输入释放未验证，项目级"不具备验收条件"；导师 pywinauto 验收口径未入规范。

## 风险与限制

- 全部分析在 macOS + 模拟环境完成；急停"2 秒内释放全部输入"与 H2 真实后果须 Windows 实机验收。
- 竞态实证为受控复现，真实频率取决于线程调度与人机时序（"动作结束瞬间点停止"属高频时序）。
- pywinauto 微信控件可访问性取决于微信版本；本机 Python 3.9.6/uv 不能替代 Windows 兼容性验证。
- 质量规则只约束读取并遵守 `AGENTS.md`/主 Skill 的 Agent；unbounded `Channel` 无背压上限（按回环可信对端接受），真实微信无稳定消息 ID 时需设计消息指纹。

## 原始条目索引

- `changelog/2026-09-25-fix-agent-command-cancellation.md` — H1 修复：接收/执行解耦，取消与急停执行中即时生效。
- `changelog/2026-09-25-full-project-audit.md` — 全项目只读通查：H1 高、M1–M3 中、L1–L4 低，未改业务代码。
- `changelog/2026-09-25-master-pull-analysis.md` — 拉取 main 三重确认，实证 H2 TOCTOU 与 8 项中危。
- `changelog/2026-09-28-changelog-reconciliation.md` — 删除陈旧质量记录副本，归档三重审计记录。
- `changelog/2026-09-28-fix-dotnet-ci-flake.md` — CI 失败定为测试同步竞态，仅改测试恢复绿灯。
- `changelog/2026-09-28-quality-evidence-loop.md` — 主 Skill 新增强制五阶段质量证据闭环。
- `changelog/2026-09-28-pywinauto-architecture-assessment.md` — 保留 Node 控制面，新建 Python Agent，否决重写与双 Agent。
- `changelog/2026-09-28-pywinauto-implementation-plan.md` — 七阶段迁移计划 + Python 协议骨架（14 项测试）。
