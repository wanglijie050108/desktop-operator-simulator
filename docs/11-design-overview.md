# 设计说明

本文是系统设计的总览说明，用于答辩和交付。完整规格以既有设计文档为准，本文
只做归纳并补充 M5 新增的统计与离线夹具设计，不建立第二套规格。

- 编写日期：2026-09-28
- 关联文档：[01 需求与范围](01-requirements-and-scope.md)、
  [02 系统架构](02-system-architecture.md)、
  [03 接口与数据](03-contracts-and-data.md)、
  [06 决策与风险](06-decisions-and-risks.md)、
  [OpenAPI 契约](../contracts/openapi.yaml)。

## 1. 设计目标

- 用一台 Windows 执行机自动完成两类只读任务：AI 问答、商品查询与三款比较。
- 用户通过受信任聊天账号以自然语言指令驱动，结果回复到原会话。
- 安全优先：确定性编排、白名单动作、双重策略校验，永久禁止支付与越权操作。
- 在缺少真实环境时，跨平台逻辑可用 Fake/夹具开发和验证，真实能力与平台驱动
  严格解耦。

## 2. 总体架构

系统由三个进程组成：

| 组件 | 技术 | 职责 |
|---|---|---|
| Control Server | Node.js 24、Fastify、TypeScript | 任务/工作流/策略/持久化的唯一事实源；HTTP API 与 WebSocket 网关 |
| Desktop Agent | Python 3.11、pywinauto | Windows UI 自动化、前台窗口校验、输入、剪贴板、截图、急停输入释放 |
| Operator Web | Vue 3、Vite、Pinia | 本地管理台：任务、节点、统计三视图 |

数据层为 SQLite（Drizzle ORM、better-sqlite3），组件间通信为：

- Agent ↔ Server：版本化 WebSocket 严格 DTO，无任意脚本/文件/命令执行通道。
- Web ↔ Server：HTTP REST，契约由 TypeBox schema 与 OpenAPI 双重定义。

所有监听地址强制回环（`127.0.0.1`），认证完成前非回环配置直接失败。

## 3. 关键流程

```text
聊天消息 → Agent 读取并上报 → Server 受信任/前缀校验 → 消息去重
  → 意图分派（AI/商品，禁止动作拦截）→ 创建任务与步骤
  → 执行路径二选一：
      (a) 决策循环：观察结构树 → LLM 提议动作 → 校验链 → 下发执行 → verifier 判定
      (b) 确定性快捷路径：调用站点 Adapter → 结果校验与确定性排序
  → 结果校验与确定性排序（商品）
  → Agent 将回复发回原会话 → 管理台展示任务、步骤、结果与统计
```

两条路径共享同一套动作白名单、策略校验与 verifier；决策循环的每一轮都写入决策轨迹，
可按 `taskId + round` 回放。

设计约束：

- 工作流只编排，不包含 UIA/DOM 选择器或坐标；定位器全部封装在版本化 Adapter 内。
- 语义定位优先（UIA/Playwright），固定坐标仅限 PoC 且必须校验窗口、分辨率、DPI。
- **AI 有权提议动作，但无权执行**（ADR-010，方案 B）：AI 依据观察（结构树为主、
  截图与多模态视觉兜底）输出结构化动作提议，提议必须通过与固定工作流完全相同的
  Schema、动作白名单、参数范围与策略校验，且一切输入仍经 `desktop.command` 下发。
  AI 不得产生代码、脚本、文件路径、URL 跳转或直发用户的文本；任务是否成功由确定性
  verifier 判定，AI 自述完成不构成成功。
- 决策循环有界：每任务设轮次、wall-clock 与 token 三重预算，超限转 `WAITING_FOR_HUMAN`。
- 原固定八步商品工作流保留为"有把握时走的确定性快捷路径"，不再是唯一执行路径。

## 4. 任务状态机

任务状态及转换规则与 [`03-contracts-and-data.md`](03-contracts-and-data.md)
一致，要点：

- 正向：`RECEIVED → PLANNED → RUNNING → SUCCEEDED`；缺参转 `WAITING_FOR_INPUT`，
  登录/验证码转 `WAITING_FOR_HUMAN`。
- 终止：`FAILED`、`CANCELLED`、`REJECTED`、`INTERRUPTED`。
- 非法转换被拒绝；服务启动时活动态任务统一置为 `INTERRUPTED`
  （`RECOVERY_AFTER_RESTART`），不自动重放。

## 5. 安全设计

| 机制 | 位置 | 说明 |
|---|---|---|
| 受信任发送者 + 命令前缀 | Server | 默认白名单为空，失败关闭；消息持久化去重 |
| 动作白名单 | Server + Agent | 双重策略校验；Agent 端另有命令有效期（默认 10 分钟） |
| 禁止动作清单 | 策略层 | 支付、下单、红包、验证码绕过、Cookie 窃取、任意命令执行等 10 类 |
| LLM 提议校验链 | Server（决策循环） | Schema → 动作白名单 → 参数范围 → 策略 → 目标允许列表；任一步失败即丢弃，不"尽力修正" |
| 提示注入防线 | Server（观察层） | 网页/聊天/控件文本标记为不可信数据；LLM 无执行权；不依赖提示词健壮性 |
| 决策预算 | Server（决策循环） | 轮次、wall-clock、token 三重上限，超限转 `WAITING_FOR_HUMAN` |
| 前台窗口/进程校验 | Agent | 桌面输入前双重校验，防止误点其他应用 |
| 日志脱敏 | Server + Agent | 邮箱、URL 凭据、密钥、长数字、敏感键整体遮蔽；轨迹中节点名额外 HMAC |
| 指令幂等 | Agent | 过期检查与重复命令保护，单节点串行执行 |
| 数据注入防护 | 工作流 | 网页内容仅作数据，不能变成系统指令 |

未配置真实 Adapter 时默认返回 `ADAPTER_NOT_CONFIGURED`；未配置 LLM 决策适配器时
返回 `DECISION_NOT_CONFIGURED`；桌面占位执行器返回 `NOT_IMPLEMENTED`，均遵循失败
关闭原则。

## 6. 可靠性设计

- **硬超时**：按类型区分（AI 90 秒、商品 120 秒），待人工/待补参不计时；
  工作流内中止 + `TaskReaper` 周期扫描兜底（`TASK_TIMED_OUT`）。
- **有限重试**：仅只读操作（`ai.ask`、`product.open/search/extract`）和瞬时
  错误码可重试，默认上限 2 次、指数退避；发消息等非幂等动作永不重试。
- **中断恢复**：重启后活动任务置中断，管理员显式恢复才以新任务重放。
- **产物清理**：按保留期（7 天）过期，再按总量预算（500 MB）最旧优先淘汰，
  周期扫描且只触及配置目录。
- **决策循环有界**（方案 B 新增）：轮次、wall-clock、token 三重预算；LLM 不可达
  （`LLM_UNAVAILABLE`）、超时（`LLM_TIMEOUT`）、连续提议被拒、观察不足
  （`OBSERVATION_INSUFFICIENT`）都终止循环并转 `WAITING_FOR_HUMAN`，保留最后一帧
  截图与完整轨迹，绝不留无界循环。
- **非确定性可复现**（方案 B 新增）：决策轨迹按 `taskId + round` 记录并可回放；
  回放时校验链不跳过，用于回归测试与演示兜底。

## 7. 统计模块设计（M5 新增）

统计分两层：

- 纯域逻辑：`apps/control-server/src/domain/task-statistics.ts`，输入为普通
  快照，不依赖 SQLite/Fastify，可完全独立测试。
- 应用服务：`StatisticsService` 把持久化记录收敛为快照，再调用域逻辑；
  端点为 `GET /api/v1/statistics`（`from`/`to`/`type` 可选过滤）。

报表结构：`{ overall, byType: { AI_QUESTION, PRODUCT_SEARCH }, generatedAt, version }`；
无数据类型也始终输出零值汇总。

口径定义：

- 成功率 = 成功 /（成功 + 失败），分母为 0 时返回 `null`；取消、拒绝、中断
  不计入；比例保留 4 位小数。
- 耗时只取闭环完成任务的 `updatedAt - createdAt`；汇总含 count、平均、最小、
  最大、P50、P95；分位采用 nearest-rank（`ceil(p/100·n)`）。
- 错误分布按终态非成功任务的 errorCode 聚合，缺失归为 `UNSPECIFIED`，按数量
  降序、code 升序排列。
- 时间窗为 createdAt 闭区间；仅请求时间窗时才排除不可解析时间戳，非法边界
  忽略；类型过滤不受时间戳影响。

当前统计只来自数据库中的真实任务记录；在 Fake/夹具数据阶段，看板与文档必须
显式声明其不代表真实站点成功率。真实实验数据发布时必须按
[`05-testing-and-acceptance.md`](05-testing-and-acceptance.md) 注明目标软件
版本、日期、网络条件和样本量四要素。

## 8. 离线夹具设计（M5 新增）

- 单一自包含文件 `apps/operator-web/public/offline-demo.html`，无外部依赖，
  可断网经 `file://` 打开，也由 Vite 在 `/offline-demo.html` 提供。
- 六个固定场景覆盖正常闭环、策略拒绝、急停和夹具统计，支持上一步/下一步、
  自动播放、键盘切换。
- 顶部红白警示条、全屏水印和界面文案始终标注“测试夹具”；域名、会话名均使用
  `fixture` 命名，且有 UI 测试守护，不得伪装真实网站结果。

## 9. 跨平台边界

- Python Agent 的协议、连接、调度和策略等纯逻辑位于
  `apps/desktop-agent-python/src/desktop_agent`，可在 macOS/Linux 构建和测试。
- Windows 专属能力（pywinauto、Win32、剪贴板、真实应用 Adapter）隔离在 Python
  Adapter 模块，不为在非 Windows 运行而削弱 Windows 行为。
- C# `DesktopAgent.Core` 已确定移除（见 ADR-009），不再作为跨语言契约与回退基线，
  唯一实现为 Python pywinauto。
- Server 侧为开发、CI 和集成测试提供 Fake 适配器；Fake 不进入真实链路。
- **决策层全部位于 Server 侧的跨平台代码**（观察转换、提议校验链、循环、verifier、
  轨迹回放），因此可在 macOS/Linux 用 Fake LLM 与夹具完整测试，不依赖 Windows。
  LLM 客户端是纯 HTTP 依赖，同样跨平台；只有"观察采集"与"动作执行"两端需要
  Windows 实机验证。

## 10. 验证设计

| 层级 | 工具 | 范围 |
|---|---|---|
| 单元测试 | Vitest / pytest | 解析、状态机、策略、排序、脱敏、统计聚合、幂等 |
| 契约测试 | 跨语言 fixtures | Node/Python 对消息版本、枚举、UUID、时间格式理解一致 |
| 集成测试 | 临时 SQLite + 真实进程 | 注册、心跳、重启重连、急停、Fake 闭环 |
| 决策循环测试 | Vitest + Fake LLM / 录制轨迹 | 提议校验链、循环终止、注入防线、verifier 判定、轨迹回放（`docs/05` §1） |
| UI 测试 | Playwright | 桌面与移动视口下三视图、急停确认、恢复、离线演示、决策轨迹视图 |
| 真实 Windows 测试 | — | M0 Spike、真实 E2E、8 小时稳定性（尚未执行） |

决策类测试只断言不变量与校验结果，不断言"模型通常会怎样"，且不依赖真实模型——
详细要求见 [`05-testing-and-acceptance.md`](05-testing-and-acceptance.md)。

覆盖率门槛：行/语句/函数 90%、分支 85%；日常统一入口为 `npm run check`（Node + Python，
不依赖 .NET SDK）。
