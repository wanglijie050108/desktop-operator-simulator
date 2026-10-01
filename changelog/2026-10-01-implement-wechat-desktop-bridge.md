# 实现微信桌面桥接与真实回复闭环（迁移剩余静态代码）

## 元信息

- 日期：2026-10-01
- 状态：已完成（静态代码与 mock 单测；真实桌面/微信操作未执行，待授权）
- 环境：Windows 11；Python 3.11.6（uv）、Node.js 24.15.0；未运行真实桌面/微信

## 目标

- 补齐 Python 迁移中“不依赖真机即可写完”的静态代码：微信 UIA 读取来源、executor 微信命令、
  能力声明与入口接线、Node 真实 `ChatReplyAdapter`、AgentGateway 命令结果等待、app 接线。
- 补充 mock 单测，保持覆盖率 ≥90%。
- 不运行任何真实桌面/微信操作；真机验证（M0 Spike、微信收发闭环）待授权后在真实 Windows 上执行。

## 上下文与证据

- 契约 `packages/contracts/src/index.ts` 已定义 `WECHAT_READ_NEW_MESSAGES` / `WECHAT_SEND_TEXT`
  命令、`wechat.read` / `wechat.send` 能力、`DesktopCommandResult`；Python `protocol.py` 有对应模型。
  结论：**无需改契约**。
- Node 工作流 `ai-question-workflow.ts:168` 与 `product-search-workflow.ts:233` 已
  `await chatReplyAdapter.send(...)`，当前注入 `UnavailableChatReplyAdapter`（返回
  `ADAPTER_NOT_CONFIGURED`）。
- Python `windows_executor.py:101-102` 对微信两类命令返回 `NOT_IMPLEMENTED`；`client.py:59-60,132-140`
  已支持 `message_pump` 接线；`windows_backend.py` 已有 `collect_control_tree` / `find_window` /
  `read_document_text`；`uia_inspection.py` 已有 `RawUiaControlNode` 与隐私脱敏模式。
- `AgentGateway.sendCommand` 只发不等待；缺“发送命令并等待 `desktop.command.result`”的方法。

## 分析与决策

- 缺口是“缺实现”而非“缺设计/契约”，故本次只补实现与测试，不改契约。
- 微信 UIA 真实控件定位用 semantic locator + 合理默认 + 环境变量可配置，明确标注“实机校准”；
  代码只用 mock 控件树在单测中验证。
- 工作流 `ChatReplyAdapter.send` 接口（`Promise<void>`）保持不变，真实实现内部 `await` 命令结果，
  失败时 `reject(AdapterError)`，工作流已能处理。
- `AgentGateway` 增加 `requestDesktopCommand`（发送 + 等待结果，含超时）；`app.ts` 默认仍
  `UnavailableChatReplyAdapter`，仅当显式启用桌面回复时才注入真实实现，保持 fail-closed。
- `WECHAT_READ_NEW_MESSAGES` 定义为“触发一次立即增量读取上报”，通过 dispatcher 持有的 trigger
  event 让后台 pump 增量 poll 一次。

## 操作记录

- 创建 `wechat_source.py`：`WeChatUiABackend` Protocol（`find_window` / `collect_control_tree`）
  + `WeChatUiAMessageSource`（经 `asyncio.to_thread` 同步 poll）；纯函数 `extract_conversation`
  （可见文本抽取、时钟注入、50 条上限、空标题回退到窗口标题）。
- `windows_backend.py`：新增 `send_chat_text`（定位最低 Edit/Doc 控件、`set_focus`、
  剪贴板粘贴 `^v` + `Enter`），避免特殊字符在 `type_keys` 下失真。
- `windows_executor.py`：新增 `WECHAT_SEND_TEXT` 处理（`wechat_process_name` 策略校验 →
  找窗口 → 激活 → 前台校验 → 粘贴发送）；`WindowsBackend` Protocol 增加 `send_chat_text`；
  移除旧 `NOT_IMPLEMENTED` 分支。
- `execution.py`：`CommandDispatcher` 新增 `wechat_read_event`；`WECHAT_READ_NEW_MESSAGES`
  置位该 event 后直接 `SUCCEEDED`（不执行任何桌面输入）。
- `wechat_ingress.py`：`WeChatMessagePump` 新增 `trigger` event；poll 在 trigger 置位时立即
  增量 poll 一次，否则按间隔 `wait_for_any(stop, trigger)` 复用 event 语义。
- `config.py`：新增 `wechat_ingress_enabled` / `wechat_send_enabled` / `wechat_process_name` /
  `identity_key` 字段与校验（ingress 需 windows_automation 与 ≥32 字节 identity_key）；
  `from_environment` 解析并构造能力元组（按需含 `wechat.read` / `wechat.send`）。
- `main.py`：新增 `_create_wechat_pump`（懒加载 UIA 后端/来源/身份哈希器）；`run` 注入
  `wechat_read_event` 并按 `wechat_ingress_enabled` 构建 `message_pump`。
- Node `agent-gateway.ts`：新增 `requestDesktopCommand`（发送 + 等待 `desktop.command.result` +
  超时）、`pendingCommands` Map、`resolvePendingCommand`、`failPendingCommandsForSession`、
  `pickWeChatSendAgent`；`handleRawMessage` 收到 `desktop.command.result` 时 resolve 并清理挂起。
- Node `desktop-agent-chat-reply-adapter.ts`：真实 `ChatReplyAdapter`（fail-closed：无
  `wechat.send` 代理 → `AGENT_UNAVAILABLE`；发送前置 `signal.aborted` 检查 → `REPLY_ABORTED`；
  非 `SUCCEEDED` → `DESKTOP_ACTION_FAILED`；超时/异常 → `SERVICE_UNAVAILABLE`）。
- Node `adapter-error.ts`：新增 `AGENT_UNAVAILABLE` / `DESKTOP_ACTION_FAILED` / `REPLY_ABORTED`。
- Node `app.ts`：`AgentGateway` 先于 workflows 构建；`enableDesktopChatReply` 时注入真实适配器，
  默认仍 `UnavailableChatReplyAdapter`；`commandTimeoutMs` 按 `exactOptionalPropertyTypes` 条件透传。
- 测试：Python `test_windows_executor` / `test_wechat_source` / `test_execution` / `test_config` /
  `test_notepad_spike` / `test_wechat_ingress`；Node `agent-websocket.test.ts`（新增 5 用例）、
  `desktop-agent-chat-reply-adapter.test.ts`（新增）。

## 文件变更

新增：

- `apps/desktop-agent-python/src/desktop_agent/wechat_source.py`
- `apps/desktop-agent-python/tests/test_wechat_source.py`
- `apps/control-server/src/adapters/desktop-agent-chat-reply-adapter.ts`
- `apps/control-server/test/desktop-agent-chat-reply-adapter.test.ts`
- `changelog/2026-10-01-implement-wechat-desktop-bridge.md`

修改：

- `apps/desktop-agent-python/src/desktop_agent/windows_backend.py`
- `apps/desktop-agent-python/src/desktop_agent/windows_executor.py`
- `apps/desktop-agent-python/src/desktop_agent/execution.py`
- `apps/desktop-agent-python/src/desktop_agent/wechat_ingress.py`
- `apps/desktop-agent-python/src/desktop_agent/config.py`
- `apps/desktop-agent-python/src/desktop_agent/main.py`
- `apps/desktop-agent-python/tests/test_windows_executor.py`
- `apps/desktop-agent-python/tests/test_execution.py`
- `apps/desktop-agent-python/tests/test_config.py`
- `apps/desktop-agent-python/tests/test_notepad_spike.py`
- `apps/desktop-agent-python/tests/test_wechat_ingress.py`
- `apps/control-server/src/application/agent-gateway.ts`
- `apps/control-server/src/adapters/adapter-error.ts`
- `apps/control-server/src/app.ts`
- `apps/control-server/test/agent-websocket.test.ts`

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `uv run ruff format --check` / `ruff check` | PASSED | 28 文件已格式化；all checks passed。 |
| `uv run mypy --strict src tests` | PASSED | no issues found（27 源文件）。 |
| `uv run pytest --cov-fail-under=90` | PASSED | 125 passed、2 skipped；覆盖率 92.39% ≥ 90%。 |
| `npm run typecheck` | PASSED | contracts / control-server / operator-web 均通过。 |
| `npm run lint` | PASSED | ESLint（含 `.venv` ignore）无错误。 |
| `npm run format:check` | PASSED | Prettier 代码风格一致。 |
| `npm test`（Vitest 覆盖率） | PASSED | control-server 217 passed；contracts 5 passed。 |
| `npm run build` | PASSED | tsc + vue-tsc + vite build 成功。 |
| 真实 Windows/微信操作 | NOT_EXECUTED | 用户明确暂不运行真实桌面操作；实机验证待授权。 |

## 问题与处理

- `agent-websocket.test.ts` 集成用例最初注册 `["wechat.send"]` 导致 `chat.message.received`
  被服务端以“未声明 `wechat.read`”拒绝：改为同时声明 `["wechat.read", "wechat.send"]`。
- 同一文件 `commandResult(...)` 因每次生成新 `messageId` 导致 `toStrictEqual` 失败：提升为单个
  `const result` 复用。
- `desktop-agent-chat-reply-adapter.ts` 的 `catch` 中 `request.signal.aborted` 被 ESLint 判定恒假
  （`AbortSignal.aborted` 为 readonly，跨 await 不重置收窄），且 `onAbort` 监听为无操作：移除死代码，
  保留派发前 `signal.aborted` 检查（已有单测覆盖）。
- `agent-gateway.ts` `handleRawMessage` 末尾 `if (value.type === "desktop.command.result")`
  在前面分支 return 后恒真（union 仅 4 类）：移除冗余判断，直接 `resolvePendingCommand(value)`。
- 测试 fake `requestDesktopCommand` 的 `async` 无 `await` 触发 `require-await`：改为非 async
  直接 `Promise.resolve(...)` 返回。

## 风险与限制

- 微信 UIA 真实控件定位是基于微信 4.x 常见结构的语义化假设，未经实机取证校准；实机校准与
  验证在授权后执行，文档“未验证”状态如实保留。
- 本轮不运行真实桌面/微信；所有验证仅基于 mock 单测与质量门。

## 最终结果

- 静态代码与 mock 单测全部完成；Python 与 Node 质量门全绿（Python 125 passed/92.39%；
  Node 222 passed、build 成功）。
- 真实微信收发闭环（M0 Spike、UIA 控件校准、端到端回复）**未执行**，待用户在真实 Windows 上授权后实施。
