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
6. 提交工作记录与修复后尝试推送到远端。
   - 结果：提交成功（`b8cf677`、`1bed35a`）；首次推送被写权限拒绝。
   - 影响：两个提交先落在本地 `main`；远端当时无变更。
7. 经用户指示切换为 owner 账号凭据后重试推送。
   - 结果：成功；`main` 与归档分支均已推送到远端。
   - 影响：见 `changelog/2026-09-30-switch-github-credentials-and-push.md`。

## 文件变更

- 新增分支 `archive/main-baseline-20260930`（指向 `8227723`），已推送为远端分支。
- `main` 新增合并提交 `e591d93`，纳入迁移分支全部 54 个文件变更。
- `changelog/2026-09-30-archive-main-and-merge-pywinauto.md`：新增本任务记录。
- 未修改任何被合并文件的内容。

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
| `git push origin main`（首次） | BLOCKED | 403：本机 HTTPS 凭据属于 `wanglijie314`，对 `wanglijie050108` 名下仓库无写权限。 |
| `git push origin main`（切换凭据后重试） | PASSED | `8227723..96f2f20 main -> main`。 |
| `git push origin archive/main-baseline-20260930` | PASSED | 切换凭据后新建远端分支，指向 `8227723`。 |
| `git ls-remote --heads origin` | PASSED | 只读访问正常；确认远端 `main` = `96f2f20`、归档分支 = `8227723`。 |

## 问题与处理

- 现象：合并后的 `main` 在 Windows 上 `check:python` 仍失败。
- 根因：迁移分支自带的两处 `# type: ignore[attr-defined]` 在 Windows 上成为多余
  （`strict = true` 含 `warn_unused_ignores`），以及两处 `str(Path)` 路径断言在
  Windows 下分隔符不匹配。
- 处理：本次任务未修复，保持合并内容与分支完全一致；缺陷已在
  `changelog/2026-09-30-pywinauto-branch-review.md` 定位到行。
- 结果：缺陷随合并进入 `main`，需作为后续任务修复。
- 现象：`git push origin main` 与推送归档分支均返回 403。
- 根因：远端为 HTTPS，本机由 Git Credential Manager 提供的凭据属于账号
  `wanglijie314`，该账号对 `wanglijie050108/desktop-operator-simulator` 无写权限；
  只读访问正常，说明不是网络或地址问题。
- 处理：不尝试替换、猜测或绕过凭据，先只记录事实；随后经用户明确指示，登出旧账号
  并在 GCM 授权页以 owner 账号完成认证（详见
  `changelog/2026-09-30-switch-github-credentials-and-push.md`）。
- 结果：两个引用均已推送成功，写权限阻塞解除。

## 风险与限制

- **`main` 推送时的 Python 质量门曾为红**。CI 的 `python` job 运行在
  `windows-latest` 且触发条件为 `pull_request` 或推送 `main`；该缺陷已由后续任务
  `changelog/2026-09-30-fix-windows-python-quality-gate.md` 修复，修复后本地
  `npm run check:python` 通过（109 通过、2 跳过、覆盖率 91.82%），故本次推送预期
  使该 job 转绿——**CI 实际结论仍待用户在网页端确认，本地无法读取 Actions 状态**。
- 归档分支已推送为远端分支 `archive/main-baseline-20260930`，构成远端存档。
- 合并保留了 C# 实现作为回退基线，默认运行角色尚未切换；`docs/08` 的迁移状态
  描述与合并后事实一致，无需在本任务修改。
- 迁移分支 `feature/pywinauto-desktop-agent` 仍保留在远端，未删除。
- 真实微信联动仍未实现：微信 selector、`WeChatMessageSource`、Node 桌面命令结果桥
  与真实 `ChatReplyAdapter` 均属后续工作。

## 最终结果

- 已完成：`main` 已归档为远端分支 `archive/main-baseline-20260930`；迁移分支已无冲突
  合并进 `main`（合并提交 `e591d93`），Python Agent 代码与全部迁移文档进入主分支；
  记录与后续质量门修复已提交（`b8cf677`、`1bed35a`、`96f2f20`）并推送到 `origin/main`。
- 未完成：CI 结果未在本地确认；未执行任何真实环境验证。
- 下一步建议：在网页端确认 CI（尤其 `windows-latest` 的 Python job）结论；随后按计划
  执行只读微信 UIA 取证推进 M0。
