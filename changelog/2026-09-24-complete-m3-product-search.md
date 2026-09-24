# 完成 M3 商品查询闭环

## 元信息

- 日期：2026-09-24
- 状态：已完成
- 环境：macOS；Node.js 项目基线 24 LTS；.NET 10
- 分支：`feature/complete-m3-product-search`

## 目标

- 实现商品请求解析、购物搜索 Adapter 边界、候选字段校验、预算过滤、确定性排序、
  三款比较回复和任务步骤持久化。
- 对登录失效和验证码提供明确的 `WAITING_FOR_HUMAN` 状态，不实现任何绕过行为。
- 使用固定商品 fixture 和 Fake Adapter 验证字段准确性、预算约束、重复消息、失败、
  取消和重复运行稳定性。
- 同步管理 API、Operator Web、规范文档和开发状态。

## 上下文与证据

- 已阅读项目守卫 Skill、README、开发状态、M2 changelog、需求、架构、接口与数据、
  实施计划、测试验收、技术决策和 OpenAPI 契约。
- M1、M2 已合入 `main`；本任务从干净的 `main` 创建
  `feature/complete-m3-product-search`。
- 当前已有消息白名单、前缀策略、持久化去重、固定 AI 问答工作流、任务/步骤 API、
  Chat Reply Adapter 和 Vue 管理台，可作为 M3 扩展基础。
- 当前主机为 macOS，且目标购物站点、专用账号和 Windows 微信环境尚未提供。

## 分析与决策

- 商品工作流保持文档规定的八个固定步骤，选择器和站点交互只存在于 Adapter 内。
- 价格、链接和采集时间由确定性校验器验证；预算过滤发生在排序前，避免超预算商品
  进入推荐结果。
- 排序使用架构文档定义的固定权重，并使用稳定次级排序保证相同输入得到相同结果。
- 真实站点 Adapter 默认失败关闭；测试 Fake 和静态 fixture 只作为跨平台模拟证据。
- 登录和验证码错误转换为待人工状态并停止后续操作，不自动重试或绕过。

## 操作记录

1. 核对仓库状态、M3 权威约束和现有 M2 扩展点。
   - 结果：成功。
   - 影响：确认工作树干净、实现边界和真实环境验收缺口。
2. 创建并切换 M3 功能分支。
   - 结果：成功。
   - 影响：当前分支为 `feature/complete-m3-product-search`，原分支均保留。
3. 实现商品命令解析、候选字段校验和确定性排序。
   - 结果：成功。
   - 影响：支持预算、数量和偏好解析；仅接受 HTTPS 允许域名，排序前硬性过滤
     超预算商品，并按固定权重和稳定次级键排序。
4. 实现统一消息分派和 M3 固定工作流。
   - 结果：成功。
   - 影响：消息只持久化去重一次，再分派至 AI 或商品工作流；商品任务执行文档规定
     的八个步骤，支持缺参、失败、待人工和取消状态。
5. 扩展管理台和管理 API 契约。
   - 结果：成功。
   - 影响：管理台展示商品排名、价格、店铺、评分、销量、来源、采集时间和原始链接；
     OpenAPI 与运行时 TypeBox Schema 同步商品结果结构。
6. 增加商品工作流、WebSocket 入口和响应式 UI 测试。
   - 结果：成功。
   - 影响：覆盖 20 次 Fake 闭环，并在桌面和移动视口验证商品结果无横向溢出。
7. 同步 README、接口、测试和开发状态文档。
   - 结果：成功。
   - 影响：明确区分 M3 跨平台模拟完成与真实购物站点验收未完成。
8. 完成三轮实现自审并加固 Adapter 信任边界。
   - 结果：成功。
   - 影响：运行时按 `unknown` 校验候选与提取元数据，拒绝 URL 凭据，按规范化链接
     去重，并将页面文本压缩为单行，避免重复推荐和多行回复注入。
9. 收紧任务 API 契约。
   - 结果：成功。
   - 影响：运行时 TypeBox 与 OpenAPI 均明确 AI 请求、完整商品请求、缺参商品请求、
     商品结果和错误结果，不再将任务请求/结果暴露为任意对象。
10. 启动本地预览服务。
    - 结果：成功。
    - 影响：Control Server 使用仓库外临时 SQLite 运行于 `127.0.0.1:7070`，
      Operator Web 运行于 `127.0.0.1:4173`。

## 文件变更

- `changelog/2026-09-24-complete-m3-product-search.md`：记录本轮开发、验证和限制。
- `apps/control-server/src/adapters/adapter-error.ts`：集中定义浏览器 Adapter 稳定错误码。
- `apps/control-server/src/adapters/product-search-adapter.ts`：定义购物站点三阶段 Adapter
  和失败关闭默认实现。
- `apps/control-server/src/domain/product-search-command.ts`：解析商品关键词、预算、数量
  和偏好。
- `apps/control-server/src/domain/product-ranking.ts`：校验商品字段、允许域名、预算和
  确定性评分。
- `apps/control-server/src/application/assistant-workflow.ts`：统一执行消息去重和
  AI/商品意图分派。
- `apps/control-server/src/application/product-search-workflow.ts`：实现商品查询固定
  八步编排、缺参、待人工、失败和取消处理。
- `apps/control-server/src/app.ts`、`apps/control-server/src/config.ts`、
  `apps/control-server/src/server.ts`：装配 M3 Adapter、工作流、运行时 Schema 和
  允许域名配置。
- `apps/control-server/test/product-search-command.test.ts`、
  `apps/control-server/test/product-ranking.test.ts`、
  `apps/control-server/test/product-search-workflow.test.ts`：覆盖解析、校验、排序和
  工作流边界。
- `apps/control-server/test/agent-websocket.test.ts`：覆盖商品指令从 Agent WebSocket
  入口到结构化回复的模拟闭环。
- `apps/operator-web/src/`、`apps/operator-web/test/operator-web.spec.ts`：展示并验证
  商品比较结果。
- `contracts/openapi.yaml`：增加商品候选、商品结果和任务错误结果 Schema。
- `README.md`、`docs/03-contracts-and-data.md`、`docs/05-testing-and-acceptance.md`、
  `docs/08-development-status.md`：同步运行配置、契约、测试范围和事实进度。
- `package.json`：增加当前管理台检查入口 `test:ui:m3`。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git status --short --branch` | PASSED | 开始时 `main` 工作树干净并跟踪 `origin/main`。 |
| Node 24 M3 parser/ranking tests | PASSED | 2 个测试文件、16 项测试通过。 |
| Node 24 `npm run check` | PASSED | Control Server 109 项、契约 5 项、C# 37 项通过；构建、格式、lint、类型检查和 M1 跨进程重连通过。 |
| Control Server coverage | PASSED | 语句 94.97%、分支 90.93%、函数 93.82%、行 94.87%。 |
| M3 WebSocket/product focused tests | PASSED | WebSocket 与商品工作流 22 项通过；信任边界与商品工作流聚焦测试 27 项通过。 |
| Control Server / Operator Web typecheck | PASSED | 严格 TypeScript 与 Vue 类型检查通过。 |
| M3 frontend/backend ESLint | PASSED | 无 lint 错误。 |
| `npm run test:ui:m3` | PASSED | 4 项桌面/移动 AI 与商品视口测试通过，无横向溢出。 |
| Operator Web build | PASSED | Vite 生产构建成功。 |
| OpenAPI YAML 解析 | PASSED | Ruby YAML 解析成功。 |
| `npm audit --omit=dev` | PASSED | 未发现生产依赖漏洞。 |
| NuGet vulnerable package audit | PASSED | 未发现易受攻击的直接或传递依赖。 |
| `git diff --check` | PASSED | 未发现空白错误。 |
| Control Server preview health | PASSED | `GET http://127.0.0.1:7070/health` 返回 `ok`。 |
| Operator Web preview | PASSED | `http://127.0.0.1:4173/` 返回 HTTP 200。 |
| Windows 真实桌面与购物站点验证 | NOT_EXECUTED | 当前为 macOS，目标站点、账号和 Windows 环境未提供。 |

## 问题与处理

- 现象：首次工作流静态检查发现 AI 重构后的旧变量引用、解析器窄化和 lint 问题。
- 根因：抽取 `handleAcceptedMessage` 后有两处仍引用原策略结果，严格类型无法根据
  `missingFields` 推导可选值，测试使用了弃用断言。
- 处理：改用显式参数、增加防御性窄化并替换断言；重新执行类型检查和 lint。
- 结果：通过。
- 现象：首轮商品工作流测试有 5 项失败。
- 根因：Vitest `toMatchObject` 对数组仍要求相同长度，局部步骤期望不能匹配八步数组。
- 处理：改为逐步骤状态和错误码的精确数组断言。
- 结果：商品、AI 和 WebSocket 相关测试全部通过，业务实现无需变更。
- 现象：首次 OpenAPI YAML 检查命令失败。
- 根因：系统 Ruby 2.6 的 `YAML.load_file` 不支持 `aliases:` 关键字。
- 处理：契约不使用 YAML alias，改用兼容调用重新解析。
- 结果：通过。
- 现象：最终自审发现真实 Adapter 可在运行时返回不符合 TypeScript 接口的数据，
  且链接可能包含凭据或重复候选，页面文本可能包含换行。
- 根因：静态类型不能替代外部页面数据的运行时边界校验。
- 处理：候选与提取结果改为从 `unknown` 验证，拒绝 URL 用户名/密码，按 URL 去重，
  并规范化展示文本。
- 结果：新增边界测试通过，稳定错误码保持为 `INVALID_PRODUCT_DATA`。
- 现象：最终质量门两次被 lint/typecheck 拒绝。
- 根因：属性规范化中的类型断言在 ESLint 看来多余，但移除后 TypeScript 无法跨
  数组回调保持类型窄化。
- 处理：改为单次 `for...of` 校验并构建规范化属性对象。
- 结果：完整 Node 24 质量门通过。
- 现象：首次管理台后台启动未监听 4173。
- 根因：`npx --call` 未按预期转发 Vite CLI 参数。
- 处理：改用仓库本地 Vite 二进制从 Operator Web 工作目录启动。
- 结果：管理台返回 HTTP 200。

## 风险与限制

- M0 购物站点 Spike 未完成，真实选择器、登录行为和验证码频率未知。
- Fake/fixture 验证不能替代固定目标站点上的字段准确率和 20 次真实闭环验收。

## 最终结果

- M3 跨平台代码和模拟验证范围已完成：商品请求解析、统一消息分派、站点 Adapter
  边界、运行时字段校验、允许域名、预算硬过滤、确定性排序、八步工作流、缺参追问、
  登录/验证码待人工、取消、结构化回复和管理台展示均已实现。
- 自动化验证共 155 项通过：Control Server 109 项、TypeScript 契约 5 项、C# 37 项、
  Operator Web Playwright 4 项；其中包含连续 20 次商品 Fake 闭环。
- M3 真实环境退出验收未完成。仍需冻结目标购物站点和账号，接入真实 Playwright
  Adapter，并执行 100 个标注候选字段准确率及 20 个真实查询成功率验证。
- 用户已明确要求提交并推送本功能分支、合入并推送 `main`，同时保留功能分支；
  交付结果将在操作完成后补充。
- 工作树另有非本任务创建的未跟踪记录
  `changelog/2026-09-24-github-ci-failure.md`，本任务未修改或纳入交付范围。
