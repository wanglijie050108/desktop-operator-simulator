# 修复记事本 Spike 定位（二）：干净实例前置、稳定性判定与急停鼠标事件

## 元信息

- 日期：2026-10-04
- 状态：已完成（代码与单元测试通过质量门；真实 Windows 20 轮待用户重跑）
- 环境：Windows 11 build 26200；Python 3.11.6（uv）、pywinauto 0.6.9

## 目标

- 解释并修复第三次 Spike A 实机失败：启动阶段成功捕获新窗口，随后 20 轮全部
  `TARGET_WINDOW_NOT_FOUND`（目标标题在进程窗口集合中无命中）。
- 修复急停释放的副作用：`release_inputs()` 注入从未按下过的鼠标按键抬起事件，在 Win11
  WinUI 应用中弹出右键菜单并抢占焦点。
- 让定位类故障在**跑满 20 轮之前**就以明确错误码结束。

## 上下文与证据

- 第三次实机报告 `data/artifacts/m0/reports/notepad-spike-20261004-040845575681.json`：
  `setup_error = null`（说明启动阶段确实捕获到恰好一个新窗口）、
  `error_counts = {TARGET_WINDOW_NOT_FOUND: 20}`、单轮 580–1596 ms；20 轮均在任何输入
  之前失败，因此记事本画面没有任何变化。
- 用户观察到“像点了一下右键、出现悬浮窗”：该次运行期间没有任何键盘/鼠标动作被执行，
  唯一会注入输入的是每轮 `finally` 中的 `emergency_stop()` → `release_inputs()`，其注入的
  `MOUSEEVENTF_RIGHTUP (0x0010)` 会被 Windows 投递给光标下的窗口，WinUI 记事本据此弹出
  右键菜单。与观察现象一致。
- 用户运行时间线诊断 `data/artifacts/m0/diag_window_timeline.py`（干净状态）：
  `BEFORE launch: 0 notepad window(s)`；`t=0.5s` 捕获到
  `title='无标题 - Notepad'`（handle 1901822, pid 55900），且该窗口在整个 10 秒内保持稳定、
  标题筛选命中数恒为 1。
- 结论：定位逻辑在**干净实例**下是正确的；失败运行的前置状态并非干净——这正是关键差异。
  Win11 记事本支持标签页：已有实例在运行时，新启动的文档窗口会短暂出现（被 0.25 s 轮询
  捕获），随后被并入已有实例而消失，于是捕获到的标题此后永不命中。

## 分析与决策

变更契约：

- 期望行为：Spike A 只在**干净实例**下运行；只接受**连续多次轮询稳定存在且标题非空**的新窗口
  作为目标；在跑 20 轮之前先验证该目标可被解析。
- 保留行为：动作白名单、激活后的句柄 + 进程 ID 前台复核、每轮急停、报告字段与 19/20 阈值。
- 禁止行为：绝不复用运行前已存在的窗口；绝不在无法唯一确定目标时执行输入；绝不注入未被
  自动化按下的输入。
- 取舍：
  - 选择“干净实例前置”而不是“容忍已有实例”：后者在带标签页的记事本上无法可靠区分“新文档
    窗口”与“即将被并入的临时窗口”，且存在选中用户文档的风险。
  - 选择“稳定性判定 + 标题条件”而不是引入句柄钉住（pin）：前者保持与线上命令契约
    （`processName` + `titleContains`）一致，改动面小；诊断已证明标题在干净实例下稳定。
  - 急停仍保留修饰键抬起（`send_keys` 可能在中途被打断，释放是必要的），但移除鼠标按键抬起：
    没有任何动作会按下鼠标键，未配对的抬起事件不是释放而是凭空注入输入。
- 错误码（均为 Agent 本地/报告字段，不新增线上契约字段）：
  `NOTEPAD_WINDOWS_ALREADY_OPEN`（前置状态不干净）、`NOTEPAD_WINDOW_NOT_FOUND`（无稳定
  新窗口）、`NOTEPAD_WINDOW_AMBIGUOUS`（多个新窗口），以及复用 `find_window` 的
  `TARGET_WINDOW_NOT_FOUND` / `MULTIPLE_TARGET_WINDOWS` 作为启动后解析失败的反馈。

## 操作记录

1. `start_notepad` 增加干净实例前置检查、稳定性判定（`NEW_WINDOW_STABLE_POLLS = 3`）与
   非空标题要求。
   - 结果：成功。
2. `run_notepad_spike` 在启动阶段后增加一次目标解析预检，失败即以该错误码作为 `setup_error`
   结束，不再跑 20 轮同质失败。
   - 结果：成功。
3. `release_inputs` 移除鼠标按键抬起注入并记录理由。
   - 结果：成功。
4. 测试：`test_windows_backend.py` 新增顺序窗口集合（`SequencedDesktop`）与 5 个
   `start_notepad` 用例、改写急停释放用例；`test_notepad_spike.py` 新增解析预检失败用例并
   调整定位条件计数断言。
   - 结果：成功。
5. 运行 Python 质量门；同步 `docs/07` §12、`docs/08`。
   - 结果：成功（见“验证”）。

## 文件变更

- `apps/desktop-agent-python/src/desktop_agent/windows_backend.py`：`start_notepad` 前置
  检查 + 稳定性判定；`release_inputs` 移除鼠标事件注入；新增 `NEW_WINDOW_STABLE_POLLS`。
- `apps/desktop-agent-python/src/desktop_agent/notepad_spike.py`：启动阶段目标解析预检。
- `apps/desktop-agent-python/tests/test_windows_backend.py`：`SequencedDesktop` 与
  5 个新用例；急停释放断言改为“不注入鼠标事件”。
- `apps/desktop-agent-python/tests/test_notepad_spike.py`：解析预检失败用例；计数断言更新。
- `docs/07-windows-test-environment.md`：Spike A 定位规则、失败码表与前置条件。
- `docs/08-development-status.md`：迁移清单条目更新；M0 记录第三次尝试与结论。
- `changelog/2026-10-04-fix-notepad-window-targeting-2.md`：本记录。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `npm run check:python`（ruff format/check、mypy strict、pytest） | PASSED | 28 文件格式一致；lint 全过；mypy 零问题；**133 passed、2 skipped、覆盖率 92.41%**（门槛 90%）。 |
| 干净实例前置用例 | PASSED | 已有窗口 → `NOTEPAD_WINDOWS_ALREADY_OPEN`，且断言**未启动新进程**。 |
| 稳定性用例 | PASSED | 单次出现后消失的临时窗口不被接受（超时 → `NOTEPAD_WINDOW_NOT_FOUND`）；无标题窗口不被接受。 |
| 多窗口用例 | PASSED | 两个新窗口 → `NOTEPAD_WINDOW_AMBIGUOUS`。 |
| 启动后解析预检用例 | PASSED | 捕获成功但随后无法解析时，在 0 轮迭代下以 `TARGET_WINDOW_NOT_FOUND` 作为 `setup_error` 结束。 |
| 急停释放用例 | PASSED | 仅发送 5 个修饰键抬起，`mouse_event` 零调用。 |
| 真实 Windows 20 轮 Spike A | NOT_EXECUTED | 需用户在关闭全部记事本窗口后重跑。 |

## 问题与处理

- 现象：第三次实机运行 20 轮 `TARGET_WINDOW_NOT_FOUND`，而干净状态下的诊断显示定位正常。
  - 根因：运行前已有记事本实例；新文档窗口短暂出现后被并入已有实例，捕获的标题随即失效。
  - 处理：干净实例前置 + 稳定性判定 + 启动后解析预检。
  - 结果：该状态现在会立刻以明确错误码失败，而不是跑满 20 轮。
- 现象：用户观察到运行期间出现右键悬浮菜单。
  - 根因：`release_inputs()` 注入未配对的 `MOUSEEVENTF_RIGHTUP`。
  - 处理：移除鼠标按键抬起注入；保留修饰键抬起。
  - 结果：急停不再产生额外输入副作用。

## 风险与限制

- 稳定性判定（3 次 × 0.25 s ≈ 0.75 s）是启发式：若记事本在更长时间后才并入标签页，仍可能
  误判；启动后解析预检是第二道防线。
- 仍未验证 WinUI3 记事本编辑区控件能否被 `read_document_text` 唯一定位；若不能将出现
  `UI_ELEMENT_NOT_FOUND`。
- 真实 20 轮成功率仍未取得，`docs/08` 的 M0 项保持未验证。
- 移除鼠标按键抬起后，若将来新增按下鼠标键的动作，必须在急停路径中补上对应释放（已在代码
  注释中标注）。

## 最终结果

- 已完成：Spike A 现要求干净实例、只接受稳定且有标题的新窗口、并在跑 20 轮前验证目标；
  急停不再注入未按下的鼠标事件；Python 质量门全绿（133 passed、92.41%）；文档同步。
- 未完成：真实 Windows 20 轮 Spike A；WinUI3 编辑区控件定位验证。
- 下一步建议：用户关闭全部记事本窗口后重跑 `npm run test:spike:m0:notepad`；若失败会直接
  给出上表中的具体错误码。
