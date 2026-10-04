# 修复记事本 Spike 的窗口定位假设（Win11 商店版记事本多窗口）

## 元信息

- 日期：2026-10-04
- 状态：已完成（代码与单元测试通过质量门；真实 Windows 20 轮成功率待用户重跑）
- 环境：Windows 11 build 26200；Python 3.11.6（uv）、pywinauto 0.6.9、Node.js 24.15.0

## 目标

- 让 M0 Spike A 在目标 Windows 11 上可用：该机的记事本为商店应用
  `Microsoft.WindowsNotepad_11.2607.14.0`，**同一进程持有多个可见文档窗口**，导致
  `find_window` 的“恰好一个窗口”规则使 20 轮全部 `TARGET_WINDOW_MISMATCH`。
- 同时消除一个真实的数据安全风险：原逻辑在只剩“别人的文档窗口”时会把该窗口当作目标，
  随后用 `Ctrl+A` + `Ctrl+V` 覆盖其编辑区内容。
- 不改变契约、不放松既有的前台与白名单校验。

## 上下文与证据

- 用户实机报告 `data/artifacts/m0/reports/notepad-spike-20261004-040058538555.json`：
  0/20，`error_counts = {TARGET_WINDOW_MISMATCH: 20}`，`dpi = 96`、1920×1080。
- Win32 枚举证据（`data/artifacts/m0/diag_notepad_visible.py`）：`notepad.exe` 实际启动
  `C:\Program Files\WindowsApps\Microsoft.WindowsNotepad_11.2607.14.0_x64__8wekyb3d8bbwe\Notepad\Notepad.exe`，
  同一 pid 下存在 2 个可见顶层窗口（class 均为 `Notepad`），其中一个属于用户已打开的文档。
- pywinauto 告警 `Application is not loaded correctly (WaitForInputIdle failed)`：打包应用
  启动器不是传统 Win32 应用，`Application.start(wait_for_idle=True)` 不适用。
- 代码事实：`windows_backend.find_window` 原实现把“无匹配”“标题不匹配”“多个匹配”统一
  抛成 `TARGET_WINDOW_MISMATCH`，无法区分故障原因；`start_notepad()` 丢弃了启动结果。
- 已有注入式测试基础设施 `tests/test_windows_backend.py`（`object.__new__` + 假
  `_pywinauto` / `_application`），可离线验证真实后端的窗口筛选逻辑。

## 分析与决策

变更契约：

- 期望行为：Spike A 只对**本次运行自己启动出来的那个记事本窗口**执行输入；该窗口的标题
  作为后续每一轮的定位条件，因而运行期间出现其它记事本文档也不影响目标唯一性。
- 保留行为：动作白名单（`notepad`）、激活后的句柄 + 进程 ID 前台复核、每轮
  `emergency_stop()` 释放输入、报告字段与 19/20 判定阈值均不变。
- 禁止行为：**绝不回退到启动前已存在的窗口**。没有新窗口或新窗口多于一个时显式失败，
  不执行任何输入（原先的隐式回退是覆盖用户文档的风险来源）。
- 错误码细分（保持线上兼容，`errorCode` 为自由字符串）：
  - `find_window`：进程无窗口 → `TARGET_APP_NOT_FOUND`；标题条件无命中 →
    `TARGET_WINDOW_NOT_FOUND`；命中多于一个 → `MULTIPLE_TARGET_WINDOWS`。
  - `TARGET_WINDOW_MISMATCH` 从此只表示“前台窗口与目标不符”，语义与文档一致。
  - Spike 启动阶段：无新窗口 → `NOTEPAD_WINDOW_NOT_FOUND`；多个新窗口 →
    `NOTEPAD_WINDOW_AMBIGUOUS`（作为 `setup_error` 记录在报告中）。

关键取舍：

- 用“启动前后窗口句柄差集 + 标题条件”而不是换用 `win32` backend 或固定坐标：前者保持
  语义化定位（守卫要求）且能隔离无关文档；后者会引入新的定位不确定性。
- 放弃 pywinauto 的 `Application.start(wait_for_idle=True)` 改为 `subprocess.Popen` +
  自身轮询：打包应用的启动器让 `WaitForInputIdle` 恒告警，且其返回值对本场景无用。
- 保留 `find_window` 的“过滤后必须唯一”不变量：多窗口歧义必须显式失败，不能由后端猜测。

## 操作记录

1. 新增窗口枚举辅助与差集定位，改造 `windows_backend.start_notepad` / `find_window`。
   - 结果：成功；新增模块常量 `NOTEPAD_PROCESS_NAME`、`NEW_WINDOW_TIMEOUT_SECONDS`、
     `NEW_WINDOW_POLL_INTERVAL_SECONDS`。
2. `notepad_spike`：把 `start_notepad()` 返回值作为 `title_contains` 贯穿
   `WINDOW_ACTIVATE` 与文档文本读取。
   - 结果：成功；`NotepadSpikeBackend.start_notepad` 签名改为返回 `str | None`。
3. 更新 `tests/test_notepad_spike.py`（fake 返回标题 + 断言定位条件贯通 + 新增
   setup 错误码透传用例）与 `tests/test_windows_backend.py`（错误码细分 + 3 个
   `start_notepad` 差集用例，含“绝不回退到既有窗口”的回归断言）。
   - 结果：成功。
4. 运行 Python 质量门。
   - 结果：成功（见“验证”）。
5. 同步文档：`docs/03` 错误码表、`docs/07` §12 Spike A、`docs/08` 迁移清单与 M0 现状。
   - 结果：成功。

## 文件变更

- `apps/desktop-agent-python/src/desktop_agent/windows_backend.py`：窗口枚举抽出为
  `_process_windows`；`start_notepad` 改为“快照 → 启动 → 轮询新窗口 → 返回其标题”；
  `find_window` 细分错误码。
- `apps/desktop-agent-python/src/desktop_agent/notepad_spike.py`：Protocol 签名、
  `window_title` 贯穿 `_run_iteration`、`WINDOW_ACTIVATE` 与 `find_window`。
- `apps/desktop-agent-python/tests/test_notepad_spike.py`：fake 与新增用例。
- `apps/desktop-agent-python/tests/test_windows_backend.py`：错误码与差集定位用例。
- `docs/03-contracts-and-data.md`：错误码表新增 `TARGET_WINDOW_NOT_FOUND`、
  `MULTIPLE_TARGET_WINDOWS`，明确 `TARGET_WINDOW_MISMATCH` 仅为前台不符。
- `docs/07-windows-test-environment.md`：Spike A 运行前置说明与失败码含义。
- `docs/08-development-status.md`：迁移清单新增该修复；M0 未完成项记录两次实机尝试；
  更新日期为 2026-10-04。
- `changelog/2026-10-04-fix-notepad-window-targeting.md`：本记录。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `npm run check:python`（ruff format/check、mypy strict、pytest） | PASSED | 28 文件格式一致；lint 全过；mypy 27 源文件零问题；**130 passed、2 skipped、覆盖率 92.40%**（门槛 90%）。 |
| 新增 `start_notepad` 差集用例 | PASSED | 返回新建窗口标题；无新窗口 → `NOTEPAD_WINDOW_NOT_FOUND`；两个新窗口 → `NOTEPAD_WINDOW_AMBIGUOUS`；**既有窗口不被回退使用**。 |
| 新增 `find_window` 错误码用例 | PASSED | 无命中标题 → `TARGET_WINDOW_NOT_FOUND`；多命中 → `MULTIPLE_TARGET_WINDOWS`。 |
| Spike 定位条件贯通用例 | PASSED | 每轮 2 次查找（激活 + 读取）均携带启动窗口标题。 |
| 真实 Windows 20 轮 Spike A | NOT_EXECUTED | 需用户在常规交互式终端重跑（本次代理上下文无法使用 UIA）。 |
| Node/.NET 质量门 | NOT_EXECUTED | 本次仅改动 Python Agent 与其文档，未跑 Node/.NET（本机无 .NET SDK）。 |

## 问题与处理

- 现象：`ruff format --check` 首次失败（两处可折叠的推导式）。
  - 处理：执行 `npm run format:python` 后重跑。
  - 结果：通过。
- 现象：mypy 报 `Module "desktop_agent.windows_backend" does not explicitly export
  attribute "subprocess"`（测试通过模块属性打桩）。
  - 根因：mypy strict 的显式再导出规则。
  - 处理：测试改为 `import subprocess` 后对 `subprocess.Popen` 打桩。
  - 结果：mypy 零问题。
- 现象：编辑测试时误删 `test_records_environment_metadata_failure` 主体。
  - 处理：在同一补丁中恢复该用例并补入两个新用例。
  - 结果：130 项用例全部通过。

## 风险与限制

- 修复后的定位依赖“启动后恰好出现一个新窗口”。若 Windows 记事本的会话恢复在启动时重开
  旧文档，会出现多个新窗口并显式失败；此时需先清空记事本会话，属已知前置条件。
- 未验证 WinUI3 记事本的编辑区控件能否被 `read_document_text` 唯一定位为 Document/Edit；
  若不能，会出现 `UI_ELEMENT_NOT_FOUND`，需要另行处理。
- 真实 20 轮成功率尚未取得，`docs/08` 的 M0 项保持未验证。
- 微信等多窗口应用的定位策略未在本次改动范围内：`find_window` 仍要求过滤后唯一，微信
  适配器需要通过标题或其它确定性条件消歧，留待实机校准阶段处理。

## 最终结果

- 已完成：Spike A 的窗口定位改为“锁定本次启动新建的窗口”，消除多窗口歧义与覆盖用户
  文档的风险；错误码细分并可区分故障；Python 质量门全绿（130 passed、92.40%）；相关
  契约与文档已同步。
- 未完成：真实 Windows 20 轮 Spike A 未重跑；WinUI3 编辑区控件定位未验证。
- 下一步建议：用户在常规 PowerShell 中关闭所有记事本窗口后重跑
  `npm run test:spike:m0:notepad`；若出现 `UI_ELEMENT_NOT_FOUND` 则按新错误码定位
  编辑区控件问题。
