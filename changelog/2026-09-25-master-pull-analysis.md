# 拉取云端 main 最新代码并三重确认硬伤

## 元信息

- 日期：2026-09-25
- 状态：已完成
- 环境：macOS；Node.js v24.21.0（`/opt/homebrew/opt/node@24`，本机默认 26）；.NET 10.0.401

## 目标

- 拉取云端默认分支（origin/main，即用户口径的 master；仓库无 master 分支）最新代码。
- 忽略占位符/Stub 实现本身，对逻辑与代码硬伤做三重确认：
  1. 第一重：全项目只读通查（`2026-09-25-full-project-audit.md`）。
  2. 第二重：复核云端新增的 H1 修复，并复查 M1/M2/M3 遗留点。
  3. 第三重：主线人工逐行精读全部源码 + 两个独立审查代理（Node/C#）交叉验证 + 关键竞态实证。

## 上下文与证据

- fetch 后本地 main 与 origin/main 均为 `1a6e82d`，工作区干净。相对第一重基线
  `602a6eb` 仅新增 H1 修复：`245c33e`、`1a6e82d`（AgentClient 接收/执行 Channel 解耦，
  新增 3 项回归测试），diff 仅触及 AgentClient.cs、AgentClientTests.cs、文档与 changelog。
- 第三重主线人工通读范围：control-server 全部 19 个源文件（app/server/config、
  gateway、2 个 workflow、assistant、reaper、artifact cleanup、statistics、
  8 个域模块、6 个 repository、schema/migrations/database）；C# Core 全部 8 个源文件
  + Program.cs；前端 App.vue/api.ts/store。
- 实证：在仓库内临时建控制台项目验证 `CancellationTokenSource` 行为，验毕删除。

## 分析与决策

### 三方一致确认、且主线人工复核成立的发现

**H2（高，真实代码缺陷，实证）：CommandDispatcher 的 CTS「锁内快照、锁外 Cancel」
与 DispatchAsync finally 的「锁内 Remove、锁外 Dispose」构成 TOCTOU 竞态。**

- 位置：[CommandDispatcher.cs#L115-L131](../apps/desktop-agent/src/DesktopAgent.Core/CommandDispatcher.cs#L115-L131)
  （CancelTask）、[#L135-L149](../apps/desktop-agent/src/DesktopAgent.Core/CommandDispatcher.cs#L135-L149)
  （EmergencyStopAsync 同模式）、[#L107-L111](../apps/desktop-agent/src/DesktopAgent.Core/CommandDispatcher.cs#L107-L111)
  （finally：Remove 在锁内、Dispose 在锁外）。
- 触发：cancel/emergency 帧恰在命令执行刚结束、finally 完成前到达。接收线程锁内快照
  CTS 后释放锁；worker 线程随即 Remove 并 Dispose；接收线程再 `Cancel()`。
- 实证结果：CTS Dispose 后 `Cancel()` 确定抛 ObjectDisposedException；按生产代码
  精确形态（无任何调度加宽）1,000,000 次复现 37 次，加宽窗口 200,000 次复现 274 次。
- 后果链：ODE 在 [AgentClient.cs#L156/L162](../apps/desktop-agent/src/DesktopAgent.Core/AgentClient.cs#L156)
  无本地 catch → receiveTask 故障 → WhenAll 过滤器只吞 OCE → ODE 穿透 →
  正常取消帧被误记为“连接故障”并重连；**急停路径中 [#L148](../apps/desktop-agent/src/DesktopAgent.Core/CommandDispatcher.cs#L148)
  `executor.EmergencyStopAsync`（物理释放按键/鼠标）被跳过**，foreach 在首个 ODE 处
  中止还会丢失其余在跑命令的取消信号。
- 定性：安全路径上的真实并发缺陷。单次概率低，但“动作结束瞬间点停止”是高频人机时序。

**中危（真实、条件触发）：**

1. **服务端命令仍不过期**（第一重 M1 未修）：[command-repository.ts#L25-L43](../apps/control-server/src/infrastructure/database/command-repository.ts#L25-L43)
   `complete()` 只匹配 PENDING，不校验 `expiresAt`；也无过期扫描。双重策略的服务端
   一侧失效；任务超时（非取消）路径也不级联取消其 PENDING 命令。
2. **超时被误记 TASK_CANCELLED，且“回复已送达却落 FAILED”**：
   [ai-question-workflow.ts#L214-L218](../apps/control-server/src/application/ai-question-workflow.ts#L214-L218)
   （调用点 L162/L174）、[product-search-workflow.ts#L376-L380](../apps/control-server/src/application/product-search-workflow.ts#L376-L380)
   （调用点 L193/L204/L217/L239）。硬超时已 abort（TimeoutError）但被 await 的适配器
   Promise resolve（物理发送恰在 deadline 附近完成时真实可达）→ assertActive 抛 AbortError
   → 错误码错分；send 之后的变体导致管理员 recover 产生重复回复。取消路径不受影响
   （catch 开头有 CANCELLED 状态检查）。
3. **优雅关闭不中止活动任务，进程可挂起 90/120 秒**：[app.ts#L374-L378](../apps/control-server/src/app.ts#L374-L378)
   preClose 未 abort 两个工作流 activeTasks；硬超时定时器
   （[ai L101-L103](../apps/control-server/src/application/ai-question-workflow.ts#L101-L103)、
   [product L98-L100](../apps/control-server/src/application/product-search-workflow.ts#L98-L100)）
   未 `.unref()`；到点 abort 后续跑向已关闭 DB 写入；编排器可能提前 SIGKILL。
   [server.ts#L25-L30](../apps/control-server/src/server.ts#L25-L30) `process.once` 使
   关闭挂起期间第二次 Ctrl-C 被忽略，shutdown reject 无兜底。
4. **急停 latch 生产环境无复位入口 + cancelledTasks 无界跨重连**：
   [CommandDispatcher.cs#L15](../apps/desktop-agent/src/DesktopAgent.Core/CommandDispatcher.cs#L15)
   cancelledTasks 全仓库无清理/裁剪；[ResetEmergencyStop()#L151-L157](../apps/desktop-agent/src/DesktopAgent.Core/CommandDispatcher.cs#L151-L157)
   仅测试调用，协议也无解除急停帧；服务端 cancel/emergency 对所有 agent 广播，
   每个 agent 永久累积全系统 taskId。急停后跨任意次重连永久 PAUSED/POLICY_DENIED，
   仅重启进程可恢复。急停 latch 本身是标准安全设计，但复位未接线属完工缺口。
5. **EmergencyStopAsync 忽略 session token，2 秒超时 OCE 会穿透**：
   [CommandDispatcher.cs#L133-L149](../apps/desktop-agent/src/DesktopAgent.Core/CommandDispatcher.cs#L133-L149)
   签名 `_` 完全忽略会话 token；2 秒超时仅在 executor 配合时有效，executor 不观察
   token 则 await 无界；超时抛 OCE 时 WhenAll 过滤条件（要求 session CTS 已取消）
   不满足 → 又一次误重连。
6. **Artifact 清理竞争可致进程崩溃**：[artifact-cleanup.ts#L72/L84](../apps/control-server/src/application/artifact-cleanup.ts#L72)
   stat/unlink 无 per-file 容错，readdir 与操作间文件被外部删除 → ENOENT 使 runOnce
   reject；[L44-L46](../apps/control-server/src/application/artifact-cleanup.ts#L44-L46)
   `void runOnce()` 无 catch → unhandledRejection → Node 默认 throw 崩溃。窗口窄（小时级）。
7. **销量解析取文本首个数字，可扭曲排序**：[product-ranking.ts#L18](../apps/control-server/src/domain/product-ranking.ts#L18)
   `salesText` 如“券后价99元 已售1.2万”解析为 99，maximumSales 归一化失真 →
   salesScore（权重 20%）错误、rank 顺序可能改变且无告警。
8. **本地接口 Origin 攻击面**（第一重 M3，文档声明的“认证前”阶段）：HTTP 变更端点
   无鉴权/无 Origin 校验，[app.ts#L565-L567](../apps/control-server/src/app.ts#L565-L567)
   WS 无 Origin 白名单：恶意网页可 CSRF 触发急停/取消、可冒名 WS 注册踢掉真实节点。
   回环绑定只挡远程网络，挡不住本机浏览器。建议进真实环境前收口。

**低危（确认存在）：**

- WAITING_FOR_HUMAN 时活动步骤保持 RUNNING（第一重 M2）：测试明确断言的刻意建模
  （ai-question-workflow.test.ts#L212），属建模取舍而非意外缺陷；UI 时间线显示问题保留。
- 前端 [api.ts#L131](../apps/operator-web/src/api.ts#L131) 假定错误响应体为 JSON（L1）。
- [retry-policy.ts#L76](../apps/control-server/src/domain/retry-policy.ts#L76) 退避不响应
  取消（L2），abort 落在退避期会冗余发起一次调用；sleep 定时器未 unref。
- [ProtocolContracts.cs#L25/L38/L55](../apps/desktop-agent/src/DesktopAgent.Core/ProtocolContracts.cs#L25)
  无参字符串枚举转换器同时接受数字序数与 CLR 名，枚举将来重排会静默错配。
- 未注册 WS 会话无握手超时，close() 也不覆盖 → FD/内存缓慢泄漏（回环降低风险）。
- 结果丢弃 + 24h 去重跨会话（[AgentClient.cs#L219-L223](../apps/desktop-agent/src/DesktopAgent.Core/AgentClient.cs#L219-L223)）：
  当前服务端不自动重放，风险低。
- 脱敏盲区：分组手机号（138 1234 5678）、JSON 形态 `"password":"x"`（引号打断
  key 后 [:=] 匹配；结构化 key 路径不受影响）、全角“密码：”自由文本。
- CANCELLED 任务无 errorCode，统计错误分布落入 UNSPECIFIED，与真实错误混桶。
- 任务超时从 createdAt 计时：未来实现 WAITING_FOR_HUMAN 恢复时，人工等待时间会在
  恢复后被立即计为超时（潜伏，当前无恢复路径，不触发）。
- desktop_commands.task_id 无外键（无删除任务路径，不可触发）；Program.cs AGENT_ID
  Guid.Parse 裸奔；ParseAllowedActions 只认 C# 标识符名（运维脚枪）。

### 被否证/降级的发现

- 独立代理 A 曾提“EMAIL 规则先执行导致 URL 凭据用户名泄漏”。主线人工追踪：邮箱替换
  保留 `@`（`[REDACTED]@$2`），URL_CREDENTIALS 随后仍匹配
  `https://alice:[REDACTED]@` 并整体遮蔽——**不存在泄漏，该发现驳回**。
- H1（第一重高危）已确认在云端修复且测试可复现缺陷（旧实现 3/3 失败、新实现通过），
  串行执行语义不变，关闭路径的 TaskCanceledException 逃逸一并修复。

### 总体判断

- 正常主流程（解析→策略→工作流→排序→回复→状态落库）不存在必然触发的硬伤：全部
  状态转移为带前置态守卫的条件 UPDATE，create/cancel 在事务内，消息去重有唯一索引，
  非幂等操作不重试，Server/Agent 双重策略有效，未发现越权执行路径。
- 真实缺陷集中在“边界时序/部署可用性/安全收口”：H2 竞态（高）+ 8 项中危。
  H2 不会越权，危害为误杀会话、急停物理释放钩子被跳过、无界增长/永久 latch。

## 操作记录

1. fetch 云端并比对提交；读取必读文档与状态/历史 changelog。结果：成功。
2. Node 24 下运行完整质量门。结果：成功，全绿。
3. 派出两个独立审查代理（Node/C#）并回收报告。结果：成功。
4. 主线逐行精读全部源码；临时控制台项目实证 CTS 行为后删除。结果：成功，临时文件已清理。
5. 交叉比对三方结论，驳回 1 项误报，确认 H2 及中低危清单。结果：成功。

## 文件变更

- 本 changelog（新建）。
- 业务代码：无改动（只读分析；临时验证项目已删除）。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git fetch origin --prune` | PASSED | 本地与 origin/main 一致（`1a6e82d`）。 |
| `npm run check`（Node 24.21.0） | PASSED | Node 格式/lint/类型/单测/构建全过。 |
| `check:dotnet` | PASSED | format 通过；0 警告 0 错误；58/58 测试通过。 |
| `test:integration:m1` | PASSED | 注册/重连/急停 result=passed。 |
| CTS Cancel-after-Dispose 实证 | PASSED | 确定抛 ObjectDisposedException。 |
| TOCTOU 竞态实证（生产精确形态） | PASSED | 1,000,000 次命中 37 次，竞态真实可达。 |

## 问题与处理

- 本次为只读三重确认，不做代码修复。建议修复顺序：H2（竞态，Cancel 移入锁内或对
  快照 CTS 做 use-after-dispose 防护、Dispose 推迟）→ 中 8（Origin 收口）→
  中 1/2（过期与超时错分）→ 中 3/4/5（关闭与急停接线）。

## 风险与限制

- 全部分析在 macOS + 模拟环境完成；真实 Windows/微信/站点路径与物理输入释放仍需
  实机验收，H2 在真实执行器上的后果（急停是否在 2 秒内释放）也需实测。
- 竞态实证为受控复现，生产实际频率取决于线程调度与人机时序。

## 最终结果

- 云端 main 已同步（`1a6e82d`），H1 修复确认有效，完整质量门全绿。
- 结论：**主流程无必然硬伤，但存在 1 项实证高危竞态（H2）与 8 项条件触发的中危
  缺陷**；已逐条给出位置、触发条件与后果链，等待用户决定是否开修复任务。
