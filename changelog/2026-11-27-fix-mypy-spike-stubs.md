# 修复测试桩缺失 `window_wrapper` 导致的 Python 类型门失败

## 元信息

- 日期：2026-11-27
- 状态：已完成
- 环境：Windows 11 build 26200；Node 24 / npm 11；Python 3.11（uv）；mypy 2.3.1

## 目标

- 恢复 `main` 上文档规定的质量门 `npm run check`（其中 Python 步骤为 `mypy src tests`）。

## 上下文与证据

- 在 `main`（`621ac46`）实跑 `npm run check`，在 `typecheck:python` 步骤失败：
  `Found 16 errors in 2 files`，全部为 `Cannot instantiate abstract class ... with abstract
  attribute "window_wrapper"`，集中在 `tests/test_notepad_spike.py`（5 个桩类、11 处实例化）
  与 `tests/test_notepad_mouse_spike.py`（`SimulatedNotepadBackend` 及其 5 个子类、5 处实例化）。
- 根因：观察层提交 `fefdc48` 给 `WindowsBackend` 协议新增了 `window_wrapper(target)`，
  但该提交的验证表只跑了 `.venv/Scripts/mypy.exe src/desktop_agent`，**没有跑 `tests`**；
  而 `package.json` 的 `typecheck:python` 是 `mypy src tests`。测试桩因此从未被新协议检查过。
- 同一提交的 pytest 244 项全通过，说明这是纯类型层缺口，不影响运行行为。

## 分析与决策

- 两个桩基类已集中提供"仅为满足协议、调用即断言"的成员（`window_bounds`、`locate_control`、
  `display_profile` 等，见 `test_notepad_spike.py` 中的注释）。沿用同一模式补
  `window_wrapper`，实现为 `raise AssertionError`：
  - 该桩只服务记事本/鼠标 Spike，不应进入观察采集路径，静默返回空对象会掩盖误用；
  - 断言比 `NotImplementedError` 更贴合同文件既有约定。
- 只改两个基类：5 个 `FakeSpikeBackend` 子类与 5 个 `SimulatedNotepadBackend` 子类自动继承。
- 未改 `WindowsBackend` 协议本身：`window_wrapper` 是观察层真实需要的成员，问题在测试侧未跟进。

## 操作记录

1. 复现 `npm run check` 失败并定位到 6 个桩类。
   - 结果：成功。错误全部可归因到同一缺失成员。
2. 在两个桩基类补 `window_wrapper`。
   - 结果：成功。
3. 复跑 `mypy src tests`、pytest 与完整 `npm run check`。
   - 结果：成功（详见验证表）。

## 文件变更

- `apps/desktop-agent-python/tests/test_notepad_spike.py`：`FakeSpikeBackend` 补
  `window_wrapper`（覆盖 4 个子类）。
- `apps/desktop-agent-python/tests/test_notepad_mouse_spike.py`：`SimulatedNotepadBackend`
  补 `window_wrapper`（覆盖 5 个子类）。
- `docs/08-development-status.md`：更新 Python 质量门的最新实测数字（244 通过 / 92.60% /
  mypy 0 错误），保留原 CI run 记录。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `uv run mypy src tests` | PASSED | 33 个文件 0 错误 |
| `uv run pytest` | PASSED | 244 通过 / 2 跳过；覆盖率 92.60% |
| `npm run check`（含 Node 格式/lint/类型/构建/测试、Python 四步、M1 集成） | PASSED | exit 0；集成 `{"result":"passed"}` |

## 问题与处理

- 现象：质量门在 `mypy src tests` 处红灯 16 项。
- 根因：`fefdc48` 新增协议成员后只对 `src/desktop_agent` 跑了 mypy，测试桩未同步。
- 处理：按同一文件的桩约定补断言版本。
- 结果：全门通过。

## 风险与限制

- 该修复只让类型门重新覆盖测试代码，不新增真实环境验证；`docs/08` 中微信接收、AI 页面、
  购物站点等未验证项不受影响。
- 若后续再向 `WindowsBackend` 协议加成员，仍需同时更新测试桩，否则会重现同类失败。

## 最终结果

- `main` 的 Python 类型门恢复绿色，`npm run check` 整体通过。
- 下一步：以 `main` 为基准吸收 `feature/pywinauto1`（微信发送 Spike 与中期评估）。
