# 人工操作模拟器

面向课程设计的 Windows 端软件代理。用户通过受信任的聊天账号发送指令，代理机自动完成 AI 问答、商品查询和结果回复；购物流程仅覆盖查询、比较与推荐，不执行支付。

## 当前阶段

当前仓库已完成 M1–M4 的跨平台代码及模拟验证，并完成 M5 中可在无真实环境下开发
的部分。pywinauto Desktop Agent 迁移分支已合并进 main：Python Agent 代码层完成并通过
Windows 质量门与 CI；真实微信联动、两秒急停与
全链路 E2E 仍待 M0 实机验证。Python Agent 已支持注册、心跳、重连、动作白名单、指令过期与
去重、活动执行取消、两秒急停释放边界和日志脱敏；Windows 基础执行器代码已覆盖
窗口激活、剪贴板、按键组合和窗口截图，但仅通过跨平台 Fake，默认关闭且未实机
验证。微信消息规范化、隐私标识、稳定指纹、轮询去重和 WebSocket 上报基础层已
完成；微信 UIA 读取来源（`wechat_source.py`）、剪贴板粘贴文本回复与 Node 真实
`DesktopAgentChatReplyAdapter` 的静态代码已实现并通过 mock 单测，但真实微信控件定位
尚未实机校准、未接入真实微信；AI 页面和购物站点仍未接入。Windows 全链路 E2E、
备份视频、版本与账号固化尚未完成，必须先通过 M0 Spike。
设计材料：

- [需求与范围](docs/01-requirements-and-scope.md)
- [系统架构](docs/02-system-architecture.md)
- [接口与数据设计](docs/03-contracts-and-data.md)
- [实施计划](docs/04-implementation-plan.md)
- [测试与验收](docs/05-testing-and-acceptance.md)
- [技术决策与风险](docs/06-decisions-and-risks.md)
- [Windows 测试环境准备](docs/07-windows-test-environment.md)
- [当前开发状态](docs/08-development-status.md)
- [安装手册](docs/09-installation-guide.md)
- [用户手册](docs/10-user-manual.md)
- [设计说明](docs/11-design-overview.md)
- [答辩演示脚本](docs/12-demo-script.md)

机器可读 API 草案见 [OpenAPI 契约](contracts/openapi.yaml)。

## AI 协作约束

本仓库已配置 `CLAUDE.md`（内容 `@AGENTS.md`），Claude Code 会自动加载下列约束；其他 AI 工具请显式阅读：

- [Claude Code 入口](CLAUDE.md)
- [AI Agent 入口](AGENTS.md)
- [项目开发守卫 Skill](.trae/skills/human-operation-simulator-guardrails/SKILL.md)
- [当前开发状态](docs/08-development-status.md)
- [AI 工作记录规范](changelog/README.md)

每个提交在提交前写一条 `changelog/YYYY-MM-DD-short-topic.md` 记录，说明分析了什么、
得出什么结论、实际改了什么以及验证状态；不在每一步反复改写，也不写逐步操作流水账。
记录不得包含密钥、账号、Cookie、个人信息、真实聊天正文或模型隐藏思维链。

## 推荐技术栈

| 区域 | 选择 |
|---|---|
| 桌面代理 | Python 3.11、pywinauto、Windows 11 |
| 浏览器自动化 | Node.js 24 LTS、TypeScript、Playwright |
| 控制服务 | Fastify、WebSocket、TypeBox/OpenAPI |
| 本地存储 | SQLite、Drizzle ORM |
| 管理界面 | Vue 3、Vite、Pinia |
| 测试 | pytest、xUnit（迁移期）、Vitest、Playwright Test |
| 工程化 | npm workspaces、uv、Ruff、mypy、EditorConfig、ESLint、Prettier |

依赖的补丁版本在首次搭建时锁定，不在设计阶段猜测固定版本。

## 本地开发

前置环境：Node.js 24 LTS、npm 11、Python 3.11 和 uv。安装依赖并执行完整质量检查：

```bash
npm install
uv sync --project apps/desktop-agent-python
npm run check
```

`npm run check` 是日常质量门，只依赖 Node.js 与 Python：它执行 Node 与 Python 的
格式/静态检查、构建和单元测试，以及 Control Server 与 Python Agent 的重连集成测试
（注册、心跳、服务重启重连、紧急停止）。C# 链路已随 ADR-009 移除，`npm run check`
不再包含任何 .NET 步骤，也无需安装 .NET SDK。M1 的两小时稳定性测试以 Python Agent
为目标，需单独执行：

```bash
npm run test:stability:m1
```

Windows M0 记事本基础动作验证固定执行 20 轮，并把脱敏 JSON 报告写入 Agent
artifact 目录：

```powershell
npm run test:spike:m0:notepad
```

该命令只能在符合 [`docs/07-windows-test-environment.md`](docs/07-windows-test-environment.md)
要求的未锁定 Windows 交互式桌面运行；macOS/Linux 会失败关闭。

鼠标动作（移动/点击/拖拽/滚动，语义定位优先，窗口相对坐标兜底）使用独立 Spike，
同样固定 20 轮，并用指针位置、插入点文本、拖拽选区和滚动标记行号逐项读回验证：

```powershell
npm run test:spike:m0:notepad-mouse
```

它同样要求未锁定的交互式桌面，且会真实移动鼠标；运行前必须关闭全部记事本窗口。

真实微信 Adapter 开发前，先在专用 Windows 测试账号上生成不含明文 Name/标题的
UIA 结构报告：

```powershell
$env:WECHAT_PROCESS_NAME = "WeChat.exe"
npm run test:spike:m0:wechat-inspect
```

管理台桌面和移动视口检查使用脱敏的本地 AI 与商品 API fixture：

```bash
npm run test:ui:m3
```

断网演示可直接打开离线夹具 `apps/operator-web/public/offline-demo.html`
（或管理台服务下的 `/offline-demo.html`），页面始终标注“测试夹具”；统计口径见
`GET /api/v1/statistics`，当前数字仅来自 Fake/夹具数据。

启动 Control Server：

```bash
TRUSTED_SENDER_IDS=hashed-sender-id npm run dev
```

另开终端启动管理台和 Python Agent：

```bash
npm run dev:web
```

```bash
uv run --directory apps/desktop-agent-python desktop-agent-python
```

服务默认只监听 `127.0.0.1:7070`。在管理认证完成前，配置为非回环地址会被拒绝。
管理台开发服务位于 `http://127.0.0.1:4173`，并代理本地 Control Server API。
Python Agent 默认使用失败关闭执行器，未配置 Windows 自动化时不声明任何真实桌面能力，收到桌面命令会返回
`NOT_IMPLEMENTED`；仅在 Windows 设置
`AGENT_WINDOWS_AUTOMATION_ENABLED=true` 并配置 `AGENT_ALLOWED_PROCESSES` 后启用
基础动作。`AGENT_ALLOWED_ACTIONS` 使用逗号分隔的 WebSocket 动作名（例如
`WINDOW_ACTIVATE,TAKE_SCREENSHOT`）。微信、AI、商品搜索与聊天回复适配器未配置时返回
`ADAPTER_NOT_CONFIGURED`。Windows 基础执行器通过 M0 实机验证前不得用于真实操作。

可通过 `DATABASE_PATH`、`AGENT_HEARTBEAT_INTERVAL_MS`、`CONTROL_SERVER_WS_URL`、
`COMMAND_PREFIX`、`TRUSTED_SENDER_IDS`、`ALLOWED_SHOPPING_DOMAINS`、`AGENT_ID`
、`AGENT_NAME`、`AGENT_WINDOWS_AUTOMATION_ENABLED`、`AGENT_ALLOWED_PROCESSES`
和 `AGENT_ARTIFACT_DIR` 覆盖本地默认配置。白名单标识使用脱敏稳定 ID；购物域名
和 Agent 进程白名单使用逗号分隔的纯名称。不得在这些配置中存放账号凭据。

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
  desktop-agent-python/ # 唯一 Desktop Agent（Python 3.11 + pywinauto）；含协议、调度、Windows 基础执行器
  operator-web/         # Vue 三视图：任务监控、执行节点、统计看板；含离线夹具
packages/
  contracts/            # TypeScript 类型和 JSON Schema
  shared/               # 计划中的日志、错误码等共享 Node 模块
tests/
  integration/          # 当前跨进程 Agent 集成测试
  e2e/                  # 计划中的真实完整端到端场景
  fixtures/             # 计划中的脱敏页面和消息样本
contracts/
  openapi.yaml          # HTTP API 契约
  fixtures/             # Node/Python 共用 WebSocket fixtures
docs/
```

## MVP 演示闭环

1. 受信任用户向代理机微信发送 `#助手 搜索 300 元以内的无线鼠标，比较三款`。
2. Python Agent 通过 pywinauto 读取新消息并提交标准化事件。
3. Node 控制服务解析意图、校验策略并创建任务。
4. Playwright 打开购物网站搜索并提取候选商品。
5. 系统按明确规则排序，必要时调用 AI 页面生成摘要。
6. Python Agent 将商品名称、价格、链接和推荐理由回复给原聊天。
7. 管理台可查看任务步骤、截图、失败原因，并可立即停止任务。
