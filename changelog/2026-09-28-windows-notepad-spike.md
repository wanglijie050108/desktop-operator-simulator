# Windows 记事本 Spike 工具

## 元信息

- 日期：2026-09-28
- 状态：已完成
- 环境：macOS；Python 3.11、Node.js 24；Windows 未验证

## 目标

- 提供可在目标 Windows 11 交互式桌面直接运行的 M0 Spike A 工具。
- 固定执行 20 轮记事本窗口激活、剪贴板写入、粘贴、截图和急停释放检查。
- 输出脱敏的结构化 JSON 报告，记录成功率、耗时和稳定错误码。
- 在非 Windows 环境对参数、统计、报告和失败关闭行为进行自动化测试。

## 上下文与证据

- 提交 `b3ac199` 已推送至 `feature/pywinauto-desktop-agent`。
- Windows 基础执行器已实现，但真实 pywinauto/Win32 路径尚无实机证据。
- `docs/07-windows-test-environment.md` 要求 Spike A 连续运行 20 次且成功率不低于
  95%，同时覆盖记事本输入、剪贴板、截图和紧急停止。
- 当前环境为 macOS，不能运行真实 Windows Spike。
- 工作区存在无关未跟踪 changelog，本任务保留且不修改。

## 分析与决策

- Spike 工具使用固定记事本目标和内置测试文本，不接受任意命令或程序路径。
- 报告只记录轮次、结果、错误码和耗时，不写入测试文本或剪贴板内容。
- 真实运行结果必须由 Windows 命令生成；macOS 单元测试不得替代 M0 验收。
- 以固定 `notepad.exe` 为唯一启动目标；运行前要求关闭其他记事本窗口，避免歧义
  匹配或影响未保存内容。
- 文本验证使用两秒有界轮询并在验证成功后截图，避免 UIA 更新延迟造成误判。

## 操作记录

1. 核对 M0 Spike A 验收要求、Python 工程入口和已推送基础执行器。
   - 结果：成功。
   - 影响：确定工具范围和报告边界。
2. 实现固定 20 轮的记事本 Spike runner 和 CLI 入口。
   - 结果：成功；逐轮执行激活、全选、剪贴板写入/读取、粘贴、UIA 文本读取、
     截图和输入释放。
   - 影响：新增 `notepad_spike.py` 和 `desktop-agent-windows-spike` 命令。
3. 增加报告模型、95% 通过门槛和错误聚合。
   - 结果：成功；报告不包含测试正文，setup 失败与逐轮失败均使用稳定错误码。
4. 增加 Fake runner 与 Windows 后端行为测试。
   - 结果：成功；Python 测试由 72 项增加至 80 项，覆盖率 92.98%。
5. 验证非 Windows 失败关闭并同步执行文档。
   - 结果：成功；macOS 返回 `WINDOWS_REQUIRED` 和退出码 2。
6. 执行全仓质量门。
   - 结果：成功；Node 207 项、Python 80 项、C# 58 项测试和双 Agent 集成通过。

## 文件变更

- `changelog/2026-09-28-windows-notepad-spike.md`：记录本任务。
- `apps/desktop-agent-python/src/desktop_agent/notepad_spike.py`：M0 Spike runner、
  统计报告和命令行入口。
- `apps/desktop-agent-python/src/desktop_agent/windows_backend.py`：增加固定记事本
  启动、剪贴板读取、UIA 文本读取和环境元数据。
- `apps/desktop-agent-python/tests/test_notepad_spike.py`、
  `tests/test_windows_backend.py`：验证成功率门槛、持续执行、报告脱敏和后端行为。
- `apps/desktop-agent-python/pyproject.toml`、`package.json`：注册 Spike 命令。
- `README.md`、`docs/07-windows-test-environment.md`、
  `docs/08-development-status.md`、`docs/09-installation-guide.md`：同步运行步骤和状态。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| Python 定向测试 | PASSED | 80 项通过，覆盖率 92.98%。 |
| `npm run check:python` | PASSED | Ruff、mypy 和 pytest 全部通过。 |
| `uv lock --check --directory apps/desktop-agent-python` | PASSED | 锁文件一致。 |
| `npm run check` | PASSED | Node 207、Python 80、C# 58 项测试和双 Agent 集成通过。 |
| `npm run test:spike:m0:notepad`（macOS） | PASSED | 按设计返回 `WINDOWS_REQUIRED`，退出码 2。 |
| Windows 20 轮记事本 Spike | BLOCKED | 当前为 macOS，需目标 Windows 11 交互式桌面。 |

## 问题与处理

- 现象：首轮 runner 测试统一记录为 `SPIKE_UNEXPECTED_ERROR`。
- 根因：验证阶段向 Fake 后端传入了带 `.exe` 的名称，而生产执行器向后端传入规范化
  进程名。
- 处理：验证阶段复用同一进程名规范化函数，并增加 Windows 后端单元测试。
- 结果：80 项 Python 测试通过。

## 风险与限制

- 工具只能提高 Windows 验证的可重复性，不能在 macOS 上生成真实通过结论。
- Windows 11 记事本的 UIA 编辑控件可能因系统版本不同暴露为 `Document` 或 `Edit`；
  后端支持这两种语义类型，仍需在目标版本确认。

## 最终结果

- M0 记事本 Spike 工具已实现并通过跨平台 Fake 验证。
- 真实 20 轮运行仍受 Windows 交互式桌面条件阻塞；执行后应保留 JSON 报告，并根据
  结果决定是否进入微信控件识别阶段。
