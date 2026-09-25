# 全项目恶性问题与 Bug 通查

## 元信息

- 日期：2026-09-25
- 状态：已完成
- 环境：macOS；Node.js v24.21.0（`/opt/homebrew/opt/node@24`，本机默认 26）；.NET 10.0.401

## 目标

- 从云端同步主分支（仓库主分支为 `main`，不存在 `master`）最新代码。
- 对整个仓库做只读通查，识别恶性问题与 Bug：安全边界、策略校验、并发/资源、
  持久化、契约一致性、崩溃路径、危险默认值。
- 运行完整质量门（lint/typecheck/build/test）作为基线证据。
- 输出按严重程度排序的问题清单与证据位置；本次不修改业务代码。

## 上下文与证据

- 基线：`origin/main` `602a6eb`（Merge M5 delivery preparation work），拉取前工作树干净。
- `docs/08-development-status.md`：M1–M5 跨平台代码与模拟验证完成；真实 Windows/
  微信/站点项全部未验证；项目级"不具备验收条件"。
- 架构：Control Server（Fastify + SQLite + WS）为编排/策略/持久化唯一事实源；
  Desktop Agent（C# .NET 10，当前为失败关闭占位执行器）；Operator Web（Vue 3）。
- 全量人工通读：config/server/app、agent-gateway、两个工作流、四个域模块
  （命令解析/排序/重试/超时/统计/脱敏/产物保留）、全部数据库仓储与迁移、
  C# Core 全部 8 个源文件、前端 App.vue/api/store、集成测试、CI、OpenAPI。

## 分析与决策

当前"运行形态"（占位执行器 + 模拟适配器）未发现正在发生的数据损坏、密钥泄漏
或可被远程利用的恶性问题；质量门全绿。但发现 1 个高严重级别的**潜伏设计缺陷**
（真实执行器接入后必现）和若干中低级别问题，分述如下。

### H1（高，潜伏）：Agent 接收循环与派发串行，运行中的动作无法被取消/急停

- 位置：`apps/desktop-agent/src/DesktopAgent.Core/AgentClient.cs`
  `ReceiveLoopAsync` 中 `await HandleCommandAsync(...)` → `dispatcher.DispatchAsync`
  → `executor.ExecuteAsync` 全部完成后，才发起下一次 `ReceiveMessageAsync`。
- 后果：动作执行期间服务端推送的 `task.cancel`、`system.emergency-stop` 帧滞留
  在 WebSocket 接收缓冲中，直到动作自然结束才被读取。`CommandDispatcher` 已为每个
  活动命令登记 linked CTS（`activeCommands`），`CancelTask`/`EmergencyStopAsync`
  会取消这些 CTS——但这两个方法只从接收循环调用，接线层面被架空。
- 真实环境含义：文档承诺的"紧急停止 2 秒内释放全部输入"在当前结构下不可能达成；
  任务取消不能打断在执行的 FlaUI 动作（急停正是输入失控时的最后安全闸）。
- 现在未暴露的原因：占位执行器立即返回；且不存在 AgentClient 的测试
  （测试目录无 AgentClientTests），模拟环境无法触发。
- 修复方向：接收循环持续排空；桌面命令进入 Channel/队列由单个串行 worker 消费
  （保持"单 Agent 串行"语义）；cancel/emergency 帧到达即调用 dispatcher。
  补一个"阻塞执行器 + 并发取消帧"的测试。

### M1（中）：服务端桌面命令永不过期，过期后仍可回写结果

- 位置：`infrastructure/database/command-repository.ts` `complete()`
  仅匹配 `state = 'PENDING'`，不校验 `expiresAt`；也没有任何扫描把过期 PENDING
  置为终态。
- 后果：双重策略的服务端一侧失效——Agent 端 10 分钟 TTL 是唯一执行点；
  一条过期命令理论上在任意时间后仍可被回写 SUCCEEDED/FAILED。
- 修复方向：`complete()` 增加 `expires_at > now` 条件；增加周期性过期扫描
  （或在 reaper 中顺带处理）。

### M2（中）：进入 WAITING_FOR_HUMAN 时活动步骤永久卡在 RUNNING

- 位置：AI 工作流 `ai-question-workflow.ts`（步骤 2 已 start，随后任务转
  WAITING_FOR_HUMAN 但步骤不终结）；商品工作流 `product-search-workflow.ts`
  在 open/search/extract 任一步骤同样。
- 后果：持久化任务里出现"步骤执行中 + 任务待人工"的矛盾状态，管理台时间线
  对等待任务显示永久"执行中"。
- 修复方向：等待转态时把活动步骤留在一个确定状态（失败并标注等待码，或引入
  显式等待标记），恢复时再重新开始该步骤。

### M3（中，属已声明"认证前"阶段，建议尽早收口）：本地接口无认证且无 Origin 校验

- 事实：`/api/v1/system/emergency-stop`、cancel 等变更端点无任何鉴权；
  `await app.register(websocket)` 未配置 Origin 校验；命令结果 `complete()`
  不验证回写者身份。回环强制绑定只挡远程网络，挡不住本机浏览器。
- 可利用路径：用户浏览器打开恶意网页时，网页可（1）发出简单跨域 POST
  触发本地急停/取消（CSRF，读不到响应但副作用发生）；（2）用 JS 打开
  `ws://127.0.0.1:7070/ws/agent`（WS 不受同源策略限制、服务端不验 Origin），
  注册 Agent 并可冒用默认 Agent ID 踢掉真实节点，随后注入伪造的
  `chat.message.received`（AI 任务因攻击者不知可信发送者 ID 仍会被策略拦截，
  但拒绝服务本身成立）。
- 修复方向：WS 握手校验 Origin 白名单（非空且非本机/白名单即拒绝）；
  变更端点增加 Origin/Sec-Fetch-Site 校验或 CSRF token；认证落地时为每个
  Agent 配发独立令牌并在 `complete()` 校验。

### L1（低）：前端错误处理假定错误响应体为 JSON

- `operator-web/src/api.ts` `request()` 在 `!response.ok` 时直接
  `await response.json()`，遇到网关 HTML 错误页/空响应会二次抛错，掩盖真实错误码。

### L2（低）：重试退避 sleep 不响应取消

- `domain/retry-policy.ts` 中 `await this.sleep(delayMs)` 不观察信号；
  默认仅 500ms，取消/超时最多被推迟一个退避间隔。

### L3（低）：文档/死代码漂移

- OpenAPI 中 `Agent.capabilities` 为任意字符串，TypeBox 实现为能力枚举（实现更严，
  建议反向同步文档）。
- TS 契约 `ProtocolError` 含 `SCHEMA_VERSION_UNSUPPORTED`，服务端实际恒发
  `INVALID_MESSAGE`，该枚举值从不产生。

### L4（低）：硬超时可能在聊天回复发送中途 abort

- 90/120 秒边界上 `chatReplyAdapter.send` 可能被超时信号打断。当前适配器均为
  占位；接入真实实现时必须保证 send 的 abort 语义安全（中断即未发送，不得出现
  部分发送后重试导致重复消息）。

## 操作记录

1. `git fetch origin --prune && git pull --ff-only origin main`。
   - 结果：成功；Already up to date（`602a6eb`）。
2. 创建并持续维护本 changelog 记录。
   - 结果：成功。
3. 运行完整质量门 `npm run check`（Node 24）。
   - 结果：成功，全绿（见验证表）。
4. 全量人工通读全部源码、测试与契约（清单见"上下文与证据"）。
   - 结果：识别 H1 一项高、M1–M3 三项中、L1–L4 四项低。
5. 专项扫描：提交的 .env、eval/child_process、TODO 数量。
   - 结果：无 .env；无动态执行；仅 2 处 TODO（均在占位执行器内，属合理标注）。

## 文件变更

- `changelog/2026-09-25-full-project-audit.md`：本次审查记录（新建）。
- 业务代码：无改动（只读审查）。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git pull --ff-only origin main` | PASSED | Already up to date，基线 `602a6eb`。 |
| `npm run format:check` | PASSED | All matched files use Prettier code style。 |
| `npm run lint` | PASSED | ESLint 无错误。 |
| `npm run typecheck` | PASSED | 三个工作区类型检查通过。 |
| control-server 单测 | PASSED | 全部通过（M5 基线 207 项规模）。 |
| `npm run build` | PASSED | contracts/control-server/operator-web 构建成功。 |
| `check:dotnet` | PASSED | format 验证通过；构建 0 警告 0 错误；55 项测试通过。 |
| `npm run test:integration:m1` | PASSED | 注册/重连/急停 `result=passed`。 |
| 密钥/危险 API 扫描 | PASSED | 无 .env、无 eval/child_process。 |

## 问题与处理

- 本次为只读审查，不做代码修复；全部问题与修复方向已在上文逐条记录，
  可按 H1 → M1 → M3 的顺序另行开任务处理。

## 风险与限制

- 本审查在 macOS + 模拟环境完成：真实 Windows/微信/站点路径无法执行，
  H1 也必须在真实执行器接入后才能实机复现与验收。
- M3 属文档已声明的"认证前"状态，但"浏览器内网页"这一攻击面文档未提及，
  建议在进入真实环境前至少先加 Origin 校验。

## 最终结果

- 主分支已与云端同步（`602a6eb`），完整质量门全绿；未发现当前运行形态下
  正在发生的恶性故障。
- 输出问题清单：高 1（H1，真实环境急停/取消失效的潜伏缺陷）、中 3
  （M1 命令不过期、M2 等待时步骤卡 RUNNING、M3 本地 CSRF/WS Origin 攻击面）、
  低 4（L1–L4）。
- 本 changelog 为唯一改动文件，尚未提交（等待用户决定是否提交/开修复任务）。
