# 完成 M2 AI 问答闭环

## 元信息

- 日期：2026-09-24
- 状态：已完成
- 环境：macOS 26.4 arm64；Node.js 26.0.0（项目基线 24 LTS）；npm 11.12.1；
  .NET SDK 10.0.401
- 分支：`feature/complete-m2-ai-workflow`

## 目标

- 实现受信任发送者、命令前缀、消息去重、意图解析、AI 问答编排、回复发送、
  任务与步骤查询组成的 M2 闭环。
- 在真实微信和 AI 页面不可用时，使用失败关闭的适配器边界与 Fake 完成可重复的
  模拟验证，并保留真实 Adapter 的明确接入点。
- 覆盖正常、拒绝、重复、失败、取消和连续 20 次模拟运行场景。

## 上下文与证据

- 已阅读项目守卫 Skill、README、开发状态、M1 changelog、需求、架构、接口与数据、
  实施计划、测试验收、技术决策、Windows 环境和 OpenAPI 契约。
- M1 已合入本地 `main`，原分支保留；当前工作分支为
  `feature/complete-m2-ai-workflow`，开始时工作树干净。
- 当前已有 Control Server、SQLite、严格 WebSocket Agent 通道和失败关闭的
  Desktop Agent 占位执行器；M2 工作流尚未实现。
- 当前主机为 macOS，不能验证微信 UIA、真实 Windows 回复或完整桌面闭环。

## 分析与决策

- 采用确定性的 AI 问答固定步骤，AI Adapter 只返回回答数据，不产生任意动作。
- 在任务创建前执行受信任发送者和命令前缀校验，并以
  `source + conversationId + externalMessageId` 保证持久化幂等。
- 真实微信读取由 Desktop Agent 事件边界承载；真实发送和 AI 页面操作均通过接口
  隔离，Fake 只能作为模拟验证证据。
- 不实现支付、凭据提取、验证码绕过、脚本执行或任意网络/文件操作。

## 操作记录

1. 核对仓库状态和 M2 权威约束。
   - 结果：成功。
   - 影响：确认分支干净、架构边界和验收缺口。
2. 尝试使用 `rg` 枚举代码文件。
   - 结果：失败；当前环境未安装 `rg`。
   - 影响：后续使用 `find` 和其他标准工具完成只读检查。
3. 检查 M1 数据库、Agent Gateway、共享契约和测试结构。
   - 结果：成功。
   - 影响：确认 migration 已包含消息、任务和步骤表，但尚无对应仓储、工作流、
     HTTP 路由或聊天消息 WebSocket 契约。
4. 确定 M2 实现结构。
   - 结果：成功。
   - 影响：新增确定性策略与解析器、任务仓储和工作流服务；AI 与聊天回复使用
     可注入接口，生产默认值失败关闭，测试 Fake 不进入真实执行路径。
5. 实现 M2 Control Server 核心闭环。
   - 结果：成功。
   - 影响：增加严格聊天事件契约、发送者/前缀/禁止动作策略、持久化消息去重、
     AI 问答固定步骤、适配器边界、任务查询及取消 API。
6. 增加单元、契约、WebSocket 和模拟闭环测试。
   - 结果：成功。
   - 影响：覆盖正常、拒绝、重复、适配器失败、验证码待人工、运行中取消，以及
     连续 20 次 Fake AI/聊天回复闭环。
7. 实现 Vue 3 + Pinia Operator Web。
   - 结果：成功。
   - 影响：提供任务筛选、任务详情、步骤时间线、结果/错误和取消操作；Vite 开发服务
     代理本地 Control Server。
8. 执行桌面与移动视口 UI 验证。
   - 结果：成功。
   - 影响：Playwright 使用脱敏 API fixture，在 1440×900 和 390×844 下验证关键
     内容可见、无横向溢出，并生成未提交的测试截图。
9. 复核白名单和并发边界。
   - 结果：发现并修正两处偏差。
   - 影响：白名单改为 SQLite 持久化，环境变量只做幂等引导；同一 Agent 的聊天任务
     独立串行排队且不阻塞心跳；未声明 `wechat.read` 的 Agent 被拒绝。
10. 同步跨语言契约、OpenAPI、README、测试文档和开发状态。
    - 结果：成功。
    - 影响：C# 增加聊天事件 DTO；任务 API 返回步骤；状态明确区分 Fake 验证和真实
      Windows/AI 页面验收。
11. 在 Node.js 24.21.0 下执行干净安装和完整质量门。
    - 结果：成功。
    - 影响：Node、Vue、.NET、跨进程集成和构建全部通过。
12. 启动最终本地预览。
    - 结果：成功。
    - 影响：Control Server 运行于 `127.0.0.1:7070`，Operator Web 运行于
      `127.0.0.1:4173`；预览数据库位于仓库外临时目录。
13. 按用户要求提交 M2 实现。
    - 结果：成功；功能提交为 `389076c`。
    - 影响：完整 M2 跨平台实现、测试和文档形成独立提交，待推送并合入 `main`。
14. 推送 M1 和 M2 功能分支。
    - 结果：成功。
    - 影响：`feature/complete-m1-foundation` 和 `feature/complete-m2-ai-workflow`
      均已在 `origin` 建立并保留。
15. 将两个功能分支合入并推送 `main`。
    - 结果：成功。
    - 影响：M1 已是 `main` 祖先，M2 以快进方式合入；远端 `main` 更新至
      `570923b`。

## 文件变更

- `changelog/2026-09-24-complete-m2-ai-workflow.md`：记录本轮开发、验证和限制。
- `packages/contracts/src/index.ts`、`packages/contracts/test/contracts.test.ts`：增加
  严格 `chat.message.received` DTO 与契约测试。
- `apps/control-server/src/`：增加 M2 策略、适配器边界、工作流、仓储、配置和 API。
- `apps/control-server/test/`：增加 M2 单元、集成、失败和 20 次模拟测试。
- `apps/desktop-agent/src/DesktopAgent.Core/ProtocolContracts.cs`、对应契约测试和共享
  fixture：增加 C# 可序列化的聊天消息 DTO。
- `apps/operator-web/`：新增 Vue/Pinia 管理台和 Playwright 响应式 UI 测试。
- `contracts/openapi.yaml`：同步任务、步骤、查询和取消响应。
- `README.md`、`docs/03-contracts-and-data.md`、`docs/05-testing-and-acceptance.md`、
  `docs/08-development-status.md`：同步运行方式、契约、测试范围和事实进度。
- `.github/workflows/ci.yml`、`package.json`、`package-lock.json`：纳入管理台构建、
  类型检查和 UI 测试，锁定新增依赖。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git status --short --branch` | PASSED | 位于 M2 功能分支，开始时工作树干净。 |
| `rg --files apps/control-server packages/contracts tests` | FAILED | 当前环境没有 `rg`，将使用标准工具替代。 |
| Control Server 局部类型检查 | PASSED | M2 严格 TypeScript 类型检查通过。 |
| Node 24.21.0 `npm ci && npm run check` | PASSED | Control Server 71 项、契约 5 项、C# 37 项通过；管理台构建和 M1 跨进程集成通过。 |
| Control Server 测试与覆盖率 | PASSED | 71 项通过；语句 95.72%、分支 92.06%、函数 92.30%、行 95.65%。 |
| TypeScript 契约测试与覆盖率 | PASSED | 5 项通过，覆盖率 100%。 |
| 连续 20 次 Fake AI 问答闭环 | PASSED | 20 个唯一消息均成功且分别只回复一次。 |
| `npm run test:ui:m2` | PASSED | Chrome 中桌面 1440×900、移动 390×844 两项通过，无横向溢出。 |
| OpenAPI 与 CI YAML 解析 | PASSED | Ruby YAML 解析成功。 |
| `npm audit --omit=dev` | PASSED | 未发现生产依赖漏洞。 |
| `dotnet list ... --vulnerable --include-transitive` | PASSED | 未发现易受攻击的 NuGet 包。 |
| `git diff --check` | PASSED | 未发现空白错误。 |
| 本地 Markdown 链接检查 | PASSED | README、docs 和本任务记录未发现失效相对链接。 |
| Markdown Prettier 检查 | FAILED | 仓库未将 Markdown 纳入格式脚本；既有文档风格与 Prettier 默认规则不同，未做全文件机械改写。 |
| GitHub Actions | NOT_EXECUTED | 已推送，远端 CI 状态在发布后单独核对。 |
| 两个功能分支推送 | PASSED | 两个分支均已推送到 `origin` 并设置上游，未删除原分支。 |
| `main` 合并与推送 | PASSED | M1 已包含，M2 快进合并；远端更新至 `570923b`。 |
| Windows 真实桌面验证 | NOT_EXECUTED | 当前环境为 macOS，且真实目标应用与账号未提供。 |

## 问题与处理

- 现象：`rg` 命令不可用。
- 根因：当前环境未安装 ripgrep。
- 处理：改用 `find`、`grep` 和 `sed` 进行代码检索，不修改系统环境。
- 结果：不阻塞开发。
- 现象：首次安装的 `lucide-vue-next` 被 npm 标记为弃用。
- 根因：该包已迁移为 `@lucide/vue`。
- 处理：立即替换为 `@lucide/vue@1.47.0` 并重新生成锁文件。
- 结果：无弃用警告，依赖审计通过。
- 现象：首次完整检查被 ESLint 拒绝。
- 根因：测试中的 `Promise.withResolvers<void>()` 触发严格
  `no-invalid-void-type`。
- 处理：改为显式 `undefined` 返回类型，并重新执行完整质量门。
- 结果：Node 24 完整检查通过。
- 现象：集成浏览器截图接口报告渲染器视口为 `0x0`。
- 根因：浏览器桥接标签页处于不可截图状态。
- 处理：改用项目内 Playwright 和本机 Chrome 执行确定视口截图及溢出断言。
- 结果：桌面和移动测试均通过，截图保存在被忽略的 `test-results/`。

## 风险与限制

- M0 未完成，真实微信和 AI 页面适配器不能声明可用。
- Fake/fixture 的 20 次运行只证明工作流和契约稳定，不替代目标 Windows 环境验收。
- 目标 AI 页面、微信版本和专用测试账号尚未冻结。

## 最终结果

- M2 跨平台代码和模拟验证范围已完成：SQLite 白名单、消息去重、规则策略、固定 AI
  工作流、失败关闭 Adapter、任务/步骤 API、取消、Vue 管理台和跨语言聊天契约均已
  实现。
- 自动化验证共 115 项通过：Control Server 71 项、TypeScript 契约 5 项、C# 37 项、
  Operator Web Playwright 2 项；其中包含连续 20 次 Fake 闭环。
- M2 真实环境退出验收未完成。仍需在目标 Windows 机器接入微信 UIA 读写和具体 AI
  页面 Playwright Adapter，并执行连续 20 次真实闭环。
- M2 功能提交为 `389076c`，交付记录提交为 `570923b`。
- M1、M2 功能分支均已推送并保留；两者均已包含在远端 `main`。
