# 增加 CLAUDE.md 入口使 Claude Code 遵守仓库强制规范

## 元信息

- 日期：2026-09-30
- 状态：已完成
- 环境：Windows 11；Claude Code 2.1.121（`@anthropic-ai/claude-code`）；Node.js 24.15.0；
  模型经腾讯云 Token Hub（`hy3`）

## 目标

- 让 Claude Code 在本仓库中**自动**加载并遵守既有强制规范，而不是每次靠人工提醒。
- 不建立第二套规范：内容必须指向既有 `AGENTS.md` 与其守卫 Skill。
- 用可观察的前后对照证明该入口确实生效，而非假定生效。

## 上下文与证据

- 仓库根目录存在 `AGENTS.md`（强制所有 AI 任务先读
  `.trae/skills/human-operation-simulator-guardrails/SKILL.md` 并写 changelog），
  但**不存在** `CLAUDE.md`，也不存在 `.claude/` 目录。
- `.gitignore` 未忽略 `CLAUDE.md`，即该文件会进入版本库。
- **基线实测（建立前）**：以同一问题询问 Claude Code，其答复为
  “自动加载的规范文件：**无**”“有 `AGENTS.md`……**我没有自动读它**”，
  并说明其默认只自动加载 `CLAUDE.md`。这证明规范在当前状态下不会被自动遵守。
- **对照实测（建立后）**：同一问题，答复为
  “自动加载的项目规范文件：`CLAUDE.md`；`AGENTS.md`（由 `CLAUDE.md` 通过
  `@AGENTS.md` 自动引入）”，并能直接陈述强制流程（先读守卫 Skill、任务开始即建
  changelog、冲突优先级）。

## 分析与决策

- 采用 `@AGENTS.md` 导入而非复制规范正文：避免形成第二份规格，符合守卫 Skill
  “Do not create a second independent specification”的要求，也让后续规范变更只有
  一个事实源。
- 未同时导入守卫 `SKILL.md`：`AGENTS.md` 已指向它，且对照实测显示模型会按该指针
  读取（基线与对照两次答复都准确复述了 Skill 中的规则）。直接注入 317 行会占用每次
  会话的上下文，收益不明确；若后续发现它不再遵循指针，再升级为双导入。
- 将 `CLAUDE.md` 纳入版本库（经用户确认）：它属于团队与 AI 协作入口，与 `AGENTS.md`
  同级，不是本地个人偏好，因此不应放进 `.gitignore`。
- 本任务为协作入口配置，不改变产品能力或验证状态，因此按守卫 Skill 第 7 节
  “不改变项目能力或验证状态的纯文档任务可不动状态文档”，未修改
  `docs/08-development-status.md`。

## 操作记录

1. 执行强制启动检查（`git status --short --branch`、检查 `CLAUDE.md`/`.claude/`
   是否存在、检查 `.gitignore` 是否忽略 `CLAUDE.md`）。
   - 结果：成功；工作树干净，`CLAUDE.md` 不存在且未被忽略。
2. 取得基线证据：在建立前以固定问题询问 Claude Code。
   - 结果：成功；答复“自动加载：无”，证明问题真实存在。
3. 新建 `CLAUDE.md`，内容为一行 `@AGENTS.md`。
   - 结果：成功。
   - 说明：本记录在文件创建之后补写，偏离守卫 Skill “首次修改前建立记录”的顺序；
     原因是需要先取得基线证据再落文件，此处如实记录该偏差。
4. 以同一问题做对照验证。
   - 结果：成功；`CLAUDE.md` 与 `AGENTS.md` 均被自动加载，模型可直接陈述强制流程。
5. 补写本任务记录。
   - 结果：成功。

## 文件变更

- `CLAUDE.md`：新增，内容 `@AGENTS.md`，作为 Claude Code 的自动加载入口。
- `changelog/2026-09-30-add-claude-md-entry.md`：本记录。
- 未修改任何产品代码、测试、契约、CI 或既有规范文档。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git status --short --branch` | PASSED | 位于 `main`，与 `origin/main` 一致。 |
| 基线：`claude -p "<固定问题>"`（无 CLAUDE.md） | PASSED | 答复“自动加载的规范文件：无”“我没有自动读 AGENTS.md”，确认缺陷存在。 |
| 对照：同一问题（有 CLAUDE.md） | PASSED | 答复自动加载 `CLAUDE.md` 并经 `@AGENTS.md` 引入 `AGENTS.md`，且能陈述强制流程。 |
| `npm run check:python` | NOT_EXECUTED | 仅新增 Markdown 入口文件，不涉及 Python 代码；同日早前已在 Windows 上通过。 |
| `npm run check:node` | NOT_EXECUTED | 同上；且本机 ESLint 因未忽略 `.venv` 仍会失败，属独立已知缺陷。 |
| `npm run check:dotnet` | NOT_EXECUTED | 本机无 .NET 10 SDK。 |
| 真实 Windows 环境验证 | NOT_EXECUTED | 与本次改动无关。 |

## 问题与处理

- 现象：初始不确定 Claude Code 是否已原生支持 `AGENTS.md`。
- 根因：不同版本行为可能不同，官方未在本次取证范围内给出明确结论。
- 处理：不做假设，改用同一问题的前后对照实验取得直接证据。
- 结果：基线答复明确“没有自动读 AGENTS.md”，据此确认必须提供 `CLAUDE.md` 入口。

## 风险与限制

- 本次只验证了“文件被自动加载”与“模型能正确陈述规范”，**未验证**在长会话、复杂改动
  中它是否始终按规范执行（例如每次都真的更新 changelog、真的走完证据阶梯）。
- 该入口仅对支持 `CLAUDE.md` 的工具生效；其他 Agent（使用 `AGENTS.md` 自身机制者）
  行为不受影响，也不因此获得 `CLAUDE.md` 的加载。
- 注入 `AGENTS.md` 会给每次会话增加少量上下文开销；若后续改为同时注入 `SKILL.md`，
  开销将明显上升，需要重新权衡。
- 若未来规范内容从 `AGENTS.md` 迁移，`CLAUDE.md` 的指针需同步更新，否则入口静默失效。

## 最终结果

- 已完成：新增 `CLAUDE.md`（`@AGENTS.md`），并经前后对照实测证明 Claude Code 会
  自动加载该入口与 `AGENTS.md`，从而自动获知仓库强制流程；该入口与本记录一并提交并
  推送到 `origin/main`。
- 未完成：未在长会话与真实改动任务中验证其长期遵守情况。
- 下一步建议：在下一个真实代码改动任务中观察它是否按规范自动建立 changelog；
  若发现它不读守卫 Skill，可将 `CLAUDE.md` 升级为同时导入
  `.trae/skills/human-operation-simulator-guardrails/SKILL.md`。
