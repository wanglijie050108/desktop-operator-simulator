# 审计：仓库持久化 skill 与技术方案中过时的 C#/FlaUI 描述

## 元信息

- 日期：2026-10-04
- 状态：已完成（只读审计）
- 环境：Windows 11 build 26200；仅文本检索与阅读，未运行构建或测试

## 目标

- 以"Windows 桌面自动化由 Python 3.11 + pywinauto 方案替代 C# 方案"（`docs/06` ADR-007）
  为当前要求，检查仓库内持久化 skill 与技术文档中是否仍有过时描述，并给出逐条位置与结论。

## 上下文与证据

- 权威要求：`docs/06-decisions-and-risks.md` ADR-007（第 31–44 行）——`apps/desktop-agent-python`
  是目标实现；C# Agent 在 Python 达到协议、安全与 Windows 实机验收等价前保留为参考与回退；
  Python 迁移通过后停止默认运行 C#；是否删除 C# 源码另行决策。
- 已标注被替代：ADR-001（第 5–15 行）与 ADR-003（第 23–29 行）均已写明"已被 ADR-007 替代"。
- 检索范围：仓库内 279 个 `*.md/*.yaml/*.yml/*.json/*.mjs/*.ts/*.cs/*.py` 文件，
  排除 `node_modules`、`.venv`、`dist`、`coverage`、`bin`、`obj`、`data` 与 `changelog`
  （历史记录按规范保留）。检索关键词：`FlaUI`、`C#`、`csharp`、`.NET`、`dotnet`。
- 持久化 skill 只有一个：`.trae/skills/human-operation-simulator-guardrails/SKILL.md`；
  `AGENTS.md` 与 `CLAUDE.md` 仅要求读取该 skill，本身不含技术栈表述。会话级 skill
  （office-*、vc）与仓库技术栈无关。

## 分析与决策

判定标准：描述"当前固定架构或当前事实"且与 pywinauto 方案矛盾 => 过时；
描述"迁移期保留 C# 作为参考/回退基线" => 与 ADR-007 一致，不过时。

过时项（9 处）：

1. `SKILL.md:54` “The Windows Desktop Agent uses C# 14 and .NET 10.” —— §3 是每个任务都必须
   遵守的固定架构，仍把 C#/.NET 写成 Agent 实现语言，与 ADR-007 直接冲突（也是本次鼠标实现
   需要额外解释"C# 只做契约对齐"的根因）。
2. `SKILL.md:72` 把 `FlaUI` 列为必须隔离在 Windows 项目中的技术。
3. `SKILL.md:105` “Use strict TypeScript and nullable-aware C#.” —— 未提 Python（当前 Agent
   语言）的 mypy strict 要求。
4. `SKILL.md:217` “Contract tests proving Node and C# agree …” —— 应为 Node/Python 为主、
   迁移期保留 C#。
5. `SKILL.md:222` “Real Windows smoke/E2E tests for FlaUI …”。
6. `SKILL.md:231` 与 `SKILL.md:233` “cross-platform .NET code” / “Real FlaUI, WeChat, …”。
7. `apps/desktop-agent-python/README.md:3-6` “This package is the staged replacement … It does
   not perform Windows desktop actions yet.” —— 与事实不符：窗口激活、前台复核、按键组合、
   剪贴板读写、截图、鼠标动作均已实现，且基础部分已有 20/20 实机证据。
8. `apps/desktop-agent/src/DesktopAgent/PlaceholderDesktopActionExecutor.cs:15` 注释
   “Each action must use FlaUI/UIA …” —— 该类已定为保留的占位/回退基线，按 ADR-007 不再开发
   FlaUI 执行器；该注释会误导后续实现者。
9. `tests/integration/m1-agent-reconnect.mjs:15` `agentKind` 默认 `"csharp"` —— 目标实现已是
   Python，默认值仍指向 C#。

需用户拍板（口径问题，不是"描述过时"）：

- `package.json:17-18` 与 `.github/workflows/ci.yml:66-102`：`npm run check` 强依赖
  `check:dotnet`，缺 .NET 10 SDK 时整条质量门失败（本次已实际遇到）。
- `docs/06` ADR-007:41 "是否删除 C# 源码另行决策"尚未决策；`docs/07:81`、`docs/09:30`
  仍要求安装 .NET SDK 10（标注"迁移期"）。

已一致、无需修改：`docs/01`、`docs/02:65-78`、`docs/03:90`、`docs/04:11-14`、`docs/05:18/32/98`、
`docs/06` ADR-001/ADR-003 的替代标注、`docs/07:10/106/215-216/224`、`docs/08`（多处）、
`docs/09`、`docs/10`、`docs/11:28/128-132/141`、`docs/12`、`README.md`、`AGENTS.md`、
`CLAUDE.md`、`changelog/` 历史条目（历史记录按规范保留）。

## 操作记录

1. 定位仓库内持久化 skill 与 agent 指令文件。
   - 结果：`.trae/skills/human-operation-simulator-guardrails/SKILL.md`（唯一 skill）、
     `AGENTS.md`、以及仅引用 `AGENTS.md` 的 `CLAUDE.md`。
2. 全仓检索 `FlaUI` / `C#` / `csharp` / `.NET` / `dotnet`（排除依赖与历史记录目录）。
   - 结果：命中 60 余处，逐条判定为"过时 / 一致 / 历史记录"。
3. 核对权威决策与受影响文档原文（`docs/02`、`docs/04`、`docs/06`、`docs/11`、`README.md`、
   `apps/desktop-agent-python/README.md`）。
   - 结果：确认文档主体已迁移为 pywinauto 口径，过时项集中在 skill 与两处代码/脚本，以及
     质量门口径。
4. 未修改任何文件（本次为只读审计）。

## 文件变更

- `changelog/2026-10-04-outdated-csharp-descriptions-audit.md`：本记录。
- 未改动 skill、文档、代码或配置。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `.trae` 目录枚举 | PASSED | 仅 1 个 skill 文件 |
| 全仓 `FlaUI` / `C#` / `.NET` / `dotnet` 检索 | PASSED | 命中集合已逐条归类，见"分析与决策" |
| `docs/06` ADR 替代标注核对 | PASSED | ADR-001、ADR-003 均已标注被 ADR-007 替代 |
| `docs/11` 技术栈表核对 | PASSED | Desktop Agent 一行已是"Python 3.11、pywinauto" |
| 构建 / 测试 / 实机验证 | NOT_EXECUTED | 本次为只读文本审计 |

## 问题与处理

- 现象：仓库固定架构（skill §3）与实际目标实现（ADR-007 的 Python/pywinauto）不一致。
  - 根因：ADR-007 迁移时更新了 `docs/02`、`docs/04`、`docs/11`、`README.md`，但未同步
    `.trae/skills` 中的固定架构与测试矩阵条目。
  - 处理：本次只记录；修改 skill 会改变后续所有任务的强制规则，需用户确认后再改。
  - 结果：待用户确认。

## 风险与限制

- 本审计仅做文本检索与阅读，未验证代码行为；结论以文件当前内容为准。
- `SKILL.md` 是强制守卫，修改它等于改变规则本身，必须与 `docs/06` ADR 保持同向，并同步
  changelog 与 `docs/08`。
- 若后续决定停用 C# 回归基线，还需同步 CI（`.github/workflows/ci.yml`）、`package.json`
  脚本、`tests/integration/*`、`global.json`、`.slnx` 与 `docs/07`/`docs/09` 的安装要求。

## 最终结果

- 已完成：给出 9 处过时描述（skill 6 处、Python 包 README 1 处、C# 占位注释 1 处、
  集成脚本默认值 1 处）与 3 项待拍板口径，并明确列出已一致的文档，避免误改。
- 未完成：尚未修改任何文件；等待用户确认是否按 ADR-007 口径统一 skill 与上述 3 处。
- 后续：用户确认后已在 `changelog/2026-10-04-align-docs-with-pywinauto-adr.md` 中完成
  9 处描述的修改；本次审计结论即为该任务的输入。
