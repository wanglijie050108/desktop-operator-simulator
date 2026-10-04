# Python Agent 传输/调度与微信接入基础层（2026-09-28 合并摘要）

> 本文件合并自 6 条原始 changelog（原文件名见文末索引）。原文可用 `git show <commit>:changelog/<原文件名>` 找回。

## 阶段目标

- Python Agent 配置、WebSocket 注册/心跳/重连/优雅退出，接收与串行执行解耦。
- 命令白名单、有效期与去重、活动取消、两秒急停释放与日志脱敏；Windows 基础动作执行器与平台隔离、强制前台复核、微信读写失败关闭。
- 微信消息接入（HMAC 标识/指纹/去重/上报）、只读 UIA 取证与 20 轮记事本 M0 Spike。

## 关键决策与依据

- 传输层用 asyncio，桌面命令经单一 `asyncio.Queue` 串行消费；接收循环立即处理取消/急停控制帧、桌面命令只入队；执行器可注入、默认失败关闭且不导入 pywinauto，未实现动作返回 `NOT_IMPLEMENTED`。
- 协议网络侧只认 camelCase、内部 snake_case，支持 hello/welcome、心跳与指数退避重连；工具链经 `uv run --directory apps/desktop-agent-python` 执行（`uv --project` 不切工作目录）。
- 桌面动作跑独立执行子任务：取消只取消子任务本身，command worker 仍返回 `TASK_CANCELLED`，避免取消传播终止接收会话。
- 执行器契约加 `threading.Event`，取消/急停在取消 asyncio Task 前置位；asyncio 取消无法终止 `to_thread` 内工作线程，未来 pywinauto 须在每个可中断 UI 边界轮询。
- 急停先原子切 `PAUSED` 并取消活动任务，再以两秒上限调 `emergency_stop()` 释放所有按键与鼠标按钮，超时保持暂停并向传输层暴露失败。
- `policy.py` 白名单用契约中的大写动作名，空配置仅指六类受限动作默认集，未知白名单动作拒绝启动；启动日志经 `redaction.py` 脱敏。
- Windows 自动化默认关闭，启用须给纯进程名白名单，带路径或未授权进程返回 `POLICY_DENIED`；Windows 代码独放 `windows_backend.py` 延迟导入，跨平台逻辑经 `WindowsBackend` 协议以 Fake 验证。
- 前台双检：先激活唯一匹配的可见启用窗口，再以窗口句柄 + 进程 ID 校验，剪贴板/按键/截图前后均复核，多匹配失败关闭；截图只写管理员配置目录，文件名由 `artifactName` + `commandId` 组成，Windows 条件依赖 Pillow 11.3.0。
- `wechat_ingress.py` 用带本机密钥的 HMAC-SHA256 标识会话与发送者（不发原显示名）；指纹不含原文、含分钟时间桶与可见顺序，稳定来源 ID 纳入会话维度防跨会话碰撞；发布成功后才登记去重，网络失败停批下轮重试（至少一次语义与顺序），单条编码失败只跳过该条、日志只记类型；默认空消息源不声明 `wechat.read`，Control Server 只收声明该能力的 Agent，以 `(source, conversationId, externalMessageId)` 幂等。
- `uia_inspection.py` 只连已运行的纯进程名目标，不启动微信、不点击/按键/剪贴板；Name 与窗口标题只输出每次运行随机、不落盘的 HMAC 与长度，结构字段仅在安全字符集明文否则转摘要；节点上限 2000，读取异常须标 `truncated` 而非完整报告；进程名仅允许 `WeChat.exe`/`Weixin.exe`。
- `notepad_spike.py`（`desktop-agent-windows-spike`）固定 20 轮做激活/全选/剪贴板写读/粘贴/UIA 读文/截图/输入释放；报告只含轮次、结果、稳定错误码与耗时，不含测试正文，门槛成功率 ≥95%；目标固定 `notepad.exe` 且要求先关其他记事本窗口，文本验证用两秒有界轮询后再截图，编辑控件兼容 `Document`/`Edit`。

## 验证证据

| 范围 / 命令 | 状态 | 结果 |
|---|---|---|
| 阶段定向测试（`npm run check:python`：Ruff、mypy、pytest） | PASSED | 传输层 30 项/92.20%；安全调度 53 项/93.67%；Windows 动作 72 项/94.09%；记事本 Spike 80 项/92.98%；微信接入 103 项/93.73%；UIA 取证 111 项/92.58%（90% 覆盖率门槛，仅排除 `main.py`/`__main__.py`）。 |
| `npm run test:integration:m1:python` | PASSED | 注册、心跳、服务重启重连、急停后 `PAUSED`；C#/Python 双基线。 |
| `npm run test:spike:m0:notepad` / `:m0:wechat-inspect`（macOS） | PASSED | 均按设计返回 `WINDOWS_REQUIRED`；记事本命令退出码 2。 |
| `uv lock --check --directory apps/desktop-agent-python` | PASSED | 锁文件与项目依赖一致。 |
| `npm run check` | PASSED | Node 207、C# 58 恒定；Python 30→53→72→80→103→111 全通过；双 Agent 集成无回归。 |
| 真实 Windows 11 20 轮记事本 Spike / pywinauto 实机 | BLOCKED | 仅 macOS，缺交互式桌面；传输层与调度阶段该验证为 NOT_EXECUTED。 |
| 真实微信 UIA 读取与控件树取证 | BLOCKED | 缺目标 Windows 微信版本与控件树证据。 |

## 未完成与后续

- 目标 Windows 11 交互式桌面跑 20 轮记事本 Spike 并保留 JSON 报告，据结果决定是否进入微信控件识别。
- 目标 Windows 微信版本运行只读取证命令，人工用 Inspect.exe/py_inspect 复核未截断报告；取得证据前不实现 `WeChatMessageSource`、不冻结读写 selector。
- HMAC 密钥仅有注入/临时密钥边界，本机安全配置未落地；真实执行器的窗口匹配、DPI、剪贴板、截图与输入释放无实机证据，多匹配窗口需用 `titleContains` 收窄。

## 风险与限制

- 仅 macOS 验证调度与失败关闭语义，不能证明真实 Windows 输入释放、UIA 兼容性、剪贴板与截图可靠；Fake 通过不等于 M0 验收。
- 指纹只降低重复上报，最终幂等靠 Control Server 唯一键；HMAC 只避免报告泄露文本，不代表控件树稳定。
- 结构报告不能替代人工复核 Pattern 与动态行为；记事本编辑控件可能随版本暴露为 `Document` 或 `Edit`；对抗复核未能启动独立审查代理，仅以定向回归替代。

## 原始条目索引

- `changelog/2026-09-28-python-agent-transport.md` — 失败关闭传输层与双 Agent 跨进程验证完成，实机未验证。
- `changelog/2026-09-28-python-agent-dispatcher.md` — 安全调度层完成：白名单、去重过期、取消、两秒急停释放、日志脱敏。
- `changelog/2026-09-28-python-windows-actions.md` — Windows 基础动作执行器完成，实机 Spike 阻塞。
- `changelog/2026-09-28-windows-notepad-spike.md` — 20 轮记事本 M0 Spike 工具完成，非 Windows 返回 `WINDOWS_REQUIRED`。
- `changelog/2026-09-28-python-wechat-ingress.md` — 微信接入基础层完成，默认不声明 `wechat.read`，真实读取阻塞。
- `changelog/2026-09-28-wechat-uia-inspection.md` — 只读微信 UIA 隐私取证工具完成，真实取证阻塞。
