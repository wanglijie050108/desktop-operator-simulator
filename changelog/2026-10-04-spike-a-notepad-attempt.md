# Spike A 首次执行：提交推送与记事本 20 轮实机尝试

## 元信息

- 日期：2026-10-04
- 状态：受阻（推送受网络阻塞；Spike A 受执行环境阻塞，未取得验收证据）
- 环境：Windows 11（build 26200）、Python 3.11.6（uv 0.11.14）、pywinauto 0.6.9；
  **命令执行令牌为 Low 完整性级别**，桌面会话 ID = 1

## 目标

- 提交并推送 changelog 精简整理。
- 执行 M0 Spike A（记事本 20 轮），取得 Windows 基础执行器的首个实机证据。

## 上下文与证据

- 提交前状态：`main` 干净、领先 `origin/main` 2 个提交的基线为 `5cc84b6`。
- 本机只读探测：`uv 0.11.14`、`node v24.15.0`、`npm 11.12.1` 可用，`dotnet` 不可用；
  `apps/desktop-agent-python/.venv` 与 `node_modules` 已存在；无记事本进程。
- Spike 报告（`data/artifacts/m0/reports/notepad-spike-20261004-034849490350.json`）：
  `success_count = 0`、`success_rate = 0.0`、`error_counts = {TARGET_APP_NOT_FOUND: 20}`、
  `setup_error = null`；环境元数据 `os=Windows-10-10.0.26200-SP0`、`python=3.11.6`、
  `pywinauto=0.6.9`、`1920x1080`、**`dpi=120`**；20 轮单轮耗时 12–17 ms。
- 聚焦诊断 `data/artifacts/m0/diag_notepad.py`（pywinauto 直连）：
  `Desktop(backend="uia").windows(visible_only=True, enabled_only=True)` 返回
  **0 个窗口**、可读取 `process_id` 的窗口 **0 个**；`tasklist` 对 `notepad.exe` 返回 0 行。
- 令牌检查：`whoami /groups` 显示 `Mandatory Label\Low Mandatory Level`。
- pywinauto API 核对：`pywinauto.application.Application` 无 `process_module`，
  但 `windows_backend.py` 实际调用的是**模块级函数**
  `pywinauto.application.process_module(pid)`，该函数存在且返回正确路径
  （自测 pid → `C:\Program Files\Python311\python.exe`）。

## 分析与决策

- Spike A 的 0/20 是**执行环境限制**，不是产品缺陷：本会话所有命令以 **Low 完整性令牌**运行，
  UIA 桌面枚举被 UIPI 拦到 0 个窗口，`find_window` 必然找不到记事本，于是每轮在
  ~14 ms 内以 `TARGET_APP_NOT_FOUND` 快速失败；这也解释了耗时异常短。
- 因此**本次 0/20 不构成对执行器的负面结论，也不构成任何 M0 验收证据**；
  `docs/08` 的“Windows 实机验证未执行”状态保持不变。
- 已排除代码缺陷假设：`process_module` 的模块级调用方式正确（见上），
  原先怀疑的“API 误用导致窗口被静默跳过”不成立。
- 结论：M0 Spike 必须在**普通用户权限（中等完整性）的交互式桌面**中运行，
  由用户在自己的 PowerShell 窗口执行；这与 `docs/07` §12 的手工执行协议一致。
- 新发现的环境偏差：实际显示缩放为 **DPI 120（125%）**，而 `docs/07` 要求
  1920×1080 且缩放 **100%**；这是需要在实机验收前项固化的差异，暂不改文档。
- uv 默认缓存目录 `C:\Users\HP\AppData\Local\uv\cache` 在受限令牌下不可写，
  本次以 `UV_CACHE_DIR` / `UV_PYTHON_INSTALL_DIR` 重定向到工作区内才得以执行；
  用户自己的常规终端无需该重定向。

## 操作记录

1. 提交 changelog 精简整理（2 个提交）。
   - 结果：成功；`9975b24`（归档整理，40 个文件变更）、`9ddbe46`（回顾与建议记录）。
2. `git push origin main`。
   - 结果：失败（两次）；`fatal: unable to access ... Failed to connect to github.com port 443`。
3. 网络诊断：`www.baidu.com:443` 通、`gitee.com:443` 通、`github.com` DNS 解析正常
   （`20.205.243.166`），但 443 连接失败；本机 7890/7897/10809/1080 代理端口均无监听。
   - 结果：判定为 GitHub 直连被阻断且本机代理未开启。
4. 执行 Spike A（`npm run test:spike:m0:notepad`，`AGENT_ARTIFACT_DIR` 指向工作区）。
   - 结果：失败；0/20，全部 `TARGET_APP_NOT_FOUND`，报告已落盘。
5. 运行聚焦诊断脚本并核对 pywinauto API。
   - 结果：确认 0 个可见窗口、令牌为 Low 完整性、调用方式正确。

## 文件变更

- `changelog/2026-10-04-spike-a-notepad-attempt.md`：本记录。
- `data/artifacts/m0/reports/notepad-spike-20261004-034849490350.json`：Spike A 报告（`data/` 已 gitignore）。
- `data/artifacts/m0/diag_notepad.py`：聚焦诊断脚本（`data/` 已 gitignore）。
- 未修改任何产品代码、测试、契约或 `docs/`。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git commit`（changelog 整理 + 记录） | PASSED | `9975b24`、`9ddbe46`；`main` 领先 `origin/main` 2 个提交。 |
| `git push origin main` | FAILED | 连接 `github.com:443` 失败（两次）；本地提交已保留。 |
| 网络连通性诊断 | PASSED | 百度/Gitee 通，GitHub 443 不通，无本地代理监听。 |
| `npm run test:spike:m0:notepad` | FAILED | 0/20，全部 `TARGET_APP_NOT_FOUND`；受 Low 完整性令牌限制，**不作为实机验收证据**。 |
| pywinauto 桌面窗口枚举（诊断脚本） | FAILED | 可见窗口 0 个、可读 pid 窗口 0 个，判定为 UIPI/完整性限制。 |
| `pywinauto.application.process_module` API 核对 | PASSED | 模块级函数存在且返回正确进程路径，排除代码误用假设。 |
| M0 Spike A 有效实机验证 | NOT_EXECUTED | 需由用户以普通权限在交互式桌面执行。 |

## 补充证据：UIA 通道复测（同日，沙箱策略改为完全访问后）

- 令牌已从 Low 变为 **Medium Mandatory Level**，但仍无法使用 UIA：
  - Win32 `EnumWindows`：**485 个顶层窗口**，16 个有标题，`GetForegroundWindow` 有句柄，
    window station = `WinSta0`、thread desktop = `Default`、会话 ID = 1。
  - pywinauto `Desktop(backend="win32").windows(visible_only, enabled_only)`：**25 个**。
  - pywinauto `Desktop(backend="uia").windows(visible_only, enabled_only)`：**0 个**。
  - `comtypes.client.CreateObject("UIAutomationClient.CUIAutomation")`：
    `OSError [WinError -2147221005]`（无效的类字符串）。
  - 注册表：`HKCR\UIAutomationClient.CUIAutomation`（及 `...Automation8`）**ProgID 缺失**，
    但其 CLSID `{ff48dba4-60ef-4201-aa87-54103eef594e}` 存在，`UIAutomationCore.dll` 存在。
- 结论：本会话的 UIA/COM 通道不可用（可能为沙箱注册表与 COM 限制，也可能为本机注册差异，
  在该上下文内无法区分）；`notepad_spike` 写死 `backend="uia"`，故在本环境必然 0/20。
- 因此给用户的预检命令：在自己的常规终端执行
  `uv run --directory apps/desktop-agent-python python -c "from pywinauto import Desktop; print(len(Desktop(backend='uia').windows(visible_only=True, enabled_only=True)))"`；
  若该值仍为 0，则属本机 pywinauto/UIA 可用性缺陷，是 M0 的硬阻塞，优先级高于跑满 20 轮。

## 用户常规终端复测（决定性结论）

- 用户在自己的 PowerShell 中执行预检，输出 `uia: 11`、`win32: 26`。
- 结论：本机 UIA 通道**正常**；此前的 `uia = 0` 是**代理执行上下文（沙箱）特有**的限制，
  既非机器缺陷也非产品代码缺陷。Spike A 需且只能由用户在常规交互式终端执行。
- 遗留待验证项：环境元数据中的 `dpi = 120`（125% 缩放）与 `docs/07` 要求的 100% 不符，
  需在实机验收前固化。

## 第二次实机运行（用户常规终端）与新根因

- 用户在其常规 PowerShell 中执行 Spike A：
  - `dpi` 已为 **96**（缩放已修正为 100%）；`screenWidth/Height = 1920/1080`。
  - 结果仍是 0/20，但错误码变为 **`TARGET_WINDOW_MISMATCH` ×20**（单轮 699–1956 ms），
    并伴随 pywinauto 警告 `RuntimeWarning: Application is not loaded correctly
    (WaitForInputIdle failed)`。
- 聚焦诊断（Win32 `EnumWindows` + `QueryFullProcessImageNameW`，脚本位于 `data/artifacts/m0/`）：
  - 本机 `notepad.exe` 实际启动的是**商店版记事本应用**
    `C:\Program Files\WindowsApps\Microsoft.WindowsNotepad_11.2607.14.0_x64__8wekyb3d8bbwe\Notepad\Notepad.exe`。
  - 同一进程（pid 54864）存在 **2 个可见顶层窗口**，`class = Notepad`，均为 913×583：
    一个新建无标题文档窗口，以及一个**用户已打开的文档窗口**（标题含敏感文件名，不记录）。
  - 另有 12 个不可见的辅助窗口（`Microsoft.UI.Content.PopupWindowSiteBridge`、`MSCTFIME UI`、
    `IME`、`GDI+ Hook Window Class`），`visible_only`/`enabled_only` 会过滤掉大部分。
- 根因：`PywinautoWindowsBackend.find_window` 要求按进程名匹配的可见窗口**恰好一个**
  （`len(title_matches) != 1` → `TARGET_WINDOW_MISMATCH`）。Win11 商店版记事本把**同一实例的
  所有文档窗口放在一个进程里**，因此只要用户还开着任意一个记事本文档，20 轮全部立即失败。
  该错误码与实测完全吻合；也解释了 `WaitForInputIdle failed`（打包应用启动器不是传统 Win32 应用）。
- 风险提示（已告知用户）：在用户文档窗口存在的情况下，若 `find_window` 放行，后续
  `Ctrl+A` + `Ctrl+V` 会覆盖该窗口编辑区内容；磁盘文件在未保存前不变，但 Win11 记事本具备
  会话恢复行为。用户被要求在运行前关闭**全部**记事本窗口且不保存。
- 结论：这是 **Spike A 与 Win11 现代记事本的环境/实现不兼容**，属 M0 应当发现的真实问题，
  需要二选一处理：① 运行时保证无其它记事本窗口（零代码改动）；② 让 `find_window` 以确定性
  规则消歧（同时避免"只认唯一窗口"这一假设被真实应用打破）。WinUI3 记事本的
  Document/Edit 控件能否被 `read_document_text` 唯一定位，仍需实机确认。

## 问题与处理

- 现象：Spike A 20 轮全部 `TARGET_APP_NOT_FOUND`，单轮仅 12–17 ms。
  - 根因：执行令牌为 Low 完整性，UIA 桌面枚举返回 0 个窗口。
  - 处理：以聚焦诊断脚本与令牌检查定位；确认非产品缺陷。
  - 结果：判定为环境受限，需改由用户常规终端执行。
- 现象：uv 首次运行报 `Failed to initialize cache ... 拒绝访问 (os error 5)`。
  - 根因：默认缓存在用户 AppData，受限令牌不可写。
  - 处理：设置 `UV_CACHE_DIR`、`UV_PYTHON_INSTALL_DIR` 到工作区内。
  - 结果：可正常执行。
- 现象：`git push` 连接被重置/超时。
  - 根因：GitHub 443 在本机当前网络路径下不可达且代理未开。
  - 处理：记录并等待用户开启代理后重试。
  - 结果：未解决（阻塞中）。

## 风险与限制

- 本次未取得任何真实桌面自动化成功率数据；`docs/08` 的 M0 项仍为未验证。
- 报告中 `dpi=120` 与 `docs/07` 要求的 100% 缩放不符，真实 DPI 下的定位稳定性未知。
- 推送阻塞期间本地已有 2 个未推送提交，若他处同时修改远端会产生分叉，需在推送前
  `git fetch` 复核。

## 最终结果

- 已完成：changelog 整理已提交（`9975b24`、`9ddbe46`）；Spike A 已实际执行并产出报告；
  根因（Low 完整性令牌导致 UIA 枚举为 0）已用聚焦实验证实，并排除代码缺陷假设。
- 未完成：`git push`（网络阻塞）；Spike A 的有效实机验证（需用户常规权限终端）。
- 下一步建议：用户开启代理后重试推送；在普通 PowerShell 中以
  `$env:AGENT_ARTIFACT_DIR` + `npm run test:spike:m0:notepad` 重跑 Spike A；
  并在实机验收前把显示缩放固定为 100%（当前 125%）。
