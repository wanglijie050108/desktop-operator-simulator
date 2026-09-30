# Python Windows 基础动作

## 元信息

- 日期：2026-09-28
- 状态：已完成
- 环境：macOS；Python 3.11、Node.js 24；Windows 未验证

## 目标

- 实现 Python Desktop Agent 的 Windows 基础动作执行器和平台隔离边界。
- 支持窗口激活、剪贴板写入、按键组合、窗口截图及紧急输入释放。
- 强制输入前台目标校验，并保持微信读写动作失败关闭。
- 使用跨平台 Fake 覆盖分派、安全检查、取消和错误映射。

## 上下文与证据

- 已读取项目守卫、需求、Windows 测试环境、开发状态和上一阶段安全调度记录。
- 提交 `d67af5a` 已推送至 `feature/pywinauto-desktop-agent`。
- Python 调度层已向执行器提供线程安全取消信号，并限制急停调用为两秒。
- 当前环境为 macOS，不能执行 pywinauto 或真实 Windows 输入验证。
- 工作区存在无关未跟踪 changelog，本任务保留且不修改。

## 分析与决策

- Windows API 与 pywinauto 导入必须隔离，macOS 上只能加载跨平台协议和 Fake。
- 只实现契约已有的基础动作，不增加脚本、任意路径或任意进程执行能力。
- 微信读写依赖目标版本和控件树证据，继续返回 `NOT_IMPLEMENTED`。
- Windows 自动化默认关闭；启用时必须同时提供纯进程名白名单，命令携带路径或请求
  未授权进程均返回 `POLICY_DENIED`。
- 先激活唯一匹配的可见、启用窗口，再以窗口句柄和进程 ID 双重校验前台状态；后续
  剪贴板、按键和截图动作执行前后都复核该目标。
- Windows 实现独立放在 `windows_backend.py` 并延迟导入，避免非 Windows 环境加载
  pywinauto/pywin32。跨平台执行逻辑通过 `WindowsBackend` 协议使用 Fake 验证。
- 截图只写入管理员配置目录，文件名由严格 artifactName 与 commandId 组成；补充
  Windows 条件依赖 Pillow 11.3.0。

## 操作记录

1. 完成上一阶段提交和推送，并核对 M0 Windows 环境与基础动作要求。
   - 结果：成功。
   - 影响：确定本阶段边界。
2. 增加 Windows 基础动作执行器和 pywinauto/Win32 后端。
   - 结果：成功；实现窗口发现与激活、前台复核、剪贴板、按键组合、窗口截图和
     键盘/鼠标释放。
   - 影响：新增 `windows_executor.py` 和 `windows_backend.py`。
3. 增加显式启用、进程白名单和截图目录配置。
   - 结果：成功；非 Windows 环境或非法配置失败关闭，默认仍使用占位执行器。
   - 影响：修改 `config.py`、`main.py`、`pyproject.toml` 和 `uv.lock`。
4. 增加跨平台执行器和后端单元测试。
   - 结果：成功；Python 测试由 53 项增加至 72 项，覆盖率 94.09%。
   - 影响：覆盖路径注入拒绝、窗口歧义、前台失配、动作映射、取消、急停和异常映射。
5. 同步 README、Windows 环境、测试、安装和开发状态文档。
   - 结果：成功。
   - 影响：明确启用方式及真实 Windows Spike 仍受阻。
6. 执行全仓质量门并复核最终差异。
   - 结果：成功；Node 207 项、Python 72 项、C# 58 项测试及 Python/C# 两条
     跨进程集成回归通过。
   - 影响：确认默认关闭路径和现有跨组件行为未回归。

## 文件变更

- `changelog/2026-09-28-python-windows-actions.md`：记录本任务。
- `apps/desktop-agent-python/src/desktop_agent/windows_executor.py`：跨平台可测的
  Windows 动作分派、安全校验和错误映射。
- `apps/desktop-agent-python/src/desktop_agent/windows_backend.py`：pywinauto UIA、
  pywin32 剪贴板和 Win32 输入释放实现。
- `apps/desktop-agent-python/src/desktop_agent/config.py`、`main.py`：显式启用、
  进程白名单、能力声明和执行器装配。
- `apps/desktop-agent-python/tests/test_windows_executor.py`、
  `test_windows_backend.py`、`test_config.py`：基础动作回归测试。
- `apps/desktop-agent-python/pyproject.toml`、`uv.lock`：锁定 Windows 截图所需
  Pillow 11.3.0。
- `README.md`、`docs/05-testing-and-acceptance.md`、
  `docs/03-contracts-and-data.md`、`docs/07-windows-test-environment.md`、
  `docs/08-development-status.md`、`docs/09-installation-guide.md`：同步能力、配置和
  验证边界。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| Python 定向测试 | PASSED | 72 项通过，覆盖率 94.09%。 |
| `npm run check:python` | PASSED | Ruff、mypy 和 pytest 全部通过。 |
| `uv lock --check --directory apps/desktop-agent-python` | PASSED | 锁文件与项目依赖一致。 |
| `npm run check` | PASSED | Node 207、Python 72、C# 58 项测试和双 Agent 集成通过。 |
| Windows pywinauto Spike | BLOCKED | 当前为 macOS，需目标 Windows 11 交互式桌面。 |

## 问题与处理

- 现象：首轮 Python 质量门失败。
- 根因：Windows 动态导入模块缺少 mypy 类型标注，且一处安全判断超过 Ruff 行宽。
- 处理：将动态模块明确标注为 `Any` 并按项目格式化规则拆行。
- 结果：Python 完整质量门通过。

## 风险与限制

- 跨平台 Fake 不能证明窗口匹配、DPI、剪贴板、截图或输入释放在真实 Windows 上可靠。
- pywinauto UIA 与目标应用权限必须一致；目标窗口存在多个匹配项时会失败关闭，需在
  实机通过 titleContains 收窄。

## 最终结果

- Windows 基础动作执行器代码已完成，并以显式开关、进程白名单、前台窗口双检和
  受限截图路径保护。
- 下一步必须在目标 Windows 11 交互式桌面执行记事本 Spike；在实测通过前不声明
  pywinauto 基础动作可用，也不开始猜测微信控件选择器。
