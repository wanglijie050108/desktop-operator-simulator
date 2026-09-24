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

### Agent 注册

```json
{
  "schemaVersion": "1.0",
  "type": "agent.hello",
  "messageId": "uuid",
  "timestamp": "2026-09-24T04:00:00Z",
  "payload": {
    "agentId": "uuid",
    "version": "0.1.0",
    "capabilities": ["wechat.read", "wechat.send", "input", "clipboard", "screenshot"]
  }
}
```

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
    "content": "#助手 搜索 300元以内的无线鼠标，选3款"
  }
}
```

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

允许的首期动作：

- `WECHAT_READ_NEW_MESSAGES`
- `WECHAT_SEND_TEXT`
- `WINDOW_ACTIVATE`
- `TAKE_SCREENSHOT`
- `CLIPBOARD_SET_TEXT`
- `INPUT_KEY_CHORD`

禁止提供 `RUN_SCRIPT`、`SHELL_EXEC`、`EVAL_JS` 等通用逃逸动作。

## 4. 错误码

| 错误码 | 含义 | 是否重试 |
|---|---|---|
| `POLICY_DENIED` | 策略拒绝 | 否 |
| `UNTRUSTED_SENDER` | 非白名单联系人 | 否 |
| `COMMAND_UNSUPPORTED` | 不支持的意图 | 否 |
| `TARGET_APP_NOT_FOUND` | 目标应用未运行 | 有限 |
| `TARGET_WINDOW_MISMATCH` | 前台窗口不符 | 有限 |
| `UI_ELEMENT_NOT_FOUND` | 控件定位失败 | 有限 |
| `LOGIN_REQUIRED` | 需要人工登录 | 人工后 |
| `CAPTCHA_REQUIRED` | 需要人工处理验证码 | 人工后 |
| `SITE_LAYOUT_CHANGED` | 页面结构变化 | 否 |
| `STEP_TIMEOUT` | 步骤超时 | 视步骤 |
| `TASK_CANCELLED` | 用户或管理员取消 | 否 |
| `AGENT_OFFLINE` | Agent 离线 | 有限 |

## 5. 配置

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
TASK_TIMEOUT_SECONDS=120
ALLOWED_SHOPPING_DOMAINS=...
```

联系人白名单和站点开关存入数据库；敏感配置不得进入日志。

## 6. 数据保留

- 任务元数据：默认 90 天。
- 截图和 Playwright trace：默认 7 天。
- 原始聊天指令：默认 30 天，可配置为只保留摘要。
- 账号凭据、Cookie 和支付数据：禁止写入业务数据库。
