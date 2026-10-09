# 接口与数据设计

## 1. 契约原则

- 外部管理 API 使用 HTTP JSON。
- Desktop Agent 与 Control Server 使用 WebSocket 双向通信。
- 所有消息包含 `schemaVersion`、`messageId`、`timestamp`。
- ID 使用 UUID；时间使用 UTC ISO 8601。
- 错误返回稳定 `code`，不依赖自然语言文本判断。
- Desktop Agent 只执行枚举动作和严格 DTO，不接受脚本。

## 2. 核心实体

### Agent

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 代理实例 |
| name | string | 展示名称 |
| status | enum | ONLINE/OFFLINE/PAUSED/BUSY |
| capabilities | JSON | wechat、input、clipboard 等 |
| lastSeenAt | datetime | 最近心跳 |
| version | string | Agent 版本 |

### InboundMessage

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 内部 ID |
| source | enum | WECHAT |
| externalMessageId | string | 来源消息 ID |
| conversationId | string | 脱敏会话标识 |
| senderId | string | 脱敏发送者标识 |
| content | string | 指令文本 |
| receivedAt | datetime | 接收时间 |

唯一键：`(source, conversationId, externalMessageId)`。

### Task

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 任务 ID |
| shortCode | string | 用户可读短号 |
| type | enum | AI_QUESTION/PRODUCT_SEARCH |
| state | enum | 状态机状态 |
| request | JSON | 校验后的请求快照 |
| result | JSON nullable | 结构化结果 |
| policyVersion | string | 策略版本 |
| createdAt/updatedAt | datetime | 时间戳 |

### TaskStep

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 步骤 ID |
| taskId | UUID | 所属任务 |
| sequence | integer | 固定顺序 |
| name | string | 步骤名称 |
| state | enum | PENDING/RUNNING/SUCCEEDED/FAILED/SKIPPED |
| attempt | integer | 尝试次数 |
| errorCode | string nullable | 稳定错误码 |
| artifactRefs | JSON | 截图/trace 引用 |
| startedAt/finishedAt | datetime | 执行时间 |

### ProductCandidate

| 字段 | 类型 | 说明 |
|---|---|---|
| title | string | 商品标题 |
| price | decimal | 当前展示价格 |
| shopName | string nullable | 店铺 |
| rating | decimal nullable | 评分 |
| salesText | string nullable | 页面销量文本 |
| url | URL | 原始链接 |
| attributes | JSON | 抽取属性 |
| collectedAt | datetime | 采集时间 |

### Confirmation

记录确认对象、确认人、确认时间、过期时间和一次性 nonce。MVP 商品查询不需要确认；未来加入购物车必须确认。

## 3. WebSocket 消息

Desktop Agent 连接 `ws://127.0.0.1:7070/ws/agent`。连接后的第一条消息必须是
`agent.hello`；未注册、版本错误、字段未知或身份不匹配的消息会收到 `server.error`
并以 WebSocket policy violation 关闭连接。运行时 Schema 位于
`packages/contracts/src/index.ts`；Python Agent 在
`apps/desktop-agent-python/src/desktop_agent/protocol.py` 中实现同一严格契约，并
与 Node 实现共用 `contracts/fixtures/websocket-v1/messages.json`。

### Agent 注册

```json
{
  "schemaVersion": "1.0",
  "type": "agent.hello",
  "messageId": "uuid",
  "timestamp": "2026-09-24T04:00:00Z",
  "payload": {
    "agentId": "uuid",
    "name": "automation-agent",
    "version": "0.1.0",
    "capabilities": ["wechat.read", "wechat.send", "input", "clipboard", "screenshot"]
  }
}
```

### Agent 心跳

```json
{
  "schemaVersion": "1.0",
  "type": "agent.heartbeat",
  "messageId": "uuid",
  "timestamp": "2026-09-24T04:00:05Z",
  "payload": {
    "agentId": "uuid",
    "status": "ONLINE"
  }
}
```

Server 接受注册后返回 `server.welcome`，其中包含 `heartbeatIntervalMs` 和
`serverVersion`。Agent 必须使用该间隔发送心跳；断线后按有上限的指数退避重连。

### 上报聊天消息

```json
{
  "schemaVersion": "1.0",
  "type": "chat.message.received",
  "messageId": "uuid",
  "timestamp": "2026-09-24T04:00:02Z",
  "payload": {
    "source": "WECHAT",
    "externalMessageId": "source-stable-id",
    "conversationId": "hashed-id",
    "senderId": "hashed-id",
    "content": "#助手 搜索 300元以内的无线鼠标，选3款",
    "receivedAt": "2026-09-24T04:00:01Z"
  }
}
```

该事件只能由已完成 `agent.hello` 注册的 Agent 发送。Control Server 先以来源、会话和
外部消息 ID 持久化去重，再检查受信任发送者和命令前缀；未通过策略的消息不会创建
任务。通过通用策略后，消息按确定性规则分派到 AI 问答或商品查询工作流；商品查询
要求商品关键词、最高预算和 1 至 3 的候选数量，偏好为可选字段。缺少必填字段时创建
`WAITING_FOR_INPUT` 任务并只回复缺失项。

当微信 UIA 不提供稳定消息 ID 时，Python Agent 使用会话、发送者、规范化文本、分钟
时间桶和可见顺序生成带本机密钥的 HMAC-SHA256 指纹。`conversationId` 和 `senderId`
同样只发送 HMAC 标识，不发送微信显示名。Agent 内存去重只减少重复上报，最终幂等仍
由 Control Server 的数据库唯一键保证。

### 下发桌面动作

```json
{
  "schemaVersion": "1.0",
  "type": "desktop.command",
  "messageId": "uuid",
  "timestamp": "2026-09-24T04:01:00Z",
  "payload": {
    "commandId": "uuid",
    "taskId": "uuid",
    "expiresAt": "2026-09-24T04:01:30Z",
    "action": "WECHAT_SEND_TEXT",
    "arguments": {
      "conversationId": "hashed-id",
      "text": "任务 A1B2 已完成..."
    }
  }
}
```

Agent 完成、拒绝或执行失败后返回 `desktop.command.result`。Control Server 可发送
`task.cancel` 取消指定任务，或发送 `system.emergency-stop` 取消全部活动命令并暂停
后续执行。

允许的首期动作：

- `WECHAT_READ_NEW_MESSAGES`
- `WECHAT_SEND_TEXT`
- `WINDOW_ACTIVATE`
- `TAKE_SCREENSHOT`
- `CLIPBOARD_SET_TEXT`
- `INPUT_KEY_CHORD`
- `MOUSE_MOVE`
- `MOUSE_CLICK`
- `MOUSE_DRAG`
- `MOUSE_SCROLL`
- `MOUSE_CLICK_POSITION`

禁止提供 `RUN_SCRIPT`、`SHELL_EXEC`、`EVAL_JS` 等通用逃逸动作。

### 鼠标动作

鼠标动作分为**语义化定位**（默认且唯一默认路径）与**窗口相对坐标兜底**（默认关闭）两类。

语义化定位使用 `ControlLocator`：

| 字段 | 约束 | 说明 |
|---|---|---|
| `processName` | 必填，1–100，纯进程名 | 必须命中 `AGENT_ALLOWED_PROCESSES` 白名单 |
| `titleContains` | 可选，1–200 | 仅在不锁定窗口句柄时作为标题收窄条件 |
| `controlType` | 可选，1–50 | UIA 控件类型，如 `Document`、`Button` |
| `automationId` | 可选，1–200 | UIA AutomationId |
| `name` | 可选，1–200 | UIA Name，精确匹配 |
| `index` | 可选，0–99 | 多命中时显式选择；未提供且命中不唯一即 `UI_ELEMENT_AMBIGUOUS` |
| `offsetX` / `offsetY` | 可选，-2000–2000 | 相对**命中控件左上角**的偏移；某一轴省略时取该轴中心 |

定位条件可以为空，此时指向窗口本身（用于窗口相对点的拖拽等场景）。偏移量永远相对控件或窗口，
不使用绝对屏幕坐标。

动作与参数：

- `MOUSE_MOVE`：`target`。
- `MOUSE_CLICK`：`target`、可选 `button`（`LEFT`/`RIGHT`/`MIDDLE`，默认 `LEFT`）、可选
  `clickCount`（1–2）。
- `MOUSE_DRAG`：`from`、`to`、可选 `button`；起止点必须属于同一白名单进程。
- `MOUSE_SCROLL`：`target`、`verticalDelta`（-20–20 的**非零**滚轮刻度，正值为向前/向上）。
- `MOUSE_CLICK_POSITION`：`target`（仅 `processName`/`titleContains`）、`x`、`y`（0–20000）、
  可选 `button` 与 `clickCount`。`x`/`y` 是相对**目标窗口左上角**的窗口内坐标。

安全约束：

1. 任何鼠标输入前，目标窗口必须已激活且仍是前台窗口，否则 `TARGET_WINDOW_MISMATCH`，
   且不注入任何事件。
2. 计算出的落点必须位于目标窗口矩形内，控件被滚动出视图时返回 `UI_ELEMENT_OUT_OF_VIEW`。
3. `MOUSE_CLICK_POSITION` 只有在显式配置 `AGENT_COORDINATE_MOUSE_PROFILE=宽x高@DPI`
   时才可执行；未配置返回 `POLICY_DENIED`，实时分辨率或 DPI 与配置不一致返回
   `DISPLAY_PROFILE_MISMATCH`，窗口内坐标越界返回 `COORDINATE_OUT_OF_WINDOW`。
4. 拖拽期间按下的鼠标键由后端跟踪，紧急停止只释放确实按下的键，不注入未按下的抬起事件。

### 商品查询结果

商品站点 Adapter 分为打开站点、执行搜索和抽取候选三个受限阶段。抽取结果进入排序前
必须满足：

- 标题非空，价格为大于零的有限数值。
- 原始链接使用 HTTPS，且主机名匹配 `ALLOWED_SHOPPING_DOMAINS`。
- `collectedAt` 为规范 UTC ISO 8601 时间。
- 评分为空或位于 0 至 5；店铺、销量文本和属性满足长度限制。
- 预算过滤发生在排序前，任何超过 `maxPrice` 的候选不得出现在结果中。

结果只在本次有效候选内按偏好匹配、评分、销量和价格固定权重排序，最多返回请求数量
的商品，并保存 `rank`、`score`、Adapter 版本、来源和采集时间。具体结构以
`contracts/openapi.yaml` 中的 `ProductSearchResult` 为准。

## 4. HTTP 管理接口

- `GET /api/v1/tasks`：按可选 `state` 查询任务及其步骤。
- `GET /api/v1/tasks/{taskId}`：查询单个任务、结果和步骤时间线。
- `POST /api/v1/tasks/{taskId}/cancel`：取消非终态任务，并向在线 Agent 广播取消。
- `POST /api/v1/system/emergency-stop`：停止并暂停所有在线 Agent。

任务由聊天事件创建，不提供绕过受信任发送者和命令前缀策略的通用 HTTP 创建入口。
具体 JSON Schema 以 `contracts/openapi.yaml` 为准。

## 5. 错误码

| 错误码 | 含义 | 是否重试 |
|---|---|---|
| `POLICY_DENIED` | 策略拒绝 | 否 |
| `UNTRUSTED_SENDER` | 非白名单联系人 | 否 |
| `COMMAND_UNSUPPORTED` | 不支持的意图 | 否 |
| `TARGET_APP_NOT_FOUND` | 目标应用未运行 | 有限 |
| `TARGET_WINDOW_NOT_FOUND` | 目标进程中无窗口匹配指定的标题条件 | 有限 |
| `MULTIPLE_TARGET_WINDOWS` | 目标进程中匹配的窗口不止一个，无法唯一确定目标 | 否 |
| `TARGET_WINDOW_LOST` | 已锁定的目标窗口已被关闭或替换 | 否 |
| `TARGET_WINDOW_MISMATCH` | 前台窗口与预期目标不符 | 有限 |
| `UI_ELEMENT_NOT_FOUND` | 控件定位失败 | 有限 |
| `LOGIN_REQUIRED` | 需要人工登录 | 人工后 |
| `CAPTCHA_REQUIRED` | 需要人工处理验证码 | 人工后 |
| `SITE_LAYOUT_CHANGED` | 页面结构变化 | 否 |
| `STEP_TIMEOUT` | 步骤超时 | 视步骤 |
| `TASK_CANCELLED` | 用户或管理员取消 | 否 |
| `AGENT_OFFLINE` | Agent 离线 | 有限 |
| `COMMAND_EXPIRED` | Agent 收到已过期指令 | 否 |
| `DUPLICATE_COMMAND` | Agent 已处理过相同 commandId | 否 |
| `INVALID_ARGUMENTS` | 动作参数不符合严格白名单 Schema | 否 |
| `UI_ELEMENT_AMBIGUOUS` | 语义定位命中多个控件且未指定 `index` | 否 |
| `UI_ELEMENT_OUT_OF_VIEW` | 定位结果落在目标窗口之外（例如控件已被滚动出视图） | 否 |
| `COORDINATE_OUT_OF_WINDOW` | 窗口相对坐标超出目标窗口范围 | 否 |
| `DISPLAY_PROFILE_MISMATCH` | 实时分辨率或 DPI 与 `AGENT_COORDINATE_MOUSE_PROFILE` 不一致 | 否 |
| `NOT_IMPLEMENTED` | 占位执行器尚未接入真实 Windows 动作 | 否 |
| `DESKTOP_ACTION_FAILED` | 桌面执行器发生未预期错误 | 视动作 |
| `SHOPPING_SITE_UNAVAILABLE` | 购物站点不可用 | 有限 |
| `INVALID_PRODUCT_DATA` | 商品字段、链接或来源域名无效 | 否 |
| `NO_PRODUCTS_IN_BUDGET` | 没有有效候选满足预算 | 否 |

## 6. 配置

配置分三层：

- `config/default.json`：可提交的默认配置。
- `config/local.json`：本机非敏感覆盖，不提交。
- 环境变量：令牌、管理口令等敏感值。

关键配置：

```text
SERVER_HOST=127.0.0.1
SERVER_PORT=7070
DATABASE_PATH=./data/automation.db
ARTIFACT_RETENTION_DAYS=7
COMMAND_PREFIX=#助手
TRUSTED_SENDER_IDS=hashed-sender-id
TASK_TIMEOUT_SECONDS=120
AGENT_HEARTBEAT_INTERVAL_MS=5000
AGENT_WINDOWS_AUTOMATION_ENABLED=false
AGENT_ALLOWED_PROCESSES=notepad.exe
AGENT_ARTIFACT_DIR=./data/artifacts/desktop-agent
ALLOWED_SHOPPING_DOMAINS=...
```

联系人白名单和站点开关存入数据库；敏感配置不得进入日志。

`TRUSTED_SENDER_IDS` 使用逗号分隔的脱敏稳定标识，用于启动时向 SQLite 白名单执行
幂等写入。默认列表为空，即在管理员显式配置前不接受任何聊天任务。

Python Windows 基础执行器默认关闭。启用时 `AGENT_ALLOWED_PROCESSES` 必须是逗号
分隔的纯进程名，禁止传入路径；窗口激活、输入、剪贴板和截图仍须通过 Agent 端动作
白名单与前台窗口校验。

## 7. 数据保留

- 任务元数据：默认 90 天。
- 截图和 Playwright trace：默认 7 天。
- 原始聊天指令：默认 30 天，可配置为只保留摘要。
- 账号凭据、Cookie 和支付数据：禁止写入业务数据库。
