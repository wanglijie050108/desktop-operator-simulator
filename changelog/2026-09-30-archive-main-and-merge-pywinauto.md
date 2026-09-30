# 归档 main 并将 pywinauto 迁移分支合并进 main

## 元信息

- 日期：2026-09-30
- 状态：已完成（本地合并完成，未推送）
- 环境：Windows 11（NT 10.0.26200）；Git 2.43.0.windows.1；Node.js 24.15.0；
  uv 0.11.14 + CPython 3.11.6；.NET SDK 仅 8.0.101/8.0.206

## 目标

- 在合并前为 `main` 建立归档分支，保留合并前的 C#/Node 基线。
- 将 `feature/pywinauto-desktop-agent` 合并进 `main`，落实“保留 Node 控制平面、
  用 Python pywinauto 替换 C# 桌面执行角色”的迁移策略。
- 全程只做本地操作，不推送、不改写远端已有提交。

## 上下文与证据

- 用户已确认导师口径为窄口径：**只把 C# 替换为 pywinauto**，Node 控制平面保留；
  真实微信联动是必须项；微信版本不指定。
- 合并前 `main` 尖端为 `8227723`，`feature/pywinauto-desktop-agent` 尖端为 `0bde877`，
  共同祖先为 `675edee`。
- 已存在远端归档分支 `origin/archive/csharp-agent-baseline-20260928` 指向 `675edee`，
  未包含 `main` 之后的两个提交，因此不能替代本次归档。
- `git merge-tree --write-tree main feature/pywinauto-desktop-agent` 返回干净树、
  退出码 0，预判无文本冲突。
- 双方自共同祖先以来都修改过的文件只有
  `.trae/skills/human-operation-simulator-guardrails/SKILL.md`（由 `Compare-Object`
  对两侧改动文件列表取交集得出）。
- 实测：合并后 `npm run check:python` 仍在 Windows 上 `FAILED`，报错与合并前一致
  （`windows_backend.py` L152/L163 `unused-ignore`）；`git diff
  origin/feature/pywinauto-desktop-agent main -- apps/desktop-agent-python` 为空，
  证明 Python 代码在合并中逐字节未变，合并前实测结论可直接沿用。

## 分析与决策

- 归档分支命名 `archive/main-baseline-20260930`，指向合并前的 `main` 尖端 `8227723`。
  沿用现有 `archive/` 前缀，避免另造一套命名。
- 采用 `git merge --no-ff`，保留显式合并提交，便于日后整体回退或审计迁移边界。
- 合并方向为“迁移分支并入 main”，不 rebase：迁移分支的 11 个提交边界清晰，
  改写历史会破坏已归档的审计记录与已有远端引用。
- 语义冲突复核（针对 git 无法发现的静默语义冲突）：由于双方仅共同修改了 SKILL.md，
  逐项核验该文件合并结果与旧 `main`、与迁移分支均无差异，且
  `Mandatory Quality Evidence Loop` 段落完整保留；`8227723` 改动的
  `AgentClientTests.cs` 与新增 `changelog/2026-09-28-fix-dotnet-ci-flake.md` 均确认保留。
- 未在合并中夹带任何额外修改：本次任务不修复质量门缺陷、不改文档，保证合并提交
  只反映分支内容。

## 操作记录

1. 只读核对归档分支、合并基点、双方改动文件集合与预判冲突。
   - 结果：成功；预判无冲突，确认现有归档分支不足以覆盖 `main` 最新两个提交。
2. 在 `main` 尖端创建归档分支 `archive/main-baseline-20260930`。
   - 结果：成功；指向 `8227723`。
3. 切回 `main` 并执行 `git merge --no-ff feature/pywinauto-desktop-agent`。
   - 结果：成功；ort 策略自动合并，无冲突，产生合并提交 `e591d93`。
   - 影响：54 个文件变更、6398 行新增、112 行删除；`main` 领先 `origin/main` 12 个提交。
4. 复核合并结果：Python 目录、归档分支、双方独有文件、SKILL.md 合并正确性。
   - 结果：成功；`main` 已包含 `apps/desktop-agent-python/`，旧 `main` 独有的两份
     changelog 未丢失。
5. 在合并后的 `main` 上重跑 `npm run check:python`。
   - 结果：失败；与合并前同样的 2 项 mypy 报错，确认缺陷来自分支内容而非合并操作。

## 文件变更

- 新增本地分支 `archive/main-baseline-20260930`（指向 `8227723`，未推送）。
- `main` 新增合并提交 `e591d93`，纳入迁移分支全部 54 个文件变更。
- `changelog/2026-09-30-archive-main-and-merge-pywinauto.md`：新增本任务记录。
- 未修改任何被合并文件的内容；未推送任何引用。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git merge-tree --write-tree main <branch>` | PASSED | 干净树、退出码 0，预判无冲突。 |
| `git merge --no-ff feature/pywinauto-desktop-agent` | PASSED | 无冲突，合并提交 `e591d93`。 |
| `git log --oneline --graph -6` | PASSED | 合并提交含两条父线，历史完整。 |
| `git status --short --branch` | PASSED | 位于 `main`，领先 `origin/main` 12 个提交，仅两份未跟踪 changelog。 |
| 归档分支指向核验 | PASSED | `archive/main-baseline-20260930` = `8227723`。 |
| `git rev-list --left-right --count origin/main...main` | PASSED | `0 12`，未产生分叉。 |
| SKILL.md 合并正确性（双向 diff） | PASSED | 与旧 `main`、与迁移分支均无差异，质量闭环段落保留。 |
| 旧 `main` 独有文件保留核验 | PASSED | `2026-09-28-quality-evidence-loop.md`、`2026-09-28-fix-dotnet-ci-flake.md` 均存在。 |
| `git diff <branch> main -- apps/desktop-agent-python` | PASSED | 为空，Python 代码逐字节未变。 |
| `npm run check:python`（合并后 main） | FAILED | mypy 2 项 `unused-ignore`；与合并前一致，非合并引入。 |
| `npm run test:python` | NOT_EXECUTED | 合并后仅重跑 mypy 阶段；Python 代码与合并前一致，沿用合并前实测：107 通过、2 失败、2 跳过。 |
| `npm run check:dotnet` / `test:integration:m1:csharp` | NOT_EXECUTED | 本机无 .NET 10 SDK（`global.json` 要求 10.0.401）。 |
| 推送 `main` 与归档分支 | NOT_EXECUTED | 用户未要求推送，按仓库规范不擅自推送。 |

## 问题与处理

- 现象：合并后的 `main` 在 Windows 上 `check:python` 仍失败。
- 根因：迁移分支自带的两处 `# type: ignore[attr-defined]` 在 Windows 上成为多余
  （`strict = true` 含 `warn_unused_ignores`），以及两处 `str(Path)` 路径断言在
  Windows 下分隔符不匹配。
- 处理：本次任务未修复，保持合并内容与分支完全一致；缺陷已在
  `changelog/2026-09-30-pywinauto-branch-review.md` 定位到行。
- 结果：缺陷随合并进入 `main`，需作为后续任务修复。

## 风险与限制

- **`main` 当前在 Windows 上的 Python 质量门是红的**。CI 的 `python` job 运行在
  `windows-latest` 且触发条件为 `pull_request` 或推送 `main`，因此一旦推送，
  该 job 将失败；不修好不建议推送。
- 归档分支目前仅存在于本地，尚未推送，因此还不构成远端意义上的“存档”；
  若本机丢失，归档仍会丢失。
- 合并保留了 C# 实现作为回退基线，默认运行角色尚未切换；`docs/08` 的迁移状态
  描述与合并后事实一致，无需在本任务修改。
- 真实微信联动仍未实现：微信 selector、`WeChatMessageSource`、Node 桌面命令结果桥
  与真实 `ChatReplyAdapter` 均属后续工作。

## 最终结果

- 已完成：`main` 已归档为 `archive/main-baseline-20260930`；迁移分支已无冲突合并进
  `main`（合并提交 `e591d93`），Python Agent 代码与全部迁移文档进入主分支。
- 未完成：未推送任何引用；未修复质量门 3 项缺陷；未执行任何真实环境验证。
- 下一步建议：先修复 Windows 质量门 3 处缺陷并在合并后的 `main` 上重跑
  `check:python` 直至通过，再推送 `main` 与归档分支，使 CI（含 windows-latest 的
  Python job）给出真实结论。
