# 强化 AI 代码质量证据闭环

## 元信息

- 日期：2026-09-28
- 状态：已完成
- 环境：macOS，当前分支 `feature/pywinauto-desktop-agent`

## 目标

- 将可重复的代码质量保障流程写入仓库强制加载的主 Skill，要求后续 Agent 在代码
  修改中执行上下文取证、范围控制、对抗式检查、分层验证和最终复核。

## 上下文与证据

- 已读取 `AGENTS.md`、`README.md`、`docs/08-development-status.md`、
  `changelog/README.md`、现有主 Skill 和最初建立守卫的任务记录。
- `AGENTS.md` 已强制所有仓库任务加载
  `.trae/skills/human-operation-simulator-guardrails/SKILL.md`，因此增强该 Skill
  可以覆盖后续兼容仓库指令的 Agent。
- 当前工作树包含 Python Agent 与文档的未提交用户改动，本任务不切换分支、不覆盖
  或整理这些改动。

## 分析与决策

- 不创建第二个质量 Skill，避免入口分散；直接增强仓库唯一强制加载的主 Skill。
- 规则应强调可观察证据和可执行检查，不要求记录模型隐藏思维链。
- 质量流程应按风险调整验证深度，并明确模拟验证不能替代真实 Windows 验收。

## 操作记录

1. 检查仓库根目录、分支和工作树。
   - 结果：成功。
   - 影响：只读；确认保留现有未提交改动。
2. 阅读 Skill 创建规范、仓库主 Skill、协作入口、状态文档和 changelog 规范。
   - 结果：成功。
   - 影响：只读；确定修改现有主 Skill。
3. 创建本任务记录。
   - 结果：成功。
   - 影响：新增本文件。
4. 在仓库主 Skill 的工程质量规则中加入强制质量证据闭环。
   - 结果：成功；覆盖变更契约、最小实现、对抗式审查、分层证据和最终差异复核。
   - 影响：修改 `.trae/skills/human-operation-simulator-guardrails/SKILL.md`。
5. 对高风险改动增加第二遍独立审查要求。
   - 结果：成功；并发、生命周期、安全、持久化、协议和跨组件改动需使用独立审查
     或聚焦复现实验；工具不可用时必须记录限制。
   - 影响：明确后续 Agent 的高风险质量门槛。
6. 执行 Skill 结构、入口、规则覆盖、空白和最终差异检查。
   - 结果：成功；frontmatter 有效，五阶段规则齐全，`AGENTS.md` 仍指向该 Skill。
   - 影响：只读验证。
7. 根据用户要求准备提交并推送主分支。
   - 结果：部分完成；远端不存在 `master`，确认默认主分支和唯一对应分支为 `main`。
   - 影响：目标调整为仓库实际主分支 `main`，不创建重复的 `master` 分支。
8. 创建独立 `main` worktree，并仅复制主 Skill 与本任务记录。
   - 结果：成功；目标 worktree 基于最新 `origin/main`，未包含功能分支其他文件。
   - 影响：避免切换或扰动现有功能分支工作区。
9. 将本次规则增强提交到 `main` 并推送 `origin/main`。
   - 结果：成功；提交和远端推送均完成。
   - 影响：后续从主分支工作的 Agent 将加载新版强制质量流程。

## 文件变更

- `changelog/2026-09-28-quality-evidence-loop.md`：记录本次规则增强及验证结果。
- `.trae/skills/human-operation-simulator-guardrails/SKILL.md`：新增强制质量证据闭环。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| Ruby YAML/frontmatter 检查 | PASSED | Skill 名称、178 字符 description 和正文有效 |
| 五阶段规则结构检查（`grep`） | PASSED | 变更契约、最小实现、对抗审查、证据阶梯和最终复核均存在 |
| `AGENTS.md` 强制入口检查 | PASSED | 主 Skill 文件存在且入口路径匹配 |
| 人工规则一致性复核 | PASSED | 规则可执行，并按风险区分验证深度和真实环境边界 |
| `git diff --check` | PASSED | 未发现空白错误 |
| `git fetch origin master` | FAILED | 远端不存在 `master` 引用 |
| `git ls-remote --heads origin main master` | PASSED | 仅存在 `refs/heads/main` |
| `git remote show origin` | PASSED | 远端 HEAD 分支为 `main` |
| 独立 worktree 范围检查 | PASSED | 仅包含主 Skill 和本任务记录 |
| `git push origin main` | PASSED | 主分支提交已推送到远端 |
| Node/Python/.NET 自动化测试 | NOT_EXECUTED | 本次仅修改协作规则，不涉及运行时代码 |
| Windows 真实环境验证 | NOT_EXECUTED | 文档与协作规则修改不涉及运行时行为 |

## 问题与处理

- 现象：首选文本搜索命令 `rg` 返回退出码 127。
- 根因：当前命令环境未提供 `rg`。
- 处理：使用 `grep -nE` 执行等价的规则结构检查。
- 结果：替代检查通过。
- 现象：`git fetch origin master` 返回退出码 128。
- 根因：该仓库使用 `main` 作为默认主分支，远端没有 `master`。
- 处理：通过远端引用和 HEAD 配置复核后，将交付目标映射为 `main`。
- 结果：主分支目标已明确，不创建含义重复的新分支。

## 风险与限制

- 规则只能约束会读取并遵守 `AGENTS.md` 或项目 Skill 的 Agent。
- 规则能够降低缺陷概率，但不能替代特定硬件、真实账号和 Windows 交互桌面验收。
- 当前功能分支存在其他未跟踪文件；交付使用独立 worktree，避免夹带或覆盖。

## 最终结果

- 已完成：仓库强制主 Skill 已加入五阶段质量证据闭环，并已提交、推送到仓库实际
  主分支 `main`。未执行与文档规则无关的运行时测试。
