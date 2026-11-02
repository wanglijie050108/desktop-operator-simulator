# 修复急停释放注入空抬按键导致记事本丢失编辑区焦点

## 元信息

- 日期：2026-10-10（本机时区 +08:00；Spike 报告时间戳为 UTC `2026-10-09T17:16:39Z`）
- 状态：已完成（未提交）
- 环境：Windows 11 build 26200 x64、1920×1080 @96 DPI；Python 3.11.9、pywinauto 0.6.9、
  Node.js 24.20.0、npm 11.19.0、Visual Studio 2022 Build Tools。

## 目标

- 修复记事本 Spike A 成功率从记录的 20/20 掉到 **1/20** 的缺陷，恢复 ≥95% 的验收标准。
- 在修好之前先确证根因，不用"看起来合理"的解释替代证据。

## 上下文与证据

- 失败报告 `notepad-spike-20261009-165411977626.json`：`setup_error` 为 `null`（窗口定位正常）、
  第 1 轮成功（2348 ms），第 2–20 轮全部 `TEXT_VERIFICATION_FAILED`，每轮 4109–4268 ms
  （正好耗尽 2 s 文本校验超时）。`artifacts` 中只有 1 张截图，因为截图在校验之后才执行。
- 代码核对：`read_document_text` 要求 Document 控件恰好一个，实测恒为 1；`_resolve_window`
  在锁定后按句柄重读窗口。因此失败既不是控件定位问题，也不是标题被文档内容改写的问题。
- 插桩诊断一（3 轮，仓库外脚本）：第 1、2 轮复现失败；第 3 轮在注入按键前对编辑控件显式
  `set_focus()`，当轮即成功（文档变为 `M0-NOTEPAD-SPIKE-03`）。⇒ 缺陷是**键盘焦点**，
  不是剪贴板、不是文本读取。
- 插桩诊断二（9 次探针，每次前施加一个扰动，排除法定位）："什么都不做"与"窗口截图"之后仍
  PASS；而 `executor.emergency_stop()` 之后、以及**仅注入 SHIFT/CTRL/ALT 抬起事件**
  （不含 LWIN/RWIN、纯 `ctypes` 调用、完全不碰执行器状态）之后均 FAIL。
  ⇒ 元凶是 `release_inputs` 中针对**未被按下**的修饰键注入的"空抬"事件。
- `git show` 证据：该 key-up 循环在 `b9f3d1d^` 就已存在，早于 2026-10-04 12:37 的 20/20
  记录；`b9f3d1d`（同日 15:22）只新增了鼠标按键跟踪。⇒ **不是代码回归**，而是被环境变化
  （商店版记事本 `Microsoft.WindowsNotepad` 11.2607.14.0 的焦点行为）触发的潜在缺陷。

## 分析与决策

- **变更契约**：`release_inputs` 只释放 `GetAsyncKeyState` 报告为按下的修饰键；无修饰键按下时
  不注入任何事件；鼠标释放路径、`_pressed_buttons` 语义与急停"保证无输入残留"的目标不变。
- 备选方案与取舍：
  1. *跟踪自己按下的修饰键*：注入走 `pywinauto.keyboard.send_keys`，其内部自行管理 down/up，
     中途异常时无法得知残留了哪些键，跟踪会脆弱。
  2. *只改 Spike，在发按键前显式聚焦编辑控件*：能通过，但掩盖真实缺陷且不修产品代码。
  3. *`GetAsyncKeyState` 门控*：不新增跟踪状态，保留急停保证（真被按住的键仍会释放），
     与既有原则一致。**采用 3**。
- 与既有决策一致：`windows_backend` 早已对鼠标写明"注入未匹配的抬起事件不是释放"，
  本次把同一原则补到键盘分支；这也是 `docs/08` 记录过的同类历史缺陷。
- 选择直接调用而非静默兜底：`GetAsyncKeyState` 在真实 Windows 上恒存在，加 try/except 回退
  反而会掩盖环境错误并重新引入空抬注入。

## 操作记录

1. 先写回归测试并确认修复前失败（基线 `2 failed, 1 passed`）。
   - 结果：成功捕获失败基线。
2. 实现最小改动：新增 `_KEY_DOWN_MASK = 0x8000`，`release_inputs` 按键分支加门控。
   - 影响：仅 `windows_backend.py`；鼠标分支一行未动。
3. 更正既有测试契约并补测试：原 `test_release_inputs_releases_keys_without_injecting_mouse_events`
   断言的正是错误行为（无条件注入 5 个键的抬起事件），改为
   `..._injects_nothing_when_no_modifier_is_held`；新增 held-modifier 测试（参数化覆盖
   `ctypes` 读取 `SHORT` 时的符号扩展 `0x8000` / `-32768`）；给 held-buttons 测试补
   `GetAsyncKeyState` 替身。
4. 跑证据阶梯（格式、静态检查、类型检查、单测、全量质量门），随后实机复验 20 轮。
   - 结果：全部通过。

## 文件变更

- `apps/desktop-agent-python/src/desktop_agent/windows_backend.py`：新增 `_KEY_DOWN_MASK`；
  `release_inputs` 仅对 `GetAsyncKeyState` 报告为按下的修饰键注入抬起事件，并补注释说明原因。
- `apps/desktop-agent-python/tests/test_windows_backend.py`：更正 1 项测试契约、新增 2 项
  测试（其中 1 项参数化），1 项补测试替身。
- `docs/08-development-status.md`：记录本次修复与复验证据；更新质量门当前统计
  （194 收集 / 192 通过 / 覆盖率 91.71%）与文档日期。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `pytest tests/test_windows_backend.py -k release_inputs`（修复前） | — | `2 failed, 1 passed`（回归测试先失败，基线已捕获） |
| `pytest tests/test_windows_backend.py -k release_inputs`（修复后） | PASSED | 3 passed |
| `pytest tests/test_windows_backend.py` | PASSED | 22 passed |
| `pytest`（全量，含覆盖率门槛 90%） | PASSED | 194 passed, 2 skipped；覆盖率 91.71% |
| `ruff format --check .` | PASSED | 30 files already formatted |
| `ruff check .` | PASSED | All checks passed! |
| `mypy src tests`（strict） | PASSED | no issues found in 29 source files |
| `npm run check` | PASSED | exit 0（Node 全套 + Python 全套 + 跨进程集成 `result: passed`） |
| `npm run test:spike:m0:notepad`（实机 20 轮） | PASSED | **20/20**，`error_counts` 为空、`setup_error` 为 `null`、逐轮 1945–2176 ms、均值 2061.5 ms |
| 截图人工目视复核 | PASSED | 20 张尺寸恒为 1440×750（目标窗口，非全屏）；首轮 `M0-NOTEPAD-SPIKE-01`、末轮 `M0-NOTEPAD-SPIKE-20`，标签/正文/状态栏（19 个字符）一致，单一标签页无累积，无目标外输入 |

失败报告与修复后报告均保留在 `C:\automation-data\artifacts\reports\`（工作区外，未入 Git）。

## 问题与处理

- 现象：Spike A 从 20/20 掉到 1/20，唯一错误码 `TEXT_VERIFICATION_FAILED`，且每轮耗时几乎
  相同地撞满超时。
- 根因：`release_inputs` 对 SHIFT/CTRL/ALT/LWIN/RWIN 无条件注入抬起事件，而这些键从未被按下；
  这类空抬事件使 Windows 11 记事本丢失编辑区键盘焦点，后续 `Ctrl+A`/`Ctrl+V` 全部落空。
  由于剪贴板读回是独立通路且仍然通过，缺陷被伪装成"文本校验失败"。
- 处理：按上述方案 3 修复，并更正了断言错误行为的既有测试。
- 结果：单元测试、类型检查、全量质量门与实机 20 轮全部通过。
- 附带：诊断过程中一度推断 LWIN/RWIN 是元凶，被"仅注入 SHIFT/CTRL/ALT 仍失败"的实验证伪，
  已按实测结论修正。

## 风险与限制

- 改动**尚未提交**。
- 修复只消除"空抬"注入；**未**改变"激活窗口后由系统决定编辑控件焦点"这一前提。本次诊断
  证明在记事本上不再需要额外聚焦，但其它 WinUI/XAML 应用是否在窗口激活后保留编辑焦点
  尚未验证，未在真实业务应用上校准。
- 若目标机器上确有修饰键被物理按住，`release_inputs` 会将其释放（急停语义下视为期望行为），
  但会把用户的按键状态一并抬起。
- 该缺陷只在真实 Windows 交互式桌面可观测，跨平台单测只能覆盖"是否注入事件"这一层，
  无法覆盖焦点行为本身。
- 未执行 M0 Spike A2（鼠标）复跑；`docs/08` 记录的鼠标 19/20 尚未受本次改动影响（鼠标分支未变）。
- 未执行 Spike B/C，微信、AI 页面与购物站点仍未接入。

## 最终结果

- 记事本 Spike A 恢复并通过验收标准：**2026-10-09(UTC)/2026-10-10(+08:00) 复验 20 轮 20/20**，
  报告 `notepad-spike-20261009-171639502077.json`。
- 修复与既有鼠标安全原则统一：不再注入未匹配的抬起事件。
- 未完成项：提交本次改动；鼠标 Spike A2 复跑；微信 Spike B 的版本选型决策。
