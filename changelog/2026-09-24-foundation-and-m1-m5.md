# 工程奠基与 M1–M5 跨平台交付（2026-09-24 合并摘要）

> 本文件合并自 12 条原始 changelog（原文件名见文末索引）。原文可用
> `git show <commit>:changelog/<原文件名>` 找回。

## 阶段目标

- 建立随仓库同步的 AI 约束（`.trae/skills/human-operation-simulator-guardrails/SKILL.md`、
  `AGENTS.md`、changelog 规范）与事实入口 `docs/08-development-status.md`。
- 搭建跨平台工程基线：npm workspace、严格 TypeScript、Node 24 CI、Control Server 与契约化 `/health`。
- 交付 M1–M5 的跨平台可开发部分，真实桌面能力一律失败关闭占位。
- 让 Node 与 Windows .NET 质量门在 CI 干净检出中真实通过，并确立 M0 Spike 为真实集成前置硬门槛。

## 关键决策与依据

- Skill 用仓库标准位置 + 根目录 `AGENTS.md` 跨助手入口，以 docs/01–07 与 `contracts/openapi.yaml`
  为权威来源，避免第二套架构。
- Control Server 是任务/策略/SQLite 唯一事实源；WebSocket 严格版本化 DTO，不提供脚本、Shell、
  文件路径或 JavaScript 执行。
- 认证前只绑定回环地址，非回环 `SERVER_HOST` 启动即失败（退出码 1）；端口 7070、管理台 4173。
- TypeScript 锁 `6.0.3`（`typescript-eslint@8.70.1` 要求 `<6.1.0`）；Node 基线 `24.x`，本机 26
  仅用于提前暴露兼容问题。
- 真实动作接口隔离：`PlaceholderDesktopActionExecutor` 与三个 Node Adapter 默认失败关闭
  （`NOT_IMPLEMENTED`/`ADAPTER_NOT_CONFIGURED`），占位不模拟成功。
- 契约接受 `Z` 与 `+00:00` 两种 UTC ISO 8601，仍拒绝非零时区偏移；急停后 Agent 进 `PAUSED`
  并继续发有效心跳。
- M2 幂等键 `source + conversationId + externalMessageId`；白名单存 SQLite、环境变量只做幂等
  引导；未声明 `wechat.read` 的 Agent 被拒。
- 安全边界：禁止支付、凭据提取、验证码绕过、脚本执行与任意网络/文件操作；登录失效与验证码
  统一转 `WAITING_FOR_HUMAN` 并停止后续动作。
- M3 候选数据从 `unknown` 运行时校验，仅 HTTPS 允许域名，拒绝含凭据 URL，按规范化链接去重，
  预算硬过滤先于排序，固定权重 + 稳定次级键排序，文本压单行；错误码 `INVALID_PRODUCT_DATA`。
- M4 超时按类型固定（AI 90s、商品 120s，`WAITING_FOR_HUMAN/INPUT` 不计时），`setTimeout` abort
  与 `TaskReaper` 共用 `isTaskTimedOut`；启动把 `RECEIVED/PLANNED/RUNNING` 置 `INTERRUPTED`
  且不自动重放，改用 `POST /api/v1/tasks/:id/recover`。
- M4 重试只对幂等只读操作与瞬时错误码（`ADAPTER_TIMEOUT`/`NETWORK_ERROR`/
  `TEMPORARY_UNAVAILABLE`/`SERVICE_UNAVAILABLE`）生效、最多 2 次指数退避，`chat.send` 不重试；
  C# `AgentCommandPolicy` 加 `AGENT_ALLOWED_ACTIONS` 白名单与 10 分钟命令有效期上限。
- 两侧日志脱敏对齐（手机与长数字留后四位、邮箱、URL 凭据、`key=value` 密钥；顺序
  email→URL→secret→长数字；正则用 `(?<![A-Za-z0-9_])` 覆盖中文密钥名）；产物默认保留
  7 天/500MB。
- M5 统计：成功率分母 = `SUCCEEDED + FAILED`，分母 0 → `successRate: null`，比例 4 位小数，
  分位用 nearest-rank，空错误码归 `UNSPECIFIED`；报表 `GET /api/v1/statistics`；急停两击确认
  （4 秒 arming 窗口）。
- CI 修复：`lint` 前先构建 `@hos/contracts`（types 指向被忽略的 `dist/index.d.ts`）并加
  `.gitattributes` 的 `* text=auto eol=lf`；离线夹具为单文件 `public/offline-demo.html`
  （6 场景、`file://` 可开、强制标注"测试夹具"）。

## 验证证据

| 范围 / 命令 | 状态 | 结果 |
|---|---|---|
| 基线 Node 24.21.0 `npm ci && npm run check` | PASSED | 20 项测试、覆盖率 100%；`/health` 返回 `{"status":"ok","version":"0.1.0"}`，未声明路由 404 |
| 首次 `npm install` | FAILED | `ERESOLVE`：TypeScript 7.0.2 超出 typescript-eslint peer 范围 |
| M1 Node 24 质量门 | PASSED | 81 项（Node 40/契约 4/C# 37）；跨进程注册与重启重连通过；npm/NuGet 无漏洞 |
| M1 五秒集成路径 | PASSED | 重连、急停、持续心跳通过；两小时 `test:stability:m1` NOT_EXECUTED |
| M2 Node 24 质量门 | PASSED | 115 项（71/5/37/2）；覆盖率 95.72/92.06/92.30/95.65%；20 次 Fake 闭环各只回复一次 |
| M2 `test:ui:m2` | PASSED | 1440×900 与 390×844 两项通过，无横向溢出 |
| M3 Node 24 质量门 | PASSED | 155 项（109/5/37/4）；覆盖率 94.97/90.93/93.82/94.87%；含 20 次商品 Fake 闭环 |
| M4 `npx vitest run` | PASSED | 189/189；覆盖率 94.04/89.84/91.24/94.35%（门槛 90/85/90/90）；`check:dotnet` 55/55、0 警告 |
| M5 Node 24 `npm run check` | PASSED | Control Server 207 项、C# 55 项、UI 12 项；覆盖率 94.31/89.79/92.01/94.57% |
| Actions run `35962352887`、`35962394466` | FAILED | Node ESLint 116 个类型解析连锁错误；Windows `dotnet format` 全量 `ENDOFLINE` |
| Actions run `35963514052`（PR #2） | PASSED | Node 与 Windows .NET 质量门均通过 |
| 快照 `main` `69606b7` | PASSED | TS/TSX 5510 行、Vue 299 行、C# 1443 行、TS 测试 2034 行；155 项引用 M3 记录未重跑 |
| Windows 真机 UIA/微信/AI 页面/购物站点 | NOT_EXECUTED | 目标账号与版本未提供，全部里程碑缺此证据 |

## 未完成与后续

- M0 技术 Spike 完全未执行，是真实集成的关键路径阻塞项；接入真实适配器前必须通过（≥90%）。
- M1/M2/M3 均为"代码完成、退出验收未完成"：两小时与八小时稳定性、FlaUI 前台窗口双重校验、
  两秒急停实测、连续 20 次真实闭环、100 个标注候选字段准确率与 20 次真实查询成功率待执行。
- M4 跨平台部分完成但未提交/推送（基线 `124af0e`）；M5 已推送
  `feature/complete-m5-delivery-prep`（基线 `56c0d5d`），是否 `--no-ff` 合入 `main` 待定。
- M5 仍缺 Windows 全链路 E2E、闭环备份视频、真实版本与演示账号固化、真实成功率数据。
- 建议顺序：环境基线 → M0 Spike → Windows 基础执行器 → 微信读写 → 回复桥 → Playwright
  AI/商品适配器 → 真实指标；`DesktopAgent.Windows` 尚不存在、Capabilities 为空、
  `config.ts`/`server.ts` 尚无适配器选择开关。

## 风险与限制

- 能力仅经 Fake/fixture 模拟验证，不得表述为真实成功率或字段准确率；真实适配器保持失败
  关闭默认。
- 本机默认 Node 26 与 `.nvmrc`(24) 不一致，质量门需用 24.21.0 前缀；目标 Windows 主机本身
  仍未验证。
- M4 重试退避 sleep 未接入 AbortSignal，默认配置下取消最多多等一个退避间隔（500ms）。
- 微信逻辑只能落在 Windows UIA；"服务端下发 `WECHAT_READ_NEW_MESSAGES`"仍是架构建议，实施
  时须与 docs 02/03 核对并同步契约。
- Markdown 未纳入格式脚本（M2 曾 Prettier FAILED）；未识别 `AGENTS.md` 的工具可能不加载
  Skill；GitHub token 未显示 `workflow` scope。

## 原始条目索引

- `changelog/2026-09-24-ai-development-guardrails.md` — 建立守卫 Skill、`AGENTS.md` 与 changelog 规范，产出 draft PR #1。
- `changelog/2026-09-24-bootstrap-foundation.md` — 搭建 workspace/严格 TS/Node 24 CI，`/health` 通过，提交 `7284947`。
- `changelog/2026-09-24-complete-m1-foundation.md` — M1 骨架代码完成，81 项测试通过，提交 `824d440`，未推送。
- `changelog/2026-09-24-complete-m2-ai-workflow.md` — M2 AI 问答闭环完成，115 项测试通过，提交 `389076c`，远端 `main` 更新至 `570923b`。
- `changelog/2026-09-24-complete-m3-product-search.md` — M3 商品查询闭环完成，155 项测试通过，提交 `03f0f11`、合并 `b020433`。
- `changelog/2026-09-24-complete-m4-reliability.md` — M4 跨平台部分完成，189 项 Node + 55 项 C# 通过，改动未提交。
- `changelog/2026-09-24-complete-m5-delivery-prep.md` — M5 跨平台部分完成，207 项 Node + 55 项 C# + 12 项 UI 通过并推送分支。
- `changelog/2026-09-24-development-status.md` — 建立区分"已实现/部分完成/未开发/未验证"的事实进度入口。
- `changelog/2026-09-24-fix-github-ci.md` — 修复 contracts 构建顺序与行尾，run `35963514052` 通过。
- `changelog/2026-09-24-github-ci-failure.md` — 定位 run `35962352887`/`35962394466` 的两个确定性失败根因，未改业务代码。
- `changelog/2026-09-24-progress-overview.md` — M1–M3 模拟完成、M0/M4/M5 未开始，项目级状态为不具备验收条件。
- `changelog/2026-09-24-real-environment-roadmap.md` — 给出真实环境接入顺序与 M4/M5 无真实环境时的可开发范围。
