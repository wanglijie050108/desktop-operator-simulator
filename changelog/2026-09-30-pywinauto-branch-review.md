# 迁移分支拉取、changelog 通读与 Windows 质量门实测

## 元信息

- 日期：2026-09-30
- 状态：已完成
- 环境：Windows 11（NT 10.0.26200）；Node.js 24.15.0、npm 11.12.1；
  uv 0.11.14 + CPython 3.11.6（`C:\Program Files\Python311`）；.NET SDK 仅 8.0.101/8.0.206；
  目标机微信 `Weixin.exe`（微信 4.x）正在运行且主窗口标题为“微信”

## 目标

- 拉取并切换到 `feature/pywinauto-desktop-agent`，通读其相对 `main` 的迁移 changelog。
- 按用户“不推倒重来、采用迁移策略”的意图，核对迁移进度与实际可运行范围。
- 在真实 Windows 目标机上验证该分支声明的质量门，区分“macOS 通过”与“Windows 通过”。

## 上下文与证据

- `git fetch origin --prune` 后切换分支成功，跟踪
  `origin/feature/pywinauto-desktop-agent`，HEAD 为 `0bde877`。
- 该分支相对 `main` 领先 11 个提交，新增 39 个文件、约 6000 行，其中
  `apps/desktop-agent-python/` 为新 Python Agent（14 个源文件、13 个测试文件）。
- 已通读该分支独有的 changelog：`2026-09-25-master-pull-analysis.md`、
  `2026-09-28-changelog-reconciliation.md`、`2026-09-28-pywinauto-implementation-plan.md`、
  `2026-09-28-python-agent-transport.md`、`2026-09-28-python-agent-dispatcher.md`、
  `2026-09-28-python-windows-actions.md`、`2026-09-28-windows-notepad-spike.md`、
  `2026-09-28-python-wechat-ingress.md`、`2026-09-28-wechat-uia-inspection.md`。
- 上述记录中所有真实 Windows 项均为 `BLOCKED`，原因统一写为“当前为 macOS，需目标
  Windows 11 交互式桌面”；跨平台项均记为 `PASSED`。
- 实测证据：`npm run check:python` 在 Windows 上 `FAILED`（mypy 2 项）；
  `npm run test:python` 在 Windows 上 `FAILED`（2 项失败、107 项通过、2 项跳过，
  覆盖率 91.45% 达标）。

## 分析与决策

- 迁移路线判断：分支实现的是“保留 Node 控制平面 + Vue + SQLite + 契约，用 Python
  Agent 替换 C# 桌面执行角色”，与用户“不推倒重来”的意图一致；C# 仍保留为基线。
- 迁移完成度判断：Python Agent 已完成协议、传输、安全调度、Windows 基础动作、
  微信消息接收基础层和只读 UIA 取证工具；真实微信 selector、真实消息源、Node 桌面
  命令结果桥与真实聊天回复仍未实现，桌面动作默认失败关闭。
- 关键环境发现：本机即为该分支全流程等待的 Windows 目标机，且微信 4.x 正在运行，
  取证工具允许的进程名 `Weixin.exe` 与之匹配，因此“微信 UIA 取证”这一阻塞项在本机
  具备执行条件。
- 质量门实测结论：分支 changelog 中“全绿”的有效范围仅限 macOS。在真实 Windows 上
  存在两处缺陷，均与本机平台差异直接相关：
  1. `windows_backend.py` L152/L163 的 `ctypes.windll.user32` 带
     `# type: ignore[attr-defined]`；该 ignore 在 macOS 必需，在 Windows 上（stub 定义
     了 `windll`）变为多余，触发 mypy `strict` 的 `unused-ignore` 报错。
  2. `tests/test_config.py`、`tests/test_uia_inspection.py` 直接断言
     `str(Path) == "C:/automation-data/artifacts"`；macOS 下 `Path` 保留正斜杠，Windows
     下渲染为反斜杠，导致断言失败。两处失败同属一类跨平台断言缺陷。
- 处理取舍：本次任务为只读通读与实测取证，不修改产品代码、测试或依赖，缺陷修复与
  是否需要合并到 `main` 交由用户决定。

## 操作记录

1. `git fetch origin --prune` 并 `git switch feature/pywinauto-desktop-agent`。
   - 结果：成功；工作树仅保留上一任务新建的未跟踪 changelog。
2. 列出自该分支独有的 changelog 与 11 个提交的逐提交文件清单。
   - 结果：成功；确认迁移按七个阶段推进且提交边界清晰。
3. 通读全部迁移 changelog，核对每项 `PASSED`/`BLOCKED` 的声称范围。
   - 结果：成功；确认真实 Windows 项全部未执行。
4. 检查本机平台与目标应用。
   - 结果：成功；确认为 Windows 11 且 `Weixin.exe` 正在运行。
5. 在 Windows 上执行 `npm run check:python` 与 `npm run test:python`。
   - 结果：失败；`uv` 自动创建 `.venv` 并安装 27 个包（含 Windows 条件的 pywinauto、
   pywin32、Pillow），随后 mypy 报 2 项、pytest 报 2 项失败。
   - 影响：`.venv` 与 `uv.lock` 相关的本地环境产物为新建；未修改任何跟踪文件。

## 文件变更

- `changelog/2026-09-30-pywinauto-branch-review.md`：新增本任务记录。
- 未修改任何产品代码、测试、契约或配置；`uv run` 自动创建的
  `apps/desktop-agent-python/.venv` 属被忽略的本地环境产物。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git fetch origin --prune` / `git switch feature/pywinauto-desktop-agent` | PASSED | 分支建立并跟踪远端，HEAD `0bde877`。 |
| `git log --reverse main..HEAD` / 逐提交 `--name-only` | PASSED | 确认 11 个提交及 39 个新增文件。 |
| `npm run check:python` | FAILED | Ruff format/lint 通过；mypy 报 `windows_backend.py` L152/L163 `unused-ignore` 2 项，命令在此中断。 |
| `npm run test:python` | FAILED | 107 通过、2 失败、2 跳过；覆盖率 91.45% 达标；失败为 `test_config.py` 与 `test_uia_inspection.py` 的路径字符串断言。 |
| `uv run ... pytest -rs --no-cov` | PASSED | 跳过项为 2 个“仅非 Windows 适用”的平台守卫用例，跳过合理。 |
| `dotnet --list-sdks` | PASSED | 仅 8.0.101/8.0.206，低于 `global.json` 要求的 10.0.401。 |
| `npm run check:dotnet` | NOT_EXECUTED | 本机无 .NET 10 SDK，执行必失败。 |
| `npm run test:spike:m0:notepad` | NOT_EXECUTED | 会真实抢占前台窗口并覆盖剪贴板，需用户显式授权后执行。 |
| `npm run test:spike:m0:wechat-inspect` | NOT_EXECUTED | 只读但在运行中的真实微信上取证，需用户显式授权后执行。 |
| Windows 全链路 E2E / 真实微信收发 | NOT_EXECUTED | 真实 selector 与消息源尚未实现。 |

## 问题与处理

- 现象：`npm run check:python` 在 Windows 上 mypy 失败（2 项 `unused-ignore`）。
- 根因：`ctypes.windll` 仅在 Windows 的类型存根中存在，为 macOS 编写的
  `# type: ignore[attr-defined]` 在 Windows 上成为多余，`strict = true` 含
  `warn_unused_ignores`。
- 处理：本次仅定位与记录，未修改代码。可选修复方向：对
  `desktop_agent.windows_backend` 增加 mypy override 关闭 `warn_unused_ignores`，
  或改用 `getattr(ctypes, "windll")` 使其在两个平台都无需 ignore。
- 结果：缺陷已复现并定位到行，待用户决定是否修复。
- 现象：`test_config.py`、`test_uia_inspection.py` 各 1 项断言失败。
- 根因：断言比较 `str(Path)` 与含正斜杠的字面量，Windows 下分隔符被规范化。
- 处理：本次仅记录。最小修复为改为比较 `Path` 对象（同平台内路径比较会对分隔符
  归一），可同时满足 Windows 与 macOS。
- 结果：缺陷已复现，属跨平台可移植性缺陷而非产品逻辑缺陷。

## 风险与限制

- 上述 3 项缺陷说明该分支的“全绿”结论带有平台前提，合并进 `main` 前必须在 Windows
  上重新跑通质量门，不能直接沿用 macOS 结果。
- `.NET 10 SDK` 缺失使 `npm run check` 的 .NET 段与 `test:integration:m1:csharp` 在本机
  无法通过；Python 侧可独立验证，但整仓 `check` 暂时不可达绿。
- 微信 UIA 取证与记事本 Spike 均未执行，真实 pywinauto 兼容性、两秒急停和输入释放
  仍无实机证据。
- 迁移分支与 `main` 已分叉，后续在分支上继续工作时需注意 `main` 的两项提交
  （`96a589d`、`8227723`）尚未并入。

## 最终结果

- 已完成：分支拉取与切换、迁移 changelog 通读、本机平台核验，以及在真实 Windows 上
  对 Python 质量门的实测取证，形成本记录。
- 未完成：未修复实测发现的 3 项缺陷；未执行任何 M0 Spike 或真实微信/桌面动作。
- 下一步建议：先在 Windows 上修复 mypy 与两处路径断言并重跑 `check:python`；随后在
  获得用户授权后执行只读的微信 UIA 取证，取得控件树证据再冻结 selector；同时安装
  .NET 10 SDK 以恢复整仓质量门。
