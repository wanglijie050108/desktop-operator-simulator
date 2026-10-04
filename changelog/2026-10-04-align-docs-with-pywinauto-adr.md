# 按 ADR-007 口径统一 skill 与过时描述

## 元信息

- 日期：2026-10-04
- 状态：进行中
- 环境：Windows 11 build 26200；Node.js 24 / Python 3.11（uv）；本机无 .NET 10 SDK

## 目标

- 按"Windows 桌面自动化由 Python 3.11 + pywinauto 方案替代 C# 方案"（`docs/06` ADR-007）
  修正审计发现过时描述，且**不删除或削弱任何现有能力**：
  - 保留 C# Agent 作为迁移期参考与回退基线（含契约、CI 回归、共享 fixture）；
  - 不删除 `check:dotnet`、`test:integration:m1:csharp`、`.slnx`、`global.json` 或 CI dotnet job；
  - 只改描述性文本与一个未被任何脚本依赖的默认值。

## 上下文与证据

- 审计结论见 `changelog/2026-10-04-outdated-csharp-descriptions-audit.md`：9 处过时
  （skill 6 处、Python 包 README 1 处、C# 占位注释 2 条、集成脚本默认值 1 处）。
- 权威决策：`docs/06` ADR-007（Python 为目标实现；C# 保留为参考与回退；是否删除 C# 源码
  另行决策）。`docs/02`/`04`/`05`/`07`/`08`/`09`/`11` 与 `README.md` 已是一致口径。
- 依赖核对：`package.json` 的 `test:integration:m1:csharp`（显式 `--agent=csharp`）、
  `test:integration:m1:python`、`test:stability:m1` 均显式传入 `--agent`，CI 只调用
  `npm run test:integration:m1`，因此改动 `m1-agent-reconnect.mjs` 的默认值不影响任何现有入口。

## 分析与决策

- skill 是强制守卫：§3 固定架构改为 Python 3.11 + pywinauto，并明确 C# 仅作迁移期参考/回退、
  不在其中新增 Windows 自动化；§5/§6 的 FlaUI、.NET 表述同步为 pywinauto/Python 口径，
  同时**保留**"迁移期 C# 契约回归"这条要求，避免削弱既有回归能力。
- 不改动任何执行路径、策略、契约结构或测试断言；C# 占位执行器只改注释，`NOT_IMPLEMENTED`
  行为不变。
- 集成脚本默认 `--agent` 由 `csharp` 改为 `python`（与目标实现一致）；显式传参与既有脚本行为
  完全不变。
- CI 与质量门口径（`check:dotnet` 强依赖 .NET 10 SDK、是否删除 C# 源码）仍属待决策项，
  本次不动，只保留在审计记录中。

## 操作记录

1. 建立本记录，确认改动边界（只改描述与一个无调用方依赖的默认值）。
   - 结果：成功。
2. 修改强制守卫 `.trae/skills/human-operation-simulator-guardrails/SKILL.md` 6 处：
   §3 固定架构（第 54 行）改为 Python 3.11 + pywinauto 并声明 C# 仅作迁移期参考/回退、
   不新增 Windows 自动化；§3 隔离规则（FlaUI → pywinauto/UIA）；§5 语言要求补 mypy-strict
   Python；§6 契约测试改为 Node/Python 为主并保留 C# 契约回归；§6 真实 Windows 冒烟
   与跨平台构建条目由 FlaUI/.NET 改为 pywinauto/Python。
   - 结果：成功；复查后全文仅剩"迁移期保留 C#"表述，无 FlaUI 计划性描述。
3. 更新 `apps/desktop-agent-python/README.md`：删除"尚未执行任何 Windows 桌面动作"的过时
   表述，改为列出已实现的窗口激活/前台复核/按键/剪贴板/截图/微信收发/鼠标动作，并说明坐标
   兜底默认关闭的条件。
   - 结果：成功。
4. 更新 `PlaceholderDesktopActionExecutor.cs` 两条注释：说明本类为保留的参考/回退基线、
   FlaUI 工作不在计划内、急停输入释放由 Python 执行器负责；**代码行为不变**
   （仍 `NOT_IMPLEMENTED`）。
   - 结果：成功（仅注释，无逻辑改动）。
5. `tests/integration/m1-agent-reconnect.mjs` 默认 `--agent` 由 `csharp` 改为 `python`；
   显式 `--agent=csharp|python` 与既有 npm 脚本行为不变。
   - 结果：成功。
6. 在 `docs/06` ADR-007 追加一行，记录强制守卫已同步，防止再次漂移。
   - 结果：成功。

## 文件变更

- `.trae/skills/human-operation-simulator-guardrails/SKILL.md`：§3/§5/§6 共 6 处改为
  Python/pywinauto 口径（保留 C# 契约回归要求）。
- `apps/desktop-agent-python/README.md`：能力描述更新为当前事实。
- `apps/desktop-agent/src/DesktopAgent/PlaceholderDesktopActionExecutor.cs`：两条注释更新，
  代码不变。
- `tests/integration/m1-agent-reconnect.mjs`：默认 `--agent` 改为 `python`。
- `docs/06-decisions-and-risks.md`：ADR-007 追加守卫同步记录。
- `changelog/2026-10-04-outdated-csharp-descriptions-audit.md`：标注后续任务。
- `changelog/2026-10-04-align-docs-with-pywinauto-adr.md`：本记录。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `npm run check:node` | PASSED | 格式（含改动后的 `tests/**/*.mjs`）、lint、类型、单测、构建全部通过 |
| `npm run test:integration:m1:python` | PASSED | 显式 python 路径：注册、重启重连、急停全流程 `result: passed` |
| 裸调用 `node tests/integration/m1-agent-reconnect.mjs`（新默认值） | PASSED | `agentKind: python`，`result: passed` |
| `node tests/integration/m1-agent-reconnect.mjs --agent=bogus` | PASSED | 仍以 `--agent must be csharp or python` 拒绝，参数校验未被削弱 |
| `npm run test:integration:m1:csharp` | BLOCKED | 仍走到 C# Agent（`dotnet`），失败原因仍是本机缺 .NET 10 SDK（`A compatible .NET SDK was not found`），非本次改动引入 |
| `npm run check:python` | PASSED | 未改动 Python 代码；回归确认 191 passed / 2 skipped，覆盖率 91.66% |
| `npm run check:dotnet` | BLOCKED | 本机仅有 .NET SDK 8.0.x，`global.json` 要求 10.0.401；C# 仅注释改动，未编译验证 |

## 问题与处理

- 现象：无回归；唯一"失败"是 `test:integration:m1:csharp` 因本机缺 .NET 10 SDK 而无法运行。
  - 根因：环境缺失（与改动前一致）。
  - 处理：不改动 CI 与 `check:dotnet` 口径（用户要求不得破坏原有能力），仅记录为 BLOCKED。
  - 结果：C# 回归路径代码与脚本均保持不变，显式传参仍可选中 C# Agent。

## 风险与限制

- C# 注释改动未经编译（缺 .NET 10 SDK），但改动仅为 `//` 注释，无语法或行为影响；
  仍需 CI `windows-latest` job 确认 `dotnet format --verify-no-changes`。
- 修改强制守卫会改变后续所有任务的规则；本次严格对齐 `docs/06` ADR-007，且保留
  C# 契约回归与回退能力，未删除任何脚本、CI job 或源码。
- 仍待决策（未改动）：`npm run check` 强依赖 `check:dotnet` 的口径，以及是否按 ADR-007
  第 41 条最终删除 C# 源码。

## 最终结果

- 已完成：9 处过时描述全部按 ADR-007 口径修正（skill 6 处、Python 包 README 1 处、
  C# 占位注释 2 处、集成脚本默认值 1 处），并在 ADR-007 中留下同步记录。
- 能力保持验证：Node 质量门通过；Python 质量门通过；M1 集成测试在新的默认值下通过，
  显式 `--agent=csharp` 仍可选中 C# Agent；未删除或放宽任何策略、契约、测试或 CI 条目。
- 未完成：`check:dotnet` 与 C# 实机/编译验证仍受限于本机缺 .NET 10 SDK；CI 与
  C# 源码去留两项口径待决。
