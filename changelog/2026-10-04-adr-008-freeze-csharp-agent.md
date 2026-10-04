# ADR-008：C# Agent 冻结保留（收口 ADR-007 开放项）

## 元信息

- 日期：2026-10-04
- 状态：已完成
- 环境：Windows 11 build 26200；仅文档与决策记录改动，未运行构建或测试

## 目标

- 按用户口径"能用 pywinauto 就行、且不破坏原有能力"，收口 `docs/06` ADR-007 第 41 条
  "是否删除 C# 源码另行决策"这个悬置项：
  - 明确 Windows 桌面自动化的唯一实现方向是 Python 3.11 + pywinauto；
  - 明确 C# Agent 冻结保留（不删除、不发展、不加回日常质量门）；
  - 在代码目录层面留下约束，避免后续（人或 AI）误在 C# 侧继续开发。

## 上下文与证据

- 方案对比（用户已确认选择"冻结保留"）：完全删除会移除跨语言契约证据与可执行回退基线，
  属于净损失；"半删"（只留契约、删运行时）需同步改 csproj/CI/契约测试与多处文档，风险更大
  而收益仅为缩短 CI；冻结保留的维护成本已被隔离（C# 不参与业务路径，也不参与
  `npm run check`）。
- 现状事实：`npm run check` 已不依赖 .NET SDK（见
  `changelog/2026-10-04-split-check-gate.md`）；C# 的覆盖由 CI `dotnet` job 与
  `npm run check:all` 承担；`apps/desktop-agent` 原无 README。
- 守卫 §3 已写明"不在 C# Agent 中新增 Windows 自动化、FlaUI 不在计划内"，本 ADR 与之同向。

## 分析与决策

- 采用"冻结保留"：C# 作为跨语言契约夹具消费方与回退基线继续存在，但不承载任何新需求。
- 用 ADR-008 显式记录决策与**复查触发条件**（M2/M3 实机验收完成后，若确认不再需要回退或
  契约证据，可在独立任务中评估删除），避免"顺便删"造成的隐性能力损失。
- 在 `apps/desktop-agent/README.md` 加目录级约束：比强制守卫更靠近代码，能直接拦截误改。
- 未触碰任何 C# 源码、csproj、`.slnx`、`Directory.Build.props`、`global.json`、
  `check:dotnet`/`check:all`、CI job、共享 fixture 与其测试。

## 操作记录

1. `docs/06` 新增 ADR-008（决策、禁止项、保留理由、复查触发条件、与守卫的一致性）。
   - 结果：成功。
2. 新增 `apps/desktop-agent/README.md`：说明本目录不是实现方向、禁止事项、仍保留的用途
   （跨语言契约对齐与 M1 回退集成测试）与运行位置（CI `dotnet` job、`npm run check:all`）。
   - 结果：成功。
3. `docs/08`：在"设计与工程约束"新增实现方向收口条目；在"当前限制"补充 C# 冻结保留与
   日常门不覆盖 C# 的说明。
   - 结果：成功。
4. 文档自查并同步三处权威表述：`docs/02`（组件边界段落改为引用 ADR-008）、`docs/04`
   （开发策略段落由"迁移验收完成前保留"改为 ADR-008 冻结口径）、`docs/11`（设计说明中的
   C# 定位）。
   - 结果：成功。顺带把 `docs/02` 中"**M0 完成前**，未实现动作必须返回 `NOT_IMPLEMENTED`"
   的时限限定去掉：C# 占位执行器已冻结为永久返回 `NOT_IMPLEMENTED`，该安全不变量不应再带
   时限（仅收紧，不放宽）。

## 文件变更

- `docs/06-decisions-and-risks.md`：新增 ADR-008。
- `apps/desktop-agent/README.md`：新增（冻结基线的目录级约束）。
- `docs/08-development-status.md`：实现方向收口条目 + 当前限制补充。
- `docs/02-system-architecture.md`：组件边界段落引用 ADR-008；`NOT_IMPLEMENTED` 规则去掉时限。
- `docs/04-implementation-plan.md`：开发策略段落改为 ADR-008 冻结口径。
- `docs/11-design-overview.md`：C# 定位改为 ADR-008 口径。
- `changelog/2026-10-04-adr-008-freeze-csharp-agent.md`：本记录。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| 改动范围核对（`git diff --stat`） | PASSED | 仅 4 个文档 + 1 个新增 README + 本记录，无代码/配置/CI 改动 |
| `docs/06` ADR-008 与守卫 §3 一致性 | PASSED | 均禁止在 C# 侧新增 Windows 自动化、FlaUI 不在计划内 |
| `npm run check` 是否受影响 | NOT_EXECUTED | 本次未改脚本或代码；新 README 为 `.md`，不在 prettier/eslint 覆盖范围内 |
| C# 编译/测试 | BLOCKED | 本机无 .NET 10 SDK（与本决策无关；覆盖由 CI `dotnet` job 承担） |

## 问题与处理

- 现象：无失败。唯一需要说明的是 `docs/02` 顺带收紧了 `NOT_IMPLEMENTED` 的时限限定。
  - 根因：原句假定 M0 之后所有动作都会实现；C# 冻结后该假定不再成立。
  - 处理：改为无条件要求失败关闭，并在本记录中显式说明（仅收紧）。
  - 结果：与 C# 占位执行器注释、守卫"不得对未执行的操作报告成功"一致。

## 风险与限制

- 决策依赖"C# 回退与跨语言契约证据仍有价值"这一判断；若导师明确要求仓库只保留一套技术栈，
  需按 ADR-008 的复查触发条件另起任务删除，并同步本文列出的全部耦合点。
- 冻结不等于验证：C# 的编译与测试仍只由 CI（或装有 .NET 10 SDK 的机器）确认。

## 最终结果

- 已完成：ADR-008 落地，C# 定位在决策文档、架构文档、设计说明、开发状态与代码目录五个层面
  统一为"冻结保留、不发展"；未删除或削弱任何现有能力。
- 未完成：实机鼠标 Spike（用户自行运行）与 M1 两小时稳定性测试等既有实机项，与本决策无关。
