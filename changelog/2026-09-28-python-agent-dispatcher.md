# Python Agent 安全调度

## 元信息

- 日期：2026-09-28
- 状态：已完成
- 环境：macOS；Python 3.11、Node.js 24；Windows 未验证

## 目标

- 补齐 Python Desktop Agent 的命令策略、过期与去重、活动执行取消、急停输入释放
  和日志脱敏。
- 使用跨平台 Fake 验证正常、拒绝、重复、过期、取消和急停路径。
- 保持真实 pywinauto 动作失败关闭，等待 Windows M0 Spike。

## 上下文与证据

- 已读取 `README.md`、`docs/02-system-architecture.md`、
  `docs/03-contracts-and-data.md`、`docs/04-implementation-plan.md`、
  `docs/05-testing-and-acceptance.md`、`docs/06-decisions-and-risks.md`、
  `docs/08-development-status.md` 和上一阶段传输层 changelog。
- Python Agent 已具备严格 WebSocket 1.0 协议、独立接收循环、串行命令队列、
  取消/急停控制帧及失败关闭执行器。
- 当前明确待办为完整策略调度、过期/去重、活动执行取消、输入释放与日志脱敏。
- 工作区存在无关未跟踪 changelog，本任务保留且不修改。

## 分析与决策

- 策略、调度和脱敏保持跨平台，Windows 输入释放通过可注入执行边界表达并用 Fake
  验证调用语义。
- 真实 pywinauto Adapter 不在本任务实现，未实现动作继续返回
  `NOT_IMPLEMENTED`。
- 使用独立执行子任务承载桌面动作；取消只取消该子任务，WebSocket command worker
  可继续返回稳定的 `TASK_CANCELLED`，避免取消传播导致接收会话退出。
- 执行器同时接收线程安全取消信号，未来 pywinauto 使用 `asyncio.to_thread` 时必须
  在 UI 动作边界轮询；这弥补了仅取消 asyncio Task 无法终止工作线程的缺口。
- 急停先原子切换 `PAUSED` 并取消活动任务，再以两秒上限调用执行器释放输入；释放
  超时保持暂停并向传输层暴露失败。
- 动作白名单使用 WebSocket 契约中的大写动作名；空配置仅表示采用六类受限动作的
  默认集合，不开放任意执行能力。

## 操作记录

1. 完成仓库规范、当前状态、契约、架构、实施和测试要求核对。
   - 结果：成功。
   - 影响：确定本次实现边界并建立任务记录。
2. 实现 Python 安全策略、命令去重、活动执行生命周期和急停释放边界。
   - 结果：成功。
   - 影响：新增 `policy.py`，重构 `execution.py`，客户端心跳上报活动命令 ID。
3. 接入 Agent 动作白名单配置和日志脱敏。
   - 结果：成功。
   - 影响：新增 `redaction.py`，启动日志统一脱敏，未知白名单动作拒绝启动。
4. 增加跨平台单元测试并执行 Python 质量门。
   - 结果：成功；Ruff、mypy 和 53 项测试通过，覆盖率 93.67%。
   - 影响：覆盖允许、拒绝、过期、重复、取消、急停、状态和脱敏路径。
5. 执行 Node/Python 跨进程回归。
   - 结果：成功；注册、心跳、服务重启重连和急停 `PAUSED` 状态通过。
6. 同步 README、测试说明、安装配置和开发状态。
   - 结果：成功。
   - 影响：明确跨平台实现与 Windows 实机未验证边界。
7. 完成两轮实现复核并执行全仓质量门。
   - 结果：成功；Node 207 项、Python 53 项、C# 58 项测试及 Python/C# 两条
     跨进程集成回归通过。
   - 影响：确认协议兼容、线程取消信号、文档和测试结果一致。

## 文件变更

- `changelog/2026-09-28-python-agent-dispatcher.md`：记录本任务。
- `apps/desktop-agent-python/src/desktop_agent/policy.py`：动作白名单、有效期策略和
  有界命令去重。
- `apps/desktop-agent-python/src/desktop_agent/execution.py`：串行安全调度、活动
  命令状态、取消和两秒急停释放边界。
- `apps/desktop-agent-python/src/desktop_agent/redaction.py`：Agent 日志脱敏。
- `apps/desktop-agent-python/src/desktop_agent/client.py`、`config.py`、`main.py`：
  接入异步控制、心跳活动 ID、策略配置和安全调度。
- `apps/desktop-agent-python/tests/`：增加策略、调度、配置和脱敏回归测试。
- `README.md`、`docs/05-testing-and-acceptance.md`、
  `docs/08-development-status.md`、`docs/09-installation-guide.md`：同步能力和限制。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| Python 定向测试 | PASSED | 53 项通过，覆盖率 93.67%。 |
| `npm run check:python` | PASSED | Ruff format/lint、mypy 和 pytest 全部通过。 |
| `npm run test:integration:m1:python` | PASSED | 注册、重连、心跳和急停暂停通过。 |
| `npm run check` | PASSED | Node 207、Python 53、C# 58 项测试和双 Agent 集成通过。 |
| Windows pywinauto 验证 | NOT_EXECUTED | 当前环境为 macOS，且真实 Adapter 不在本任务范围。 |

## 问题与处理

- 现象：首次 `npm run check:python` 失败。
- 根因：新增测试未满足 Ruff format，且 mypy 将前置状态断言错误地持续窄化到后续
  状态检查。
- 处理：执行项目格式化，并使用测试辅助函数隔离动态状态断言。
- 结果：Python 完整质量门通过。
- 现象：首轮实现仅取消 asyncio Task，无法约束未来 `to_thread` 内的同步 UIA 调用。
- 根因：asyncio 任务取消不会终止已经运行的工作线程。
- 处理：执行器契约增加 `threading.Event`，取消和急停在取消 asyncio Task 前先置位。
- 结果：Fake 测试确认两条控制路径均传递取消信号。

## 风险与限制

- macOS 只能验证跨平台调度语义，不能证明真实 Windows 输入释放或 pywinauto 兼容性。
- 未来 Windows 执行器必须在每个可中断 UI 动作边界轮询取消信号，并由
  `emergency_stop()` 独立释放所有按键和鼠标按钮。

## 最终结果

- Python Agent 已具备跨平台可验证的完整安全调度层，并保持未实现桌面动作失败关闭。
- 下一阶段进入 Windows M0：实现 pywinauto 基础执行器和微信控件 Spike，实测前台
  窗口校验、协作取消及两秒输入释放。
