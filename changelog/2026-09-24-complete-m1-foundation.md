# 完成 M1 工程骨架

## 元信息

- 日期：2026-09-24
- 状态：已完成
- 环境：macOS 26.4 arm64；Node.js 26.0.0（项目基线 24 LTS）；npm 11.12.1；
  .NET SDK 10.0.401
- 分支：`feature/complete-m1-foundation`

## 目标

- 尽量完整实现 M1 工程骨架，包括 SQLite、WebSocket Agent 通道、.NET Desktop
  Agent 核心、重连、去重、取消、紧急停止、跨语言契约测试和 CI。
- 对必须依赖真实 Windows 桌面的能力使用失败关闭的占位实现，并明确后续接入要求。

## 上下文与证据

- 已阅读项目守卫 Skill、开发状态、最新 changelog、系统架构、接口与数据设计、
  实施计划、测试验收、技术决策和 OpenAPI 契约。
- M1 已完成 npm workspace、严格 TypeScript、Node CI、Control Server 启动和
  `/health`；其余 M1 项尚未开发。
- 当前 macOS 可运行 .NET 10 和跨平台 Node/C# 测试，但不能验证 FlaUI、微信、
  Windows 输入、剪贴板或截图。

## 分析与决策

- Control Server 继续作为任务、策略和 SQLite 的唯一事实源。
- WebSocket 使用严格、版本化 DTO；不提供脚本、Shell、文件路径或 JavaScript 执行。
- Desktop Agent 的连接、协议、安全状态和去重放在跨平台核心；真实 Windows 操作
  通过接口隔离。
- 占位桌面执行器对未接入动作返回明确失败，不模拟成功。
- 用 Fake Agent 和临时 SQLite 完成自动化集成验证；真实 Windows 验证保持未执行。

## 操作记录

1. 将开发状态文档及动态维护规则提交到本地 `main`。
   - 结果：成功；提交 `f85f341`。
   - 影响：建立后续开发状态同步基线。
2. 创建 `feature/complete-m1-foundation` 分支。
   - 结果：成功。
   - 影响：后续 M1 开发与本地主分支隔离。
3. 核对 M1 规范、现有实现和可用运行时。
   - 结果：成功。
   - 影响：确定跨平台真实逻辑加 Windows 占位执行器的范围。
4. 建立共享 TypeScript WebSocket 契约和跨语言 JSON fixtures。
   - 结果：成功。
   - 影响：固定 schemaVersion、消息类型、UUID、UTC 时间、动作枚举和严格参数结构。
5. 实现 SQLite migration、Agent/命令仓储和 WebSocket Agent Gateway。
   - 结果：成功。
   - 影响：支持注册、心跳、在线状态、命令状态、取消、紧急停止和断线离线标记。
6. 建立 .NET 10 solution、Desktop Agent Core、Console Host 和 xUnit 测试。
   - 结果：成功。
   - 影响：实现注册、心跳、指数退避重连、严格反序列化、过期/重复拒绝、串行执行、
     取消和紧急停止。
7. 增加失败关闭的桌面占位执行器。
   - 结果：成功；占位动作统一返回 `NOT_IMPLEMENTED`。
   - 影响：代码注释明确真实 Windows 实现必须接入 FlaUI、前台窗口校验、输入释放和
     两秒紧急停止验证。
8. 执行中期 Node/.NET 检查。
   - 结果：部分失败后修复。
   - 影响：修正 workspace 构建顺序、第三方 Drizzle 声明兼容、C# 分析器规则和
     WebSocket 关闭时数据库生命周期竞态。
9. 增加 Node 与 .NET 真实进程集成测试。
   - 结果：首次失败，发现 .NET UTC `+00:00` 与 Node `Z` 的契约差异。
   - 影响：Schema 改为接受两种合法 UTC ISO 8601 表示，并增加回归测试。
10. 在 Node.js 24.21.0 下执行干净安装和完整质量门。
    - 结果：成功。
    - 影响：Node 40 项测试、契约 4 项测试、C# 37 项测试全部通过；真实跨进程注册和
      服务重启重连通过。
11. 完善数据库和 Agent 双重安全校验。
    - 结果：成功。
    - 影响：增加消息、任务、步骤和确认实体迁移；Agent 对六种动作逐项校验参数、
      未知字段、文本长度、截图名称和按键白名单。
12. 增加心跳超时、独立紧急停止预算和安全关闭顺序。
    - 结果：成功。
    - 影响：三次心跳缺失后断开并标记离线；取消回调移到锁外；紧急输入释放使用独立
      两秒超时，不因 WebSocket 会话取消而跳过。
13. 扩展跨进程集成测试。
    - 结果：首次紧急停止测试失败两次，修复后通过。
    - 影响：发现并修正严格头部解析遗漏 `payload`、C# optional null 输出与 Node
      Schema 不一致；最终验证重连、紧急停止和 `PAUSED` 心跳。
14. 运行五秒稳定性测试路径。
    - 结果：成功。
    - 影响：确认两小时测试脚本的持续心跳检查逻辑可执行。
15. 执行安全与并发复核。
    - 结果：成功。
    - 影响：Agent 增加动作参数白名单校验、心跳超时；取消回调移至锁外；紧急停止
      使用独立两秒预算。
16. 从清理状态在 Node.js 24.21.0 下执行最终完整质量门和依赖审计。
    - 结果：成功。
    - 影响：81 项测试、Node/.NET 构建、格式、lint、类型、跨进程集成全部通过，
      Node 与 NuGet 均未发现已知漏洞。
17. 同步契约、README 和开发状态。
    - 结果：成功。
    - 影响：M1 标记为代码完成、验收未完成，真实环境缺口保持可见。
18. 对所有受影响的非代码文件执行交叉一致性审计。
    - 结果：发现并修正 README 阶段措辞、Desktop Agent 实际模块边界，以及实施、
      测试、风险和 Windows 环境文档中的 Fake/真实验收区分。
    - 影响：所有权威文档均指向 `docs/08-development-status.md` 作为进度事实源；
      历史 changelog 保持当时事实，不因当前进度回写。
19. 执行提交前依赖审查并重新运行完整质量门。
    - 结果：移除未使用的 `@fastify/type-provider-typebox`；Node.js 24 下完整检查通过。
    - 影响：减少无效生产依赖，锁文件同步更新；81 项测试和跨进程集成继续通过。
20. 按用户要求提交完整 M1 改动。
    - 结果：成功；功能提交为 `824d440`。
    - 影响：提交位于 `feature/complete-m1-foundation`，未推送、未合并。

## 文件变更

- `changelog/2026-09-24-complete-m1-foundation.md`：记录本轮开发和验证。
- `packages/contracts/`、`contracts/fixtures/websocket-v1/`：共享严格协议 Schema 和
  Node/C# 共用 fixtures。
- `apps/control-server/`：增加 SQLite、Agent Gateway、Agent/命令仓储和相关测试。
- `apps/desktop-agent/`、`HumanOperationSimulator.slnx`、`Directory.Build.props`、
  `global.json`：增加 .NET Agent 工程、核心逻辑和测试。
- `tests/integration/m1-agent-reconnect.mjs`：增加 Node/C# 注册和重连集成测试。
- `.github/workflows/ci.yml`、`package.json`：扩展 Node/.NET/集成质量门。
- `docs/03-contracts-and-data.md`、`contracts/openapi.yaml`：同步 WebSocket 行为、
  错误码和紧急停止响应。
- `docs/08-development-status.md`、`README.md`：同步 M1 当前能力、占位边界和命令。
- `docs/02-system-architecture.md`：同步 Core、Console Host 和计划中 Windows 驱动边界。
- `docs/04-implementation-plan.md`：明确 Fake 工程开发不替代 M0 或 M1 退出验收。
- `docs/05-testing-and-acceptance.md`：记录 M1 跨进程与两小时测试范围。
- `docs/06-decisions-and-risks.md`：记录产品决策未冻结但仅推进占位骨架的例外。
- `docs/07-windows-test-environment.md`：增加 Windows 上的 M1 骨架验证命令和限制。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git status --short --branch` | PASSED | 新分支工作区干净。 |
| 首轮 Node 类型检查 | FAILED | workspace 构建顺序及 Drizzle 第三方声明与 TS 6 不兼容。 |
| 首轮 .NET build | FAILED | 分析器要求使用框架参数守卫 API。 |
| 首轮 Node 覆盖率检查 | FAILED | 新增 Gateway 分支覆盖低于既有阈值。 |
| 首轮跨进程重连测试 | FAILED | .NET `+00:00` UTC 时间被 Node Schema 拒绝。 |
| Node 24.21.0 `npm ci && npm run check` | PASSED | 81 项自动化测试及跨进程重连全部通过。 |
| `npm run test:integration:m1 -- --duration-ms=5000` | PASSED | 重连、紧急停止和持续心跳检查通过。 |
| `npm run test:stability:m1` | NOT_EXECUTED | 完整命令需要持续运行两小时，本轮仅验证五秒路径。 |
| GitHub Actions | NOT_EXECUTED | 工作流已配置，但当前分支尚未推送。 |
| `npm audit --omit=dev` | PASSED | 未发现生产依赖漏洞。 |
| `dotnet list HumanOperationSimulator.slnx package --vulnerable --include-transitive` | PASSED | 三个 .NET 项目均未发现易受攻击的包。 |
| OpenAPI/CI YAML 解析和 `git diff --check` | PASSED | YAML 语法有效且无空白错误。 |
| 全部 Markdown 本地链接检查 | PASSED | README 和 `docs/*.md` 未发现断链。 |
| M1 状态陈述搜索与人工对账 | PASSED | 仅历史 changelog 保留旧测试数量；当前文档无过期阶段描述。 |
| Windows 真实桌面验证 | NOT_EXECUTED | 当前环境为 macOS，且 M0 尚未完成。 |

## 问题与处理

- 现象：TypeScript 无法在干净环境解析尚未构建的 workspace 契约包。
- 根因：契约包运行时入口指向 `dist`。
- 处理：根脚本显式先构建契约包，再检查或构建依赖方。
- 结果：干净安装后的类型检查和构建通过。
- 现象：关闭测试服务时 WebSocket close 回调可能访问已关闭数据库。
- 根因：Socket 和数据库关闭顺序没有显式协调。
- 处理：在 Fastify `preClose` 阶段先标记 Agent 离线、关闭会话并清空注册表。
- 结果：测试无未处理异常。
- 现象：首次跨语言运行时 Agent 持续重连。
- 根因：Node 只接受 `Z`，.NET 输出等价的 UTC `+00:00`。
- 处理：共享 Schema 接受两种 UTC ISO 8601 表示，仍拒绝非零时区偏移。
- 结果：跨进程注册和服务重启重连通过。
- 现象：紧急停止消息下发后 Agent 再次重连并收到 `INVALID_MESSAGE`。
- 根因：严格头部 DTO 未声明合法 `payload` 字段，且 C# 心跳将 optional 字段输出为
  `null`。
- 处理：头部显式接收 `JsonElement payload`，序列化时省略 null，并增加序列化测试。
- 结果：紧急停止后 Agent 进入 `PAUSED` 并继续发送有效心跳。

## 风险与限制

- M0 未完成，真实 Windows Adapter 只能定义边界和占位行为，不能宣称可用。
- 两小时连接测试可实现可配置或加速的自动化路径，但真实两小时 Windows 稳定性仍需
  后续执行。
- GitHub Actions 工作流尚未在远端运行，Windows runner 结果待推送后确认。

## 最终结果

- M1 工程代码已完成：Control Server、SQLite migration、严格 WebSocket 契约、
  .NET Desktop Agent、注册/心跳/重连、命令去重/取消/紧急停止、双端参数校验、
  CI 和跨进程测试均已实现，功能提交为 `824d440`。
- 真实桌面动作保持失败关闭的占位实现。M1 仍未满足项目级退出标准，因为两小时测试、
  GitHub Actions 远端运行和目标 Windows 验证尚未执行。
