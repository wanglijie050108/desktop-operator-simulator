# 修复微信发送路径：键盘焦点落到搜索框与未验证粘贴

## 元信息

- 日期：2026-11-17
- 状态：已完成（代码与单测；目标微信实机复测未执行）
- 环境：Windows 11；微信 4.x（进程 `Weixin.exe`）；Python 3.11.18
- 分支：`feature/pywinauto1`

## 目标

- 修复实机首次运行 Spike 时的现象：脚本启动瞬间 PowerShell 抢前台，微信重新激活后
  键盘焦点停在左上角搜索框，粘贴的探测文本进了搜索框而不是聊天输入框。
- 保证发送路径在焦点或粘贴结果不确定时失败关闭，绝不按回车。

## 上下文与证据

- 用户实机现象：PowerShell 执行命令时抢焦点；微信被重新激活，但键盘输入进入
  `mmui::XValidatorTextEdit`（搜索框），不是 `mmui::ChatInputField`（聊天输入框）。
- 只读取证报告 `wechat-uia-20261117-130849441774.json`：
  - 搜索框：`Edit` / `mmui::XValidatorTextEdit`，无 AutomationId；
  - 聊天输入框：`Edit` / `mmui::ChatInputField` / AutomationId `chat_input_field`；
  - 会话标题：`current_chat_name_label`。
- 原实现 `send_chat_text` 取 `window.descendants(control_type="Edit")[-1]` 后调用
  `set_focus()`，随后无条件粘贴并回车。
- 既有前置激活并未缺失：Spike 与执行器都在发送前调用 `activate` 并检查前台；
  `is_foreground` 通过说明“窗口在前台”，但“窗口内键盘焦点”仍可能错误。

## 分析与决策

- 豆包提出的“加前置激活”不是根因修复：激活已存在，且现象证明激活成功。真正的问题是
  目标控件选择与键盘焦点都没有被验证。
- 修复分三层：
  1. **优先用 `chat_input_field`** 精确定位输入框；找不到时排除搜索框类名，再退回
     原“最后一个 Edit / Document”策略。
  2. **验证键盘焦点**：`set_focus()` 后轮询 `has_keyboard_focus()`；未获得焦点时
     点击控件中心作为后备；仍失败则 `CHAT_INPUT_NOT_FOCUSED`，不注入任何按键。
  3. **验证粘贴结果**：粘贴后依次读取 ValuePattern 与 TextPattern，只有确认探测文本
     进入输入框才按回车；否则 `CHAT_INPUT_VERIFICATION_FAILED`。若两种文本接口都不可用，
     则在焦点已验证的前提下继续，避免误伤可用路径。
- 发送前后各检查一次前台，防止焦点在操作过程中被抢走。

## 操作记录

1. 阅读取证报告并定位搜索框、输入框、标题控件的 AutomationId/ClassName。
   - 结果：成功。确认 `chat_input_field` 与 `mmui::XValidatorTextEdit` 可区分。
2. 修改 `send_chat_text`，新增焦点与粘贴验证及点击后备。
   - 结果：成功。
3. 扩充 `test_windows_backend.py` 的合成控件，新增 8 个发送路径用例。
   - 结果：成功。
4. 运行格式化、lint、mypy 与全量 Python 质量门。
   - 结果：全部通过。

## 文件变更

- `apps/desktop-agent-python/src/desktop_agent/windows_backend.py`：
  - 新增聊天输入框常量与超时；
  - `send_chat_text` 改为定位 `chat_input_field`、验证焦点、验证粘贴、再回车；
  - 新增 `_resolve_chat_input`、`_focus_chat_input`、`_wait_for_keyboard_focus`、
    `_wait_for_input_text` 与两个控件属性辅助函数。
- `apps/desktop-agent-python/tests/test_windows_backend.py`：扩展合成控件并新增
  8 个用例（优先 auto_id、排除搜索框、无输入框、点击后备、无法聚焦、粘贴未验证、
  后台窗口、只用 TextPattern 的输入框）。
- `docs/07-windows-test-environment.md`：Spike B 行为说明补充两个失败关闭错误码。
- `changelog/2026-11-17-wechat-send-focus-fix.md`：本记录。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `uv run ruff format ...` | PASSED | 1 个文件重排。 |
| `uv run ruff check src tests` | PASSED | All checks passed。 |
| `uv run mypy src tests` | PASSED | 31 个源文件无问题（strict）。 |
| `uv run pytest tests/test_windows_backend.py -q --no-cov` | PASSED | 28 passed。 |
| `npm run check:python` | PASSED | **237 passed, 2 skipped**；覆盖率 92.69%。 |
| 微信实机 1 轮复测 | PASSED | 2026-11-17，报告 `wechat-spike-20261117-132305231134.json`：`passed=true`、`successCount=1/1`、`duration_ms=397`、`observed_matches=1`、`error_counts={}`。 |

## 问题与处理

- 现象：文本进入搜索框。
- 根因：输入框选择依赖“最后一个 Edit”且 `set_focus()` 未验证；微信重新激活后
  键盘焦点默认停在搜索框。
- 处理：改为语义定位 + 焦点验证 + 粘贴验证 + 点击后备，全部失败关闭。
- 结果：单测覆盖所有分支；实机效果待复测。

## 风险与限制

- `click_input()` 会真实移动鼠标并点击输入框中心；若控件被遮挡或窗口不在前台，
  可能点击失败，此时工具会 `CHAT_INPUT_NOT_FOCUSED` 失败关闭。
- 若目标微信的输入框不支持 ValuePattern，粘贴验证会被跳过（仍要求焦点验证通过）。
- 未实机验证 `has_keyboard_focus()` / `get_value()` 在该微信版本上的实际返回值；
  若与方法预期不符，需按实机结果调整，而不是放宽校验。

## 最终结果

- 发送路径不再依赖控件顺序，也不会在焦点或粘贴结果不确定时按回车。
- 全量 Python 质量门通过。
- 实机 1 轮复测已通过：探测文本进入聊天输入框并被 UIA 读回，无错误。
- 后续 20 轮实机执行 **20/20 通过**，见
  `changelog/2026-11-17-m0-wechat-spike-passed.md`。
