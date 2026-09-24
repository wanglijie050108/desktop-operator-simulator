# 人工操作模拟器

面向课程设计的 Windows 端软件代理。用户通过受信任的聊天账号发送指令，代理机自动完成 AI 问答、商品查询和结果回复；购物流程仅覆盖查询、比较与推荐，不执行支付。

## 当前阶段

当前仓库已完成 M1 工程骨架、M2 AI 问答和 M3 商品查询的跨平台代码及模拟验证，但
尚未满足对应里程碑的真实环境退出验收。Control Server 已提供消息策略、持久化去重、
AI 问答和商品查询固定工作流、任务/步骤 API；Vue 管理台可展示任务、步骤、问答结果
及商品比较并取消任务。真实微信、Windows 动作、AI 页面和购物站点仍使用失败关闭的
适配器边界，必须先完成 M0 Spike 才能接入。
设计材料：

- [需求与范围](docs/01-requirements-and-scope.md)
- [系统架构](docs/02-system-architecture.md)
- [接口与数据设计](docs/03-contracts-and-data.md)
- [实施计划](docs/04-implementation-plan.md)
- [测试与验收](docs/05-testing-and-acceptance.md)
- [技术决策与风险](docs/06-decisions-and-risks.md)
- [Windows 测试环境准备](docs/07-windows-test-environment.md)
- [当前开发状态](docs/08-development-status.md)

机器可读 API 草案见 [OpenAPI 契约](contracts/openapi.yaml)。

## AI 协作约束

任何 AI 助手在分析、修改、调试、测试、联调或操作本仓库前，必须先阅读：

- [AI Agent 入口](AGENTS.md)
- [项目开发守卫 Skill](.trae/skills/human-operation-simulator-guardrails/SKILL.md)
- [当前开发状态](docs/08-development-status.md)
- [AI 工作记录规范](changelog/README.md)

每项任务从分析阶段开始创建或更新 `changelog/YYYY-MM-DD-short-topic.md`，持续记录
关键证据、决策、文件操作、失败处理、验证状态和最终结果。记录不得包含密钥、账号、
Cookie、个人信息、真实聊天正文或模型隐藏思维链。

## 推荐技术栈

| 区域 | 选择 |
|---|---|
| 桌面代理 | C# 14、.NET 10、Windows 11、FlaUI(UIA3) |
| 浏览器自动化 | Node.js 24 LTS、TypeScript、Playwright |
| 控制服务 | Fastify、WebSocket、TypeBox/OpenAPI |
| 本地存储 | SQLite、Drizzle ORM |
| 管理界面 | Vue 3、Vite、Pinia |
| 测试 | xUnit、Vitest、Playwright Test |
| 工程化 | npm workspaces、EditorConfig、ESLint、Prettier |

依赖的补丁版本在首次搭建时锁定，不在设计阶段猜测固定版本。

## 本地开发

前置环境：Node.js 24 LTS、npm 11。安装依赖并执行完整质量检查：

```bash
npm install
npm run check
```

`npm run check` 会执行 Node 与 .NET 的格式、静态检查、构建、单元测试，以及
Control Server 重启后的 Desktop Agent 重连集成测试。M1 的两小时稳定性测试需单独
执行：

```bash
npm run test:stability:m1
```

管理台桌面和移动视口检查使用脱敏的本地 AI 与商品 API fixture：

```bash
npm run test:ui:m3
```

启动 Control Server：

```bash
TRUSTED_SENDER_IDS=hashed-sender-id npm run dev
```

另开终端启动管理台和 Desktop Agent：

```bash
npm run dev:web
```

```bash
dotnet run --project apps/desktop-agent/src/DesktopAgent/DesktopAgent.csproj
```

服务默认只监听 `127.0.0.1:7070`。在管理认证完成前，配置为非回环地址会被拒绝。
管理台开发服务位于 `http://127.0.0.1:4173`，并代理本地 Control Server API。
当前 Desktop Agent 不声明任何真实桌面能力，收到桌面命令会返回
`NOT_IMPLEMENTED`；AI、商品搜索与聊天回复适配器未配置时任务返回
`ADAPTER_NOT_CONFIGURED`。替换占位执行器前不得用于真实操作。

可通过 `DATABASE_PATH`、`AGENT_HEARTBEAT_INTERVAL_MS`、`CONTROL_SERVER_WS_URL`、
`COMMAND_PREFIX`、`TRUSTED_SENDER_IDS`、`ALLOWED_SHOPPING_DOMAINS`、`AGENT_ID`
和 `AGENT_NAME` 覆盖本地默认配置。白名单标识使用脱敏稳定 ID；购物域名使用
逗号分隔的纯主机名。不得在这些配置中存放账号凭据。

## 架构原则

1. UI Automation/DOM 定位优先，鼠标坐标与剪贴板仅作为受控兜底。
2. AI 只负责自然语言理解和摘要，不直接产生可任意执行的系统操作。
3. 所有动作必须映射到白名单能力，并经过策略校验。
4. 支付、转账、验证码绕过、账号安全设置等动作永久禁止。
5. 单机部署优先，保持课程项目可实现、可演示、可测试。

## 当前及计划目录

```text
apps/
  control-server/       # Node.js 编排、策略、持久化与管理 API
  desktop-agent/
    src/DesktopAgent.Core/ # 跨平台协议、连接、调度和安全逻辑
    src/DesktopAgent/      # 当前 Console Host 和失败关闭占位执行器
    src/DesktopAgent.Windows/ # 计划中的 FlaUI/Windows 驱动
  operator-web/         # Vue 任务列表、步骤详情、结果和取消操作
packages/
  contracts/            # TypeScript 类型和 JSON Schema
  shared/               # 计划中的日志、错误码等共享 Node 模块
tests/
  integration/          # 当前跨进程 Agent 集成测试
  e2e/                  # 计划中的真实完整端到端场景
  fixtures/             # 计划中的脱敏页面和消息样本
contracts/
  openapi.yaml          # HTTP API 契约
  fixtures/             # Node/C# 共用 WebSocket fixtures
docs/
```

## MVP 演示闭环

1. 受信任用户向代理机微信发送 `#助手 搜索 300 元以内的无线鼠标，比较三款`。
2. C# Agent 读取新消息并提交标准化命令。
3. Node 控制服务解析意图、校验策略并创建任务。
4. Playwright 打开购物网站搜索并提取候选商品。
5. 系统按明确规则排序，必要时调用 AI 页面生成摘要。
6. C# Agent 将商品名称、价格、链接和推荐理由回复给原聊天。
7. 管理台可查看任务步骤、截图、失败原因，并可立即停止任务。
