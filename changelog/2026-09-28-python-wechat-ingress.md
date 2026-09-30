# Python 微信消息接收基础层

## 元信息

- 日期：2026-09-28
- 状态：已完成
- 环境：macOS；Python 3.11、Node.js 24；Windows/微信未验证

## 目标

- 实现不依赖具体微信控件树的消息规范化、隐私标识和稳定消息指纹。
- 为 Python Agent 增加可注入、可取消的消息轮询与 WebSocket 上报循环。
- 保持默认消息源为空，不在未完成 Windows M0 前声明真实微信读取能力。

## 上下文与证据

- 已同步并推送 `origin/main` 的项目 Skill，提交为 `353c760`。
- Python Agent 已具备 WebSocket 发送、断线重连和严格
  `chat.message.received` 协议模型，但尚无主动消息读取循环。
- Control Server 只接受声明 `wechat.read` 能力的 Agent 上报聊天事件，并继续以
  `(source, conversationId, externalMessageId)` 持久化去重。
- 微信可能不暴露稳定消息 ID；风险文档要求使用会话、发送者、规范化文本、时间窗口
  和可见顺序生成指纹。
- 当前无 Windows 微信版本和控件树证据，不实现或猜测 UIA selector。
- 工作区另有两份无关未跟踪 changelog，本任务不修改。

## 分析与决策

- 消息源接口与指纹算法保持跨平台；未来 Windows Adapter 只负责产出受限快照。
- 会话与发送者标识使用带本机密钥的 HMAC-SHA256，不发送原始显示名。
- 消息指纹不包含原文，且使用分钟时间桶和可见顺序降低无稳定 ID 时的碰撞概率。
- 默认空消息源不声明 `wechat.read`，避免在真实 Adapter 接入前虚报能力。
- 发布成功后才登记 Agent 内存去重；网络发送失败停止当前批次并在下轮重试，保持
  至少一次语义和消息顺序。
- 单条编码失败只跳过该条，异常日志只记录异常类型，不记录消息正文或显示名。

## 操作记录

1. 核对 Agent 客户端、服务端事件入口、协议与微信消息去重要求。
   - 结果：成功。
   - 影响：确定跨平台接收基础层边界。
2. 实现微信消息快照、HMAC 标识、稳定指纹和有界去重。
   - 结果：成功；稳定来源 ID 纳入会话维度，无来源 ID 时使用规范化文本、分钟桶和
     可见顺序。
   - 影响：新增 `wechat_ingress.py`。
3. 为 Python Agent 增加可选消息泵和并发安全发送。
   - 结果：成功；消息泵必须与 `wechat.read` 能力同时配置，默认运行入口不启用。
   - 影响：修改 `client.py`。
4. 增加正常、边界、隐私、重试和恢复测试。
   - 结果：成功；Python 测试由 80 项增加至 103 项，覆盖率 93.73%。
5. 完成两轮对抗复核。
   - 结果：成功；修复跨会话 source ID 碰撞、畸形首条阻塞后续消息和无界快照长度。
   - 限制：当前工具约束不允许启动独立审查代理，使用定向回归代替独立交叉审查。
6. 同步协议、测试和开发状态文档。
   - 结果：成功；明确本阶段不代表真实微信 UIA 已接入。
7. 执行全仓质量门并复核跨组件兼容性。
   - 结果：成功；Node 207 项、Python 103 项、C# 58 项测试和双 Agent 集成通过。
   - 影响：现有默认 Agent 未启用消息源，注册、重连和急停路径保持不变。

## 文件变更

- `changelog/2026-09-28-python-wechat-ingress.md`：记录本任务。
- `apps/desktop-agent-python/src/desktop_agent/wechat_ingress.py`：消息快照、隐私标识、
  指纹、去重、编码和轮询发布。
- `apps/desktop-agent-python/src/desktop_agent/client.py`：可选 Agent 事件泵及
  `chat.message.received` 并发发送。
- `apps/desktop-agent-python/tests/test_wechat_ingress.py`、`test_client.py`：消息
  隐私、边界、错误恢复和客户端发送测试。
- `README.md`、`docs/03-contracts-and-data.md`、
  `docs/05-testing-and-acceptance.md`、`docs/08-development-status.md`：同步实现状态。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| Python 定向测试 | PASSED | 103 项通过，覆盖率 93.73%。 |
| `npm run check:python` | PASSED | Ruff、mypy 和 pytest 全部通过。 |
| `npm run check` | PASSED | Node 207、Python 103、C# 58 项测试和双 Agent 集成通过。 |
| Windows 微信 UIA 验证 | BLOCKED | 缺少目标 Windows 微信版本和控件树证据。 |

## 问题与处理

- 现象：首轮质量门中行为测试通过，但 Ruff 和 mypy 失败。
- 根因：新增导入顺序不符合 Ruff，变长指纹 material 被 mypy 推断为固定二元组。
- 处理：按规范排序导入并显式声明 `tuple[str, ...]`。
- 结果：Python 质量门通过。

## 风险与限制

- 指纹只能降低重复上报，最终幂等仍由 Control Server 的数据库唯一键保证。
- 没有真实 UIA Adapter 时，本阶段不能读取微信消息。
- HMAC 密钥的本机安全配置将在真实 Windows 消息源装配时实现，本阶段仅提供注入边界。

## 最终结果

- 微信消息接收的跨平台基础层已完成：隐私标识、稳定指纹、有界去重、错误隔离和
  WebSocket 主动上报均有自动化证据。
- 下一步仍需在目标 Windows 微信版本取证并实现 `WeChatMessageSource`；在此之前
  默认入口不声明 `wechat.read`，不能读取真实微信消息。
