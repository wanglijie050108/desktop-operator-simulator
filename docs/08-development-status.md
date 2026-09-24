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

- 当前阶段：**M2 AI 问答跨平台代码和模拟闭环完成，里程碑验收未完成**。
- 当前可运行能力：Control Server、SQLite、Agent WebSocket 和 .NET Desktop Agent
  占位进程可联合运行；Fake AI/聊天适配器可完成消息到回复的模拟闭环；Vue 管理台
  可展示任务、步骤和结果并取消任务。
- 当前不可运行能力：真实微信收发、Windows 输入/剪贴板/截图、真实 AI 页面问答和
  商品搜索。
- 当前验收范围：Node/.NET 单元与契约测试、临时 SQLite、跨进程注册、心跳、服务
  重启重连、紧急停止，以及 M2 策略、去重、工作流、失败/取消和 20 次 Fake 闭环已
  通过模拟集成验证。
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

## 未完成

### M0：技术验证（未验证）

- [ ] 微信 UIA 收发连续测试。
- [ ] AI 页面 Playwright 问答。
- [ ] 购物网站搜索与商品提取。
- [ ] Windows 实机、分辨率、DPI、软件版本记录。
- [ ] 三条 PoC 路径的 20 次重复运行和成功率统计。

### M1：剩余验收（未验证）

- [ ] 执行 `npm run test:stability:m1`，完成 Agent 两小时持续连接验证。
- [ ] 在 GitHub Actions 上确认 Node 和 Windows .NET job 实际通过。
- [ ] 在目标 Windows 机器验证 Desktop Agent 运行和服务重启恢复。
- [ ] 接入真实 Windows 执行器后验证紧急停止在两秒内释放全部输入。

### M2：剩余真实集成与验收（未验证）

- [ ] Windows 微信 UIA 新消息读取 Adapter。
- [ ] 目标 AI 页面 Playwright Adapter。
- [ ] Windows 微信 UIA 文本回复 Adapter。
- [ ] 登录失效后的人工恢复与继续执行。
- [ ] 目标 Windows、微信和 AI 页面标准问答连续 20 次成功率验证。

### M3：商品查询闭环（未开发）

- [ ] 商品请求解析。
- [ ] 搜索、筛选和字段抽取。
- [ ] 确定性排序、比较和回复。
- [ ] 价格、链接和采集时间校验。
- [ ] 登录失效和验证码人工接管。
- [ ] 商品字段准确率及预算约束验证。

### M4：可靠性与安全（未开发）

- [ ] 超时、有限重试、取消和中断恢复。
- [ ] 前台进程和窗口双重检查。
- [ ] 指令有效期与 Control Server/Desktop Agent 双重策略校验。
- [ ] 日志脱敏。
- [ ] 截图和 trace 保留及自动清理。
- [ ] 适配器版本和页面变化诊断。
- [ ] 禁止动作拦截、两秒紧急停止和八小时稳定性测试。

### M5：最终验收准备（未开发）

- [ ] 管理台完整功能。
- [ ] 离线演示夹具和降级演示。
- [ ] Windows 全链路 E2E。
- [ ] 成功率、耗时和错误分布统计。
- [ ] 安装手册、用户手册和设计说明。
- [ ] 演示脚本及备份视频。
- [ ] 目标软件版本和专用演示账号固化。

## 当前限制

- 目标 Windows 环境尚未提供验证记录。
- 微信、目标 AI 页面和购物站点尚未冻结具体版本或对象。
- 当前 Desktop Agent 使用占位执行器，不声明真实桌面能力，所有桌面动作返回
  `NOT_IMPLEMENTED`。
- 当前 AI 和聊天 Adapter 默认返回 `ADAPTER_NOT_CONFIGURED`；Fake 只用于自动化测试。
- 当前 Operator Web 是本地任务/步骤视图；完整管理功能仍属于 M5。
- SQLite、Agent 通道和任务工作流已集成，但没有真实 Windows/AI 页面执行证据。

## 维护要求

1. 每次实现、删除、验证或改变上述能力时，在同一任务中更新本文。
2. 只有代码和对应范围的验证均完成后，才能标记为“已完成”。
3. Fake、fixture 或模拟 Agent 的结果必须标明“模拟验证”，不能替代真实 Windows
   或真实站点验证。
4. 未执行的测试保持“未验证”，不得根据代码存在推断为通过。
5. 更新“最后更新”日期，并确保本文与实际代码、测试结果及 changelog 一致。
