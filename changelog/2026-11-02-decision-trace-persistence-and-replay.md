# 决策轨迹持久化与回放（TRACE-01）

## 元信息

- 日期：2026-11-02
- 状态：已完成（跨平台模拟验证）；真实环境轨迹未采集
- 环境：Windows 11（开发主机）、Node 24 / TypeScript、SQLite（better-sqlite3）

## 目标

1. 把决策循环每轮的轨迹落库，使一次非确定性运行可被审计、可被复现（AT-21）。
2. 提供回放能力，且回放**不得**绕过校验链。

## 上下文与证据

- `decision-trace.ts` 早有实体，但 `AgentDecisionLoop.trace` 是回调，`app.ts` 从未传入，
  `decision-loop-wiring.ts` 里 `onTrace` 类型还是 `unknown` 且默认 no-op——轨迹产生后即丢弃。
- `contracts/openapi.yaml` 顶部原本写着：决策轨迹"将通过 `GET /api/v1/tasks/{taskId}` 的响应
  扩展暴露，该扩展随 M6 实现同步加入本文件与运行时 TypeBox schema，**在此之前不得先行实现**"。
  本次即按这条约定执行，未另开端点。
- `docs/03` 的回放约定要求"校验链不得跳过"。

## 分析与决策

1. **表设计**：`decision_traces`，`(task_id, round)` 唯一。循环可能先记一条再更新（例如
   提议先被接受、执行结果稍后确定），唯一约束让写入变成幂等更新，避免同一轮出现两条记录
   导致回放顺序歧义。`task_id` 外键 `ON DELETE CASCADE`：脱离任务的轨迹既无法归属也无法回放。
2. **脱敏不变量落在存储层**：表里存 `proposal_json`，内容是上游已脱敏的提议；测试断言
   库中不含 UI 原文、且能匹配 `node:<16hex>`。这是"轨迹不得泄露界面文本"的可验证保证。
3. **回放只替换 LLM 调用**：`ReplayLlmDecisionAdapter` 按 `request.observation.round` 取
   录制的提议返回，其余全部走原路径。因此原先被阶段 5 拒绝的提议会以相同
   `rejectionCode` 再次被拒——测过。
4. **缺轮即停**：录制中没有的轮次抛 `LLM_UNAVAILABLE`，循环转 `WAITING_FOR_HUMAN`。
   "跳过缺失轮次继续"会让残缺轨迹看起来像完整运行，这是回放最危险的失真方式。
5. **暴露走响应扩展**：`GET /api/v1/tasks/{taskId}` 返回 `TaskDetail`（`Task` + `decisionTraces`），
   列表端点保持精简。经典路径任务返回空数组而非缺字段，便于区分"没走循环"与"走了没记录"。

## 操作记录

1. 新增 schema + 迁移 v4 + 仓储，接入 `buildApp` 的 `onTrace`。
2. 扩展详情端点与 openapi（`TaskDetail` / `DecisionTrace`）。
3. 新增回放适配器与测试。
4. 推送此前 6 个本地提交到远端：**成功**（`22ed9e0..7a5e9db`）。上一轮的 GitHub 连接阻断已恢复。

## 文件变更

- `apps/control-server/src/infrastructure/database/schema.ts`：`decisionTraces` 表定义。
- `apps/control-server/src/infrastructure/database/migrations.ts`：v4 建表 + 唯一索引。
- `apps/control-server/src/infrastructure/database/decision-trace-repository.ts`（新）：
  `append`（冲突即原地更新）、`listByTask`（按轮升序）、`getRound`、`countByTask`。
- `apps/control-server/src/adapters/replay-llm-decision-adapter.ts`（新）：录制提议回放。
- `apps/control-server/src/application/decision-loop-wiring.ts`：`onTrace` 由 `unknown` 收紧为
  `(entry: DecisionTrace) => void`。
- `apps/control-server/src/app.ts`：实例化轨迹仓储、注入 `onTrace`、详情端点返回
  `TaskDetail`（含 `decisionTraces`）。
- `contracts/openapi.yaml`：新增 `TaskDetail` / `DecisionTrace`，详情引用改为 `TaskDetail`，
  移除"延后实现"说明。
- 测试：`decision-trace-repository.test.ts`（新，10 项：6 持久化 + 4 回放）、
  `app.test.ts` 增 2 项（详情含空轨迹、列表不含轨迹）、`database.test.ts` 迁移数与
  新表断言更新为 v4。
- 文档：`docs/03`（存储/回放/暴露要点、端点说明）、`docs/08`（状态与待办）。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `npx tsc -p apps/control-server/tsconfig.json --noEmit` | PASSED | 0 错误 |
| `npx eslint apps/control-server packages/contracts` | PASSED | 0 错误 |
| `npx prettier --check`（ts + yaml） | PASSED | 全部符合 |
| `npx vitest run packages/contracts apps/control-server` | PASSED | 29 文件 / **383 测试**（371 → +12） |
| `git push origin main` | PASSED | `22ed9e0..7a5e9db` |
| 真实环境轨迹采集 | NOT_EXECUTED | `DECISION_LOOP_ENABLED` 从未在真实环境置真 |
| Python 测试 | NOT_EXECUTED | 本轮未改 Python（上轮 244 通过 / 覆盖率 92.60%） |

Python 侧本轮无改动，未重跑。

## 问题与处理

- 现象：既有 `database.test.ts` 断言迁移数为 3，新增 v4 后失败。
- 处理：更新为 4，并补断言新表为空；注释说明该数字是"每条迁移都跑过"的显式证据，
  不是随手常量。
- 结果：通过。

- 现象：轨迹表插入报 `NOT NULL constraint failed: task_steps.id`。
- 根因：测试里构造任务时 step 缺 `id`/`sequence`（`CreateTaskInput.steps` 要求完整）。
- 处理：补齐字段。
- 结果：通过。

## 风险与限制

- **回放一致性的边界**：本轮证明的是"同一批录制提议 → 同一条校验/执行动作序列"。
  真实模型回放时观察内容本身会变（页面不同），因此**观察不在回放范围内**——回放固定的是
  决策与执行路径，不是屏幕。答辩时须如此表述，不能宣称"回放能复原整次运行"。
- 轨迹目前只在 `DECISION_LOOP_ENABLED` 下产生；经典路径任务轨迹恒为空，属预期。
- 轨迹尚无保留期策略，会随任务一起长期留存；`docs/03` §7 的数据保留条款需要补充轨迹口径。
- 未做轨迹写入的性能评估：每轮一次同步写（better-sqlite3 同步 API），在 12 轮上限下可接受，
  但未实测高并发多任务场景。

## 最终结果

- 已完成：轨迹落库（唯一轮次约束、级联清理、脱敏可验证）、按轮回放（校验链不跳过、
  缺轮即停）、详情端点响应扩展与 openapi 同步；12 项新测试。
- 未完成：管理台轨迹视图（UI-01）、`docs/05` §5.1 五类载体注入测试集、真实环境轨迹采集、
  轨迹保留期策略。
- 下一步：**`docs/05` §5.1 五类载体注入测试集**——M6 退出标准第 1 条，且现在有了轨迹，
  可以断言"注入后下发的命令集合不含越权动作"这一强命题。
