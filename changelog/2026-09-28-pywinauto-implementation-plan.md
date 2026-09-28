# pywinauto 迁移规划与第一阶段工程骨架

## 元信息

- 日期：2026-09-28
- 状态：已完成
- 环境：macOS；当前分支 `feature/pywinauto-desktop-agent`；本机 Python 3.9.6、
  uv 可用；Windows/Python 目标环境未确认

## 目标

- 分析 C# Desktop Agent 向 Python pywinauto Agent 迁移的总体任务。
- 按依赖、风险和验收条件形成可执行的阶段计划。
- 更新 README 和受影响的架构文档。
- 完成第一阶段 Python 工程骨架、严格协议模型、共享 fixture 测试和 CI 接入。

## 上下文与证据

- 已确认当前分支为 `feature/pywinauto-desktop-agent`，并跟踪同名远端分支。
- 已阅读项目守卫、README、开发状态、架构、契约、实施、测试、风险和 Windows
  环境文档，以及前序 pywinauto 架构评估。
- 当前仅有一份与本任务无关的未跟踪 changelog，本任务不修改或提交它。
- 当前 C# Agent 已定义 WebSocket 连接、心跳、重连、串行派发、过期/去重、取消、
  急停、参数校验和脱敏行为；Python 首批代码只迁移严格协议层。

## 分析与决策

- 保留 Node.js Control Server、Vue、SQLite、Playwright 和 WebSocket 1.0 契约。
  新建 `apps/desktop-agent-python/`，在验收完成前不删除 `apps/desktop-agent/`。
- 采用七阶段迁移：
  1. 架构与工具链基线：更新 ADR/架构文档，建立 pyproject、锁文件、lint/typecheck/test。
  2. 最小协议 Agent：严格 DTO、hello/welcome、心跳、重连、消息大小和优雅退出。
  3. Windows M0 Spike：记事本基础动作与微信 UIA 树检查，先验证 pywinauto 可行性。
  4. 安全与可靠性等价：串行队列、过期/去重、参数白名单、取消、急停和脱敏。
  5. Node 桌面命令桥：结果关联等待、Agent 选择、真实 ChatReplyAdapter 和读取调度。
  6. Windows/微信 Adapter：窗口校验、输入、剪贴板、截图、微信读取与发送。
  7. 全链路验收与切换：稳定性/E2E、更新启动与 CI、停止默认运行 C#。
- `pywinauto` 0.6.9 是 PyPI 当前版本，但元数据未声明 `requires_python`，分类器也较旧；
  不以本机 Python 3.9.6 作为目标基线。目标 Python 版本与精确依赖必须在 Windows
  Spike 中实际安装验证后锁定。
- pywinauto 官方文档要求先判断目标应用适合 `win32` 还是 `uia` backend；微信应先
  使用检查工具比较控件树，优先 `uia`，不能预先假定所有控件可访问。
- Python 的同步 UIA 调用需要放入专用串行执行线程，并设置有界等待；异步 WebSocket
  接收循环必须独立运行，以便执行中仍能接收取消和急停。紧急停止应直接设置线程安全
  取消事件并释放输入，不能依赖取消阻塞中的 Python 线程。
- C# 实现只作为行为参考，不机械翻译；Python 以共享 fixture 和黑盒行为测试定义兼容
  性，避免继承现有并发实现细节。
- 当前 Node `sendCommand()` 只返回是否发送，`desktop.command.result` 只落库并记录
  日志，生产工作流仍使用 `UnavailableChatReplyAdapter`。因此 Node 命令结果关联和
  真实回复桥属于迁移必做项，不是 pywinauto 之外的可选优化。
- 预计 Python Agent 迁移与真实微信闭环约 15–25 人日，最大不确定性是微信控件树和
  消息稳定标识；真实 AI/购物站点适配仍是原项目的独立剩余工作，不计入该估算。

## 操作记录

1. 确认迁移分支和项目基线。
   - 结果：成功。
   - 影响：仅新增本规划记录。
2. 核对 C# Agent 协议、连接、并发、安全实现及对应测试。
   - 结果：成功；形成 Python 行为等价清单。
   - 影响：无产品代码改动。
3. 核对 Node AgentGateway、ChatReplyAdapter、共享契约、CI 和运行脚本。
   - 结果：成功；识别命令结果关联、Agent 选择和微信读取调度三个接线缺口。
   - 影响：无产品代码改动。
4. 核对 pywinauto 官方信息和本机 Python 工具链。
   - 结果：成功；PyPI 当前版本为 0.6.9，本机 Python 3.9.6 与 uv 可用，但不能替代
     Windows 兼容性验证。
   - 影响：无环境修改。
5. 新建 Python 3.11/uv 工程与严格协议模型。
   - 结果：成功；覆盖双向消息、六类桌面命令参数、UUID、UTC 和 64 KiB 上限。
   - 影响：新增 `apps/desktop-agent-python`，Windows 才安装 pywinauto。
6. 增加协议 fixture 和边界测试。
   - 结果：成功；14 项测试通过，覆盖率 100%。
   - 影响：Node、Python、C# 迁移期共用同一份 fixture。
7. 接入根级质量命令和 Windows Python CI。
   - 结果：成功；`npm run check` 现包含 Python 格式、lint、类型和测试。
   - 影响：新增 Python CI job，保留迁移期 .NET job。
8. 更新 README、架构决策、实施、测试、环境、状态和安装/设计文档。
   - 结果：成功；文档明确目标 Python Agent、迁移边界和当前未实现能力。
   - 影响：不改变现有运行能力，C# 占位 Agent 继续保留。

## 文件变更

- `changelog/2026-09-28-pywinauto-implementation-plan.md`：记录本次迁移规划。
- `apps/desktop-agent-python/`：Python 工程、锁文件、协议模型和测试。
- `README.md`：更新目标技术栈、开发命令、目录和迁移状态。
- `docs/02-system-architecture.md`、`docs/03-contracts-and-data.md`、
  `docs/04-implementation-plan.md`、`docs/05-testing-and-acceptance.md`、
  `docs/06-decisions-and-risks.md`、`docs/07-windows-test-environment.md`、
  `docs/08-development-status.md`、`docs/09-installation-guide.md`、
  `docs/11-design-overview.md`：同步 Python 迁移事实。
- `package.json`、`.github/workflows/ci.yml`：接入 Python 质量门。
- `.gitignore`：忽略 Python 环境、缓存和覆盖率产物。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git status --short --branch` | PASSED | 当前位于 pywinauto 迁移分支。 |
| C#/Node/契约/CI 静态核对 | PASSED | 已确认迁移边界、行为清单和生产接线缺口。 |
| PyPI 与 pywinauto 官方文档核对 | PASSED | 当前版本和 backend 选择要求已确认。 |
| `uv sync --project apps/desktop-agent-python --locked` | PASSED | 锁文件可重建 Python 3.11 环境。 |
| `npm run check:python` | PASSED | Ruff format/lint、mypy、14 项 pytest 全部通过；覆盖率 100%。 |
| `npm run check` | PASSED | Node 212 项、Python 14 项、C# 58 项及跨进程重连检查全部通过。 |
| Windows pywinauto Spike | NOT_EXECUTED | 当前没有 Windows 交互桌面。 |

## 问题与处理

- 现象：通用搜索结果未可靠返回 PyPI 官方元数据。
- 根因：搜索结果质量不足。
- 处理：直接读取 PyPI JSON API 与 pywinauto 官方文档。
- 结果：确认当前发布版本及 backend 选择原则。
- 现象：首轮 pytest 有 7 个正向用例因严格模式拒绝时间字符串。
- 根因：Pydantic 严格模式不会自动把 JSON 字符串转换为 `datetime`。
- 处理：增加只接受 `Z`/`+00:00` 的显式 UTC 解析类型，不放宽其他字段。
- 结果：14 项测试全部通过。

## 风险与限制

- pywinauto 对目标微信版本的 UIA 可访问性必须在 Windows 实机验证。
- 导师要求的范围若是“全项目 Python”而非“桌面自动化使用 pywinauto”，计划需要调整。
- pywinauto 调用本身是同步的，取消与超时必须通过执行架构和短步骤设计保证，不能假设
  `asyncio` 可以强制终止阻塞线程。
- 真实微信无稳定消息 ID 时，需要设计可重复验证的消息指纹，否则可能重复创建任务。

## 最终结果

- 已形成七阶段迁移计划，并完成第一阶段中的文档、工程骨架和严格协议模型。
- 下一批实现最小 WebSocket Agent（注册、welcome、心跳、重连、退出）；随后尽快进入
  Windows Spike。Spike 未通过前不开发完整微信 Adapter，也不删除 C#。
