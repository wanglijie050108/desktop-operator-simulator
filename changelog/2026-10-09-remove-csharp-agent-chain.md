# 移除 C# Desktop Agent 链路

## 元信息

- 日期：2026-10-09
- 状态：已完成
- 环境：未确认（本环境未安装 Node/Python 依赖，未执行质量门）

## 目标

- 将此前“冻结保留”的 C# Desktop Agent 链路（ADR-008）改为确定移除（ADR-009），仅保留 Python pywinauto 实现。
- 先统一全部文档与构建/CI 口径，再删除 C# 代码与工程文件。

## 上下文与证据

- `docs/06-decisions-and-risks.md`：ADR-007 引入 Python 替代 C#；ADR-008 冻结保留；现以 ADR-009 撤销 ADR-008 并决定移除。
- 全仓库 grep 显示 C# 引用散布于 docs、README、CI、package.json、集成测试与 AI 守卫 skill。

## 分析与决策

- 决策反转：C# 长期不参与业务路径与默认运行；pywinauto 路线已达协议、安全与基础动作验收等价，继续保留无净收益。
- 顺序：先改文档口径，再删代码，避免中途出现“已删代码但文档仍称保留”的不一致。

## 操作记录

1. 文档口径统一：docs 多文件、根 README、guardrails skill、Python Agent README、脱敏注释中的“C# 冻结保留/迁移期/回退基线”改为“已移除（ADR-009）”；历史 .NET 成就加注已移除；`Node/C#` 共用改为 `Node/Python`；`docs/06` 新增 ADR-009 并撤销 ADR-008。
2. 删除 C# 资产：`git rm` 删除 `apps/desktop-agent/**`、`HumanOperationSimulator.slnx`、`Directory.Build.props`、`global.json`。
3. 构建/CI 清理：`.github/workflows/ci.yml` 的 `dotnet` job 改造为仅跑 Python 集成的 `integration` job，移除全部纯 .NET 步骤；`package.json` 删除 `check:dotnet` 与 `test:integration:m1:csharp`，`check:all`/`format`/集成测试仅覆盖 Node+Python；`tests/integration/m1-agent-reconnect.mjs` 移除 csharp 分支。

## 文件变更

- 口径改为“已移除”：`docs/02,03,04,05,07,08,09,11,12,13`、根 `README.md`、`.trae/skills/.../guardrails/SKILL.md`、`apps/desktop-agent-python/README.md`、`apps/control-server/src/domain/redaction.ts`。
- 删除：`apps/desktop-agent/**`、`HumanOperationSimulator.slnx`、`Directory.Build.props`、`global.json`。
- 移除 .NET 步骤与 C# 集成脚本：`.github/workflows/ci.yml`、`package.json`、`tests/integration/m1-agent-reconnect.mjs`。
- `docs/06-decisions-and-risks.md`：新增 ADR-009，ADR-008 标记已撤销。
- 本提交同时纳入工作区此前未提交的若干改动（指令兜底通知模块 `command-notice`、微信 UIA 暴露核对、架构契合分析文档 `docs/13` 与对应 changelog、若干文档修订）。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `node -e JSON.parse(require('./package.json'))` | PASSED | 合法 JSON |
| 全仓库 grep `DesktopAgent.Core`/`desktop-agent/src`/`dotnet` | PASSED | 仅 changelog 历史快照与“已移除”表述残留，无指向已删代码的引用 |
| `npm run check` 与 CI | NOT_EXECUTED | 本环境未安装 Node/Python 依赖且无网络，未执行质量门与 CI；改动为文档与配置，已做结构化核查 |

## 问题与处理

- 无。

## 风险与限制

- 未在真实环境执行 `npm run check` 与 CI；CI yaml 改动仅做了缩进/结构核查，未实跑。
- `changelog/` 中的 `dotnet` 版本记录为历史环境快照，按规范保留。

## 最终结果

- C# 链路已从文档、代码、工程文件、构建与 CI 中整体移除，口径统一为“仅保留 Python pywinauto”。
