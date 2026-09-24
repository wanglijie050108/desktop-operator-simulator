# 真实 Windows 环境接入路线分析

## 元信息

- 日期：2026-09-24
- 状态：已完成
- 环境：macOS（分析侧）；目标环境为 Windows 11 + 微信 + AI 页面 + 购物站点
- 分支：`main`

## 目标

- 用户获得真实 Windows 环境后，明确按什么顺序开发、每个适配器落在什么代码位置、
  以及每个阶段的验证方法和量化退出标准。

## 上下文与证据

- 已阅读守卫 Skill、docs 04/05/07/08、README 及 M3 交付记录。
- 已核对代码边界：
  - C# `IDesktopActionExecutor`（Core 跨平台）当前由 `PlaceholderDesktopActionExecutor`
    失败关闭实现；`DesktopAction` 枚举已定义六个动作
    （WECHAT_READ_NEW_MESSAGES、WECHAT_SEND_TEXT、WINDOW_ACTIVATE、
    TAKE_SCREENSHOT、CLIPBOARD_SET_TEXT、INPUT_KEY_CHORD）。
  - 计划中的 `DesktopAgent.Windows` 项目尚不存在；`Program.cs` Capabilities 为空。
  - Node 侧三个适配器接口均失败关闭：`AiQuestionAdapter`、`ChatReplyAdapter`、
    `ProductSearchAdapter`（open/search/extract 三阶段）。
  - `AgentGateway.sendCommand(agentId, DesktopCommand)` 已存在并持久化命令，
    可支撑"聊天回复命令桥"和"服务端轮询读消息"。
  - `config.ts`/`server.ts` 尚无适配器实现选择开关，需扩展。

## 分析与决策

- 微信唯一可操作入口在 Windows 侧（UIA），Node 不得直接实现微信逻辑：
  ChatReplyAdapter 的真实实现应为 WS 命令桥，将 send() 翻译为
  WECHAT_SEND_TEXT 桌面命令并等待 desktop.command.result。
- 新消息读取建议由服务端定时下发 WECHAT_READ_NEW_MESSAGES（而非 Agent 自发轮询），
  保持服务端为事实源、复用单 Agent 串行执行与命令去重；Agent 读取后回发
  chat.message.received。
- 开发顺序遵循依赖：环境基线 → M0 Spike（硬门槛）→ Windows 基础执行器 →
  微信读写 → 回复桥 → Playwright AI 适配器 → Playwright 商品适配器 →
  真实指标验收。
- 真实 E2E 不进入公共 CI；Fake 套件（npm run check）必须始终保持绿色，
  真实套件使用独立脚本和专用账号。

## 操作记录

1. 提交 CI 失败排查与进展概览两个历史 changelog。
   - 结果：成功，提交 `a5e07a9`。
2. 核对 C#/Node 适配器接口与命令下发能力。
   - 结果：成功。

## 文件变更

- `changelog/2026-09-24-real-environment-roadmap.md`：新增本路线分析。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git commit`（历史记录） | PASSED | `a5e07a9` 已创建，未 push。 |
| 代码边界静态核对 | PASSED | 六个桌面动作、三个适配器接口、sendCommand 能力均已确认。 |
| Windows 实机验证 | NOT_EXECUTED | 目标环境尚未提供。 |

## 问题与处理

无。

## 风险与限制

- 路线中轮询机制（服务端下发读消息命令）为架构建议，实施时需与 docs 02/03 核对，
  若采用需同步契约文档。
- Spike 结论（选择器、版本、风控频率）可能反向调整工作流步骤设计。

## 最终结果

- 已向用户输出四阶段路线：环境基线、M0 Spike、六个适配器工作包（含具体文件位置）、
  量化验证与验收场景，并给出建议分支与文档同步要求。
