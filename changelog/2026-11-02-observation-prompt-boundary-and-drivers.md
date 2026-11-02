# 修正观察脱敏边界（模型可见原文）+ 落地真实驱动层

## 元信息

- 日期：2026-11-02
- 状态：已完成（跨平台模拟验证）；真实 Agent 链路未跑通
- 环境：Windows 11（开发主机）、Node 24 / TypeScript、Python 3.11.9

## 目标

1. 修正"脱敏发生在进模型之前"导致的模型不可用问题，按 `docs/14` §3.1 与守卫 §4
   把脱敏边界移到**持久化**侧。
2. 落地决策循环的真实驱动层（观察 / 执行），使循环第一次具备在真实 Agent 上运行的条件。

## 上下文与证据

- `docs/14` §3.1 要求受限文本表示**保留** `name`/`automationId` 并标注不可信；
  守卫 §4 要求"决策轨迹 … original UI node names redacted **before persistence**"。
- 实现与之相反：`agent-decision-loop.ts` 把 `ObservationSummary`（节点名已 HMAC）
  直接交给 `LlmDecisionAdapter`，适配器再 `JSON.stringify(redactionNodes)` 进 prompt。
  即模型只收到 `node:3f9a…` 形式的 token。
- 结论：即使接上驱动，模型也无法区分搜索框与结算按钮、读不出商品标题与价格，
  属于**功能不可用**而非效果不佳。该缺陷无法靠 prompt 措辞弥补。
- 同时确认 `docs/03` §2 原本已写"原始名称只在当次 LLM 请求中出现，落库前必须脱敏"，
  即实现偏离了既有文档，不是文档需要让步。

## 分析与决策

1. **两个视图，一次采集**：新增 `ObservationCapture { raw, summary }`，由
   `createObservationCapture` 同时产出。`raw` 只喂 prompt，`summary` 只进轨迹/存储。
   两者不能互相替代，也不能合并成一个对象——合并会让"轨迹不含标签"的断言失效。
2. **Prompt 视图的加固**：`renderPromptView` 渲染为逐行文本并在渲染期做四件事：
   折叠一切空白（标签内的换行不能凭空造出节点行）、剥离 `<`/`>`（不能提前闭合分隔符）、
   四项上限（深度 12 / 行 200 / 名长 80 / 总长 8000）并显式标记截断。
   信任由 `<untrusted-ui-observation>` 分隔符 + LLM 无执行权 + 五重校验承担，
   **不靠删除文本**。
3. **驱动层复用既有通道**：观察走 `DESKTOP_INSPECT_TREE`，执行复用 `desktop.command`，
   因此幂等、有效期、双重策略、急停全部继续生效，没有新增执行路径。
4. **失败关闭**：观察失败（Agent 离线/超时/无载荷/空树）在循环内转
   `WAITING_FOR_HUMAN` 并记一条 REJECTED 轨迹，不再让 `run()` 抛出；取消在
   observe/execute/verify 三处均转 `CANCELLED`。
5. **不点亮接缝**：确定性 verifier 尚未实现，此时接上会得到"能看见但判不了成功"的
   半成品，故 `app.ts` 保持默认不注入。

## 操作记录

1. 分三批提交此前积压的改动（文档治理、M6 决策层、观察层 Agent 侧），补交 `docs/14`。
   - 结果：成功。工作树由混合脏状态变为干净，`main` 领先 origin 4 个提交。
2. P0：拆观察两视图 + 改适配器 prompt + 循环消费 capture。
   - 结果：成功。
3. P1：新增 `AgentObservationAdapter`、`AgentCommandExecutor`，补 `AdapterErrorCode`。
   - 结果：成功。

## 文件变更

- `apps/control-server/src/domain/observation.ts`：新增 `ObservationCapture`、
  `createObservationCapture`、`PromptViewOptions`/`ObservationPromptView`、
  `renderPromptView`、`renderUntrustedBlock`；`ObservationAdapter.inspect` 改返回 capture。
- `apps/control-server/src/adapters/llm-decision-adapter.ts`：`DecisionObservation` 改为
  携带 `promptView` 与精简 `summary`；prompt 改用 untrusted 块，**不再**序列化脱敏节点。
- `apps/control-server/src/application/agent-decision-loop.ts`：`observe` 返回 capture；
  渲染 prompt 视图；观察失败转人工、三处取消统一为 `CANCELLED`；新增 `isAborted()` 辅助。
- `apps/control-server/src/application/product-search-decision-strategy.ts`：驱动类型对齐 capture。
- `apps/control-server/src/adapters/agent-observation-adapter.ts`（新）：`DESKTOP_INSPECT_TREE`
  下发、结果还原、失败关闭映射；导出 `DesktopCommandDispatcher`、`raceAbort`。
- `apps/control-server/src/adapters/agent-command-executor.ts`（新）：已验证提议的执行边界，
  非 `SUCCEEDED` 一律抛出。
- `apps/control-server/src/adapters/adapter-error.ts`：新增 9 个 Agent 侧错误码。
- 测试：`observation.test.ts` 增 13 项、`llm-decision-adapter.test.ts`（新，9 项）、
  `agent-drivers.test.ts`（新，20 项）、`agent-decision-loop.test.ts` 增 5 项。
- 文档：`docs/03`（两视图表 + `OBSERVATION_FAILED`）、`docs/14` §3.1 补充脱敏边界、
  `docs/08` 状态与待办。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `npx tsc -p apps/control-server/tsconfig.json --noEmit` | PASSED | 0 错误 |
| `npx eslint apps/control-server packages/contracts` | PASSED | 0 错误 |
| `npx prettier --check` | PASSED | 全部符合 |
| `npx vitest run packages/contracts apps/control-server` | PASSED | 24 文件 / **319 测试**（272 → +47） |
| `.venv/Scripts/pytest.exe` | PASSED | 244 通过 / 2 跳过，覆盖率 92.60%（本轮未改 Python） |
| 真实 Agent 链路跑通观察+执行 | NOT_EXECUTED | 需 `docs/07` 环境与运行中的应用窗口 |
| 真实模型对 prompt 视图的可用性（能否正确选中搜索框） | NOT_EXECUTED | 无 LLM 凭据；当前只断言"标签进入 prompt 且被标记" |

## 问题与处理

- 现象：lint 报 `signal.aborted` 恒为 falsy。
- 根因：控制流分析在循环开头 `if (aborted) return` 之后把属性读收窄为 `false`，
  而 `abort` 可在 `await` 期间发生。
- 处理：改为 `isAborted()` 方法调用，打破收窄，并注释说明原因。
- 结果：lint 通过，语义不变。

- 现象：`collapses newlines` 测试断言标签中的 `[99]` 应消失。
- 根因：断言写错——折叠换行后该文本作为惰性内容保留在同一行，正是期望行为。
- 处理：改为断言"只有一行"且内容保持在同一行。
- 结果：通过。

## 风险与限制

- **驱动层未经真实链路验证**：真实 Agent 返回的节点规模、`timedOut` 触发率、往返延迟
  全部未知；当前只用假 dispatcher 验证契约与失败映射。
- **prompt 视图的有效性未被真实模型检验**："标签进入 prompt"不等于"模型能正确利用"，
  需要在有凭据的环境里实测选点准确率。
- **系统提示词未改**：仍假设观察是可读结构；真实模型是否会把分隔符内文本当指令，
  必须在 `docs/05` §5.1 注入测试集中实测，不能仅凭本轮的渲染期加固推断。
- `AgentGateway` 以普通 `Error` 拒绝，驱动层靠消息文本区分"离线/超时"，
  该耦合在网关改动消息时会静默退化（已被测试覆盖两种串）。
- 观察层真实采集（`maxNodes` 冻结）与视觉兜底仍未验证。

## 最终结果

- 已完成：脱敏边界修正为"模型看受限原文、落库看 HMAC token"；真实观察/执行驱动就位并通过
  47 项新测试；工作树干净，积压提交已落地。
- 未完成：确定性 verifier 实现、驱动接进 `app.ts`、轨迹持久化与回放、五类载体注入测试集、
  管理台轨迹视图、真实环境校准。
- 下一步：实现 `ProductSearchVerifier`（复用 `product-ranking.ts` 与预算过滤），随后把
  `AgentObservationAdapter` + `AgentCommandExecutor` + verifier 组成
  `ProductSearchDecisionDrivers` 注入 `app.ts`，在受控环境做一次端到端尝试。
