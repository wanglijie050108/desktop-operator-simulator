# 修复记事本 Spike 定位（三）：改为按窗口句柄锁定

## 元信息

- 日期：2026-10-04
- 状态：已完成（代码与单元测试通过质量门；真实 Windows 20 轮待用户重跑）
- 环境：Windows 11 build 26200；Python 3.11.6（uv）、pywinauto 0.6.9

## 目标

- 依据实机诊断证据，消除 Spike A 的最后一个定位缺陷：目标窗口标题会在运行过程中被改写。
- 让执行器的目标解析不再依赖标题，且保持"绝不对非目标窗口执行输入"的安全性质。

## 上下文与证据

- 第四轮实机诊断（`data/artifacts/m0/diag_after_input.py`，复刻一次完整迭代）输出：
  - `before activate: windows=1 [724278]'无标题 - Notepad'`
  - `activate/ctrl+a/clipboard/ctrl+v: SUCCEEDED`
  - `after paste: windows=1 [724278]'*M0-NOTEPAD-SPIKE-01 - Notepad'`
  - `title filter: FAILED DesktopActionFailure: TARGET_WINDOW_NOT_FOUND`
  - `clipboard='M0-NOTEPAD-SPIKE-01'`（粘贴确实生效）
- 由此确定根因：**Windows 11 商店版记事本以文档第一行作为未保存文档的窗口标题**（修改后加 `*`
  前缀）。Spike 自己输入的文本使标题从 `无标题 - Notepad` 变为
  `*M0-NOTEPAD-SPIKE-01 - Notepad`，捕获时的标题子串从此不再出现。
- 该根因完整解释历史现象：迭代 1 激活成功 → 发出 3 个输入动作 → 读取前按标题复核即失败
  （1589 ms ≈ 两次枚举 + 输入）；迭代 2–20 在激活阶段即时失败（~600 ms ≈ 一次枚举，因为标题
  已永久失效）。所有"无输入"的诊断之所以全部通过，正是因为它们从不改写标题。
- 先前排除项：UIA 通道（用户常规终端 `uia=11`）、线程亲和性（
  `data/artifacts/m0/diag_threads.py` 显示主线程与 `asyncio.to_thread` 线程池均正常）、
  窗口/标题稳定性（`diag_replica.py` 22.8 s 内窗口与标题稳定）、"星号前缀破坏子串匹配"
  （前缀不影响子串，实测根因是标题整体被替换）。
- 仓库既有约定：守卫要求优先语义化定位；此处标题本身不稳定，故改用窗口句柄这一确定性标识。

## 分析与决策

变更契约：

- 期望行为：Spike A 在启动阶段取得目标窗口后，用**句柄 + 进程 ID** 锁定它；每一轮按句柄
  复核存活并沿用；标题不再参与定位。
- 保留行为：动作白名单、激活后的句柄 + 进程 ID 前台复核、每轮急停、报告字段与 19/20 阈值、
  无锁定时 `find_window` 的标题回退路径（生产命令路径不变）。
- 禁止行为：目标窗口消失时不得改用其它窗口；不得对未通过存活复核的窗口执行输入。
- 新增错误码 `TARGET_WINDOW_LOST`（已锁定的窗口被关闭或替换），线上 `errorCode` 为自由字符串，
  无需改契约 schema；`docs/03` 错误码表已同步。
- 接口设计：`WindowsDesktopActionExecutor.pin_target/clear_pinned_target` 只在**夹具显式锁定时**
  生效；`WindowsBackend` Protocol 新增 `list_process_windows`，用于每次命令前的存活复核
  （要求句柄与进程 ID 同时匹配，避免句柄回收后被复用）。

## 操作记录

1. `windows_executor.py`：新增 `list_process_windows` Protocol 方法、`pin_target` /
   `clear_pinned_target` / `_resolve_window`（锁定窗口优先，失效抛 `TARGET_WINDOW_LOST`）。
2. `windows_backend.py`：`start_notepad` 返回 `WindowTarget`；新增公开
   `list_process_windows`。
3. `notepad_spike.py`：`start_notepad` 返回目标窗口并 `pin_target`；新增
   `_require_live_target` 用于启动复核与每轮读取前复核；`_run_iteration` 改为接收目标窗口
   （标题仅作为回退条件传入 `title_contains`）。
4. 测试：`test_windows_executor.py` 新增 3 个锁定用例并扩展 fake；
   `test_notepad_spike.py` fake 改为窗口目标并新增句柄锁定用例；
   `test_windows_backend.py` 新增 `list_process_windows` 用例并更新 `start_notepad` 断言。
5. 质量门；同步 `docs/03`、`docs/07` §12、`docs/08`。

## 文件变更

- `apps/desktop-agent-python/src/desktop_agent/windows_executor.py`
- `apps/desktop-agent-python/src/desktop_agent/windows_backend.py`
- `apps/desktop-agent-python/src/desktop_agent/notepad_spike.py`
- `apps/desktop-agent-python/tests/test_windows_executor.py`
- `apps/desktop-agent-python/tests/test_windows_backend.py`
- `apps/desktop-agent-python/tests/test_notepad_spike.py`
- `docs/03-contracts-and-data.md`、`docs/07-windows-test-environment.md`、
  `docs/08-development-status.md`
- `changelog/2026-10-04-fix-notepad-window-targeting-3.md`：本记录。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `npm run check:python`（ruff format/check、mypy strict、pytest） | PASSED | 28 文件格式一致；lint 全过；mypy 零问题；**137 passed、2 skipped、覆盖率 92.41%**。 |
| 锁定窗口优先于标题查找 | PASSED | 传入失效标题仍成功激活；未调用 `find_window`；按进程名列出了窗口。 |
| 锁定窗口消失时失败关闭 | PASSED | 进程窗口列表为空 → `TARGET_WINDOW_LOST`，且未执行任何激活。 |
| 锁定窗口不跨进程生效 | PASSED | 锁定微信窗口时，记事本命令仍走标题回退路径。 |
| Spike 句柄锁定贯通 | PASSED | 2 轮迭代零次 `find_window`，存活复核次数 = 1（启动）+ 2×迭代。 |
| 启动阶段窗口丢失 | PASSED | 以 `TARGET_WINDOW_LOST` 作为 `setup_error`，0 轮迭代。 |
| 真实 Windows 20 轮 Spike A | NOT_EXECUTED | 待用户在关闭全部记事本窗口后重跑。 |

## 问题与处理

- 现象：四次实机尝试均以 `TARGET_WINDOW_NOT_FOUND` 或相邻错误码失败，且"无输入"的诊断全部正常。
  - 根因：该记事本用文档第一行改写窗口标题，运行自身输入即破坏标题条件。
  - 处理：改为按句柄锁定，标题仅作回退。
  - 结果：定位不再依赖会被运行改写的状态。
- 现象：编辑测试时 `_run_iteration` 的签名与调用点顺序需同步调整。
  - 处理：一次性替换调用点与定义，并以质量门复核。
  - 结果：137 项用例通过。

## 风险与限制

- 若该记事本在输入过程中重建窗口（句柄变化），会以 `TARGET_WINDOW_LOST` 失败；需要重跑或改用它
  自己的稳定定位键。目前诊断未观察到重建。
- WinUI3 记事本编辑区控件能否被 `read_document_text` 唯一定位仍未验证；若不能将出现
  `UI_ELEMENT_NOT_FOUND`。
- 真实 20 轮成功率仍未取得，`docs/08` 的 M0 项保持未验证。
- 锁定机制目前只由 M0 夹具使用；微信等多窗口应用仍需通过标题或其它确定性条件消歧。

## 最终结果

- 已完成：Spike A 改为按窗口句柄锁定目标，标题失效不再影响运行；新增 `TARGET_WINDOW_LOST`
  并同步契约文档；Python 质量门全绿（137 passed、92.41%）。
- 未完成：真实 Windows 20 轮 Spike A。
- 下一步建议：关闭全部记事本窗口后重跑 `npm run test:spike:m0:notepad`；预计要么通过并产出
  20 轮报告与截图，要么给出 `UI_ELEMENT_NOT_FOUND` 等下一步线索。
