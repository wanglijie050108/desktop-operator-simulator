# 落地确定性 verifier 与决策循环装配门控

## 元信息

- 日期：2026-11-02
- 状态：已完成（跨平台模拟验证）；真实站点与真实 Agent 链路未执行
- 环境：Windows 11（开发主机）、Node 24 / TypeScript

## 目标

1. 实现 VERIFY-01 的确定性 verifier，让决策循环有唯一且可复现的成功判据。
2. 把观察适配器、执行适配器、verifier 组装成可注入的 drivers，并给出一条**默认关闭、
   缺项即回落**的装配路径，使循环第一次"能跑"而不牺牲安全默认。

## 上下文与证据

- `agent-decision-loop.ts` 的 `verify` 一直是调用方注入的回调，没有任何具体实现，
  因此循环虽可运行却判不了成功，接上驱动也只会空转。
- `ProductSearchWorkflowOptions.decisionDrivers` 原本是**单个实例**，而
  `createProductSearchDecisionDrivers` 需要记住"本次任务的观察树"——一个实例跨任务共享
  会让任务 B 用任务 A 的屏幕做验证。这是接驱动前必须修掉的设计缺陷。
- 经典路径的判定由 `validateProductCandidates` + `rankProducts` 完成
  （`product-search-workflow.ts` 步骤 6），verifier 必须复用同一套，否则两条路径会
  各判各的。

## 分析与决策

1. **verifier 判"能否产出排名结果"，不判"模型说完成"**：`verifyProductCandidates` 返回
   `{ passed, products, reason }`。三种常见未完成态（空候选、全部超预算、字段非法）
   一律返回 `passed: false` 而非抛错——页面还没渲染完不是失败，抛错会直接终止任务。
2. **`rankProducts` 的 `NO_PRODUCTS_IN_BUDGET` 被降级为"尚未完成"**：有结果但都超预算时，
   循环应继续观察（用户可能愿意改预算，模型也可能换关键词），而不是立即判失败。
3. **drivers 改为按任务工厂**：`decisionDrivers?: (request, taskId) => drivers`。一个任务
   一份状态，`lastTree()` 只反映本任务的采集。
4. **装配门控六项齐全才启用**：总开关 + Agent + 目标进程 + 允许列表匹配 + LLM 端点 +
   ≥16 字符脱敏密钥。任缺一项回落经典路径并记录 `reason`。宁可显式告诉运维"为什么没开"，
   也不要半配置地跑一个必然失败的循环。
5. **抽取器注入而非写死**：把 UI 树变成商品行是站点特定的，需要 `docs/07` 实测校准。
   因此 `product-row-extractor.ts` 作为可替换策略，装配层只负责接线与预算。
   无链接的行用首个允许域名兜底——否则 `validateProductCandidates` 会因空 URL 拒绝全部
   行，循环永远无法通过；该兜底在行属性里以 `source: "uia-tree"` 标记，可与真实链接区分。

## 操作记录

1. 实现 verifier、drivers 组合器、行抽取器、装配门控四个模块。
   - 结果：成功。
2. 修正 `decisionDrivers` 从实例改为工厂，并同步 `app.ts`、workflow、测试调用点。
   - 结果：成功。
3. 提交此前 5 个本地提交到远端。
   - 结果：**失败**。`github.com:443` 不可达（gitee/百度正常，DNS 可解析），
     属网络侧阻断，非本地配置问题。未做任何绕过尝试。

## 文件变更

- `apps/control-server/src/domain/product-verifier.ts`（新）：`verifyProductCandidates`。
- `apps/control-server/src/application/product-search-decision-drivers.ts`（新）：
  按任务组合 observe/execute/verify，持有最近一次观察树。
- `apps/control-server/src/adapters/product-row-extractor.ts`（新）：UI 树 → 商品行启发式。
- `apps/control-server/src/application/decision-loop-wiring.ts`（新）：环境变量门控 +
  `createDecisionStrategy` / `createDecisionDrivers`。
- `apps/control-server/src/application/product-search-workflow.ts`：`decisionDrivers` 改工厂。
- `apps/control-server/src/app.ts`：`buildApp` 接受 `environment`，按门控结果注入或回落。
- 测试：`product-verifier.test.ts`（11）、`product-search-decision-drivers.test.ts`（12）、
  `product-row-extractor.test.ts`（12）、`decision-loop-wiring.test.ts`（17）。
- 文档：`docs/03`（装配环境变量与回落原因）、`docs/08`（状态与待办）。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `npx tsc -p apps/control-server/tsconfig.json --noEmit` | PASSED | 0 错误 |
| `npx eslint apps/control-server packages/contracts` | PASSED | 0 错误 |
| `npx prettier --check` | PASSED | 全部符合 |
| `npx vitest run packages/contracts apps/control-server` | PASSED | 28 文件 / **371 测试**（319 → +52） |
| `git push origin main` | FAILED | `github.com:443` 连接被拒；网络侧阻断 |
| 真实站点商品列表页端到端 | NOT_EXECUTED | 需 `docs/07` 环境、运行中的浏览器与冻结站点 |
| 真实模型驱动循环选点 | NOT_EXECUTED | 无 LLM 凭据 |

## 问题与处理

- 现象：`decisionDrivers` 是单实例，但 drivers 需要按任务保存观察树。
- 根因：接缝设计时 drivers 只是纯函数桩，没有考虑状态归属。
- 处理：改为工厂 `(request, taskId) => drivers`，同步 workflow、app、全部测试调用点。
- 结果：测试断言"两个任务拿到不同实例且不共享 `lastTree`"通过。

- 现象：`product-search-decision-drivers.ts` 的 `verify` 声明为 async 却无 await，lint 报错。
- 处理：改为直接返回 `Promise.resolve/reject`，并在注释说明少一次微任务跳转。
- 结果：lint 通过。

- 现象：`git push origin main` 失败。
- 根因：`curl https://github.com` 与 `git push` 均在 443 立即被拒；gitee、百度正常，
  `nslookup github.com` 可解析。
- 处理：**未做任何绕过**（未改 hosts、未配代理、未用镜像）。5 个提交保留在本地。
- 结果：待网络条件允许时由用户执行 `git push origin main`。

## 风险与限制

- **行抽取器未经真实站点验证**：基于价格正则与"最小含价子树"的启发式，在真实淘系/京东
  页面上可能漏抽或误抽；无链接时用首个允许域名兜底会让 URL 失真（虽可通过行属性识别）。
  这是当前最薄的一环。
- **verifier 的正确性依赖抽取质量**：verifier 本身只做校验与排序，若抽取器产出错误行，
  verifier 会如实拒绝（不会误判成功），但循环可能耗尽预算转人工。
- **装配后仍未跑通真实链路**：`DECISION_LOOP_ENABLED` 从未在真实环境置真；Agent 往返、
  观察耗时、模型选点准确率全部未知。
- 决策轨迹仍未落库（`onTrace` 默认 no-op），回放与 `docs/05` §5.1 注入测试集仍缺。

## 最终结果

- 已完成：VERIFY-01 具体实现、drivers 按任务组装、装配门控（默认关闭、缺项回落）、
  行抽取启发式，共 52 项新测试；`docs/03`/`docs/08` 同步。
- 未完成：真实站点校准、真实链路端到端、轨迹持久化与回放、五类载体注入测试集、
  管理台轨迹视图、远端推送（网络阻断）。
- 下一步：优先做 **TRACE-01 持久化 + 回放**（不依赖真实环境，且是 AT-21 的验收前提），
  随后补 `docs/05` §5.1 注入测试集；真实站点校准需等 `docs/07` 环境可用。
