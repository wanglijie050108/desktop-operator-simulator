# changelog 精简：历史条目阶段归档与读取成本治理

## 元信息

- 日期：2026-10-04
- 状态：已完成
- 环境：Windows 11；文档整理，未运行构建、测试或真实桌面操作

## 目标

- 降低 `changelog/` 的读取成本：把已过时/冗余的历史独立记录按阶段合并为少量归档，
  并删除被合并的原文件。
- 保留可复核事实：里程碑状态、关键决策与理由、精确测试/覆盖率数字、CI run id、
  提交哈希、失败根因、未完成项与阻塞条件。
- 建立滚动归档策略，避免条目再次无限膨胀。

## 上下文与证据

- 整理前 `changelog/` 共 39 个文件、约 257 KB（38 条独立记录 + `README.md`），
  全部已在 git 中跟踪；最早为 `2026-09-24`，最新为 `2026-10-04`。
- 按守卫要求，每个任务必须新建记录，导致条目随任务数线性增长；其中大量内容为
  已被后续任务取代的中间态（CI 红→绿排查、迁移分支审查、模板空项、逐步操作记录）。
- `docs/08-development-status.md` 已承载当前事实状态（M0–M5、已完成/未完成/未验证），
  因此 changelog 的价值主要在历史决策与证据，而非重复当前状态。
- 检查确认：仓库其它文件（`docs/`、`AGENTS.md`、`CLAUDE.md`、`.trae/`）没有引用任何
  具体 changelog 文件名，删除原文件不会产生悬空链接。

## 分析与决策

- 分层保留：**最近 7 天保留独立记录**（`2026-10-01`、`2026-10-04`），
  **更早的按阶段归档**，避免把昨天的记录立刻合并而丢失可用上下文。
- 归档粒度按任务阶段而非按天，共 4 个归档文件；每个归档保留原文件索引，
  原文可用 `git show <commit>:changelog/<原文件名>` 找回（删除即 git 可逆）。
- 归档采用简化结构（阶段目标/关键决策与依据/验证证据/未完成与后续/风险与限制/
  原始条目索引），保留 `changelog/README.md` 规定的状态词与精确数字。
- 删除范围仅限叙述冗余：逐步操作记录、逐文件变更清单、重复排查细节、原始命令输出；
  里程碑完成状态、缺陷根因、安全边界决策、未验证项一律保留。
- 凭据相关条目（`2026-09-30-switch-github-credentials-and-push.md`）只按“凭据已切换、
  推送成功”的抽象事实并入归档，不含任何账号、令牌或来源细节。
- 合并动作本身按守卫要求留一条独立记录（本文件），并在合并前先用子代理生成归档、
  复核后再删除原文件，避免生成失败导致信息丢失。

## 操作记录

1. 盘点 `changelog/` 全部文件、字节数与 git 跟踪状态。
   - 结果：成功；确认 38 条记录均在 git 中，删除可逆。
2. 更新 `changelog/README.md`：新增“目录结构”“读取约定”“滚动归档策略”三节。
   - 结果：成功；给出任务开始时的最小读取路径与 7 天滚动归档规则。
3. 由 4 个并行子代理分别读取源文件并生成 4 个阶段归档。
   - 结果：成功；归档与索引齐全，未运行构建/测试。
4. 逐个复核归档文件存在且覆盖全部源文件索引后，删除 34 条被合并的原始条目。
   - 结果：成功；`git status` 显示删除项均可由 git 历史恢复。

## 文件变更

新增归档（合并 34 条原始记录）：

- `changelog/2026-09-24-foundation-and-m1-m5.md` ← 12 条 `2026-09-24-*`。
- `changelog/2026-09-25-to-09-28-audit-and-migration-plan.md` ← 3 条 `2026-09-25-*`
  + `2026-09-28-changelog-reconciliation` / `-fix-dotnet-ci-flake` /
  `-quality-evidence-loop` / `-pywinauto-architecture-assessment` /
  `-pywinauto-implementation-plan`。
- `changelog/2026-09-28-python-agent-and-wechat-entry.md` ← `2026-09-28` 的
  `python-agent-dispatcher` / `python-agent-transport` / `python-wechat-ingress` /
  `python-windows-actions` / `wechat-uia-inspection` / `windows-notepad-spike`。
- `changelog/2026-09-30-migration-merge-and-ci.md` ← 8 条 `2026-09-30-*`。

修改：

- `changelog/README.md`：新增目录索引、读取约定与滚动归档策略。

保留（未合并）：

- `changelog/2026-10-01-implement-wechat-desktop-bridge.md`
- `changelog/2026-10-01-review-recent-changelog.md`
- `changelog/2026-10-01-sync-migration-status.md`
- `changelog/2026-10-04-pull-main-and-review-changelog.md`
- `changelog/2026-10-04-consolidate-changelog-history.md`（本文件）

删除：上述 34 条被合并的原始条目（内容已归档，原文见 git 历史）。

未改动：任何产品代码、测试、契约、CI 配置与 `docs/`。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| 归档文件生成（4 个并行子代理） | PASSED | 4 个归档文件均生成，含“原始条目索引”。 |
| 归档索引覆盖核对 | PASSED | 34 条原文件全部在对应归档索引中出现，无遗漏。 |
| 仓库内 changelog 文件名引用检查 | PASSED | `docs/`、`AGENTS.md`、`CLAUDE.md`、`.trae/` 无具体条目文件名引用。 |
| 目录规模核对 | PASSED | 39 文件 256.8 KiB → 10 文件 71.6 KiB；4 个归档合计 38.0 KiB（源 34 文件约 222 KiB）。 |
| 归档内容抽查（数字与状态词） | PASSED | 里程碑状态、测试/覆盖率数字、CI run id、提交哈希保留。 |
| 构建 / 测试 / Windows 实机验证 | NOT_EXECUTED | 本次仅文档整理，无代码改动。 |

## 问题与处理

- 现象：子代理生成的归档若无索引遗漏，删除原文件会造成事实丢失。
- 根因：合并由多代理并行完成，覆盖度无法自动保证。
- 处理：先复核 4 个归档文件的“原始条目索引”与源文件清单一一对应，再执行删除；
  且所有原文件均已在 git 中，必要时可 `git show` 恢复。
- 结果：无遗漏，删除可逆。

## 风险与限制

- 归档是压缩摘要，细粒度过程证据（逐步命令、逐文件 diff）已从工作区移除，
  需要时须从 git 历史检索，检索本身有成本。
- 归档质量依赖子代理压缩判断，个别次要细节可能未被保留；`docs/08-development-status.md`
  仍是当前状态的权威来源。
- 本次未运行任何质量门或真实环境验证，归档不改变任何能力与验证状态。

## 最终结果

- 已完成：`changelog/` 从 39 文件 / 256.8 KiB 精简为 10 文件 / 71.6 KiB（-72%）；
  历史按 4 个阶段归档，索引与原文找回路径明确；`README.md` 增加最小读取路径与
  7 天滚动归档策略，后续任务不再增长历史读取成本。
- 未完成：无。
- 下一步建议：后续任务维持“最近 7 天独立记录”，超过 7 天后在下一次整理任务中
  并入阶段归档；提交由用户决定（本次未 commit、未 push）。
