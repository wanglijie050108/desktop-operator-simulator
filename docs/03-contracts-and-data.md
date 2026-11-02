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

### Observation（方案 B 新增）

一次决策循环步骤的观察结果。**属于临时数据**，且必须区分两个边界：

| 视图 | 去向 | 节点名 | 作用 |
|---|---|---|---|
| Prompt 视图 | 当次 LLM 请求 | **保留**（截断至 80 字符） | 模型需要可读标签才能判断"哪个是搜索框""哪行是商品" |
| 持久化视图 | 轨迹、存储 | **HMAC token** | 落库记录不得可还原出 UI 原文 |

实现上由一次采集（`ObservationCapture`）同时产出两个视图，两者不可互相替代：

- Prompt 视图经 `renderPromptView` 渲染为逐行文本（`[序号] controlType "name" id=... box=...`），
  再包进 `<untrusted-ui-observation>` 分隔符。渲染时折叠一切空白、剥离 `<`/`>`，
  防止标签伪造树结构或提前闭合分隔符；深度、行数、名长、总长均有上限并显式标记截断。
- 持久化视图沿用 `uia_inspection.py` 的 HMAC 做法，原名替换为 `node:<16 hex>`。

> 2026-11-02 修正：此前实现把 HMAC 脱敏用在**进模型之前**，模型收到的树只有 token、
> 无法据标签判断界面，功能上不可用；且与本节原要求（原名可进当次请求）相反。
> 现已改为"模型看受限原文、落库看 token"，注入防线仍靠分隔符标记 + LLM 无执行权 +
> 五重校验，而非靠删掉文本。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 观察 ID |
| taskId | UUID | 所属任务 |
| round | integer | 决策轮次，从 1 开始 |
| source | enum | `UIA_TREE` / `DOM_TREE` / `SCREENSHOT` |
| nodeCount | integer | 节点总数（截断前） |
| truncated | boolean | 是否因上限被截断 |
| redactedTreeRef | string | 脱敏结构树的存储引用 |
| screenshotRef | string nullable | 截图产物引用（走既有保留策略） |
| capturedAt | datetime | 采集时间 |

### DecisionTrace（方案 B 新增，FR-15）

决策轨迹是约束非确定性的核心实体，必须支持回放。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 轨迹条目 ID |
| taskId | UUID | 所属任务 |
| round | integer | 决策轮次 |
| observationId | UUID | 对应观察 |
| model | string | 模型标识与版本（用于漂移诊断，R-14） |
| proposal | JSON | LLM 原始结构化提议（已脱敏） |
| validationResult | enum | `ACCEPTED` / `REJECTED` |
| rejectionCode | string nullable | 被拒时的稳定错误码 |
| actionType | string nullable | 通过校验后实际下发的动作类型 |
| commandId | string nullable | 下发的 `desktop.command` 关联 ID |
| executionResult | enum nullable | `SUCCEEDED` / `FAILED` / `CANCELLED` |
| verifierPassed | boolean | 该轮结束时后置条件是否满足 |
| promptTokens / completionTokens | integer | 该轮 token 消耗（成本统计） |
| createdAt | datetime | 记录时间 |

回放约定：以 `taskId + round` 为序回放已记录的 `proposal`，替代真实 LLM 调用，
用于回归测试与演示兜底。回放时**校验链不得跳过**——回放证明的是校验与执行路径
一致，不是模型一致。

`2026-11-02` 落地的实现要点：

- 存储：`decision_traces` 表，`(task_id, round)` 唯一；重复记录同一轮为原地更新而非新增，
  使回放顺序无歧义。任务删除时级联清理——脱离任务的轨迹无法归属也无法回放。
- 回放适配器 `ReplayLlmDecisionAdapter` **只替换 LLM 调用**：提议仍传入同一条五重校验链，
  原先被拒的提议会以相同 `rejectionCode` 再次被拒。
- 录制中没有的轮次会报错终止，不会"跳过继续"——否则残缺轨迹会被误读成完整运行。
- 暴露：`GET /api/v1/tasks/{taskId}` 返回 `TaskDetail`，在 `Task` 之上增加
  `decisionTraces`；列表端点不返回轨迹（长列表会因此平方级膨胀）。经典路径任务该字段
  为空数组，用以区分"没走决策循环"与"走了但没记录"。

### DecisionBudget（方案 B 新增，FR-14）

每任务的三重预算，超限即终止循环并转 `WAITING_FOR_HUMAN`：

| 预算 | 说明 |
|---|---|
| `maxRounds` | 决策轮次上限 |
| `maxWallClockMs` | 从任务进入 `RUNNING` 起的墙钟上限 |
| `maxTokens` | 该任务累计 token 上限 |

具体数值待实测后冻结（见 `docs/06` §3.2）。预算耗尽返回
`DECISION_BUDGET_EXHAUSTED`。

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
任务。通过通用策略后，消息按规则分派到 AI 问答或商品查询任务；商品查询
要求商品关键词、最高预算和 1 至 3 的候选数量，偏好为可选字段。缺少必填字段时创建
`WAITING_FOR_INPUT` 任务并只回复缺失项。

**方案 B 的解析边界**（ADR-010 + `docs/14` §1.1 D10）：

- 处理顺序是先跑现有 `parseProductSearchCommand` 正则；解析成功即走原路径，LLM 不参与。
- 正则返回 `COMMAND_UNSUPPORTED` / `INVALID_ARGUMENTS` 时，**追加一次** LLM 解析尝试，
  把文本转为结构化请求（`query` / `maxPrice` / `candidateCount` / `preferences`）。
- LLM 解析结果走**与动作提议同一条校验链**（JSON Schema → 业务范围 → 策略）；任一步
  失败即按缺参处理并回复缺失字段，不猜测预算与数量。
- 命令前缀与动词这一级受理判定**始终由确定性规则完成**：LLM 无法让一条本应被拒的
  消息被执行。
- 该路径覆盖中文数字预算（如"三百块以内"）与口语化表达。

**现行实现的已知限制**：`parseProductSearchCommand` 是纯正则解析，只接受
`#助手 搜索 …` 这种带动词的固定形式，且必须有**阿拉伯数字的预算**与"选 N 款"的数量
表达，三项缺一即返回 `INVALID_ARGUMENTS` 并回复缺失字段；自然语言说法
（如"帮我找个三百块以内的静音鼠标"）当前判 `COMMAND_UNSUPPORTED`，LLM 补足解析
将在 M6 实现（`docs/04` 的 LLM-02）。

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

### 观察结构树（方案 B 新增）

决策循环通过标准 `desktop.command` 通道请求观察，`action` 为 `DESKTOP_INSPECT_TREE`：

```json
{
  "schemaVersion": "1.0",
  "type": "desktop.command",
  "messageId": "uuid",
  "timestamp": "2026-10-10T04:01:00Z",
  "payload": {
    "commandId": "uuid",
    "taskId": "uuid",
    "expiresAt": "2026-10-10T04:01:30Z",
    "action": "DESKTOP_INSPECT_TREE",
    "arguments": {
      "processName": "chrome.exe",
      "titleContains": "购物",
      "maxNodes": 400,
      "maxDepth": 50,
      "timeoutMs": 5000
    }
  }
}
```

参数说明（`2026-10-24` 随实现校正，与 `packages/contracts` 一致）：

| 字段 | 必填 | 范围 | 说明 |
|---|---|---|---|
| `processName` | 是 | `^[A-Za-z0-9_.-]{1,100}$` | **纯进程名**；带路径或引号一律拒收，防止借观察触碰任意可执行文件 |
| `titleContains` | 否 | 1–200 | 同进程多窗口时用于收敛到唯一窗口 |
| `maxNodes` | 否 | 1–20000 | Agent 端默认 1000；**商品列表页建议 400**（见下） |
| `maxDepth` | 否 | 1–100 | Agent 端默认 50 |
| `timeoutMs` | 否 | 1–30000 | Agent 端默认 5000；**单次 UIA 调用**的超时，不是整个命令的超时 |

`desktop.command.result` 的 `payload.observation` 返回结构树：

```json
{
  "processName": "chrome",
  "processId": 4321,
  "windowHandle": 123456,
  "windowTitle": "购物 - Chrome",
  "capturedAt": "2026-10-24T04:00:01Z",
  "nodes": [
    { "depth": 0, "controlType": "Window", "automationId": "RootWebArea",
      "name": "购物", "enabled": true, "visible": true }
  ],
  "truncated": false,
  "timedOut": false
}
```

节点为**按深度优先展平的数组**（`depth` 标注层级，比嵌套 JSON 体积小得多）；
Control Server 用 `rebuildTree` 还原成树再做脱敏与截断，`depth` 跳级（父节点被截断）
时保留孤儿节点而不是丢弃。`name` 到此为止仍是**原始 UI 文本**：脱敏在 Control Server
完成，HMAC 密钥不出服务器进程。Agent 只保证字符合法（无孤立代理对、无私用区/控制/
双向覆盖字符）与长度受限。

该调用**只读、不注入输入**、不激活窗口，仍沿用标准命令通道的有效期、幂等与取消语义。

允许的首期动作：

- `WECHAT_READ_NEW_MESSAGES`
- `WECHAT_SEND_TEXT`
- `WINDOW_ACTIVATE`
- `DESKTOP_INSPECT_TREE`（方案 B 新增：只读上报 UIA 结构树，作为决策循环的观察来源）
- `TAKE_SCREENSHOT`
- `CLIPBOARD_SET_TEXT`
- `INPUT_KEY_CHORD`
- `MOUSE_MOVE`
- `MOUSE_CLICK`
- `MOUSE_DRAG`
- `MOUSE_SCROLL`
- `MOUSE_CLICK_POSITION`

禁止提供 `RUN_SCRIPT`、`SHELL_EXEC`、`EVAL_JS` 等通用逃逸动作。

`DESKTOP_INSPECT_TREE` 的约束（方案 B 新增）：

- 只读，不注入任何输入，不改变窗口状态，因此允许在无前台校验的情况下执行；但它
  **只能读取白名单进程**的窗口（`AGENT_ALLOWED_PROCESSES` 校验，越界为
  `POLICY_DENIED`）。
- 必须在 Agent 端设置节点数上限与单节点字段长度上限（200 字符）；超限时置
  `truncated: true` 并分级截断，**不得静默截断**。命中 `maxDepth` 同样置
  `truncated: true`，因为它确实少走了一层。
- **每一次 UIA 调用都有超时**（`timeoutMs`）。某个窗口的无障碍提供程序卡死时，
  放弃该窗口并置 `timedOut: true`，已采集节点照常返回——不允许一次观察吃掉整个
  任务的 wall-clock 预算。
- 支持**进程级排除**（构造参数 `excluded_observation_processes`）：在发起任何 UIA
  调用**之前**按进程名过滤，命中时返回 `TARGET_PROCESS_EXCLUDED`。这是为「编辑器/终端
  等应用的 a11y 提供程序 traversal 极慢」准备的暴力开关，比调大超时更省时间。
- 返回的节点字段限于 `controlType` / `automationId` / `name` / `enabled` / `visible`；
  不得返回控件内容以外的进程信息（如内存、句柄表、其它进程数据）。
- 该动作的返回值**只用于当次决策**；写入轨迹前必须脱敏 `name` 字段。
- **字符串卫生**：Agent 在序列化前修复孤立 UTF-16 代理对（否则严格 UTF-8 编码会
  整条失败）、剥离私用区/控制/双向覆盖字符、按 200 字符截断。这是「一个 emoji 窗口
  标题搞垮整次观察」的防线，不是可选优化。

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
- `GET /api/v1/tasks/{taskId}`：查询单个任务、结果、步骤时间线，以及 `decisionTraces`
  （决策循环各轮轨迹；经典路径为空数组）。
- `POST /api/v1/tasks/{taskId}/cancel`：取消非终态任务，并向在线 Agent 广播取消。
- `POST /api/v1/tasks/{taskId}/recover`：以新任务重放 `FAILED` / `INTERRUPTED` 任务；
  中断任务不自动重放，须管理员显式确认。
- `GET /api/v1/statistics`：按可选 `from` / `to` / `type` 查询成功率、耗时分位与错误分布。
- `GET /api/v1/agents`：查询已注册 Agent 的状态、能力与最近心跳。
- `POST /api/v1/system/emergency-stop`：停止并暂停所有在线 Agent，同时终止决策循环。

任务由聊天事件创建，不提供绕过受信任发送者和命令前缀策略的通用 HTTP 创建入口。
具体 JSON Schema 以 `contracts/openapi.yaml` 为准。

方案 B 的任务详情另需返回决策轨迹（`DecisionTrace`）与每任务 token 消耗，
以便审计"AI 为什么点这里"并统计成本（FR-15、R-13）。

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
| `TARGET_PROCESS_EXCLUDED` | 该进程被观察排除列表过滤，未进入 UIA 遍历（`2026-10-24` 新增） | 否 |
| `OBSERVATION_FAILED` | 决策循环某一轮未能取得观察（Agent 离线、超时或无载荷），转人工（`2026-11-02` 新增） | 有限 |
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
| `DECISION_NOT_CONFIGURED` | 未配置 LLM 决策适配器（失败关闭默认值，方案 B） | 否 |
| `PROPOSAL_REJECTED` | LLM 动作提议未通过 Schema/白名单/参数/策略校验（方案 B） | 否 |
| `DECISION_BUDGET_EXHAUSTED` | 决策轮次、墙钟或 token 预算耗尽（方案 B） | 否 |
| `LLM_UNAVAILABLE` | LLM 服务不可达或返回错误（方案 B） | 有限 |
| `LLM_TIMEOUT` | LLM 调用超时（方案 B） | 有限 |
| `OBSERVATION_INSUFFICIENT` | 结构树节点不足且视觉兜底不可用，无法继续决策（方案 B） | 否 |

## 6. 配置

配置**只通过环境变量提供**，不存在配置文件，也不得在配置中写入账号凭据
（与 [`09-installation-guide.md`](09-installation-guide.md) 一致；此前本节描述的
`config/default.json` / `config/local.json` 从未实现，已删除）。未提供配置时系统按
安全默认值运行（白名单为空、适配器与决策适配器失败关闭）。

关键配置：

```text
SERVER_HOST=127.0.0.1
SERVER_PORT=7070
DATABASE_PATH=./data/automation.db
ARTIFACT_RETENTION_DAYS=7
COMMAND_PREFIX=#助手
TRUSTED_SENDER_IDS=hashed-sender-id
AGENT_HEARTBEAT_INTERVAL_MS=5000
AGENT_WINDOWS_AUTOMATION_ENABLED=false
AGENT_ALLOWED_PROCESSES=notepad.exe
AGENT_ARTIFACT_DIR=./data/artifacts/desktop-agent
ALLOWED_SHOPPING_DOMAINS=...
```

方案 B 新增的决策配置（密钥只经环境变量注入，禁止写入日志或入库）：

```text
LLM_API_BASE=            # OpenAI 兼容端点，未配置则决策适配器失败关闭
LLM_API_KEY=             # 仅环境变量，禁止落库/落日志
LLM_MODEL=               # 模型标识；变更需记入决策轨迹（R-14）
DECISION_MAX_ROUNDS=     # 每任务决策轮次上限
DECISION_MAX_WALL_CLOCK_MS=
DECISION_MAX_TOKENS=
VISION_MODEL=            # 可选，视觉兜底所用多模态模型
```

决策循环的**装配开关**（`2026-11-02` 新增，默认全部关闭）：

```text
DECISION_LOOP_ENABLED=true            # 唯一的总开关；只认字面量 true，1/yes/TRUE 都不算
DECISION_LOOP_AGENT_ID=               # 承接决策循环的 Agent
DECISION_TARGET_PROCESS=              # 被观察/操作的窗口进程名（纯进程名，不带路径）
DECISION_TARGET_TITLE_CONTAINS=       # 可选，同进程多窗口时收敛
DECISION_TRACE_REDACTION_KEY=         # ≥16 字符的 HMAC 密钥；缺失则拒绝启用
DECISION_OBSERVATION_MAX_NODES=       # 可选，传给 Agent 的节点预算
DECISION_OBSERVATION_TIMEOUT_MS=      # 可选，单次 UIA 调用超时
```

六项缺任一即**不启用**决策循环，回落到经典站点适配路径，并在启动日志给出
`reason`（`DECISION_LOOP_DISABLED` / `..._AGENT_ID_MISSING` / `..._TARGET_PROCESS_MISSING` /
`DECISION_TARGET_NOT_ALLOWLISTED` / `DECISION_LLM_NOT_CONFIGURED` /
`DECISION_TRACE_REDACTION_KEY_MISSING`）。半配置的后端不会"尽力运行"一个跑不完的循环。

超时按任务类型区分：AI 问答 90 秒、商品搜索 120 秒（`domain/task-timeout.ts`）。
此前本文档写的单一 `TASK_TIMEOUT_SECONDS=120` 与实际实现不符，已删除。

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
