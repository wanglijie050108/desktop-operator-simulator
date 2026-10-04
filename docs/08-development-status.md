# 开发状态

最后更新：2026-10-04

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
  交付文档），pywinauto Desktop Agent 迁移分支已合并进 main、代码层完成并通过 Windows
  质量门与 CI；M0 记事本基础操作已取得 20 轮 20/20 实机证据，微信与浏览器真实环境项
  仍未验证**。
- 当前可运行能力：Control Server、SQLite、Agent WebSocket 和 .NET Desktop Agent
  占位进程可联合运行；Fake AI、商品和聊天适配器可完成消息到回复的模拟闭环；Vue
  管理台提供任务监控、执行节点、统计看板三视图，可取消、可手动恢复中断/失败
  任务，并可两次确认触发紧急停止。
- 当前 Python 迁移能力：已建立 Python 3.11/uv 工程、严格 WebSocket 1.0 协议模型
  和共享 fixture 测试；已实现注册、心跳、有上限重连、独立接收循环、串行命令队列、
  动作白名单、指令过期与有界去重、活动执行取消、两秒急停释放边界、日志脱敏及
  失败关闭执行器。Windows 基础执行器（白名单窗口激活、前台复核、剪贴板、按键组合、
  窗口截图、输入释放）已在目标 Windows 11 上通过记事本 20 轮 20/20 实机验证；
  鼠标动作（`MOUSE_MOVE`/`MOUSE_CLICK`/`MOUSE_DRAG`/`MOUSE_SCROLL` 语义定位，
  `MOUSE_CLICK_POSITION` 窗口相对坐标兜底且默认关闭）已完成契约、协议模型、执行器、
  pywinauto 后端、按键跟踪释放与 Fake/模拟编辑器测试，**尚未在目标机执行 20 轮实机
  验证**；微信 UIA Adapter 仍未实机校准。
  微信接收基础层已实现 HMAC 隐私标识、稳定指纹、内存去重和 WebSocket 上报循环，
  并提供不保存明文 Name/窗口标题的只读 UIA 控件树取证命令。
- 微信 UIA 读取来源 `wechat_source.py`（`WeChatUiAMessageSource` + 纯函数
  `extract_conversation`：可见文本抽取、50 条上限、空标题回退到窗口标题）、剪贴板粘贴发送
  `windows_backend.send_chat_text` 与 `windows_executor` 的 `WECHAT_SEND_TEXT`（含前台复核、
  策略白名单 `wechat_process_name`）现已实现，并通过 mock 控件树/fake 后端单测；真实微信控件
  定位尚未实机校准。
- 控制服务器新增 `AgentGateway.requestDesktopCommand`（发送 + 等待 `desktop.command.result` +
  超时）、桌面 Agent 在线选择 `pickWeChatSendAgent`，以及真实 `DesktopAgentChatReplyAdapter`
  （fail-closed、无 `wechat.send` 代理即不可用），仅当 `enableDesktopChatReply` 显式启用；该
  闭环已通过 mock Agent 单测，未接真实桌面 Agent。
- 当前可靠性能力：任务硬超时中止、只读操作有限重试、启动中断恢复、命令执行中
  取消/急停可即时送达 Agent、Server/Agent 双重策略校验、日志脱敏和截图/trace
  保留清理。
- 当前统计与演示能力：成功率/耗时分位/错误分布报表端点与看板（含夹具声明）；
  断网可用的离线测试夹具页（六场景，明确标注“测试夹具”）；安装手册、用户手册、
  设计说明和答辩演示脚本齐备。
- 当前不可运行能力：真实微信收发、真实 AI 页面问答和商品搜索。Windows 基础输入/
  剪贴板/截图已在记事本上取得 20/20 实机证据，但尚未在微信或其它真实业务窗口上验证；
  鼠标动作已通过 Fake 与模拟编辑器验证，目标机 20 轮实机证据仍缺失。
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
- [x] 实现方向收口（ADR-008）：Windows 桌面自动化唯一实现方向为 Python 3.11 + pywinauto；
  C# Agent 冻结保留，不删除、不新增 Windows 自动化、不加回日常质量门，仅作为跨语言契约与
  回退基线存在于 CI 的 `dotnet` job 与 `npm run check:all`；目录级约束见
  `apps/desktop-agent/README.md`。

### Python Desktop Agent 迁移（部分完成）

- [x] 建立 `apps/desktop-agent-python` Python 3.11/uv 工程和锁文件。
- [x] 使用严格模型覆盖 Agent/Server 双向 WebSocket 1.0 消息及六类桌面命令参数。
- [x] 复用 Node/C# 共享 JSON fixture，并覆盖未知字段、错误版本、非 UTC 时间、
  空 UUID、重复能力/按键和超大消息。
- [x] 实现 WebSocket 注册、welcome 校验、心跳、有上限重连和优雅退出。
- [x] 使用独立接收循环与串行命令队列，确保控制帧不被执行中的命令阻塞。
- [x] 默认执行器失败关闭为 `NOT_IMPLEMENTED`，急停后状态上报 `PAUSED`。
- [x] 实现 Agent 端动作白名单、十分钟有效期上限、指令过期与有界去重。
- [x] 实现活动执行取消、急停取消、两秒输入释放调用边界及 `BUSY` 活动指令心跳。
- [x] 实现与 Node/C# 规则一致的邮箱、URL 凭据、密钥赋值和长数字日志脱敏。
- [x] Python 质量门（Ruff format/lint、mypy strict、pytest）已在 Windows 主机实测通过：
  127 项收集（125 通过、2 项因仅适用于非 Windows 而跳过），覆盖率 92.39%；同一检查
  已在 GitHub Actions 的 `windows-latest` **Python job** 上通过（CI run `36691157463`）。
- [x] 修复质量门在 Windows 上的两处平台可移植性缺陷：`windows_backend.py` 的平台条件
  `type: ignore` 触发 `unused-ignore`，以及两处测试用 `str(Path)` 比较路径在 Windows
  分隔符下失配。该缺陷仅在 macOS 上不可见，此前“全部通过”的结论仅覆盖 macOS。
- [x] Python Agent 通过真实 Node/Python 进程的注册、服务重启重连和急停状态集成测试：
  先在 macOS 上完成，随后由 CI 的 `dotnet` job 在 `windows-latest` 上实际运行（该 job
  此前因 runner 未预装 `uv` 而失败，已由 CI run `36695036267` 验证转绿）。
- [x] 实现默认关闭的 pywinauto Windows 基础执行器；仅允许纯进程名白名单，窗口
  激活后按句柄和进程 ID 复核前台状态，支持剪贴板、按键组合和窗口截图。
- [x] 提供固定 20 轮记事本 M0 Spike 工具，记录环境、逐轮耗时、稳定错误码、成功率
  和脱敏截图；代码及 Fake 流程已验证。
- [x] 修复记事本 Spike 的窗口定位：改为**按窗口句柄锁定本次启动的新窗口**。第四轮实机诊断
  证明标题不可用作定位依据——Windows 11 商店版记事本以**文档第一行**作为未保存文档的标题，
  运行自身输入的 `M0-NOTEPAD-SPIKE-01` 会把标题从 `无标题 - Notepad` 改成
  `*M0-NOTEPAD-SPIKE-01 - Notepad`，因此迭代 1 输入完成后标题条件永不命中（这解释了
  20 轮 `TARGET_WINDOW_NOT_FOUND` 与"迭代 1 耗时约为其余两倍"的时间线）。现行规则：
  运行前必须无记事本窗口（`NOTEPAD_WINDOWS_ALREADY_OPEN`，且不启动新进程）→ 只接受连续
  多次轮询稳定且标题非空的新窗口 → 由 `executor.pin_target` 按句柄与进程 ID 锁定，每轮
  复核存活（失效为 `TARGET_WINDOW_LOST`）→ 跑满 20 轮前先复核一次。`find_window` 的错误码
  细分为 `TARGET_WINDOW_NOT_FOUND` / `MULTIPLE_TARGET_WINDOWS`，作为不锁句柄时的回退路径。
  同时修正急停释放：不再注入从未按下过的鼠标按键抬起事件（该事件在 Win11 WinUI 应用中会
  弹出右键菜单并抢占焦点）。该行为已由注入式单元测试验证，尚未取得真实 Windows 20 轮成功率。
- [x] 实现微信消息接收基础层：HMAC 会话/发送者标识、无稳定 ID 指纹、有界去重、
  发布失败重试和 Agent WebSocket 主动上报；并新增 `wechat_source.py` 的 `WeChatUiAMessageSource`
  与 `extract_conversation`（可见文本抽取、50 条上限、空标题回退），经 mock 控件树单测验证，
  真实控件定位待校准。
- [x] 提供微信 UIA 只读取证工具；最多记录 2000 个结构节点，Name 和窗口标题使用
  临时 HMAC，节点上限或读取异常明确标记 `truncated`。
- [x] `windows_backend.send_chat_text` 与 `windows_executor.WECHAT_SEND_TEXT`：定位最低
  Edit/Document 控件、剪贴板粘贴 `^v` + `Enter`，发送前经 `wechat_process_name` 白名单与
  前台复核；`WECHAT_READ_NEW_MESSAGES` 改为触发一次增量 poll（dispatcher trigger event），
  不执行桌面输入。
- [x] `config` 新增 `wechat_ingress_enabled` / `wechat_send_enabled` / `wechat_process_name` /
  `identity_key` 开关与校验，`from_environment` 按开关声明 `wechat.read` / `wechat.send` 能力。
- [x] 控制服务器 `AgentGateway` 新增 `requestDesktopCommand`（发送 + 等待结果 + 超时）、
  `resolvePendingCommand` / `failPendingCommandsForSession` / `pickWeChatSendAgent`；
  `app.ts` 新增 `enableDesktopChatReply`，启用时注入真实 `DesktopAgentChatReplyAdapter`
  （fail-closed），默认仍 `UnavailableChatReplyAdapter`。
- [x] 在 Windows M0 环境验证 pywinauto 基础执行器：2026-10-04 记事本 Spike A **20 轮 20/20
  通过**（目标 Windows 11 build 26200、1920×1080、缩放 100%），覆盖窗口激活、前台复核、
  Ctrl+A/Ctrl+V、剪贴板写入与读回、编辑区文本读回、窗口截图与每轮输入释放；报告
  `error_counts` 为空、20 张截图尺寸恒为 913×583（目标窗口，非全屏），并已由操作者
  人工目视复核通过（均为目标窗口、内容为固定 Spike 文本、无目标外输入、无残留按键按下）。
- [x] 实现鼠标动作：契约（`packages/contracts`、共享 fixture、C# 枚举与校验器）、Python
  协议模型与动作白名单、执行器分支、pywinauto 后端（`pywinauto.mouse` + `SetCursorPos`
  读回）、控件相对偏移与窗口内落点校验、`UI_ELEMENT_AMBIGUOUS`/`UI_ELEMENT_OUT_OF_VIEW`
  错误码、跨进程拖拽拒绝、坐标兜底开关 `AGENT_COORDINATE_MOUSE_PROFILE`（默认关闭，
  校验前台窗口、窗口内坐标、分辨率与 DPI 四重条件）。
- [x] 鼠标动作的按键安全：后端跟踪拖动期间按下的鼠标键（带锁），急停只释放确实按下的键，
  并避免历史缺陷中"注入未按下按键的抬起事件导致 WinUI 弹出右键菜单"的行为；
  已由注入式单元测试覆盖。
- [x] 提供固定 20 轮的记事本鼠标 Spike 工具（`npm run test:spike:m0:notepad-mouse`）：
  逐轮读回验证指针位置、点击后的插入点文本、拖拽选区剪贴板内容、坐标点击落点与
  滚动前后的标记行号，并记录显示档、逐轮耗时、错误码计数与目标窗口截图。
  该工具的验证逻辑已由模拟记事本编辑器的跨平台测试证明有效。
- [ ] 在目标 Windows 机执行鼠标 Spike 20 轮并取得实机证据（本会话环境无法启动可见 GUI
  进程，详见 `changelog/2026-10-04-mouse-actions-implementation.md`）。
- [ ] 在 Windows 实机实现并验证微信 Adapter（Spike B）。
- [ ] 在 Windows 实机验证真实输入释放在两秒内完成。
- [ ] Python Agent 完成 Windows 实机验收后替代 C# 默认运行入口。

### M1：工程骨架（代码完成，验收未完成）

- [x] npm workspaces。
- [x] Node.js 24 LTS 和 npm 11 版本约束。
- [x] TypeScript 严格配置。
- [x] ESLint、Prettier、EditorConfig 和统一 `npm run check`。
- [x] 质量门分层：`npm run check` 只依赖 Node.js 与 Python（Node/Python 格式、静态检查、
  构建、单元/契约测试 + Python Agent 集成回归），`npm run check:all` 保留原完整步骤
  （追加 `check:dotnet` 与 C# Agent 集成回归）。`.NET` 步骤与 CI `dotnet` job 均未删除；
  该拆分使本机无 .NET 10 SDK 时日常门不再整条失败。
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
- [x] 控制服务器 `AgentGateway.requestDesktopCommand`（发送 + 等待 `desktop.command.result`
  + 超时）与 `pickWeChatSendAgent`；真实 `DesktopAgentChatReplyAdapter`（fail-closed，无
  `wechat.send` 代理即 `AGENT_UNAVAILABLE`、非 `SUCCEEDED` 即 `DESKTOP_ACTION_FAILED`），
  仅当 `enableDesktopChatReply` 显式启用，默认仍 `UnavailableChatReplyAdapter`；经 mock Agent
  单测与集成用例验证。
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
- [x] 修复 Agent 接收与执行串行缺陷：接收循环持续排空服务端帧，命令经
  `Channel` 由单一 worker 串行执行，执行期间到达的 `task.cancel` /
  `system.emergency-stop` 能立即中断在执行命令；重连退避对取消安全，外部
  停止不再抛出未处理异常。
- [x] 当前自动化验证：Control Server 189 项、TypeScript 契约 5 项、C# 58 项
  （含 3 项 Agent 执行中取消/急停回归测试）全部通过，覆盖率高于全局门槛。

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
- [x] 自动化验证：Control Server 217 项（M4 基线 189 + 统计域 14 + 端点 4 +
  微信桌面桥接 10）、Operator Web Playwright 12 项；真实环境步骤在文档中仅占位。

## 未完成

### M0：技术验证（部分完成）

- [x] 记事本 Windows 基础操作 20 轮实机验证：**20/20 通过**（2026-10-04，目标 Windows 11
  build 26200、1920×1080、缩放 100%）。报告
  `data/artifacts/m0/reports/notepad-spike-20261004-043759360660.json`：`error_counts = {}`、
  单轮 1.6–11.6 s（均值 2.2 s）、20 张截图尺寸恒为 913×583；报告不含测试文本。
  已由操作者人工目视复核截图与最终桌面状态，均符合 `docs/07` §12 的复核项。
  该项属于 M0 三条 PoC 路径中的"Windows 基础操作"一条。
- [ ] 微信 UIA 收发连续测试（Spike B，M0 退出标准中必须通过的一项）。
- [ ] 记事本鼠标 Spike A2（20 轮）实机执行；工具与验证逻辑已就绪，实机证据缺失。
- [ ] AI 页面 Playwright 问答（Spike C）。
- [ ] 购物网站搜索与商品提取（Spike C）。
- [ ] Windows 实机、分辨率、DPI、软件版本记录（已取得部分证据：Spike A 报告给出系统
  build、Python/pywinauto 版本、分辨率与 DPI；目标应用与站点版本仍未冻结）。
- [ ] 三条 PoC 路径的 20 次重复运行和成功率统计（已完成 1 条：Windows 基础操作 20/20）。
- [ ] 记事本 Spike A 前四轮失败均已定位并修复（代理上下文无 UIA、多窗口歧义、运行前残留
  实例、标题被文档内容改写导致条件失效），第五轮通过；失败报告保留在
  `data/artifacts/m0/reports/` 供追溯。

### M1：剩余验收（未验证）

- [ ] 执行 `npm run test:stability:m1`，完成 Agent 两小时持续连接验证。
- [ ] 在目标 Windows 机器验证 Desktop Agent 运行和服务重启恢复。
- [ ] 接入真实 Windows 执行器后验证紧急停止在两秒内释放全部输入。

### M2：剩余真实集成与验收（未验证）

- [ ] Windows 微信 UIA 新消息读取 Adapter。
  （代码已实现：`wechat_source.py` 的 `WeChatUiAMessageSource` 与 `extract_conversation`，
  仅经 mock 控件树单测，真实控件定位待校准。）
- [ ] 目标 AI 页面 Playwright Adapter。
- [ ] Windows 微信 UIA 文本回复 Adapter。
  （代码已实现：Node `desktop-agent-chat-reply-adapter.ts` 经 `AgentGateway.requestDesktopCommand`
  发送 `WECHAT_SEND_TEXT` 并等待结果，仅经 mock Agent 单测，未接真实桌面 Agent。）
- [ ] 登录失效后的人工恢复与继续执行。
- [ ] 目标 Windows、微信和 AI 页面标准问答连续 20 次成功率验证。

### M3：剩余真实集成与验收（未验证）

- [ ] 冻结目标购物站点、允许域名、版本和专用测试账号。
- [ ] 目标购物站点 Playwright 搜索与字段抽取 Adapter。
- [ ] 登录或验证码人工处理后的继续执行入口。
- [ ] 使用 100 个人工标注候选验证字段抽取准确率不低于 95%。
- [ ] 在目标站点执行 20 个查询并验证成功率不低于 90%。

### M4：剩余真实环境项（未验证）

- [ ] pywinauto 前台进程和目标窗口双重检查。
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

- 目标 Windows 环境已提供记事本基础操作的验证记录（2026-10-04，20 轮 20/20），
  但尚无微信、AI 页面与购物站点的验证记录；鼠标动作同样只有 Fake/模拟验证，
  尚无目标机 20 轮记录。
- 微信、目标 AI 页面和购物站点尚未冻结具体版本或对象。
- 当前 C# Desktop Agent 使用占位执行器；Python 已实现默认关闭的 Windows 基础
  执行器，并已通过记事本 20/20 实机验证，但尚未在微信等真实业务应用上校准定位，
  因此仍不声明可用于微信操作。
- C# Desktop Agent 按 ADR-008 冻结保留：不删除、不发展，实现方向只在
  `apps/desktop-agent-python`；其覆盖由 CI 的 `dotnet` job 与 `npm run check:all` 承担，
  日常 `npm run check` 不依赖 .NET SDK。
- 当前 AI、商品和聊天 Adapter 默认返回 `ADAPTER_NOT_CONFIGURED`；Fake 只用于
  自动化测试。
- 当前 Operator Web 三视图（任务/节点/统计）和急停、恢复、筛选已可用，但只在
  Fake/夹具数据下验证，不代表真实运行结果。
- SQLite、Agent 通道和任务工作流已集成，但除记事本基础操作外，没有真实 Windows
  业务窗口、AI 页面或购物站点执行证据。
- `npm run check` 不覆盖迁移期 C# 契约回归（它需要 .NET 10 SDK）；该回归由
  `npm run check:all` 与 CI 的 `dotnet` job 负责，本机未安装该 SDK，故 C# 编译/测试
  在本机为 BLOCKED。

## 维护要求

1. 每次实现、删除、验证或改变上述能力时，在同一任务中更新本文。
2. 只有代码和对应范围的验证均完成后，才能标记为“已完成”。
3. Fake、fixture 或模拟 Agent 的结果必须标明“模拟验证”，不能替代真实 Windows
   或真实站点验证。
4. 未执行的测试保持“未验证”，不得根据代码存在推断为通过。
5. 更新“最后更新”日期，并确保本文与实际代码、测试结果及 changelog 一致。
