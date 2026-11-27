# 将 feature/pywinauto1 推送到共享仓库并改为追踪 upstream

## 元信息

- 日期：2026-11-17
- 状态：已完成
- 环境：Windows 11；Git 2.53.0.windows.2；GitHub 直连不稳定
- 分支：`feature/pywinauto1` → `upstream/feature/pywinauto1`

## 目标

- 把已完成的提交直接推送到共享仓库（原作者的 `upstream`），并把本地分支的默认
  tracking 从 `origin` 改为 `upstream`。

## 上下文与证据

- `origin` = `huuard/desktop-operator-simulator`（个人 fork）。
- `upstream` = `wanglijie050108/desktop-operator-simulator`（共享仓库）。
- 此前推送均发往 `origin`，因为分支 tracking 指向 `origin/feature/pywinauto1`。
- 用 `git push --dry-run upstream feature/pywinauto1` 验证写权限：
  返回 `* [new branch] feature/pywinauto1 -> feature/pywinauto1`，说明当前账号
  对共享仓库有写权限。
- GitHub 直连依赖 `http.curloptResolve` 绕过被污染的 DNS；可用 IP 会波动。

## 分析与决策

- 按用户明确要求直接推共享仓库，不使用 PR 流程。
- 使用 `git push -u upstream feature/pywinauto1` 同时完成推送与 tracking 设置。
- 保留 `origin` 作为个人 fork，不删除、不改 URL；显式 `git push origin` 仍可用。

## 操作记录

1. 核实两个 remote 与写权限。
   - 结果：成功。dry-run 返回新分支创建计划。
2. 首次推送因 GitHub 连接超时失败。
   - 结果：失败。依次尝试 `140.82.113.3`、`140.82.114.3`、`140.82.112.3`、
     `20.205.243.166`，第二轮 `140.82.114.3` 成功。
3. 推送并设置 tracking。
   - 结果：成功。`* [new branch] feature/pywinauto1 -> feature/pywinauto1`，
     `branch 'feature/pywinauto1' set up to track 'upstream/feature/pywinauto1'`。
4. 更新仓库本地 `http.curloptResolve` 为当前可用 IP `140.82.114.3`。
   - 结果：成功。

## 文件变更

- `changelog/2026-11-17-push-to-upstream.md`：本记录（新建）。
- 远端：新增 `upstream` 分支 `feature/pywinauto1`（`bc4ef77`）。
- 本地 git 配置：`branch.feature/pywinauto1.remote=upstream`、
  `http.curloptResolve=github.com:443:140.82.114.3`。

## 验证

| 命令或检查 | 状态 | 结果 |
|---|---|---|
| `git push --dry-run upstream feature/pywinauto1` | PASSED | 返回新分支创建计划，确认写权限。 |
| `git push -u upstream feature/pywinauto1` | PASSED | 新分支创建，tracking 已设置。 |
| `git status -sb` | PASSED | `## feature/pywinauto1...upstream/feature/pywinauto1`。 |
| `git ls-remote upstream refs/heads/feature/pywinauto1` | PASSED | `bc4ef77...`，与本地 HEAD 一致。 |

## 风险与限制

- GitHub 直连 IP 不稳定；后续 git 操作可能仍需要在多个 IP 间重试。
- 本次只把 `feature/pywinauto1` 分支推到共享仓库，**没有合并到 `upstream/main`**；
  是否需要 PR 或合并由团队约定决定。
- 共享仓库若启用分支保护，后续对该分支的强推或对 `main` 的推送可能被拒绝。

## 最终结果

- 共享仓库已包含 `feature/pywinauto1`（`bc4ef77`）。
- 本地分支默认 tracking 已改为 `upstream/feature/pywinauto1`，以后 `git push` /
  `git pull` 默认作用于共享仓库。
