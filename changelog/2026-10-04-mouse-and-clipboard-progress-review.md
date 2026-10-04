# 进度评审：10-20 目标（系统搭建 + 鼠标/剪贴板自动控制）

## 元信息

- 日期：2026-10-04
- 状态：已完成（只读评审）
- 环境：Windows 11 build 26200；只读核对，未运行构建或测试

## 目标

- 对照"10-20 之前完成系统搭建与鼠标、剪贴板自动控制"的目标，给出基于仓库事实的进度结论与缺口。

## 上下文与证据

- 目标映射：`docs/04-implementation-plan.md` 的 M1 为 **2026-10-08 至 2026-10-20**；
  §3 首批任务表中与本目标直接相关的是 `INFRA-01`（Monorepo 与质量工具，1 人日）、
  `API-01`（OpenAPI 与 WebSocket 契约，2 人日）、`DB-01`（Schema 与 migration，2 人日）、
  `AGENT-01`（注册、心跳、重连，3 人日）、**`AGENT-02`（UIA/Input/Clipboard 基础层，4 人日）**。
- 需求出处：`docs/01` §1 要求"展示鼠标、键盘、剪贴板和窗口自动化能力"；`docs/02` §组件职责
  写明 Agent"驱动窗口、控件、键盘、鼠标和剪贴板"；`docs/05` AT-10 要求紧急停止 2 秒内
  停止输入，检查项含"无卡住的鼠标按键"。
- 契约事实：`packages/contracts/src/index.ts` 的桌面动作仅有
  `WINDOW_ACTIVATE`、`TAKE_SCREENSHOT`、`CLIPBOARD_SET_TEXT`、`INPUT_KEY_CHORD`（外加微信
  `WECHAT_READ_NEW_MESSAGES` / `WECHAT_SEND_TEXT`），**没有任何鼠标动作**。
- 代码事实：全仓库检索 `MOUSE_*` / `MouseClick` / `click_input` / `SendInput` / `Cursor.Position`
  / `doubleClick`，除测试与 changelog 中"急停不再注入鼠标事件"的断言外**零命中**；
  `windows_executor._execute_sync` 的动作分支只有窗口激活、剪贴板写入、按键组合、截图。
- 剪贴板事实：`CLIPBOARD_SET_TEXT` 已实现（执行器分支 + `PywinautoWindowsBackend.set_clipboard_text`），
  读取能力 `get_clipboard_text` 仅用于 Spike 的读回校验，**未作为对外桌面动作暴露**。
- 实机证据：2026-10-04 记事本 Spike A **20/20 通过**（窗口激活、前台复核、Ctrl+A/Ctrl+V、
  剪贴板写入与读回、编辑区文本读回、窗口截图、输入释放），报告 `error_counts` 为空，
  20 张截图 913×583 并已人工目视复核通过。
- `docs/08` 现状：M1 记为"代码完成，验收未完成"；未完成项含
  `npm run test:stability:m1`（两小时连接）、目标 Windows 实机的 Agent 运行与重启恢复、
  两秒急停释放实机验证。

## 分析与决策

逐项结论（对照首批任务表）：

| 任务 | 估算 | 状态 | 依据 |
|---|---|---|---|
| INFRA-01 Monorepo 与质量工具 | 1 人日 | 完成 | npm workspaces、ESLint/Prettier/Ruff/mypy、统一 `npm run check` |
| API-01 OpenAPI 与 WebSocket 契约 | 2 人日 | 完成 | `contracts/openapi.yaml`、TypeBox 严格模型、跨语言契约测试；**动作集不含鼠标** |
| DB-01 Schema 与 migration | 2 人日 | 完成 | SQLite 两阶段 migration 覆盖全部实体 |
| AGENT-01 注册、心跳、重连 | 3 人日 | 完成 | 真实 Node/Python 进程集成测试 + CI `windows-latest` 通过 |
| AGENT-02 UIA/Input/Clipboard 基础层 | 4 人日 | **部分完成** | 窗口激活/前台复核/按键/剪贴板写入+读回/截图/输入释放已完成并实机 20/20；**鼠标动作 0 实现**；剪贴板读取未对外暴露 |
| WECHAT-01/02、FLOW-01、WEB-01、AI-01、SHOP-01/02、TEST-01 | 29 人日 | 跨平台代码完成或未开始 | FLOW/WEB 已完成（Fake/夹具验证）；微信与站点 Adapter 未实机校准 |

M1 退出标准三项现状：契约测试通过（✓）、服务重启恢复连接（✓）、
Agent 连续两小时保持连接（`npm run test:stability:m1` 未执行 ✗）。

结论：

- "搭建系统"对应的工程骨架（INFRA-01/API-01/DB-01/AGENT-01）**已完成**，且 Windows 基础
  执行器已取得实机证据。
- "剪贴板自动控制"**已完成并经实机验证**（写入 + 读回）。若验收要求包含"读取剪贴板"这一
  独立动作，则需补一个 `CLIPBOARD_GET_TEXT` 契约动作（当前读取只存在于内部校验路径）。
- "鼠标自动控制"**进度为 0**：契约动作、Python 协议模型、执行器分支、后端实现、策略白名单
  条目、单元测试与文档全部缺失。这是 10-20 目标中唯一的硬缺口。

## 操作记录

1. 检索契约与协议中的动作集，确认无鼠标动作。
   - 结果：确认；`index.ts` 4 个桌面动作、`protocol.py` 对应 4 个 Literal 动作类。
2. 全仓库检索鼠标实现关键字与剪贴板能力边界。
   - 结果：确认鼠标零实现；剪贴板读取仅内部使用。
3. 核对 `docs/01`/`02`/`04`/`05`/`08` 中与本目标相关的需求、任务与验收项。
   - 结果：确认目标映射与退出标准现状。

## 文件变更

- `changelog/2026-10-04-mouse-and-clipboard-progress-review.md`：本记录。
- 未修改任何代码、契约、测试或文档正文。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| 契约动作集检索 | PASSED | 无鼠标动作（4 个桌面动作）。 |
| 鼠标实现关键字全仓检索 | PASSED | 除"不再注入鼠标事件"的测试断言外零命中。 |
| 剪贴板实现与实机证据核对 | PASSED | 写入 + 读回已实现；Spike A 20/20 覆盖。 |
| M1 退出标准与 `docs/08` 未完成项核对 | PASSED | 两小时稳定性等 3 项未执行。 |
| 构建 / 测试 / 实机验证 | NOT_EXECUTED | 本次为只读评审。 |

## 问题与处理

- 现象：需求（`docs/01`/`02`）明确要求鼠标自动化能力，但契约与实现中完全缺失。
  - 根因：`AGENT-02` 只落地了 UIA 窗口/输入/剪贴板部分，鼠标动作从未进入契约与实现。
  - 处理：在评审中列为唯一硬缺口，并给出落地清单（见"最终结果"）。
  - 结果：待用户确认鼠标动作范围后实施。

## 风险与限制

- 本评审只依据仓库事实；若用户在别处另有"鼠标已完成"的实现或不同口径的目标，需要据实修正。
- 鼠标动作属于守卫中的高风险项（可能点到目标窗口之外），实现必须遵循"语义化定位优先、
  坐标仅兜底且需校验窗口/分辨率/DPI"；一旦引入真实按键，急停路径必须同步补上按键释放。
- 目标 10-20 距今 16 天，但微信/站点真实环境项仍依赖 SPIKE-01/02/03，尚未启动。

## 最终结果

- 已完成：给出进度结论——系统搭建（骨架）完成；剪贴板自动控制完成且实机验证；
  **鼠标自动控制 0%**，为唯一硬缺口。
- 未完成：鼠标动作落地；剪贴板读取动作（若验收要求）；M1 两小时稳定性与实机 Agent 验收。
- 下一步建议（补齐 10-20 目标，建议顺序）：
  1. 确认鼠标动作范围（控件中心点击 / 任意坐标点击 / 拖拽 / 滚动）与目标场景；
  2. 契约同步：`packages/contracts/src/index.ts` + `contracts/openapi.yaml` + Python
     `protocol.py` 新增鼠标动作与参数模型；
  3. 执行器与后端：`windows_executor` 分支 + `windows_backend` 点击实现（语义定位优先，
     坐标兜底须校验前台窗口、分辨率与 DPI）；急停路径补按键状态跟踪与释放；
  4. 测试：Fake 单测（白名单、前台复核、坐标兜底校验、急停释放）+ 目标 Windows 实机 Spike；
  5. 文档：`docs/03`（动作与错误码）、`docs/05`（测试与 AT-10）、`docs/07`（实机步骤）、
     `docs/08`（状态）；最后执行 `npm run test:stability:m1` 补齐两小时连接验收。
