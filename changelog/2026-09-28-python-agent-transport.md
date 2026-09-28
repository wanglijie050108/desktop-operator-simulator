# Python Agent 传输层

## 元信息

- 日期：2026-09-28
- 状态：已完成
- 环境：macOS；Python 3.11.16、uv 0.12.18、Node.js 24；Windows 未验证

## 目标

- 实现 Python Desktop Agent 的配置、WebSocket 注册、心跳、重连和优雅退出。
- 保持接收循环与串行命令执行解耦，使取消和急停控制帧不被桌面动作阻塞。
- 使用失败关闭执行器返回 `NOT_IMPLEMENTED`，本阶段不执行真实 Windows 操作。
- 增加 Python 单元/集成测试，并保留 C# 迁移期回归。

## 上下文与证据

- 第一阶段提交 `9711fe1` 已推送至 `feature/pywinauto-desktop-agent`。
- Python 严格协议模型和共享 fixture 测试已经建立。
- C# Agent 使用独立接收、心跳和串行命令 worker；Python 需要保持相同行为边界。
- 当前 Node 集成脚本只会启动 C# 占位 Agent，需要扩展为 Python/C# 双基线。
- 工作区另有一份无关的未跟踪 changelog，本任务不修改或提交它。

## 分析与决策

- 使用 asyncio 管理网络和生命周期，使用单一 `asyncio.Queue` 串行消费桌面命令。
- 通过可注入执行器隔离传输层；默认执行器失败关闭，不导入 pywinauto。
- 接收循环立即处理取消/急停，桌面命令只入队，避免阻塞 WebSocket 控制帧。
- 精确依赖版本由 uv 锁定。
- 第二阶段不实现真实桌面动作；默认 Handler 仅维护取消/暂停状态并失败关闭。

## 操作记录

1. 完成分支、文档、协议、C# 行为和测试入口核对。
   - 结果：成功。
   - 影响：建立本任务记录。
2. 增加 Agent 配置、WebSocket 客户端、运行入口和失败关闭执行边界。
   - 结果：成功；支持 hello/welcome、心跳、指数退避重连、独立接收循环、串行命令
     worker、取消/急停控制帧和结构化启动日志。
   - 影响：新增 `config.py`、`client.py`、`execution.py`、`main.py` 和 `__main__.py`。
3. 扩展协议内部构造与序列化能力。
   - 结果：成功；网络解析仍只接受 camelCase，内部可使用 Python snake_case。
   - 影响：修改 `protocol.py` 及导出。
4. 增加配置、占位执行器和传输层测试。
   - 结果：成功；Python 测试由 14 项增加至 30 项。
5. 扩展跨进程 M1 测试。
   - 结果：成功；同一脚本可分别启动 C# 或 Python Agent，默认质量门运行两者。
   - 影响：Python 已实际通过注册、心跳、服务重启重连和急停后 `PAUSED` 状态验证。
6. 更新 README、安装、测试和开发状态说明。
   - 结果：成功；文档与当前可运行能力一致。

## 文件变更

- `apps/desktop-agent-python/src/desktop_agent/client.py`：异步 WebSocket 生命周期。
- `apps/desktop-agent-python/src/desktop_agent/config.py`：安全配置加载与校验。
- `apps/desktop-agent-python/src/desktop_agent/execution.py`：执行接口和失败关闭 Handler。
- `apps/desktop-agent-python/src/desktop_agent/main.py`、`__main__.py`：运行入口。
- `apps/desktop-agent-python/tests/test_client.py`、`test_config.py`、
  `test_execution.py`：传输与配置测试。
- `tests/integration/m1-agent-reconnect.mjs`：支持 Python/C# 双实现。
- `package.json`、`pyproject.toml`、`uv.lock`：脚本与依赖。
- `README.md`、`docs/05-testing-and-acceptance.md`、
  `docs/07-windows-test-environment.md`、`docs/08-development-status.md`、
  `docs/09-installation-guide.md`：同步能力状态。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `npm run check:python` | PASSED | Ruff、mypy、30 项 pytest 通过；覆盖率 92.20%。 |
| `npm run test:integration:m1:python` | PASSED | 注册、心跳、重连、急停暂停通过。 |
| `npm run check` | PASSED | Node、Python、.NET 和两条跨进程测试全部通过。 |
| Windows pywinauto 验证 | NOT_EXECUTED | 不在本阶段范围内。 |

## 问题与处理

- 现象：根目录执行 mypy 时没有读取 Python 子项目配置。
- 根因：`uv --project` 选择环境但不切换命令工作目录。
- 处理：根脚本和 CI 改用 `uv run --directory apps/desktop-agent-python`。
- 结果：严格 mypy 检查通过。
- 现象：新增薄 CLI 入口后 pytest 总覆盖率暂时降至 84%。
- 根因：CLI 由跨进程测试执行，其子进程覆盖率不计入 pytest 报告。
- 处理：只排除 `main.py`/`__main__.py`，核心模块继续执行 90% 门槛。
- 结果：核心模块覆盖率 92.20%。

## 风险与限制

- 本阶段不实现桌面动作，不能证明 pywinauto 或微信兼容性。
- Python 同步 UIA 调用的取消策略将在下一阶段执行器实现中验证。

## 最终结果

- Python Agent 已具备可运行的失败关闭传输层，并通过 Node/Python 跨进程验证。
- 下一阶段实现完整策略调度、过期/去重、活动命令取消和日志脱敏；真实 pywinauto
  Adapter 仍等待 Windows M0 Spike。
