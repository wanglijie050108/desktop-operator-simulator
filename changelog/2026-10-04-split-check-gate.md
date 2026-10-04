# 质量门分层：check 去 .NET 依赖，新增 check:all

## 元信息

- 日期：2026-10-04
- 状态：已完成
- 环境：Windows 11 build 26200；Node.js 24、Python 3.11（uv）；本机只有 .NET SDK 8.0.101/8.0.206

## 目标

- 在不删除任何 .NET/C# 步骤的前提下，让日常质量门 `npm run check` 不再依赖 .NET 10 SDK：
  - `npm run check` = Node + Python 质量门 + Python Agent 集成回归；
  - 新增 `npm run check:all` = 原 `npm run check` 的**完整步骤**（追加 `check:dotnet` 与
    C# Agent 集成回归）；
  - `check:dotnet`、`test:integration:m1`、`test:integration:m1:csharp`、`test:stability:m1`、
    CI 的 `dotnet` job 全部保持不变。

## 上下文与证据

- 现状缺陷：原 `check` 有两条 .NET 依赖路径——`check:dotnet` 与 `test:integration:m1`
  （内部为 `m1:csharp && m1:python`）。本机缺 .NET 10 SDK，导致整条 `check` 失败；
  而 `docs/12` 答辩脚本第 1 步就是"跑一次 `npm run check` 确认全部通过"。
- CI 不调用 `npm run check`：`.github/workflows/ci.yml` 是 node/python/dotnet 三个独立 job，
  dotnet job 内执行 `dotnet restore/format/build/test` 与 `npm run test:integration:m1`。
  因此分层本地门不会降低 CI 覆盖。
- 项目全部 `net10.0`（`apps/desktop-agent/src/*.csproj`），`global.json` 钉 `10.0.401`，
  SDK 8 无法构建，故无法用"降级 SDK"绕过。
- 方案对比（详见对话分析）：A 拆分入口 / B 探测后显式跳过（需新增脚本并接 eslint globals，
  且与"C# 是否删除"未决相冲突）/ C 引导安装 SDK（仅修单机）。选择 **A**。

## 分析与决策

- `check:all` 逐条等于原 `check`，因此"能力不减"可直接对照脚本验证，无需依赖测试结论。
- 不引入新脚本、不改 eslint/prettier 配置、不改 CI，避免为一次即将随 C# 去留变化的临时
  需求增加长期维护面。
- 文档同步说明两条入口的差别与 .NET 的适用范围，避免有人误以为 C# 回归被取消。

## 操作记录

1. `package.json`：`check` 改为 node + python + `test:integration:m1:python`；新增
   `check:all` 为原完整链路。
   - 结果：成功。
2. 文档同步：`README.md`、`docs/07`（M1 骨架验证）、`docs/09`（必需运行时表 + 验证安装表）、
   `docs/11`（测试分层与统一入口）、`docs/12`（答辩前环境检查）。
   - 结果：成功。
3. `docs/08`：记录质量门分层，并在"当前限制"说明 `check` 不覆盖 C# 回归、该回归由
   `check:all` 与 CI 负责。
   - 结果：成功。
4. 验证本机 `npm run check` 与 `npm run check:all` 的实际行为。
   - 结果：见"验证"。

## 文件变更

- `package.json`：`check`、新增 `check:all`（其余脚本未改）。
- `README.md`：本地开发章节说明两条入口。
- `docs/07-windows-test-environment.md`：M1 骨架验证命令与说明。
- `docs/09-installation-guide.md`：.NET SDK 适用范围与验证安装表新增一行。
- `docs/11-design-overview.md`：统一入口说明。
- `docs/12-demo-script.md`：答辩前环境检查项。
- `docs/08-development-status.md`：M1 已完成项与当前限制。
- `changelog/2026-10-04-split-check-gate.md`：本记录。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `npm run check`（本机无 .NET 10 SDK） | PASSED | Node 门 → Python 门（191 passed / 2 skipped，覆盖率 91.66%）→ Python Agent 集成回归 `result: passed`，退出码 0 |
| `npm run check:dotnet` | BLOCKED | `A compatible .NET SDK was not found. Requested SDK version: 10.0.401`，退出码非 0，证明 .NET 要求未被削弱 |
| `npm run test:integration:m1:csharp` | BLOCKED | 仍启动 C# Agent（`dotnet run`），失败原因仍是缺 SDK（本次会话稍早验证） |
| `npm run check:all` 组成核对 | PASSED | `check:node && check:python && check:dotnet && test:integration:m1`，逐条等于原 `check` |
| `test:integration:m1` 未改动 | PASSED | 仍为 `m1:csharp && m1:python` |
| 仓库清洁（pytest 临时目录） | PASSED | 已删除 `apps/desktop-agent-python/pytest-of-HP/`，工作区无临时产物 |
| CI 配置 | NOT_EXECUTED | 未改动 `.github/workflows/ci.yml`；CI 本就不调用 `npm run check` |

## 问题与处理

- 现象：无回归。`check:dotnet` 的失败是本机环境缺失（与改动前一致）。
  - 根因：本机未安装 .NET 10 SDK，且项目目标为 `net10.0`。
  - 处理：按方案 A 让日常门不再依赖它，同时把完整门保留为 `check:all`；CI job 未动。
  - 结果：日常门在本机可用，完整门仍强制 .NET。

## 风险与限制

- 本地日常门不再覆盖 C# 单测与 C# 进程集成回归；该覆盖由 `check:all`（需 SDK）与 CI
  的 `dotnet` job（每个 PR）承担。
- 若后续决定删除 C# 源码，`check:all`、`check:dotnet`、`m1:csharp`、CI `dotnet` job、
  `.slnx`、`global.json` 需一并处理；本次未触碰其中任何一项。

## 最终结果

- 已完成：质量门分层落地，本机 `npm run check` 全绿；`check:all` 保留原完整链路；
  文档与状态同步。
- 未完成：C# 编译/测试仍需 CI 或安装 .NET 10 SDK；C# 源码去留待下一个议题决策。
