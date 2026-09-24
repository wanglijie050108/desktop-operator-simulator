# 开发状态

最后更新：2026-09-24

本文记录仓库当前已实现和未实现的事实状态。实施顺序与验收标准仍以
[`04-implementation-plan.md`](04-implementation-plan.md) 和
[`05-testing-and-acceptance.md`](05-testing-and-acceptance.md) 为准。

## 状态说明

- **已完成**：代码和要求范围内的自动化验证均已完成。
- **部分完成**：只有明确列出的子项完成，里程碑退出标准尚未满足。
- **未开发**：仓库中没有对应实现。
- **未验证**：可能已有设计或局部代码，但没有要求环境下的验证证据。

## 当前结论

- 当前阶段：**M5 答辩准备的跨平台可开发部分完成（管理台补全、统计、离线夹具、
  交付文档），真实环境项未验证**。
- 当前可运行能力：Control Server、SQLite、Agent WebSocket 和 .NET Desktop Agent
  占位进程可联合运行；Fake AI、商品和聊天适配器可完成消息到回复的模拟闭环；Vue
  管理台提供任务监控、执行节点、统计看板三视图，可取消、可手动恢复中断/失败
  任务，并可两次确认触发紧急停止。
- 当前可靠性能力：任务硬超时中止、只读操作有限重试、启动中断恢复、Server/Agent
  双重策略校验、日志脱敏和截图/trace 保留清理。
- 当前统计与演示能力：成功率/耗时分位/错误分布报表端点与看板（含夹具声明）；
  断网可用的离线测试夹具页（六场景，明确标注“测试夹具”）；安装手册、用户手册、
  设计说明和答辩演示脚本齐备。
- 当前不可运行能力：真实微信收发、Windows 输入/剪贴板/截图、真实 AI 页面问答和
  商品搜索。
- 当前验收范围：Node/.NET 单元与契约测试、临时 SQLite、跨进程注册、心跳、服务
  重启重连、紧急停止，以及 M2/M3 策略、去重、固定工作流、失败/取消和各 20 次
  Fake 闭环已通过模拟集成验证；M4 超时、重试、恢复、脱敏和清理路径已通过单元与
  模拟集成验证；M5 统计聚合、管理台新交互和离线夹具已通过单元、端点与 Playwright
  验证。当前统计数字只来自数据库/Fake/夹具，不代表真实站点成功率。
- 项目级验收状态：**不具备验收条件**。

## 已完成

### 设计与工程约束

- [x] 需求、架构、接口、实施、测试、安全风险和 Windows 环境基线文档。
- [x] 项目级 AI 开发守卫与 changelog 记录规范。
- [x] 禁止支付、凭据提取、验证码绕过和任意代码执行等安全边界。

### M1：工程骨架（代码完成，验收未完成）

- [x] npm workspaces。
- [x] Node.js 24 LTS 和 npm 11 版本约束。
- [x] TypeScript 严格配置。
- [x] ESLint、Prettier、EditorConfig 和统一 `npm run check`。
- [x] 精确依赖版本和 `package-lock.json`。
- [x] GitHub Actions Node.js 24 CI。
- [x] Control Server Fastify 应用工厂和启动入口。
- [x] `GET /health` OpenAPI 契约实现。
- [x] 默认监听 `127.0.0.1:7070`，认证完成前拒绝非回环监听。
- [x] 健康检查和服务配置单元测试。
- [x] .NET 10 solution、跨平台 Desktop Agent Core 和 Console Host。
- [x] SQLite 两阶段 migration，覆盖 Agent、命令、消息、任务、步骤和确认实体。
- [x] Fastify 与 Desktop Agent JSON 结构化日志。
- [x] WebSocket 1.0 严格契约、Agent 注册、心跳、离线状态和重复连接替换。
- [x] Agent 有上限的指数退避重连。
- [x] 指令过期检查、去重、单 Agent 串行执行、任务取消和紧急停止。
- [x] Windows 桌面动作占位执行器，未执行动作明确返回 `NOT_IMPLEMENTED`。
- [x] Node/C# 共用 JSON fixtures 和跨语言契约测试。
- [x] Node 与 .NET format、build、test CI 配置。
- [x] Node.js 24.21.0 下完成干净安装和完整 `npm run check`。
- [x] 81 项自动化测试通过：Control Server 40 项、TypeScript 契约 4 项、C# 37 项。
- [x] Fake 集成验证：注册、心跳、服务重启重连、紧急停止和 `PAUSED` 状态。
- [x] GitHub Actions 的 Node 和 Windows .NET jobs 在修复干净检出后实际通过。

### M2：AI 问答闭环（跨平台代码与模拟验证完成，真实集成未验证）

- [x] 受信任发送者和命令前缀策略，默认白名单为空并失败关闭。
- [x] 严格 `chat.message.received` Node/C# 契约和已注册 Agent 事件入口。
- [x] SQLite 持久化消息去重，不重复创建或执行任务。
- [x] 规则意图解析、禁止动作拦截和固定 AI 问答工作流。
- [x] AI 问答与聊天回复 Adapter 接口、失败关闭默认实现和测试 Fake。
- [x] 任务/步骤查询、状态筛选、运行中取消 API。
- [x] Vue 管理台任务列表、步骤时间线、结果、错误和取消操作。
- [x] 桌面与移动视口 Playwright UI 验证。
- [x] 标准问答连续 20 次 Fake 闭环成功，重复消息不重复执行。
- [x] 当前自动化验证共 115 项通过：Control Server 71 项、TypeScript 契约 5 项、
  C# 37 项、Operator Web Playwright 2 项。

### M3：商品查询闭环（跨平台代码与模拟验证完成，真实集成未验证）

- [x] 商品关键词、最高预算、候选数量和偏好的确定性解析。
- [x] 统一消息去重与 AI/商品意图分派。
- [x] 打开站点、搜索和抽取候选的分阶段 Adapter 接口及失败关闭默认实现。
- [x] 标题、价格、HTTPS 链接、允许域名、评分、店铺、销量、属性和采集时间校验。
- [x] 排序前预算硬过滤，以及偏好、评分、销量、价格固定权重的稳定排序。
- [x] 固定八步商品工作流、三款比较回复和任务/步骤持久化。
- [x] 缺少必要参数时进入 `WAITING_FOR_INPUT` 并回复缺失字段。
- [x] 登录失效和验证码进入 `WAITING_FOR_HUMAN`，不自动绕过。
- [x] Vue 管理台展示商品排名、字段、来源、采集时间和原始链接。
- [x] 正常、非法字段、超预算、重复消息、失败、待人工、取消和连续 20 次 Fake
  闭环测试。
- [x] 当前自动化验证共 155 项通过：Control Server 109 项、TypeScript 契约 5 项、
  C# 37 项、Operator Web Playwright 4 项。

### M4：可靠性与安全（跨平台代码与模拟验证完成，真实环境项未验证）

- [x] 按任务类型的硬超时（AI 问答 90 秒、商品搜索 120 秒），等待人工/补参状态
  不计时。
- [x] 工作流内超时中止，`TaskReaper` 周期扫描兜底并记录 `TASK_TIMED_OUT`。
- [x] 有限重试策略：仅 `ai.ask`、`product.open/search/extract` 只读操作和瞬时
  错误码（`ADAPTER_TIMEOUT`、`NETWORK_ERROR`、`SERVICE_UNAVAILABLE`、
  `TEMPORARY_UNAVAILABLE`）可重试，默认最多 2 次、指数退避；聊天发送等非幂等
  动作永不重试。
- [x] 取消与中断恢复：控制服务器启动时把活动态任务置为 `INTERRUPTED`
  （`RECOVERY_AFTER_RESTART`），不自动重放；管理员显式调用
  `POST /api/v1/tasks/:taskId/recover` 才以新任务重放。
- [x] Desktop Agent 独立策略校验：动作白名单、命令有效期上限（默认 10 分钟），
  与 Control Server 构成双重策略；`AGENT_ALLOWED_ACTIONS` 环境变量可配置。
- [x] Node（`redactText`/`redactValue`/`redactError`）与 C#（`LogRedactor`）
  日志脱敏，覆盖邮箱、URL 凭据、密钥赋值、长数字和敏感键整体遮蔽。
- [x] 截图/trace 保留策略：按保留期（默认 7 天）过期，再按总量预算（默认
  500MB）最旧优先淘汰；`ArtifactCleanupService` 周期清理且只扫描配置目录。
- [x] 禁止动作拦截扩充：下单/发红包及五类英文危险指令模式。
- [x] 超时中止、重试 attempt 递增、恢复全流程、脱敏和清理的单元与模拟集成测试。
- [x] 当前自动化验证：Control Server 189 项、TypeScript 契约 5 项、C# 55 项
  全部通过，覆盖率高于全局门槛。

### M5：答辩准备（跨平台可开发部分完成，真实环境项未验证）

- [x] 管理台补全：任务监控/执行节点/统计看板三视图；Agent 列表、版本、能力、
  最近心跳与在线状态；状态筛选由 5 项补齐到 8 项。
- [x] 紧急停止改为两次点击确认（4 秒窗口）防误触，对全部节点生效。
- [x] FAILED/INTERRUPTED 任务可在详情中“重新执行”，基于原请求创建新任务，
  中断任务不自动重放。
- [x] 统计纯域：成功率（分母为成功+失败，零分母返回 `null`）、耗时分位
  （nearest-rank 的 P50/P95）、终态错误分布（缺失归 `UNSPECIFIED`）。
- [x] `GET /api/v1/statistics` 报表端点（`from`/`to`/`type` 过滤），OpenAPI
  同步，并补齐契约原缺失的 `/api/v1/tasks/{taskId}/recover`。
- [x] 统计看板含总体/AI 问答/商品查询三卡片、错误分布条形图和固定夹具声明。
- [x] 离线测试夹具 `offline-demo.html`：零依赖单文件、断网可 `file://` 打开、
  六场景（就绪/AI/商品/策略拒绝/急停/夹具统计）、自动播放与键盘切换；红白
  警示条、水印和 fixture 域名明确标注“测试夹具”。
- [x] 交付文档：[`09-installation-guide.md`](09-installation-guide.md)、
  [`10-user-manual.md`](10-user-manual.md)、
  [`11-design-overview.md`](11-design-overview.md)、
  [`12-demo-script.md`](12-demo-script.md)。
- [x] 自动化验证：Control Server 207 项（M4 基线 189 + 统计域 14 + 端点 4）、
  Operator Web Playwright 12 项；真实环境步骤在文档中仅占位。

## 未完成

### M0：技术验证（未验证）

- [ ] 微信 UIA 收发连续测试。
- [ ] AI 页面 Playwright 问答。
- [ ] 购物网站搜索与商品提取。
- [ ] Windows 实机、分辨率、DPI、软件版本记录。
- [ ] 三条 PoC 路径的 20 次重复运行和成功率统计。

### M1：剩余验收（未验证）

- [ ] 执行 `npm run test:stability:m1`，完成 Agent 两小时持续连接验证。
- [ ] 在目标 Windows 机器验证 Desktop Agent 运行和服务重启恢复。
- [ ] 接入真实 Windows 执行器后验证紧急停止在两秒内释放全部输入。

### M2：剩余真实集成与验收（未验证）

- [ ] Windows 微信 UIA 新消息读取 Adapter。
- [ ] 目标 AI 页面 Playwright Adapter。
- [ ] Windows 微信 UIA 文本回复 Adapter。
- [ ] 登录失效后的人工恢复与继续执行。
- [ ] 目标 Windows、微信和 AI 页面标准问答连续 20 次成功率验证。

### M3：剩余真实集成与验收（未验证）

- [ ] 冻结目标购物站点、允许域名、版本和专用测试账号。
- [ ] 目标购物站点 Playwright 搜索与字段抽取 Adapter。
- [ ] 登录或验证码人工处理后的继续执行入口。
- [ ] 使用 100 个人工标注候选验证字段抽取准确率不低于 95%。
- [ ] 在目标站点执行 20 个查询并验证成功率不低于 90%。

### M4：剩余真实环境项（未验证）

- [ ] FlaUI 前台进程和目标窗口双重检查。
- [ ] 适配器版本和页面变化诊断的真实页面验证。
- [ ] 两秒紧急停止在真实 Windows 执行器上实测。
- [ ] 八小时持续稳定性测试。
- [ ] 超时、重试、恢复和保留清理策略在真实 Windows/站点环境验收。

### M5：剩余真实环境项（未验证）

- [ ] Windows 全链路 E2E。
- [ ] 完整闭环备份视频。
- [ ] 目标软件版本和专用演示账号固化。
- [ ] 基于真实环境的成功率、耗时和错误分布实验数据（须含版本/日期/网络/样本量
  四要素），当前仅有 Fake/夹具数据。

## 当前限制

- 目标 Windows 环境尚未提供验证记录。
- 微信、目标 AI 页面和购物站点尚未冻结具体版本或对象。
- 当前 Desktop Agent 使用占位执行器，不声明真实桌面能力，所有桌面动作返回
  `NOT_IMPLEMENTED`。
- 当前 AI、商品和聊天 Adapter 默认返回 `ADAPTER_NOT_CONFIGURED`；Fake 只用于
  自动化测试。
- 当前 Operator Web 三视图（任务/节点/统计）和急停、恢复、筛选已可用，但只在
  Fake/夹具数据下验证，不代表真实运行结果。
- SQLite、Agent 通道和任务工作流已集成，但没有真实 Windows、AI 页面或购物站点
  执行证据。

## 维护要求

1. 每次实现、删除、验证或改变上述能力时，在同一任务中更新本文。
2. 只有代码和对应范围的验证均完成后，才能标记为“已完成”。
3. Fake、fixture 或模拟 Agent 的结果必须标明“模拟验证”，不能替代真实 Windows
   或真实站点验证。
4. 未执行的测试保持“未验证”，不得根据代码存在推断为通过。
5. 更新“最后更新”日期，并确保本文与实际代码、测试结果及 changelog 一致。
