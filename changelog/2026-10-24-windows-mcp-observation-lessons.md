# Windows-MCP 借鉴评估 → `DESKTOP_INSPECT_TREE` 真实采集实现

## 元信息

- 日期：2026-10-24
- 状态：已完成（跨平台验证）；真实 Windows 采集未执行
- 环境：Windows 11（开发主机）、Node 24 / TypeScript、Python 3.11.9 + pywinauto 0.6.9

## 目标

1. 评估 `github.com/CursorTouch/Windows-MCP` 对本项目的指导/借鉴价值。
2. 把评估中确定有价值、且**不触碰红线**的观察工程细节落地到
   `DESKTOP_INSPECT_TREE`：参数边界、进程排除、单次 UIA 调用超时、字符串卫生、
   商品列表页节点预算。

## 上下文与证据

- 阅读 Windows-MCP 的 `README.md`、源码树（`src/windows_mcp/` 约 40 个模块），
  精读 `tree/budget.py`、`tools/control_policy.py`、`tools/snapshot.py`、
  `tools/_snapshot_helpers.py`、`tools/control_policy.py`。未精读 `uia/controls.py`
  （225 KB）与 `desktop/service.py`（72 KB）。
- 本项目现状：`domain/observation.ts` 已有脱敏与显式截断；`uia_inspection.py` 有
  WeChat 专用一次性报告；`DESKTOP_INSPECT_TREE` 只有契约，**无 Python 执行器**，
  结果通道也没有承载观察的字段。

## 分析与决策

**结论：Windows-MCP 是"架构反例 + 工程范本"。** 它的安全模型是把 Windows 全能力
（含 `PowerShell`/`FileSystem`/`Registry`/`Process kill`）直接暴露给客户端 LLM 调用，
与本项目 ADR-010「LLM 只提议、不执行」及守卫 §3/§4 红线正面冲突，**不可照搬**；
但它的观察工程细节恰好覆盖了本项目未来必踩的坑。

据此采纳 5 项、拒绝全部权限模型：

| 采纳项 | 依据 | 落地 |
|---|---|---|
| 显式截断 + 硬上限 | `tree/budget.py` 注释记录了「未过滤的商品网格数千行会让目标应用卡死数分钟」 | `truncated` / `timedOut` 双标志 |
| 进程级排除 | `WINDOWS_MCP_EXCLUDE_PROCESSES`：某应用 a11y provider 会让 traversal 停滞 | `excluded_observation_processes`，**进入 UIA 之前**过滤 |
| 单次 UIA 调用超时 | 2s 连接 / 5s 事务，超时跳过该窗口而非整体失败 | `timeoutMs`（默认 5000） |
| 字符串卫生 | `repair_surrogates`：UIA 把 emoji 当裸 UTF-16 代理对返回，**一个 emoji 能让整条响应编码失败** | `observation_text.py` |
| 未知/越界保守处理 | `control_policy.py`：`category = "direct"  # Unknown tools must not silently bypass` | 契约 `processName` 加 `^[A-Za-z0-9_.-]+$`，路径一律拒收 |

取舍说明：

- **不改架构**：不引入 MCP、不把循环下放到 Python、不新增任何通用执行动作。
- **脱敏仍留在 Control Server**：Agent 只做字符合法性与长度，HMAC 密钥不出服务器。
  Windows-MCP 的 `name` 是明文进 prompt 的，本项目保持脱敏优先。
- **列表页预算 400 是工程起点，不是实测值**：默认 2000 对搜索结果网格过大（每行数个
  节点 × 每个节点进 prompt），400 能容纳十余行结果并靠 `truncated` 显式声明不足。
  该值需在 `docs/07` 环境实测后冻结，已在代码注释与 `docs/03` 标注。
- 实现中出现的**循环导入**（`observation.py` ↔ `windows_executor.py`）以
  `TYPE_CHECKING` + 本地 `_normalize_process_name` 解决，未引入新的分层。

## 操作记录

1. 评估 Windows-MCP 并给出采纳/拒绝清单。
   - 结果：成功。结论已写入本文「分析与决策」。
2. 契约扩展（Node + Python 双端）。
   - 结果：成功。`timeoutMs`、`ObservedTree`/`ObservedControlNode`、结果 `observation` 字段。
   - 影响：`packages/contracts`、`protocol.py`、共享 fixture。
3. 实现 Agent 侧采集与清洗。
   - 结果：成功。
   - 影响：新增 `observation_text.py`、`observation.py`；`windows_backend.py` 暴露
     `window_wrapper`；`windows_executor.py` 新增只读分支；`client.py` 回传观察。
4. 补测试与文档。
   - 结果：成功。Python 194 → 244（+50）、Node 262 → 272（+10）测试。

## 文件变更

- `packages/contracts/src/index.ts`：`DESKTOP_INSPECT_TREE` 增 `timeoutMs`；
  `processName` 改纯进程名正则（拒绝路径）；新增 `ObservedControlNodeSchema` /
  `ObservedTreeSchema`，结果新增可选 `observation`。
- `packages/contracts/test/contracts.test.ts`：新增 2 项契约测试（合法观察参数、
  路径与越界拒绝、结果多余字段拒绝）。
- `contracts/fixtures/websocket-v1/messages.json`：新增 `DESKTOP_INSPECT_TREE` 命令
  与带观察的结果各一条，供 Node/Python 双端共享校验。
- `apps/desktop-agent-python/src/desktop_agent/observation_text.py`（新）：代理对修复、
  私用区/控制/双向覆盖字符剥离、长度上限。
- `apps/desktop-agent-python/src/desktop_agent/observation.py`（新）：窗口解析、进程
  排除、逐节点超时遍历、显式截断、字段级清洗。
- `apps/desktop-agent-python/src/desktop_agent/protocol.py`：新增
  `DesktopInspectTreeArguments`、`ObservedControlNode`、`ObservedTree`；结果增
  `observation`；`AgentCapability` 增 `observe`。
- `apps/desktop-agent-python/src/desktop_agent/execution.py`：`CommandExecutionResult`
  携带 `observation`。
- `apps/desktop-agent-python/src/desktop_agent/windows_executor.py`：新增
  `DesktopInspectTreePayload` 分支（只读、不要求前台）、`excluded_observation_processes`。
- `apps/desktop-agent-python/src/desktop_agent/windows_backend.py`：新增
  `window_wrapper`。
- `apps/desktop-agent-python/src/desktop_agent/client.py`：结果回传 `observation`。
- `apps/desktop-agent-python/tests/test_observation_text.py`（新，10 项）、
  `test_observation.py`（新，30 项）、`test_windows_executor.py`（28 → 38，增 10 项）。
- `apps/control-server/src/domain/observation.ts`：新增
  `PRODUCT_LISTING_MAX_OBSERVATION_NODES = 400`、`FlatObservationNode`、`rebuildTree`。
- `apps/control-server/test/observation.test.ts`：增 8 项（列表预算、扁平树还原、
  字符卫生夹具）。
- `docs/03-contracts-and-data.md`：校正 `DESKTOP_INSPECT_TREE` 参数（原文的嵌套
  `target` 与实现不符）、补 `observation` 结果示例与参数表、补约束与错误码。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `npm run build --workspace @hos/contracts` | PASSED | 无错误 |
| `npx prettier --check`（control-server / contracts / fixtures） | PASSED | 全部符合 |
| `npx eslint apps/control-server packages/contracts` | PASSED | 0 错误 |
| `npx tsc -p apps/control-server/tsconfig.json --noEmit` | PASSED | 0 错误 |
| `npx vitest run packages/contracts apps/control-server` | PASSED | 22 文件 / **272 测试**通过（原 262，+10） |
| `.venv/Scripts/ruff.exe check src/ tests/` | PASSED | 全部通过 |
| `.venv/Scripts/ruff.exe format --check` | PASSED | 已格式化 |
| `.venv/Scripts/mypy.exe src/desktop_agent` | PASSED | strict 模式 0 错误 |
| `.venv/Scripts/pytest.exe` | PASSED | **244 通过** / 2 跳过；覆盖率 **92.60%**（门槛 90%） |
| 真实 Windows pywinauto 采集（打开浏览器列表页实际采集） | NOT_EXECUTED | 需交互式桌面会话与目标站点，本轮未执行 |
| 真实站点 a11y provider 卡死复现（验证超时行为） | NOT_EXECUTED | 需真实故障注入环境；当前仅用 `time.sleep` 伪造的假 wrapper 验证 |

新增测试证明的是**Agent 侧命令契约与纯函数行为**（预算、深度、超时、排除、清洗、
错误映射、只读性质），**不是**真实 pywinauto traversal 的正确性。

## 问题与处理

- 现象：`observation.py` 与 `windows_executor.py` 循环导入，pytest 8 个模块收集失败。
- 根因：`observation.py` 在模块级 `from .windows_executor import WindowTarget`。
- 处理：改为 `TYPE_CHECKING` 导入 + 本地 `_normalize_process_name`。
- 结果：收集恢复正常。

- 现象：Python 共享 fixture 测试报 `observation.processId: Extra inputs are not permitted`。
- 根因：`ObservedTree.process_id` 漏写 `Field(alias="processId")`，camelCase 无法解析。
- 处理：补齐别名。该测试（跨语言 fixture 校验）正好发现了真实缺陷。
- 结果：通过。

- 现象：契约测试发现 `processName: "C:\Windows\chrome.exe"` 被 Schema 接受。
- 根因：原 `processName` 只有长度约束，没有字符集约束。
- 处理：Node schema 与 Python `StringConstraints` 同步加 `^[A-Za-z0-9_.-]+$`。
- 结果：路径、引号、通配符均在契约边界被拒。

## 风险与限制

- **真实采集完全未验证**：`DESKTOP_INSPECT_TREE` 在真实浏览器/购物站点上的节点数、
  采集耗时、`truncated` 触发频率均未知；列表页预算 400 是推断值。
- **超时实现基于线程池**：超时后工作线程被放弃（`shutdown(wait=False)`），若 provider
  永久挂死会泄漏一个线程。单次命令只泄漏一个，可以接受，但长期运行需要监控。
- **`_normalize_process_name` 与 `windows_executor` 重复实现**：为避免循环导入，两处
  各有一份；若将来修改归一化规则必须同步。
- **未做视觉兜底**：`SOURCE: SCREENSHOT` 路径与坐标缩放说明仍未实现。
- Windows-MCP 自身的 `PowerShell`/`FileSystem`/`Registry` 能力**明确不采纳**，
  本记录不构成对其安全模型的认可。

## 最终结果

- 已完成：`DESKTOP_INSPECT_TREE` 从"只有契约"变为"Agent 可执行的只读观察动作"，
  具备预算截断、进程排除、单次调用超时、字符串卫生，并由 Node/Python 双端契约与
  共享 fixture 共同约束。
- 未完成：真实 Windows 采集验证、超时行为真实复现、列表页预算实测冻结。
- 下一步：在 `docs/07` 环境执行一次真实采集（浏览器商品列表页），记录
  `maxNodes`/耗时/截断率，据此冻结默认值；随后实现真实
  `observe/execute/verify` 驱动并点亮 `productSearchDecisionStrategy`。
