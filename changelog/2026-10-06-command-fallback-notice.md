# 指令兜底回复：无法识别的带前缀指令不再静默丢弃

## 元信息

- 日期：2026-10-06
- 状态：已完成（跨平台模拟验证；真实微信通道未验证）
- 环境：Windows；Node.js 24.15.0、npm 11.12.1；未涉及 .NET 与 Python 改动

## 目标

- 让"带命令前缀但无法处理"的指令回复发送者，而不是静默消失；且不打扰普通聊天、
  不向陌生账号回复。
- 使 `docs/10-user-manual.md` 既有描述"策略拒绝 → 收到拒绝提示"首次成立。

## 上下文与证据

- `app.ts:312` 丢弃 `handleMessage` 返回值；`AssistantWorkflow.handleMessage` 对
  `POLICY_DENIED`/`COMMAND_UNSUPPORTED`/`INVALID_ARGUMENTS` 一律返回 `IGNORED`，
  不回复也不建任务。实测 `#助手 想买一台电脑`、`#助手 想看下有没有外卖` 均无任何用户可见反馈。
- 解析器为纯规则：`问AI：`正则（`domain/ai-question-command.ts`）与
  `^(?:搜索|查找)`+预算/数量/偏好正则（`domain/product-search-command.ts`），
  不调用任何模型。
- 发现两处文档与实现不一致：`docs/10` §2.1 与 `docs/12` 第 2 步使用
  `#助手 解释一下什么是零信任网络`（无 `问AI：`），按当前解析器会判为
  `COMMAND_UNSUPPORTED`，与 `docs/01` UC-01 的 `问AI：` 形式冲突；
  `docs/12` 第 5 步预期"任务已拒绝"，但无任何代码创建 `REJECTED` 状态任务
  （`TaskType` 仅 `AI_QUESTION`/`PRODUCT_SEARCH`）。

## 分析与决策

- 回复范围按原因区分：`COMMAND_UNSUPPORTED`、`INVALID_ARGUMENTS` 回复可用格式；
  `POLICY_DENIED` 回复拒绝原因与"不代付款/下单"边界；`UNTRUSTED_SENDER` 与
  `COMMAND_PREFIX_MISSING` **保持静默**——回复陌生人等于确认机器人存在，回复无前缀
  文本会污染正常聊天，且 `docs/10` 与 `docs/05` AT-03 已如此规定。
- 措辞与"回复/静默"判定放进纯域模块 `domain/command-notice.ts`，不依赖传输层，可独立单测。
- 提示为**尽力而为**：默认 `UnavailableChatReplyAdapter` 必然失败，因此发送异常被捕获并记
  `warn`，不改变返回值、不影响消息处理（失败关闭方向正确：没有通道就不送达，但不伪造成功）。
- 不改变 `MessageHandlingResult` 形状（仍为 `IGNORED`），使既有断言与
  `product-search-workflow` 集成用例无需改写，证明变更为纯增量。
- 被拒指令目前不建任务记录：补全 `REJECTED` 任务需新增任务类型、数据库约束与迁移，
  并影响统计 `byType`，属独立任务，本次不做，只更正文档表述。
- 未放宽解析器接受任意前缀文本：该改法会把所有带前缀消息当作提问，是产品决策，
  留待确认，本次只让文档与实现的既有形式对齐。

## 操作记录

1. 新增纯域模块并按原因生成提示文本；`AssistantWorkflow` 注入聊天回复适配器与日志器。
   - 结果：成功。
2. `ChatReplyRequest.taskId` 改为可选；`DesktopAgentChatReplyAdapter` 在缺失时自行生成
   协议所需关联 id（避免在调用侧伪造任务 id）。
   - 结果：成功，既有适配器测试未受影响。
3. 更正 `docs/10`、`docs/12` 中与实现冲突的指令示例与"任务已拒绝"表述。
   - 结果：成功。

## 文件变更

- `apps/control-server/src/domain/command-notice.ts`：新增，拒绝原因 → 提示文本或静默。
- `apps/control-server/src/application/assistant-workflow.ts`：注入 `chatReplyAdapter`/`logger`，
  新增 `ignore`/`sendNotice` 兜底发送路径。
- `apps/control-server/src/adapters/chat-reply-adapter.ts`：`taskId` 变为可选并说明用途。
- `apps/control-server/src/adapters/desktop-agent-chat-reply-adapter.ts`：缺失 `taskId` 时生成关联 id。
- `apps/control-server/src/app.ts`：向 `AssistantWorkflow` 传入聊天回复适配器与 `app.log`。
- `apps/control-server/test/command-notice.test.ts`：新增 6 项纯域测试。
- `apps/control-server/test/assistant-workflow.test.ts`：harness 增加回复/日志桩，新增 6 项用例。
- `docs/08-development-status.md`：日期、当前能力、测试计数 217→229、
  `REJECTED` 任务缺口与解析器口径缺口写入限制。
- `docs/10-user-manual.md`：AI 问答示例补 `问AI：`，说明无法识别指令会回复；
  状态表与异常表标注策略拒绝不产生任务记录。
- `docs/12-demo-script.md`：第 2 步改用可执行命令形式，第 5 步改为实际画面并新增 5b 兜底演示，
  问答表补充"为什么不能直接执行口语化购物指令"。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `npx vitest run --dir apps/control-server test/command-notice.test.ts test/assistant-workflow.test.ts` | PASSED | 2 文件 28 项通过 |
| `npx vitest run --dir apps/control-server` | PASSED | 18 文件 229 项通过（基线 217 + 新增 12） |
| `npm run format:check` / `npm run lint` / `npm run typecheck` | PASSED | 三项均通过 |
| `npm test` | PASSED | Control Server 229 项、contracts 8 项通过 |
| `npm run build`（含 `check:node` 末步） | PASSED | contracts、control-server tsc 与 operator-web vite 构建通过 |
| 真实微信通道投递兜底提示 | NOT_EXECUTED | 微信链路未接通（见 `docs/08` M0 未完成项） |
| 纯域 + Fake 免责说明 | — | 本次验证为模拟验证，不代表真实聊天工具行为 |

## 问题与处理

- 现象：`docs/10` 记录"策略拒绝 → 收到拒绝提示"，但代码从不回复，属文档承诺未实现。
  - 根因：`handleMessage` 的返回值在 `app.ts` 被丢弃，拒绝路径没有回复分支。
  - 处理：新增兜底回复路径，并使返回值形状保持不变以隔离影响面。
  - 结果：文档承诺成立，且新增 12 项测试锁定该行为。
- 现象：演示脚本第 2 步的命令按当前解析器不会被执行。
  - 根因：脚本与用户手册沿用了 `docs/01` 未采纳的口语化形式。
  - 处理：改为 `#助手 问AI：…`，并把"是否放宽解析器"记为待定产品决策。
  - 结果：演示主线不再依赖不一致的示例。

## 风险与限制

- 兜底提示默认无法送达：仓库默认 `UnavailableChatReplyAdapter`，未配置真实桌面通道时
  用户仍看不到提示，只留 `warn` 日志。真实微信通道接通后才能端到端验证。
- 每个带前缀的无效指令都会尝试一次回复；重复消息由入站去重拦截，但不同措辞的连续无效
  指令会产生多条提示，暂无频率限制。
- `REJECTED` 任务记录仍缺失，管理台看不到被拒指令的历史。
- 解析器口径（`问AI：` vs 任意前缀文本）尚未决策，文档侧现按"与实现一致"处理。

## 最终结果

- 已完成：兜底回复能力、纯域提示模块、任务无关回复的协议支持、文档更正，229 项 Control
  Server 测试通过（模拟验证）。
- 未完成：真实聊天通道端到端验证；`REJECTED` 任务记录；解析器口径决策。
- 下一步：接入真实微信通道后验证兜底提示投递；决定是否新增 `REJECTED` 任务类型；
  决定是否放宽 AI 提问的解析口径。
