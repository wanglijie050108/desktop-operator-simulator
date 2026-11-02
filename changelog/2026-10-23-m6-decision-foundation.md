# M6 决策层基础切片（OBS-01 + LLM-01 + TRACE-01，跨平台可验证）

## 元信息

- 日期：2026-10-23
- 状态：已完成（模拟验证）
- 环境：Windows 11 开发机；本切片在 Node 24 下纯跨平台验证，未接真实 Windows 桌面或真实模型。

## 目标

- 为方案 B 决策层（M6）落地可跨平台验证的基础组件：观察层受限结构树表示、LLM 结构化提议适配器、五重校验链、决策轨迹实体、决策循环编排与三重预算。使"咨询 AI → 完成购物查询"第一次有代码底座，且 `node test` 即可跑通。
- 全程不削弱产品目标 Skill 第 3/4 节闭环与红线：LLM 只提议白名单动作、成功由确定性 verifier 判定、观察文本视为不可信数据、默认失败关闭。

## 上下文与证据

- 重读 `AGENTS.md`、`product-target` 与 `human-operation-simulator-guardrails` Skill、`docs/08`、`docs/14`、`docs/03`、现有 adapter/workflow/config 约定。
- 现状：M6 决策层此前 0% 实现（`docs/08` 已记录）；`docs/14` §3/§9 明确先做可跨平台验证的 OBS-01/LLM-01/LOOP-01/VERIFY-01/BUDGET-01/TRACE-01/SAFE-01，用 Fake LLM 与夹具在 macOS/Linux 验证。

## 分析与决策

- 切片只做"决策层自身"逻辑，不接真实 Agent WebSocket 或真实模型：观察由调用方注入（`observe`），执行由调用方注入（`execute`），校验由 `validateProposal` 五阶段完成，全部用 Fake 注入即可断言，符合"安全/终止性质不依赖真实模型即可证伪"。
- 五重校验链：Schema（复用 `DesktopCommandSchema`）→ 动作白名单（`DECISION_ALLOWED_ACTIONS`，刻意排除 `WECHAT_*` 与任何脚本/执行类动作）→ 参数范围（桌面命令严格 DTO）→ 策略（禁止支付/转账/下单/绕过验证码/Shell 等提示注入式文本）→ 目标进程白名单。任一失败丢弃提议，不"修补"成可执行动作。
- 默认失败关闭：`LLM_API_BASE` 未配即 `DECISION_NOT_CONFIGURED`；OpenAI 兼容协议只用内置 `fetch`（D9，不新增 npm 包）。
- 观察脱敏：结构树只保留 `controlType/automationId/boundingBox`，节点 `name` 替换为 HMAC token（密钥不出进程），落库前即为脱敏态，满足 `docs/03` Observation/DecisionTrace 的"原始节点名只在当次请求出现、落库前必须脱敏"。
- 截断显式化：`summarizeTree` 超限时 `truncated=true` 且 `nodeCount` 仍报原始总数，不静默丢节点。

## 操作记录

1. 新建 `src/domain/observation.ts`：受限结构树表示 + `summarizeTree` + `redactNodeName`（HMAC）。
    - 结果：成功。影响：新增观察层域模块。
2. 新建 `src/domain/decision-trace.ts`：决策轨迹实体与 `createDecisionTrace`。
    - 结果：成功。影响：TRACE-01 实体。
3. 新建 `src/domain/decision-action.ts`：五重校验链 `validateProposal` 与白名单常量。
    - 结果：成功。影响：SAFE-01 校验核心。
4. 新建 `src/domain/decision-budget.ts`：三重预算 `defaultDecisionBudget`/`loadDecisionBudget`（环境变量覆盖，数值为跨平台默认，待真实成本冻结）。
    - 结果：成功。
5. 新建 `src/adapters/llm-decision-adapter.ts`：`OpenAiLlmDecisionAdapter`（内置 fetch）、`UnavailableLlmDecisionAdapter`（失败关闭）、`FakeLlmDecisionAdapter`（测试/离线）、`loadLlmConfig`。
    - 结果：成功。影响：LLM-01。
6. 新建 `src/application/agent-decision-loop.ts`：`AgentDecisionLoop` 编排（观察→提议→校验→下发→verifier→终止），含 token/轮次/墙钟三重预算与确定性兜底。
    - 结果：成功。影响：LOOP-01/BUDGET-01/VERIFY-01。
7. `packages/contracts/src/index.ts`：新增 `DESKTOP_INSPECT_TREE` 桌面命令（目标进程白名单 + 可选 `maxNodes`/`maxDepth`），保持 `additionalProperties:false` 信任边界。
    - 结果：成功。影响：契约扩展，需随本任务重新 `npm run build --workspace @hos/contracts`（已执行）。
8. 新增测试：`decision-action.test.ts`、`observation.test.ts`、`agent-decision-loop.test.ts`，覆盖校验链、注入守卫、截断、脱敏、循环终止（预算/取消/执行失败/LLM 失败/成功）、轨迹记录。
    - 结果：成功。
9. 扩展 `src/adapters/adapter-error.ts`：新增 `LLM_UNAVAILABLE`/`PROPOSAL_REJECTED`/`VERIFIER_FAILED`/`DECISION_NOT_CONFIGURED`。
    - 结果：成功。

## 文件变更

- `packages/contracts/src/index.ts`：新增 `DESKTOP_INSPECT_TREE` 动作契约。
- `apps/control-server/src/domain/observation.ts`（新）：观察层。
- `apps/control-server/src/domain/decision-trace.ts`（新）：轨迹实体。
- `apps/control-server/src/domain/decision-action.ts`（新）：五重校验链。
- `apps/control-server/src/domain/decision-budget.ts`（新）：三重预算。
- `apps/control-server/src/adapters/llm-decision-adapter.ts`（新）：LLM 适配器。
- `apps/control-server/src/adapters/adapter-error.ts`：新增错误码。
- `apps/control-server/src/application/agent-decision-loop.ts`（新）：决策循环编排。
- `apps/control-server/src/application/product-search-decision-strategy.ts`（新）：购物主路径决策接缝（`ProductSearchDecisionStrategy` 包裹 `AgentDecisionLoop`，`searchSite` 把循环结果映射为工作流错误码）。
- `apps/control-server/src/application/product-search-workflow.ts`：新增可选 `decisionStrategy`+`decisionDrivers` 接缝，仅当二者齐备时把步骤 3-5（Open/Search/Extract）改走循环，经典站点适配路径默认不变。
- `apps/control-server/src/app.ts`：透传 `productSearchDecisionStrategy/Drivers`（默认不注入，保持失败关闭）。
- `apps/control-server/test/decision-action.test.ts`、`observation.test.ts`、`agent-decision-loop.test.ts`（新）：测试。
- `apps/control-server/test/product-search-workflow.test.ts`：新增决策接缝测试（Plan B 模拟）。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `prettier --check` | PASSED | 全部文件符合格式 |
| `eslint` | PASSED | 0 错误 |
| `tsc --noEmit`（control-server） | PASSED | 类型通过 |
| `vitest run packages/contracts apps/control-server` | PASSED | 22 文件 262 测试通过（含本次新增 25） |
| `npm run build --workspace @hos/contracts` | PASSED | 契约重新构建，dist 含 `DESKTOP_INSPECT_TREE` |
| 真实 Windows 桌面观察 / 真实 LLM 调用 / 真实购物站点 | NOT_EXECUTED | 本切片纯跨平台，真实接入属后续任务 |

## 问题与处理

- 契约改动初未重建：control-server 解析 `@hos/contracts` 指向 `dist`，新增 `DESKTOP_INSPECT_TREE` 仅在 `src`，导致 `validateProposal` 对该动作返回拒绝。处理：执行 `npm run build --workspace @hos/contracts` 重建，测试转绿。
- `exactOptionalPropertyTypes` 报错若干：调结构使可选字段不以 `undefined` 显式赋值、命令对象经校验后 `as DesktopCommand` 收窄；`now` 与决策接缝选项均以"先建对象再按需赋值"方式规避。
- 重构 `ProductSearchWorkflow.execute` 时一度把步骤进度收进子方法导致 `activeStep` 在 catch 中错位、步骤 3-5 状态不符：改回在主流程内联推进步骤序号，并让决策接缝覆盖步骤 3 后显式完成步骤 4/5，与经典路径时间线对齐。

## 风险与限制

- 模拟验证：本切片用 Fake LLM 与注入式 `observe/execute/verify`，不证明真实模型质量与真实站点成功率；真实桌面观察执行器、真实模型接入、决策循环以真实驱动接入购物主路径，均属后续任务（VERIFY-01/SAFE-01 真实侧、FAST-01/UI-01 集成）。
- **生产默认仍走经典站点适配路径**：`app.ts` 默认不注入 `productSearchDecisionStrategy/Drivers`，未接真实 `DESKTOP_INSPECT_TREE` 执行器的环境下购物任务行为与先前一致；决策循环接缝仅在显式注入且提供真实观察/执行驱动后才生效——有意的安全默认值，避免未校准的 GUI 自治上线。
- 观察采集真实侧 `DESKTOP_INSPECT_TREE` 的 Python 执行器与 Agent WebSocket 接入尚未实现；DOM 树→产品行的结构化解析（verify 的"候选已采集"判定）也依赖后续真实适配器，本切片仅验证接缝编排与失败映射。
- 预算默认数值（maxRounds=12 / maxTokens=8000 / maxWallClockMs=110000）为跨平台占位，须按真实成本/时延实测后在 `docs/06` §3.2、`docs/14` §8 冻结。

## 最终结果

- 已完成：M6 决策层可跨平台验证的基础切片 + 购物主路径可切换的决策接缝（观察受限表示、LLM 提议适配器、五重校验链、轨迹、循环编排、三重预算、工作流接入），全部以 Fake/夹具通过 25 项新增单测与集成断言。
- 未完成（后续任务）：真实观察采集执行器、真实 LLM 质量校准、决策接缝接入真实观察/执行驱动并默认可切换、决策轨迹可视化、真实环境验收。
- 下一步：实现 `DESKTOP_INSPECT_TREE` 的 Python 执行器与 Agent WebSocket 接入，提供真实 `observe/execute/verify` 驱动，把 `productSearchDecisionStrategy` 在受控环境（先本地/模拟入口，ADR-011）点亮，并把"决策轨迹可视化"接入 Operator Web 任务详情。
