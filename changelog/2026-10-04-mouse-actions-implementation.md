# 实现鼠标桌面动作（契约 + 执行器 + 后端 + Spike）

## 元信息

- 日期：2026-10-04
- 状态：已完成（代码与跨平台验证）；目标机 20 轮实机 Spike 受阻（BLOCKED）
- 环境：Windows 11 build 26200（1920×1080、DPI 96），Python 3.11.6、pywinauto 0.6.9；
  Node.js 24 / .NET 10 质量门待执行
- 目标机实测可用：`GetForegroundWindow` 返回有效窗口，具备交互式桌面会话

## 目标

- 补齐 10-20 目标中唯一的硬缺口：鼠标自动控制。落地范围：
  - 契约新增鼠标动作（语义化控件定位优先，坐标仅作默认关闭的兜底路径）；
  - Python 协议模型、动作白名单、执行器分支、pywinauto 后端鼠标实现；
  - 急停路径补齐鼠标按键状态跟踪与精确释放；
  - 单元测试（Fake 后端）与目标 Windows 实机 20 轮 Spike；
  - 文档同步（docs/03、05、07、08、09）与开发状态更新。

## 上下文与证据

- 上一轮只读评审（`changelog/2026-10-04-mouse-and-clipboard-progress-review.md`）确认：
  契约仅 6 个桌面动作、鼠标实现零命中；剪贴板写入 + 读回已实机 20/20。
- 守卫要求（`.trae/skills/.../SKILL.md` §5）：语义化 UIA 定位优先，固定坐标仅 PoC 且必须
  校验前台窗口、分辨率与 DPI；`docs/05` AT-10 要求急停 2 秒内停止全部输入且无卡住按键。
- 现状代码：`packages/contracts/src/index.ts`（TypeBox 联合）、
  `apps/desktop-agent-python/src/desktop_agent/{protocol.py,policy.py,windows_executor.py,windows_backend.py}`、
  C# `DesktopAction` 枚举与 `DesktopCommandValidator`、共享 fixture
  `contracts/fixtures/websocket-v1/messages.json` 构成必须同步的七处面。
- 关键实现事实：`PywinautoWindowsBackend.release_inputs` 目前只释放 5 个键盘键，
  并显式注释"任何未来按下鼠标键的动作都必须在此记录并精确释放"——本次实现必须兑现该约束。

## 分析与决策

方案取舍（用户上轮问题：语义控件点击 A / 绝对坐标 B / A+B）：

- 采用 **A 为主 + B 兜底（默认关闭）**：语义化控件定位是唯一默认路径；坐标路径需要显式配置
  `AGENT_COORDINATE_MOUSE_PROFILE=宽x高@DPI` 才启用，且点击前校验前台目标、窗口归属、
  分辨率与 DPI 四重条件。这样既满足守卫，也覆盖"在任意位置点一下"的课程口径。
- 坐标语义定为**窗口内相对坐标**（相对目标窗口左上角，而非绝对屏幕坐标），窗口移动后依然正确。
- 控件定位失败/歧义必须显式区分：多匹配未指定 `index` 时返回 `UI_ELEMENT_AMBIGUOUS`，
  不静默取第一个。
- 定位点若落在目标窗口矩形之外（控件被滚动出视图）拒绝执行，避免"点空点到别的窗口"。
- 拖拽要求起止点属于同一目标进程，避免跨应用拖放。
- 新增动作：`MOUSE_MOVE`、`MOUSE_CLICK`、`MOUSE_DRAG`、`MOUSE_SCROLL`、`MOUSE_CLICK_POSITION`。
- 鼠标按键释放改为后端跟踪 `_pressed_buttons`（带锁）：`release_inputs` 只释放真实按下且
  尚未释放的按键，避免历史缺陷中"注入未按下按键的抬起事件导致 WinUI 弹出右键菜单"。

## 操作记录

1. 读取守卫、`changelog/README.md`、最新记录、`docs/03`/`08`，检查 git 状态与本机环境。
   - 结果：成功；分支 `main` 与 `origin/main` 一致且工作区干净；本机具备交互式桌面。
2. 采集基线：`uv run --directory apps/desktop-agent-python pytest -q`。
   - 结果：**137 passed / 2 skipped，覆盖率 92.41%**（改动前基线）。
3. 契约层：`packages/contracts/src/index.ts` 新增 5 个鼠标动作与 `mouse` 能力，
   共享 fixture 增加一条 `MOUSE_CLICK` 消息，补 3 组契约测试。
   - 结果：成功；`npm test --workspace @hos/contracts` 8 项通过。
4. C# 契约对齐：`DesktopAction` 枚举新增 5 个成员，`DesktopCommandValidator` 增加鼠标分支，
   补 18 条用例。
   - 结果：代码完成；本机无法编译验证（缺 .NET 10 SDK，见"问题与处理"）。
5. Python：协议模型、动作白名单、`AGENT_COORDINATE_MOUSE_PROFILE` 配置、执行器鼠标分支与
   安全校验、pywinauto 后端鼠标实现与按键跟踪释放。
   - 结果：成功；Fake 后端与注入式后端测试全部通过。
6. 新增记事本鼠标 Spike 工具、模拟记事本编辑器测试、pyproject 入口与 npm 脚本。
   - 结果：成功；模拟编辑器下的 1 轮/2 轮全链路与 4 类"输入无效果"负例均按预期失败。
7. 文档同步：`docs/03`（动作、参数表、错误码）、`docs/05`（测试分层与 AT-15/16）、
   `docs/07`（Spike A2 步骤与失败码、坐标偏移 FAQ）、`docs/09`（执行器开关示例与验证表）、
   `docs/08`（状态）、`README.md`（新 Spike 命令）。
   - 结果：成功。
8. 尝试执行目标机实机鼠标 Spike。
   - 结果：**BLOCKED**（见"问题与处理"），未取得实机证据。

## 文件变更

- `packages/contracts/src/index.ts`：新增 `mouse` 能力、`ControlLocator`/`WindowSelector`/
  鼠标键/点击次数/滚轮刻度 Schema 与 5 个鼠标动作。
- `contracts/fixtures/websocket-v1/messages.json`：`agent.hello` 声明 `mouse`，
  新增一条 `MOUSE_CLICK` 跨语言 fixture。
- `packages/contracts/test/contracts.test.ts`：鼠标动作接受/拒绝矩阵与能力测试。
- `apps/desktop-agent/src/DesktopAgent.Core/ProtocolContracts.cs`、`DesktopCommandValidator.cs`：
  C# 动作枚举与严格参数校验对齐。
- `apps/desktop-agent/tests/DesktopAgent.Core.Tests/DesktopCommandValidatorTests.cs`：鼠标用例。
- `apps/desktop-agent-python/src/desktop_agent/protocol.py`：`MouseButton`、`ControlLocator`、
  鼠标参数模型、5 个 payload、联合类型与 `mouse` 能力。
- `apps/desktop-agent-python/src/desktop_agent/policy.py`：白名单加入 5 个鼠标动作。
- `apps/desktop-agent-python/src/desktop_agent/config.py`：`AGENT_COORDINATE_MOUSE_PROFILE`
  解析与校验、`coordinate_mouse_profile` 选项、声明 `mouse` 能力。
- `apps/desktop-agent-python/src/desktop_agent/windows_executor.py`：`ScreenPoint`/
  `ElementBounds`/`DisplayProfile`、后端协议扩展、鼠标分支、语义落点计算、
  窗口内落点校验、坐标兜底四重校验、跨进程拖拽拒绝。
- `apps/desktop-agent-python/src/desktop_agent/windows_backend.py`：`pywinauto.mouse` 注入、
  `window_bounds`/`locate_control`/`display_profile`/`cursor_position`/`mouse_*`，
  拖动期间的按键跟踪与 `release_inputs` 精确释放。
- `apps/desktop-agent-python/src/desktop_agent/main.py`：把坐标显示档传入执行器。
- `apps/desktop-agent-python/src/desktop_agent/notepad_mouse_spike.py`：新增 20 轮鼠标 Spike。
- `apps/desktop-agent-python/tests/`：`test_windows_executor.py`、`test_windows_backend.py`、
  `test_protocol.py`、`test_policy.py`、`test_config.py`、`test_notepad_spike.py` 扩充，
  新增 `test_notepad_mouse_spike.py`。
- `apps/desktop-agent-python/pyproject.toml`、`package.json`：新增
  `desktop-agent-windows-mouse-spike` 入口与 `test:spike:m0:notepad-mouse` 脚本。
- `docs/03`、`docs/05`、`docs/07`、`docs/08`、`docs/09`、`README.md`：按上节同步。
- `changelog/2026-10-04-mouse-actions-implementation.md`：本记录。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `uv run --directory apps/desktop-agent-python pytest -q`（基线） | PASSED | 137 passed / 2 skipped，覆盖率 92.41% |
| `npm test --workspace @hos/contracts` | PASSED | 8 项通过（含新增鼠标契约用例） |
| `npm run check:python` | PASSED | ruff format/lint + mypy strict + 191 passed / 2 skipped，覆盖率 91.66% |
| `npm run check:node` | PASSED | 格式、lint、类型、单测、构建全部通过（清理 pytest 临时目录后重跑） |
| 模拟记事本编辑器全链路（1 轮、2 轮）与 4 类负例 | PASSED | 断言全部按预期通过/失败 |
| `npm run test:integration:m1:python` | NOT_EXECUTED | 未改动 Agent 传输层，本次未重跑 |
| `npm run check:dotnet` | BLOCKED | 本机仅安装 .NET SDK 8.0.101/8.0.206，`global.json` 要求 10.0.401 |
| `npm run test:spike:m0:notepad-mouse`（实机 20 轮） | BLOCKED | 本会话无法启动可见 GUI 进程，见"问题与处理" |

## 问题与处理

- 现象：`uv run` 默认缓存 `C:\Users\HP\AppData\Local\uv\cache` 在当前沙箱下不可写
  （`os error 5`）。
  - 根因：沙箱只允许写入会话工作区，用户级 uv 缓存目录被拒绝。
  - 处理：所有 `uv` 命令显式使用仓库内 `UV_CACHE_DIR=D:\course_design\desktop-operator-simulator\.uv-cache`。
  - 结果：成功，版本与依赖解析正常。
- 现象：`npm run check:node` 首次失败于 `format:check`，报
  `apps/desktop-agent-python/pytest-of-HP/.../*.json` 未格式化。
  - 根因：该轮 pytest 的 `tmp_path` 落在仓库 `apps/desktop-agent-python/` 下（当时的沙箱不允许写
    系统临时目录），留下的临时报告被 Prettier 的 `apps/**/*.json` 命中。
  - 处理：删除 `pytest-of-HP` 与临时目录后重跑。
  - 结果：PASSED。**注意**：在受限沙箱中先跑 pytest 再跑 `format:check` 会复现该现象，
    执行 `npm run check` 前应先清理该类临时目录。
- 现象：`dotnet test HumanOperationSimulator.slnx` 无法执行，报
  `Requested SDK version: 10.0.401 ... Installed SDKs: 8.0.101, 8.0.206`。
  - 根因：本机未安装 .NET 10 SDK，且 `global.json` 固定 `10.0.401`。
  - 处理：不安装 SDK、不修改 `global.json`；C# 改动逐行复核，交由 CI 的 `windows-latest` job 编译。
  - 结果：BLOCKED，本次不声明 C# 编译或测试通过。
- 现象：目标机实机 Spike 无法启动目标窗口。
  - 根因：本会话（受限令牌）启动的 GUI 进程无法创建可见窗口——`notepad.exe` 启动后进程存活但
    `EnumWindows` 查不到任何该 PID 的顶层窗口；经典 `charmap.exe` 立即退出且无窗口；
    `pywinauto` 的 `Desktop(backend='uia').windows(visible_only=True, enabled_only=True)`
    在同一桌面返回 **0 个窗口**（同桌面用 `EnumWindows` 可枚举 647 个顶层窗口，
    `WinSta0\Default`、会话 1）。另外，历史 Spike 留下的记事本进程无法用
    `Stop-Process`/`taskkill` 终止（`Access is denied`），只能用 UIA `close()` 关闭，
    同样指向受限令牌。
  - 处理：未强行绕过；实机 Spike 记为 BLOCKED，保留可复现命令
    `npm run test:spike:m0:notepad-mouse`，并把"实机 20 轮"写入 `docs/08` 未完成项。
  - 结果：实机证据缺失（历史 Spike A 的 20/20 记录不受影响）。
- 现象：重建 `notepad_mouse_spike.py` 时用 PowerShell `Set-Content` 改写含长破折号的中文注释，
  导致文件编码损坏（`invalid continuation byte`）。
  - 根因：`Get-Content | Set-Content` 使用了非 UTF-8 的默认编码。
  - 处理：改写后仅保留 ASCII 字符，并用文件工具重写；后续不再用 shell 改写源码。
  - 结果：恢复成功，`ruff format` 与全部测试通过。

## 风险与限制

- 真实鼠标输入会移动物理光标并点击真实窗口；Spike 会接管桌面约数分钟，必须在无其它窗口干扰
  且没有未保存内容的专用桌面运行。
- 坐标兜底路径的安全性来自"配置显示档 + 前台 + 窗口内坐标 + 分辨率/DPI"四重校验，目前只有
  Fake 与模拟编辑器证据；实机验证被阻塞，不能声称该路径已在真实环境校准。
- 语义定位依赖目标应用的 UIA 结构；记事本 Spike 使用的 `Document` 控件与偏移常量
  （`CARET_HOME_OFFSET` 等）在实机首次运行时可能需要按实测几何微调。
- C# 侧改动未经本机编译（缺 .NET 10 SDK），存在编译或分析器告警风险，需以 CI 结果为准。
- `format:check` 在受限沙箱下会被 pytest 临时目录干扰，这是环境问题而非代码问题。

## 最终结果

- 已完成（代码与跨平台验证）：
  - 契约层（TypeScript + 共享 fixture + C# 枚举/校验器）新增 `MOUSE_MOVE`、`MOUSE_CLICK`、
    `MOUSE_DRAG`、`MOUSE_SCROLL`、`MOUSE_CLICK_POSITION` 与 `mouse` 能力；
  - Python 协议模型、动作白名单、执行器分支、pywinauto 后端鼠标注入、控件相对偏移、
    窗口内落点校验、歧义/越界错误码、跨进程拖拽拒绝；
  - 坐标兜底默认关闭，启用后校验前台窗口、窗口内坐标、分辨率与 DPI；
  - 急停补齐鼠标按键跟踪与精确释放（只释放确实按下的键）；
  - 自动化验证：Python 191 passed / 2 skipped（覆盖率 91.66%）、契约 8 项通过、
    `npm run check:node` 与 `npm run check:python` 通过；
  - 新增 20 轮记事本鼠标 Spike 工具与文档（`docs/03/05/07/08/09`、`README.md`）。
- 未完成：
  1. 目标机鼠标 Spike 20 轮实机证据（本会话 BLOCKED，命令已给出）；
  2. C# 改动的编译与测试（本机缺 .NET 10 SDK，需 CI 验证）；
  3. `npm run test:stability:m1`（两小时连接）与 M1 其余实机验收项；
  4. 微信 Spike B 与真实站点/页面 Adapter（与本次任务无关的既有缺口）。
